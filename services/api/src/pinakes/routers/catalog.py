"""The corpus catalog's core reads — languages, families, culture profiles, stats.

The first slice of `server/routes.ts`'s catalog surface (pinakes:80 US-1), and
the one worth doing first because it is the one the parity recordings actually
grade: six of the seven fixtures still outstanding when this landed belong to
these ten routes (`get-languages`, `get-language-by-id`, `get-language-missing`,
`get-language-families`, `get-culture-profiles`, `get-culture-profile-by-id`).
Everything below is an adapter — query string in, one
:mod:`pinakes.lexicons.catalog` call, one envelope out.

**The envelopes are not uniform and that is the port.** `/api/languages` answers
a bare array, `/api/culture-profiles` answers `{profiles, count}`, and
`/api/language-families/tree` answers a bare forest. They were written at
different times by different hands; the client parses each as it is, so
regularising them here would be a client change wearing a port's clothes.

Two failure shapes, likewise inherited rather than chosen: the language routes
answer `{message}` alone, and so do these — none of the handlers in this group
carried the `{message, error}` pair that the neighbouring inline handlers use.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from pinakes.analytics import tsv
from pinakes.lexicons import catalog, storage
from pinakes.paths import lexicons_dir

logger = logging.getLogger("pinakes.catalog")

router = APIRouter(tags=["catalog"])


def _failed(message: str) -> JSONResponse:
    """The `{message}`-only 500 every handler in this group answered with."""
    return JSONResponse(status_code=500, content={"message": message})


def _query_int(request: Request, key: str) -> float | None:
    """`req.query.<key> ? parseInt(req.query.<key>, 10) : undefined`.

    Declared as a raw string and parsed here rather than as an `int` parameter,
    for the reason `routers/graph.py` documents: a declared `int` answers **422**
    where Express fell back to the default, and a stale bookmark must not become
    a hard failure. `?year=abc` therefore parses to `NaN`, which compares false
    against every bound — an empty result, not a rejection. An *empty* parameter
    is falsy in JavaScript and so is the filter's absence.
    """
    raw = request.query_params.get(key)
    if not raw:
        return None
    return tsv.js_parse_int(raw)


def _query_text(request: Request, key: str) -> str | None:
    return request.query_params.get(key)


# ── Languages and families ───────────────────────────────────────────────────


@router.get("/api/language-families")
def language_families() -> Any:
    """Every family, with its **recursive** language count."""
    try:
        return storage.language_families_with_counts(lexicons_dir())
    except Exception:  # noqa: BLE001 - reported as the Express 500
        logger.exception("failed to fetch language families")
        return _failed("Failed to fetch language families")


@router.get("/api/language-families/tree")
def language_family_tree() -> Any:
    """The same families, nested, each carrying the languages directly under it."""
    try:
        lexicons = lexicons_dir()
        return catalog.language_family_tree(
            storage.language_families_with_counts(lexicons),
            storage.load_languages(lexicons),
        )
    except Exception:  # noqa: BLE001 - reported as the Express 500
        logger.exception("failed to fetch language family tree")
        return _failed("Failed to fetch language family tree")


@router.get("/api/languages")
def languages(request: Request) -> Any:
    """The language table, filtered by family / status / region / search.

    `status` is the one repeatable parameter — Express read `req.query.status`,
    which is a *string* for one occurrence and an *array* for several, and
    wrapped the former. `getlist` is that, with no special case.
    """
    try:
        return catalog.filter_languages(
            storage.load_languages(lexicons_dir()),
            family=_query_text(request, "family"),
            statuses=request.query_params.getlist("status"),
            region=_query_text(request, "region"),
            search=_query_text(request, "search"),
        )
    except Exception:  # noqa: BLE001 - reported as the Express 500
        logger.exception("failed to fetch languages")
        return _failed("Failed to fetch languages")


@router.get("/api/languages/{id}")
def language(id: str) -> Any:
    """One language, plus the three placeholder fields `getLanguage` appended."""
    try:
        found = storage.find_by_id(storage.load_languages(lexicons_dir()), id)
    except Exception:  # noqa: BLE001 - reported as the Express 500
        logger.exception("failed to fetch language %s", id)
        return _failed("Failed to fetch language")
    if found is None:
        return JSONResponse(status_code=404, content={"message": "Language not found"})
    return catalog.language_with_stats(found)


@router.get("/api/base-words")
def base_words() -> Any:
    """The concept list — the vocabulary spine every word form hangs off.

    `load_base_words` **raises** on a missing file where every other loader
    degrades to empty (`readFileOrThrow`), so a corpus with no `words-base.tsv`
    is a 500 here rather than a silently empty concept list. Kept deliberately;
    `pinakes.search` documents the same edge.
    """
    try:
        return storage.load_base_words(lexicons_dir())
    except Exception:  # noqa: BLE001 - reported as the Express 500
        logger.exception("failed to fetch base words")
        return _failed("Failed to fetch base words")


@router.get("/api/stats")
def stats() -> Any:
    """The dashboard header's counts."""
    try:
        lexicons = lexicons_dir()
        return catalog.language_stats(
            storage.language_families_with_counts(lexicons),
            storage.load_languages(lexicons),
            storage.load_base_words(lexicons),
        )
    except Exception:  # noqa: BLE001 - reported as the Express 500
        logger.exception("failed to fetch statistics")
        return _failed("Failed to fetch statistics")


# ── Culture profiles ─────────────────────────────────────────────────────────


@router.get("/api/culture-profiles")
def culture_profiles(request: Request) -> Any:
    """The profile table, filtered by region / civilization / four traits / period."""
    try:
        return {
            "profiles": (
                profiles := catalog.filter_culture_profiles(
                    storage.load_culture_profiles(lexicons_dir()),
                    region=_query_text(request, "region"),
                    civilization_id=_query_text(request, "civilization_id"),
                    subsistence_type=_query_text(request, "subsistence_type"),
                    urbanism_level=_query_text(request, "urbanism_level"),
                    social_organization=_query_text(request, "social_organization"),
                    technology_level=_query_text(request, "technology_level"),
                    time_start=_query_int(request, "time_start"),
                    time_end=_query_int(request, "time_end"),
                )
            ),
            "count": len(profiles),
        }
    except Exception:  # noqa: BLE001 - reported as the Express 500
        logger.exception("failed to fetch culture profiles")
        return _failed("Failed to fetch culture profiles")


@router.get("/api/culture-profiles/by-civilization/{civilizationId}")
def culture_profiles_by_civilization(civilizationId: str) -> Any:
    """Every profile attributed to one civilization.

    Registered before `/api/culture-profiles/{id}` — as it was on Express, and
    for the same reason: `by-civilization` would otherwise be read as an id.
    Starlette matches in registration order, so the order in this file is the
    routing, not a formatting preference.
    """
    try:
        profiles = catalog.profiles_by_civilization(
            storage.load_culture_profiles(lexicons_dir()), civilizationId
        )
    except Exception:  # noqa: BLE001 - reported as the Express 500
        logger.exception("failed to fetch culture profiles by civilization")
        return _failed("Failed to fetch culture profiles by civilization")
    return {"profiles": profiles, "count": len(profiles)}


@router.get("/api/culture-profiles/by-location/{lat}/{lng}")
def culture_profiles_by_location(lat: str, lng: str, request: Request) -> Any:
    """Profiles whose notable settlements fall within `radius` km of a point.

    The two coordinates are `parseFloat`d rather than declared as floats, so a
    non-numeric segment is the documented **400** and not a 422. `radius` is
    read the same way but *unchecked* — `parseFloat("wide")` is `NaN`, every
    comparison against it is false, and the answer is an empty list. That is
    what Express did.
    """
    latitude = tsv.js_parse_float(lat)
    longitude = tsv.js_parse_float(lng)
    if latitude != latitude or longitude != longitude:  # NaN, JavaScript's isNaN
        return JSONResponse(
            status_code=400, content={"message": "Invalid coordinates"}
        )
    raw_radius = request.query_params.get("radius")
    radius = (
        tsv.js_parse_float(raw_radius) if raw_radius else catalog.DEFAULT_RADIUS_KM
    )
    try:
        lexicons = lexicons_dir()
        profiles = catalog.profiles_near(
            storage.load_culture_profiles(lexicons),
            storage.load_settlements(lexicons),
            latitude,
            longitude,
            radius,
        )
    except Exception:  # noqa: BLE001 - reported as the Express 500
        logger.exception("failed to fetch culture profiles by location")
        return _failed("Failed to fetch culture profiles by location")
    return {"profiles": profiles, "count": len(profiles)}


@router.get("/api/culture-profiles/{id}")
def culture_profile(id: str) -> Any:
    """One profile, or a 404 that names neither the id nor the domain twice."""
    try:
        found = storage.find_by_id(storage.load_culture_profiles(lexicons_dir()), id)
    except Exception:  # noqa: BLE001 - reported as the Express 500
        logger.exception("failed to fetch culture profile %s", id)
        return _failed("Failed to fetch culture profile")
    if found is None:
        return JSONResponse(
            status_code=404, content={"message": "Culture profile not found"}
        )
    return found
