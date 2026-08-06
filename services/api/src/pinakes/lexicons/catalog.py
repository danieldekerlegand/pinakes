"""Catalog queries over the loaded corpus — filtering, derivation, ordering.

The half of `server/tsv-storage.ts` that is not a *loader*: everything its
`get<Entity>(filters)` methods did **after** the TSV was read, plus the two
derived structures a route asks for and no file contains (the family tree and
the language stats block). :mod:`pinakes.lexicons.storage` reads rows; this
module answers questions about them.

Split that way for the reason the whole package is: a loader is graded by row
counts against the live corpus, and a filter is graded by which rows survive.
Keeping them in one function would make the second untestable without the first.

**Everything here is pure** — records in, records out, no path and no fs. The
router resolves `paths.lexicons_dir()` and calls a loader; these take the result.

Three JavaScript rules run through all of it and none of them is Python's
default:

* **A blank filter is no filter.** Express tested `if (filters?.region)`, so
  `?region=` (empty string, falsy) returns the whole table rather than matching
  nothing. Callers pass `None` *or* `""` and mean the same thing.
* **Case folding is `toLowerCase`, and where it applies is not uniform.** A
  religion's `religionType` is compared exactly, its `originRegion` is compared
  case-insensitively *and* as a substring, and a deity's `mythology` is compared
  case-insensitively and whole. Reproduced filter by filter, not normalised.
* **An open-ended year is an infinity.** `p.timePeriodEnd ?? Infinity` makes an
  undated end match every `time_start`; the same value in Python has to be
  written out, because `None` compares to nothing at all.
"""

from __future__ import annotations

import math
from typing import Any

from pinakes.analytics.jsmath import locale_key
from pinakes.lexicons.storage import Record

#: Radius `GET /api/culture-profiles/by-location/{lat}/{lng}` culls to when the
#: request does not say. The TypeScript default parameter, not a route default.
DEFAULT_RADIUS_KM = 500.0

#: Earth radius the settlement proximity search uses, matching the TypeScript's.
EARTH_RADIUS_KM = 6371.0


def _active(value: str | None) -> bool:
    """Whether a query-string filter is set, JavaScript-truthily.

    `""` is falsy in JS, so an empty parameter is the *absence* of the filter.
    """
    return bool(value)


def _lower(value: Any) -> str:
    return str(value or "").lower()


def _includes(haystack: Any, needle: str) -> bool:
    """`haystack.toLowerCase().includes(needle.toLowerCase())`."""
    return needle.lower() in _lower(haystack)


# ── Languages and families ───────────────────────────────────────────────────


def filter_languages(
    languages: list[Record],
    *,
    family: str | None = None,
    statuses: list[str] | None = None,
    region: str | None = None,
    search: str | None = None,
) -> list[Record]:
    """`GET /api/languages`'s four query filters, in the order Express applied them.

    `status` is repeatable (`?status=living&status=extinct`) and Express wrapped a
    single value in an array, so this takes the list either way. The match is
    **exact and case-sensitive** — unlike `region`, which is a case-insensitive
    substring, and unlike `search`, which is a case-insensitive substring across
    *two* columns.
    """
    result = languages
    if _active(family):
        result = [row for row in result if row.get("familyId") == family]
    if statuses:
        allowed = set(statuses)
        result = [row for row in result if row.get("status") in allowed]
    if _active(region):
        assert region is not None
        # `lang.region?.toLowerCase().includes(...)` — a null region is dropped,
        # which `_includes` reproduces by folding null to the empty string only
        # when the needle is non-empty (and `_active` guarantees it is).
        result = [row for row in result if _includes(row.get("region"), region)]
    if _active(search):
        assert search is not None
        term = search.lower()
        result = [
            row
            for row in result
            if term in _lower(row.get("name"))
            or term in _lower(row.get("nativeName"))
        ]
    return result


def language_with_stats(language: Record) -> Record:
    """`GET /api/languages/{id}`'s record — the row plus three empty extras.

    `getLanguage` spreads the loaded row and appends `completionPercentage: 0`,
    `historicalVariants: []` and `dialects: []`. All three are placeholders the
    TSV mode never filled, and all three are in the recorded shape, so they are
    carried rather than dropped.
    """
    return {
        **language,
        "completionPercentage": 0,
        "historicalVariants": [],
        "dialects": [],
    }


def language_family_tree(
    families: list[Record], languages: list[Record]
) -> list[Record]:
    """The nested family forest `GET /api/language-families/tree` answers with.

    Each node carries its `children` (recursively) and the `languages` directly
    under it, both sorted by `localeCompare` — which is *not* a code-point sort:
    it orders by base letter and considers case last, so a lowercase name does
    not sort behind every capitalised one. :func:`~pinakes.analytics.jsmath.locale_key`
    is that ordering.

    *families* is expected to be the count-corrected list
    (:func:`~pinakes.lexicons.storage.language_families_with_counts`), because
    the TypeScript built the tree from the same array it had just rewritten the
    counts on.
    """
    children: dict[str | None, list[Record]] = {}
    for family in families:
        parent = family.get("parentId")
        children.setdefault(parent if parent is None else str(parent), []).append(
            family
        )

    by_family: dict[str, list[Record]] = {}
    for language in languages:
        by_family.setdefault(str(language.get("familyId")), []).append(language)

    def build(parent_id: str | None, seen: frozenset[str]) -> list[Record]:
        nodes: list[Record] = []
        for family in sorted(
            children.get(parent_id, ()), key=lambda row: locale_key(str(row["name"]))
        ):
            identifier = str(family["id"])
            # Same cycle guard `language_families_with_counts` documents: the
            # TypeScript recursion has none and would hang on a self-parenting
            # row. Identical answer for every acyclic corpus.
            if identifier in seen:
                continue
            nodes.append(
                {
                    **family,
                    "children": build(identifier, seen | {identifier}),
                    "languages": [
                        {**language, "historicalVariants": [], "dialects": []}
                        for language in sorted(
                            by_family.get(identifier, ()),
                            key=lambda row: locale_key(str(row["name"])),
                        )
                    ],
                }
            )
        return nodes

    return build(None, frozenset())


def language_stats(
    families: list[Record], languages: list[Record], base_words: list[Record]
) -> dict[str, Any]:
    """`GET /api/stats` — the counts the dashboard header renders.

    `wordListsScraped` and `scrapingQueue` are hard `0`: they counted work the
    scraper stack did, and that stack is `pinakes_engine.acquire` now. They are
    in the recorded shape, so they stay, at the value the read-only TSV mode has
    always reported.
    """
    return {
        "totalLanguages": len(languages),
        "historicalVariants": sum(
            1 for row in languages if row.get("isHistoricalVariant")
        ),
        "dialects": sum(1 for row in languages if row.get("isDialect")),
        "wordListsScraped": 0,
        "baseWords": len(base_words),
        "scrapingQueue": 0,
        "totalFamilies": sum(1 for row in families if row.get("parentId") is None),
        "totalSubfamilies": sum(
            1 for row in families if row.get("parentId") is not None
        ),
        "languagesWithCoordinates": sum(
            1 for row in languages if row.get("coordinates") is not None
        ),
    }


# ── Culture profiles ─────────────────────────────────────────────────────────


def filter_culture_profiles(
    profiles: list[Record],
    *,
    region: str | None = None,
    civilization_id: str | None = None,
    subsistence_type: str | None = None,
    urbanism_level: str | None = None,
    social_organization: str | None = None,
    technology_level: str | None = None,
    time_start: float | None = None,
    time_end: float | None = None,
) -> list[Record]:
    """`GET /api/culture-profiles`'s eight filters, in Express's order.

    `region` is a case-insensitive **substring**; the other five text filters are
    case-insensitive **equality**. The two year bounds are an overlap test
    against an open-ended period, so a profile with no recorded end matches every
    `time_start` and one with no recorded start matches every `time_end`.
    """
    result = profiles
    if _active(region):
        assert region is not None
        result = [row for row in result if _includes(row.get("region"), region)]
    for value, key in (
        (civilization_id, "civilizationId"),
        (subsistence_type, "subsistenceType"),
        (urbanism_level, "urbanismLevel"),
        (social_organization, "socialOrganization"),
        (technology_level, "technologyLevel"),
    ):
        if _active(value):
            assert value is not None
            wanted = value.lower()
            result = [row for row in result if _lower(row.get(key)) == wanted]
    if time_start is not None:
        result = [
            row
            for row in result
            if _or_infinity(row.get("timePeriodEnd"), math.inf) >= time_start
        ]
    if time_end is not None:
        result = [
            row
            for row in result
            if _or_infinity(row.get("timePeriodStart"), -math.inf) <= time_end
        ]
    return result


def _or_infinity(value: Any, fallback: float) -> float:
    """`value ?? ±Infinity` — *nullish*, so a recorded year of 0 is kept.

    `or` would replace it, and year 0 is a real bound in this corpus.
    """
    return fallback if value is None else float(value)


def profiles_by_civilization(
    profiles: list[Record], civilization_id: str
) -> list[Record]:
    """`GET /api/culture-profiles/by-civilization/{civilizationId}`.

    Case-insensitive equality, and — unlike the query-string filter above — it is
    **not** guarded by truthiness: the id comes from the path, so an empty
    segment cannot reach here as "no filter".
    """
    wanted = civilization_id.lower()
    return [row for row in profiles if _lower(row.get("civilizationId")) == wanted]


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance, spelled operation for operation as the TypeScript.

    Written as `(x * pi) / 180` rather than `math.radians` and `sin(x) ** 2`
    rather than a helper for the same reason `pinakes.search.places` documents:
    the association order is what keeps the last digits agreeing between V8 and
    CPython. Here it only decides a `<=` against a radius, but a boundary case is
    exactly where a re-associated expression would flip one row.
    """
    d_lat = (lat2 - lat1) * math.pi / 180
    d_lng = (lng2 - lng1) * math.pi / 180
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(lat1 * math.pi / 180)
        * math.cos(lat2 * math.pi / 180)
        * math.sin(d_lng / 2) ** 2
    )
    return EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def profiles_near(
    profiles: list[Record],
    settlements: list[Record],
    lat: float,
    lng: float,
    radius_km: float = DEFAULT_RADIUS_KM,
) -> list[Record]:
    """`GET /api/culture-profiles/by-location/{lat}/{lng}`.

    **The join is by settlement *name*, not by coordinates**, and that is the
    behaviour rather than an approximation of it: a culture profile carries no
    geometry, so the search finds settlements within the radius and then keeps
    every profile naming one of them in `notableSettlements`. A profile whose
    settlements are unrecorded is therefore never near anywhere, however well
    dated and placed the culture is.
    """
    # `load_settlements` reads both degrees through `parseFloat(cell) || 0`, so
    # they are always numbers — a settlement with a blank latitude sits on the
    # equator and really can fall inside a radius. Reproduced, not guarded.
    nearby = {
        _lower(settlement.get("name"))
        for settlement in settlements
        if haversine_km(
            lat,
            lng,
            float(settlement["latitude"]),
            float(settlement["longitude"]),
        )
        <= radius_km
    }
    return [
        profile
        for profile in profiles
        if any(
            _lower(name) in nearby
            for name in profile.get("notableSettlements", [])
        )
    ]
