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
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from enum import Enum
from typing import Any

from culturescrape.acquire.http import HttpClient
from culturescrape.schema.ids import IdError, mint_csid
from culturescrape.schema.mapper import OVERFLOW_KEY
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
