"""Open Context / tDAR → archaeological sites in the contribution queue.

The port of the Open Context / tDAR half of
`server/services/archaeological-site-scraper.ts` (pinakes:64 US-2). That file is
1,376 lines; **only the last 500 came across**, and the split is the same one the
TypeScript already drew in its own comment banner: the Pleiades/UNESCO paths above
it belong to `ArchaeologicalSiteScraper`, a class that writes TSVs directly and is
reached by no route. What a route reaches is the pair of external adapters below,
and they are what this module is.

Two things shape it, both inherited:

* **Each adapter is a pure mapper plus an injectable network boundary.** One raw
  record in, one :class:`ScrapedSite` or ``None`` out — a record that names no
  place, or places it at Null Island, is dropped rather than queued with a
  guess. The fetch sits behind :class:`ArchaeologyDeps` so the whole pipeline
  runs against `server/services/fixtures/archaeological/*.json` with no network.
* **Nothing here writes the corpus.** Acquired sites land in the contribution
  review queue as `archaeological-site` adds, flagged ``autoDerived`` with the
  authority's own provenance, at a confidence clamped below 100 so they read as
  needing review. `routers/ai_review.py` is where one becomes a corpus row.

The one thing that did **not** come across is the `AbortSignal`: the TypeScript
route never passed one, and there is no caller here that could. A run is bounded
by ``limit`` instead, which is what the dashboard actually sets.
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from pinakes.analytics.jsmath import js_round
from pinakes.contributions.store import Contribution, ContributionStore
from pinakes.ingest import http

#: The two external authorities this module speaks to.
SourceId = Literal["open-context", "tdar"]


class ArchaeologyAcquisitionError(RuntimeError):
    """An authority answered with an error status, or with something unreadable."""


# ── The catalog ──────────────────────────────────────────────────────────────


#: The authorities, in the order `GET /api/scraping/archaeology/sources` lists
#: them — `Object.values` preserves insertion order and the dashboard renders it.
ARCHAEOLOGY_SOURCES: dict[str, dict[str, str]] = {
    "open-context": {
        "id": "open-context",
        "label": "Open Context",
        "description": (
            "Open-access archaeological data & publications (opencontext.org); "
            "GeoJSON search API."
        ),
        "homepage": "https://opencontext.org",
    },
    "tdar": {
        "id": "tdar",
        "label": "tDAR (Digital Antiquity)",
        "description": (
            "The Digital Archaeological Record (core.tdar.org); site records "
            "with spatial + temporal coverage."
        ),
        "homepage": "https://core.tdar.org",
    },
}


def list_archaeology_sources() -> list[dict[str, str]]:
    """Every authority, as the sources endpoint serves them."""
    return list(ARCHAEOLOGY_SOURCES.values())


def resolve_archaeology_source(source: Any) -> dict[str, str] | None:
    """The authority *source* names, or ``None``.

    ``if (!source) return undefined`` — so an empty string, ``null`` and an
    absent key are all "no source named", and only then is the lookup skipped.
    A non-string reaches the lookup in JavaScript too and misses it.
    """
    if not source or not isinstance(source, str):
        return None
    return ARCHAEOLOGY_SOURCES.get(source)


# ── Free text → the corpus's `site_type` vocabulary ──────────────────────────


#: Pleiades place types, mapped onto the corpus's `site_type` enum. Shared with
#: the Pleiades path that stayed on the TypeScript side — the keyword mapper
#: below consults it first, exactly as `mapKeywordSiteType` does.
PLEIADES_SITE_TYPE_MAP: dict[str, str] = {
    "settlement": "settlement",
    "urban-settlement": "settlement",
    "rural-settlement": "settlement",
    "village": "settlement",
    "town": "settlement",
    "city": "city",
    "port": "city",
    "temple": "temple",
    "sanctuary": "temple",
    "shrine": "temple",
    "religious-center": "temple",
    "church": "temple",
    "mosque": "temple",
    "cemetery": "burial",
    "tomb": "burial",
    "necropolis": "burial",
    "tumulus-tumuli": "burial",
    "fort": "fortress",
    "fortress": "fortress",
    "military-installation": "fortress",
    "castle": "fortress",
    "wall": "fortress",
    "cave": "cave_art",
    "rock-art": "cave_art",
    "workshop": "workshop",
    "mine": "workshop",
    "quarry": "workshop",
    "production-site": "workshop",
    "amphitheatre": "ceremonial",
    "theatre": "ceremonial",
    "stadium": "ceremonial",
    "hippodrome": "ceremonial",
    "bath": "ceremonial",
    "agora": "ceremonial",
    "forum": "ceremonial",
}

#: Archaeological synonyms the Pleiades vocabulary has no entry for, tried in
#: order after the exact lookup misses. Order is the contract: "cave" reaches
#: `cave_art` through the map above, but "burial cave" reaches `burial` here.
_KEYWORD_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"burial|grave|mound|barrow"), "burial"),
    (re.compile(r"settlement|habitation|dwelling|village|hamlet"), "settlement"),
    (re.compile(r"temple|shrine|ritual|ceremon"), "temple"),
    (re.compile(r"fort|citadel|defensive|rampart"), "fortress"),
    (re.compile(r"rock.?art|petroglyph|pictograph|cave"), "cave_art"),
    (re.compile(r"workshop|kiln|quarry|mine|production"), "workshop"),
    (re.compile(r"city|urban|town"), "city"),
)

#: The Unicode block `slugify`'s TypeScript strips after NFD. Deliberately this
#: block and not `unicodedata.combining` — the latter also strips marks outside
#: it, which would slug a handful of scripts differently on the two servers.
_COMBINING = re.compile(r"[̀-ͯ]")

_NON_SLUG = re.compile(r"[^a-z0-9]+")


def map_keyword_site_type(keywords: list[str]) -> str:
    """The first `site_type` any of *keywords* resolves to, else ``"unknown"``.

    The scan is keyword-major: a keyword that matches nothing at all falls
    through to the next one, and the first keyword that matches *anything* wins.
    """
    for keyword in keywords:
        normalized = keyword.lower().strip()
        mapped = PLEIADES_SITE_TYPE_MAP.get(normalized)
        if mapped:
            return mapped
        for pattern, site_type in _KEYWORD_PATTERNS:
            if pattern.search(normalized):
                return site_type
    return "unknown"


def _slug(name: str) -> str:
    """The shared body of both slugifiers: fold accents, then kebab the rest."""
    lowered = name.lower()
    stripped = _COMBINING.sub("", unicodedata.normalize("NFD", lowered))
    return _NON_SLUG.sub("-", stripped).strip("-")


def slugify(prefix: str, name: str) -> str:
    """A stable record id: ``opencontext-catalhoyuk-east-mound``."""
    return f"{prefix}-{_slug(name)}"


def slugify_culture(name: str) -> str:
    """A culture name as an id: ``Ancestral Puebloan`` → ``ancestral-puebloan``."""
    return _slug(name)


def format_time_period_label(start: float | None, end: float | None) -> str:
    """The human label for a date range, BCE-aware."""

    def year(value: float) -> str:
        magnitude = abs(value)
        rendered = _js_number_string(magnitude)
        return f"{rendered} BCE" if value < 0 else f"{rendered} CE"

    if start is not None and end is not None:
        return f"{year(start)} - {year(end)}"
    if start is not None:
        return f"From {year(start)}"
    if end is not None:
        return f"Until {year(end)}"
    return "Unknown period"


def _js_number_string(value: float) -> str:
    """``String(n)`` for the integral case — JS prints ``850``, not ``850.0``."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


# ── The normalized record ────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class SiteProvenance:
    """Where an externally-scraped site came from, so a reviewer can trace it."""

    source: str
    source_id: str
    source_url: str


@dataclass(frozen=True, slots=True)
class ScrapedSite:
    """One archaeological site, normalized out of whichever authority held it.

    A subset of the TypeScript's `ScrapedSite`: the fields both external adapters
    fill. `excavationStatus`, `findings` and `importance` are constants on this
    path (`"unknown"`, `[]`, `50`) and are spelled at the one place they are
    read — `site_to_contribution` — rather than carried on every record.
    """

    id: str
    name: str
    lat: float
    lng: float
    site_type: str
    time_period_start: float | None
    time_period_end: float | None
    time_period_label: str
    associated_culture_ids: list[str]
    confidence: float
    sources: list[str]
    description: str
    provenance: SiteProvenance | None = None
    associated_language_ids: list[str] = field(default_factory=list)
    associated_civilization_ids: list[str] = field(default_factory=list)

    @property
    def coordinates(self) -> dict[str, float]:
        """The `{lat, lng}` cell shape the corpus and the queue both use."""
        return {"lat": self.lat, "lng": self.lng}


# ── JavaScript coercions the mappers depend on ───────────────────────────────


def _is_number(value: Any) -> bool:
    """``typeof value === "number"`` — and `True` is not a number in JSON."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _finite_number(value: Any) -> float | None:
    """``Number(value)``, then ``Number.isFinite`` — ``None`` when either fails.

    ``Number("")`` is **0**, not NaN, which is why the blank string takes the
    parse path rather than being refused outright. It lands on the equator and
    is then caught by the ``[0, 0]`` rule, exactly as it is on Express.
    """
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    if isinstance(value, str):
        try:
            parsed = float(value.strip() or "0")
        except ValueError:
            return None
        return parsed if math.isfinite(parsed) else None
    return None


def _usable_point(lat: Any, lng: Any) -> tuple[float, float] | None:
    """A point both adapters would accept, or ``None``.

    The three refusals are the TypeScript's, in its order: unparseable, off the
    globe, and **exactly `[0, 0]`** — which in this data is never Null Island but
    always a record whose coordinates were never filled in.
    """
    latitude = _finite_number(lat)
    longitude = _finite_number(lng)
    if latitude is None or longitude is None:
        return None
    if latitude < -90 or latitude > 90 or longitude < -180 or longitude > 180:
        return None
    if latitude == 0 and longitude == 0:
        return None
    return latitude, longitude


def _text(value: Any) -> str:
    """``(value ?? "").trim()`` for a field the API types as a string."""
    return value.strip() if isinstance(value, str) else ""


def _string_list(value: Any) -> list[str]:
    """The strings in *value* when it is an array, else no strings at all."""
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _dedupe(ids: list[str]) -> list[str]:
    """``Array.from(new Set(...))`` — first occurrence wins, order preserved."""
    seen: dict[str, None] = {}
    for value in ids:
        if value:
            seen.setdefault(value, None)
    return list(seen)


# ── Open Context (GeoJSON search API) ────────────────────────────────────────


def open_context_to_scraped_site(feature: Any) -> ScrapedSite | None:
    """One Open Context GeoJSON feature → a site, or ``None`` if unusable."""
    if not isinstance(feature, dict):
        return None
    props = feature.get("properties")
    if not isinstance(props, dict):
        props = {}

    name = _text(props.get("label"))
    if not name:
        return None

    geometry = feature.get("geometry")
    coords = geometry.get("coordinates") if isinstance(geometry, dict) else None
    if not isinstance(coords, list) or len(coords) < 2:
        return None
    # GeoJSON is [lng, lat]; every coordinate downstream of here is {lat, lng}.
    point = _usable_point(coords[1], coords[0])
    if point is None:
        return None
    lat, lng = point

    start = props.get("early bce/ce") if _is_number(props.get("early bce/ce")) else None
    end = props.get("late bce/ce") if _is_number(props.get("late bce/ce")) else None

    raw_category = props.get("category")
    if isinstance(raw_category, list):
        categories = _string_list(raw_category)
    elif raw_category:
        categories = [raw_category] if isinstance(raw_category, str) else []
    else:
        categories = []
    if props.get("item category"):
        item_category = props["item category"]
        if isinstance(item_category, str):
            categories.append(item_category)

    # Cultures: the explicit list, else the leaf of the context path
    # ("Asia/Turkey/Çatalhöyük" → "Çatalhöyük").
    culture_names = _string_list(props.get("cultures"))
    context_label = _text(props.get("context label"))
    if not culture_names and context_label:
        leaves = [part.strip() for part in context_label.split("/") if part.strip()]
        if leaves:
            culture_names.append(leaves[-1])

    uri = _text(props.get("uri")) or _text(props.get("href")) or _text(props.get("id"))
    source_url = _text(props.get("href")) or _text(props.get("uri"))

    return ScrapedSite(
        id=slugify("opencontext", name),
        name=name,
        lat=lat,
        lng=lng,
        site_type=map_keyword_site_type([*categories, name]),
        time_period_start=start,
        time_period_end=end,
        time_period_label=format_time_period_label(start, end),
        associated_culture_ids=_dedupe([slugify_culture(c) for c in culture_names]),
        confidence=65,
        sources=[value for value in ["Open Context", source_url] if value],
        description=_text(props.get("snippet")),
        provenance=SiteProvenance(
            source="open-context",
            source_id=uri,
            source_url=source_url or uri,
        ),
    )


# ── tDAR (resource records with spatial + temporal coverage) ─────────────────


def _tdar_coordinates(resource: dict[str, Any]) -> tuple[float, float] | None:
    """A tDAR record's point: explicit lat/lng, else the bounding-box centroid."""
    if _is_number(resource.get("latitude")) and _is_number(resource.get("longitude")):
        return _usable_point(resource["latitude"], resource["longitude"])
    corners = (
        "minimumLatitude",
        "maximumLatitude",
        "minimumLongitude",
        "maximumLongitude",
    )
    if all(_is_number(resource.get(corner)) for corner in corners):
        return _usable_point(
            (resource["minimumLatitude"] + resource["maximumLatitude"]) / 2,
            (resource["minimumLongitude"] + resource["maximumLongitude"]) / 2,
        )
    return None


def tdar_to_scraped_site(resource: Any) -> ScrapedSite | None:
    """One tDAR resource → a site, or ``None`` if it names no place or no title."""
    if not isinstance(resource, dict):
        return None

    name = _text(resource.get("title"))
    if not name:
        return None

    point = _tdar_coordinates(resource)
    if point is None:
        return None
    lat, lng = point

    start = resource.get("startDate") if _is_number(resource.get("startDate")) else None
    end = resource.get("endDate") if _is_number(resource.get("endDate")) else None

    cultures = [term.strip() for term in _string_list(resource.get("culturalTerms"))]
    site_type = resource.get("siteType")
    keywords = [site_type] if isinstance(site_type, str) and site_type else []
    keywords.extend(_string_list(resource.get("siteTypeKeywords")))

    # `String(resource.id)` — an accession number is JSON's `391847`, and the
    # id it mints has to read `tdar-391847`, not `tdar-391847-0`.
    raw_id = resource.get("id")
    if raw_id is None:
        source_id = ""
    elif _is_number(raw_id):
        source_id = _js_number_string(raw_id)
    else:
        source_id = str(raw_id)
    source_url = _text(resource.get("url")) or _text(resource.get("detailUrl"))

    return ScrapedSite(
        id=slugify("tdar", source_id or name),
        name=name,
        lat=lat,
        lng=lng,
        site_type=map_keyword_site_type([*keywords, name]),
        time_period_start=start,
        time_period_end=end,
        time_period_label=format_time_period_label(start, end),
        associated_culture_ids=_dedupe(
            [slugify_culture(culture) for culture in cultures if culture]
        ),
        confidence=60,
        sources=[value for value in ["tDAR", source_url] if value],
        description=_text(resource.get("description")),
        provenance=SiteProvenance(
            source="tdar", source_id=source_id, source_url=source_url
        ),
    )


# ── The injectable network boundary ──────────────────────────────────────────


class ArchaeologyDeps(Protocol):
    """The two authorities, behind an interface. Tests pass a fixture-backed fake."""

    def fetch_open_context(self, *, query: str | None, limit: int | None) -> Any:
        """Open Context's GeoJSON search response."""
        ...

    def fetch_tdar(self, *, query: str | None, limit: int | None) -> Any:
        """tDAR's resource-lookup response."""
        ...


#: Rows an authority is asked for when the caller names no limit, and the ceiling
#: a caller's limit is clamped to. Both are the TypeScript's.
DEFAULT_ROWS = 25
MAX_ROWS = 100


def _rows(limit: int | None) -> str:
    return str(min(limit, MAX_ROWS) if limit and limit > 0 else DEFAULT_ROWS)


class LiveDeps:
    """The real Open Context / tDAR REST endpoints, through the engine's client."""

    def fetch_open_context(self, *, query: str | None, limit: int | None) -> Any:
        params = {"rows": _rows(limit), "type": "subjects"}
        if query:
            params["q"] = query
        return self._read(
            http.OPEN_CONTEXT,
            "https://opencontext.org/query/.json",
            params,
            "Open Context",
        )

    def fetch_tdar(self, *, query: str | None, limit: int | None) -> Any:
        params = {"recordsPerPage": _rows(limit)}
        if query:
            params["query"] = query
        return self._read(
            http.TDAR,
            "https://core.tdar.org/api/lookup/resource",
            params,
            "tDAR",
        )

    def _read(
        self, source: http.Source, url: str, params: dict[str, str], label: str
    ) -> Any:
        response = http.client(source).get(url, params)
        if response.status_code >= 400:
            raise ArchaeologyAcquisitionError(
                f"fetch {url} failed: {response.status_code}"
            )
        try:
            return http.read_json(response, context=label)
        except http.UpstreamError as error:
            raise ArchaeologyAcquisitionError(str(error)) from error


def live_deps() -> ArchaeologyDeps:
    """The live boundary. A function, so a configured client is picked up per call."""
    return LiveDeps()


def scrape_archaeology_source(
    source: str, deps: ArchaeologyDeps, *, query: str | None, limit: int | None
) -> list[ScrapedSite]:
    """Fetch + normalize the sites one authority holds, dropping unusable rows."""
    if source == "open-context":
        payload = deps.fetch_open_context(query=query, limit=limit)
        records = payload.get("features") if isinstance(payload, dict) else None
        mapper: Callable[[Any], ScrapedSite | None] = open_context_to_scraped_site
    else:
        payload = deps.fetch_tdar(query=query, limit=limit)
        records = payload.get("resources") if isinstance(payload, dict) else None
        mapper = tdar_to_scraped_site
    if not isinstance(records, list):
        records = []
    mapped = (mapper(record) for record in records)
    return [site for site in mapped if site is not None]


# ── Contribution mapping + orchestration ─────────────────────────────────────


def to_contribution_confidence(confidence: float) -> int:
    """Clamp a 0..100 confidence to 1..99 — below 100 always reads "needs review"."""
    value = confidence if math.isfinite(confidence) else 50
    return max(1, min(99, js_round(value)))


def site_to_contribution(site: ScrapedSite) -> Contribution | None:
    """A site → an `archaeological-site` add for the review queue, or ``None``.

    Never a corpus write. The flags say what a reviewer needs to know before
    promoting: it came from an authority rather than a person (``autoDerived``)
    and it was not written by a model (``aiGenerated: False``).
    """
    if not site.name:
        return None

    provenance = site.provenance
    entity_data: dict[str, Any] = {
        "name": site.name,
        "coordinates": site.coordinates,
        "siteType": site.site_type,
        "timePeriodStart": site.time_period_start,
        "timePeriodEnd": site.time_period_end,
        "timePeriodLabel": site.time_period_label,
        "associatedLanguageIds": site.associated_language_ids,
        "associatedCultureIds": site.associated_culture_ids,
        "associatedCivilizationIds": site.associated_civilization_ids,
        "description": site.description,
        # Provenance + review flags (mirrors the engine's auto-derived rows).
        "source": provenance.source if provenance else "archaeological-scraper",
        "sourceId": provenance.source_id if provenance else None,
        "sourceUrl": provenance.source_url if provenance else None,
        "autoDerived": True,
        "aiGenerated": False,
    }

    if provenance is None:
        source_label = "archaeological scraper"
    else:
        catalog = ARCHAEOLOGY_SOURCES.get(provenance.source)
        source_label = catalog["label"] if catalog else provenance.source

    citation: dict[str, Any] = {
        "title": f"{site.name} — {source_label}",
        "license": "See source",
    }
    # `JSON.stringify` drops an `undefined` url; a present-but-null one is a
    # different record to the TypeScript reader, so the key stays absent.
    if provenance and provenance.source_url:
        citation["url"] = provenance.source_url

    return {
        "entityType": "archaeological-site",
        "action": "add",
        "entityData": entity_data,
        "sources": [citation],
        "confidence": to_contribution_confidence(site.confidence),
        "notes": f"Acquired from {source_label}; awaiting review.",
    }


@dataclass(frozen=True, slots=True)
class AcquisitionProgress:
    """One progress tick, as the job store renders it into a status message."""

    phase: Literal["starting", "fetching", "queueing", "done"]
    message: str
    acquired: int
    queued: int
    skipped: int
    total: int | None = None


@dataclass(frozen=True, slots=True)
class AcquisitionResult:
    """What one acquisition did: fetched, queued, dropped, and under which ids."""

    source: str
    acquired: int
    queued: int
    skipped: int
    contribution_ids: list[str]


#: How often the queueing phase reports progress. Every 25 rows, plus the last.
_PROGRESS_EVERY = 25


def run_archaeological_acquisition(
    source: str,
    *,
    contributions: ContributionStore,
    deps: ArchaeologyDeps | None = None,
    query: str | None = None,
    limit: int | None = None,
    on_progress: Callable[[AcquisitionProgress], None] | None = None,
) -> AcquisitionResult:
    """Fetch one authority and enqueue what it holds, reporting as it goes.

    A fetch failure propagates — the caller turns it into a failed job. A row the
    queue *rejects*, by contrast, is counted as skipped: one malformed record
    must not cost the run the other ninety-nine.
    """
    label = ARCHAEOLOGY_SOURCES[source]["label"]
    boundary = deps if deps is not None else live_deps()

    def report(progress: AcquisitionProgress) -> None:
        if on_progress is not None:
            on_progress(progress)

    report(
        AcquisitionProgress(
            phase="starting",
            message=f"Starting acquisition from {label}",
            acquired=0,
            queued=0,
            skipped=0,
        )
    )

    sites = scrape_archaeology_source(source, boundary, query=query, limit=limit)

    report(
        AcquisitionProgress(
            phase="fetching",
            message=f"Fetched {len(sites)} site(s) from {label}",
            acquired=len(sites),
            queued=0,
            skipped=0,
            total=len(sites),
        )
    )

    queued = 0
    skipped = 0
    contribution_ids: list[str] = []

    for index, site in enumerate(sites):
        draft = site_to_contribution(site)
        if draft is None:
            skipped += 1
            continue
        submitted = contributions.submit(draft)
        if submitted.contribution is not None:
            queued += 1
            contribution_ids.append(submitted.contribution["id"])
        else:
            skipped += 1
        if (index + 1) % _PROGRESS_EVERY == 0 or index == len(sites) - 1:
            report(
                AcquisitionProgress(
                    phase="queueing",
                    message=(
                        f"Queued {queued} / {len(sites)} for review "
                        f"({skipped} skipped)"
                    ),
                    acquired=len(sites),
                    queued=queued,
                    skipped=skipped,
                    total=len(sites),
                )
            )

    report(
        AcquisitionProgress(
            phase="done",
            message=(
                f"Acquisition complete: {queued} queued for review, "
                f"{skipped} skipped"
            ),
            acquired=len(sites),
            queued=queued,
            skipped=skipped,
            total=len(sites),
        )
    )

    return AcquisitionResult(
        source=source,
        acquired=len(sites),
        queued=queued,
        skipped=skipped,
        contribution_ids=contribution_ids,
    )


__all__ = [
    "ARCHAEOLOGY_SOURCES",
    "DEFAULT_ROWS",
    "MAX_ROWS",
    "PLEIADES_SITE_TYPE_MAP",
    "AcquisitionProgress",
    "AcquisitionResult",
    "ArchaeologyAcquisitionError",
    "ArchaeologyDeps",
    "LiveDeps",
    "ScrapedSite",
    "SiteProvenance",
    "SourceId",
    "format_time_period_label",
    "list_archaeology_sources",
    "live_deps",
    "map_keyword_site_type",
    "open_context_to_scraped_site",
    "resolve_archaeology_source",
    "run_archaeological_acquisition",
    "scrape_archaeology_source",
    "site_to_contribution",
    "slugify",
    "slugify_culture",
    "tdar_to_scraped_site",
    "to_contribution_confidence",
]
