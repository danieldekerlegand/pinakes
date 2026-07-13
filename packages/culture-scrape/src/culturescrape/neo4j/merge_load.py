"""Offline proof that a built corpus loads into Neo4j *idempotently* (US-004).

The live load leg (:mod:`culturescrape.neo4j.load_csv`) is deliberately
``MERGE``-based — nodes on ``csid``, relationships on ``(:START_ID, :END_ID,
:TYPE)`` — so re-running the same dataset **updates** rather than duplicates. A
merged corpus (native Wikidata dump domains stitched with the LinguaScrape
convergence export) must keep that guarantee: loading it twice has to leave the
graph with the *identical* node/edge counts by label and ``:TYPE``.

Proving that against a live server is expensive and unavailable in CI, but the
guarantee is a pure property of the corpus and the MERGE keys, so it needs no
server: this module replays the exact MERGE semantics into an in-memory graph
(:class:`_MergeGraph`), loads the dataset **twice**, and reports whether the
grouped counts moved on the second load. The counts it returns match the grouped
smoke queries a real load would answer (:mod:`culturescrape.neo4j.counts`): a
node is tallied under **every** label it carries (its type ``:LABEL`` plus the
shared :data:`~culturescrape.neo4j.constraints.ENTITY_LABEL` anchor), so the
``Entity`` tally is the true node total.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from culturescrape.neo4j.constraints import ENTITY_LABEL
from culturescrape.neo4j.counts import CountSummary
from culturescrape.ontology.linker import Edge, Node
from culturescrape.ontology.metrics import read_dataset


def _scalar(row: Node | Edge, key: str) -> str:
    """The first value of *key* in *row* as a plain string (``""`` when absent)."""
    value = row.get(key, "")
    if isinstance(value, list):
        return value[0] if value else ""
    return value


def _labels(node: Node) -> set[str]:
    """Every label *node* carries: its ``:LABEL`` set plus the ``Entity`` anchor."""
    raw = node.get(":LABEL", [])
    values = raw.split(";") if isinstance(raw, str) else list(raw)
    labels = {ENTITY_LABEL}
    labels.update(value for value in values if value)
    return labels


class _MergeGraph:
    """An in-memory property graph that ``MERGE``\\ s on identity, like Neo4j.

    Nodes are keyed on ``csid`` (labels union on a repeat load); edges on
    ``(:START_ID, :END_ID, :TYPE)`` — the exact keys
    :mod:`culturescrape.neo4j.load_csv` merges on — so loading the same dataset
    any number of times leaves the graph unchanged after the first.
    """

    def __init__(self) -> None:
        self._nodes: dict[str, set[str]] = {}
        self._edges: set[tuple[str, str, str]] = set()

    def load(self, nodes: list[Node], edges: list[Edge]) -> None:
        """MERGE every node (on ``csid``) and edge (on start/end/type)."""
        for node in nodes:
            csid = _scalar(node, "csid")
            if not csid:
                continue
            self._nodes.setdefault(csid, set()).update(_labels(node))
        for edge in edges:
            start = _scalar(edge, ":START_ID")
            end = _scalar(edge, ":END_ID")
            etype = _scalar(edge, ":TYPE")
            if not (start and end and etype):
                continue
            self._edges.add((start, end, etype))

    def counts(self) -> CountSummary:
        """Grouped node/edge counts, highest first — the shape a live load answers."""
        labels: Counter[str] = Counter()
        for label_set in self._nodes.values():
            for label in label_set:
                labels[label] += 1
        types: Counter[str] = Counter()
        for _start, _end, etype in self._edges:
            types[etype] += 1
        return CountSummary(
            nodes_by_label=dict(
                sorted(labels.items(), key=lambda kv: (-kv[1], kv[0]))
            ),
            edges_by_type=dict(
                sorted(types.items(), key=lambda kv: (-kv[1], kv[0]))
            ),
        )


@dataclass(frozen=True)
class IdempotencyReport:
    """The outcome of a double MERGE-load of one corpus dataset.

    Attributes:
        counts: Node counts by label and edge counts by ``:TYPE`` after loading.
        idempotent: Whether the second MERGE load changed nothing (the counts
            after one load equal the counts after two).
    """

    counts: CountSummary
    idempotent: bool

    @property
    def node_total(self) -> int:
        """Total distinct nodes (the ``Entity`` anchor's tally)."""
        return self.counts.node_total

    @property
    def edge_total(self) -> int:
        """Total distinct relationships."""
        return self.counts.edge_total


def verify_idempotent_load(dataset_dir: str | Path) -> IdempotencyReport:
    """Load the corpus under *dataset_dir* twice via MERGE and report the counts.

    Reads the ``nodes/`` + ``edges/`` TSV dataset once, MERGE-loads it into a
    fresh in-memory graph, snapshots the grouped counts, MERGE-loads the *same*
    rows a second time, and asserts the counts did not move — the offline
    equivalent of loading into Neo4j and re-running ``LOAD CSV``. Returns an
    :class:`IdempotencyReport` carrying the (idempotent) counts by label/``:TYPE``.
    """
    nodes, edges = read_dataset(dataset_dir)
    graph = _MergeGraph()
    graph.load(nodes, edges)
    first = graph.counts()
    graph.load(nodes, edges)
    second = graph.counts()
    return IdempotencyReport(counts=second, idempotent=first == second)


def verify_upsert_load(
    base_dir: str | Path, delta_dir: str | Path
) -> IdempotencyReport:
    """Prove the *delta_dir* corpus MERGE-loads over *base_dir* idempotently (US-006).

    The incremental path re-hydrates and re-exports only the changed entities into
    a small *delta* corpus, which is then MERGE-loaded on top of the already-loaded
    base corpus. This must leave the graph in a fixed point: because ``csid`` is
    QID-anchored, a re-exported entity lands on the **same** node it already
    occupies (an in-place update, not a duplicate). This replays that exactly —
    load the base, then the delta (the incremental apply), snapshot, apply the
    delta a **second** time, and assert the grouped counts by label/``:TYPE`` did
    not move. The returned counts are the whole graph's after the upsert, so a
    caller can record how the corpus grew.
    """
    base_nodes, base_edges = read_dataset(base_dir)
    delta_nodes, delta_edges = read_dataset(delta_dir)
    graph = _MergeGraph()
    graph.load(base_nodes, base_edges)
    graph.load(delta_nodes, delta_edges)
    first = graph.counts()
    graph.load(delta_nodes, delta_edges)
    second = graph.counts()
    return IdempotencyReport(counts=second, idempotent=first == second)


__all__ = ["IdempotencyReport", "verify_idempotent_load", "verify_upsert_load"]
