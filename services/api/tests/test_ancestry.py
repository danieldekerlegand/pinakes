"""`/api/ancestry/*` — haplogroup ids to cultural associations.

The mapper is pure over an injected :class:`~pinakes.analytics.genetic.AncestryData`,
so most of this drives it directly; the two route tests seed a small corpus on
disk because the loader reads the lexicons directory.

The case worth reading twice is
:func:`test_a_bare_name_reference_resolves_to_the_namespaced_corpus_id`. Without
that fallback the map is *empty* against live data — a haplogroup row says
`germanic` where the corpus says `indo_european__germanic` — and an empty result
is indistinguishable from "no associations", so it fails silently.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pinakes.analytics.corpus import (
    Civilization,
    Cuisine,
    Haplogroup,
    Language,
    LanguageFamily,
)
from pinakes.analytics.genetic import (
    ANCESTRY_CAVEATS,
    AncestryData,
    map_haplogroups_to_ancestry,
    normalize_assoc_key,
    reference_haplogroups,
    support_confidence,
)

DATA = AncestryData(
    haplogroups=[
        Haplogroup(
            id="r1b",
            name="R1b",
            haplogroup_type="Y-chromosome",
            associated_language_family_ids=["germanic"],
            associated_civilization_ids=["celts"],
            geographic_origin="Western Europe",
            time_origin=-20000,
        ),
        Haplogroup(
            id="r1a",
            name="R1a",
            haplogroup_type="Y-chromosome",
            associated_language_family_ids=["germanic"],
            associated_civilization_ids=[],
            geographic_origin="Eastern Europe",
            time_origin=-18000,
        ),
    ],
    families=[
        LanguageFamily(
            id="indo_european__germanic", name="Germanic", region="Northern Europe"
        )
    ],
    languages=[
        Language(
            id="deu",
            name="German",
            family_id="indo_european__germanic",
            region="Central Europe",
            coordinates=None,
        ),
        Language(
            id="eng",
            name="English",
            family_id="indo_european__germanic",
            region="Britain",
            coordinates=None,
        ),
    ],
    civilizations=[
        Civilization(
            id="celtic_peoples",
            name="Celts",
            associated_language_ids=[],
            time_start=-800,
            time_end=-50,
        )
    ],
    cuisines=[
        Cuisine(
            id="german-cuisine",
            name="German cuisine",
            region="Central Europe",
            coordinates={"lat": 51.0, "lng": 10.0},
            associated_language_ids=["deu"],
            time_origin=None,
            time_end=None,
        )
    ],
)


def test_a_bare_name_reference_resolves_to_the_namespaced_corpus_id() -> None:
    """`germanic` → `indo_european__germanic`, `celts` → `celtic_peoples`."""
    result = map_haplogroups_to_ancestry(["r1b"], DATA)

    assert [entry["familyId"] for entry in result["spoke"]] == [
        "indo_european__germanic"
    ]
    assert [entry["civilizationId"] for entry in result["livedAmong"]] == [
        "celtic_peoples"
    ]


def test_confidence_rises_with_the_number_of_supporting_haplogroups() -> None:
    one = map_haplogroups_to_ancestry(["r1b"], DATA)["spoke"][0]
    two = map_haplogroups_to_ancestry(["r1b", "r1a"], DATA)["spoke"][0]

    assert one["confidence"] == 0.4
    assert two["confidence"] == 0.5
    assert two["viaHaplogroups"] == ["R1a", "R1b"]


def test_the_cuisine_chain_is_indirect_and_capped_lower() -> None:
    """family → its languages → cuisines citing them. Two inferential steps, so
    it can never reach the direct associations' 0.85 ceiling."""
    result = map_haplogroups_to_ancestry(["r1b", "r1a"], DATA)

    assert [entry["cuisineId"] for entry in result["ate"]] == ["german-cuisine"]
    assert result["ate"][0]["confidence"] == 0.3
    assert support_confidence(0.3, 20, 0.65) == 0.65


def test_matching_is_case_insensitive_and_unmatched_ids_are_reported() -> None:
    result = map_haplogroups_to_ancestry(["  R1B  ", "q3"], DATA)

    assert [entry["id"] for entry in result["matchedHaplogroups"]] == ["r1b"]
    assert result["unmatchedHaplogroupIds"] == ["q3"]


def test_a_result_that_matched_nothing_still_carries_the_caveats() -> None:
    """The caveats are not a footnote on a positive result — they are the
    posture, and a nothing-matched answer says so too."""
    result = map_haplogroups_to_ancestry(["q3"], DATA)

    assert result["spoke"] == []
    assert result["caveats"] == list(ANCESTRY_CAVEATS)
    assert result["summary"].startswith(
        "None of the supplied haplogroups matched the reference dataset"
    )


def test_the_summary_is_singular_for_one_of_each() -> None:
    result = map_haplogroups_to_ancestry(["r1b"], DATA)
    assert result["summary"] == (
        "Your haplogroup is associated with 1 language family, 1 historical "
        "culture, and 1 cuisine. These are exploratory associations — see the "
        "caveats."
    )


def test_a_sample_language_list_is_bounded() -> None:
    many = AncestryData(
        haplogroups=DATA.haplogroups,
        families=DATA.families,
        languages=[
            Language(
                id=f"l{index}",
                name=f"L{index}",
                family_id="indo_european__germanic",
                region=None,
                coordinates=None,
            )
            for index in range(9)
        ],
        civilizations=DATA.civilizations,
        cuisines=[],
    )
    assert (
        len(map_haplogroups_to_ancestry(["r1b"], many)["spoke"][0]["sampleLanguages"])
        == 5
    )


def test_normalize_assoc_key_slugifies_punctuation() -> None:
    assert normalize_assoc_key("Italo-Celtic") == "italo-celtic"
    assert normalize_assoc_key("  Proto—Indo European  ") == "proto-indo-european"


def test_the_divergence_table_is_the_correlation_engine_s() -> None:
    """One table, two consumers — the thing pinakes:62 US-1 asked a later port
    to arrange rather than copy."""
    from pinakes.analytics import genetic

    uralic = AncestryData(
        haplogroups=[
            Haplogroup(
                id="r1b",
                name="R1b",
                haplogroup_type="Y-chromosome",
                associated_language_family_ids=[],
                associated_civilization_ids=[],
                geographic_origin="Western Europe",
                time_origin=None,
            )
        ],
        families=[
            LanguageFamily(id="uralic", name="Uralic", region="Northern Eurasia")
        ],
        languages=[],
        civilizations=[],
        cuisines=[],
    )
    divergences = map_haplogroups_to_ancestry(["r1b"], uralic)["divergences"]
    assert divergences == [
        {
            "haplogroupName": "R1b",
            "languageFamilyName": "Uralic",
            "annotation": genetic.NOTABLE_DIVERGENCES[0]["annotation"],
        }
    ]


# ── The routes ───────────────────────────────────────────────────────────────

HAPLOGROUPS = "\n".join(
    [
        "\t".join(
            [
                "id",
                "name",
                "haplogroup_type",
                "associated_language_family_ids",
                "associated_civilization_ids",
                "geographic_origin",
                "time_origin",
            ]
        ),
        "\t".join(
            [
                "r1b",
                "R1b",
                "Y-chromosome",
                '["germanic"]',
                "[]",
                "Western Europe",
                "-20000",
            ]
        ),
    ]
)


@pytest.fixture
def seeded_corpus(isolated_data_trees: dict[str, Path]) -> Path:
    lexicons = isolated_data_trees["lexicons"]
    (lexicons / "haplogroups.tsv").write_text(HAPLOGROUPS + "\n", encoding="utf-8")
    return lexicons


def test_the_index_lists_only_the_non_identifying_fields(
    unbuilt_client: TestClient, seeded_corpus: Path
) -> None:
    body = unbuilt_client.get("/api/ancestry/haplogroups").json()
    assert body == {
        "haplogroups": [
            {"id": "r1b", "name": "R1b", "geographicOrigin": "Western Europe"}
        ]
    }
    assert reference_haplogroups(DATA)["haplogroups"][0].keys() == {
        "id",
        "name",
        "geographicOrigin",
    }


def test_the_map_route_answers_over_the_corpus(
    unbuilt_client: TestClient, seeded_corpus: Path
) -> None:
    response = unbuilt_client.post("/api/ancestry/map", json={"haplogroupIds": ["r1b"]})
    assert response.status_code == 200
    body = response.json()
    assert [entry["id"] for entry in body["matchedHaplogroups"]] == ["r1b"]
    assert body["caveats"] == list(ANCESTRY_CAVEATS)


def test_an_empty_id_list_is_400(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.post("/api/ancestry/map", json={"haplogroupIds": []})
    assert response.status_code == 400
    assert response.json() == {
        "error": "haplogroupIds must be a non-empty array of strings"
    }


def test_a_list_with_no_readable_ids_is_a_different_400(
    unbuilt_client: TestClient,
) -> None:
    response = unbuilt_client.post("/api/ancestry/map", json={"haplogroupIds": [1, 2]})
    assert response.status_code == 400
    assert response.json() == {
        "error": "haplogroupIds must contain at least one string id"
    }
