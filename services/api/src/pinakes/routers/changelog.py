"""The `/api/changelog` route group — the dataset's browsable audit log.

Ported off `server/routes/changelog.ts` (docs/UNIFIED-PROJECT-PLAN.md §7). The
*write* half of this store was already here — the review pipeline appends to it
on every approval — so this is the read side finally joining it, and
:mod:`pinakes.contributions.changelog` is now the whole thing rather than half.

Same adapter discipline as the groups before it: parse the query string the way
Express did, call one function, map the outcome onto a status code.

What the port preserves deliberately:

* **The filters are read off the request, not declared.** Partly because one of
  them is named `from` and cannot be a Python parameter — but mostly because a
  declared `int limit` would answer **422** where `parseFilters` answered with
  the default page. A stale bookmark must not become a hard failure.
* **A junk filter is not an error anywhere.** `?limit=abc` falls back to 50 and
  `?changeType=banana` is ignored outright rather than 400ing; the TypeScript
  read numbers through `parseInt` and change types through an allow-list, and
  neither path had a rejection in it.
* **`total` counts the filtered set, not the page.** It is taken before
  pagination so a client can render "10 of 340" without a second request — which
  is why :func:`~pinakes.contributions.changelog.filter_changelog` deliberately
  does not paginate.
* **The 500 shape is this group's, not the collab stores'.** Express answered
  ``{message, error}`` here where `routes/collections.ts` answered
  ``{error, detail}``. Both are reproduced as written rather than unified.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from pinakes.contributions import changelog

logger = logging.getLogger("pinakes.changelog")

router = APIRouter(tags=["changelog"])

_LEADING_INT = re.compile(r"\s*[+-]?\d+")


def _string(value: str | None) -> str | None:
    """A non-blank query parameter, trimmed. Blank means "no filter"."""
    if value is None or value.strip() == "":
        return None
    return value.strip()


def _number(value: str | None) -> int | None:
    """``parseInt(value, 10)``, where an unparseable value means "unset".

    Deliberately **not** the NaN-propagating `parse_int_js` the contribution
    queue uses: `parseFilters` dropped a `NaN` back to `undefined`, so a junk
    `?limit=` here returns the *default* page where the same input returns an
    *empty* page over there. The two groups really do differ.
    """
    text = _string(value)
    if text is None:
        return None
    match = _LEADING_INT.match(text)
    return int(match.group(0)) if match else None


def _filters(request: Request) -> dict[str, Any]:
    """The shared filter parse, used by both endpoints."""
    query = request.query_params
    kind = _string(query.get("changeType"))
    return {
        "domain": _string(query.get("domain")),
        "changeType": kind if kind in changelog.CHANGE_TYPES else None,
        "source": _string(query.get("source")),
        "contributionId": _string(query.get("contributionId")),
        "from": _string(query.get("from")),
        "to": _string(query.get("to")),
        "limit": _number(query.get("limit")),
        "offset": _number(query.get("offset")),
    }


def _failed(label: str, error: Exception) -> JSONResponse:
    """The Express catch: log it, answer 500 naming what was being done."""
    logger.exception("Error %s", label)
    return JSONResponse(
        status_code=500,
        content={"message": f"Failed to {label}", "error": str(error)},
    )


@router.get("/api/changelog")
def list_changelog(request: Request) -> Any:
    """Filtered, paginated entries — newest first.

    The echoed `offset`/`limit` are what the *caller* asked for, not what was
    applied: a negative offset is clamped before slicing but reported as sent,
    which is how the TypeScript reported it and what lets a client see that its
    input was odd.
    """
    filters = _filters(request)
    try:
        page = changelog.list_entries(filters)
    except (OSError, ValueError) as error:
        return _failed("list changelog", error)
    return {
        "entries": page["entries"],
        "total": page["total"],
        "offset": filters["offset"] if filters["offset"] is not None else 0,
        "limit": (
            filters["limit"]
            if filters["limit"] is not None
            else changelog.DEFAULT_LIMIT
        ),
        "changeTypes": list(changelog.CHANGE_TYPES),
    }


@router.get("/api/changelog/stats")
def changelog_stats(request: Request) -> Any:
    """Aggregate counts + date bounds over the filtered set.

    Takes the same filters as the list endpoint and ignores the pagination among
    them — the point of a stats call is the whole matching set.
    """
    try:
        return changelog.stats(_filters(request))
    except (OSError, ValueError) as error:
        return _failed("compute changelog stats", error)
