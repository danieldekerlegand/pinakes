"""Reconcile name-anchored node rows to Wikidata QIDs.

A row that arrives without a Wikidata QID is identified only by its
name-anchored ``csid`` (``docs/data-model.md``), so the *same* real-world thing
acquired from two sources mints two distinct ids. This module closes that gap:
it asks Wikidata "what entity is this name?" and, when the answer is confident
enough, stamps the QID onto the row and re-mints its ``csid`` as QID-anchored —
which is what collapses the two sources onto one id.

The question is asked through the OpenRefine-style **reconciliation API** that
Wikidata exposes, reached via the shared cached
:class:`~culturescrape.acquire.http.HttpClient` so repeated lookups — across
runs and tests — skip the network. The service returns scored candidates; the
:class:`WikidataReconciler` turns those scores into one of three decisions
against a *configurable* threshold:

* **matched** — one candidate clears the threshold and no rival is close, so its
  QID is accepted;
* **ambiguous** — two candidates are both plausible, so no QID is accepted;
* **none** — nothing clears the threshold.

:func:`reconcile_row` applies a decision to a row: on a match it sets
``wikidata_qid`` and re-mints the ``csid``; otherwise it leaves the QID null and
lowers the row's confidence. Every decision (with its score and candidate count)
is recorded in the row's provenance so the choice is auditable.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from difflib import SequenceMatcher
from enum import Enum
from typing import Any

from culturescrape.acquire.http import HttpClient
from culturescrape.schema.ids import IdError, mint_csid, normalize_name
from culturescrape.schema.mapper import LINGUASCRAPE_ID_KEY, OVERFLOW_KEY
from culturescrape.schema.merge import PROVENANCE_TEXT_COLUMNS
from culturescrape.schema.tsvio import Row

LOGGER = logging.getLogger("culturescrape.schema.reconcile")

#: Default Wikidata reconciliation endpoint base (language path appended).
WIKIDATA_RECONCILE_ENDPOINT = "https://wikidata.reconci.link"

#: Default score (0–100) a candidate must clear to be accepted.
DEFAULT_THRESHOLD = 70.0

#: Default minimum gap between the top two candidates' scores for the top to
#: count as unambiguous; a closer runner-up makes the decision *ambiguous*.
DEFAULT_AMBIGUITY_MARGIN = 5.0

#: Default number of candidates requested per reconciliation query.
DEFAULT_LIMIT = 5

#: Default factor applied to a row's confidence when no QID is accepted.
DEFAULT_NO_MATCH_PENALTY = 0.5

#: Reserved key under the row's overflow JSON holding the decision record.
RECONCILIATION_KEY = "reconciliation"


class ReconciliationError(RuntimeError):
    """Raised when a reconciliation request fails or returns a bad body."""


class ReconciliationDecision(Enum):
    """The outcome of reconciling one name against Wikidata."""

    MATCHED = "matched"
    AMBIGUOUS = "ambiguous"
    NONE = "none"


@dataclass(frozen=True)
class ReconciliationCandidate:
    """One scored entity returned by the reconciliation service."""

    qid: str
    name: str
    score: float
    match: bool


@dataclass(frozen=True)
class ReconciliationResult:
    """A reconciliation decision and the candidates it was drawn from.

    ``qid`` is set only when ``decision`` is
    :attr:`~ReconciliationDecision.MATCHED`. ``score`` is the top candidate's
    score (``None`` when there were no candidates at all). ``candidates`` keeps
    the full scored list, best first, so the decision is auditable.
    """

    decision: ReconciliationDecision
    qid: str | None
    score: float | None
    candidates: tuple[ReconciliationCandidate, ...]


class WikidataReconciler:
    """Reconcile ``(name, type, lang)`` to a Wikidata QID via the recon API.

    Args:
        http: Shared cached HTTP client used to reach the endpoint.
        endpoint: Reconciliation endpoint base; the language path (``/en/api``)
            is appended per request.
        threshold: Minimum candidate score (0–100) to accept a match.
        ambiguity_margin: A match is rejected as *ambiguous* when the runner-up
            also clears ``threshold`` or scores within this margin of the top.
        limit: Candidates requested per query.
    """

    def __init__(
        self,
        http: HttpClient,
        *,
        endpoint: str = WIKIDATA_RECONCILE_ENDPOINT,
        threshold: float = DEFAULT_THRESHOLD,
        ambiguity_margin: float = DEFAULT_AMBIGUITY_MARGIN,
        limit: int = DEFAULT_LIMIT,
    ) -> None:
        self._http = http
        self._endpoint = endpoint.rstrip("/")
        self._threshold = threshold
        self._ambiguity_margin = ambiguity_margin
        self._limit = limit

    def reconcile(
        self, name: str, *, type_hint: str | None = None, lang: str = "en"
    ) -> ReconciliationResult:
        """Reconcile *name* (optionally typed) in *lang* to a QID.

        Sends one query to the reconciliation service and reduces its scored
        candidates to a :class:`ReconciliationResult` against the configured
        threshold and ambiguity margin.
        """
        candidates = self._query(name, type_hint, lang)
        return self._decide(candidates)

    def _query(
        self, name: str, type_hint: str | None, lang: str
    ) -> tuple[ReconciliationCandidate, ...]:
        query: dict[str, Any] = {"query": name, "limit": self._limit}
        if type_hint:
            query["type"] = type_hint
        params = {"queries": json.dumps({"q0": query}, sort_keys=True)}
        url = f"{self._endpoint}/{lang}/api"
        response = self._http.get(url, params)
        if response.status_code >= 400:
            raise ReconciliationError(
                f"reconciliation request failed with status {response.status_code}"
            )
        try:
            payload: Any = json.loads(response.text)
        except json.JSONDecodeError as exc:
            raise ReconciliationError(
                f"reconciliation returned a non-JSON body: {exc}"
            ) from exc
        return _parse_candidates(payload)

    def _decide(
        self, candidates: tuple[ReconciliationCandidate, ...]
    ) -> ReconciliationResult:
        if not candidates:
            return ReconciliationResult(
                ReconciliationDecision.NONE, None, None, candidates
            )
        top = candidates[0]
        if top.score < self._threshold:
            return ReconciliationResult(
                ReconciliationDecision.NONE, None, top.score, candidates
            )
        if len(candidates) > 1:
            runner = candidates[1]
            too_close = (top.score - runner.score) < self._ambiguity_margin
            if runner.score >= self._threshold or too_close:
                return ReconciliationResult(
                    ReconciliationDecision.AMBIGUOUS, None, top.score, candidates
                )
        return ReconciliationResult(
            ReconciliationDecision.MATCHED, top.qid, top.score, candidates
        )


def _parse_candidates(payload: Any) -> tuple[ReconciliationCandidate, ...]:
    """Parse a reconciliation response body into scored candidates, best first.

    Tolerates a missing ``q0`` or empty ``result`` (a valid no-match) and skips
    any candidate lacking an id or score rather than failing the whole query.
    """
    if not isinstance(payload, Mapping):
        raise ReconciliationError("reconciliation body is not a JSON object")
    block = payload.get("q0")
    results = block.get("result") if isinstance(block, Mapping) else None
    if not isinstance(results, list):
        return ()
    candidates: list[ReconciliationCandidate] = []
    for item in results:
        if not isinstance(item, Mapping):
            continue
        qid = item.get("id")
        score = item.get("score")
        if not isinstance(qid, str) or not isinstance(score, int | float):
            continue
        name = item.get("name")
        candidates.append(
            ReconciliationCandidate(
                qid=qid,
                name=name if isinstance(name, str) else "",
                score=float(score),
                match=bool(item.get("match", False)),
            )
        )
    candidates.sort(key=lambda c: c.score, reverse=True)
    return tuple(candidates)


def reconcile_row(
    row: Row,
    reconciler: WikidataReconciler,
    *,
    no_match_penalty: float = DEFAULT_NO_MATCH_PENALTY,
) -> ReconciliationResult | None:
    """Reconcile *row* in place, returning the decision (or ``None`` if skipped).

    A row that already carries a ``wikidata_qid`` (it is QID-anchored already) or
    that has no ``name`` to search on is left untouched and ``None`` is returned.
    Otherwise the row's name, primary label, and ``lang`` drive one
    reconciliation:

    * on a **match** the row's ``wikidata_qid`` is set and its ``csid`` re-minted
      QID-anchored, so two sources of the same entity now share one id;
    * on **none** / **ambiguous** the QID is left null and the row's
      ``confidence`` is multiplied by *no_match_penalty*.

    The decision is recorded in the row's provenance either way.
    """
    qid = row.get("wikidata_qid")
    if isinstance(qid, str) and qid.strip():
        return None
    name = row.get("name")
    if not isinstance(name, str) or not name.strip():
        return None

    node_type = _primary_label(row)
    lang = row.get("lang")
    result = reconciler.reconcile(
        name,
        type_hint=node_type,
        lang=lang if isinstance(lang, str) and lang else "en",
    )

    if result.decision is ReconciliationDecision.MATCHED and result.qid:
        _apply_match(row, result.qid, node_type)
    else:
        _lower_confidence(row, no_match_penalty)
    _record_decision(row, result)
    return result


def reconcile_rows(
    rows: Iterable[Row],
    reconciler: WikidataReconciler,
    *,
    no_match_penalty: float = DEFAULT_NO_MATCH_PENALTY,
) -> list[Row]:
    """Reconcile each row in place (see :func:`reconcile_row`); return the list."""
    materialized = list(rows)
    for row in materialized:
        reconcile_row(row, reconciler, no_match_penalty=no_match_penalty)
    return materialized


def _primary_label(row: Row) -> str | None:
    """Return the row's first ``:LABEL`` (the node type), if any."""
    labels = row.get(":LABEL")
    if isinstance(labels, list) and labels:
        return labels[0]
    return None


def _apply_match(row: Row, qid: str, node_type: str | None) -> None:
    """Set the matched QID and re-mint the ``csid`` QID-anchored."""
    row["wikidata_qid"] = qid
    if node_type:
        try:
            row["csid"] = mint_csid(node_type, qid=qid)
        except IdError:
            LOGGER.warning("matched QID %r is not well-formed; csid unchanged", qid)


def _lower_confidence(row: Row, penalty: float) -> None:
    """Multiply the row's ``confidence`` cell by *penalty* (clamped to [0, 1])."""
    current = row.get("confidence")
    if not isinstance(current, str):
        return
    try:
        value = float(current)
    except ValueError:
        return
    row["confidence"] = repr(max(0.0, min(1.0, value * penalty)))


def _record_decision(row: Row, result: ReconciliationResult) -> None:
    """Record the decision under :data:`RECONCILIATION_KEY` in the overflow JSON."""
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
    if result.score is not None:
        record["score"] = result.score
    if result.qid is not None:
        record["qid"] = result.qid
    data[RECONCILIATION_KEY] = record
    row[OVERFLOW_KEY] = json.dumps(data, ensure_ascii=False, sort_keys=True)


# --- Offline reconciliation of LinguaScrape-origin rows --------------------
#
# The Wikidata reconciler above answers "which QID is this name?" over the
# network. LinguaScrape rows arrive *without* a QID
# (``docs/reconcile-linguascrape.md``), so their identity has to be settled
# against the nodes already in the corpus using only local signals. This is that
# offline cascade: for each incoming LinguaScrape row it looks for the existing
# node it denotes by a strict precedence — a shared language code
# (iso639/glottocode), then an exact normalized ``(name, type, region)``, then a
# fuzzy name within one type/region — and reports each row as *matched*, *new*,
# or *ambiguous*.
#
# A single clear candidate is a **match**: the incoming row is merged onto the
# existing node, keeping the node's identity and concatenating *both* sources'
# provenance. Two or more rival candidates are **ambiguous**: the row is never
# merged silently — it is listed with its competing candidates for human triage.
# No candidate at all is **new**: the row stands as its own node.

#: Default minimum normalized-name similarity (0–1) for the local fuzzy tier.
DEFAULT_LOCAL_FUZZY_THRESHOLD = 0.85

#: Reserved key under a row's overflow JSON holding the local-reconcile decision.
RECONCILIATION_LOCAL_KEY = "reconcile_local"


class LocalMatchTier(Enum):
    """Which cascade signal identified a candidate, strongest precedence first."""

    LANGUAGE_CODE = "language_code"
    NAME_REGION = "name_region"
    FUZZY_NAME = "fuzzy_name"


class LocalOutcome(Enum):
    """The outcome of reconciling one LinguaScrape row against the corpus."""

    MATCHED = "matched"
    NEW = "new"
    AMBIGUOUS = "ambiguous"


#: Match confidence stamped per exact cascade tier (fuzzy carries its own ratio).
_TIER_SCORE: dict[LocalMatchTier, float] = {
    LocalMatchTier.LANGUAGE_CODE: 1.0,
    LocalMatchTier.NAME_REGION: 0.95,
}


@dataclass(frozen=True)
class LocalCandidate:
    """One existing node an incoming row might denote, with its match strength."""

    csid: str
    name: str
    tier: LocalMatchTier
    score: float


@dataclass(frozen=True)
class LocalReconciliation:
    """The decision for one incoming LinguaScrape row.

    ``matched_csid`` is set only when ``outcome`` is
    :attr:`~LocalOutcome.MATCHED`. ``confidence`` is the strength of the best
    candidate considered (``0.0`` when the row is new). ``candidates`` keeps the
    rival existing nodes, best first — on an ambiguous decision this is the list
    a human triages; it is never auto-merged.
    """

    csid: str
    name: str
    outcome: LocalOutcome
    tier: LocalMatchTier | None
    matched_csid: str | None
    confidence: float
    candidates: tuple[LocalCandidate, ...]


@dataclass(frozen=True)
class LocalReconciliationReport:
    """The full result of :func:`reconcile_linguascrape`.

    ``results`` holds one :class:`LocalReconciliation` per incoming row, in input
    order. ``rows`` holds the rows safe to load into the corpus — each matched
    row merged onto its existing node (both provenances preserved) and each new
    row as-is; **ambiguous rows are deliberately omitted** so nothing is merged
    without human review (they remain listed under :attr:`ambiguous`).
    """

    results: tuple[LocalReconciliation, ...]
    rows: tuple[Row, ...]

    @property
    def matched(self) -> tuple[LocalReconciliation, ...]:
        return tuple(r for r in self.results if r.outcome is LocalOutcome.MATCHED)

    @property
    def new(self) -> tuple[LocalReconciliation, ...]:
        return tuple(r for r in self.results if r.outcome is LocalOutcome.NEW)

    @property
    def ambiguous(self) -> tuple[LocalReconciliation, ...]:
        return tuple(r for r in self.results if r.outcome is LocalOutcome.AMBIGUOUS)

    def counts(self) -> dict[str, int]:
        """Return the number of rows in each outcome bucket."""
        return {
            outcome.value: sum(1 for r in self.results if r.outcome is outcome)
            for outcome in LocalOutcome
        }


def reconcile_linguascrape(
    incoming: Iterable[Row],
    existing: Iterable[Row],
    *,
    fuzzy_threshold: float = DEFAULT_LOCAL_FUZZY_THRESHOLD,
) -> LocalReconciliationReport:
    """Reconcile LinguaScrape-origin *incoming* rows against *existing* nodes.

    Each incoming row runs the offline cascade against an index of the existing
    corpus (language code → exact ``(name, type, region)`` → fuzzy name) and is
    classified :attr:`~LocalOutcome.MATCHED`, :attr:`~LocalOutcome.NEW`, or
    :attr:`~LocalOutcome.AMBIGUOUS`. A match is merged onto its existing node,
    preserving both sources' provenance; a new row passes through; an ambiguous
    row is held back for triage (never auto-merged). The decision is recorded in
    every emitted row's overflow JSON under :data:`RECONCILIATION_LOCAL_KEY`.
    """
    index = _ExistingIndex(list(existing))
    results: list[LocalReconciliation] = []
    rows: list[Row] = []
    for row in incoming:
        candidates = index.candidates(row, fuzzy_threshold)
        outcome, tier, matched_csid, confidence = _decide_local(candidates)
        results.append(
            LocalReconciliation(
                csid=_cell(row, "csid"),
                name=_cell(row, "name"),
                outcome=outcome,
                tier=tier,
                matched_csid=matched_csid,
                confidence=confidence,
                candidates=candidates,
            )
        )
        if outcome is LocalOutcome.MATCHED and matched_csid is not None:
            target = index.by_csid[matched_csid]
            rows.append(_merge_local(target, row, tier, matched_csid, confidence))
        elif outcome is LocalOutcome.NEW:
            rows.append(_record_local(dict(row), outcome, None, None, confidence))
    return LocalReconciliationReport(tuple(results), tuple(rows))


class _ExistingIndex:
    """Blocking index over the existing corpus for the offline cascade."""

    def __init__(self, rows: Sequence[Row]) -> None:
        self.by_csid: dict[str, Row] = {}
        self._by_code: dict[str, list[str]] = {}
        self._by_name_region: dict[tuple[str, str, str], list[str]] = {}
        self._blocks: dict[tuple[str, str], list[tuple[str, str]]] = {}
        for row in rows:
            csid = _cell(row, "csid")
            if not csid or csid in self.by_csid:
                continue
            self.by_csid[csid] = row
            code = _language_code(row)
            if code:
                self._by_code.setdefault(code, []).append(csid)
            key = _name_region_key(row)
            if key is not None:
                self._by_name_region.setdefault(key, []).append(csid)
                block = (key[1], key[2])
                self._blocks.setdefault(block, []).append((key[0], csid))

    def candidates(
        self, row: Row, fuzzy_threshold: float
    ) -> tuple[LocalCandidate, ...]:
        """Return the candidate existing nodes for *row*, best tier first."""
        code = _language_code(row)
        if code:
            hits = self._by_code.get(code)
            if hits:
                return self._exact(hits, LocalMatchTier.LANGUAGE_CODE)
        key = _name_region_key(row)
        if key is not None:
            hits = self._by_name_region.get(key)
            if hits:
                return self._exact(hits, LocalMatchTier.NAME_REGION)
        return self._fuzzy(row, fuzzy_threshold)

    def _exact(
        self, csids: Sequence[str], tier: LocalMatchTier
    ) -> tuple[LocalCandidate, ...]:
        score = _TIER_SCORE[tier]
        return tuple(
            LocalCandidate(csid, _cell(self.by_csid[csid], "name"), tier, score)
            for csid in csids
        )

    def _fuzzy(
        self, row: Row, threshold: float
    ) -> tuple[LocalCandidate, ...]:
        norm = _norm_name(row)
        if not norm:
            return ()
        block = self._blocks.get((_type_of(row), _region(row)), [])
        scored: list[LocalCandidate] = []
        for cand_name, csid in block:
            ratio = SequenceMatcher(None, norm, cand_name).ratio()
            if ratio >= threshold:
                name = _cell(self.by_csid[csid], "name")
                scored.append(
                    LocalCandidate(csid, name, LocalMatchTier.FUZZY_NAME, ratio)
                )
        scored.sort(key=lambda c: (-c.score, c.csid))
        return tuple(scored)


def _decide_local(
    candidates: tuple[LocalCandidate, ...],
) -> tuple[LocalOutcome, LocalMatchTier | None, str | None, float]:
    """Reduce ranked *candidates* to an outcome, tier, matched csid, confidence."""
    if not candidates:
        return LocalOutcome.NEW, None, None, 0.0
    top = candidates[0]
    if len({c.csid for c in candidates}) == 1:
        return LocalOutcome.MATCHED, top.tier, top.csid, top.score
    return LocalOutcome.AMBIGUOUS, top.tier, None, top.score


def _merge_local(
    target: Row,
    incoming: Row,
    tier: LocalMatchTier | None,
    matched_csid: str,
    confidence: float,
) -> Row:
    """Merge *incoming* onto the existing *target*, preserving both provenance.

    The target's identity (``csid``, ``wikidata_qid``) is kept; blank value
    columns are enriched from the incoming row; labels and aliases are unioned;
    and every provenance column is concatenated so neither source is lost.
    """
    merged: Row = dict(target)
    for key, value in incoming.items():
        if key in _MERGE_RESERVED:
            continue
        if not merged.get(key):
            merged[key] = value

    merged[":LABEL"] = _union_labels(target, incoming)
    canonical = _cell(merged, "name")
    merged["aliases"] = _union_aliases(target, incoming, canonical)
    for column in PROVENANCE_TEXT_COLUMNS:
        joined = _PROVENANCE_SEP.join(
            _unique(v for v in (_cell(target, column), _cell(incoming, column)) if v)
        )
        if joined:
            merged[column] = joined
    merged["confidence"] = repr(max(_confidence(target), _confidence(incoming)))

    alias = _cell(incoming, LINGUASCRAPE_ID_KEY)
    if alias and not _cell(target, LINGUASCRAPE_ID_KEY):
        merged[LINGUASCRAPE_ID_KEY] = alias

    return _record_local(merged, LocalOutcome.MATCHED, tier, matched_csid, confidence)


def _record_local(
    row: Row,
    outcome: LocalOutcome,
    tier: LocalMatchTier | None,
    matched_csid: str | None,
    confidence: float,
) -> Row:
    """Record the local-reconcile decision in *row*'s overflow JSON; return it."""
    data = _decode_overflow(row)
    record: dict[str, Any] = {
        "outcome": outcome.value,
        "confidence": confidence,
    }
    if tier is not None:
        record["tier"] = tier.value
    if matched_csid is not None:
        record["matched_csid"] = matched_csid
    data[RECONCILIATION_LOCAL_KEY] = record
    row[OVERFLOW_KEY] = json.dumps(data, ensure_ascii=False, sort_keys=True)
    return row


#: Separator used to concatenate provenance values from a merged pair.
_PROVENANCE_SEP = ";"

#: Row keys the merge handles explicitly (identity + provenance); every other
#: column is a value column whose blank target cell is enriched from incoming.
_MERGE_RESERVED = frozenset(
    {
        "csid",
        ":LABEL",
        "aliases",
        "confidence",
        "wikidata_qid",
        "getty_id",
        OVERFLOW_KEY,
        LINGUASCRAPE_ID_KEY,
        *PROVENANCE_TEXT_COLUMNS,
    }
)


def _cell(row: Row, key: str) -> str:
    """The stripped scalar value at *key*, or ``""`` (lists are not scalars)."""
    value = row.get(key)
    return value.strip() if isinstance(value, str) else ""


def _type_of(row: Row) -> str:
    """The row's casefolded primary ``:LABEL`` (node type), or ``""``."""
    label = _primary_label(row)
    return label.casefold() if label else ""


def _language_code(row: Row) -> str:
    """The row's casefolded ``language_code`` (iso639/glottocode), or ``""``."""
    return _cell(row, "language_code").casefold()


def _region(row: Row) -> str:
    """The row's casefolded ``region`` blocking value (``""`` when unknown).

    Read from a ``region`` cell if present, else from a ``region`` field carried
    in the overflow JSON — the canonical schema has no dedicated column, so a
    row without either simply blocks on ``(name, type)`` alone.
    """
    region = _cell(row, "region")
    if not region:
        extra = _decode_overflow(row).get("region")
        if isinstance(extra, str):
            region = extra.strip()
    return region.casefold()


def _norm_name(row: Row) -> str:
    name = _cell(row, "name")
    return normalize_name(name) if name else ""


def _name_region_key(row: Row) -> tuple[str, str, str] | None:
    """The exact ``(norm_name, type, region)`` blocking key, or ``None``."""
    norm = _norm_name(row)
    if not norm:
        return None
    return (norm, _type_of(row), _region(row))


def _union_labels(target: Row, incoming: Row) -> list[str]:
    collected: list[str] = []
    for row in (target, incoming):
        labels = row.get(":LABEL")
        if isinstance(labels, list):
            collected.extend(labels)
    return _unique(collected)


def _union_aliases(target: Row, incoming: Row, canonical: str) -> list[str]:
    """Union both rows' aliases and the incoming name, minus the kept name."""
    collected: list[str] = []
    for row in (target, incoming):
        aliases = row.get("aliases")
        if isinstance(aliases, list):
            collected.extend(aliases)
        collected.append(_cell(row, "name"))
    return [a for a in _unique(collected) if a and a != canonical]


def _confidence(row: Row) -> float:
    try:
        return float(_cell(row, "confidence"))
    except ValueError:
        return 0.0


def _decode_overflow(row: Row) -> dict[str, Any]:
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
