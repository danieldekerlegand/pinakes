"""The temporal linker: PART_OF_PERIOD (plus deterministic period nodes).

Turns the temporal dimension of the canonical schema (``docs/data-model.md``) into
the one temporal relation that is *not* derivable arithmetically: it resolves each
entity's ``period`` cell to a **period node**, *reusing* an existing period of that
name or *creating* a minimal one, and links the entity to it with
**``PART_OF_PERIOD``**. Period creation is idempotent: a period ``csid`` is minted
deterministically from its name, so the same name always resolves to one node.

**Pairwise temporal edges are no longer materialised (T-SR-US-001).** This linker
once compared every co-dated pair and emitted ``CONTEMPORARY_WITH`` / ``PRECEDES``
/ ``FOLLOWS`` — a *quadratic* explosion that produced 5.57M of the corpus's 5.58M
edges at just 6.7k nodes (≈10^12 at Wikidata scale). Those three relations are now
derived **on demand** from the ``time_start/2`` and ``time_end/2`` facts every node
projects, as arithmetic Datalog rules (``datalog/rules.py``: ``contemporary``,
``precedes``, ``follows``). So the linker emits *only* ``PART_OF_PERIOD`` now; the
temporal ordering/overlap of dated entities is answered by loading the rule-bearing
graph into an engine, not by walking millions of stored edges.

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
    """The callback the period pass adds an inferred edge with."""

    def __call__(
        self, start: str, end: str, rel: str, confidence: float
    ) -> None: ...


#: The ``:LABEL`` token a period node carries.
PERIOD_LABEL = "Period"


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


@dataclass(frozen=True)
class TemporalResult:
    """The temporal linker's full output: new period nodes plus inferred edges.

    *periods* are the period nodes the linker had to create (reused periods are
    already in the input and are not repeated here); *edges* are the
    ``PART_OF_PERIOD`` edges. (``CONTEMPORARY_WITH`` / ``PRECEDES`` / ``FOLLOWS``
    are no longer materialised — they are derived on demand by the arithmetic
    Datalog rules; see the module docstring.) The edges carry ``confidence`` but
    not ``source`` — when run through the pipeline that tag is stamped from the
    linker name; callers using :meth:`TemporalLinker.link` directly get the same
    untagged edges.
    """

    periods: list[Node]
    edges: list[Edge]


class TemporalLinker(Linker):
    """Mints period nodes and their ``PART_OF_PERIOD`` edges.

    Configuration:

    * *period_confidence* — the confidence stamped on each inferred
      ``PART_OF_PERIOD`` edge (and on a period node the linker creates).
    """

    name: ClassVar[str] = "temporal"
    dimension: ClassVar[Dimension] = Dimension.TEMPORAL

    def __init__(
        self,
        *,
        period_confidence: float = 0.9,
    ) -> None:
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
        """Resolve periods from *nodes*, minting ``PART_OF_PERIOD`` edges.

        Pairwise contemporary/precedes/follows edges are *not* emitted — those
        relations are derived on demand by the arithmetic Datalog rules over the
        ``time_start`` / ``time_end`` facts (see the module docstring).
        """
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

        periods = self._link_periods(nodes, emit)
        return TemporalResult(periods=periods, edges=result_edges)

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


#: Register a default-config temporal linker into the process-wide registry.
DEFAULT_REGISTRY.register(TemporalLinker())
