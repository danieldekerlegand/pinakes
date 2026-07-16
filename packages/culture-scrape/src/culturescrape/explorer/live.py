"""Optional live Neo4j connection for the explorer.

The explorer is happiest reading the canonical TSV, but when a Neo4j database is
connected it can talk to the full property graph: run the shipped
``cypher/*.cypher`` example queries and source the graph view's neighborhood from
the live store. This module wraps :mod:`culturescrape.neo4j` so the rest of the
app never imports the driver directly and every code path degrades gracefully —
absent credentials or an absent driver leave the TSV-backed views untouched.

Importing this module never requires the optional ``neo4j`` driver: the query
files are read from disk and connection settings are parsed with no live
database, mirroring :mod:`culturescrape.neo4j`. The driver is only touched when a
query is actually run, and the connection function is injectable so the whole
surface is exercisable against a mocked driver.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

from culturescrape.neo4j import (
    Neo4jConfigError,
    load_config,
)
from culturescrape.neo4j import (
    connect as default_connect,
)
from culturescrape.neo4j.constraints import ENTITY_LABEL
from culturescrape.neo4j.queries import iter_queries

if TYPE_CHECKING:
    from neo4j import Driver

#: A ``$param`` placeholder in a Cypher query.
_PARAM = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)")


class Connect(Protocol):
    """The shape of :func:`culturescrape.neo4j.connect`, injectable for tests."""

    def __call__(
        self,
        config: Mapping[str, Any] | None = ...,
        /,
        *,
        env: Mapping[str, str] | None = ...,
    ) -> Driver: ...


@dataclass(frozen=True)
class CypherQuery:
    """A shipped ``cypher/*.cypher`` example query, parsed for display."""

    name: str
    description: str
    params: tuple[str, ...]
    cypher: str


@dataclass(frozen=True)
class QueryResult:
    """The columns and stringified rows a Cypher query returned."""

    columns: tuple[str, ...]
    rows: tuple[tuple[str, ...], ...]


@dataclass(frozen=True)
class LiveNode:
    """A node returned by the live neighborhood query."""

    csid: str
    name: str
    labels: tuple[str, ...]


@dataclass(frozen=True)
class LiveEdge:
    """A relationship returned by the live neighborhood query."""

    start: str
    end: str
    type: str


@dataclass(frozen=True)
class LiveNeighborhood:
    """The live-graph counterpart of :class:`~explorer.data.Neighborhood`."""

    center: str
    depth: int
    nodes: tuple[LiveNode, ...]
    edges: tuple[LiveEdge, ...]


@dataclass(frozen=True)
class RetrievedSeed:
    """A vector-index hit: the seed node plus its similarity score."""

    csid: str
    name: str
    labels: tuple[str, ...]
    score: float


@dataclass(frozen=True)
class LiveRetrieval:
    """A hybrid-retrieval result: the ranked seeds plus their expanded subgraph.

    The vector index picks the top-*k* semantically-nearest *seeds*; *nodes* /
    *edges* are their combined neighborhood (self-contained: every edge has both
    endpoints in the node set), so the subgraph is ready to ground an LLM answer.
    """

    seeds: tuple[RetrievedSeed, ...]
    nodes: tuple[LiveNode, ...]
    edges: tuple[LiveEdge, ...]


def load_queries(root: str | Path | None = None) -> tuple[CypherQuery, ...]:
    """Parse the shipped ``cypher/*.cypher`` files into displayable queries."""
    return tuple(_parse_query(path) for path in iter_queries(root))


def _parse_query(path: Path) -> CypherQuery:
    text = path.read_text(encoding="utf-8")
    comment: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("//"):
            comment.append(stripped[2:].strip())
        elif stripped:
            break  # the first statement line ends the leading comment block
    # Ordered-unique so the param form lists each placeholder once, in order.
    params = tuple(dict.fromkeys(_PARAM.findall(text)))
    return CypherQuery(
        name=path.name,
        description="\n".join(comment).strip(),
        params=params,
        cypher=text,
    )


def _render(value: Any) -> str:
    """Render one Cypher-returned value as a display string."""
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return "; ".join(_render(item) for item in value)
    return str(value)


def _type_labels(labels: Any) -> tuple[str, ...]:
    """The sorted per-type labels of a node, with the ``Entity`` anchor dropped."""
    return tuple(sorted(str(label) for label in labels if str(label) != ENTITY_LABEL))


class Neo4jLive:
    """An optional handle to a live Neo4j database for the explorer.

    Holds the connection settings (a *config* override and/or an *env* mapping,
    resolved by :func:`culturescrape.neo4j.load_config`) and a *connect* function
    so tests can supply a mocked driver. Nothing here opens a connection until a
    query is actually run.
    """

    def __init__(
        self,
        config: Mapping[str, Any] | None = None,
        *,
        env: Mapping[str, str] | None = None,
        connect: Connect = default_connect,
    ) -> None:
        self._config = config
        self._env = env
        self._connect = connect

    def configured(self) -> bool:
        """True when connection settings (notably a password) are resolvable."""
        try:
            load_config(self._config, env=self._env)
        except Neo4jConfigError:
            return False
        return True

    def status_message(self) -> str:
        """A one-line, user-facing description of the live connection setting."""
        try:
            cfg = load_config(self._config, env=self._env)
        except Neo4jConfigError:
            return (
                "No live database configured — set NEO4J_URI, NEO4J_USER and "
                "NEO4J_PASSWORD to query the graph live. The views below fall "
                "back to the canonical TSV."
            )
        return f"Configured for {cfg.uri} as {cfg.user}; queries run live."

    def run(
        self, cypher: str, params: Mapping[str, Any] | None = None
    ) -> QueryResult:
        """Run *cypher* against the live database and return its rows.

        Raises :class:`culturescrape.neo4j.Neo4jConfigError` when no settings are
        resolvable, :class:`culturescrape.neo4j.Neo4jDriverNotInstalled` when the
        driver extra is absent, and whatever the driver raises on a connection or
        query failure; callers handle these to degrade gracefully.
        """
        driver = self._connect(self._config, env=self._env)
        try:
            with driver.session() as session:
                result = session.run(cypher, dict(params or {}))
                columns = tuple(result.keys())
                rows = tuple(
                    tuple(_render(record[column]) for column in columns)
                    for record in result
                )
            return QueryResult(columns=columns, rows=rows)
        finally:
            driver.close()

    def neighborhood(self, csid: str, depth: int) -> LiveNeighborhood | None:
        """The live graph neighborhood within *depth* hops of *csid*.

        Returns ``None`` when *csid* is not in the graph. Mirrors the TSV
        neighborhood: every returned edge has both endpoints in the node set, so
        the result is self-contained. Raises like :meth:`run` on failure.
        """
        driver = self._connect(self._config, env=self._env)
        try:
            with driver.session() as session:
                node_records = list(
                    session.run(
                        "MATCH (c:Entity {csid: $csid}) "
                        f"MATCH (c)-[*0..{int(depth)}]-(n:Entity) "
                        "RETURN DISTINCT n.csid AS csid, n.name AS name, "
                        "labels(n) AS labels",
                        {"csid": csid},
                    )
                )
                if not node_records:
                    return None
                ids = [str(record["csid"]) for record in node_records]
                edge_records = list(
                    session.run(
                        "MATCH (a:Entity)-[r]->(b:Entity) "
                        "WHERE a.csid IN $ids AND b.csid IN $ids "
                        "RETURN a.csid AS start, b.csid AS end, type(r) AS type",
                        {"ids": ids},
                    )
                )
        finally:
            driver.close()
        nodes = tuple(
            LiveNode(
                csid=str(record["csid"]),
                name=_render(record["name"]),
                labels=_type_labels(record["labels"]),
            )
            for record in node_records
        )
        edges = tuple(
            LiveEdge(str(record["start"]), str(record["end"]), str(record["type"]))
            for record in edge_records
        )
        return LiveNeighborhood(center=csid, depth=depth, nodes=nodes, edges=edges)

    def vector_retrieve(
        self, embedding: Sequence[float], k: int, depth: int, *, index_name: str
    ) -> LiveRetrieval:
        """Hybrid retrieval: vector top-*k* seeds, then neighborhood expansion.

        Queries the native vector index *index_name* for the *k* nodes nearest to
        *embedding*, then expands each seed out to *depth* hops and gathers the
        edges internal to that node set. Mirrors :meth:`neighborhood`'s
        self-contained shape. Raises like :meth:`run` on a driver failure; a query
        that finds no seeds returns an empty result rather than raising.
        """
        driver = self._connect(self._config, env=self._env)
        try:
            with driver.session() as session:
                seed_records = list(
                    session.run(
                        "CALL db.index.vector.queryNodes($index, $k, $embedding) "
                        "YIELD node, score "
                        "WHERE node:Entity "
                        "RETURN node.csid AS csid, node.name AS name, "
                        "labels(node) AS labels, score AS score",
                        {
                            "index": index_name,
                            "k": int(k),
                            "embedding": [float(value) for value in embedding],
                        },
                    )
                )
                seeds = tuple(
                    RetrievedSeed(
                        csid=str(record["csid"]),
                        name=_render(record["name"]),
                        labels=_type_labels(record["labels"]),
                        score=float(record["score"]),
                    )
                    for record in seed_records
                    if record["csid"] is not None
                )
                if not seeds:
                    return LiveRetrieval(seeds=(), nodes=(), edges=())
                seed_ids = [seed.csid for seed in seeds]
                node_records = list(
                    session.run(
                        "MATCH (c:Entity) WHERE c.csid IN $ids "
                        f"MATCH (c)-[*0..{int(depth)}]-(n:Entity) "
                        "RETURN DISTINCT n.csid AS csid, n.name AS name, "
                        "labels(n) AS labels",
                        {"ids": seed_ids},
                    )
                )
                ids = [str(record["csid"]) for record in node_records]
                edge_records = list(
                    session.run(
                        "MATCH (a:Entity)-[r]->(b:Entity) "
                        "WHERE a.csid IN $ids AND b.csid IN $ids "
                        "RETURN a.csid AS start, b.csid AS end, type(r) AS type",
                        {"ids": ids},
                    )
                )
        finally:
            driver.close()
        nodes = tuple(
            LiveNode(
                csid=str(record["csid"]),
                name=_render(record["name"]),
                labels=_type_labels(record["labels"]),
            )
            for record in node_records
        )
        edges = tuple(
            LiveEdge(str(record["start"]), str(record["end"]), str(record["type"]))
            for record in edge_records
        )
        return LiveRetrieval(seeds=seeds, nodes=nodes, edges=edges)


__all__ = [
    "Connect",
    "CypherQuery",
    "LiveEdge",
    "LiveNeighborhood",
    "LiveNode",
    "LiveRetrieval",
    "Neo4jLive",
    "QueryResult",
    "RetrievedSeed",
    "load_queries",
]
