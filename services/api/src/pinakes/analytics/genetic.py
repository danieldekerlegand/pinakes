"""Genetic ↔ linguistic correlation — the port of `computeCorrelations`.

Scores each haplogroup against the language families it is associated with, by
the geographic overlap of the two macro-regions they name, and flags the
population-genetics cases where genes and language are known to diverge.

Both halves of `server/services/genetic-linguistic-correlation.ts` now live
here. The DNA-to-culture mapper behind `/api/ancestry/*` was a later port unit
(pinakes:65 US-2) and landed in this module rather than beside it, so the two
share one :data:`NOTABLE_DIVERGENCES` table — see the second section below.

Two things the port keeps that look like bugs and are not:

* **An association with no geographic overlap still scores.** A haplogroup row
  that *names* a family is evidence in itself, so a non-overlapping pair falls
  back to a 0.3 baseline (0.2 when either region is blank) rather than dropping
  out. The `sharedRegions` string is what says which of the three happened.
* **The divergence list is not a projection of the correlations.** The second
  pass runs over every haplogroup of the requested *type*, including the ones
  that name no family at all, and reports the pairs the corpus does **not**
  record — an unrecorded association is exactly what a genes/language divergence
  looks like in this data.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pinakes.analytics.corpus import (
    Civilization,
    Cuisine,
    Haplogroup,
    Language,
    LanguageFamily,
    load_civilizations,
    load_cuisines,
    load_haplogroups,
    load_language_families,
    load_languages,
)
from pinakes.analytics.jsmath import locale_key, round_to

#: Everything `normalizeAssocKey`'s ``/[^a-z0-9]+/g`` collapses to a hyphen.
_NON_ALPHANUMERIC = re.compile(r"[^a-z0-9]+")

#: Approximate lat/lng rectangles for the macro-regions the corpus names. Order
#: matters: :func:`find_region_bounds` falls back to the first substring match.
REGION_BOUNDS: dict[str, dict[str, tuple[float, float]]] = {
    "Africa": {"lat": (-35, 37), "lng": (-18, 52)},
    "East Africa": {"lat": (-12, 12), "lng": (28, 52)},
    "West Africa": {"lat": (0, 18), "lng": (-18, 15)},
    "North Africa": {"lat": (20, 37), "lng": (-18, 35)},
    "South Africa": {"lat": (-35, -15), "lng": (15, 40)},
    "Central Africa": {"lat": (-10, 10), "lng": (8, 32)},
    "Europe": {"lat": (35, 72), "lng": (-12, 45)},
    "Western Europe": {"lat": (36, 60), "lng": (-12, 15)},
    "Eastern Europe": {"lat": (42, 70), "lng": (20, 45)},
    "Northern Europe": {"lat": (55, 72), "lng": (-12, 30)},
    "Southern Europe": {"lat": (35, 48), "lng": (-10, 30)},
    "Central Europe": {"lat": (45, 55), "lng": (5, 25)},
    "Middle East": {"lat": (12, 42), "lng": (25, 60)},
    "Near East": {"lat": (30, 42), "lng": (25, 45)},
    "Central Asia": {"lat": (35, 55), "lng": (50, 90)},
    "South Asia": {"lat": (5, 38), "lng": (60, 98)},
    "East Asia": {"lat": (18, 55), "lng": (95, 145)},
    "Southeast Asia": {"lat": (-10, 25), "lng": (95, 140)},
    "Northeast Asia": {"lat": (40, 72), "lng": (100, 170)},
    "Siberia": {"lat": (50, 78), "lng": (60, 180)},
    "Oceania": {"lat": (-50, 0), "lng": (110, 180)},
    "Americas": {"lat": (-55, 72), "lng": (-170, -35)},
    "North America": {"lat": (15, 72), "lng": (-170, -50)},
    "South America": {"lat": (-55, 15), "lng": (-82, -35)},
    "Arctic": {"lat": (65, 90), "lng": (-180, 180)},
}

#: Known divergences between genetics and linguistics, matched by substring
#: against a haplogroup id and a language-family id.
NOTABLE_DIVERGENCES: tuple[dict[str, str], ...] = (
    {
        "haplogroupPattern": "r1b",
        "languageFamilyPattern": "uralic",
        "annotation": (
            "Hungarian: Uralic language but predominantly R1b genetics from "
            "surrounding Indo-European populations"
        ),
    },
    {
        "haplogroupPattern": "n",
        "languageFamilyPattern": "uralic",
        "annotation": (
            "Finno-Ugric peoples carry high N haplogroup frequencies despite "
            "geographic proximity to R1a-dominant Slavic populations"
        ),
    },
    {
        "haplogroupPattern": "r1a",
        "languageFamilyPattern": "dravidian",
        "annotation": (
            "R1a present in Dravidian-speaking South India suggests Indo-Aryan "
            "genetic admixture without full language replacement"
        ),
    },
    {
        "haplogroupPattern": "e1b1b",
        "languageFamilyPattern": "indo-european",
        "annotation": (
            "E1b1b haplogroup found in Greek and Albanian speakers — "
            "African-origin haplogroup in Indo-European speakers"
        ),
    },
    {
        "haplogroupPattern": "j2",
        "languageFamilyPattern": "turkic",
        "annotation": (
            "Turkish speakers carry high J2 frequencies from Anatolian "
            "populations despite Turkic language adoption"
        ),
    },
    {
        "haplogroupPattern": "o",
        "languageFamilyPattern": "austronesian",
        "annotation": (
            "Haplogroup O dominant in both Austronesian and Sino-Tibetan "
            "speakers — shared genetic ancestry despite linguistic divergence"
        ),
    },
)

#: Score for a pair whose regions are both named but do not overlap.
ASSOCIATED_SCORE = 0.3
#: Score for a pair where one of the two regions is blank.
UNLOCATED_SCORE = 0.2


def find_region_bounds(region: str) -> dict[str, tuple[float, float]] | None:
    """Bounds for a region name: exact, else the first two-way substring match."""
    exact = REGION_BOUNDS.get(region)
    if exact is not None:
        return exact
    lowered = region.lower()
    for key, bounds in REGION_BOUNDS.items():
        if lowered in key.lower() or key.lower() in lowered:
            return bounds
    return None


def region_overlap(region_a: str, region_b: str) -> float:
    """Intersection-over-union of the two regions' bounding boxes, or 0."""
    bounds_a = find_region_bounds(region_a)
    bounds_b = find_region_bounds(region_b)
    if bounds_a is None or bounds_b is None:
        return 0.0

    lat_a, lat_b = bounds_a["lat"], bounds_b["lat"]
    lng_a, lng_b = bounds_a["lng"], bounds_b["lng"]
    lat_overlap = max(0.0, min(lat_a[1], lat_b[1]) - max(lat_a[0], lat_b[0]))
    lng_overlap = max(0.0, min(lng_a[1], lng_b[1]) - max(lng_a[0], lng_b[0]))
    if lat_overlap == 0 or lng_overlap == 0:
        return 0.0

    overlap_area = lat_overlap * lng_overlap
    area_a = (lat_a[1] - lat_a[0]) * (lng_a[1] - lng_a[0])
    area_b = (lat_b[1] - lat_b[0]) * (lng_b[1] - lng_b[0])
    union_area = area_a + area_b - overlap_area
    return overlap_area / union_area if union_area > 0 else 0.0


def _normalize_type(value: str) -> str:
    """The `haplogroupType` comparison: lowercased with the first hyphen removed.

    ``"Y-chromosome".replace("-", "")`` in JavaScript replaces only the *first*
    occurrence, which is why this is not a general de-hyphenation.
    """
    return value.lower().replace("-", "", 1)


def compute_correlations(
    haplogroups: Sequence[Haplogroup],
    families: Sequence[LanguageFamily],
    haplogroup_type: str | None = None,
) -> dict[str, Any]:
    """Score every (haplogroup, associated family) pair and collect divergences."""
    if haplogroup_type:
        wanted = _normalize_type(haplogroup_type)
        haplogroups = [
            haplogroup
            for haplogroup in haplogroups
            if _normalize_type(haplogroup.haplogroup_type) == wanted
        ]

    with_families = [
        haplogroup
        for haplogroup in haplogroups
        if haplogroup.associated_language_family_ids
    ]
    family_by_id = {family.id: family for family in families}

    correlations: list[dict[str, Any]] = []
    divergences: list[dict[str, str]] = []

    for haplogroup in with_families:
        for family_id in haplogroup.associated_language_family_ids:
            family = family_by_id.get(family_id)
            if family is None:
                continue

            haplogroup_region = haplogroup.geographic_origin
            family_region = family.region or ""
            shared_regions: list[str] = []

            if haplogroup_region and family_region:
                overlap = region_overlap(haplogroup_region, family_region)
                if overlap > 0:
                    shared_regions.append(f"{haplogroup_region} / {family_region}")
                else:
                    # The association is itself the evidence — see the header.
                    overlap = ASSOCIATED_SCORE
                    shared_regions.append(f"{haplogroup_region} (associated)")
            else:
                overlap = UNLOCATED_SCORE
                shared_regions.append("Association in data")

            divergence: str | None = None
            for entry in NOTABLE_DIVERGENCES:
                if (
                    entry["haplogroupPattern"] in haplogroup.id.lower()
                    and entry["languageFamilyPattern"] in family_id.lower()
                ):
                    divergence = entry["annotation"]
                    divergences.append(
                        {
                            "haplogroupName": haplogroup.name,
                            "languageFamilyName": family.name,
                            "annotation": entry["annotation"],
                        }
                    )

            correlations.append(
                {
                    "haplogroupId": haplogroup.id,
                    "haplogroupName": haplogroup.name,
                    "haplogroupType": haplogroup.haplogroup_type,
                    "languageFamilyId": family_id,
                    "languageFamilyName": family.name,
                    "overlapScore": round_to(overlap, 2),
                    "sharedRegions": shared_regions,
                    "divergence": divergence,
                }
            )

    correlations.sort(key=lambda entry: -float(entry["overlapScore"]))

    # Divergences involving a haplogroup that does NOT name the family — the
    # interesting half, since an unrecorded association is the divergence.
    for haplogroup in haplogroups:
        for entry in NOTABLE_DIVERGENCES:
            if entry["haplogroupPattern"] not in haplogroup.id.lower():
                continue
            matching_id = next(
                (
                    family_id
                    for family_id in family_by_id
                    if entry["languageFamilyPattern"] in family_id.lower()
                ),
                None,
            )
            if (
                matching_id is None
                or matching_id in haplogroup.associated_language_family_ids
            ):
                continue
            family = family_by_id[matching_id]
            if any(
                seen["haplogroupName"] == haplogroup.name
                and seen["languageFamilyName"] == family.name
                for seen in divergences
            ):
                continue
            divergences.append(
                {
                    "haplogroupName": haplogroup.name,
                    "languageFamilyName": family.name,
                    "annotation": entry["annotation"],
                }
            )

    family_count = len({entry["languageFamilyId"] for entry in correlations})
    return {
        "correlations": correlations,
        "divergences": divergences,
        "summary": (
            f"Found {len(correlations)} genetic-linguistic correlations across "
            f"{len(with_families)} haplogroups and {family_count} language "
            f"families. {len(divergences)} notable divergences identified."
        ),
    }


# ── DNA → culture mapping (`/api/ancestry/*`) ────────────────────────────────
#
# The other half of `server/services/genetic-linguistic-correlation.ts`, landed
# in pinakes:65 US-2 as this module's docstring said it should: it reads
# :data:`NOTABLE_DIVERGENCES` above rather than carrying a second copy.
#
# The privacy posture is the client's, not this module's. Raw-DNA parsing and
# haplogroup inference happen in the browser (`web/src/lib/dna/*`); only the
# non-identifying haplogroup ids reach the server, and all this does is enrich
# them from the public reference corpus.


#: Fixed, always-shown caveats — heritage is probabilistic and mostly *learned*,
#: not genetic, and the result says so whatever it found.
ANCESTRY_CAVEATS: tuple[str, ...] = (
    "Your raw genetic data was processed entirely in your browser and was never "
    "uploaded or stored.",
    "Haplogroups trace only your deep paternal (Y-DNA) line — a single thread of "
    "your ancestry, not your whole genome or recent family history.",
    "A shared haplogroup reflects broad population-genetic patterns; it does not "
    "mean you descend directly from, or belong to, any of these cultures.",
    "Language, cuisine, and culture are learned and shared, not inherited in DNA "
    "— these associations are exploratory prompts for research, not statements "
    "about your identity.",
    "Genetics and language often diverge (populations adopt new languages without "
    "replacing their genes), so treat every match as a starting point for further "
    "reading.",
)

#: How many sample languages a language-family association lists.
SAMPLE_LANGUAGE_LIMIT = 5


def normalize_assoc_key(value: str) -> str:
    """Normalize a name or id to a comparable slug ("Italo-Celtic" → "italo-celtic")."""
    slug = _NON_ALPHANUMERIC.sub("-", value.lower())
    return slug.strip("-")


def support_confidence(base: float, count: int, cap: float) -> float:
    """Confidence for an association supported by *count* matched haplogroups."""
    value = base + 0.1 * max(0, count - 1)
    return round_to(min(cap, value), 2)


def _by_confidence_then(
    name_key: str,
) -> Callable[[Mapping[str, Any]], tuple[float, tuple[str, list[int], str]]]:
    """`(b.confidence - a.confidence) || a.<name>.localeCompare(b.<name>)`.

    Spelled as a named helper rather than inline because the association records
    are loosely-typed dicts, and a lambda over one reads as an ordering over
    ``object``.
    """

    def key(entry: Mapping[str, Any]) -> tuple[float, tuple[str, list[int], str]]:
        return -float(entry["confidence"]), locale_key(str(entry[name_key]))

    return key


@dataclass(frozen=True, slots=True)
class AncestryData:
    """The minimal corpus slice the mapper needs. Injectable, so it is pure."""

    haplogroups: Sequence[Haplogroup]
    families: Sequence[LanguageFamily]
    languages: Sequence[Language]
    civilizations: Sequence[Civilization]
    cuisines: Sequence[Cuisine]


def load_ancestry_data(lexicons: Path) -> AncestryData:
    """Assemble :class:`AncestryData` from the live corpus."""
    return AncestryData(
        haplogroups=load_haplogroups(lexicons),
        families=load_language_families(lexicons),
        languages=load_languages(lexicons),
        civilizations=load_civilizations(lexicons),
        cuisines=load_cuisines(lexicons),
    )


def reference_haplogroups(data: AncestryData) -> dict[str, Any]:
    """`GET /api/ancestry/haplogroups` — the ids the mapper recognizes."""
    return {
        "haplogroups": [
            {
                "id": haplogroup.id,
                "name": haplogroup.name,
                "geographicOrigin": haplogroup.geographic_origin,
            }
            for haplogroup in data.haplogroups
        ]
    }


def _resolver(
    rows: Sequence[Any],
) -> Callable[[str], Any]:
    """Resolve a reference by exact id, then by normalized *name*.

    The join the whole mapper rests on: a haplogroup row references families and
    civilizations by bare name-slug (`germanic`, `celts`) while the corpus keys
    them by namespaced id (`indo_european__germanic`). Without the name
    fallback the map is empty against live data.
    """
    by_id = {row.id: row for row in rows}
    by_name: dict[str, Any] = {}
    for row in rows:
        key = normalize_assoc_key(row.name)
        if key and key not in by_name:
            by_name[key] = row

    def resolve(raw: str) -> Any:
        return by_id.get(raw) or by_name.get(normalize_assoc_key(raw))

    return resolve


def map_haplogroups_to_ancestry(
    haplogroup_ids: Sequence[str], data: AncestryData
) -> dict[str, Any]:
    """Map inferred haplogroup ids to associated languages, cultures and cuisines.

    Pure over *data* — no storage, no clock — so it is unit-tested on synthetic
    fixtures. Confidence rises with the number of matched haplogroups supporting
    an association, and the **cuisine** chain (family → its languages → cuisines
    citing them) is indirect, so it is capped lower than the direct ones.
    """
    wanted: list[str] = []
    for raw in haplogroup_ids:
        key = raw.strip().lower()
        if key and key not in wanted:
            wanted.append(key)

    by_lower_id = {haplogroup.id.lower(): haplogroup for haplogroup in data.haplogroups}
    matched = [by_lower_id[key] for key in wanted if key in by_lower_id]
    matched_ids = {haplogroup.id.lower() for haplogroup in matched}
    unmatched = [key for key in wanted if key not in matched_ids]

    resolve_family = _resolver(data.families)
    resolve_civilization = _resolver(data.civilizations)

    family_support: dict[str, set[str]] = {}
    resolved_families: dict[str, LanguageFamily] = {}
    civilization_support: dict[str, set[str]] = {}
    resolved_civilizations: dict[str, Civilization] = {}
    for haplogroup in matched:
        for raw_family_id in haplogroup.associated_language_family_ids:
            family = resolve_family(raw_family_id)
            if family is None:
                continue
            resolved_families[family.id] = family
            family_support.setdefault(family.id, set()).add(haplogroup.name)
        for raw_civilization_id in haplogroup.associated_civilization_ids:
            civilization = resolve_civilization(raw_civilization_id)
            if civilization is None:
                continue
            resolved_civilizations[civilization.id] = civilization
            civilization_support.setdefault(civilization.id, set()).add(haplogroup.name)

    languages_by_family: dict[str, list[str]] = {}
    for language in data.languages:
        sample = languages_by_family.setdefault(language.family_id, [])
        if len(sample) < SAMPLE_LANGUAGE_LIMIT:
            sample.append(language.name)

    spoke = [
        {
            "familyId": family_id,
            "familyName": resolved_families[family_id].name,
            "region": resolved_families[family_id].region,
            "confidence": support_confidence(0.4, len(support), 0.85),
            "sampleLanguages": languages_by_family.get(family_id, []),
            "viaHaplogroups": sorted(support),
        }
        for family_id, support in family_support.items()
    ]
    spoke.sort(key=_by_confidence_then("familyName"))

    lived_among = [
        {
            "civilizationId": civilization_id,
            "name": resolved_civilizations[civilization_id].name,
            "confidence": support_confidence(0.4, len(support), 0.85),
            "viaHaplogroups": sorted(support),
        }
        for civilization_id, support in civilization_support.items()
    ]
    lived_among.sort(key=_by_confidence_then("name"))

    family_language_ids = {
        language.id
        for language in data.languages
        if language.family_id in family_support
    }
    ate = []
    for cuisine in data.cuisines:
        overlap = [
            language_id
            for language_id in cuisine.associated_language_ids
            if language_id in family_language_ids
        ]
        if not overlap:
            continue
        ate.append(
            {
                "cuisineId": cuisine.id,
                "name": cuisine.name,
                "region": cuisine.region,
                "confidence": support_confidence(0.3, len(overlap), 0.65),
            }
        )
    ate.sort(key=_by_confidence_then("name"))

    divergences: list[dict[str, str]] = []
    for haplogroup in matched:
        for entry in NOTABLE_DIVERGENCES:
            if entry["haplogroupPattern"] not in haplogroup.id.lower():
                continue
            family = next(
                (
                    candidate
                    for candidate in data.families
                    if entry["languageFamilyPattern"] in candidate.id.lower()
                    or entry["languageFamilyPattern"]
                    in normalize_assoc_key(candidate.name)
                ),
                None,
            )
            if family is None:
                continue
            if any(
                seen["haplogroupName"] == haplogroup.name
                and seen["languageFamilyName"] == family.name
                for seen in divergences
            ):
                continue
            divergences.append(
                {
                    "haplogroupName": haplogroup.name,
                    "languageFamilyName": family.name,
                    "annotation": entry["annotation"],
                }
            )

    if not matched:
        summary = (
            "None of the supplied haplogroups matched the reference dataset, so "
            "no cultural associations could be drawn."
        )
    else:
        summary = (
            f"Your {'haplogroup is' if len(matched) == 1 else 'haplogroups are'} "
            f"associated with {len(spoke)} language "
            f"{'family' if len(spoke) == 1 else 'families'}, {len(lived_among)} "
            f"historical {'culture' if len(lived_among) == 1 else 'cultures'}, and "
            f"{len(ate)} {'cuisine' if len(ate) == 1 else 'cuisines'}. These are "
            "exploratory associations — see the caveats."
        )

    return {
        "matchedHaplogroups": [
            {
                "id": haplogroup.id,
                "name": haplogroup.name,
                "geographicOrigin": haplogroup.geographic_origin,
                "timeOrigin": haplogroup.time_origin,
            }
            for haplogroup in matched
        ],
        "unmatchedHaplogroupIds": unmatched,
        "spoke": spoke,
        "livedAmong": lived_among,
        "ate": ate,
        "divergences": divergences,
        "caveats": list(ANCESTRY_CAVEATS),
        "summary": summary,
    }
