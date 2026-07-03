"""Connectivity metrics over a node/edge TSV dataset.

Tasklist 3 turns flat category nodes into a dense network by inferring edges
(``docs/data-model.md``); this module measures whether that linking is actually
working. It reads a dataset directory laid out as ``nodes/<type>.tsv`` /
``edges/<type>.tsv`` (the shape :func:`culturescrape.schema.pipeline.write_result`
emits) and reports:

* **node / edge counts** and **edges-per-node** — the coarse density signal;
* **connected components** — how many disjoint islands the nodes fall into and
  what fraction the largest one holds, so a network that links into one big
  component scores ``largest_component_fraction`` near ``1.0`` while disjoint
  categories score low;
* **edges by dimension and by ``:TYPE``** — which kinds of links carry the
  connectivity, read straight from the formal ontology
  (:mod:`culturescrape.ontology.registry`).

The graph is treated as **undirected** for component analysis: a directed edge
``A -> B`` still merges ``A`` and ``B`` into one component. Components are counted
over the declared node set, so an isolated node is its own component; an edge
endpoint that names no known node cannot conjure a phantom node and is skipped
for the union (it is still counted in the edge totals).

:func:`compute_metrics` does the arithmetic on already-read rows;
:func:`read_dataset` loads a directory; :func:`metrics_for_dataset` ties them
together. :func:`to_json` and :func:`render_summary` produce the machine and the
human view.
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from culturescrape.ontology.linker import Edge, Node
from culturescrape.ontology.registry import get
from culturescrape.schema.headers import SchemaError
from culturescrape.schema.tsvio import Row, TsvError, read_rows

#: Dimension bucket for an edge whose ``:TYPE`` the ontology does not register.
UNKNOWN_DIMENSION = "unknown"

#: Provenance ``source`` id LinguaScrape-origin edges carry (mirrors
#: :data:`culturescrape.acquire.linguascrape.LINGUASCRAPE_SOURCE`). Native edges
#: carry their own source and inferred edges ``inferred:<linker>``, so filtering
#: on this id isolates the edges LinguaScrape contributed to the merged corpus.
LINGUASCRAPE_SOURCE = "linguascrape"


@dataclass(frozen=True)
class GraphMetrics:
    """Connectivity metrics for one dataset.

    Attributes:
        node_count: Number of distinct nodes (declared in the node files).
        edge_count: Number of edge rows.
        edges_per_node: ``edge_count / node_count`` (``0.0`` when there are no
            nodes), the coarse density measure.
        component_count: Number of connected components over the undirected
            graph; an isolated node counts as one component.
        largest_component_size: Node count of the biggest component (``0`` when
            there are no nodes).
        largest_component_fraction: ``largest_component_size / node_count``
            (``0.0`` when there are no nodes) — ``1.0`` means a single component.
        edges_by_dimension: Edge counts keyed by ontology dimension (plus
            :data:`UNKNOWN_DIMENSION` for unregistered types), sorted by key.
        edges_by_type: Edge counts keyed by ``:TYPE``, sorted by key.
    """

    node_count: int
    edge_count: int
    edges_per_node: float
    component_count: int
    largest_component_size: int
    largest_component_fraction: float
    edges_by_dimension: dict[str, int]
    edges_by_type: dict[str, int]


class _UnionFind:
    """Minimal disjoint-set over node csids for component counting."""

    def __init__(self, items: Sequence[str]) -> None:
        self._parent = {item: item for item in items}

    def find(self, item: str) -> str:
        root = item
        while self._parent[root] != root:
            root = self._parent[root]
        # Path compression keeps repeated lookups near-constant.
        while self._parent[item] != root:
            self._parent[item], item = root, self._parent[item]
        return root

    def union(self, a: str, b: str) -> None:
        self._parent[self.find(a)] = self.find(b)

    def component_sizes(self) -> list[int]:
        sizes: Counter[str] = Counter()
        for item in self._parent:
            sizes[self.find(item)] += 1
        return list(sizes.values())


def compute_metrics(nodes: Sequence[Node], edges: Sequence[Edge]) -> GraphMetrics:
    """Compute :class:`GraphMetrics` for *nodes* and *edges* (read-only).

    Components are formed over the ``csid`` set of *nodes*; each edge unions its
    endpoints when both name a known node. Dimension and ``:TYPE`` breakdowns
    cover every edge, with unregistered types bucketed under
    :data:`UNKNOWN_DIMENSION`.
    """
    csids = [csid for node in nodes if (csid := _scalar(node, "csid"))]
    node_count = len(csids)

    union = _UnionFind(csids)
    known = set(csids)
    by_dimension: Counter[str] = Counter()
    by_type: Counter[str] = Counter()
    for edge in edges:
        rel_type = _scalar(edge, ":TYPE")
        by_type[rel_type] += 1
        rel = get(rel_type)
        by_dimension[rel.dimension.value if rel else UNKNOWN_DIMENSION] += 1
        start, end = _scalar(edge, ":START_ID"), _scalar(edge, ":END_ID")
        if start in known and end in known:
            union.union(start, end)

    sizes = union.component_sizes()
    largest = max(sizes, default=0)
    edge_count = len(edges)
    return GraphMetrics(
        node_count=node_count,
        edge_count=edge_count,
        edges_per_node=edge_count / node_count if node_count else 0.0,
        component_count=len(sizes),
        largest_component_size=largest,
        largest_component_fraction=largest / node_count if node_count else 0.0,
        edges_by_dimension=dict(sorted(by_dimension.items())),
        edges_by_type=dict(sorted(by_type.items())),
    )


def read_dataset(directory: str | Path) -> tuple[list[Node], list[Edge]]:
    """Read a dataset *directory* into its node and edge rows.

    Files are classified the way :mod:`culturescrape.schema.validate` classifies
    them: a ``nodes/`` or ``edges/`` parent directory decides, falling back to a
    ``csid:ID`` (node) or ``:START_ID`` (edge) header column. A file that is
    neither is skipped, so a stray ``.tsv`` cannot derail the metrics.
    """
    directory = Path(directory)
    nodes: list[Node] = []
    edges: list[Edge] = []
    for path in sorted(directory.rglob("*.tsv")):
        try:
            columns, rows = read_rows(path)
        except (TsvError, SchemaError):
            continue
        kind = _classify(path, {c.header for c in columns})
        if kind == "node":
            nodes.extend(rows)
        elif kind == "edge":
            edges.extend(rows)
    return nodes, edges


def metrics_for_dataset(directory: str | Path) -> GraphMetrics:
    """Read the dataset under *directory* and compute its :class:`GraphMetrics`."""
    nodes, edges = read_dataset(directory)
    return compute_metrics(nodes, edges)


def nodes_by_label(nodes: Sequence[Node]) -> dict[str, int]:
    """Count *nodes* by their primary ``:LABEL`` (the node type), sorted by label.

    The primary label is a node's first non-empty ``:LABEL`` value — the same
    key :func:`culturescrape.schema.pipeline.write_result` files a node under — so
    this reports one count per canonical node-type file. Nodes with no label are
    skipped (they cannot be filed), mirroring the writer.
    """
    counts: Counter[str] = Counter()
    for node in nodes:
        label = _primary_label(node)
        if label:
            counts[label] += 1
    return dict(sorted(counts.items()))


def edges_by_type_for_source(
    edges: Sequence[Edge], source: str
) -> dict[str, int]:
    """Count *edges* whose provenance ``source`` is *source*, keyed by ``:TYPE``.

    Only edges carrying the exact *source* provenance are counted, so an inferred
    edge (``source='inferred:<linker>'``) or a native edge is excluded. The result
    is sorted by ``:TYPE`` for a stable report.
    """
    counts: Counter[str] = Counter()
    for edge in edges:
        if _scalar(edge, "source") == source:
            counts[_scalar(edge, ":TYPE")] += 1
    return dict(sorted(counts.items()))


def linguascrape_edges_by_type(edges: Sequence[Edge]) -> dict[str, int]:
    """Count the LinguaScrape-origin *edges* by canonical ``:TYPE`` (US-004).

    A thin wrapper over :func:`edges_by_type_for_source` for
    :data:`LINGUASCRAPE_SOURCE` — the report that tells a maintainer how many
    edges of each type LinguaScrape contributed to the merged corpus.
    """
    return edges_by_type_for_source(edges, LINGUASCRAPE_SOURCE)


def dataset_linguascrape_edges_by_type(directory: str | Path) -> dict[str, int]:
    """Read the dataset under *directory* and report its LinguaScrape edges."""
    _, edges = read_dataset(directory)
    return linguascrape_edges_by_type(edges)


def to_json(metrics: GraphMetrics) -> str:
    """Render *metrics* as a stable, indented JSON document."""
    return json.dumps(
        {
            "node_count": metrics.node_count,
            "edge_count": metrics.edge_count,
            "edges_per_node": metrics.edges_per_node,
            "component_count": metrics.component_count,
            "largest_component_size": metrics.largest_component_size,
            "largest_component_fraction": metrics.largest_component_fraction,
            "edges_by_dimension": metrics.edges_by_dimension,
            "edges_by_type": metrics.edges_by_type,
        },
        indent=2,
        sort_keys=False,
    )


def render_summary(metrics: GraphMetrics) -> str:
    """Render *metrics* as a short, human-readable multi-line summary."""
    lines = [
        f"nodes: {metrics.node_count}",
        f"edges: {metrics.edge_count}",
        f"edges/node: {metrics.edges_per_node:.2f}",
        f"components: {metrics.component_count} "
        f"(largest {metrics.largest_component_size}, "
        f"{metrics.largest_component_fraction:.0%} of nodes)",
    ]
    if metrics.edges_by_dimension:
        breakdown = ", ".join(
            f"{dim}={count}" for dim, count in metrics.edges_by_dimension.items()
        )
        lines.append(f"edges by dimension: {breakdown}")
    return "\n".join(lines)


def _classify(path: Path, headers: set[str]) -> str | None:
    """Return ``"node"``, ``"edge"``, or ``None`` for *path* (see validate)."""
    parent = path.parent.name
    if parent == "nodes":
        return "node"
    if parent == "edges":
        return "edge"
    if "csid:ID" in headers:
        return "node"
    if ":START_ID" in headers:
        return "edge"
    return None


def _scalar(row: Row, key: str) -> str:
    """The scalar value at *key*, stripped (a multi-value list is not scalar)."""
    value = row.get(key)
    return value.strip() if isinstance(value, str) else ""


def _primary_label(node: Node) -> str:
    """The node's first non-empty ``:LABEL`` value (its type), or ``""``."""
    labels = node.get(":LABEL")
    if isinstance(labels, list):
        for label in labels:
            if label.strip():
                return label.strip()
    elif isinstance(labels, str) and labels.strip():
        return labels.strip()
    return ""
