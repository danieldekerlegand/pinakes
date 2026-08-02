"""Anchor node rows to Getty AAT/TGN/ULAN ids by preferred label.

The Getty vocabularies normalize the *kinds* of things a node can be — AAT for
object types/materials/techniques, TGN for places, ULAN for people — so a node
whose name matches a Getty preferred label *of a compatible kind* can carry that
vocabulary's id (``docs/data-model.md``'s ``getty_id`` column). This module
builds that bridge from the local Getty dumps acquired in Tasklist 1.

There is **no live Getty endpoint** to query (see :mod:`pinakes_engine.acquire.getty`),
so anchoring works against an in-memory :class:`GettyIndex` built from the dump
records and keyed by *normalized* preferred label — the same normalization used
to mint name-anchored ids (:func:`pinakes_engine.schema.ids.normalize_name`), so
casing/whitespace/Unicode differences never hide a match.

A match must agree on **label and type**:

* the row's normalized ``name`` equals a Getty entry's normalized label, and
* the row's node type maps (via :data:`DEFAULT_LABEL_VOCABULARY`) to the
  vocabulary that entry came from.

The decision is one of three, and **no false anchor is ever stamped**:

* **matched** — exactly one Getty id survives the label+type filter, so it is
  attached;
* **ambiguous** — two or more distinct Getty ids survive, so none is attached
  (the collision is logged);
* **none** — nothing compatible matched.

:func:`anchor_row` applies a decision to a row, setting ``getty_id`` only on a
match and recording every decision under :data:`ANCHOR_KEY` in the row's overflow
JSON so the choice is auditable.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Collection, Iterable
from dataclasses import dataclass
from enum import Enum
from typing import Any

from pinakes_engine.acquire.records import RawRecord
from pinakes_engine.schema.ids import normalize_name
from pinakes_engine.schema.mapper import OVERFLOW_KEY
from pinakes_engine.schema.tsvio import Row

LOGGER = logging.getLogger("pinakes_engine.schema.anchor")

#: Default mapping of a node ``:LABEL`` to the Getty vocabulary that can anchor
#: it. A row anchors only against vocabularies its labels map to here, so a node
#: of an unmapped kind (e.g. a ``Dish``) simply never anchors — anchoring
#: applies "where applicable". Callers may pass an extended copy.
DEFAULT_LABEL_VOCABULARY: dict[str, str] = {
    "Place": "getty_tgn",
    "Person": "getty_ulan",
    "Material": "getty_aat",
    "Technique": "getty_aat",
    "ObjectType": "getty_aat",
    "Concept": "getty_aat",
    "Type": "getty_aat",
}

#: Reserved key under the row's overflow JSON holding the anchor decision.
ANCHOR_KEY = "getty_anchor"


class AnchorDecision(Enum):
    """The outcome of anchoring one node row against the Getty index."""

    MATCHED = "matched"
    AMBIGUOUS = "ambiguous"
    NONE = "none"


@dataclass(frozen=True)
class GettyEntry:
    """One Getty vocabulary subject: its id, label, vocabulary, and type."""

    getty_id: str
    label: str
    vocabulary: str
    type: str
    uri: str
    lang: str | None = None


@dataclass(frozen=True)
class AnchorResult:
    """An anchor decision and the type-compatible candidates it weighed.

    ``getty_id`` / ``vocabulary`` are set only when ``decision`` is
    :attr:`~AnchorDecision.MATCHED`. ``candidates`` keeps the entries that
    survived the label+type filter so an ambiguous collision is auditable.
    """

    decision: AnchorDecision
    getty_id: str | None
    vocabulary: str | None
    candidates: tuple[GettyEntry, ...]


class GettyIndex:
    """An in-memory Getty index keyed by normalized preferred label.

    Build it once from the dump records acquired in Tasklist 1 (via
    :meth:`from_records`) and reuse it to :meth:`resolve` many node names.
    """

    def __init__(self) -> None:
        self._by_label: dict[str, list[GettyEntry]] = {}

    @classmethod
    def from_records(cls, records: Iterable[RawRecord]) -> GettyIndex:
        """Build an index from Getty dump :class:`RawRecord`\\ s.

        Each record is expected to carry the fields the Getty dump adapter
        emits (``id``, ``name``, ``type``, optional ``lang``) and a provenance
        ``source`` naming the vocabulary. Records without an id or a non-empty
        label are skipped (they cannot be keyed or matched).
        """
        index = cls()
        for record in records:
            entry = _entry_from_record(record)
            if entry is not None:
                index.add(entry)
        return index

    def add(self, entry: GettyEntry) -> None:
        """Index *entry* under its normalized label (a no-op if it is empty)."""
        key = normalize_name(entry.label)
        if not key:
            return
        self._by_label.setdefault(key, []).append(entry)

    def __len__(self) -> int:
        """The number of distinct normalized labels in the index."""
        return len(self._by_label)

    def candidates(self, name: str) -> tuple[GettyEntry, ...]:
        """Return every entry whose normalized label equals *name*'s."""
        return tuple(self._by_label.get(normalize_name(name), ()))

    def resolve(self, name: str, vocabularies: Collection[str]) -> AnchorResult:
        """Resolve *name*, restricted to entries in *vocabularies*.

        Filters the entries sharing *name*'s normalized label to those whose
        vocabulary is acceptable, then decides by how many *distinct* Getty ids
        survive: one is a match, several is ambiguous, none is no match.
        """
        compatible = tuple(
            entry
            for entry in self.candidates(name)
            if entry.vocabulary in vocabularies
        )
        distinct = {entry.getty_id for entry in compatible}
        if not distinct:
            return AnchorResult(AnchorDecision.NONE, None, None, ())
        if len(distinct) > 1:
            return AnchorResult(AnchorDecision.AMBIGUOUS, None, None, compatible)
        chosen = compatible[0]
        return AnchorResult(
            AnchorDecision.MATCHED, chosen.getty_id, chosen.vocabulary, compatible
        )


def _entry_from_record(record: RawRecord) -> GettyEntry | None:
    """Build a :class:`GettyEntry` from a Getty dump record, or ``None``."""
    getty_id = record.fields.get("id", "").strip()
    label = record.fields.get("name", "").strip()
    if not getty_id or not label:
        return None
    lang = record.fields.get("lang")
    return GettyEntry(
        getty_id=getty_id,
        label=label,
        vocabulary=record.provenance.source,
        type=record.fields.get("type", ""),
        uri=record.fields.get("uri", record.provenance.source_url),
        lang=lang.strip() if isinstance(lang, str) and lang.strip() else None,
    )


def anchor_row(
    row: Row,
    index: GettyIndex,
    *,
    label_vocabulary: dict[str, str] = DEFAULT_LABEL_VOCABULARY,
) -> AnchorResult | None:
    """Anchor *row* to a Getty id in place, returning the decision (or ``None``).

    A row that already carries a ``getty_id``, has no ``name`` to match on, or
    whose labels map to no Getty vocabulary is left untouched and ``None`` is
    returned. Otherwise:

    * on a **match** the row's ``getty_id`` is set to the resolved id;
    * on **none** / **ambiguous** the row is left without a ``getty_id`` (an
      ambiguous collision is logged) — no false anchor is ever stamped.

    The decision is recorded under :data:`ANCHOR_KEY` in the row's overflow JSON
    either way.
    """
    existing = row.get("getty_id")
    if isinstance(existing, str) and existing.strip():
        return None
    name = row.get("name")
    if not isinstance(name, str) or not name.strip():
        return None
    vocabularies = _acceptable_vocabularies(row, label_vocabulary)
    if not vocabularies:
        return None

    result = index.resolve(name, vocabularies)
    if result.decision is AnchorDecision.MATCHED and result.getty_id:
        row["getty_id"] = result.getty_id
    elif result.decision is AnchorDecision.AMBIGUOUS:
        LOGGER.warning(
            "ambiguous Getty anchor for %r; skipping (candidates: %s)",
            name,
            sorted({entry.getty_id for entry in result.candidates}),
        )
    _record_decision(row, result)
    return result


def anchor_rows(
    rows: Iterable[Row],
    index: GettyIndex,
    *,
    label_vocabulary: dict[str, str] = DEFAULT_LABEL_VOCABULARY,
) -> list[Row]:
    """Anchor each row in place (see :func:`anchor_row`); return the list."""
    materialized = list(rows)
    for row in materialized:
        anchor_row(row, index, label_vocabulary=label_vocabulary)
    return materialized


def _acceptable_vocabularies(
    row: Row, label_vocabulary: dict[str, str]
) -> frozenset[str]:
    """Return the Getty vocabularies *row*'s labels permit anchoring against."""
    labels = row.get(":LABEL")
    if not isinstance(labels, list):
        return frozenset()
    return frozenset(
        label_vocabulary[label] for label in labels if label in label_vocabulary
    )


def _record_decision(row: Row, result: AnchorResult) -> None:
    """Record the decision under :data:`ANCHOR_KEY` in the overflow JSON."""
    existing = row.get(OVERFLOW_KEY)
    data: dict[str, Any] = {}
    if isinstance(existing, str) and existing:
        loaded = json.loads(existing)
        if isinstance(loaded, dict):
            data = loaded
    record: dict[str, Any] = {
        "decision": result.decision.value,
        "candidates": len(result.candidates),
    }
    if result.getty_id is not None:
        record["getty_id"] = result.getty_id
    if result.vocabulary is not None:
        record["vocabulary"] = result.vocabulary
    data[ANCHOR_KEY] = record
    row[OVERFLOW_KEY] = json.dumps(data, ensure_ascii=False, sort_keys=True)
