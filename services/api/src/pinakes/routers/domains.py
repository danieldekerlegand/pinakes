"""The flat catalog domains — forty reads over loaders that already existed.

The cutover's second slice (pinakes:80 US-1, continued): eighteen `list` + `{id}`
route groups from `server/routes.ts`, every one of them an adapter over a
:mod:`pinakes.lexicons.storage` loader landed by an earlier band. What is new is
:mod:`pinakes.lexicons.domains` — the `get<Domain>(filters)` half — plus the
envelopes, which are the actual work here.

**No two of these groups answer the same shape, and none of it is negotiable.**
`/api/battles` answers `{battles, count}`, `/api/religions` answers
`{religions, count, filters}`, `/api/cuisines/{id}` answers a *spread* of
`{cuisine, items}` with an `itemCount` and a `filters` beside it, and
`/api/settlements/nearby` adds `center` and `radiusKm`. Each key is what the
client destructures; a regularised envelope here would be a client rewrite
wearing a port's clothes.

Three rules run through the file:

* **`filters` echoes the *parsed* value, and `JSON.stringify` drops the absent
  ones.** `?year=` sends no `year` key back; `?year=soon` sends `"year": null`,
  because `parseInt` gave `NaN` and `JSON.stringify` writes `NaN` as `null`.
  :func:`_echo` is both of those, and it is why the numeric parameters are read
  as strings and parsed here rather than declared (see `routers/graph.py`: a
  declared `int` answers 422 where Express answered with the whole table).
* **Two spellings of a 500 live side by side.** Every handler in this file
  answers `{message, error}` except the four settlement routes, which answer
  `{message}` alone. Both were inline in `routes.ts`; the split is theirs.
* **A 404 message is either templated with the id or not**, likewise per group:
  `Cuisine 'x' not found` against a bare `Settlement not found`. Copied one by
  one.
"""

from __future__ import annotations

import logging
import math
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from pinakes.analytics import tsv
from pinakes.analytics.jsmath import js_number
from pinakes.lexicons import domains, storage
from pinakes.paths import lexicons_dir
from pinakes.routers import _reads

logger = logging.getLogger("pinakes.domains")

router = APIRouter(tags=["catalog"])


# ── The four shapes every handler below is built out of ──────────────────────
#
# All five live in `routers/_reads.py`; three more router files use them now.
# The two aliases below are the *choice* this file makes — which 500 spelling a
# given handler answers with — and are worth keeping local for that reason.


def _failed(context: str, message: str, error: Exception) -> JSONResponse:
    """The `{message, error}` 500 the mythology/cuisine/craft handlers answer."""
    return _reads.failed(logger, context, message, error)


def _failed_plain(context: str, message: str) -> JSONResponse:
    """The `{message}`-only 500 the four settlement handlers answer."""
    return _reads.failed_plain(logger, context, message)


_missing = _reads.missing
_text = _reads.text
_int = _reads.query_int
_echo = _reads.echo


def _float(request: Request, key: str) -> float | None:
    """The `parseFloat` read, for the two fractional parameters in this file."""
    raw = request.query_params.get(key)
    if not raw:
        return None
    return tsv.js_parse_float(raw)


# ── Religions ────────────────────────────────────────────────────────────────


@router.get("/api/religions")
def religions(request: Request) -> Any:
    """The religion table, filtered by year / region / type / language."""
    year = _int(request, "year")
    region = _text(request, "region")
    religion_type = _text(request, "religionType")
    language_id = _text(request, "languageId")
    try:
        found = domains.filter_religions(
            storage.load_religions(lexicons_dir()),
            year=year,
            region=region,
            religion_type=religion_type,
            language_id=language_id,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching religions", "Failed to fetch religions", error)
    return {
        "religions": found,
        "count": len(found),
        "filters": _echo(
            year=year,
            region=region,
            religionType=religion_type,
            languageId=language_id,
        ),
    }


@router.get("/api/religions/{id}")
def religion(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_religions(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching religion", "Failed to fetch religion", error)
    if found is None:
        return _missing(f"Religion '{id}' not found")
    return found


# ── Urheimat hypotheses ──────────────────────────────────────────────────────


@router.get("/api/urheimat-hypotheses")
def urheimat_hypotheses(request: Request) -> Any:
    """Proposed homelands, filtered by family and by a scholarly-consensus floor.

    The echoed keys are `languageFamilyId` and `consensusMin` — the handler's
    *local variable* names, which are not the query parameters (`language_family`
    and `consensus_min`) they were read from. Reproduced: the client reads the
    echo back by those names.
    """
    language_family = _text(request, "language_family")
    consensus_min = _float(request, "consensus_min")
    try:
        found = domains.filter_urheimat_hypotheses(
            storage.load_urheimat_hypotheses(lexicons_dir()),
            language_family=language_family,
            consensus_min=consensus_min,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching urheimat hypotheses",
            "Failed to fetch urheimat hypotheses",
            error,
        )
    return {
        "hypotheses": found,
        "count": len(found),
        "filters": _echo(languageFamilyId=language_family, consensusMin=consensus_min),
    }


@router.get("/api/urheimat-hypotheses/{id}")
def urheimat_hypothesis(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_urheimat_hypotheses(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching urheimat hypothesis", "Failed to fetch urheimat hypothesis", error
        )
    if found is None:
        return _missing(f"Urheimat hypothesis '{id}' not found")
    return found


# ── Mythology ────────────────────────────────────────────────────────────────


@router.get("/api/deities")
def deities(request: Request) -> Any:
    mythology = _text(request, "mythology")
    domain = _text(request, "domain")
    year = _int(request, "year")
    try:
        found = domains.filter_deities(
            storage.load_deities(lexicons_dir()),
            mythology=mythology,
            domain=domain,
            year=year,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching deities", "Failed to fetch deities", error)
    return {
        "deities": found,
        "count": len(found),
        "filters": _echo(mythology=mythology, domain=domain, year=year),
    }


@router.get("/api/deities/{id}/equivalents")
def deity_equivalents(id: str) -> Any:
    """The deities this one is syncretised with — `[]` for an unknown id.

    Registered ahead of `/api/deities/{id}` for readability only; the two paths
    have different segment counts and cannot shadow each other.
    """
    try:
        found = domains.deity_equivalents(storage.load_deities(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching deity equivalents", "Failed to fetch deity equivalents", error
        )
    return {"equivalents": found, "count": len(found)}


@router.get("/api/deities/{id}/motifs")
def deity_motifs(id: str) -> Any:
    """Every myth motif naming this deity. No deity read, so no 404."""
    try:
        found = domains.motifs_by_deity(storage.load_myth_motifs(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching motifs for deity", "Failed to fetch motifs for deity", error
        )
    return {"motifs": found, "count": len(found)}


@router.get("/api/deities/{id}")
def deity(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_deities(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching deity", "Failed to fetch deity", error)
    if found is None:
        return _missing(f"Deity '{id}' not found")
    return found


@router.get("/api/myth-motifs")
def myth_motifs(request: Request) -> Any:
    """Landed with the deity routes because they share `myth-motifs.tsv`."""
    motif_type = _text(request, "motifType")
    mythology = _text(request, "mythology")
    region = _text(request, "region")
    try:
        found = domains.filter_myth_motifs(
            storage.load_myth_motifs(lexicons_dir()),
            motif_type=motif_type,
            mythology=mythology,
            region=region,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching myth motifs", "Failed to fetch myth motifs", error)
    return {
        "motifs": found,
        "count": len(found),
        "filters": _echo(motifType=motif_type, mythology=mythology, region=region),
    }


@router.get("/api/myth-motifs/{id}")
def myth_motif(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_myth_motifs(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching myth motif", "Failed to fetch myth motif", error)
    if found is None:
        return _missing(f"Myth motif '{id}' not found")
    return found


# ── Cuisines ─────────────────────────────────────────────────────────────────


@router.get("/api/cuisines")
def cuisines(request: Request) -> Any:
    year = _int(request, "year")
    region = _text(request, "region")
    try:
        found = domains.filter_cuisines(
            storage.load_cuisines(lexicons_dir()), year=year, region=region
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching cuisines", "Failed to fetch cuisines", error)
    return {
        "cuisines": found,
        "count": len(found),
        "filters": _echo(year=year, region=region),
    }


@router.get("/api/cuisines/{id}")
def cuisine(id: str, request: Request) -> Any:
    """One cuisine and its dishes — the pair **spread**, not nested under a key."""
    year = _int(request, "year")
    try:
        lexicons = lexicons_dir()
        found = domains.cuisine_with_items(
            storage.load_cuisines(lexicons),
            storage.load_cuisine_items(lexicons),
            id,
            year=year,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching cuisine", "Failed to fetch cuisine", error)
    if found is None:
        return _missing(f"Cuisine '{id}' not found")
    return {
        **found,
        "itemCount": len(found["items"]),
        "filters": _echo(year=year),
    }


@router.get("/api/cuisine-items")
def cuisine_items(request: Request) -> Any:
    cuisine_id = _text(request, "cuisineId")
    year = _int(request, "year")
    food_type = _text(request, "foodType")
    try:
        found = domains.filter_cuisine_items(
            storage.load_cuisine_items(lexicons_dir()),
            cuisine_id=cuisine_id,
            year=year,
            food_type=food_type,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching cuisine items", "Failed to fetch cuisine items", error)
    return {
        "items": found,
        "count": len(found),
        "filters": _echo(cuisineId=cuisine_id, year=year, foodType=food_type),
    }


# ── Music ────────────────────────────────────────────────────────────────────


@router.get("/api/music-traditions")
def music_traditions(request: Request) -> Any:
    year = _int(request, "year")
    region = _text(request, "region")
    language_id = _text(request, "languageId")
    try:
        found = domains.filter_music_traditions(
            storage.load_music_traditions(lexicons_dir()),
            year=year,
            region=region,
            language_id=language_id,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching music traditions", "Failed to fetch music traditions", error
        )
    return {
        "traditions": found,
        "count": len(found),
        "filters": _echo(year=year, region=region, languageId=language_id),
    }


@router.get("/api/music-traditions/{id}")
def music_tradition(id: str) -> Any:
    """One tradition plus the instruments that name it. Spread, like cuisines."""
    try:
        lexicons = lexicons_dir()
        found = domains.music_tradition_with_instruments(
            storage.load_music_traditions(lexicons),
            storage.load_musical_instruments(lexicons),
            id,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching music tradition", "Failed to fetch music tradition", error
        )
    if found is None:
        return _missing(f"Music tradition '{id}' not found")
    return {**found, "instrumentCount": len(found["instruments"])}


@router.get("/api/musical-instruments")
def musical_instruments(request: Request) -> Any:
    family = _text(request, "family")
    tradition_id = _text(request, "traditionId")
    older_than = _int(request, "olderThan")
    try:
        found = domains.filter_musical_instruments(
            storage.load_musical_instruments(lexicons_dir()),
            family=family,
            tradition_id=tradition_id,
            older_than=older_than,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching musical instruments", "Failed to fetch musical instruments", error
        )
    return {
        "instruments": found,
        "count": len(found),
        "filters": _echo(family=family, traditionId=tradition_id, olderThan=older_than),
    }


# ── Writing systems ──────────────────────────────────────────────────────────


@router.get("/api/writing-systems")
def writing_systems(request: Request) -> Any:
    """No `filters` echo in this group — the three parameters go unreported."""
    try:
        found = domains.filter_writing_systems(
            storage.load_writing_systems(lexicons_dir()),
            type_=_text(request, "type"),
            direction=_text(request, "direction"),
            is_active=_text(request, "is_active"),
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching writing systems", "Failed to fetch writing systems", error
        )
    return {"systems": found, "count": len(found)}


@router.get("/api/writing-systems/{id}/descendants")
def writing_system_descendants(id: str) -> Any:
    """The parent and its whole descent, breadth-first. 404s on the parent."""
    try:
        systems = storage.load_writing_systems(lexicons_dir())
        parent = storage.find_by_id(systems, id)
        if parent is None:
            return _missing(f"Writing system '{id}' not found")
        found = domains.writing_system_descendants(systems, id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching writing system descendants",
            "Failed to fetch writing system descendants",
            error,
        )
    return {"parent": parent, "descendants": found, "count": len(found)}


@router.get("/api/writing-systems/{id}")
def writing_system(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_writing_systems(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching writing system", "Failed to fetch writing system", error
        )
    if found is None:
        return _missing(f"Writing system '{id}' not found")
    return found


# ── Battles and migration routes ─────────────────────────────────────────────


@router.get("/api/battles")
def battles(request: Request) -> Any:
    try:
        found = domains.filter_battles(
            storage.load_battles(lexicons_dir()),
            war_name=_text(request, "war_name"),
            start_date=_text(request, "start_date"),
            end_date=_text(request, "end_date"),
            civilization_id=_text(request, "civilization_id"),
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching battles", "Failed to fetch battles", error)
    return {"battles": found, "count": len(found)}


@router.get("/api/battles/{id}")
def battle(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_battles(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching battle", "Failed to fetch battle", error)
    if found is None:
        return _missing(f"Battle '{id}' not found")
    return found


@router.get("/api/migration-routes")
def migration_routes(request: Request) -> Any:
    try:
        found = domains.filter_migration_routes(
            storage.load_migration_routes(lexicons_dir()),
            route_type=_text(request, "route_type"),
            start_date=_text(request, "start_date"),
            end_date=_text(request, "end_date"),
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching migration routes", "Failed to fetch migration routes", error
        )
    return {"routes": found, "count": len(found)}


@router.get("/api/migration-routes/{id}")
def migration_route(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_migration_routes(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching migration route", "Failed to fetch migration route", error
        )
    if found is None:
        return _missing(f"Migration route '{id}' not found")
    return found


# ── Foodways, art and architecture ───────────────────────────────────────────


@router.get("/api/foodway-events")
def foodway_events(request: Request) -> Any:
    try:
        found = domains.filter_foodway_events(
            storage.load_foodway_events(lexicons_dir()),
            food_item=_text(request, "food_item"),
            mechanism=_text(request, "mechanism"),
            date_start=_int(request, "date_start"),
            date_end=_int(request, "date_end"),
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching foodway events", "Failed to fetch foodway events", error
        )
    return {"events": found, "count": len(found)}


@router.get("/api/foodway-events/{id}")
def foodway_event(id: str) -> Any:
    """The first of the six 404s that do **not** name the id. Kept as found."""
    try:
        found = storage.find_by_id(storage.load_foodway_events(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching foodway event", "Failed to fetch foodway event", error)
    if found is None:
        return _missing("Foodway event not found")
    return found


@router.get("/api/art-traditions")
def art_traditions(request: Request) -> Any:
    try:
        found = domains.filter_art_traditions(
            storage.load_art_traditions(lexicons_dir()),
            category=_text(request, "category"),
            style_period=_text(request, "style_period"),
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching art traditions", "Failed to fetch art traditions", error
        )
    return {"traditions": found, "count": len(found)}


@router.get("/api/art-traditions/{id}")
def art_tradition(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_art_traditions(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching art tradition", "Failed to fetch art tradition", error)
    if found is None:
        return _missing("Art tradition not found")
    return found


@router.get("/api/architectural-styles")
def architectural_styles(request: Request) -> Any:
    try:
        found = domains.filter_architectural_styles(
            storage.load_architectural_styles(lexicons_dir()),
            style_period=_text(request, "style_period"),
            region=_text(request, "region"),
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching architectural styles",
            "Failed to fetch architectural styles",
            error,
        )
    return {"styles": found, "count": len(found)}


@router.get("/api/architectural-styles/by-building-type/{buildingTypeId}")
def architectural_styles_by_building_type(buildingTypeId: str) -> Any:
    try:
        found = domains.styles_by_building_type(
            storage.load_architectural_styles(lexicons_dir()), buildingTypeId
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching architectural styles by building type",
            "Failed to fetch architectural styles by building type",
            error,
        )
    return {"styles": found, "count": len(found)}


@router.get("/api/architectural-styles/{id}")
def architectural_style(id: str) -> Any:
    try:
        found = storage.find_by_id(
            storage.load_architectural_styles(lexicons_dir()), id
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching architectural style", "Failed to fetch architectural style", error
        )
    if found is None:
        return _missing("Architectural style not found")
    return found


# ── Kinship, trade and innovation ────────────────────────────────────────────


@router.get("/api/kinship-systems")
def kinship_systems(request: Request) -> Any:
    try:
        found = domains.filter_kinship_systems(
            storage.load_kinship_systems(lexicons_dir()),
            system_type=_text(request, "system_type"),
            descent_rule=_text(request, "descent_rule"),
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching kinship systems", "Failed to fetch kinship systems", error
        )
    return {"systems": found, "count": len(found)}


@router.get("/api/kinship-systems/{id}")
def kinship_system(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_kinship_systems(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching kinship system", "Failed to fetch kinship system", error
        )
    if found is None:
        return _missing("Kinship system not found")
    return found


@router.get("/api/trade-goods")
def trade_goods(request: Request) -> Any:
    try:
        found = domains.filter_trade_goods(
            storage.load_trade_goods(lexicons_dir()),
            category=_text(request, "category"),
            time_period=_text(request, "time_period"),
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching trade goods", "Failed to fetch trade goods", error)
    return {"goods": found, "count": len(found)}


@router.get("/api/trade-goods/{id}")
def trade_good(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_trade_goods(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching trade good", "Failed to fetch trade good", error)
    if found is None:
        return _missing("Trade good not found")
    return found


@router.get("/api/innovations")
def innovations(request: Request) -> Any:
    try:
        found = domains.filter_innovations(
            storage.load_innovations(lexicons_dir()),
            category=_text(request, "category"),
            culture_profile_id=_text(request, "culture_profile_id"),
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching innovations", "Failed to fetch innovations", error)
    return {"innovations": found, "count": len(found)}


@router.get("/api/innovations/{id}")
def innovation(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_innovations(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching innovation", "Failed to fetch innovation", error)
    if found is None:
        return _missing("Innovation not found")
    return found


# ── Settlements ──────────────────────────────────────────────────────────────
#
# The four routes whose 500 is `{message}` alone.


@router.get("/api/settlements")
def settlements(request: Request) -> Any:
    """The settlement table. The bounding box is **all four corners or none**.

    `if (min_lat && max_lat && min_lng && max_lng)` — a request with three of
    them is not a rejection and not a partial cull; the box simply does not
    apply. Kept, because the map sends all four or nothing.
    """
    corners = [
        request.query_params.get(key)
        for key in ("min_lat", "max_lat", "min_lng", "max_lng")
    ]
    bounding_box = None
    if all(corners):
        bounding_box = {
            "minLat": tsv.js_parse_float(str(corners[0])),
            "maxLat": tsv.js_parse_float(str(corners[1])),
            "minLng": tsv.js_parse_float(str(corners[2])),
            "maxLng": tsv.js_parse_float(str(corners[3])),
        }
    try:
        found = domains.filter_settlements(
            storage.load_settlements(lexicons_dir()),
            civilization_id=_text(request, "civilization_id"),
            culture_id=_text(request, "culture_id"),
            type_=_text(request, "type"),
            region=_text(request, "region"),
            time_start=_int(request, "time_start"),
            time_end=_int(request, "time_end"),
            bounding_box=bounding_box,
        )
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _failed_plain("fetching settlements", "Failed to fetch settlements")
    return {"settlements": found, "count": len(found)}


@router.get("/api/settlements/by-civilization/{civilizationId}")
def settlements_by_civilization(civilizationId: str) -> Any:
    try:
        found = domains.settlements_by_civilization(
            storage.load_settlements(lexicons_dir()), civilizationId
        )
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _failed_plain(
            "fetching settlements by civilization",
            "Failed to fetch settlements by civilization",
        )
    return {"settlements": found, "count": len(found)}


@router.get("/api/settlements/nearby/{lat}/{lng}")
def settlements_nearby(lat: str, lng: str, request: Request) -> Any:
    """Settlements within `radius` km of a point, nearest first.

    Both coordinates are `parseFloat`d rather than declared, so a non-numeric
    segment is the documented **400** and not a 422 — and `radius` is read the
    same way but unchecked, so `?radius=near` is `NaN`, every `<=` against it is
    false, and the answer is an empty list with `"radiusKm": null`.
    """
    latitude = tsv.js_parse_float(lat)
    longitude = tsv.js_parse_float(lng)
    if math.isnan(latitude) or math.isnan(longitude):
        return JSONResponse(status_code=400, content={"message": "Invalid coordinates"})
    raw_radius = request.query_params.get("radius")
    radius = (
        tsv.js_parse_float(raw_radius)
        if raw_radius
        else domains.DEFAULT_NEARBY_RADIUS_KM
    )
    try:
        found = domains.settlements_nearby(
            storage.load_settlements(lexicons_dir()), latitude, longitude, radius
        )
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _failed_plain(
            "fetching nearby settlements", "Failed to fetch nearby settlements"
        )
    return {
        "settlements": found,
        "count": len(found),
        "center": {"lat": js_number(latitude), "lng": js_number(longitude)},
        "radiusKm": None if math.isnan(radius) else js_number(radius),
    }


@router.get("/api/settlements/{id}")
def settlement(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_settlements(lexicons_dir()), id)
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _failed_plain("fetching settlement", "Failed to fetch settlement")
    if found is None:
        return _missing("Settlement not found")
    return found
