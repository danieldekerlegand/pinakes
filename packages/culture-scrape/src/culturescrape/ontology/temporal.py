"""The temporal linker: CONTEMPORARY_WITH / PRECEDES / FOLLOWS / PART_OF_PERIOD.

Turns the temporal dimension of the canonical schema (``docs/data-model.md``) into
edges so the network is navigable in time. Given the node and edge sets it:

* compares entities with a known span (``time_start`` / ``time_end``) pairwise and
  emits **``CONTEMPORARY_WITH``** when their spans overlap by at least a configurable
  ``min_overlap_years``; a node carrying only one bound is treated as an instant at
  that year. The edge is symmetric, so a single canonical (``csid``-ordered) edge is
  emitted per pair;
* emits **``PRECEDES``** / **``FOLLOWS``** for two entities whose spans are disjoint
  (one ends strictly before the other begins) — the earlier entity ``PRECEDES`` the
  later, the later ``FOLLOWS`` the earlier;
* resolves each entity's ``period`` cell to a **period node**, *reusing* an existing
  period of that name or *creating* a minimal one, and links the entity to it with
  **``PART_OF_PERIOD``**. Period creation is idempotent: a period ``csid`` is minted
  deterministically from its name, so the same name always resolves to one node.

The pairwise comparisons are *quadratic*, so the linker guards against combinatorial
explosion by only comparing entities that **share a facet** — the values of the
configurable *facet_fields* (by default the node label and containing place). Set
*widen* to compare every entity against every other regardless of facet.

Period creation needs more than the :class:`~culturescrape.ontology.linker.Linker`
contract returns (which is edges only), so the full result — new period nodes *and*
edges — is exposed through :meth:`TemporalLinker.link_temporal`; :meth:`link`
satisfies the pipeline interface by returning just that result's edges.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import ClassVar, Protocol

from culturescrape.ontology.linker import (
    DEFAULT_REGISTRY,
    Edge,
    Linker,
    LinkResult,
    Node,
    inferred_edge,
)
from culturescrape.ontology.registry import Dimension
from culturescrape.schema.ids import mint_csid


class _Emit(Protocol):
    """The callback the span/period passes add an inferred edge with."""

    def __call__(
        self, start: str, end: str, rel: str, confidence: float
    ) -> None: ...


#: The ``:LABEL`` token a period node carries.
PERIOD_LABEL = "Period"

#: Facet fields entities must agree on before they are compared pairwise.
DEFAULT_FACET_FIELDS = (":LABEL", "place_qid")


def _scalar(row: Node | Edge, key: str) -> str:
    """Return *row*'s scalar cell for *key*, or ``""`` if missing or multi-value."""
    value = row.get(key)
    return value if isinstance(value, str) else ""


def _labels(node: Node) -> list[str]:
    """Return *node*'s ``:LABEL`` tokens (tolerating a scalar or missing cell)."""
    value = node.get(":LABEL")
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value:
        return [value]
    return []


def _span(node: Node) -> tuple[int, int] | None:
    """Return *node*'s ``(start, end)`` years, or ``None`` if it has no span.

    A node with only one bound is an instant at that year; a reversed span
    (``time_start`` after ``time_end``) is normalised to ``(min, max)``.
    """
    start_cell, end_cell = _scalar(node, "time_start"), _scalar(node, "time_end")
    bounds = [cell for cell in (start_cell, end_cell) if cell]
    if not bounds:
        return None
    try:
        years = [int(cell) for cell in bounds]
    except ValueError:
        return None
    return min(years), max(years)


def _facet_value(node: Node, field: str) -> str:
    """A node's value for one facet *field*, flattened to a stable string."""
    value = node.get(field)
    if isinstance(value, list):
        return ";".join(value)
    return value if isinstance(value, str) else ""


@dataclass(frozen=True)
class TemporalResult:
    """The temporal linker's full output: new period nodes plus inferred edges.

    *periods* are the period nodes the linker had to create (reused periods are
    already in the input and are not repeated here); *edges* are the
    ``CONTEMPORARY_WITH`` / ``PRECEDES`` / ``FOLLOWS`` / ``PART_OF_PERIOD`` edges.
    The edges carry ``confidence`` but not ``source`` — when run through the
    pipeline that tag is stamped from the linker name; callers using
    :meth:`TemporalLinker.link` directly get the same untagged edges.
    """

    periods: list[Node]
    edges: list[Edge]


class TemporalLinker(Linker):
    """Infers temporal edges, creating period nodes as needed.

    Configuration:

    * *min_overlap_years* — the least overlap (in years) two spans must share to
      count as ``CONTEMPORARY_WITH``; spans overlapping by less are neither
      contemporary nor disjoint, so they get no edge;
    * *facet_fields* — the node cells entities must agree on before they are
      compared pairwise, the guard against combinatorial explosion (by default the
      node label and containing place);
    * *widen* — compare every entity against every other, ignoring *facet_fields*;
    * *contemporary_confidence* / *ordering_confidence* / *period_confidence* —
      the confidence stamped on each kind of inferred edge.
    """

    name: ClassVar[str] = "temporal"
    dimension: ClassVar[Dimension] = Dimension.TEMPORAL

    def __init__(
        self,
        *,
        min_overlap_years: float = 0.0,
        facet_fields: Sequence[str] = DEFAULT_FACET_FIELDS,
        widen: bool = False,
        contemporary_confidence: float = 0.7,
        ordering_confidence: float = 0.8,
        period_confidence: float = 0.9,
    ) -> None:
        if min_overlap_years < 0:
            raise ValueError(
                f"min_overlap_years must be non-negative, got {min_overlap_years!r}"
            )
        self.min_overlap_years = min_overlap_years
        self.facet_fields = tuple(facet_fields)
        self.widen = widen
        self.contemporary_confidence = contemporary_confidence
        self.ordering_confidence = ordering_confidence
        self.period_confidence = period_confidence

    def link(self, nodes: Sequence[Node], edges: Sequence[Edge]) -> list[Edge]:
        """Return the inferred edges only (the :class:`Linker` contract)."""
        return self.link_temporal(nodes, edges).edges

    def link_full(
        self, nodes: Sequence[Node], edges: Sequence[Edge]
    ) -> LinkResult:
        """Return the inferred edges plus the period nodes the linker created."""
        result = self.link_temporal(nodes, edges)
        return LinkResult(edges=result.edges, nodes=result.periods)

    def link_temporal(
        self, nodes: Sequence[Node], edges: Sequence[Edge]
    ) -> TemporalResult:
        """Infer temporal edges and resolve periods from *nodes* and *edges*."""
        emitted: set[tuple[str, str, str]] = {
            (_scalar(e, ":START_ID"), _scalar(e, ":END_ID"), _scalar(e, ":TYPE"))
            for e in edges
        }
        result_edges: list[Edge] = []

        def emit(start: str, end: str, rel: str, confidence: float) -> None:
            key = (start, end, rel)
            if start and end and start != end and key not in emitted:
                emitted.add(key)
                result_edges.append(inferred_edge(start, end, rel, confidence))

        def emit_symmetric(start: str, end: str, rel: str, confidence: float) -> None:
            lo, hi = sorted((start, end))
            if (hi, lo, rel) not in emitted:
                emit(lo, hi, rel, confidence)

        self._link_spans(nodes, emit, emit_symmetric)
        periods = self._link_periods(nodes, emit)
        return TemporalResult(periods=periods, edges=result_edges)

    def _link_spans(
        self,
        nodes: Sequence[Node],
        emit: _Emit,
        emit_symmetric: _Emit,
    ) -> None:
        """Emit overlap and ordering edges between entities that share a facet."""
        # Collect (csid, start, end) for every node carrying a span, grouped by the
        # facet so only entities in the same facet are compared pairwise — the
        # quadratic work stays bounded to each facet unless *widen* collapses them.
        facets: dict[tuple[str, ...], list[tuple[str, int, int]]] = {}
        for node in nodes:
            csid = _scalar(node, "csid")
            span = _span(node)
            if not csid or span is None:
                continue
            key = self._facet_key(node)
            facets.setdefault(key, []).append((csid, span[0], span[1]))

        for members in facets.values():
            ordered = sorted(members)
            for i, (csid_a, start_a, end_a) in enumerate(ordered):
                for csid_b, start_b, end_b in ordered[i + 1 :]:
                    overlap = min(end_a, end_b) - max(start_a, start_b)
                    if overlap >= self.min_overlap_years:
                        emit_symmetric(
                            csid_a,
                            csid_b,
                            "CONTEMPORARY_WITH",
                            self.contemporary_confidence,
                        )
                    elif end_a < start_b:
                        emit(csid_a, csid_b, "PRECEDES", self.ordering_confidence)
                        emit(csid_b, csid_a, "FOLLOWS", self.ordering_confidence)
                    elif end_b < start_a:
                        emit(csid_b, csid_a, "PRECEDES", self.ordering_confidence)
                        emit(csid_a, csid_b, "FOLLOWS", self.ordering_confidence)

    def _link_periods(self, nodes: Sequence[Node], emit: _Emit) -> list[Node]:
        """Link entities to their named period, creating period nodes idempotently."""
        existing: set[str] = {
            _scalar(node, "csid")
            for node in nodes
            if PERIOD_LABEL in _labels(node)
        }
        created: dict[str, Node] = {}
        for node in nodes:
            source = _scalar(node, "csid")
            period_name = _scalar(node, "period")
            if not source or not period_name:
                continue
            period_csid = mint_csid("period", name=period_name)
            if period_csid == source:
                continue
            if period_csid not in existing and period_csid not in created:
                created[period_csid] = {
                    "csid": period_csid,
                    ":LABEL": [PERIOD_LABEL],
                    "name": period_name,
                    "period": period_name,
                    "source": f"inferred:{self.name}",
                    "confidence": str(self.period_confidence),
                }
            emit(source, period_csid, "PART_OF_PERIOD", self.period_confidence)
        return list(created.values())

    def _facet_key(self, node: Node) -> tuple[str, ...]:
        """The facet a node belongs to (a single shared facet when *widen*)."""
        if self.widen:
            return ()
        return tuple(_facet_value(node, field) for field in self.facet_fields)


#: Register a default-config temporal linker into the process-wide registry.
DEFAULT_REGISTRY.register(TemporalLinker())
