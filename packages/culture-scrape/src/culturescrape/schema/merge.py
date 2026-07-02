"""Collapse duplicate node rows so the graph has one node per real-world thing.

Acquisition draws the *same* entity from many sources, and even after QID
reconciliation (:mod:`culturescrape.schema.reconcile`) and Getty anchoring
(:mod:`culturescrape.schema.anchor`) two rows can still describe one thing. This
module clusters those duplicates and merges each cluster down to a single
canonical row.

Two rows are judged to be the same thing by a strict **precedence** of signals
(``docs/data-model.md``), strongest first:

#. identical ``wikidata_qid`` — the QID *is* the identity;
#. identical ``getty_id`` — a shared Getty subject;
#. exact normalized ``(name, lang, type)`` — same name, language, and node type;
#. fuzzy ``name`` match above a threshold — within one language and type.

Matching is transitive (clustering via union-find), but a merge is **refused**
when it would put two *different* non-empty ``wikidata_qid`` (or two different
``getty_id``) into one node: an explicit identifier conflict means they are
distinct things, no matter how alike their names look.

Merging one cluster (:func:`merge_rows`):

* **unions aliases** — every row's aliases plus the names that lose out to the
  canonical name are kept as ``aliases``;
* **keeps the highest-confidence value per column** — for each column the value
  is taken from the merged row with the greatest ``confidence``;
* **concatenates provenance** — ``source`` / ``source_url`` / ``source_query`` /
  ``retrieved_at`` from every merged row are joined (de-duplicated), so no source
  is lost, and the merged ``confidence`` is the highest of the cluster.

Every merge is recorded under :data:`MERGE_KEY` in the surviving row's overflow
JSON — the chosen ``primary`` csid, the precedence ``reason``, and a full
snapshot of every original member row — so the decision is auditable and the
merge can be reversed back to its inputs.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable, Sequence
from difflib import SequenceMatcher
from enum import Enum
from typing import Any

from culturescrape.schema.ids import normalize_name
from culturescrape.schema.mapper import OVERFLOW_KEY
from culturescrape.schema.tsvio import Row

#: Default minimum normalized-name similarity (0–1) for a fuzzy match.
DEFAULT_FUZZY_THRESHOLD = 0.85

#: Reserved key under the surviving row's overflow JSON holding the merge record.
MERGE_KEY = "merge"

#: Separator used to concatenate provenance values from merged rows.
_PROVENANCE_SEP = ";"

#: Scalar provenance columns concatenated (not overwritten) across merged rows.
PROVENANCE_TEXT_COLUMNS = ("source", "source_url", "source_query", "retrieved_at")

#: Row keys merging handles explicitly; every other key is a value column whose
#: highest-confidence value is kept.
_SPECIAL_KEYS = frozenset(
    {"csid", ":LABEL", "aliases", "confidence", OVERFLOW_KEY, *PROVENANCE_TEXT_COLUMNS}
)


class MergeReason(Enum):
    """Why two rows were judged the same thing, strongest precedence first."""

    WIKIDATA_QID = "wikidata_qid"
    GETTY_ID = "getty_id"
    EXACT_NAME = "exact_name"
    FUZZY_NAME = "fuzzy_name"


#: Precedence rank of each reason (smaller = stronger evidence).
_REASON_RANK: dict[MergeReason, int] = {
    MergeReason.WIKIDATA_QID: 0,
    MergeReason.GETTY_ID: 1,
    MergeReason.EXACT_NAME: 2,
    MergeReason.FUZZY_NAME: 3,
}


def merge_rows(
    rows: Iterable[Row], *, fuzzy_threshold: float = DEFAULT_FUZZY_THRESHOLD
) -> list[Row]:
    """Collapse duplicate *rows*, returning one canonical row per real-world thing.

    Rows are clustered by the precedence above (a merge that would unite two
    different ``wikidata_qid`` or ``getty_id`` is refused), each multi-row
    cluster is merged into one row, and singletons pass through unchanged. The
    output preserves input order by each cluster's earliest member.
    """
    materialized = list(rows)
    if not materialized:
        return []

    clusters = _Clusters(materialized)
    _link_by_exact_key(clusters, materialized, _qid, MergeReason.WIKIDATA_QID)
    _link_by_exact_key(clusters, materialized, _getty, MergeReason.GETTY_ID)
    _link_by_exact_key(clusters, materialized, _name_key, MergeReason.EXACT_NAME)
    _link_by_fuzzy_name(clusters, materialized, fuzzy_threshold)

    groups: dict[int, list[int]] = {}
    for index in range(len(materialized)):
        groups.setdefault(clusters.find(index), []).append(index)

    out: list[Row] = []
    for root in sorted(groups, key=lambda r: groups[r][0]):
        indices = groups[root]
        if len(indices) == 1:
            out.append(materialized[indices[0]])
        else:
            members = [materialized[i] for i in indices]
            out.append(_merge_cluster(members, clusters.reasons[root]))
    return out


class _Clusters:
    """Union-find over row indices that refuses identifier-conflicting merges.

    Each root tracks the set of distinct ``wikidata_qid`` and ``getty_id`` in its
    cluster; a union that would grow either set beyond one is rejected so two
    explicitly different entities never collapse. Each root also accumulates the
    :class:`MergeReason`\\ s that linked its members.
    """

    def __init__(self, rows: Sequence[Row]) -> None:
        self._parent = list(range(len(rows)))
        self._qids = [{q} if (q := _qid(r)) else set[str]() for r in rows]
        self._gettys = [{g} if (g := _getty(r)) else set[str]() for r in rows]
        self.reasons: list[set[MergeReason]] = [set() for _ in rows]

    def find(self, index: int) -> int:
        root = index
        while self._parent[root] != root:
            root = self._parent[root]
        while self._parent[index] != root:  # path compression
            self._parent[index], index = root, self._parent[index]
        return root

    def union(self, a: int, b: int, reason: MergeReason) -> bool:
        """Merge the clusters of *a* and *b*, recording *reason*.

        Returns ``False`` (leaving both clusters intact) when the union would
        unite two different ``wikidata_qid`` or ``getty_id``.
        """
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            self.reasons[ra].add(reason)
            return True
        if len(self._qids[ra] | self._qids[rb]) > 1:
            return False
        if len(self._gettys[ra] | self._gettys[rb]) > 1:
            return False
        self._parent[rb] = ra
        self._qids[ra] |= self._qids[rb]
        self._gettys[ra] |= self._gettys[rb]
        self.reasons[ra] |= self.reasons[rb]
        self.reasons[ra].add(reason)
        return True


def _link_by_exact_key(
    clusters: _Clusters,
    rows: Sequence[Row],
    key: Callable[[Row], str],
    reason: MergeReason,
) -> None:
    """Union rows that share a non-empty *key* under *reason*."""
    buckets: dict[str, list[int]] = {}
    for index, row in enumerate(rows):
        value = key(row)
        if value:
            buckets.setdefault(value, []).append(index)
    for indices in buckets.values():
        first = indices[0]
        for other in indices[1:]:
            clusters.union(first, other, reason)


def _link_by_fuzzy_name(
    clusters: _Clusters, rows: Sequence[Row], threshold: float
) -> None:
    """Union same-type, same-language rows whose names are similar enough."""
    blocks: dict[tuple[str | None, str], list[int]] = {}
    for index, row in enumerate(rows):
        if _norm_name(row):
            blocks.setdefault((_primary_label(row), _lang(row)), []).append(index)
    for indices in blocks.values():
        for i in range(len(indices)):
            left = _norm_name(rows[indices[i]])
            for j in range(i + 1, len(indices)):
                right = _norm_name(rows[indices[j]])
                if SequenceMatcher(None, left, right).ratio() >= threshold:
                    clusters.union(indices[i], indices[j], MergeReason.FUZZY_NAME)


def _merge_cluster(rows: Sequence[Row], reasons: set[MergeReason]) -> Row:
    """Merge a cluster of duplicate *rows* into one canonical row."""
    primary = min(rows, key=_primary_sort_key)
    merged: Row = {"csid": _text(primary, "csid"), ":LABEL": _union_labels(rows)}

    for column in _value_columns(rows):
        value = _highest_confidence_value(rows, column)
        if value:
            merged[column] = value

    name = merged.get("name")
    merged["aliases"] = _union_aliases(rows, name if isinstance(name, str) else "")

    for column in PROVENANCE_TEXT_COLUMNS:
        joined = _PROVENANCE_SEP.join(_unique(_text(r, column) for r in rows))
        if joined:
            merged[column] = joined
    merged["confidence"] = repr(max(_confidence(r) for r in rows))

    _record_merge(merged, primary, rows, reasons)
    return merged


def _value_columns(rows: Sequence[Row]) -> list[str]:
    """The non-special columns present in any row, in stable sorted order."""
    keys: set[str] = set()
    for row in rows:
        keys.update(row)
    return sorted(keys - _SPECIAL_KEYS)


def _highest_confidence_value(rows: Sequence[Row], column: str) -> str | None:
    """The *column* value from the highest-confidence row that has one."""
    candidates = [
        (-_confidence(row), _text(row, "csid"), value)
        for row in rows
        if isinstance((value := row.get(column)), str) and value
    ]
    if not candidates:
        return None
    return min(candidates)[2]


def _union_aliases(rows: Sequence[Row], canonical: str) -> list[str]:
    """Union every row's aliases and losing names, minus the canonical name."""
    collected: list[str] = []
    for row in rows:
        collected.extend(_aliases(row))
        collected.append(_text(row, "name"))
    return [a for a in _unique(collected) if a and a != canonical]


def _record_merge(
    merged: Row, primary: Row, rows: Sequence[Row], reasons: set[MergeReason]
) -> None:
    """Write the auditable, reversible merge record into the overflow JSON."""
    data = _overflow(primary)
    for row in rows:
        if row is not primary:
            for key, value in _overflow(row).items():
                data.setdefault(key, value)
    data[MERGE_KEY] = {
        "reason": min(reasons, key=lambda r: _REASON_RANK[r]).value,
        "primary": _text(primary, "csid"),
        "members": [dict(row) for row in rows],
    }
    merged[OVERFLOW_KEY] = json.dumps(data, ensure_ascii=False, sort_keys=True)


# --- row accessors ---------------------------------------------------------


def _text(row: Row, key: str) -> str:
    """The stripped scalar value at *key*, or ``""`` (lists are not scalars)."""
    value = row.get(key)
    return value.strip() if isinstance(value, str) else ""


def _qid(row: Row) -> str:
    return _text(row, "wikidata_qid")


def _getty(row: Row) -> str:
    return _text(row, "getty_id")


def _lang(row: Row) -> str:
    return _text(row, "lang").casefold()


def _norm_name(row: Row) -> str:
    name = _text(row, "name")
    return normalize_name(name) if name else ""


def _name_key(row: Row) -> str:
    """The exact ``(name, lang, type)`` blocking key, or ``""`` without a name."""
    norm = _norm_name(row)
    if not norm:
        return ""
    return "\x1f".join((norm, _lang(row), _primary_label(row) or ""))


def _primary_label(row: Row) -> str | None:
    labels = row.get(":LABEL")
    return labels[0] if isinstance(labels, list) and labels else None


def _union_labels(rows: Sequence[Row]) -> list[str]:
    collected: list[str] = []
    for row in rows:
        labels = row.get(":LABEL")
        if isinstance(labels, list):
            collected.extend(labels)
    return list(_unique(collected))


def _aliases(row: Row) -> list[str]:
    aliases = row.get("aliases")
    return list(aliases) if isinstance(aliases, list) else []


def _confidence(row: Row) -> float:
    try:
        return float(_text(row, "confidence"))
    except ValueError:
        return 0.0


def _primary_sort_key(row: Row) -> tuple[int, int, float, str]:
    """Order rows so the best identity survives: QID, then Getty, then conf."""
    return (
        0 if _qid(row) else 1,
        0 if _getty(row) else 1,
        -_confidence(row),
        _text(row, "csid"),
    )


def _overflow(row: Row) -> dict[str, Any]:
    """Decode a row's overflow JSON object, or ``{}`` if absent/unusable."""
    raw = row.get(OVERFLOW_KEY)
    if isinstance(raw, str) and raw:
        loaded = json.loads(raw)
        if isinstance(loaded, dict):
            return loaded
    return {}


def _unique(values: Iterable[str]) -> list[str]:
    """Distinct *values* in first-seen order."""
    seen: dict[str, None] = {}
    for value in values:
        seen.setdefault(value, None)
    return list(seen)
