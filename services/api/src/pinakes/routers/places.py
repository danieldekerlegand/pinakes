"""The `/api/map/places/*` route group — place-name resolution.

Ported off the three inline handlers in `server/routes.ts` (pinakes:63 US-2)
over :mod:`pinakes.search.places`. Three endpoints, three different answers to
"nothing to search for", all preserved:

* `/search` — blank `q` ⇒ ``{results: [], query: ""}``
* `/autocomplete` — fewer than two characters ⇒ a bare ``[]`` (not an object)
* `/resolve` — blank `q` ⇒ ``{results: [], query: "", source: null}``

`limit` is read with ``parseInt`` semantics, so `?limit=abc` is ``NaN`` and
slices to an empty page rather than answering 422. Same rule as the contribution
queue's (`services/api/CLAUDE.md`), and the same reason: a stale bookmark should
not become a hard failure.

**Only `/autocomplete` is guaranteed network-free.** The other two reach
GeoNames, then Nominatim — and both degrade to local-only or empty when neither
is configured or reachable, which is the normal state of a fresh checkout
(`GEONAMES_USERNAME` is unset by default).
"""

from __future__ import annotations

import logging
import math
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from pinakes.analytics.tsv import js_parse_int
from pinakes.paths import lexicons_dir
from pinakes.search import places

logger = logging.getLogger("pinakes.places")

router = APIRouter(tags=["places"])


def _limit(raw: str | None, fallback: int) -> int:
    """``req.query.limit ? parseInt(limit) : <fallback>``.

    An unparseable limit is JavaScript's ``NaN``, which slices to an empty page.
    Python has no NaN int, so it is spelled as 0 — the same observable answer.
    """
    if not raw:
        return fallback
    parsed = js_parse_int(raw)
    return 0 if math.isnan(parsed) else int(parsed)


def _failed(message: str, error: Exception) -> JSONResponse:
    """The inline-`routes.ts` 500 spelling: ``{message, error}``."""
    logger.exception("Unexpected error in %s", message)
    return JSONResponse(
        status_code=500, content={"message": message, "error": str(error)}
    )


@router.get("/api/map/places/search")
def place_search(q: str | None = None, limit: str | None = None) -> Any:
    """Local corpus matches, topped up from an external geocoder when thin."""
    if not q or not q.strip():
        return {"results": [], "query": ""}
    try:
        return places.search_places_with_geocoder(
            q, lexicons_dir(), _limit(limit, places.SEARCH_LIMIT)
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("Failed to search places", error)


@router.get("/api/map/places/autocomplete")
def place_autocomplete(q: str | None = None, limit: str | None = None) -> Any:
    """Fast local-only autocomplete. A bare array, deliberately."""
    if not q or len(q.strip()) < 2:
        return []
    try:
        return places.autocomplete_places(
            q, lexicons_dir(), _limit(limit, places.AUTOCOMPLETE_LIMIT)
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("Failed to autocomplete places", error)


@router.get("/api/map/places/resolve")
def place_resolve(q: str | None = None, limit: str | None = None) -> Any:
    """Canonical records (name, lat/lng, `geonamesId`) with provenance."""
    if not q or not q.strip():
        return {"results": [], "query": "", "source": None}
    try:
        return places.resolve_place(q, _limit(limit, places.RESOLVE_LIMIT))
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("Failed to resolve place", error)
