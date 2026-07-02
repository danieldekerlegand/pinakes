"""The genetic linker: ``DERIVED_FROM`` / ``INFLUENCED_BY`` / ``VARIANT_OF``.

Turns the genetic dimension of the canonical schema (``docs/data-model.md``) into
edges so the network is navigable by cultural lineage — how a dish, style, or
artifact *descends from*, is *influenced by*, or is a *variant of* an earlier one.
*"Genetic" here means cultural derivation, not biology* (see
``docs/sources-genetic.md``). The source chosen in US-007 is Wikidata's derivation
statements, so an entity node references its ancestor / influence / canonical form
by QID through the cells this linker reads (``derived_from_qid`` for ``P144`` *based
on*, ``influenced_by_qid`` for ``P737`` *influenced by*, ``variant_of_qid`` for the
``P279`` *subclass of* expression of *variant of*).

Unlike the geographic / temporal / linguistic linkers, this one **never creates a
target node**: cultural-lineage references point at items that may be outside the
catalogue, so a reference whose endpoint is not already in the node set is *skipped*
and counted (the count is logged), not materialised as a stub. Given the node and
edge sets the linker:

* resolves each entity's derivation references (by Wikidata QID, or by ``csid`` when
  the reference is already a resolved pointer) against the **existing** node set and
  emits **``DERIVED_FROM``** / **``INFLUENCED_BY``** / **``VARIANT_OF``**
  (``VARIANT_OF`` is symmetric, so one canonical ``csid``-ordered edge per pair);
* populates the denormalized **``derived_from_csid``** convenience column
  (``docs/data-model.md``) on an entity that resolves to exactly one ancestor and
  does not already carry the pointer — the "single primary ancestor" case.

The denormalization rewrites existing nodes rather than creating new ones, which the
:class:`~culturescrape.ontology.linker.Linker` contract (edges only) does not return,
so the full result — updated node copies, edges, and the skipped count — is exposed
through :meth:`GeneticLinker.link_genetic`; :meth:`link` satisfies the pipeline
interface by returning just that result's edges.
"""

from __future__ import annotations

import logging
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
from culturescrape.schema.ids import IdError, normalize_qid

LOGGER = logging.getLogger("culturescrape.ontology.genetic")

#: The denormalized cell holding a node's single primary ancestor
#: (``docs/data-model.md``).
DERIVED_FROM_COLUMN = "derived_from_csid"


class _Emit(Protocol):
    """The callback the derivation passes add an inferred edge with."""

    def __call__(
        self, start: str, end: str, rel: str, confidence: float
    ) -> None: ...


def _scalar(row: Node | Edge, key: str) -> str:
    """Return *row*'s scalar cell for *key*, or ``""`` if missing or multi-value."""
    value = row.get(key)
    return value if isinstance(value, str) else ""


def _multi(row: Node | Edge, key: str) -> list[str]:
    """Return *row*'s cell for *key* as a list (tolerating a scalar or missing)."""
    value = row.get(key)
    if isinstance(value, list):
        return [v for v in value if v]
    if isinstance(value, str) and value:
        return [value]
    return []


@dataclass(frozen=True)
class GeneticResult:
    """The genetic linker's full output: updated nodes, edges, and skips.

    *nodes* are **copies of input entity nodes** that gained a
    ``derived_from_csid`` pointer (they *replace* their originals, they are not
    additions like the other linkers' created nodes); *edges* are the
    ``DERIVED_FROM`` / ``INFLUENCED_BY`` / ``VARIANT_OF`` edges. *skipped* counts
    derivation references whose target was not in the node set. The edges carry
    ``confidence`` but not ``source`` — when run through the pipeline that tag is
    stamped from the linker name; callers using :meth:`GeneticLinker.link`
    directly get the same untagged edges.
    """

    nodes: list[Node]
    edges: list[Edge]
    skipped: int


class GeneticLinker(Linker):
    """Infers cultural-lineage edges between nodes already in the set.

    Configuration:

    * *derived_from_field* / *influenced_by_field* / *variant_of_field* — the
      entity cells naming its ancestor (``P144``), influence (``P737``), and
      canonical form (``P279``) by Wikidata QID or by ``csid``;
    * *derived_confidence* / *influenced_confidence* / *variant_confidence* — the
      confidence stamped on each kind of inferred edge (a ``based on`` statement is
      a stronger signal than a ``subclass of``-inferred variant).
    """

    name: ClassVar[str] = "genetic"
    dimension: ClassVar[Dimension] = Dimension.GENETIC

    def __init__(
        self,
        *,
        derived_from_field: str = "derived_from_qid",
        influenced_by_field: str = "influenced_by_qid",
        variant_of_field: str = "variant_of_qid",
        derived_confidence: float = 0.9,
        influenced_confidence: float = 0.8,
        variant_confidence: float = 0.85,
    ) -> None:
        self.derived_from_field = derived_from_field
        self.influenced_by_field = influenced_by_field
        self.variant_of_field = variant_of_field
        self.derived_confidence = derived_confidence
        self.influenced_confidence = influenced_confidence
        self.variant_confidence = variant_confidence

    def link(self, nodes: Sequence[Node], edges: Sequence[Edge]) -> list[Edge]:
        """Return the inferred edges only (the :class:`Linker` contract)."""
        return self.link_genetic(nodes, edges).edges

    def link_full(
        self, nodes: Sequence[Node], edges: Sequence[Edge]
    ) -> LinkResult:
        """Return the inferred edges plus the denormalized entity copies.

        The genetic linker's nodes share their ``csid`` with an input node, so
        :func:`~culturescrape.ontology.run.run_linkers` folds them in by
        *replacing* the original rather than adding a duplicate.
        """
        result = self.link_genetic(nodes, edges)
        return LinkResult(edges=result.edges, nodes=result.nodes)

    def link_genetic(
        self, nodes: Sequence[Node], edges: Sequence[Edge]
    ) -> GeneticResult:
        """Infer genetic edges and denormalize ancestors from *nodes* and *edges*."""
        # Index existing nodes by the identifiers a reference names them with, so a
        # reference resolves to a node already in the set — and *only* such a node:
        # a miss is skipped, never materialised as a stub.
        by_qid: dict[str, str] = {}
        known_csids: set[str] = set()
        for node in nodes:
            if csid := _scalar(node, "csid"):
                known_csids.add(csid)
            if qid := self._norm_qid(_scalar(node, "wikidata_qid")):
                by_qid[qid] = csid

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

        updated: list[Node] = []
        skipped = 0
        for node in nodes:
            source = _scalar(node, "csid")
            if not source:
                continue
            ancestors, miss = self._resolve(
                node, self.derived_from_field, by_qid, known_csids
            )
            skipped += miss
            for target in ancestors:
                emit(source, target, "DERIVED_FROM", self.derived_confidence)
            influences, miss = self._resolve(
                node, self.influenced_by_field, by_qid, known_csids
            )
            skipped += miss
            for target in influences:
                emit(source, target, "INFLUENCED_BY", self.influenced_confidence)
            variants, miss = self._resolve(
                node, self.variant_of_field, by_qid, known_csids
            )
            skipped += miss
            for target in variants:
                emit_symmetric(source, target, "VARIANT_OF", self.variant_confidence)
            if (denorm := self._denormalize(node, source, ancestors)) is not None:
                updated.append(denorm)

        if skipped:
            LOGGER.info(
                "genetic linker skipped %d derivation reference(s) whose endpoint "
                "is not in the node set",
                skipped,
            )
        return GeneticResult(nodes=updated, edges=result_edges, skipped=skipped)

    def _resolve(
        self,
        node: Node,
        field: str,
        by_qid: dict[str, str],
        known_csids: set[str],
    ) -> tuple[list[str], int]:
        """Resolve *node*'s *field* references to node ``csid``s already in the set.

        Returns the distinct resolved ``csid``s and the count of references that
        did *not* resolve (their endpoint is outside the node set, so they are
        skipped rather than emitted).
        """
        targets: list[str] = []
        skipped = 0
        for raw in _multi(node, field):
            target = self._resolve_ref(raw, by_qid, known_csids)
            if target is None:
                skipped += 1
            elif target not in targets:
                targets.append(target)
        return targets, skipped

    @staticmethod
    def _resolve_ref(
        raw: str, by_qid: dict[str, str], known_csids: set[str]
    ) -> str | None:
        """Resolve one reference (a ``csid`` or a Wikidata QID) to a node ``csid``."""
        if raw in known_csids:
            return raw
        try:
            qid = normalize_qid(raw)
        except IdError:
            return None
        return by_qid.get(qid)

    def _denormalize(
        self, node: Node, source: str, ancestors: Sequence[str]
    ) -> Node | None:
        """Return a copy of *node* carrying its single primary ancestor, else ``None``.

        The ``derived_from_csid`` column is only populated when the entity has
        exactly one resolved ancestor (a single primary) and does not already carry
        the pointer — an existing value is authoritative and left untouched, and an
        ambiguous (multiple) or absent ancestor leaves the column blank.
        """
        if _scalar(node, DERIVED_FROM_COLUMN):
            return None
        primaries = [csid for csid in ancestors if csid != source]
        if len(primaries) != 1:
            return None
        return {**node, DERIVED_FROM_COLUMN: primaries[0]}

    @staticmethod
    def _norm_qid(value: str) -> str | None:
        """Normalize a QID cell to ``Q<number>``, or ``None`` if not a QID."""
        if not value:
            return None
        try:
            return normalize_qid(value)
        except IdError:
            return None


#: Register a default-config genetic linker into the process-wide registry.
DEFAULT_REGISTRY.register(GeneticLinker())
