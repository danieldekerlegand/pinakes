"""Genetic ↔ linguistic correlation — the port of `computeCorrelations`.

Scores each haplogroup against the language families it is associated with, by
the geographic overlap of the two macro-regions they name, and flags the
population-genetics cases where genes and language are known to diverge.

Only the correlation half of `server/services/genetic-linguistic-correlation.ts`
lives here. `mapHaplogroupsToAncestry` — the DNA-to-culture mapper behind
`/api/ancestry/*` — is a **different port unit** (`server/routes/ancestry.ts`),
so it stays on Express with the divergence table it shares; when it lands, the
table below is what it should read rather than a second copy.

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

from collections.abc import Sequence
from typing import Any

from pinakes.analytics.corpus import Haplogroup, LanguageFamily
from pinakes.analytics.jsmath import round_to

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
