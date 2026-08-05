"""Place-name → coordinates — `server/services/place-resolver.ts`, ported.

Four sources, in priority order: a hard-coded table of well-known historical
regions, the local corpus (settlements, archaeological sites, battles), then
**GeoNames** for standardized modern naming and a stable `geonamesId`, falling
back to **Nominatim/OSM**. Every externally-resolved record carries provenance.

The two things worth knowing before touching this:

* **Network is behind :class:`PlaceResolverDeps`, and the live implementation is
  `urllib`, not a new dependency.** This service declares no runtime HTTP client
  (`httpx` is a *dev* dependency, for `TestClient`), and adding one to reach two
  optional geocoders would be a poor trade. Tests pass a fake — no live fetch.
* **GeoNames is optional and its absence is the normal case.** No
  `$GEONAMES_USERNAME` ⇒ :meth:`fetch_geonames` raises ⇒ the resolver falls back
  to Nominatim, exactly as an unconfigured checkout has always behaved. GeoNames
  also reports quota errors in a **200 body** under `status`, so that is raised
  too — a rate-limited response must degrade, not resolve to nothing.

Two orderings are load-bearing and easy to get backwards: Nominatim returns its
`boundingbox` as ``[south, north, west, east]`` and this app's bbox is
``[south, west, north, east]``; and a GeoNames hit ranks ``0.68`` against a
Nominatim hit's ``0.6``, so standardized naming outranks the fallback.
"""

from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from pinakes.analytics.jsmath import to_fixed
from pinakes.lexicons import storage

Record = dict[str, Any]

#: Default page size for `/api/map/places/search`.
SEARCH_LIMIT = 15
#: Default page size for `/api/map/places/autocomplete`.
AUTOCOMPLETE_LIMIT = 8
#: Default page size for `/api/map/places/resolve`.
RESOLVE_LIMIT = 10

#: Env var holding the (free) GeoNames account name. Unset ⇒ Nominatim only.
GEONAMES_USERNAME_ENV = "GEONAMES_USERNAME"

_GEONAMES_URL = "https://www.geonames.org/"
_GEONAMES_SEARCH = "https://secure.geonames.org/searchJSON"
_NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search"
_USER_AGENT = "pinakes/1.0 (historical-linguistics-research)"


@dataclass(frozen=True)
class KnownRegion:
    """A well-known historical region with a point and a bounding box."""

    name: str
    aliases: tuple[str, ...]
    lat: float
    lng: float
    #: ``[south, west, north, east]``.
    bbox: tuple[float, float, float, float]
    description: str


KNOWN_REGIONS: tuple[KnownRegion, ...] = (
    KnownRegion(
        "Mesopotamia",
        ("land between rivers",),
        33.3,
        44.4,
        (29.0, 38.0, 37.0, 49.0),
        "Ancient region between the Tigris and Euphrates rivers",
    ),
    KnownRegion(
        "Fertile Crescent",
        (),
        33.0,
        42.0,
        (28.0, 32.0, 38.0, 50.0),
        "Arc of fertile land from Egypt to Mesopotamia",
    ),
    KnownRegion(
        "Levant",
        ("eastern mediterranean",),
        33.0,
        36.0,
        (29.0, 34.0, 37.5, 42.0),
        "Eastern Mediterranean coastal region",
    ),
    KnownRegion(
        "Anatolia",
        ("asia minor",),
        39.0,
        35.0,
        (36.0, 26.0, 42.0, 45.0),
        "Peninsula of modern Turkey",
    ),
    KnownRegion(
        "Egypt",
        ("kemet",),
        26.8,
        30.8,
        (22.0, 25.0, 31.5, 35.0),
        "Ancient civilization along the Nile",
    ),
    KnownRegion(
        "Nile Valley",
        (),
        25.0,
        32.9,
        (22.0, 28.0, 31.0, 35.0),
        "Nile River valley region",
    ),
    KnownRegion(
        "Persia",
        ("iran",),
        32.4,
        53.7,
        (25.0, 44.0, 40.0, 63.0),
        "Ancient Persian Empire region",
    ),
    KnownRegion(
        "India",
        ("bharata", "hindustan"),
        20.6,
        78.9,
        (6.0, 68.0, 36.0, 97.0),
        "Indian subcontinent",
    ),
    KnownRegion(
        "Indus Valley",
        ("harappan",),
        27.0,
        68.0,
        (23.0, 64.0, 32.0, 76.0),
        "Indus Valley civilization region",
    ),
    KnownRegion(
        "China",
        ("zhongguo",),
        35.9,
        104.2,
        (18.0, 73.0, 54.0, 135.0),
        "Chinese civilization region",
    ),
    KnownRegion(
        "Mediterranean",
        ("mediterranean basin", "mare nostrum"),
        36.0,
        18.0,
        (30.0, -6.0, 46.0, 36.0),
        "Mediterranean Sea basin",
    ),
    KnownRegion(
        "Europe",
        (),
        48.0,
        10.0,
        (35.0, -10.0, 71.0, 40.0),
        "European continent",
    ),
    KnownRegion(
        "Central Asia",
        ("inner asia",),
        42.0,
        65.0,
        (30.0, 50.0, 55.0, 80.0),
        "Central Asian steppe and oases",
    ),
    KnownRegion(
        "Arabia",
        ("arabian peninsula",),
        23.0,
        45.0,
        (12.0, 34.0, 32.0, 60.0),
        "Arabian Peninsula",
    ),
    KnownRegion(
        "Scandinavia",
        ("nordic",),
        62.0,
        15.0,
        (54.0, 4.0, 71.0, 32.0),
        "Nordic region of Europe",
    ),
    KnownRegion(
        "Balkans",
        ("southeast europe",),
        42.0,
        22.0,
        (35.0, 13.0, 47.0, 30.0),
        "Balkan Peninsula",
    ),
    KnownRegion(
        "Caucasus",
        (),
        42.3,
        44.3,
        (38.0, 36.0, 44.0, 51.0),
        "Caucasus mountain region",
    ),
    KnownRegion(
        "Mesoamerica",
        (),
        17.0,
        -92.0,
        (7.0, -105.0, 24.0, -82.0),
        "Pre-Columbian civilizations of Central America",
    ),
    KnownRegion(
        "West Africa",
        (),
        10.0,
        -5.0,
        (-5.0, -18.0, 25.0, 16.0),
        "Western Africa region",
    ),
    KnownRegion(
        "East Africa",
        (),
        -2.0,
        37.0,
        (-12.0, 28.0, 12.0, 52.0),
        "Eastern Africa region",
    ),
    KnownRegion(
        "Southeast Asia",
        (),
        10.0,
        107.0,
        (-10.0, 92.0, 28.0, 140.0),
        "Southeast Asian region",
    ),
    KnownRegion(
        "Siberia",
        (),
        60.0,
        100.0,
        (50.0, 60.0, 75.0, 170.0),
        "Siberian region of Northern Asia",
    ),
    KnownRegion(
        "Oceania",
        (),
        -25.0,
        140.0,
        (-50.0, 100.0, 0.0, 180.0),
        "Oceania and Pacific Islands",
    ),
    KnownRegion(
        "Polynesia",
        (),
        -15.0,
        -150.0,
        (-30.0, -180.0, 0.0, -120.0),
        "Polynesian Triangle region",
    ),
    KnownRegion(
        "Andes",
        ("andean region",),
        -15.0,
        -72.0,
        (-35.0, -82.0, 5.0, -60.0),
        "Andean mountain civilization region",
    ),
)


# ── Fuzzy matching (pure) ────────────────────────────────────────────────────

_NON_ALNUM = re.compile(r"[^a-z0-9\s]")
_WHITESPACE = re.compile(r"\s+")


def normalize(value: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace — **in that order**.

    The trim happens *before* the punctuation is removed, so ``"x !"``
    normalizes to ``"x "`` with the space still on it. Collapsing after
    stripping would produce ``"x"``, and the dedup key is built from this — two
    spellings of one place would stop collapsing into one result.

    ASCII-only by construction: the character class drops everything outside
    ``[a-z0-9\\s]``, so a name in a non-Latin script normalizes to blank and
    scores 0. That is why the corpus's `alternate_names` matter more here than
    they look.
    """
    return _WHITESPACE.sub(" ", _NON_ALNUM.sub("", value.lower().strip()))


def fuzzy_score(query: str, target: str) -> float:
    """A tiered match score: exact 1.0, prefix 0.9, substring 0.7, else tokens."""
    q = normalize(query)
    t = normalize(target)
    if not q or not t:
        return 0.0
    if q == t:
        return 1.0
    if t.startswith(q):
        return 0.9
    if q in t:
        return 0.7
    tokens = q.split(" ")
    matched = sum(1 for token in tokens if token in t)
    if matched == 0:
        return 0.0
    return (matched / len(tokens)) * 0.6


def best_fuzzy_score(query: str, name: str, aliases: Sequence[str]) -> float:
    """The best :func:`fuzzy_score` across a name and its aliases."""
    best = fuzzy_score(query, name)
    for alias in aliases:
        score = fuzzy_score(query, alias)
        if score > best:
            best = score
    return best


# ── The local corpus half ────────────────────────────────────────────────────


def _format_year(year: int) -> str:
    return f"{abs(year)} BCE" if year < 0 else f"{year} CE"


def _format_time_period(founded: int | None, abandoned: int | None) -> str | None:
    if founded is None:
        return None
    end = _format_year(abandoned) if abandoned is not None else "present"
    return f"{_format_year(founded)} – {end}"


def _capitalize(value: str) -> str:
    """``s[0].toUpperCase() + s.slice(1)`` — first character only, not title case."""
    return value[:1].upper() + value[1:]


def _deduplicate(results: list[Record]) -> list[Record]:
    """Drop near-duplicates: the same normalized name at the same 0.1° cell."""
    seen: set[str] = set()
    out: list[Record] = []
    for result in results:
        key = (
            f"{normalize(str(result['name']))}|"
            f"{to_fixed(float(result['lat']), 1)},{to_fixed(float(result['lng']), 1)}"
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(result)
    return out


def search_places(
    query: str, lexicons: Path, limit: int = SEARCH_LIMIT
) -> dict[str, Any]:
    """Ranked local matches: known regions, settlements, sites, battles."""
    trimmed = query.strip()
    if not trimmed:
        return {"results": [], "query": trimmed}

    results: list[Record] = []

    for region in KNOWN_REGIONS:
        score = best_fuzzy_score(trimmed, region.name, region.aliases)
        if score > 0:
            slug = "-".join(_WHITESPACE.split(normalize(region.name)))
            results.append(
                {
                    "id": f"region-{slug}",
                    "name": region.name,
                    "category": "region",
                    "geometryType": "bbox",
                    "lat": region.lat,
                    "lng": region.lng,
                    "bbox": list(region.bbox),
                    "description": region.description,
                    "relevance": score,
                }
            )

    for settlement in storage.load_settlements(lexicons):
        modern = str(settlement.get("modernName") or "")
        aliases = [
            *(str(name) for name in settlement.get("alternateNames") or []),
            *([modern] if modern else []),
        ]
        score = best_fuzzy_score(trimmed, str(settlement["name"]), aliases)
        if score <= 0:
            continue
        kind = str(settlement.get("type") or "")
        period = _format_time_period(
            settlement.get("foundedYear"), settlement.get("abandonedYear")
        )
        description = " · ".join(
            part
            for part in (
                _capitalize(kind.replace("-", " ")) if kind else "",
                str(settlement.get("region") or ""),
                f"Modern: {modern}" if modern else "",
            )
            if part
        )
        result: Record = {
            "id": f"settlement-{settlement['id']}",
            "name": settlement["name"],
            "category": "settlement",
            "geometryType": "point",
            "lat": settlement["latitude"],
            "lng": settlement["longitude"],
            "description": description,
        }
        if period:
            result["timePeriod"] = period
        result["relevance"] = score
        results.append(result)

    for site in storage.load_archaeological_sites(lexicons):
        properties = site.get("properties") or {}
        name = properties.get("name")
        if not name:
            continue
        geometry = site.get("geometry") or {}
        pair = geometry.get("coordinates")
        if not isinstance(pair, list) or len(pair) < 2:
            continue
        score = fuzzy_score(trimmed, str(name))
        if score <= 0:
            continue
        site_type = properties.get("siteType")
        results.append(
            {
                "id": f"site-{properties.get('siteId') or site.get('id')}",
                "name": name,
                "category": "archaeological-site",
                "geometryType": "point",
                "lat": pair[1],
                "lng": pair[0],
                "description": (
                    _capitalize(str(site_type)) if site_type else "Archaeological site"
                ),
                # Slightly lower priority than a settlement.
                "relevance": score * 0.95,
            }
        )

    for battle in storage.load_battles(lexicons):
        score = fuzzy_score(trimmed, str(battle["name"]))
        pair = battle.get("coordinates")
        if score > 0 and isinstance(pair, list) and len(pair) == 2:
            results.append(
                {
                    "id": f"battle-{battle['id']}",
                    "name": battle["name"],
                    "category": "battle",
                    "geometryType": "point",
                    "lat": pair[1],
                    "lng": pair[0],
                    "description": " · ".join(
                        part
                        for part in (battle.get("warName"), battle.get("date"))
                        if part
                    ),
                    "relevance": score * 0.9,
                }
            )

    results.sort(key=lambda result: result["relevance"], reverse=True)
    return {"results": _deduplicate(results)[:limit], "query": trimmed}


# ── External geocoders ───────────────────────────────────────────────────────


class PlaceResolverDeps(Protocol):
    """The injectable network boundary. Tests pass a fake; production is live."""

    def fetch_geonames(self, query: str, limit: int) -> list[Record]:
        """GeoNames standardized-name search (preferred). Raises to degrade."""
        ...

    def fetch_nominatim(self, query: str, limit: int) -> list[Record]:
        """Nominatim / OSM search (fallback)."""
        ...


def _nominatim_bbox(raw: Any) -> list[float] | None:
    """``[south, north, west, east]`` → ``[south, west, north, east]``."""
    if not isinstance(raw, list) or len(raw) < 4:
        return None
    return [float(raw[0]), float(raw[2]), float(raw[1]), float(raw[3])]


def geonames_to_place_result(item: Record, index: int) -> Record:
    """A GeoNames record → a search result, with provenance."""
    identifier = item.get("geonameId")
    description = " · ".join(
        str(part)
        for part in (
            item.get("fcodeName"),
            item.get("adminName1"),
            item.get("countryName"),
        )
        if part
    )
    return {
        "id": f"geonames-{identifier}",
        "name": item.get("name"),
        "category": "geonames",
        "geometryType": "point",
        "lat": float(item["lat"]),
        "lng": float(item["lng"]),
        "description": description or "GeoNames place",
        # Preferred over Nominatim (0.6): standardized naming ranks higher.
        "relevance": 0.68 - index * 0.05,
        "provenance": {
            "source": "geonames",
            "sourceId": str(identifier),
            "sourceUrl": f"{_GEONAMES_URL}{identifier}",
        },
    }


def nominatim_to_place_result(item: Record, index: int) -> Record:
    """A Nominatim record → a search result, with provenance."""
    bbox = _nominatim_bbox(item.get("boundingbox"))
    result: Record = {
        "id": f"nominatim-{item.get('place_id')}",
        "name": str(item.get("display_name", "")).split(",")[0].strip(),
        "category": "modern",
        "geometryType": "bbox" if bbox else "point",
        "lat": float(item["lat"]),
        "lng": float(item["lon"]),
    }
    if bbox:
        result["bbox"] = bbox
    result["description"] = item.get("display_name")
    result["relevance"] = 0.6 - index * 0.05
    result["provenance"] = {
        "source": "nominatim",
        "sourceId": str(item.get("place_id")),
        "sourceUrl": f"https://www.openstreetmap.org/?place_id={item.get('place_id')}",
    }
    return result


def geonames_to_canonical(item: Record) -> Record:
    """A GeoNames record → a canonical place record (carries `geonamesId`)."""
    identifier = item.get("geonameId")
    record: Record = {
        "name": item.get("name"),
        "lat": float(item["lat"]),
        "lng": float(item["lng"]),
        "geonamesId": identifier,
    }
    if item.get("countryName") is not None:
        record["countryName"] = item["countryName"]
    if item.get("fcodeName") is not None:
        record["featureType"] = item["fcodeName"]
    record["provenance"] = {
        "source": "geonames",
        "sourceId": str(identifier),
        "sourceUrl": f"{_GEONAMES_URL}{identifier}",
    }
    return record


def nominatim_to_canonical(item: Record) -> Record:
    """A Nominatim record → a canonical place record (`geonamesId` is null)."""
    bbox = _nominatim_bbox(item.get("boundingbox"))
    record: Record = {
        "name": str(item.get("display_name", "")).split(",")[0].strip(),
        "lat": float(item["lat"]),
        "lng": float(item["lon"]),
        "geonamesId": None,
    }
    if bbox:
        record["bbox"] = bbox
    record["provenance"] = {
        "source": "nominatim",
        "sourceId": str(item.get("place_id")),
        "sourceUrl": f"https://www.openstreetmap.org/?place_id={item.get('place_id')}",
    }
    return record


def query_external_places(
    query: str, limit: int, deps: PlaceResolverDeps
) -> list[Record]:
    """GeoNames first, Nominatim as fallback; either failing degrades, never raises."""
    try:
        hits = deps.fetch_geonames(query, limit)
        if hits:
            return [
                geonames_to_place_result(item, index)
                for index, item in enumerate(hits)
            ]
    except Exception:  # noqa: BLE001 - unconfigured / rate-limited / down
        pass
    try:
        return [
            nominatim_to_place_result(item, index)
            for index, item in enumerate(deps.fetch_nominatim(query, limit))
        ]
    except Exception:  # noqa: BLE001 - the fallback failing is still "no results"
        return []


def search_places_with_geocoder(
    query: str,
    lexicons: Path,
    limit: int = SEARCH_LIMIT,
    deps: PlaceResolverDeps | None = None,
) -> dict[str, Any]:
    """Local search, topped up from an external geocoder when it looks thin.

    **The geocoder is skipped entirely when the local corpus already answered
    well** — three or more hits whose best is ``>= 0.7``. That is the whole
    rate-limit strategy: a query that the curated data already knows never
    reaches the network.
    """
    resolver_deps = deps if deps is not None else live_deps()
    local = search_places(query, lexicons, limit)
    if len(local["results"]) >= 3 and local["results"][0]["relevance"] >= 0.7:
        return local

    external = query_external_places(
        query, max(5, limit - len(local["results"])), resolver_deps
    )
    if not external:
        return local

    combined = [*local["results"], *external]
    combined.sort(key=lambda result: result["relevance"], reverse=True)
    # Note the un-trimmed `query` here, not `local.query` — the TypeScript
    # returns the raw argument on the merged path and the trimmed one otherwise.
    return {"results": _deduplicate(combined)[:limit], "query": query}


def autocomplete_places(
    query: str, lexicons: Path, limit: int = AUTOCOMPLETE_LIMIT
) -> list[Record]:
    """Fast prefix-ish search across **local data only** — never the network."""
    trimmed = query.strip()
    if len(trimmed) < 2:
        return []
    results: list[Record] = search_places(trimmed, lexicons, limit)["results"]
    return results


def resolve_place(
    query: str, limit: int = RESOLVE_LIMIT, deps: PlaceResolverDeps | None = None
) -> dict[str, Any]:
    """Canonical place records for a query — GeoNames preferred, Nominatim fallback.

    Unlike :func:`search_places_with_geocoder` this consults **no local data**:
    the point of the endpoint is a standardized external record with a stable id.
    """
    resolver_deps = deps if deps is not None else live_deps()
    trimmed = query.strip()
    if not trimmed:
        return {"results": [], "query": "", "source": None}

    try:
        hits = resolver_deps.fetch_geonames(trimmed, limit)
        if hits:
            return {
                "results": [geonames_to_canonical(item) for item in hits],
                "query": trimmed,
                "source": "geonames",
            }
    except Exception:  # noqa: BLE001 - unconfigured / rate-limited / down
        pass

    try:
        hits = resolver_deps.fetch_nominatim(trimmed, limit)
    except Exception:  # noqa: BLE001 - both authorities failing is "no source"
        return {"results": [], "query": trimmed, "source": None}
    return {
        "results": [nominatim_to_canonical(item) for item in hits],
        "query": trimmed,
        "source": "nominatim" if hits else None,
    }


# ── The live network implementation ──────────────────────────────────────────


class LiveDeps:
    """The real GeoNames / Nominatim REST calls, over ``urllib``.

    Deliberately not a new runtime dependency — see the module docstring. The
    Nominatim rate-limit sleep the TypeScript did is **not** carried over: it
    guarded a shared module-level timestamp in a single-threaded event loop, and
    reproducing that here would mean blocking a worker thread on a lock. The
    local-results short-circuit above is what actually keeps request volume down.
    """

    def fetch_geonames(self, query: str, limit: int) -> list[Record]:
        username = os.environ.get(GEONAMES_USERNAME_ENV)
        if not username:
            raise RuntimeError(f"{GEONAMES_USERNAME_ENV} not configured")
        params = urllib.parse.urlencode(
            {
                "q": query,
                "maxRows": str(limit),
                "style": "MEDIUM",
                "orderby": "relevance",
                "username": username,
            }
        )
        payload = self._get_json(f"{_GEONAMES_SEARCH}?{params}")
        # GeoNames signals quota/errors in a 200 body under `status`.
        if isinstance(payload, dict) and payload.get("status"):
            raise RuntimeError(f"GeoNames error: {payload['status'].get('message')}")
        geonames = payload.get("geonames") if isinstance(payload, dict) else None
        return list(geonames) if isinstance(geonames, list) else []

    def fetch_nominatim(self, query: str, limit: int) -> list[Record]:
        params = urllib.parse.urlencode(
            {
                "q": query,
                "format": "json",
                "limit": str(limit),
                "addressdetails": "1",
            }
        )
        payload = self._get_json(f"{_NOMINATIM_SEARCH}?{params}")
        return list(payload) if isinstance(payload, list) else []

    @staticmethod
    def _get_json(url: str) -> Any:
        request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
        with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))


def live_deps() -> PlaceResolverDeps:
    """The live network boundary. A function, so the env var is read per call."""
    return LiveDeps()


__all__ = [
    "AUTOCOMPLETE_LIMIT",
    "GEONAMES_USERNAME_ENV",
    "KNOWN_REGIONS",
    "RESOLVE_LIMIT",
    "SEARCH_LIMIT",
    "KnownRegion",
    "LiveDeps",
    "PlaceResolverDeps",
    "autocomplete_places",
    "best_fuzzy_score",
    "fuzzy_score",
    "geonames_to_canonical",
    "geonames_to_place_result",
    "live_deps",
    "nominatim_to_canonical",
    "nominatim_to_place_result",
    "normalize",
    "query_external_places",
    "resolve_place",
    "search_places",
    "search_places_with_geocoder",
]
