"""The geospatial layers' filters — the `get*` half of the map's storage.

Same split as :mod:`pinakes.lexicons.domains` and for the same reason: a loader
is graded by row counts against the live corpus, a filter by which rows survive.
This module is the `get<Layer>(filters)` bodies for the eight geospatial readers
:mod:`pinakes.lexicons.storage` grew for the cutover's third slice — language
ranges and range polygons, archaeological sites and cultures, civilizations,
empire phases and empire events, historical routes, material cultures and their
heat-map distributions, and trade routes.

**Three temporal filters live here and no two agree.** That is the whole of the
subtlety in this file:

* :func:`filter_by_time` — the GeoJSON layers' shared `filterByTime`. It tests
  ``!== undefined``, so a bound of **0** is a real bound; it reads a feature's
  `properties.timePeriod`; and it is an *overlap* test — a feature survives if
  its span meets the window at all.
* :func:`filter_archaeological_cultures` — the same overlap, spelled over two
  flat columns instead of a nested `timePeriod`, and with `-Infinity`/`Infinity`
  written out per bound rather than shared.
* :func:`material_culture_distributions` — tests **truthiness**, so `?timeStart=0`
  is no filter at all, and it is a *containment* test against a single date
  rather than an overlap against a span.

Collapsing them into one would silently re-answer queries the client already
sends. The rest of the file is the ordinary vocabulary — exact matches on route
and site and culture types, a case-insensitive substring on a culture's region,
and a **lexicographic** comparison on a trade route's dates, which are strings.
"""

from __future__ import annotations

import math
from typing import Any

from pinakes.analytics.jsmath import js_number
from pinakes.analytics.tsv import js_number as parse_js_number
from pinakes.lexicons.storage import Feature, Record

#: The intensity floor a spread point decays to, and the number of years over
#: which it decays. `Math.max(0.2, 1 - timeDiff / 10000)`.
MIN_SPREAD_INTENSITY = 0.2
SPREAD_DECAY_YEARS = 10000.0


def _relational(value: Any) -> float | None:
    """One side of a JavaScript relational comparison, as a number.

    `<` and `>` coerce their operands, so `POST /api/map/features` — whose
    bounds come out of a **JSON body** and are never parsed — compares a string
    year against a numeric one and gets the answer a number would have given.
    ``None`` stands for both JavaScript's `NaN` and this module's collapsed
    unreadable value; every comparison against it is false, which is what makes
    the three helpers below agree with `res.json`'s arithmetic instead of
    raising the ``TypeError`` Python's operators would.
    """
    if value is None or isinstance(value, bool):
        return None if value is None else float(value)
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        parsed = parse_js_number(value)
        return None if math.isnan(parsed) else parsed
    return None


def _lt(left: Any, right: Any) -> bool:
    """``left < right`` with JavaScript's answer for an incomparable operand."""
    first, second = _relational(left), _relational(right)
    if first is None or second is None:
        return False
    return first < second


def _gt(left: Any, right: Any) -> bool:
    """``left > right``, same rule."""
    first, second = _relational(left), _relational(right)
    if first is None or second is None:
        return False
    return first > second


def _gte(left: Any, right: Any) -> bool:
    """``left >= right``, same rule — and the *opposite* default to :func:`_lt`.

    Which of the two a filter is written with decides what happens to an
    unreadable value, and the two filter families here disagree on purpose:
    `filterByTime` drops a feature only when it can prove it is outside the
    window (so a `NaN` keeps it), while the empire-event and culture filters
    keep a record only when they can prove it is inside (so a `NaN` drops it).
    """
    if left is None or right is None:
        return False
    return bool(left >= right)


def _lte(left: Any, right: Any) -> bool:
    """``left <= right``, same rule."""
    if left is None or right is None:
        return False
    return bool(left <= right)


def _absent(bound: float | None) -> bool:
    """``bound === undefined`` — a `NaN` bound is *present* and matches nothing."""
    return bound is None


def _truthy(bound: float | None) -> bool:
    """``!!bound`` — zero **and** `NaN` are the filter's absence."""
    if bound is None:
        return False
    return not math.isnan(bound) and bound != 0


def filter_by_time(
    features: list[Feature],
    time_start: float | None = None,
    time_end: float | None = None,
) -> list[Feature]:
    """``filterByTime`` — the overlap test the five GeoJSON layers share.

    A feature survives when its span meets the window: an open-ended feature
    (`end: null`) runs to `Infinity`, and a bound the query did not give is not
    tested. A `NaN` bound (`?timeStart=soon`) is *given* but compares false
    against everything, so it filters nothing — which is the TypeScript's answer
    and not the 422 a declared parameter would give.
    """
    if _absent(time_start) and _absent(time_end):
        return list(features)
    kept: list[Feature] = []
    for feature in features:
        period = feature["properties"]["timePeriod"]
        start = period["start"]
        end = period["end"]
        if end is None:
            end = math.inf
        if not _absent(time_start) and _lt(end, time_start):
            continue
        if not _absent(time_end) and _gt(start, time_end):
            continue
        kept.append(feature)
    return kept


def _in_set(feature: Feature, key: str, allowed: list[str] | None) -> bool:
    """``new Set(filters.x).has(f.properties.<key>)``, or no filter at all."""
    if not allowed:
        return True
    return feature["properties"].get(key) in set(allowed)


def filter_language_ranges(
    features: list[Feature],
    *,
    time_start: float | None = None,
    time_end: float | None = None,
    family_ids: list[str] | None = None,
) -> list[Feature]:
    """``getLanguageRanges`` — time overlap, then an exact family-id set."""
    kept = filter_by_time(features, time_start, time_end)
    return [feature for feature in kept if _in_set(feature, "familyId", family_ids)]


def filter_language_range_polygons(
    features: list[Feature],
    *,
    time_start: float | None = None,
    time_end: float | None = None,
    family_ids: list[str] | None = None,
    range_type: str | None = None,
) -> list[Feature]:
    """``getLanguageRangePolygons`` — the range filter plus an exact `rangeType`."""
    kept = filter_language_ranges(
        features, time_start=time_start, time_end=time_end, family_ids=family_ids
    )
    if not range_type:
        return kept
    return [
        feature
        for feature in kept
        if feature["properties"].get("rangeType") == range_type
    ]


def filter_archaeological_sites(
    features: list[Feature],
    *,
    time_start: float | None = None,
    time_end: float | None = None,
    site_types: list[str] | None = None,
) -> list[Feature]:
    """``getArchaeologicalSites`` — time overlap, then an exact site-type set."""
    kept = filter_by_time(features, time_start, time_end)
    return [feature for feature in kept if _in_set(feature, "siteType", site_types)]


def filter_civilizations(
    features: list[Feature],
    *,
    time_start: float | None = None,
    time_end: float | None = None,
) -> list[Feature]:
    """``getCivilizations`` — time overlap and nothing else.

    The handler reads a `bbox` too and passes it in, but the storage method
    ignores it; the viewport culling happens a layer up, in
    :mod:`pinakes.geo.bbox`. Kept as a separate function anyway so the layer's
    filter has a name — there is exactly one place to add to when it grows one.
    """
    return filter_by_time(features, time_start, time_end)


def filter_empires_timeline(
    features: list[Feature],
    *,
    time_start: float | None = None,
    time_end: float | None = None,
    empire_id: str | None = None,
    phase: str | None = None,
) -> list[Feature]:
    """``getEmpiresTimeline`` — time overlap, then exact empire and phase."""
    kept = filter_by_time(features, time_start, time_end)
    if empire_id:
        kept = [f for f in kept if f["properties"].get("empireId") == empire_id]
    if phase:
        kept = [f for f in kept if f["properties"].get("phase") == phase]
    return kept


def filter_historical_routes(
    features: list[Feature],
    *,
    time_start: float | None = None,
    time_end: float | None = None,
    route_types: list[str] | None = None,
) -> list[Feature]:
    """``getHistoricalRoutes`` — time overlap, then an exact route-type set.

    The set is matched against the **validated** type, so `?routeTypes=caravan`
    selects nothing while `?routeTypes=unknown` selects every route whose own
    spelling was not one of the seven.
    """
    kept = filter_by_time(features, time_start, time_end)
    return [feature for feature in kept if _in_set(feature, "routeType", route_types)]


def filter_material_cultures(
    items: list[Record], *, category: str | None = None
) -> list[Record]:
    """``getMaterialCultures`` — an exact, case-sensitive category."""
    if not category:
        return list(items)
    return [item for item in items if item.get("category") == category]


def _coordinate(pair: Any, index: int) -> Any:
    """``coords[i]`` — ``undefined`` (dropped) when the cell was not a pair."""
    if isinstance(pair, list) and index < len(pair):
        return pair[index]
    return None


def material_culture_distributions(
    items: list[Record],
    *,
    time_start: float | None = None,
    time_end: float | None = None,
    culture_types: list[str] | None = None,
) -> list[Record]:
    """``getMaterialCultureDistributions`` — the heat-map projection.

    One record becomes **one point per date**: its origin, plus one per spread
    event, each carrying an intensity that decays from 1 at the origin toward a
    floor of 0.2 over ten thousand years. Points are emitted per culture in
    corpus order, origin first — the client draws them in the order given.

    The date test here is *containment* against a single date and reads its
    bounds for **truthiness**, both unlike :func:`filter_by_time`. `?timeStart=0`
    really is no filter, and a point dated exactly on a bound is inside it.
    """
    distributions: list[Record] = []
    for item in items:
        if culture_types and item.get("category") not in culture_types:
            continue

        origin_date = item["originDate"]
        origin_in_range = (
            not _truthy(time_start) or _gte(origin_date, time_start)
        ) and (not _truthy(time_end) or _lte(origin_date, time_end))
        spread = item["spreadData"]
        if origin_in_range:
            distributions.append(
                {
                    "lat": _coordinate(item["originCoordinates"], 0),
                    "lng": _coordinate(item["originCoordinates"], 1),
                    "intensity": 1,
                    "cultureId": item["id"],
                    "timePeriod": {
                        "start": origin_date,
                        "end": spread[-1]["date"] if spread else None,
                        "label": item["name"],
                    },
                }
            )

        for event in spread:
            date = event.get("date")
            in_range = (not _truthy(time_start) or _gte(date, time_start)) and (
                not _truthy(time_end) or _lte(date, time_end)
            )
            if not in_range:
                continue
            distributions.append(
                {
                    "lat": _coordinate(event.get("coordinates"), 0),
                    "lng": _coordinate(event.get("coordinates"), 1),
                    "intensity": _spread_intensity(date, origin_date),
                    "cultureId": item["id"],
                    "timePeriod": {
                        "start": date,
                        "end": None,
                        "label": (
                            f"{item['name']} - "
                            f"{event.get('associatedCivilization')}"
                        ),
                    },
                }
            )
    return distributions


def _spread_intensity(date: Any, origin_date: Any) -> float | int | None:
    """``Math.max(0.2, 1 - Math.abs(date - originDate) / 10000)``.

    ``None`` when the arithmetic was `NaN` — `Math.max` propagates it and
    `res.json` writes it as `null`, which is what a point with an unreadable
    date carries on both backends.
    """
    if not isinstance(date, (int, float)) or isinstance(date, bool):
        return None
    difference = abs(float(date) - float(origin_date))
    return js_number(max(MIN_SPREAD_INTENSITY, 1.0 - difference / SPREAD_DECAY_YEARS))


def filter_archaeological_cultures(
    cultures: list[Record],
    *,
    region: str | None = None,
    language_id: str | None = None,
    time_start: float | None = None,
    time_end: float | None = None,
) -> list[Record]:
    """``getArchaeologicalCultures`` — region substring, language, time overlap.

    `language_id` is tested against `associatedLanguageIds`, which the corpus
    has no column for (see
    :func:`pinakes.lexicons.storage.load_archaeological_cultures`) — so on this
    data the filter selects nothing whatever is passed. Kept.
    """
    kept = list(cultures)
    if region:
        needle = region.lower()
        kept = [c for c in kept if needle in str(c.get("region") or "").lower()]
    if language_id:
        kept = [c for c in kept if language_id in c.get("associatedLanguageIds", [])]
    if not _absent(time_start):
        kept = [
            c
            for c in kept
            if _gte(
                math.inf if c["timePeriodEnd"] is None else c["timePeriodEnd"],
                time_start,
            )
        ]
    if not _absent(time_end):
        kept = [
            c
            for c in kept
            if _lte(
                -math.inf if c["timePeriodStart"] is None else c["timePeriodStart"],
                time_end,
            )
        ]
    return kept


def filter_trade_routes(
    routes: list[Record],
    *,
    route_type: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[Record]:
    """``getTradeRoutes`` — exact type, then two **string** date bounds.

    The dates are compared lexicographically because both sides are strings, so
    `?start_date=-500` excludes a route starting at `-3000`: `"-3000" >= "-500"`
    is false. The same rule `filter_migration_routes` documents, and the same
    reason — the corpus writes these as text.
    """
    kept = list(routes)
    if route_type:
        kept = [r for r in kept if r.get("routeType") == route_type]
    if start_date:
        kept = [r for r in kept if str(r.get("startDate", "")) >= start_date]
    if end_date:
        kept = [r for r in kept if str(r.get("endDate", "")) <= end_date]
    return kept


def filter_empire_timeline(
    events: list[Record],
    *,
    empire_id: str | None = None,
    event_type: str | None = None,
    year_start: float | None = None,
    year_end: float | None = None,
) -> list[Record]:
    """``getEmpireTimeline`` — exact empire and event type, then a year window.

    Containment on a single `year`, not an overlap: an event with an unreadable
    year (``None`` here, `NaN` there) drops out of every bounded query and stays
    in the unfiltered list.
    """
    kept = list(events)
    if empire_id:
        kept = [e for e in kept if e.get("empireId") == empire_id]
    if event_type:
        kept = [e for e in kept if e.get("eventType") == event_type]
    if not _absent(year_start):
        kept = [e for e in kept if _gte(e["year"], year_start)]
    if not _absent(year_end):
        kept = [e for e in kept if _lte(e["year"], year_end)]
    return kept


__all__ = [
    "filter_archaeological_cultures",
    "filter_archaeological_sites",
    "filter_by_time",
    "filter_civilizations",
    "filter_empire_timeline",
    "filter_empires_timeline",
    "filter_historical_routes",
    "filter_language_range_polygons",
    "filter_language_ranges",
    "filter_material_cultures",
    "filter_trade_routes",
    "material_culture_distributions",
]
