"""The flat catalog domains' filters — the second half of `tsv-storage.ts`.

Same split as :mod:`pinakes.lexicons.catalog` and for the same reason: a loader
is graded by row counts against the live corpus, a filter by which rows survive.
This module is the `get<Domain>(filters)` bodies for the eighteen domains whose
loaders :mod:`pinakes.lexicons.storage` already had — religions, deities, myth
motifs, cuisines and their items, music traditions and instruments, writing
systems, battles, migration routes, foodway events, art traditions,
architectural styles, kinship systems, trade goods, innovations, urheimat
hypotheses and settlements.

**Nothing here is uniform, and the non-uniformity is the port.** The same
conceptual filter is spelled four different ways across these eighteen domains,
and the TypeScript's spelling is what the client's chip lists were built
against:

* `religionType`, `motifType`, `mechanism`, `stylePeriod`, `systemType`,
  `descentRule`, `routeType`, a writing system's `type` and `direction` and an
  urheimat hypothesis's `languageFamilyId` are compared **exactly**.
* a trade good's `category`, an innovation's `category`, a deity's `mythology`,
  a musical instrument's `instrumentFamily` and a settlement's `civilizationId`
  / `cultureId` / `type` are compared **case-insensitively and whole**.
* a region (on religions, cuisines, music traditions, architectural styles and
  settlements), a `foodItem`, a `foodType`, a motif's `mythologyIds` and a
  deity's `domain` are case-insensitive **substrings**.
* a trade good's `timePeriod` is a **case-sensitive** substring, alone in this
  file.

Reproduced filter by filter rather than normalised — regularising them here
would silently re-answer a query the client already sends.

Three JavaScript rules carry over from :mod:`pinakes.lexicons.catalog`: a blank
filter is no filter (`""` is falsy), an open-ended year is an infinity, and
`parseInt` of junk is `NaN` — which compares false against every bound, so a
malformed `?year=` empties the result rather than rejecting the request. The one
rule this module adds is that **`is_active` is tested for *presence*, not
truth**: `getWritingSystems` guarded it with `!== undefined`, so `?is_active=`
really does filter to the inactive systems.
"""

from __future__ import annotations

import math
from typing import Any

from pinakes.analytics import tsv
from pinakes.lexicons.catalog import haversine_km
from pinakes.lexicons.storage import Record

#: Radius `GET /api/settlements/nearby/{lat}/{lng}` culls to when the request
#: does not say — the TypeScript default parameter on `getSettlementsNearby`.
#: Not :data:`pinakes.lexicons.catalog.DEFAULT_RADIUS_KM`, which is 500: the two
#: proximity searches were written with different defaults and both are live.
DEFAULT_NEARBY_RADIUS_KM = 100.0


def _active(value: str | None) -> bool:
    """`if (filters?.x)` — a blank query parameter is the filter's absence."""
    return bool(value)


def _lower(value: Any) -> str:
    return str(value or "").lower()


def _includes(haystack: Any, needle: str) -> bool:
    """`haystack.toLowerCase().includes(needle.toLowerCase())`."""
    return needle.lower() in _lower(haystack)


def _spans(record: Record, year: float, start_key: str, end_key: str) -> bool:
    """`year >= (start ?? -Infinity) && year <= (end ?? Infinity)`.

    The temporal test five of these domains share. *Nullish*, so a recorded year
    of 0 is a real bound; and false throughout for a `NaN` year, which is what
    `?year=soon` collapses to.
    """
    start = record.get(start_key)
    end = record.get(end_key)
    return (
        (-math.inf if start is None else float(start))
        <= year
        <= (math.inf if end is None else float(end))
    )


# ── Religions ────────────────────────────────────────────────────────────────


def filter_religions(
    religions: list[Record],
    *,
    year: float | None = None,
    region: str | None = None,
    religion_type: str | None = None,
    language_id: str | None = None,
) -> list[Record]:
    """`GET /api/religions`'s four filters, in Express's order.

    `region` reads the record's **`originRegion`** — the route's parameter is
    named for the concept, the column for the fact.
    """
    result = religions
    if year is not None:
        result = [row for row in result if _spans(row, year, "timeOrigin", "timeEnd")]
    if _active(region):
        assert region is not None
        result = [row for row in result if _includes(row.get("originRegion"), region)]
    if _active(religion_type):
        result = [row for row in result if row.get("religionType") == religion_type]
    if _active(language_id):
        result = [
            row for row in result if language_id in row.get("associatedLanguageIds", [])
        ]
    return result


# ── Mythology ────────────────────────────────────────────────────────────────


def filter_deities(
    deities: list[Record],
    *,
    mythology: str | None = None,
    domain: str | None = None,
    year: float | None = None,
) -> list[Record]:
    """`GET /api/deities` — mythology whole, domain a substring of any entry."""
    result = deities
    if _active(mythology):
        assert mythology is not None
        wanted = mythology.lower()
        result = [row for row in result if _lower(row.get("mythology")) == wanted]
    if _active(domain):
        assert domain is not None
        result = [
            row
            for row in result
            if any(_includes(entry, domain) for entry in row.get("domain", []))
        ]
    if year is not None:
        result = [row for row in result if _spans(row, year, "timeOrigin", "timeEnd")]
    return result


def deity_equivalents(deities: list[Record], deity_id: str) -> list[Record]:
    """`GET /api/deities/{id}/equivalents` — the deities *this* one names.

    One-directional, deliberately: it reads the subject's `equivalentDeityIds`
    rather than searching for records that name the subject, so a syncretism
    recorded on only one side is visible from only that side. That is the
    corpus's asymmetry to fix, not this route's.
    """
    deity = next((row for row in deities if row.get("id") == deity_id), None)
    if deity is None:
        return []
    equivalents = deity.get("equivalentDeityIds", [])
    return [row for row in deities if row.get("id") in equivalents]


def motifs_by_deity(motifs: list[Record], deity_id: str) -> list[Record]:
    """`GET /api/deities/{id}/motifs` — every motif naming this deity.

    Unlike the equivalents above there is no membership check on the deity, so
    an unknown id is an empty list rather than a 404. Express answered the same
    way; the route has no deity read at all.
    """
    return [row for row in motifs if deity_id in row.get("associatedDeityIds", [])]


def filter_myth_motifs(
    motifs: list[Record],
    *,
    motif_type: str | None = None,
    mythology: str | None = None,
    region: str | None = None,
) -> list[Record]:
    """`GET /api/myth-motifs` — an exact type, a substring mythology and region."""
    result = motifs
    if _active(motif_type):
        result = [row for row in result if row.get("motifType") == motif_type]
    if _active(mythology):
        assert mythology is not None
        result = [
            row
            for row in result
            if any(_includes(entry, mythology) for entry in row.get("mythologyIds", []))
        ]
    if _active(region):
        assert region is not None
        result = [row for row in result if _includes(row.get("region"), region)]
    return result


# ── Cuisines ─────────────────────────────────────────────────────────────────


def filter_cuisines(
    cuisines: list[Record],
    *,
    year: float | None = None,
    region: str | None = None,
) -> list[Record]:
    """`GET /api/cuisines`."""
    result = cuisines
    if year is not None:
        result = [row for row in result if _spans(row, year, "timeOrigin", "timeEnd")]
    if _active(region):
        assert region is not None
        result = [row for row in result if _includes(row.get("region"), region)]
    return result


def filter_cuisine_items(
    items: list[Record],
    *,
    cuisine_id: str | None = None,
    year: float | None = None,
    food_type: str | None = None,
) -> list[Record]:
    """`GET /api/cuisine-items` — the cuisine id matches **exactly**."""
    result = items
    if _active(cuisine_id):
        result = [row for row in result if row.get("cuisineId") == cuisine_id]
    if year is not None:
        result = [row for row in result if _spans(row, year, "timeOrigin", "timeEnd")]
    if _active(food_type):
        assert food_type is not None
        result = [row for row in result if _includes(row.get("foodType"), food_type)]
    return result


def cuisine_with_items(
    cuisines: list[Record],
    items: list[Record],
    cuisine_id: str,
    year: float | None = None,
) -> Record | None:
    """`GET /api/cuisines/{id}` — one cuisine and its dishes, optionally dated."""
    cuisine = next((row for row in cuisines if row.get("id") == cuisine_id), None)
    if cuisine is None:
        return None
    dishes = [row for row in items if row.get("cuisineId") == cuisine_id]
    if year is not None:
        dishes = [row for row in dishes if _spans(row, year, "timeOrigin", "timeEnd")]
    return {"cuisine": cuisine, "items": dishes}


# ── Music ────────────────────────────────────────────────────────────────────


def filter_music_traditions(
    traditions: list[Record],
    *,
    year: float | None = None,
    region: str | None = None,
    language_id: str | None = None,
) -> list[Record]:
    """`GET /api/music-traditions`."""
    result = traditions
    if year is not None:
        result = [row for row in result if _spans(row, year, "timeOrigin", "timeEnd")]
    if _active(region):
        assert region is not None
        result = [row for row in result if _includes(row.get("region"), region)]
    if _active(language_id):
        result = [
            row for row in result if language_id in row.get("associatedLanguageIds", [])
        ]
    return result


def music_tradition_with_instruments(
    traditions: list[Record], instruments: list[Record], tradition_id: str
) -> Record | None:
    """`GET /api/music-traditions/{id}` — a tradition and the instruments in it.

    The join is on the *instrument's* `associatedTraditionIds`, not on the
    tradition's own `instruments` column: that column is free text naming the
    instruments, and this one is the id list a record can be looked up by.
    """
    tradition = next((row for row in traditions if row.get("id") == tradition_id), None)
    if tradition is None:
        return None
    played = [
        row
        for row in instruments
        if tradition_id in row.get("associatedTraditionIds", [])
    ]
    return {"tradition": tradition, "instruments": played}


def filter_musical_instruments(
    instruments: list[Record],
    *,
    family: str | None = None,
    tradition_id: str | None = None,
    older_than: float | None = None,
) -> list[Record]:
    """`GET /api/musical-instruments`.

    `olderThan` is a **`<=` on `timeOrigin`**, and the corpus's origins are
    negative for antiquity — so "older than -3000" really is the instruments
    that predate 3000 BCE. An instrument with no recorded origin is excluded
    outright rather than treated as infinitely old.
    """
    result = instruments
    if _active(family):
        assert family is not None
        wanted = family.lower()
        result = [
            row for row in result if _lower(row.get("instrumentFamily")) == wanted
        ]
    if _active(tradition_id):
        result = [
            row
            for row in result
            if tradition_id in row.get("associatedTraditionIds", [])
        ]
    if older_than is not None:
        result = [
            row
            for row in result
            if row.get("timeOrigin") is not None
            and float(row["timeOrigin"]) <= older_than
        ]
    return result


# ── Writing systems ──────────────────────────────────────────────────────────


def filter_writing_systems(
    systems: list[Record],
    *,
    type_: str | None = None,
    direction: str | None = None,
    is_active: str | None = None,
) -> list[Record]:
    """`GET /api/writing-systems`.

    *is_active* is the one filter guarded by `!== undefined` rather than by
    truthiness, and it is compared as `raw === "true"` — so `?is_active=` and
    `?is_active=yes` both select the **inactive** systems. Kept as found: the
    client only ever sends `true` or `false`, and narrowing it here would make
    the two backends disagree about a URL a person can still type.
    """
    result = systems
    if _active(type_):
        result = [row for row in result if row.get("type") == type_]
    if _active(direction):
        result = [row for row in result if row.get("direction") == direction]
    if is_active is not None:
        wanted = is_active == "true"
        result = [row for row in result if row.get("isActive") is wanted]
    return result


def writing_system_descendants(systems: list[Record], system_id: str) -> list[Record]:
    """Every system descended from *system_id*, breadth-first.

    The TypeScript's queue walk, order for order — the answer is a flat list and
    its order is the tree's level order, which the client renders as-is. A cycle
    in `parentSystemId` would spin here exactly as it did over there; the corpus
    has none and inventing a guard would be a behaviour change nothing asked
    for.
    """
    descendants: list[Record] = []
    queue = [system_id]
    while queue:
        parent_id = queue.pop(0)
        for child in systems:
            if child.get("parentSystemId") == parent_id:
                descendants.append(child)
                queue.append(str(child["id"]))
    return descendants


# ── Battles and routes ───────────────────────────────────────────────────────


def filter_battles(
    battles: list[Record],
    *,
    war_name: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    civilization_id: str | None = None,
) -> list[Record]:
    """`GET /api/battles`.

    The two date bounds are `parseInt` on **both** sides — the query parameter
    and the battle's own `date` cell, which is free text like `"-331"` or
    `"1066 CE"`. A battle whose date does not begin with a number is `NaN` and
    drops out of every bounded query while still appearing in the unbounded one.
    """
    result = battles
    if _active(war_name):
        result = [row for row in result if row.get("warName") == war_name]
    if _active(start_date):
        assert start_date is not None
        lower = tsv.js_parse_int(start_date)
        result = [
            row for row in result if tsv.js_parse_int(str(row.get("date", ""))) >= lower
        ]
    if _active(end_date):
        assert end_date is not None
        upper = tsv.js_parse_int(end_date)
        result = [
            row for row in result if tsv.js_parse_int(str(row.get("date", ""))) <= upper
        ]
    if _active(civilization_id):
        result = [
            row
            for row in result
            if any(
                isinstance(side, dict)
                and side.get("civilization_id") == civilization_id
                for side in row.get("belligerents", [])
            )
        ]
    return result


def filter_migration_routes(
    routes: list[Record],
    *,
    route_type: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[Record]:
    """`GET /api/migration-routes`.

    The dates are compared as **strings** here, not parsed — `r.startDate >=
    startDate` — which orders `"-4000"` before `"-500"` lexicographically. That
    is the TypeScript's comparison and the client's date pickers were calibrated
    against it; parsing them would quietly re-answer every bounded query.
    """
    result = routes
    if _active(route_type):
        result = [row for row in result if row.get("routeType") == route_type]
    if _active(start_date):
        assert start_date is not None
        result = [row for row in result if str(row.get("startDate", "")) >= start_date]
    if _active(end_date):
        assert end_date is not None
        result = [row for row in result if str(row.get("endDate", "")) <= end_date]
    return result


# ── Foodways, art and architecture ───────────────────────────────────────────


def filter_foodway_events(
    events: list[Record],
    *,
    food_item: str | None = None,
    mechanism: str | None = None,
    date_start: float | None = None,
    date_end: float | None = None,
) -> list[Record]:
    """`GET /api/foodway-events` — a single `date`, bounded from both ends."""
    result = events
    if _active(food_item):
        assert food_item is not None
        result = [row for row in result if _includes(row.get("foodItem"), food_item)]
    if _active(mechanism):
        result = [row for row in result if row.get("mechanism") == mechanism]
    if date_start is not None:
        result = [row for row in result if float(row.get("date", 0)) >= date_start]
    if date_end is not None:
        result = [row for row in result if float(row.get("date", 0)) <= date_end]
    return result


def filter_art_traditions(
    traditions: list[Record],
    *,
    category: str | None = None,
    style_period: str | None = None,
) -> list[Record]:
    """`GET /api/art-traditions` — both filters exact, unlike their neighbours."""
    result = traditions
    if _active(category):
        result = [row for row in result if row.get("category") == category]
    if _active(style_period):
        result = [row for row in result if row.get("stylePeriod") == style_period]
    return result


def filter_architectural_styles(
    styles: list[Record],
    *,
    style_period: str | None = None,
    region: str | None = None,
) -> list[Record]:
    """`GET /api/architectural-styles` — exact period, substring region."""
    result = styles
    if _active(style_period):
        result = [row for row in result if row.get("stylePeriod") == style_period]
    if _active(region):
        assert region is not None
        result = [row for row in result if _includes(row.get("region"), region)]
    return result


def styles_by_building_type(
    styles: list[Record], building_type_id: str
) -> list[Record]:
    """`GET /api/architectural-styles/by-building-type/{buildingTypeId}`."""
    return [row for row in styles if building_type_id in row.get("buildingTypes", [])]


# ── Kinship, trade and innovation ────────────────────────────────────────────


def filter_kinship_systems(
    systems: list[Record],
    *,
    system_type: str | None = None,
    descent_rule: str | None = None,
) -> list[Record]:
    """`GET /api/kinship-systems`."""
    result = systems
    if _active(system_type):
        result = [row for row in result if row.get("systemType") == system_type]
    if _active(descent_rule):
        result = [row for row in result if row.get("descentRule") == descent_rule]
    return result


def filter_trade_goods(
    goods: list[Record],
    *,
    category: str | None = None,
    time_period: str | None = None,
) -> list[Record]:
    """`GET /api/trade-goods`.

    `timePeriod` is the file's one **case-sensitive** substring —
    `g.timePeriod.includes(...)` with neither side folded, where the category
    beside it folds both. Kept as found.
    """
    result = goods
    if _active(category):
        assert category is not None
        wanted = category.lower()
        result = [row for row in result if _lower(row.get("category")) == wanted]
    if _active(time_period):
        assert time_period is not None
        result = [
            row for row in result if time_period in str(row.get("timePeriod", ""))
        ]
    return result


def filter_innovations(
    innovations: list[Record],
    *,
    category: str | None = None,
    culture_profile_id: str | None = None,
) -> list[Record]:
    """`GET /api/innovations`."""
    result = innovations
    if _active(category):
        assert category is not None
        wanted = category.lower()
        result = [row for row in result if _lower(row.get("category")) == wanted]
    if _active(culture_profile_id):
        result = [
            row
            for row in result
            if culture_profile_id in row.get("cultureProfileIds", [])
        ]
    return result


def filter_urheimat_hypotheses(
    hypotheses: list[Record],
    *,
    language_family: str | None = None,
    consensus_min: float | None = None,
) -> list[Record]:
    """`GET /api/urheimat-hypotheses` — an exact family, a consensus floor."""
    result = hypotheses
    if _active(language_family):
        result = [
            row for row in result if row.get("languageFamilyId") == language_family
        ]
    if consensus_min is not None:
        result = [
            row
            for row in result
            if float(row.get("scholarlyConsensusLevel", 0)) >= consensus_min
        ]
    return result


# ── Settlements ──────────────────────────────────────────────────────────────


def filter_settlements(
    settlements: list[Record],
    *,
    civilization_id: str | None = None,
    culture_id: str | None = None,
    type_: str | None = None,
    region: str | None = None,
    time_start: float | None = None,
    time_end: float | None = None,
    bounding_box: dict[str, float] | None = None,
) -> list[Record]:
    """`GET /api/settlements`'s seven filters, in Express's order.

    The two year bounds are an **overlap** test against an open-ended
    occupation, and each reads the opposite end of it: `time_start` is compared
    against `abandonedYear ?? Infinity` (a still-standing town matches every
    lower bound) and `time_end` against `foundedYear ?? -Infinity` (a town of
    unrecorded founding matches every upper one).
    """
    result = settlements
    for value, key in (
        (civilization_id, "civilizationId"),
        (culture_id, "cultureId"),
        (type_, "type"),
    ):
        if _active(value):
            assert value is not None
            wanted = value.lower()
            result = [row for row in result if _lower(row.get(key)) == wanted]
    if _active(region):
        assert region is not None
        result = [row for row in result if _includes(row.get("region"), region)]
    if time_start is not None:
        result = [
            row
            for row in result
            if (
                math.inf
                if row.get("abandonedYear") is None
                else float(row["abandonedYear"])
            )
            >= time_start
        ]
    if time_end is not None:
        result = [
            row
            for row in result
            if (
                -math.inf
                if row.get("foundedYear") is None
                else float(row["foundedYear"])
            )
            <= time_end
        ]
    if bounding_box is not None:
        box = bounding_box
        result = [
            row
            for row in result
            if box["minLat"] <= float(row["latitude"]) <= box["maxLat"]
            and box["minLng"] <= float(row["longitude"]) <= box["maxLng"]
        ]
    return result


def settlements_by_civilization(
    settlements: list[Record], civilization_id: str
) -> list[Record]:
    """`GET /api/settlements/by-civilization/{civilizationId}`."""
    wanted = civilization_id.lower()
    return [row for row in settlements if _lower(row.get("civilizationId")) == wanted]


def settlements_nearby(
    settlements: list[Record],
    lat: float,
    lng: float,
    radius_km: float = DEFAULT_NEARBY_RADIUS_KM,
) -> list[Record]:
    """`GET /api/settlements/nearby/{lat}/{lng}` — culled, then ordered.

    **The cull and the sort do not use the same distance**, and that is the
    TypeScript's, not a slip: membership is a great-circle haversine in
    kilometres, the ordering is `Math.hypot` on raw degrees. They disagree away
    from the equator — a degree of longitude is not a degree of latitude — so
    two settlements inside the radius can be ordered the "wrong" way round. The
    ordering is a cheap proxy the route has always used; a corrected sort would
    silently re-rank every result the client has cached.
    """
    within = [
        row
        for row in settlements
        if haversine_km(lat, lng, float(row["latitude"]), float(row["longitude"]))
        <= radius_km
    ]
    return sorted(
        within,
        key=lambda row: math.hypot(
            float(row["latitude"]) - lat, float(row["longitude"]) - lng
        ),
    )
