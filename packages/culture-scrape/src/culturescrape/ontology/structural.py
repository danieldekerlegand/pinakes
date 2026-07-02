"""The structural linker: ``PART_OF`` / ``USES``.

Turns the structural dimension's composition statements (``docs/data-model.md``)
into edges so the network is navigable by part-whole containment and by what an
entity is built or played *with* — the relationships the corpus-expansion domains
need (a component within a machine, a garment within an ensemble, a ritual within
a festival, a game's equipment, a craft's tools). The source is Wikidata's
composition statements: an entity node references its enclosing whole or the
instrument it uses by QID through the cells this linker reads (``part_of_qid`` for
``P361`` *part of*, ``uses_qid`` for ``P2283`` *uses*).

Like the genetic linker, this one **never creates a target node**: composition
references can point at items outside the catalogue, so a reference whose endpoint
is not already in the node set is *skipped* and counted (the count is logged), not
materialised as a stub. Given the node and edge sets the linker resolves each
entity's references (by Wikidata QID, or by ``csid`` when the reference is already
a resolved pointer) against the **existing** node set and emits **``PART_OF``**
(transitive — the rules layer materialises ``component_of/2``) and **``USES``**.
Both are directed; neither is symmetric, so each is emitted once per reference.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import ClassVar

from culturescrape.ontology.linker import (
    DEFAULT_REGISTRY,
    Edge,
    Linker,
    Node,
    inferred_edge,
)
from culturescrape.ontology.registry import Dimension
from culturescrape.schema.ids import IdError, normalize_qid

LOGGER = logging.getLogger("culturescrape.ontology.structural")


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
class StructuralResult:
    """The structural linker's output: inferred edges plus the skip count.

    *edges* are the ``PART_OF`` / ``USES`` edges, carrying ``confidence`` but not
    ``source`` — when run through the pipeline that tag is stamped from the linker
    name. *skipped* counts composition references whose target was not in the node
    set.
    """

    edges: list[Edge]
    skipped: int


class StructuralLinker(Linker):
    """Infers part-whole and usage edges between nodes already in the set.

    Configuration:

    * *part_of_field* / *uses_field* — the entity cells naming its enclosing whole
      (``P361``) and the instrument/material/technique it uses (``P2283``) by
      Wikidata QID or by ``csid``;
    * *part_of_confidence* / *uses_confidence* — the confidence stamped on each
      kind of inferred edge (an explicit composition statement is a strong signal).
    """

    name: ClassVar[str] = "structural"
    dimension: ClassVar[Dimension] = Dimension.STRUCTURAL

    def __init__(
        self,
        *,
        part_of_field: str = "part_of_qid",
        uses_field: str = "uses_qid",
        part_of_confidence: float = 0.9,
        uses_confidence: float = 0.85,
    ) -> None:
        self.part_of_field = part_of_field
        self.uses_field = uses_field
        self.part_of_confidence = part_of_confidence
        self.uses_confidence = uses_confidence

    def link(self, nodes: Sequence[Node], edges: Sequence[Edge]) -> list[Edge]:
        """Return the inferred edges only (the :class:`Linker` contract)."""
        return self.link_structural(nodes, edges).edges

    def link_structural(
        self, nodes: Sequence[Node], edges: Sequence[Edge]
    ) -> StructuralResult:
        """Infer ``PART_OF`` / ``USES`` edges from *nodes* and *edges*."""
        # Index existing nodes by the identifiers a reference names them with, so a
        # reference resolves only to a node already in the set: a miss is skipped,
        # never materialised as a stub.
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

        skipped = 0
        for node in nodes:
            source = _scalar(node, "csid")
            if not source:
                continue
            wholes, miss = self._resolve(
                node, self.part_of_field, by_qid, known_csids
            )
            skipped += miss
            for target in wholes:
                emit(source, target, "PART_OF", self.part_of_confidence)
            instruments, miss = self._resolve(
                node, self.uses_field, by_qid, known_csids
            )
            skipped += miss
            for target in instruments:
                emit(source, target, "USES", self.uses_confidence)

        if skipped:
            LOGGER.info(
                "structural linker skipped %d composition reference(s) whose "
                "endpoint is not in the node set",
                skipped,
            )
        return StructuralResult(edges=result_edges, skipped=skipped)

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

    @staticmethod
    def _norm_qid(value: str) -> str | None:
        """Normalize a QID cell to ``Q<number>``, or ``None`` if not a QID."""
        if not value:
            return None
        try:
            return normalize_qid(value)
        except IdError:
            return None


#: Register a default-config structural linker into the process-wide registry.
DEFAULT_REGISTRY.register(StructuralLinker())
