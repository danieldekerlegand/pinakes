"""The genetic ↔ linguistic correlation engine and its route.

`server/services/genetic-linguistic-correlation.ts` has no unit test of
`computeCorrelations` on the TypeScript side (its suite covers the ancestry
mapper, which is a different port unit), so this file pins the behaviour the
port had to read out of the implementation — including the two fallbacks that
look like bugs and are not.
"""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from pinakes.analytics import genetic
from pinakes.analytics.corpus import Haplogroup, LanguageFamily


def haplogroup(
    identifier: str,
    *,
    name: str | None = None,
    type_: str = "Y-chromosome",
    families: list[str] | None = None,
    origin: str = "",
) -> Haplogroup:
    return Haplogroup(
        id=identifier,
        name=name if name is not None else identifier.upper(),
        haplogroup_type=type_,
        associated_language_family_ids=families or [],
        associated_civilization_ids=[],
        geographic_origin=origin,
        time_origin=None,
    )


def family(identifier: str, name: str, region: str | None = None) -> LanguageFamily:
    return LanguageFamily(id=identifier, name=name, region=region)


# ── Region geometry ──────────────────────────────────────────────────────────


def test_region_bounds_resolve_exactly_then_by_substring() -> None:
    assert genetic.find_region_bounds("Siberia") == {
        "lat": (50, 78),
        "lng": (60, 180),
    }
    # "Northern Europe" is not a key of its own here — the substring pass finds
    # the first entry that contains or is contained by it.
    assert genetic.find_region_bounds("Europe (broadly)") is not None
    assert genetic.find_region_bounds("Atlantis") is None


def test_region_overlap_is_intersection_over_union() -> None:
    assert genetic.region_overlap("Europe", "Europe") == 1
    # Disjoint boxes score nothing at all.
    assert genetic.region_overlap("Siberia", "South America") == 0
    partial = genetic.region_overlap("Europe", "Central Europe")
    assert 0 < partial < 1


def test_an_unknown_region_overlaps_nothing() -> None:
    assert genetic.region_overlap("Atlantis", "Europe") == 0


# ── Correlations ─────────────────────────────────────────────────────────────


def test_an_overlapping_pair_scores_its_shared_regions() -> None:
    result = genetic.compute_correlations(
        [haplogroup("r1b", families=["indo_european"], origin="Western Europe")],
        [family("indo_european", "Indo-European", "Europe")],
    )
    (entry,) = result["correlations"]
    assert entry["haplogroupId"] == "r1b"
    assert entry["languageFamilyName"] == "Indo-European"
    assert entry["overlapScore"] > 0
    assert entry["sharedRegions"] == ["Western Europe / Europe"]


def test_a_named_but_non_overlapping_pair_falls_back_to_the_baseline() -> None:
    """The association is itself the evidence — see the module header."""
    result = genetic.compute_correlations(
        [haplogroup("q", families=["na_dene"], origin="Siberia")],
        [family("na_dene", "Na-Dené", "South America")],
    )
    (entry,) = result["correlations"]
    assert entry["overlapScore"] == genetic.ASSOCIATED_SCORE
    assert entry["sharedRegions"] == ["Siberia (associated)"]


def test_a_pair_with_a_blank_region_scores_lower_still() -> None:
    result = genetic.compute_correlations(
        [haplogroup("x", families=["isolate"])],
        [family("isolate", "Isolate")],
    )
    (entry,) = result["correlations"]
    assert entry["overlapScore"] == genetic.UNLOCATED_SCORE
    assert entry["sharedRegions"] == ["Association in data"]


def test_a_family_the_corpus_does_not_have_is_skipped() -> None:
    result = genetic.compute_correlations(
        [haplogroup("r1b", families=["ghost"], origin="Europe")], []
    )
    assert result["correlations"] == []
    assert result["summary"].startswith("Found 0 genetic-linguistic correlations")


def test_correlations_are_ranked_by_overlap_descending() -> None:
    result = genetic.compute_correlations(
        [
            haplogroup("q", families=["na_dene"], origin="Siberia"),
            haplogroup("r1b2", families=["indo_european"], origin="Europe"),
        ],
        [
            family("na_dene", "Na-Dené", "South America"),
            family("indo_european", "Indo-European", "Europe"),
        ],
    )
    scores = [entry["overlapScore"] for entry in result["correlations"]]
    assert scores == sorted(scores, reverse=True)


def test_the_haplogroup_type_filter_removes_the_first_hyphen_only() -> None:
    mitochondrial = haplogroup("h", type_="mtDNA", families=["ie"], origin="Europe")
    paternal = haplogroup("r1b", type_="Y-chromosome", families=["ie"], origin="Europe")
    families = [family("ie", "Indo-European", "Europe")]

    both = genetic.compute_correlations([mitochondrial, paternal], families)
    assert len(both["correlations"]) == 2

    # "Y-chromosome" and "ychromosome" normalize to the same key.
    filtered = genetic.compute_correlations(
        [mitochondrial, paternal], families, "ychromosome"
    )
    assert [entry["haplogroupId"] for entry in filtered["correlations"]] == ["r1b"]


# ── Divergences ──────────────────────────────────────────────────────────────


def test_a_recorded_association_carries_its_divergence_annotation() -> None:
    result = genetic.compute_correlations(
        [haplogroup("r1b", name="R1b", families=["uralic"], origin="Europe")],
        [family("uralic", "Uralic", "Northern Europe")],
    )
    (entry,) = result["correlations"]
    assert entry["divergence"] is not None
    assert "Hungarian" in entry["divergence"]
    assert result["divergences"] == [
        {
            "haplogroupName": "R1b",
            "languageFamilyName": "Uralic",
            "annotation": entry["divergence"],
        }
    ]


def test_an_unrecorded_association_is_the_more_interesting_divergence() -> None:
    """The second pass reports pairs the corpus does *not* record."""
    result = genetic.compute_correlations(
        [haplogroup("r1b", name="R1b", origin="Europe")],
        [family("uralic", "Uralic", "Northern Europe")],
    )
    assert result["correlations"] == []
    names = [entry["languageFamilyName"] for entry in result["divergences"]]
    assert names == ["Uralic"]
    assert result["summary"].endswith("1 notable divergences identified.")


# ── The route ────────────────────────────────────────────────────────────────


def write_genetic_corpus(lexicons: Path) -> None:
    (lexicons / "haplogroups.tsv").write_text(
        "id\tname\tparent_id\thaplogroup_type\tdescription\t"
        "associated_language_family_ids\tassociated_civilization_ids\t"
        "geographic_origin\ttime_origin\tsources\n"
        "r1b\tR1b\tnull\tY-chromosome\t\t"
        '["indo_european"]\t[]\tWestern Europe\t-20000\t[]\n'
        "h\tH\tnull\tmtDNA\t\t"
        '["uralic"]\t[]\tNorthern Europe\tnull\t[]\n',
        encoding="utf-8",
    )
    (lexicons / "families.tsv").write_text(
        "id\tname\tparent_id\ttaxonomic_level\tregion\n"
        "indo_european\tIndo-European\t\tfamily\tEurope\n"
        "uralic\tUralic\t\tfamily\tNorthern Europe\n",
        encoding="utf-8",
    )


def test_the_route_correlates_the_whole_corpus(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    write_genetic_corpus(isolated_data_trees["lexicons"])
    payload = unbuilt_client.get("/api/genetic-linguistic-correlations").json()
    assert len(payload["correlations"]) == 2
    assert payload["summary"].startswith("Found 2 genetic-linguistic correlations")


def test_the_route_filters_by_haplogroup_type(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    write_genetic_corpus(isolated_data_trees["lexicons"])
    payload = unbuilt_client.get(
        "/api/genetic-linguistic-correlations?haplogroupType=mtDNA"
    ).json()
    assert [entry["haplogroupId"] for entry in payload["correlations"]] == ["h"]


def test_an_absent_corpus_is_an_empty_correlation_not_a_500(
    unbuilt_client: TestClient,
) -> None:
    response = unbuilt_client.get("/api/genetic-linguistic-correlations")
    assert response.status_code == 200
    assert response.json()["correlations"] == []
