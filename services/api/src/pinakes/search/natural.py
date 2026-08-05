"""Temporal-spatial natural-language search.

Ported off `server/services/natural-language-search.ts`.

Three surfaces: parse a sentence like *"What languages were spoken in Mesopotamia
in 3000 BCE?"* into `{entityType, location, coordinates, year}`; run that parse
over nine coordinate-bearing lexicon domains; and autocomplete a partial query.

The parser is a keyword matcher, not a model, and the port keeps every one of its
edges rather than tidying them — they are what the recorded behaviour is:

* **The first entity-type keyword wins, in declaration order.** `ENTITY_TYPE_KEYWORDS`
  is scanned as an ordered mapping, so *"art in Egypt"* is an art tradition and
  *"trade art"* is still art — but *"music and art"* is music. Python's dicts are
  ordered, so the table transcribes directly.
* **A location is matched against the raw query, not the cleaned one.** The
  cleaning pass that strips question words and dates is computed and then never
  read; `lower.includes(loc)` is what actually decides. Reproduced, dead code and
  all — removing the pass would change nothing, but writing the match against the
  *cleaned* string would silently change which queries resolve a place.
* **`shouldSearch` is exact-match on the detected type**, so a query with no
  detected type searches everything and a query with one searches exactly one.
* **Civilizations never filter by time here.** The projection reads
  `properties.startYear`/`endYear`, and a civilization feature carries its dates
  under `properties.timePeriod` instead — so both come back absent and every
  civilization passes the year filter. That is the Express behaviour; a fix here
  would make the two backends answer differently about the same query.

:func:`what_was_here` is the map-click entry point (`/api/search/spatial`): the
same search with a synthetic parse holding the clicked coordinates.
"""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any

from pinakes.analytics.jsmath import to_fixed
from pinakes.lexicons import storage

Record = dict[str, Any]

#: Default search radius for a parsed query, in km.
DEFAULT_RADIUS_KM = 500

#: Default radius for a map-click "what was here?" query, in km.
CLICK_RADIUS_KM = 200

#: The cap on a spatial result page. `totalCount` still reports the whole set.
RESULT_LIMIT = 50

#: Well-known location names mapped to approximate coordinates.
KNOWN_LOCATIONS: dict[str, dict[str, float]] = {
    "mesopotamia": {"lat": 33.3, "lng": 44.4},
    "fertile crescent": {"lat": 33.0, "lng": 42.0},
    "egypt": {"lat": 26.8, "lng": 30.8},
    "nile valley": {"lat": 25.0, "lng": 32.9},
    "levant": {"lat": 33.0, "lng": 36.0},
    "anatolia": {"lat": 39.0, "lng": 35.0},
    "persia": {"lat": 32.4, "lng": 53.7},
    "india": {"lat": 20.6, "lng": 78.9},
    "indus valley": {"lat": 27.0, "lng": 68.0},
    "china": {"lat": 35.9, "lng": 104.2},
    "yellow river": {"lat": 35.0, "lng": 110.0},
    "japan": {"lat": 36.2, "lng": 138.3},
    "korea": {"lat": 35.9, "lng": 127.8},
    "europe": {"lat": 48.0, "lng": 10.0},
    "western europe": {"lat": 48.0, "lng": 3.0},
    "eastern europe": {"lat": 50.0, "lng": 30.0},
    "northern europe": {"lat": 60.0, "lng": 15.0},
    "scandinavia": {"lat": 62.0, "lng": 15.0},
    "southern europe": {"lat": 40.0, "lng": 15.0},
    "mediterranean": {"lat": 36.0, "lng": 18.0},
    "balkans": {"lat": 42.0, "lng": 22.0},
    "iberia": {"lat": 40.0, "lng": -4.0},
    "britain": {"lat": 53.0, "lng": -2.0},
    "france": {"lat": 46.6, "lng": 2.2},
    "germany": {"lat": 51.2, "lng": 10.4},
    "italy": {"lat": 41.9, "lng": 12.6},
    "greece": {"lat": 39.1, "lng": 21.8},
    "rome": {"lat": 41.9, "lng": 12.5},
    "athens": {"lat": 37.98, "lng": 23.73},
    "central asia": {"lat": 42.0, "lng": 65.0},
    "steppe": {"lat": 48.0, "lng": 68.0},
    "silk road": {"lat": 40.0, "lng": 65.0},
    "africa": {"lat": 0, "lng": 25.0},
    "west africa": {"lat": 10.0, "lng": -5.0},
    "east africa": {"lat": -2.0, "lng": 37.0},
    "north africa": {"lat": 30.0, "lng": 10.0},
    "south africa": {"lat": -30.0, "lng": 25.0},
    "sahara": {"lat": 23.0, "lng": 12.0},
    "sub-saharan africa": {"lat": 5.0, "lng": 20.0},
    "southeast asia": {"lat": 10.0, "lng": 107.0},
    "middle east": {"lat": 29.0, "lng": 42.0},
    "near east": {"lat": 33.0, "lng": 40.0},
    "far east": {"lat": 35.0, "lng": 120.0},
    "americas": {"lat": 15.0, "lng": -90.0},
    "north america": {"lat": 45.0, "lng": -100.0},
    "south america": {"lat": -15.0, "lng": -60.0},
    "mesoamerica": {"lat": 17.0, "lng": -92.0},
    "andes": {"lat": -15.0, "lng": -72.0},
    "oceania": {"lat": -25.0, "lng": 140.0},
    "polynesia": {"lat": -15.0, "lng": -150.0},
    "australia": {"lat": -25.0, "lng": 134.0},
    "caucasus": {"lat": 42.3, "lng": 44.3},
    "siberia": {"lat": 60.0, "lng": 100.0},
    "arabia": {"lat": 23.0, "lng": 45.0},
    "babylon": {"lat": 32.5, "lng": 44.4},
    "jerusalem": {"lat": 31.77, "lng": 35.23},
    "constantinople": {"lat": 41.01, "lng": 28.98},
    "istanbul": {"lat": 41.01, "lng": 28.98},
}

#: Entity-type keywords, in the order they are tried. The first hit wins.
ENTITY_TYPE_KEYWORDS: dict[str, tuple[str, ...]] = {
    "language": ("language", "languages", "tongue", "tongues", "spoken", "speak"),
    "civilization": (
        "civilization",
        "civilizations",
        "culture",
        "cultures",
        "empire",
        "empires",
        "kingdom",
        "kingdoms",
    ),
    "battle": ("battle", "battles", "war", "wars", "conflict", "conflicts", "fought"),
    "migration-route": (
        "migration",
        "migrations",
        "route",
        "routes",
        "movement",
        "movements",
    ),
    "religion": (
        "religion",
        "religions",
        "faith",
        "faiths",
        "worship",
        "worshipped",
        "belief",
    ),
    "music-tradition": (
        "music",
        "musical",
        "song",
        "songs",
        "instrument",
        "instruments",
    ),
    "cuisine": ("cuisine", "cuisines", "food", "foods", "dish", "dishes", "cooking"),
    "art-tradition": ("art", "arts", "artistic", "painting", "sculpture"),
    "trade-good": (
        "trade",
        "traded",
        "goods",
        "commodity",
        "commodities",
        "commerce",
    ),
    "archaeological-site": (
        "archaeological",
        "archaeology",
        "site",
        "sites",
        "ruins",
        "excavation",
        "dig",
    ),
}

_BCE = re.compile(r"(\d{1,5})\s*(?:bce|bc|b\.c\.e?\.?)", re.IGNORECASE)
_CE = re.compile(r"(\d{1,5})\s*(?:ce|ad|a\.d\.?)", re.IGNORECASE)
_FOUR_DIGIT = re.compile(r"\b(\d{4})\b")
_COORD_PAIR = re.compile(r"(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)")


def parse_year(text: str) -> int | None:
    """``"3000 BCE"`` → ``-3000``; ``"500 CE"`` → ``500``; a bare 4-digit year.

    A standalone four-digit number only counts when it is in ``[100, 2100]``, so
    a coordinate or a population never reads as a date.
    """
    bce = _BCE.search(text)
    if bce:
        return -int(bce.group(1))
    common = _CE.search(text)
    if common:
        return int(common.group(1))
    year = _FOUR_DIGIT.search(text)
    if year:
        value = int(year.group(1))
        if 100 <= value <= 2100:
            return value
    return None


def parse_coordinates(text: str) -> dict[str, float] | None:
    """``"35.5, 44.2"`` → ``{"lat": 35.5, "lng": 44.2}``, when both are in range."""
    match = _COORD_PAIR.search(text)
    if not match:
        return None
    latitude = float(match.group(1))
    longitude = float(match.group(2))
    if -90 <= latitude <= 90 and -180 <= longitude <= 180:
        return {"lat": latitude, "lng": longitude}
    return None


def parse_location_name(text: str) -> tuple[str, dict[str, float]] | None:
    """The longest :data:`KNOWN_LOCATIONS` name the query contains, and its point.

    Longest-first so *"south africa"* is not read as *"africa"*. Matched against
    the lower-cased **raw** query — see the module docstring on the cleaning pass.
    """
    lowered = text.lower()
    for name in sorted(KNOWN_LOCATIONS, key=len, reverse=True):
        if name in lowered:
            return name, KNOWN_LOCATIONS[name]
    return None


def detect_entity_type(text: str) -> str | None:
    """The first entity type whose keyword list the query hits, else ``None``."""
    lowered = text.lower()
    for entity_type, keywords in ENTITY_TYPE_KEYWORDS.items():
        for keyword in keywords:
            if keyword in lowered:
                return entity_type
    return None


def parse_natural_language_query(query: str) -> dict[str, Any]:
    """Parse a query into its structured components.

    An explicit coordinate pair beats a named location; the location's point is
    the fallback.
    """
    trimmed = query.strip()
    if not trimmed:
        return {
            "raw": "",
            "entityType": None,
            "locationName": None,
            "coordinates": None,
            "year": None,
            "radiusKm": DEFAULT_RADIUS_KM,
        }

    location = parse_location_name(trimmed)
    coordinates = parse_coordinates(trimmed)
    return {
        "raw": trimmed,
        "entityType": detect_entity_type(trimmed),
        "locationName": location[0] if location else None,
        "coordinates": coordinates or (location[1] if location else None),
        "year": parse_year(trimmed),
        "radiusKm": DEFAULT_RADIUS_KM,
    }


# ── Spatial search ───────────────────────────────────────────────────────────


def haversine_km(
    lat1: float, lng1: float, lat2: float, lng2: float
) -> float:
    """Great-circle distance between two points, in km (R = 6371).

    Spelled operation for operation as the TypeScript spelled it — ``(x * pi) /
    180`` rather than :func:`math.radians`, ``sin(x) * sin(x)`` rather than
    ``sin(x) ** 2``, and the same left-to-right association on the four-factor
    product. Every one of those is a different rounding, and the difference is
    visible: a `distanceKm` in a recorded response is a full-precision double.
    """
    radius = 6371
    d_lat = ((lat2 - lat1) * math.pi) / 180
    d_lng = ((lng2 - lng1) * math.pi) / 180
    a = math.sin(d_lat / 2) * math.sin(d_lat / 2) + math.cos(
        (lat1 * math.pi) / 180
    ) * math.cos((lat2 * math.pi) / 180) * math.sin(d_lng / 2) * math.sin(d_lng / 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius * c


def _filter_year(value: Any) -> int | None:
    """A range bound as a year, for **filtering**.

    A number is itself; a string is read as a date first (`"3000 BCE"`) and, if
    that fails, as a bare integer prefix. Blank and absent are unbounded.
    """
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return int(value)
    parsed = parse_year(str(value))
    if parsed is not None:
        return parsed
    match = re.match(r"\s*[+-]?\d+", str(value))
    return int(match.group(0)) if match else None


def _label_year(value: Any) -> int | None:
    """A range bound as a year, for the **label** — and it is a stricter rule.

    ``typeof v === "number" ? v : parseYear(String(v ?? ""))``: no integer-prefix
    fallback, so a bound of ``"50"`` filters as the year 50 but renders as ``?``.
    Two rules for one value is the TypeScript's, and both are observable.
    """
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return int(value)
    return parse_year("" if value is None else str(value))


def in_time_range(year: int | None, start: Any, end: Any) -> bool:
    """Whether *year* falls in the range. **A query with no year matches all.**"""
    if year is None:
        return True
    lower = _filter_year(start)
    upper = _filter_year(end)
    if lower is not None and upper is not None:
        return lower <= year <= upper
    if lower is not None:
        return year >= lower
    if upper is not None:
        return year <= upper
    return True


def format_year(year: int | None) -> str | None:
    """``-3000`` → ``"3000 BCE"``; ``500`` → ``"500 CE"``; ``None`` → ``None``."""
    if year is None:
        return None
    return f"{abs(year)} BCE" if year < 0 else f"{year} CE"


def _coordinates_of(record: Record, key: str) -> dict[str, float] | None:
    """A ``{"lat","lng"}`` field, or ``None`` when the record has no usable one."""
    value = record.get(key)
    if isinstance(value, dict) and "lat" in value and "lng" in value:
        return {"lat": float(value["lat"]), "lng": float(value["lng"])}
    return None


def spatial_search(query: Record, lexicons: Path) -> dict[str, Any]:
    """Run a parsed query over the coordinate-bearing domains.

    A parse with **nothing** in it — no coordinates, no place, no year and no
    entity type — short-circuits to empty rather than returning the whole corpus.
    """
    if not (
        query.get("coordinates")
        or query.get("locationName")
        or query.get("year")
        or query.get("entityType")
    ):
        return {"results": [], "query": query, "totalCount": 0}

    results: list[Record] = []
    origin = query.get("coordinates")
    year = query.get("year")
    entity_type = query.get("entityType")
    radius_km = query.get("radiusKm", DEFAULT_RADIUS_KM)

    def should_search(kind: str) -> bool:
        return not entity_type or entity_type == kind

    def add_if_nearby(
        kind: str,
        identifier: str,
        name: str,
        description: str,
        coordinates: dict[str, float] | None,
        time_start: Any,
        time_end: Any,
    ) -> None:
        if not in_time_range(year, time_start, time_end):
            return

        distance_km: float | None = None
        if origin and coordinates:
            distance_km = haversine_km(
                origin["lat"], origin["lng"], coordinates["lat"], coordinates["lng"]
            )
            if distance_km > radius_km:
                return
        elif origin and not coordinates:
            return  # no distance to compute against a point query

        if time_start or time_end:
            start_label = format_year(_label_year(time_start)) or "?"
            end_label = format_year(_label_year(time_end)) or "present"
            time_period: str | None = f"{start_label} – {end_label}"
        else:
            time_period = None

        results.append(
            {
                "entityType": kind,
                "id": identifier,
                "displayName": name,
                "description": description,
                "distanceKm": distance_km,
                "coordinates": coordinates,
                "timePeriod": time_period,
            }
        )

    if should_search("language"):
        for language in storage.load_languages(lexicons):
            coordinates = _coordinates_of(language, "coordinates")
            if coordinates is None:
                continue
            add_if_nearby(
                "language",
                str(language["id"]),
                str(language["name"]),
                str(language.get("nativeName") or language.get("region") or ""),
                coordinates,
                language.get("timeOrigin"),
                language.get("timeEnd"),
            )

    if should_search("civilization"):
        for civilization in storage.load_civilizations(lexicons):
            properties = civilization.get("properties") or {}
            name = properties.get("name")
            coordinates = _ring_centroid(civilization.get("geometry"))
            if name:
                add_if_nearby(
                    "civilization",
                    str(properties.get("civilizationId") or civilization.get("id")),
                    str(name),
                    (
                        f"Capital: {properties['capital']}"
                        if properties.get("capital")
                        else ""
                    ),
                    coordinates,
                    # `startYear`/`endYear` — absent from the feature, so every
                    # civilization passes the year filter. See the module docstring.
                    properties.get("startYear"),
                    properties.get("endYear"),
                )

    if should_search("battle"):
        for battle in storage.load_battles(lexicons):
            pair = battle.get("coordinates")
            coordinates = (
                {"lat": float(pair[1]), "lng": float(pair[0])}
                if isinstance(pair, list) and len(pair) >= 2
                else None
            )
            battle_year = parse_year(str(battle.get("date") or ""))
            add_if_nearby(
                "battle",
                str(battle["id"]),
                str(battle["name"]),
                f"{battle['warName']} — {battle['significance']}",
                coordinates,
                battle_year,
                battle_year,
            )

    if should_search("religion"):
        for religion in storage.load_religions(lexicons):
            add_if_nearby(
                "religion",
                str(religion["id"]),
                str(religion["name"]),
                f"{religion['religionType']} — {religion['originRegion']}",
                _coordinates_of(religion, "coordinates"),
                religion.get("timeOrigin"),
                religion.get("timeEnd"),
            )

    if should_search("music-tradition"):
        for tradition in storage.load_music_traditions(lexicons):
            description = tradition.get("description")
            add_if_nearby(
                "music-tradition",
                str(tradition["id"]),
                str(tradition["name"]),
                (description or "")[:120] or str(tradition["region"]),
                _coordinates_of(tradition, "coordinates"),
                tradition.get("timeOrigin"),
                tradition.get("timeEnd"),
            )

    if should_search("cuisine"):
        for cuisine in storage.load_cuisines(lexicons):
            description = cuisine.get("description")
            add_if_nearby(
                "cuisine",
                str(cuisine["id"]),
                str(cuisine["name"]),
                (description or "")[:120] or str(cuisine["region"]),
                _coordinates_of(cuisine, "coordinates"),
                cuisine.get("timeOrigin"),
                cuisine.get("timeEnd"),
            )

    if should_search("art-tradition"):
        for art in storage.load_art_traditions(lexicons):
            description = art.get("description")
            add_if_nearby(
                "art-tradition",
                str(art["id"]),
                str(art["name"]),
                (description or "")[:120] or str(art["category"]),
                _coordinates_of(art, "originCoordinates"),
                art.get("originDate"),
                art.get("endDate"),
            )

    if should_search("trade-good"):
        for good in storage.load_trade_goods(lexicons):
            add_if_nearby(
                "trade-good",
                str(good["id"]),
                str(good["name"]),
                f"{good['category']} — {good['originRegion']}",
                _coordinates_of(good, "originCoordinates"),
                None,
                None,
            )

    if should_search("archaeological-site"):
        for site in storage.load_archaeological_sites(lexicons):
            properties = site.get("properties") or {}
            name = properties.get("name")
            geometry = site.get("geometry") or {}
            coordinates = None
            if geometry.get("type") == "Point" and geometry.get("coordinates"):
                pair = geometry["coordinates"]
                coordinates = {"lat": float(pair[1]), "lng": float(pair[0])}
            if name:
                add_if_nearby(
                    "archaeological-site",
                    str(properties.get("siteId") or site.get("id")),
                    str(name),
                    str(properties.get("siteType") or ""),
                    coordinates,
                    properties.get("startYear"),
                    properties.get("endYear"),
                )

    # Nearest first; entries with no distance sink below every entry that has
    # one, and are then ordered by name.
    results.sort(key=_distance_sort_key)
    return {
        "results": results[:RESULT_LIMIT],
        "query": query,
        "totalCount": len(results),
    }


def _distance_sort_key(result: Record) -> tuple[int, float, str]:
    """``(has-no-distance, distance, name)`` — the comparator, as a key."""
    distance = result.get("distanceKm")
    if distance is None:
        return (1, 0.0, str(result.get("displayName") or ""))
    return (0, float(distance), "")


def _ring_centroid(geometry: Any) -> dict[str, float] | None:
    """A polygon's outer-ring average point — the civilization projection's centroid.

    The *average of the ring's vertices*, not a true centroid; a closed ring
    repeats its first vertex, so it is weighted twice. Kept as found.
    """
    if not isinstance(geometry, dict) or geometry.get("type") != "Polygon":
        return None
    rings = geometry.get("coordinates")
    if not isinstance(rings, list) or not rings:
        return None
    ring = rings[0]
    if not isinstance(ring, list) or not ring:
        return None
    if any(not isinstance(point, list) or len(point) < 2 for point in ring):
        return None
    return {
        "lat": sum(float(point[1]) for point in ring) / len(ring),
        "lng": sum(float(point[0]) for point in ring) / len(ring),
    }


def what_was_here(
    latitude: float,
    longitude: float,
    year: int | None,
    lexicons: Path,
    radius_km: float = CLICK_RADIUS_KM,
) -> dict[str, Any]:
    """The map-click query: a synthetic parse around one point."""
    query: Record = {
        "raw": f"What was here? ({to_fixed(latitude, 2)}, {to_fixed(longitude, 2)})",
        "entityType": None,
        "locationName": None,
        "coordinates": {"lat": latitude, "lng": longitude},
        "year": year,
        "radiusKm": radius_km,
    }
    return spatial_search(query, lexicons)


# ── Autocomplete ─────────────────────────────────────────────────────────────

#: Query shapes offered when nothing more specific matched.
QUERY_PATTERNS: tuple[str, ...] = (
    "Languages spoken in {location}",
    "Civilizations in {location} in {year}",
    "Battles near {location}",
    "Trade goods from {location}",
    "Religions in {location}",
    "Archaeological sites near {location}",
)


def query_suggestions(partial: str) -> list[str]:
    """Autocomplete suggestions for a partial query, deduped and capped at 8.

    The location pass is deliberately loose — a location matches if the input is
    its prefix **or** the input contains the location's first three characters —
    which is what makes *"me"* offer both Mesopotamia and the Mediterranean.
    """
    lowered = partial.lower().strip()
    if not lowered:
        return []

    suggestions: list[str] = []
    locations = list(KNOWN_LOCATIONS)
    for location in locations:
        if location.startswith(lowered) or location[:3] in lowered:
            suggestions.append(f"What was in {location}?")
            suggestions.append(f"Languages spoken in {location}")
            suggestions.append(f"Civilizations in {location}")
            if len(suggestions) >= 8:
                break

    if "in" in lowered or "around" in lowered or "during" in lowered:
        for location in locations[:5]:
            if location in lowered:
                suggestions.append(f"Languages in {location} in 3000 BCE")
                suggestions.append(f"Civilizations in {location} in 1000 BCE")
                suggestions.append(f"Battles in {location} in 500 CE")
                break

    if lowered.startswith("what"):
        suggestions.extend(
            (
                "What languages were spoken in Mesopotamia?",
                "What civilizations existed in 3000 BCE?",
                "What battles were fought in Europe?",
                "What religions originated in the Middle East?",
            )
        )

    if len(suggestions) < 3:
        for pattern in QUERY_PATTERNS:
            if lowered[:4] in pattern.lower():
                suggestions.append(pattern)

    return list(dict.fromkeys(suggestions))[:8]


__all__ = [
    "CLICK_RADIUS_KM",
    "DEFAULT_RADIUS_KM",
    "ENTITY_TYPE_KEYWORDS",
    "KNOWN_LOCATIONS",
    "QUERY_PATTERNS",
    "RESULT_LIMIT",
    "detect_entity_type",
    "format_year",
    "haversine_km",
    "in_time_range",
    "parse_coordinates",
    "parse_location_name",
    "parse_natural_language_query",
    "parse_year",
    "query_suggestions",
    "spatial_search",
    "what_was_here",
]
