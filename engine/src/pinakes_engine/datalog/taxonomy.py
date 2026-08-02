"""Project the Wikidata P279 class taxonomy into ``subclass_of/2`` facts.

The rule library (:mod:`pinakes_engine.datalog.rules`) ships the class-membership
closure ``instance_of(X, C) :- instance_of(X, D), subclass_of(D, C)`` (rules-layer
US-001). The base ``instance_of`` facts already exist — a node's ``:LABEL`` — but
the ``subclass_of`` half is not in the graph: it lives in Wikidata's ``P279``
subclass hierarchy. This module is the boundary that brings it in.

The taxonomy is **small and label-scoped**: its atoms are the corpus's ``:LABEL``
node types (``ArchaeologicalCulture``, ``Culture``, …), not per-entity csids, so a
handful of ``subclass_of(ChildLabel, ParentLabel)`` edges — the *direct* P279
relations among the classes that back those labels — is all it takes. The
recursion in the rule climbs each chain one hop at a time through the derived
``instance_of``, so only direct edges need be stored.

The edges are a **committed, provenanced replay artifact**
(:data:`SUBCLASS_OF_TSV`), the same network-free discipline the acquire scripts
use: :mod:`pinakes_engine.acquire.taxonomy` extracts them from Wikidata (a WDQS
SPARQL query or the on-disk dump index) and writes this TSV; CI reads it back and
never touches the network. Each row carries ``source``/``source_url``/
``retrieved_at``/``confidence`` like every other acquired fact.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path

from pinakes_engine.datalog import Fact
from pinakes_engine.schema.tsvio import open_rows

#: The committed subclass_of replay artifact (label→label P279 edges + provenance).
SUBCLASS_OF_TSV = Path(__file__).resolve().parent / "taxonomy" / "subclass_of.tsv"

#: The columns the artifact carries, in order — a plain provenanced edge table.
SUBCLASS_OF_COLUMNS: tuple[str, ...] = (
    "child",
    "parent",
    "child_qid",
    "parent_qid",
    "source",
    "source_url",
    "retrieved_at",
    "confidence",
)


class TaxonomyError(ValueError):
    """Raised when the subclass_of artifact is malformed."""


@dataclass(frozen=True)
class SubclassEdge:
    """One direct ``subclass_of`` relation between two corpus ``:LABEL`` types.

    *child* is a P279 subclass of *parent*; *child_qid*/*parent_qid* are the
    Wikidata classes that back each label (the provenance of the relation). The
    remaining fields mirror the acquired-fact provenance discipline.
    """

    child: str
    parent: str
    child_qid: str
    parent_qid: str
    source: str
    source_url: str
    retrieved_at: str
    confidence: float

    def as_fact(self) -> Fact:
        """The ``subclass_of(child, parent)`` fact this edge projects to."""
        return Fact("subclass_of", (self.child, self.parent), source=self.source)


def _cell(row: dict[str, str | list[str]], key: str) -> str:
    """The scalar cell at *key* (``""`` if absent), rejecting a list column."""
    value = row.get(key, "")
    if isinstance(value, list):
        raise TaxonomyError(f"column {key!r} is multi-valued, expected a scalar")
    return value


def load_subclass_edges(path: str | Path = SUBCLASS_OF_TSV) -> list[SubclassEdge]:
    """Read the committed subclass_of artifact at *path* into edges.

    Validates that the header carries at least ``child``/``parent`` and parses
    ``confidence`` as a float. A blank ``child`` or ``parent`` is rejected (a
    ``subclass_of`` fact must relate two named classes).
    """
    columns, rows = open_rows(path)
    # The artifact is a plain named-column table (no structural :LABEL columns),
    # so every column carries a `name`; guard for the union type all the same.
    names = {getattr(column, "name", "") for column in columns}
    for required in ("child", "parent"):
        if required not in names:
            raise TaxonomyError(
                f"{path} is missing the {required!r} column "
                f"(have: {', '.join(sorted(names))})"
            )
    edges: list[SubclassEdge] = []
    for row in rows:
        child, parent = _cell(row, "child"), _cell(row, "parent")
        if not child or not parent:
            raise TaxonomyError(f"subclass_of row has a blank child/parent: {row!r}")
        confidence_cell = _cell(row, "confidence")
        try:
            confidence = float(confidence_cell) if confidence_cell else 1.0
        except ValueError as exc:
            raise TaxonomyError(
                f"subclass_of row has a non-numeric confidence {confidence_cell!r}"
            ) from exc
        edges.append(
            SubclassEdge(
                child=child,
                parent=parent,
                child_qid=_cell(row, "child_qid"),
                parent_qid=_cell(row, "parent_qid"),
                source=_cell(row, "source") or "wikidata",
                source_url=_cell(row, "source_url"),
                retrieved_at=_cell(row, "retrieved_at"),
                confidence=confidence,
            )
        )
    return edges


def subclass_facts(edges: Iterable[SubclassEdge]) -> list[Fact]:
    """Project *edges* into ``subclass_of/2`` facts."""
    return [edge.as_fact() for edge in edges]


def subclass_file_facts(path: str | Path = SUBCLASS_OF_TSV) -> Iterator[Fact]:
    """Stream the committed subclass_of artifact at *path* as facts.

    A missing artifact yields nothing (the taxonomy is optional — a graph with no
    ``subclass_of`` edges simply derives no extra ``instance_of`` tuples), so the
    export never fails on its absence.
    """
    file = Path(path)
    if not file.exists():
        return
    yield from subclass_facts(load_subclass_edges(file))


__all__ = [
    "SUBCLASS_OF_COLUMNS",
    "SUBCLASS_OF_TSV",
    "SubclassEdge",
    "TaxonomyError",
    "load_subclass_edges",
    "subclass_facts",
    "subclass_file_facts",
]
