"""The geospatial corpus — the map's layers and the four flat groups beside them.

The cutover's third slice (pinakes:80 US-1, continued): the nine corpus-backed
`/api/map/*` endpoints plus `trade-routes`, `material-culture`,
`archaeological-cultures` and `empires-timeline`, whose loaders are the same
eight files. `geo/bbox.py` has been sitting here with no route since pinakes:63
US-2 waiting for exactly this — the viewport culling is *its*, and this module
grows no second one.

Four things in here are contract rather than implementation.

* **`metadata` is not one shape.** Five layers answer `{...filters, ...meta}` —
  the request's own filters with the viewport report merged over them, which
  means the raw `bbox` **string** the handler echoed is overwritten by the
  *parsed* box (or `null`) from `meta`, in the position the string held. Four
  layers answer the bare `filters` and never call `applyViewport` at all, so
  their `bbox` stays the string it arrived as. Which layer does which is not
  guessable; it is copied route by route.
* **`/api/trade-routes` and `/api/trade-routes/{id}` read different files.**
  `routes.ts` registers `GET /api/trade-routes` **twice** — once as a GeoJSON
  convenience view over `migration-routes.tsv` filtered to `routeTypes:
  ["trade"]`, once as a flat list over `trade-routes.tsv` — and Express matches
  in registration order, so the first wins and the second is dead. The `{id}`
  route has only one registration, over the *dead* one's loader. Reproduced;
  `test_map_routes.py` pins it.
* **`GET /api/map/empires-timeline` is a 500 on this corpus, on both backends.**
  `loadEmpiresTimeline` requires a `name` column and `empires-timeline.tsv` has
  the *event* vocabulary instead, so `getIdx` throws. The flat
  `/api/empires-timeline` group reads the same file through the loader that
  matches it. A port that quietly made the map layer answer 200 would be a
  behaviour change dressed as a fix.
* **Numeric parameters are parsed, never declared** — `routers/domains._echo`'s
  three rules apply verbatim here, and this module imports that helper rather
  than restating it.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from pinakes.geo.bbox import apply_viewport, viewport_options_from_query
from pinakes.lexicons import layers, storage
from pinakes.paths import lexicons_dir
from pinakes.routers._owner import json_body
from pinakes.routers.domains import _echo, _failed, _failed_plain, _int, _missing, _text

logger = logging.getLogger("pinakes.map")

router = APIRouter(tags=["map"])

#: The bulk fetch's body, read rather than declared — a declared model would
#: answer 422 where Express answered 400 with its own message. Same rule as
#: `routers/collections.py`; `json_body` is the shared reader.
Body = Annotated[Any, Depends(json_body)]


# ── Reading a query string the way Express handed one to these handlers ──────


def _string_param(request: Request, key: str) -> str | None:
    """``req.query.k as string`` — the raw value, or ``None`` when absent.

    Not `_text`: this returns the value **only when the parameter appears once**.
    Express hands a repeated parameter over as an array, and every read below
    that is annotated `as string` (or run through `viewportOptionsFromQuery`'s
    `typeof v === "string"` guard) treats an array as absent. A blank value is a
    real blank — these are the reads whose `filters` echo carries `""`.
    """
    values = request.query_params.getlist(key)
    return values[0] if len(values) == 1 else None


def _list_param(request: Request, key: str) -> list[str] | None:
    """``x ? (Array.isArray(x) ? x : [x]) : undefined`` — the multi-value read.

    One occurrence becomes a one-element list, several stay a list, and **a
    single blank occurrence is the filter's absence** because `""` is falsy —
    while `?familyIds=&familyIds=x` is an array, which is truthy, so the blank
    survives into the set and matches nothing.
    """
    values = request.query_params.getlist(key)
    if not values:
        return None
    if len(values) == 1:
        return [values[0]] if values[0] else None
    return values


def _viewport(request: Request) -> Any:
    """``viewportOptionsFromQuery(req.query)`` over this request's query string."""
    return viewport_options_from_query(
        bbox=_string_param(request, "bbox"),
        limit=_string_param(request, "limit"),
        offset=_string_param(request, "offset"),
    )


def _collection(features: list[Any], metadata: dict[str, Any]) -> dict[str, Any]:
    """The `{type, features, metadata}` envelope eight of these layers answer."""
    return {"type": "FeatureCollection", "features": features, "metadata": metadata}


# ── The GeoJSON layers ───────────────────────────────────────────────────────


@router.get("/api/map/language-ranges")
def language_ranges(request: Request) -> Any:
    """Language territories as polygons, culled to the viewport."""
    time_start = _int(request, "timeStart")
    time_end = _int(request, "timeEnd")
    bbox = _string_param(request, "bbox")
    family_ids = _list_param(request, "familyIds")
    try:
        found = layers.filter_language_ranges(
            storage.load_language_ranges(lexicons_dir()),
            time_start=time_start,
            time_end=time_end,
            family_ids=family_ids,
        )
        page, meta = apply_viewport(found, _viewport(request))
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching language ranges", "Failed to fetch language ranges", error
        )
    return _collection(
        page,
        {
            **_echo(
                timeStart=time_start,
                timeEnd=time_end,
                bbox=bbox,
                familyIds=family_ids,
            ),
            **meta,
        },
    )


@router.get("/api/map/language-range-polygons")
def language_range_polygons(request: Request) -> Any:
    """The expanded polygon dataset — the same layer plus a `rangeType` filter."""
    time_start = _int(request, "timeStart")
    time_end = _int(request, "timeEnd")
    bbox = _string_param(request, "bbox")
    family_ids = _list_param(request, "familyIds")
    range_type = _string_param(request, "rangeType")
    try:
        found = layers.filter_language_range_polygons(
            storage.load_language_range_polygons(lexicons_dir()),
            time_start=time_start,
            time_end=time_end,
            family_ids=family_ids,
            range_type=range_type,
        )
        page, meta = apply_viewport(found, _viewport(request))
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching language range polygons",
            "Failed to fetch language range polygons",
            error,
        )
    return _collection(
        page,
        {
            **_echo(
                timeStart=time_start,
                timeEnd=time_end,
                bbox=bbox,
                familyIds=family_ids,
                rangeType=range_type,
            ),
            **meta,
        },
    )


@router.get("/api/map/archaeological-sites")
def archaeological_sites(request: Request) -> Any:
    """Excavated sites as points, culled to the viewport."""
    time_start = _int(request, "timeStart")
    time_end = _int(request, "timeEnd")
    bbox = _string_param(request, "bbox")
    site_types = _list_param(request, "siteTypes")
    try:
        found = layers.filter_archaeological_sites(
            storage.load_archaeological_sites(lexicons_dir()),
            time_start=time_start,
            time_end=time_end,
            site_types=site_types,
        )
        page, meta = apply_viewport(found, _viewport(request))
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching archaeological sites",
            "Failed to fetch archaeological sites",
            error,
        )
    return _collection(
        page,
        {
            **_echo(
                timeStart=time_start,
                timeEnd=time_end,
                bbox=bbox,
                siteTypes=site_types,
            ),
            **meta,
        },
    )


@router.get("/api/map/archaeological-cultures")
def map_archaeological_cultures(request: Request) -> Any:
    """Archaeological cultures, wrapped as a FeatureCollection they are not.

    The handler labels the payload `"FeatureCollection"` and puts the flat
    *records* `getArchaeologicalCultures` returns in its `features` array — they
    have `id`/`name`/`coordinates`, not `type`/`geometry`/`properties`. Kept:
    the client reads `features[].coordinates` off this route by name.
    """
    time_start = _int(request, "timeStart")
    time_end = _int(request, "timeEnd")
    region = _string_param(request, "region")
    try:
        found = layers.filter_archaeological_cultures(
            storage.load_archaeological_cultures(lexicons_dir()),
            region=region,
            time_start=time_start,
            time_end=time_end,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching archaeological cultures",
            "Failed to fetch archaeological cultures",
            error,
        )
    return _collection(
        found, _echo(timeStart=time_start, timeEnd=time_end, region=region)
    )


@router.get("/api/map/civilizations")
def map_civilizations(request: Request) -> Any:
    """Civilization boundaries — the map's primary layer, and the graded one."""
    time_start = _int(request, "timeStart")
    time_end = _int(request, "timeEnd")
    bbox = _string_param(request, "bbox")
    try:
        found = layers.filter_civilizations(
            storage.load_civilizations(lexicons_dir()),
            time_start=time_start,
            time_end=time_end,
        )
        page, meta = apply_viewport(found, _viewport(request))
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching civilizations", "Failed to fetch civilizations", error)
    return _collection(
        page,
        {**_echo(timeStart=time_start, timeEnd=time_end, bbox=bbox), **meta},
    )


@router.get("/api/map/empires-timeline")
def map_empires_timeline(request: Request) -> Any:
    """Empire phases as polygons — **a 500 on this corpus**, deliberately.

    See the module docstring: the loader requires a `name` column the file does
    not have. The handler is a faithful port and answers whatever the loader
    does, so it becomes a 200 the day the corpus grows the phase vocabulary.
    """
    time_start = _int(request, "timeStart")
    time_end = _int(request, "timeEnd")
    empire_id = _string_param(request, "empireId")
    phase = _string_param(request, "phase")
    try:
        found = layers.filter_empires_timeline(
            storage.load_empires_timeline(lexicons_dir()),
            time_start=time_start,
            time_end=time_end,
            empire_id=empire_id,
            phase=phase,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching empires timeline", "Failed to fetch empires timeline", error
        )
    return _collection(
        found,
        _echo(timeStart=time_start, timeEnd=time_end, empireId=empire_id, phase=phase),
    )


@router.get("/api/map/routes")
def map_routes(request: Request) -> Any:
    """Historical routes as LineStrings. No viewport culling — `bbox` is echoed
    back as the raw string it arrived as, and filters nothing."""
    time_start = _int(request, "timeStart")
    time_end = _int(request, "timeEnd")
    bbox = _string_param(request, "bbox")
    route_types = _list_param(request, "routeTypes")
    try:
        found = layers.filter_historical_routes(
            storage.load_historical_routes(lexicons_dir()),
            time_start=time_start,
            time_end=time_end,
            route_types=route_types,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching historical routes", "Failed to fetch historical routes", error
        )
    return _collection(
        found,
        _echo(
            timeStart=time_start,
            timeEnd=time_end,
            bbox=bbox,
            routeTypes=route_types,
        ),
    )


@router.get("/api/map/material-cultures")
def map_material_cultures(request: Request) -> Any:
    """The material-culture heat map: `{distributions, metadata}`, not GeoJSON."""
    time_start = _int(request, "timeStart")
    time_end = _int(request, "timeEnd")
    bbox = _string_param(request, "bbox")
    culture_types = _list_param(request, "cultureTypes")
    try:
        found = layers.material_culture_distributions(
            storage.load_material_cultures(lexicons_dir()),
            time_start=time_start,
            time_end=time_end,
            culture_types=culture_types,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching material cultures", "Failed to fetch material cultures", error
        )
    return {
        "distributions": found,
        "metadata": _echo(
            timeStart=time_start,
            timeEnd=time_end,
            bbox=bbox,
            cultureTypes=culture_types,
        ),
    }


# ── The bulk layer fetch ─────────────────────────────────────────────────────


@router.post("/api/map/features")
def map_features(body: Body) -> Any:
    """Several layers in one request — what the map asks for on first paint.

    Two things are unlike every layer above. The filters come out of the **body**
    and are passed through *unparsed*, so a client sending `"-3000"` gets
    JavaScript's string/number comparison rather than a parsed year; and an
    unrecognised layer name is answered with an empty FeatureCollection rather
    than refused, so a client can ask for a layer this server does not have yet
    and render the ones it does.
    """
    payload = body if isinstance(body, dict) else {}
    requested = payload.get("layers")
    if not isinstance(requested, list) or not requested:
        return JSONResponse(
            status_code=400, content={"message": "layers must be a non-empty array"}
        )

    time_start = payload.get("timeStart")
    time_end = payload.get("timeEnd")
    # `bbox` is read into `filters` over there and no storage method looks at it,
    # so it reaches the response through `metadata` alone — see the echo below.
    lexicons = lexicons_dir()

    def _features(loader: Any, filter_fn: Any) -> dict[str, Any]:
        return {
            "type": "FeatureCollection",
            "features": filter_fn(
                loader(lexicons), time_start=time_start, time_end=time_end
            ),
        }

    result: dict[str, Any] = {}
    try:
        for layer in requested:
            if layer == "language-ranges":
                result[layer] = _features(
                    storage.load_language_ranges, layers.filter_language_ranges
                )
            elif layer == "archaeological-sites":
                result[layer] = _features(
                    storage.load_archaeological_sites,
                    layers.filter_archaeological_sites,
                )
            elif layer == "archaeological-cultures":
                result[layer] = {
                    "type": "FeatureCollection",
                    "features": layers.filter_archaeological_cultures(
                        storage.load_archaeological_cultures(lexicons),
                        time_start=time_start,
                        time_end=time_end,
                    ),
                }
            elif layer == "civilizations":
                result[layer] = _features(
                    storage.load_civilizations, layers.filter_civilizations
                )
            elif layer == "routes":
                result[layer] = _features(
                    storage.load_historical_routes, layers.filter_historical_routes
                )
            elif layer == "material-cultures":
                result[layer] = {
                    "distributions": layers.material_culture_distributions(
                        storage.load_material_cultures(lexicons),
                        time_start=time_start,
                        time_end=time_end,
                    )
                }
            else:
                result[layer] = {"type": "FeatureCollection", "features": []}
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching map features", "Failed to fetch map features", error)

    # `{...result, metadata}` — a layer literally named `metadata` loses to this.
    # The three filters are echoed only when the body **carried** them: a key the
    # request omitted is `undefined` in the object literal and `JSON.stringify`
    # writes no key for it. A body that sends an explicit `null` echoes `null`,
    # which is why this tests membership rather than truthiness.
    metadata: dict[str, Any] = {"layers": requested}
    for key in ("timeStart", "timeEnd", "bbox"):
        if key in payload:
            metadata[key] = payload[key]
    result["metadata"] = metadata
    return result


# ── Trade routes ─────────────────────────────────────────────────────────────


@router.get("/api/trade-routes")
def trade_routes(request: Request) -> Any:
    """Trade routes as GeoJSON — `/api/map/routes` pinned to `routeTypes=["trade"]`.

    Reads `migration-routes.tsv`, **not** `trade-routes.tsv`: this is the first
    of two registrations of the path in `routes.ts`, and Express matches in
    registration order. The envelope has a `count` and no `metadata`.
    """
    time_start = _int(request, "timeStart")
    time_end = _int(request, "timeEnd")
    try:
        found = layers.filter_historical_routes(
            storage.load_historical_routes(lexicons_dir()),
            time_start=time_start,
            time_end=time_end,
            route_types=["trade"],
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching trade routes", "Failed to fetch trade routes", error)
    return {"type": "FeatureCollection", "features": found, "count": len(found)}


@router.get("/api/trade-routes/{id}")
def trade_route(id: str) -> Any:
    """One trade route — out of `trade-routes.tsv`, which the list above never reads."""
    try:
        found = storage.find_by_id(storage.load_trade_routes(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("fetching trade route", "Failed to fetch trade route", error)
    if found is None:
        return _missing(f"Trade route '{id}' not found")
    return found


# ── Material culture ─────────────────────────────────────────────────────────


@router.get("/api/material-culture")
def material_culture(request: Request) -> Any:
    """The material-culture items themselves, filtered by exact category."""
    category = _text(request, "category")
    try:
        found = layers.filter_material_cultures(
            storage.load_material_cultures(lexicons_dir()), category=category
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching material culture", "Failed to fetch material culture", error
        )
    return {"items": found, "count": len(found)}


@router.get("/api/material-culture/{id}")
def material_culture_item(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_material_cultures(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching material culture item",
            "Failed to fetch material culture item",
            error,
        )
    if found is None:
        return _missing("Material culture item not found")
    return found


# ── Archaeological cultures ──────────────────────────────────────────────────


@router.get("/api/archaeological-cultures")
def archaeological_cultures(request: Request) -> Any:
    """The flat culture list — the same records the map layer wraps in GeoJSON.

    The query parameters are the snake_case spellings here (`time_start`,
    `region`, `language`) where the map layer uses camelCase. Both are live.
    """
    region = _text(request, "region")
    language = _text(request, "language")
    time_start = _int(request, "time_start")
    time_end = _int(request, "time_end")
    try:
        found = layers.filter_archaeological_cultures(
            storage.load_archaeological_cultures(lexicons_dir()),
            region=region,
            language_id=language,
            time_start=time_start,
            time_end=time_end,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching archaeological cultures",
            "Failed to fetch archaeological cultures",
            error,
        )
    return {"cultures": found, "count": len(found)}


@router.get("/api/archaeological-cultures/{id}")
def archaeological_culture(id: str) -> Any:
    try:
        found = storage.find_by_id(
            storage.load_archaeological_cultures(lexicons_dir()), id
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "fetching archaeological culture",
            "Failed to fetch archaeological culture",
            error,
        )
    if found is None:
        return _missing("Archaeological culture not found")
    return found


# ── Empire timeline events ───────────────────────────────────────────────────


@router.get("/api/empires-timeline")
def empires_timeline(request: Request) -> Any:
    """The empire *events* — the reading of `empires-timeline.tsv` that works.

    Both handlers in this group answer the `{message}`-only 500, unlike every
    other route in this module.
    """
    empire_id = _text(request, "empire_id")
    event_type = _text(request, "event_type")
    year_start = _int(request, "year_start")
    year_end = _int(request, "year_end")
    try:
        found = layers.filter_empire_timeline(
            storage.load_empire_timeline(lexicons_dir()),
            empire_id=empire_id,
            event_type=event_type,
            year_start=year_start,
            year_end=year_end,
        )
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _failed_plain(
            "fetching empire timeline", "Failed to fetch empire timeline"
        )
    return {"events": found, "count": len(found)}


@router.get("/api/empires-timeline/{id}")
def empires_timeline_event(id: str) -> Any:
    try:
        found = storage.find_by_id(storage.load_empire_timeline(lexicons_dir()), id)
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _failed_plain(
            "fetching empire timeline event", "Failed to fetch empire timeline event"
        )
    if found is None:
        return _missing("Empire timeline event not found")
    return found
