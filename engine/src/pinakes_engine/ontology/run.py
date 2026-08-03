"""Run the whole linker pipeline over a dataset's nodes and edges.

:class:`~pinakes_engine.ontology.linker.Pipeline` threads *edges* through a chain
of linkers, but several linkers also mint nodes (places, periods, languages) or
rewrite an entity (the genetic linker's denormalized copy). The ``pinakes_engine
link`` command needs those node rows written too, or the inferred edges would
reference ``csid``s no node file declares. This module is that orchestration: it
runs each linker's :meth:`~pinakes_engine.ontology.linker.Linker.link_full`,
folds the returned nodes into the dataset **by ``csid``** (a new ``csid`` is
added, an existing one replaced), and stamps each inferred edge's ``source``
exactly as the pipeline does.

Linkers run in the order :func:`~pinakes_engine.ontology.linker.Pipeline.from_registry`
chooses, so each sees the nodes and edges the earlier ones produced and the
inferences compose. The source rows are never mutated — created/updated nodes
are fresh dicts and inferred edges are appended copies.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from pinakes_engine.ontology.linker import (
    DEFAULT_REGISTRY,
    Edge,
    Linker,
    LinkerRegistry,
    Node,
    Pipeline,
    tag_inferred_edge,
)
from pinakes_engine.ontology.registry import Dimension


@dataclass(frozen=True)
class LinkReport:
    """A tally of what one :func:`run_linkers` pass produced.

    Attributes:
        dimensions: The dimension tokens the run linked on, in order.
        linkers: The linker names that ran, in order.
        input_nodes / input_edges: Row counts read from the source dataset.
        output_nodes / output_edges: Row counts after linking.
        created_nodes: Nodes added (a new ``csid`` minted by a linker); the
            genetic linker's in-place rewrites do not count here.
        inferred_edges: Edges the linkers added (``output_edges - input_edges``).
    """

    dimensions: tuple[str, ...]
    linkers: tuple[str, ...]
    input_nodes: int
    input_edges: int
    output_nodes: int
    output_edges: int
    created_nodes: int
    inferred_edges: int


@dataclass(frozen=True)
class LinkRun:
    """The augmented dataset a :func:`run_linkers` pass produced, plus its report."""

    nodes: list[Node]
    edges: list[Edge]
    report: LinkReport


def select_linkers(
    dimensions: Sequence[Dimension] | None = None,
    registry: LinkerRegistry = DEFAULT_REGISTRY,
) -> tuple[Linker, ...]:
    """The linkers to run for *dimensions*, in pipeline order.

    Delegates to :meth:`Pipeline.from_registry` so the ordering — by the given
    dimension sequence, then registration order within each — matches the
    pipeline exactly. With *dimensions* ``None`` every registered linker runs.
    """
    return Pipeline.from_registry(registry, dimensions).linkers


def run_linkers(
    nodes: Sequence[Node],
    edges: Sequence[Edge],
    linkers: Sequence[Linker],
) -> LinkRun:
    """Run *linkers* over *nodes* and *edges*, returning the augmented dataset.

    Each linker's :meth:`~pinakes_engine.ontology.linker.Linker.link_full` runs in
    turn against the dataset built so far: its nodes are merged by ``csid`` (new
    added, existing replaced) and its edges are appended with the
    ``source='inferred:<name>'`` stamp. Inputs are never mutated.
    """
    result_nodes: list[Node] = [dict(node) for node in nodes]
    index: dict[str, int] = {
        csid: i for i, node in enumerate(result_nodes) if (csid := _csid(node))
    }
    result_edges: list[Edge] = [dict(edge) for edge in edges]
    created = 0

    for linker in linkers:
        outcome = linker.link_full(result_nodes, tuple(result_edges))
        for node in outcome.nodes:
            csid = _csid(node)
            if not csid:
                continue
            if csid in index:
                result_nodes[index[csid]] = dict(node)
            else:
                index[csid] = len(result_nodes)
                result_nodes.append(dict(node))
                created += 1
        for edge in outcome.edges:
            result_edges.append(tag_inferred_edge(edge, linker.name))

    report = LinkReport(
        dimensions=tuple(
            dict.fromkeys(linker.dimension.value for linker in linkers)
        ),
        linkers=tuple(linker.name for linker in linkers),
        input_nodes=len(nodes),
        input_edges=len(edges),
        output_nodes=len(result_nodes),
        output_edges=len(result_edges),
        created_nodes=created,
        inferred_edges=len(result_edges) - len(edges),
    )
    return LinkRun(nodes=result_nodes, edges=result_edges, report=report)


def _csid(node: Node) -> str:
    """The node's scalar ``csid`` (a missing or multi-value cell is no key)."""
    value = node.get("csid")
    return value if isinstance(value, str) else ""
