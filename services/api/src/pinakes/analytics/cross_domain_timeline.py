"""Eight datasets normalised onto one dated event, for a single timeline.

The port of `server/services/cross-domain-timeline.ts`, behind
`GET /api/cross-domain/timeline`. Eight loaders, one `CrossDomainTimelineEvent`
shape, one sort — and four rules that decide what the client actually sees:

* **Append order is the loaders' declaration order**, and it survives the sort.
  Over there the eight loads are a `Promise.all` of eight `async` functions that
  each `await` exactly once at the top, so they resume in the order they were
  scheduled and push their whole batch. The final sort is on ``startYear``
  alone and is stable, so events sharing a year come back grouped by domain in
  that order.
* **An empire is a *span* synthesised from its events**, not an event. The
  rows are grouped by ``empireId`` and collapsed to min/max year; an empire with
  a single recorded event has ``endYear: null`` rather than a zero-length span.
* **The two bounds are asymmetric.** ``yearStart`` is tested against the event's
  *end* (falling back to its start), ``yearEnd`` against its *start* — so a
  window keeps everything that overlaps it rather than everything contained in
  it.
* **An empty result is not an empty range.** No events at all reports the
  hard-coded ``{min: -3000, max: 2024}``, which is the axis the client draws
  when it has nothing to draw on.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from pinakes.analytics import tsv
from pinakes.analytics.jsmath import js_number
from pinakes.lexicons import storage

Record = dict[str, Any]

#: `TimelineDomain`, in the order `getTimeline` loads them.
TIMELINE_DOMAINS: tuple[str, ...] = (
    "empire",
    "battle",
    "civilization",
    "migration",
    "trade-route",
    "art-tradition",
    "music-tradition",
    "archaeological-site",
)

#: The axis an empty timeline still reports.
EMPTY_RANGE_MIN = -3000
EMPTY_RANGE_MAX = 2024


def parse_year(value: Any) -> float | int | None:
    """``parseYear`` — a signed year out of a loose date cell.

    ``null``/``undefined`` and a blank-after-trim string are ``None``; a number
    passes straight through; anything else is ``parseInt``, and a ``NaN`` is
    ``None``. Note this is *not* the yearish scan
    :func:`pinakes.authoring.candidates.parse_yearish` does — there is no BCE
    marker handling here, so `"500 BC"` is the year **500**.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    parsed = tsv.js_parse_int(trimmed)
    return None if math.isnan(parsed) else int(parsed)


def _nullish(value: Any, fallback: Any) -> Any:
    return fallback if value is None else value


def _js_min(left: float, right: float) -> float:
    """``Math.min`` — a `NaN` operand poisons the result, unlike Python's ``min``."""
    if math.isnan(left) or math.isnan(right):
        return math.nan
    return left if left < right else right


def _js_max(left: float, right: float) -> float:
    if math.isnan(left) or math.isnan(right):
        return math.nan
    return left if left > right else right


def _empire_events(lexicons: Path) -> list[Record]:
    """One span per empire, min year to max year across its recorded events.

    **A single undated event annihilates the whole span, and on the live corpus
    that is most of them.** `empires-timeline.tsv` holds two concatenated
    tables: the header row of the second one is read as data, and every row of
    it puts a *phase* word where the reader expects a year. `parseInt` gives
    `NaN`, `Math.min`/`Math.max` propagate it, and `Number.isFinite` then drops
    the empire from the timeline entirely. That is what Express answers, so it
    is what this answers; the fix belongs in the corpus, and the day the file is
    split these empires appear on both backends at once.

    The Python loader spells that `NaN` as ``None`` (a year it could not read is
    not a year), so it is mapped back here — ``Math.min(5, NaN)`` is ``NaN``
    where ``min(5, nan)`` is ``5``, and the difference is a whole empire.
    """
    spans: dict[str, dict[str, Any]] = {}
    for event in storage.load_empire_timeline(lexicons):
        empire_id = str(event.get("empireId"))
        raw_year = event.get("year")
        year = math.nan if raw_year is None else float(raw_year)
        existing = spans.get(empire_id)
        if existing is None:
            spans[empire_id] = {
                "name": event.get("empireName"),
                "minYear": year,
                "maxYear": year,
                "langs": list(event.get("associatedLanguageIds") or []),
                "desc": event.get("description"),
            }
            continue
        existing["minYear"] = _js_min(existing["minYear"], year)
        existing["maxYear"] = _js_max(existing["maxYear"], year)
        for language in event.get("associatedLanguageIds") or []:
            if language not in existing["langs"]:
                existing["langs"].append(language)

    events: list[Record] = []
    for empire_id, span in spans.items():
        minimum: float = span["minYear"]
        maximum: float = span["maxYear"]
        # `NaN !== NaN` is **true** in JavaScript, so a wholly-undated empire
        # gets an `endYear` rather than the `null` a one-event empire gets.
        # Both are dropped by the finiteness filter; the distinction is kept
        # because the branch is the TypeScript's.
        differs = math.isnan(minimum) or math.isnan(maximum) or maximum != minimum
        events.append(
            {
                "id": f"empire-{empire_id}",
                "name": span["name"],
                "domain": "empire",
                "startYear": js_number(minimum),
                "endYear": js_number(maximum) if differs else None,
                "description": span["desc"],
                "associatedLanguageIds": span["langs"],
            }
        )
    return events


def _battle_events(lexicons: Path) -> list[Record]:
    events: list[Record] = []
    for battle in storage.load_battles(lexicons):
        year = parse_year(battle.get("date"))
        if year is None:
            continue
        events.append(
            {
                "id": f"battle-{battle.get('id')}",
                "name": battle.get("name"),
                "domain": "battle",
                "startYear": year,
                "endYear": None,
                "description": battle.get("significance"),
                "associatedLanguageIds": [],
                "metadata": {
                    "warName": battle.get("warName"),
                    "outcome": battle.get("outcome"),
                },
            }
        )
    return events


def _feature_events(
    features: list[Record], domain: str, prefix: str, id_key: str
) -> list[Record]:
    """Civilizations and archaeological sites — no ``description`` key at all."""
    events: list[Record] = []
    for feature in features:
        properties: Record = feature.get("properties") or {}
        time_period: Record = properties.get("timePeriod") or {}
        start = time_period.get("start")
        if start is None:
            continue
        events.append(
            {
                "id": f"{prefix}-{_nullish(feature.get('id'), properties.get(id_key))}",
                "name": _nullish(properties.get("name"), "Unknown"),
                "domain": domain,
                "startYear": start,
                "endYear": _nullish(time_period.get("end"), None),
                "associatedLanguageIds": list(
                    _nullish(properties.get("associatedLanguageIds"), [])
                ),
            }
        )
    return events


def _route_events(routes: list[Record], domain: str, prefix: str) -> list[Record]:
    """Migration routes and trade routes — the same six fields either way."""
    events: list[Record] = []
    for route in routes:
        start = parse_year(route.get("startDate"))
        if start is None:
            continue
        events.append(
            {
                "id": f"{prefix}-{route.get('id')}",
                "name": route.get("name"),
                "domain": domain,
                "startYear": start,
                "endYear": parse_year(route.get("endDate")),
                "description": route.get("description"),
                "associatedLanguageIds": list(
                    _nullish(route.get("associatedLanguages"), [])
                ),
            }
        )
    return events


def _art_events(lexicons: Path) -> list[Record]:
    events: list[Record] = []
    for tradition in storage.load_art_traditions(lexicons):
        origin = tradition.get("originDate")
        if origin is None:
            continue
        events.append(
            {
                "id": f"art-{tradition.get('id')}",
                "name": tradition.get("name"),
                "domain": "art-tradition",
                "startYear": origin,
                "endYear": _nullish(tradition.get("endDate"), None),
                "description": tradition.get("description"),
                "associatedLanguageIds": list(
                    _nullish(tradition.get("associatedLanguages"), [])
                ),
                "metadata": {
                    "category": tradition.get("category"),
                    "stylePeriod": tradition.get("stylePeriod"),
                },
            }
        )
    return events


def _music_events(lexicons: Path) -> list[Record]:
    """The one domain that carries a ``region``."""
    events: list[Record] = []
    for tradition in storage.load_music_traditions(lexicons):
        origin = tradition.get("timeOrigin")
        if origin is None:
            continue
        events.append(
            {
                "id": f"music-{tradition.get('id')}",
                "name": tradition.get("name"),
                "domain": "music-tradition",
                "startYear": origin,
                "endYear": tradition.get("timeEnd"),
                "description": tradition.get("description"),
                "associatedLanguageIds": list(
                    _nullish(tradition.get("associatedLanguageIds"), [])
                ),
                "region": tradition.get("region"),
            }
        )
    return events


def get_timeline(
    lexicons: Path,
    *,
    domains: list[str] | None = None,
    year_start: float | None = None,
    year_end: float | None = None,
) -> Record:
    """``getTimeline`` — the unified event list, its domains and its range."""

    def wanted(domain: str) -> bool:
        return domains is None or domain in domains

    events: list[Record] = []
    if wanted("empire"):
        events.extend(_empire_events(lexicons))
    if wanted("battle"):
        events.extend(_battle_events(lexicons))
    if wanted("civilization"):
        events.extend(
            _feature_events(
                storage.load_civilizations(lexicons),
                "civilization",
                "civ",
                "civilizationId",
            )
        )
    if wanted("migration"):
        events.extend(
            _route_events(
                storage.load_migration_routes(lexicons), "migration", "migration"
            )
        )
    if wanted("trade-route"):
        events.extend(
            _route_events(storage.load_trade_routes(lexicons), "trade-route", "trade")
        )
    if wanted("art-tradition"):
        events.extend(_art_events(lexicons))
    if wanted("music-tradition"):
        events.extend(_music_events(lexicons))
    if wanted("archaeological-site"):
        events.extend(
            _feature_events(
                storage.load_archaeological_sites(lexicons),
                "archaeological-site",
                "arch",
                "siteId",
            )
        )

    filtered = [
        event
        for event in events
        if isinstance(event["startYear"], (int, float))
        and not isinstance(event["startYear"], bool)
        and math.isfinite(event["startYear"])
    ]
    if year_start is not None:
        # `>= NaN` is false for every event, so a junk `?yearStart=` empties the
        # timeline rather than being ignored.
        filtered = [
            event
            for event in filtered
            if _nullish(event["endYear"], event["startYear"]) >= year_start
        ]
    if year_end is not None:
        filtered = [event for event in filtered if event["startYear"] <= year_end]

    filtered.sort(key=lambda event: event["startYear"])

    present: list[str] = []
    for event in filtered:
        if event["domain"] not in present:
            present.append(event["domain"])

    if filtered:
        minimum: Any = min(event["startYear"] for event in filtered)
        maximum: Any = max(
            _nullish(event["endYear"], event["startYear"]) for event in filtered
        )
    else:
        minimum, maximum = EMPTY_RANGE_MIN, EMPTY_RANGE_MAX

    return {
        "events": filtered,
        "domains": present,
        "temporalRange": {"min": minimum, "max": maximum},
        "count": len(filtered),
    }


__all__ = ["TIMELINE_DOMAINS", "get_timeline", "parse_year"]
