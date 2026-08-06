"""The `languages` port unit's last two routes — the preservation surface.

`server/routes/language-preservation.ts`, the cutover's eleventh slice
(pinakes:80 US-1). Coverage 299/306 → **301/306**.

* `GET /api/languages/preservation` — the endangered-language dashboard, an
  aggregation over the corpus's free-text `status` column.
* `POST /api/languages/field-update` — a researcher's attributed, sourced field
  observation for one language. It queues a `language` **edit** contribution
  (never a live TSV write) *and* records the change in the shared changelog at
  submission time, because a status change is a first-class provenance event.

Three things are not guessable from the route names:

* **The GET has to be registered ahead of `catalog.py`'s `/api/languages/{id}`,
  and it lives in two files for that reason.** `discover_routers` mounts in
  module-name order, `catalog` before `preservation`, so this router's static
  path would be swallowed by that wildcard and answer `Language not found`.
  :func:`pinakes.routers.catalog.language_preservation` re-registers it ahead of
  the wildcard and delegates straight back here — the shape
  `routers/ethnography.py` already uses for `/api/building-types/categories`,
  with the body owned by one module rather than copied.
* **`?watchlistLimit=` is `Number`, not `parseInt`, and a blank parameter means
  zero.** `Number("")` is `0` and finite, so `?watchlistLimit=` answers an
  **empty** watchlist; `?watchlistLimit=abc` is `NaN`, which fails the finiteness
  guard and falls back to the default 25. Two junk values, two different
  answers — the fourth distinct reading of a junk limit in this cutover.
* **The changelog write is best-effort and the response says so by omission.**
  A failed record leaves `changelogEntryId` `undefined`, which `JSON.stringify`
  emits as **no key** — never `null`. Losing the audit line must not cost the
  researcher their submission.
"""

from __future__ import annotations

import logging
import math
from typing import Annotated, Any, Final

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse

from pinakes.analytics import tsv
from pinakes.contributions import changelog, store
from pinakes.lexicons import preservation, storage
from pinakes.paths import lexicons_dir

logger = logging.getLogger("pinakes.preservation")

router = APIRouter(tags=["languages"])

Record = dict[str, Any]


def load_preservation_languages() -> list[Record]:
    """Project the preservation fields out of the live corpus.

    `endangermentStatus` wins over `status` when it is non-blank: it is the
    sourced UNESCO enrichment, so the dashboard reflects the *attributed*
    vitality. Both fall back to `null` rather than to `living`.
    """
    projected: list[Record] = []
    for language in storage.load_languages(lexicons_dir()):
        endangerment = language.get("endangermentStatus")
        status = preservation.js_trim("" if endangerment is None else str(endangerment))
        projected.append(
            {
                "id": language["id"],
                "name": language["name"],
                "region": language.get("region"),
                "status": status or language.get("status") or None,
                "familyId": language.get("familyId"),
                "nativeSpeakers": language.get("nativeSpeakers"),
                "totalSpeakers": language.get("totalSpeakers"),
            }
        )
    return projected


#: The three non-decimal integer literals `Number()` reads and `parseInt` does
#: not, with the radix each one implies. Unsigned by construction — the
#: specification's `NonDecimalIntegerLiteral` has no sign production, so
#: `Number("-0x10")` really is `NaN`.
_RADIX_PREFIXES: Final[tuple[tuple[str, int], ...]] = (
    ("0x", 16),
    ("0b", 2),
    ("0o", 8),
)


def _js_number(raw: str) -> float:
    """``Number(raw)``, the whole grammar — not :func:`pinakes.analytics.tsv.js_number`.

    That one is the *lexicon cell* reading and answers ``NaN`` for the three
    non-decimal literals and for ``Infinity``, which its docstring says is safe
    because no corpus cell is one and every caller guards the result the same
    way. Neither holds here: this value reaches a real `Number()` in Express
    with no guard beyond finiteness, so `?watchlistLimit=0x10` bounds the
    watchlist at **sixteen** rather than falling back to the default 25.
    """
    trimmed = preservation.js_trim(raw)
    if not trimmed:
        return 0.0
    for prefix, radix in _RADIX_PREFIXES:
        if trimmed[:2].lower() == prefix:
            digits = trimmed[2:]
            try:
                return float(int(digits, radix))
            except ValueError:
                return math.nan
    signless = trimmed[1:] if trimmed[:1] in ("+", "-") else trimmed
    if signless == "Infinity":
        return -math.inf if trimmed[:1] == "-" else math.inf
    return tsv.js_number(trimmed)


def _watchlist_limit(request: Request) -> float | None:
    """``typeof raw === "string" && Number.isFinite(Number(raw))`` → the bound.

    A *repeated* parameter reaches Express as an array, which fails the `typeof`
    test outright — hence `getlist`, the rule `routers/map_layers._string_param`
    spells out for the same shape. `Math.max(0, Math.floor(...))` is why a
    negative bound is an empty watchlist rather than a slice from the end.
    """
    values = request.query_params.getlist("watchlistLimit")
    if len(values) != 1:
        return None
    parsed = _js_number(values[0])
    if not math.isfinite(parsed):
        return None
    return max(0, math.floor(parsed))


def language_preservation(request: Request) -> Any:
    """`GET /api/languages/preservation`, as a plain function.

    Not decorated here: `catalog.py` re-registers the path ahead of its own
    `/api/languages/{id}` wildcard and calls this, and the decorated handler
    below is what keeps the route claimed by *this* module's port unit.
    """
    try:
        return preservation.compute_preservation_metrics(
            load_preservation_languages(),
            watchlist_limit=_watchlist_limit(request),
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        logger.exception("Error in /api/languages/preservation:")
        return JSONResponse(
            status_code=500,
            content={
                "error": "failed to compute preservation metrics",
                "detail": str(error),
            },
        )


@router.get("/api/languages/preservation")
def preservation_dashboard(request: Request) -> Any:
    """Per-category and per-vitality counts, regions, and the watchlist."""
    return language_preservation(request)


@router.post("/api/languages/field-update", status_code=201)
def field_update(body: Annotated[Any, Body()] = None) -> Any:
    """Queue an attributed field observation and log the change.

    400 on validation failure — from this module's own validator *or* from the
    contribution queue's, and the two answer different messages. 404 for a
    language id the corpus does not carry, which is checked only after
    validation passes, because the enrichment that needs the record is what
    reads it.
    """
    payload = body if isinstance(body, dict) else {}

    validation = preservation.validate_field_update(payload)
    if not validation.valid:
        return JSONResponse(
            status_code=400,
            content={
                "message": "Validation failed",
                "errors": validation.errors,
                "warnings": validation.warnings,
            },
        )

    try:
        language_id = payload.get("languageId")
        target = next(
            (
                language
                for language in load_preservation_languages()
                if language["id"] == language_id
            ),
            None,
        )
        if target is None:
            return JSONResponse(
                status_code=404,
                content={
                    "message": (
                        f"Language '{preservation.js_string(language_id)}' not found"
                    )
                },
            )

        # `{...input, languageName: … ?? target.name,
        #             currentStatus: … ?? target.status ?? undefined}`
        enriched: Record = dict(payload)
        if enriched.get("languageName") is None:
            enriched["languageName"] = target["name"]
        if enriched.get("currentStatus") is None:
            enriched["currentStatus"] = target["status"]

        result = store.queue().submit(
            preservation.build_field_update_contribution(enriched)
        )
        if not result.validation.valid or result.contribution is None:
            return JSONResponse(
                status_code=400,
                content={
                    "message": "Contribution validation failed",
                    "errors": result.validation.errors,
                    "warnings": result.validation.warnings,
                },
            )

        changed = preservation.changed_fields(enriched)
        confidence = enriched.get("confidence")
        entry = changelog.record_change(
            {
                "domain": "language",
                "changeType": "modified",
                "targetId": enriched.get("languageId"),
                "entityName": enriched.get("languageName"),
                "source": "field-research",
                "sourceUrl": _first_source_url(enriched.get("sources")),
                "contributionId": result.contribution["id"],
                "reviewer": enriched.get("researcherName"),
                "confidence": 60 if confidence is None else confidence,
                "fields": changed,
                "summary": preservation.field_update_summary(enriched),
            }
        )

        answer: Record = {"contribution": result.contribution}
        if entry is not None:
            answer["changelogEntryId"] = entry["id"]
        answer["changedFields"] = changed
        answer["warnings"] = result.validation.warnings
        return answer
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        logger.exception("Error in /api/languages/field-update:")
        return JSONResponse(
            status_code=500,
            content={
                "error": "failed to submit field update",
                "detail": str(error),
            },
        )


def _first_source_url(sources: Any) -> Any:
    """``enriched.sources?.[0]?.url`` — every step of the chain is optional."""
    if not isinstance(sources, list) or not sources:
        return None
    first = sources[0]
    return first.get("url") if isinstance(first, dict) else None
