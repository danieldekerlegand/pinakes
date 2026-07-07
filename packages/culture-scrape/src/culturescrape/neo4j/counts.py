"""Smoke queries: node counts by label and relationship counts by ``:TYPE``.

Once a corpus is loaded (:mod:`culturescrape.neo4j.load_csv`), the cheapest proof
the graph holds what the corpus manifest claims is a pair of grouped counts —
nodes tallied per label, relationships per ``:TYPE``. This module ships those two
queries as constants (also emitted as documented ``cypher/*.cypher`` smoke files)
and thin driver helpers that run them and decode the result to plain dicts.

Both queries return primitives only (``labels(n)`` / ``type(r)`` and
``count(*)``), so they depend on nothing but the driver cursor and are trivial to
exercise against a mocked driver — no live server is needed in tests. Because
every node carries the shared
:data:`~culturescrape.neo4j.constraints.ENTITY_LABEL` anchor, its row in
:func:`node_counts_by_label` equals the total node count, a handy invariant to
check against the corpus manifest.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from culturescrape.neo4j import connect
from culturescrape.neo4j.constraints import ENTITY_LABEL

if TYPE_CHECKING:
    from neo4j import Driver

#: Cypher tallying every node under each label it carries, highest count first.
NODE_COUNT_QUERY = (
    "MATCH (n)\n"
    "UNWIND labels(n) AS label\n"
    "RETURN label AS label, count(*) AS count\n"
    "ORDER BY count DESC, label"
)

#: Cypher tallying relationships by ``:TYPE``, highest count first.
EDGE_COUNT_QUERY = (
    "MATCH ()-[r]->()\n"
    "RETURN type(r) AS type, count(*) AS count\n"
    "ORDER BY count DESC, type"
)


@dataclass(frozen=True)
class CountSummary:
    """Grouped node/edge counts read back from a loaded graph."""

    nodes_by_label: dict[str, int]
    edges_by_type: dict[str, int]

    @property
    def node_total(self) -> int:
        """Total node count — the shared ``Entity`` anchor's tally, or the sum.

        Every node carries the ``Entity`` label, so its per-label count is the
        true node total (labels overlap, so summing ``nodes_by_label`` would
        double-count multi-label nodes). Falls back to the ``Entity`` tally being
        absent only for an empty graph.
        """
        return self.nodes_by_label.get(ENTITY_LABEL, 0)

    @property
    def edge_total(self) -> int:
        """Total relationship count (types never overlap, so the sum is exact)."""
        return sum(self.edges_by_type.values())


def node_counts_by_label(driver: Driver) -> dict[str, int]:
    """Run :data:`NODE_COUNT_QUERY` against *driver*, decoded to ``{label: count}``."""
    with driver.session() as session:
        return {
            str(record["label"]): int(record["count"])
            for record in session.run(NODE_COUNT_QUERY)
        }


def edge_counts_by_type(driver: Driver) -> dict[str, int]:
    """Run :data:`EDGE_COUNT_QUERY` against *driver*, decoded to ``{type: count}``."""
    with driver.session() as session:
        return {
            str(record["type"]): int(record["count"])
            for record in session.run(EDGE_COUNT_QUERY)
        }


def count_summary(
    config: Mapping[str, Any] | None = None,
    *,
    env: Mapping[str, str] | None = None,
    driver: Driver | None = None,
) -> CountSummary:
    """Read node/edge counts by type from a connected Neo4j graph.

    Runs both smoke queries in one session and returns a :class:`CountSummary`.
    When *driver* is given it is used as-is (left open for the caller); otherwise
    a driver is opened from *config*/*env* via
    :func:`culturescrape.neo4j.connect` and closed before returning.
    """
    owned = driver is None
    handle = connect(config, env=env) if driver is None else driver
    try:
        with handle.session() as session:
            nodes = {
                str(record["label"]): int(record["count"])
                for record in session.run(NODE_COUNT_QUERY)
            }
            edges = {
                str(record["type"]): int(record["count"])
                for record in session.run(EDGE_COUNT_QUERY)
            }
    finally:
        if owned:
            handle.close()
    return CountSummary(nodes_by_label=nodes, edges_by_type=edges)


__all__ = [
    "EDGE_COUNT_QUERY",
    "NODE_COUNT_QUERY",
    "CountSummary",
    "count_summary",
    "edge_counts_by_type",
    "node_counts_by_label",
]
