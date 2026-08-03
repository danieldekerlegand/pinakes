"""Neo4j-backed engine calls, through the engine's own driver.

Until now the shared graph had **two** drivers pointed at it: the engine's
(`pinakes_engine.neo4j`, ~24 Python modules) and a second, TypeScript one
(`server/services/graph-store.ts`) that the Express `/api/graph/*` routes used
for node/neighborhood/overview lookups, with a third path — the sidecar's
``/neo4j`` and ``/api/retrieve`` consoles — reached over HTTP on top. This module
is the single Python replacement for all three (docs/UNIFIED-PROJECT-PLAN.md §5:
"consolidate the 2 TS driver files into Python").

What it deliberately keeps from the TypeScript it replaces:

* **The projection.** ``{csid, labels, name, properties}`` for a node,
  ``{id, type, startCsid, endCsid, weight?, properties}`` for an edge, with
  ``csid``/``name``/``weight`` lifted out of the property bag. That is the shape
  the client's graph views parse; it is contract, not taste.
* **The fast-fail probe.** Every read checks the short-cached availability
  verdict first. Without it an unreachable store makes a request wait out the
  driver's whole connection/retry window, and a graph-backed view hangs on
  "Loading…" instead of degrading promptly.
* **The personal-tier gate.** Nodes ingested from a user's private files are
  filtered out of every browser-facing result unless the operator opts in with
  ``PERSONAL_TIER_ENABLED``. This is a privacy invariant, and the port keeps it
  where it belongs — in front of the store — rather than in a route.

What it drops: the APOC-dependent neighborhood query. The TypeScript issued it
first and fell back to a pure-Cypher traversal whenever APOC was absent (which it
is on any `neo4j-admin import` graph); both returned the same shape, so only the
fallback survives.
"""

from __future__ import annotations

import os
import time
from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any

from pinakes_engine.explorer.app import (
    DEFAULT_RETRIEVE_K,
    MAX_GRAPH_DEPTH,
    MAX_RETRIEVE_K,
    RETRIEVE_DEPTH,
)
from pinakes_engine.explorer.data import dimension_for
from pinakes_engine.explorer.live import Connect, Neo4jLive
from pinakes_engine.explorer.retrieval import HybridRetriever
from pinakes_engine.neo4j import Neo4jConfigError, Neo4jDriverNotInstalled
from pinakes_engine.neo4j import connect as default_connect
from pinakes_engine.neo4j.vector_index import SentenceTransformerEmbedder
from pinakes_engine.orchestrate.tiers import PERSONAL_SOURCES

from pinakes.engine.errors import EngineError, EngineFailure, EngineUnavailable

if TYPE_CHECKING:  # pragma: no cover - the driver is an optional extra
    from neo4j import Record
    from neo4j.graph import Node, Relationship

#: Traversal depth bounds for `/api/graph/neighborhood/{id}`. Narrower than the
#: explorer's own 0..4 — three hops is what the client's depth control offers and
#: what the recorded contract says the route clamps to.
MIN_DEPTH = 1
MAX_DEPTH = 3

#: Node cap for `/api/graph/overview`, and its ceiling.
DEFAULT_OVERVIEW_LIMIT = 250
MAX_OVERVIEW_LIMIT = 1_000

#: How long a positive/negative availability probe is trusted, in seconds, so a
#: burst of requests issues one connectivity check between them.
AVAILABILITY_TTL_SECONDS = 5.0

#: Env var naming the target database (the engine's `load_config` covers only
#: uri/user/password, which are the three it needs for a bulk load).
DATABASE_ENV = "NEO4J_DATABASE"
DEFAULT_DATABASE = "neo4j"

#: Opt-in for surfacing personal-tier facts through the browser-facing API. Off
#: by default: personal material stays local-only unless an operator says
#: otherwise.
PERSONAL_TIER_ENV = "PERSONAL_TIER_ENABLED"

#: The `:LABEL` every personal media asset carries, gating it even in a
#: deployment that has registered no personal acquisition source.
ASSET_LABEL = "Asset"

_TRUTHY = frozenset({"true", "1", "yes", "on"})

_connect: Connect = default_connect
_retriever: HybridRetriever | None = None
_availability: tuple[bool, float] | None = None


def configure(
    *,
    connect: Connect | None = None,
    retriever: HybridRetriever | None = None,
) -> None:
    """Install the handles this module talks to the graph through.

    Both are injectable for the same reason the engine makes them injectable:
    the whole surface stays exercisable against a fake driver and a fake
    retriever, with no database and no embedding model. Also clears the cached
    availability verdict, which belonged to the previous handles.
    """
    global _connect, _retriever
    if connect is not None:
        _connect = connect
    if retriever is not None:
        _retriever = retriever
    reset()


def reset() -> None:
    """Forget the cached availability verdict (test teardown / after a failure)."""
    global _availability
    _availability = None


def reset_handles() -> None:
    """Restore the default driver + retriever. Test teardown for `configure`."""
    global _connect, _retriever
    _connect = default_connect
    _retriever = None
    reset()


def live() -> Neo4jLive:
    """The engine's live-Neo4j handle, built over the configured connector."""
    return Neo4jLive(connect=_connect)


def retriever() -> HybridRetriever:
    """The GraphRAG retriever.

    The default pairs the live handle with a lazy local embedder: nothing is
    loaded until a query runs, and it reports itself unavailable when the
    ``graphrag`` extra (torch, deliberately absent from this service's
    environment) or a Neo4j connection is missing.
    """
    global _retriever
    if _retriever is None:
        _retriever = HybridRetriever(live(), SentenceTransformerEmbedder())
    return _retriever


# ── Availability ─────────────────────────────────────────────────────────────


def available() -> bool:
    """Whether the graph store is reachable. Never raises.

    Cached for :data:`AVAILABILITY_TTL_SECONDS`; a failed read clears it.
    """
    global _availability
    now = time.monotonic()
    if _availability is not None and now - _availability[1] < AVAILABILITY_TTL_SECONDS:
        return _availability[0]
    verdict = False
    try:
        driver = _connect()
        try:
            driver.verify_connectivity()
            verdict = True
        finally:
            driver.close()
    except Exception:  # noqa: BLE001 - any failure means "not reachable"
        verdict = False
    _availability = (verdict, now)
    return verdict


# ── Reads ────────────────────────────────────────────────────────────────────


def _read(cypher: str, params: Mapping[str, Any]) -> list[Record]:
    """Run one read query and materialize its records, or raise a typed error.

    The records are drained inside the session on purpose: a lazily-consumed
    result would surface a driver failure later, in the middle of projection,
    where it would read as a bug rather than as an unavailable backend.
    """
    if not available():
        raise EngineUnavailable("Neo4j graph store is unavailable")
    try:
        driver = _connect()
    except (Neo4jConfigError, Neo4jDriverNotInstalled) as exc:
        raise EngineUnavailable(str(exc)) from exc
    try:
        with driver.session(database=_database()) as session:
            return list(session.run(cypher, dict(params)))
    except Exception as exc:  # noqa: BLE001 - classified below
        reset()  # a failed query invalidates the cached "available" verdict
        raise _classify(exc, "graph read") from exc
    finally:
        driver.close()


def _database() -> str:
    return os.environ.get(DATABASE_ENV) or DEFAULT_DATABASE


def node(csid: str) -> dict[str, Any] | None:
    """One node by ``csid``, or ``None`` when there is no such (visible) node.

    A personal-tier node reads as absent while the tier is disabled — the API
    does not surface a private file by direct lookup either.
    """
    records = _read("MATCH (n {csid: $csid}) RETURN n LIMIT 1", {"csid": csid})
    if not records:
        return None
    projected = project_node(records[0]["n"])
    if not personal_tier_enabled() and is_personal(projected):
        return None
    return projected


def neighborhood(csid: str, depth: int = MIN_DEPTH) -> dict[str, Any] | None:
    """The sub-graph within *depth* hops of *csid*, or ``None`` when it is absent.

    Self-contained: every returned edge has both endpoints in ``nodes``.
    """
    hops = clamp_depth(depth)
    # The depth is clamped to an int above, so inlining it is safe — a
    # variable-length bound cannot be a Cypher parameter. The csid stays one.
    records = _read(
        "MATCH (focus {csid: $csid}) "
        f"OPTIONAL MATCH (focus)-[*1..{hops}]-(reached) "
        "WITH focus, collect(DISTINCT reached) AS reachedNodes "
        "WITH focus, reachedNodes, reachedNodes + focus AS scope "
        "OPTIONAL MATCH (a)-[r]-(b) "
        "WHERE a IN scope AND b IN scope "
        "RETURN focus, reachedNodes, collect(DISTINCT r) AS pathRels",
        {"csid": csid},
    )
    if not records:
        return None
    record = records[0]
    focus = record["focus"]
    if focus is None:
        return None
    root = project_node(focus)
    if not personal_tier_enabled() and is_personal(root):
        return None
    nodes, edges = _project_subgraph(
        [focus, *(record["reachedNodes"] or [])], record["pathRels"] or []
    )
    nodes, edges = gate_personal(nodes, edges)
    return {"root": root, "nodes": nodes, "edges": edges, "depth": hops}


def overview(limit: int = DEFAULT_OVERVIEW_LIMIT) -> dict[str, Any]:
    """A bounded snapshot: the first *limit* nodes plus the edges among them."""
    records = _read(
        "MATCH (n) WITH n LIMIT $limit "
        "WITH collect(n) AS ns "
        "UNWIND ns AS n "
        "OPTIONAL MATCH (n)-[r]->(m) WHERE m IN ns "
        "WITH ns, collect(DISTINCT r) AS rs "
        "RETURN ns AS nodes, rs AS rels",
        {"limit": clamp_overview_limit(limit)},
    )
    if not records:
        return {"nodes": [], "edges": []}
    nodes, edges = _project_subgraph(
        records[0]["nodes"] or [], records[0]["rels"] or []
    )
    nodes, edges = gate_personal(nodes, edges)
    return {"nodes": nodes, "edges": edges}


def cypher(query: str, params: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Run a read-only Cypher query, returning ``{columns, rows}`` of strings.

    The read-only guarantee is the caller's: the route rejects write clauses
    before this is reached, exactly as it did in front of the sidecar console.
    """
    if not available():
        raise EngineUnavailable("Neo4j graph store is unavailable")
    try:
        result = live().run(query, params)
    except (Neo4jConfigError, Neo4jDriverNotInstalled) as exc:
        raise EngineUnavailable(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - classified below
        reset()
        raise _classify(exc, "cypher query") from exc
    return {
        "columns": list(result.columns),
        "rows": [list(row) for row in result.rows],
    }


def retrieve(
    query: str, k: int = DEFAULT_RETRIEVE_K, depth: int = RETRIEVE_DEPTH
) -> dict[str, Any]:
    """Hybrid GraphRAG retrieval: vector top-*k* seeds expanded to *depth* hops.

    Raises :class:`EngineUnavailable` when the embedder or the graph is missing —
    the same degraded answer the sidecar signalled with a 503 and the route
    turned into ``{available: false}``.
    """
    seeds_k = min(max(k, 1), MAX_RETRIEVE_K)
    hops = min(max(depth, 0), MAX_GRAPH_DEPTH)
    handle = retriever()
    if not handle.available():
        raise EngineUnavailable(
            "GraphRAG retrieval is unavailable: a live Neo4j connection and the "
            "sentence-transformers embedding extra are both required."
        )
    try:
        hood = handle.retrieve(query, seeds_k, hops)
    except Exception as exc:  # noqa: BLE001 - retrieval degrades, never 500s
        reset()
        raise EngineUnavailable(
            f"GraphRAG retrieval could not reach the graph: {exc}"
        ) from exc
    return {
        "query": hood.query,
        "available": True,
        "backend": "neo4j",
        "index": hood.index_name,
        "k": hood.k,
        "depth": hood.depth,
        "seeds": [
            {
                "csid": seed.csid,
                "name": seed.name or seed.csid,
                "label": seed.labels[0] if seed.labels else "",
                "labels": list(seed.labels),
                "score": seed.score,
            }
            for seed in hood.seeds
        ],
        "nodes": [
            {
                "csid": item.csid,
                "name": item.name or item.csid,
                "label": item.labels[0] if item.labels else "",
                "labels": list(item.labels),
            }
            for item in hood.nodes
        ],
        "edges": [
            {
                "source": edge.start,
                "target": edge.end,
                "type": edge.type,
                "dimension": dimension_for(edge.type),
            }
            for edge in hood.edges
        ],
    }


# ── Clamping ─────────────────────────────────────────────────────────────────


def clamp_depth(depth: int) -> int:
    """Clamp a requested traversal depth into :data:`MIN_DEPTH`..:data:`MAX_DEPTH`."""
    return min(MAX_DEPTH, max(MIN_DEPTH, int(depth)))


def clamp_overview_limit(limit: int) -> int:
    """Clamp a requested overview node cap into 1..:data:`MAX_OVERVIEW_LIMIT`."""
    return min(MAX_OVERVIEW_LIMIT, max(1, int(limit)))


# ── Projection ───────────────────────────────────────────────────────────────

_JSON_SCALARS = (str, int, float, bool)


def _json_value(value: Any) -> Any:
    """Coerce a driver value into something JSON can carry.

    Neo4j temporal and spatial values have no JSON representation; rendering
    them as their string form keeps a node with a `date` property serialisable
    instead of failing the whole response.
    """
    if value is None or isinstance(value, _JSON_SCALARS):
        return value
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    if isinstance(value, Mapping):
        return {str(key): _json_value(item) for key, item in value.items()}
    return str(value)


def project_node(raw: Node) -> dict[str, Any]:
    """Project a driver node into the API's ``GraphNode`` shape."""
    properties = {key: _json_value(value) for key, value in dict(raw).items()}
    csid = properties.pop("csid", None)
    name = properties.pop("name", None)
    return {
        "csid": csid if isinstance(csid, str) else raw.element_id,
        "labels": list(raw.labels),
        "name": name if isinstance(name, str) else "",
        "properties": properties,
    }


def _endpoint(raw: Node | None, csid_by_element: Mapping[str, str]) -> str:
    """One edge endpoint's csid, falling back to its element id (as the TS did)."""
    if raw is None:
        return ""
    return csid_by_element.get(raw.element_id, raw.element_id)


def project_edge(
    raw: Relationship, csid_by_element: Mapping[str, str]
) -> dict[str, Any]:
    """Project a driver relationship into the API's ``GraphEdge`` shape."""
    properties = {key: _json_value(value) for key, value in dict(raw).items()}
    weight = properties.pop("weight", None)
    edge: dict[str, Any] = {
        "id": raw.element_id,
        "type": raw.type,
        "startCsid": _endpoint(raw.start_node, csid_by_element),
        "endCsid": _endpoint(raw.end_node, csid_by_element),
    }
    if isinstance(weight, (int, float)) and not isinstance(weight, bool):
        edge["weight"] = weight
    edge["properties"] = properties
    return edge


def _project_subgraph(
    raw_nodes: Sequence[Node | None], raw_edges: Sequence[Relationship | None]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Project a node set and keep only the edges internal to it."""
    by_element: dict[str, Node] = {}
    for item in raw_nodes:
        if item is not None:
            by_element[item.element_id] = item
    csid_by_element: dict[str, str] = {}
    nodes: list[dict[str, Any]] = []
    for element_id, item in by_element.items():
        projected = project_node(item)
        csid_by_element[element_id] = projected["csid"]
        nodes.append(projected)
    edges: dict[str, dict[str, Any]] = {}
    for edge in raw_edges:
        if edge is None or edge.start_node is None or edge.end_node is None:
            continue
        if (
            edge.start_node.element_id in by_element
            and edge.end_node.element_id in by_element
        ):
            projected_edge = project_edge(edge, csid_by_element)
            edges[projected_edge["id"]] = projected_edge
    return nodes, list(edges.values())


# ── Personal-tier gate ───────────────────────────────────────────────────────


def personal_tier_enabled(env: Mapping[str, str] | None = None) -> bool:
    """Whether the API may surface personal-tier nodes. Off unless opted in."""
    source = os.environ if env is None else env
    raw = source.get(PERSONAL_TIER_ENV)
    return bool(raw and raw.strip().lower() in _TRUTHY)


def is_personal(projected: Mapping[str, Any]) -> bool:
    """Whether a projected node is personal-tier.

    True when it carries :data:`ASSET_LABEL`, or when any token of its ``source``
    names a registered personal producer — a merged record may carry several
    (``"pinakes;my-files"``), so one match is enough. The producer set is the
    engine's :data:`~pinakes_engine.orchestrate.tiers.PERSONAL_SOURCES`, empty
    until a deployment registers its own adapter.
    """
    labels = projected.get("labels")
    if isinstance(labels, list) and ASSET_LABEL in labels:
        return True
    properties = projected.get("properties")
    source = properties.get("source") if isinstance(properties, Mapping) else None
    if not isinstance(source, str):
        return False
    tokens = {token.strip() for token in source.split(";") if token.strip()}
    return bool(tokens & PERSONAL_SOURCES)


def gate_personal(
    nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Drop personal-tier nodes and any edge touching one, unless opted in."""
    if personal_tier_enabled():
        return nodes, edges
    kept = [item for item in nodes if not is_personal(item)]
    if len(kept) == len(nodes):
        return nodes, edges
    visible = {item["csid"] for item in kept}
    return kept, [
        edge
        for edge in edges
        if edge["startCsid"] in visible and edge["endCsid"] in visible
    ]


# ── Error classification ─────────────────────────────────────────────────────


def _classify(exc: Exception, context: str) -> EngineError:
    """A rejected query is 502; anything else is an unreachable store (503)."""
    client_error = _client_error_type()
    if client_error is not None and isinstance(exc, client_error):
        return EngineFailure(f"{context} was rejected by Neo4j: {exc}")
    return EngineUnavailable(f"{context} could not reach Neo4j: {exc}")


def _client_error_type() -> type[Exception] | None:
    """``neo4j.exceptions.ClientError`` when the driver extra is installed."""
    try:
        from neo4j.exceptions import ClientError
    except ImportError:  # pragma: no cover - only without the neo4j extra
        return None
    return ClientError


__all__ = [
    "ASSET_LABEL",
    "AVAILABILITY_TTL_SECONDS",
    "DEFAULT_OVERVIEW_LIMIT",
    "MAX_DEPTH",
    "MAX_OVERVIEW_LIMIT",
    "MIN_DEPTH",
    "PERSONAL_TIER_ENV",
    "available",
    "clamp_depth",
    "clamp_overview_limit",
    "configure",
    "cypher",
    "gate_personal",
    "is_personal",
    "live",
    "neighborhood",
    "node",
    "overview",
    "personal_tier_enabled",
    "project_edge",
    "project_node",
    "reset",
    "reset_handles",
    "retrieve",
    "retriever",
]
