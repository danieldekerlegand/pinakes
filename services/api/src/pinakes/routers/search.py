"""The `/api/search*` route group — federated search and its NL front doors.

Ported off the four inline handlers in `server/routes.ts` (pinakes:63 US-2).
Everything below HTTP is :mod:`pinakes.search.global_search` and
:mod:`pinakes.search.natural`; what lives here is the query-string reading and
the four empty-query short-circuits, which are all different from one another:

===========================  ==========================================
route                        blank/absent `q` answers
===========================  ==========================================
`/api/search`                ``{results: [], query: "", totalCount: 0}``
                             — and **no** `facets`/`filters` keys, unlike
                             the blank-query response the service layer
                             builds. The route never calls it.
`/api/search/natural`        ``{results: [], query: {raw: ""}, totalCount: 0}``
`/api/search/suggestions`    ``{suggestions: []}`` (via ``q || ""``)
`/api/search/spatial`        **400** — `lat`/`lng` are required
===========================  ==========================================

`/api/search/spatial` is the one that takes numbers, and it reads them the way
JavaScript did: ``parseFloat`` for the coordinates (a *prefix* parse, so
``lat=35abc`` is 35), ``parseInt`` for `year`/`radius`, and an unparseable
`year` collapses back to "no year filter" rather than 400ing. Declaring them as
typed FastAPI parameters would answer 422 to a stale bookmark, which is a
different contract (`services/api/CLAUDE.md`).
"""

from __future__ import annotations

import logging
import math
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from pinakes.analytics.tsv import js_parse_float, js_parse_int
from pinakes.paths import lexicons_dir
from pinakes.search import natural
from pinakes.search.global_search import federated_search, parse_search_filters

logger = logging.getLogger("pinakes.search")

router = APIRouter(tags=["search"])


def _failed(message: str, error: Exception) -> JSONResponse:
    """The inline-`routes.ts` 500 spelling: ``{message, error}``.

    Not the ``{error, detail}`` the extracted route files answer with.
    """
    logger.exception("Unexpected error in %s", message)
    return JSONResponse(
        status_code=500, content={"message": message, "error": str(error)}
    )


@router.get("/api/search")
def global_search(
    q: str | None = None,
    types: str | None = None,
    sources: str | None = None,
) -> Any:
    """Unified federated search across the corpus and the shared graph."""
    if not q or not q.strip():
        return {"results": [], "query": "", "totalCount": 0}
    try:
        return federated_search(q, lexicons_dir(), parse_search_filters(types, sources))
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("Failed to perform search", error)


@router.get("/api/search/natural")
def natural_language_search(q: str | None = None) -> Any:
    """Natural-language search: parse the sentence, then run it spatially."""
    if not q or not q.strip():
        return {"results": [], "query": {"raw": ""}, "totalCount": 0}
    try:
        parsed = natural.parse_natural_language_query(q)
        return natural.spatial_search(parsed, lexicons_dir())
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("Failed to perform natural language search", error)


@router.get("/api/search/spatial")
def spatial_search(
    lat: str | None = None,
    lng: str | None = None,
    year: str | None = None,
    radius: str | None = None,
) -> Any:
    """Everything within `radius` km of a point, optionally at a year."""
    latitude = js_parse_float(lat or "")
    longitude = js_parse_float(lng or "")
    if math.isnan(latitude) or math.isnan(longitude):
        return JSONResponse(
            status_code=400,
            content={"message": "lat and lng are required numeric parameters"},
        )
    try:
        # `req.query.year ? parseInt(...) : null`, then `isNaN(year) ? null : year`
        # — a present-but-unparseable year is *no* year filter, not a 400.
        parsed_year = js_parse_int(year) if year else math.nan
        # An unparseable radius stays NaN, and `distance > NaN` is false — so
        # `?radius=abc` widens the search to everything rather than narrowing it
        # to nothing. Reproduced from the TypeScript rather than tightened.
        parsed_radius = (
            js_parse_int(radius) if radius else float(natural.CLICK_RADIUS_KM)
        )
        return natural.what_was_here(
            latitude,
            longitude,
            None if math.isnan(parsed_year) else int(parsed_year),
            lexicons_dir(),
            radius_km=parsed_radius,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("Failed to perform spatial search", error)


@router.get("/api/search/suggestions")
def search_suggestions(q: str | None = None) -> Any:
    """Autocomplete suggestions for a partial query."""
    try:
        return {"suggestions": natural.query_suggestions(q or "")}
    except Exception:  # noqa: BLE001 - the one handler with no `error` field
        logger.exception("Unexpected error in search suggestions")
        return JSONResponse(
            status_code=500, content={"message": "Failed to get suggestions"}
        )
