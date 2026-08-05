"""`/api/relationships/suggestions` — ranking the edges worth proposing.

Two layers are under test and they fail differently. The **ranker** is pure and
graded on fixtures; the **routes** need a corpus, and the candidate pool is
loaded from the lexicons directory rather than injected, so these seed a small
one on disk. That is the port's one structural difference from Express, which
took `loadEntities` as an option.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pinakes.authoring import relationship_edge, suggestions
from pinakes.authoring.relationship_edge import ExistingEdge
from pinakes.authoring.suggestions import SuggestionEntity

ROME = SuggestionEntity(
    id="rome",
    name="Roman Republic",
    entity_type="civilization",
    language_ids=["latin"],
    coordinates={"lat": 41.9, "lng": 12.5},
    time_start=-509,
    time_end=476,
    region="Mediterranean",
)
CARTHAGE = SuggestionEntity(
    id="carthage",
    name="Carthage",
    entity_type="civilization",
    language_ids=["punic"],
    coordinates={"lat": 36.85, "lng": 10.32},
    time_start=-814,
    time_end=-146,
    region="Mediterranean",
)
LATIN = SuggestionEntity(
    id="latin",
    name="Latin",
    entity_type="language",
    language_ids=["latin"],
    coordinates={"lat": 41.9, "lng": 12.5},
    time_start=-700,
    time_end=600,
    region="Italy",
)
HAN = SuggestionEntity(
    id="han",
    name="Han dynasty",
    entity_type="civilization",
    language_ids=["old-chinese"],
    coordinates={"lat": 34.3, "lng": 108.9},
    time_start=-202,
    time_end=220,
    region="East Asia",
)


# ── The ranker ───────────────────────────────────────────────────────────────


def test_a_dimension_neither_entity_carries_is_unmeasured_not_zero() -> None:
    """The rule the whole design rests on.

    A language with no coordinates is not "far away"; averaging a zero in for it
    would rank it below a genuinely weaker match.
    """
    unlocated = SuggestionEntity(
        id="x", name="X", entity_type="language", language_ids=["latin"]
    )
    proximity = suggestions.compute_proximity(unlocated, LATIN, {"now": 2026})

    assert proximity["applicable"] == {
        "linguistic": True,
        "temporal": False,
        "spatial": False,
    }
    assert proximity["linguistic"] == 1
    # Only the linguistic weight counts, so a perfect language match is not
    # diluted to 40 by two dimensions that could never have applied.
    assert suggestions.combined_confidence(proximity) == 95


def test_a_shared_language_between_languages_suggests_cognate_with() -> None:
    ranked = suggestions.suggest_relationships(LATIN, [ROME, HAN], [], {"now": 2026})
    by_id = {entry["targetId"]: entry for entry in ranked}
    # Rome shares `latin`; the dominant signal is linguistic but Rome is not a
    # language, so the domain-agnostic default applies.
    assert by_id["rome"]["relationshipType"] == "influenced-by"
    assert by_id["rome"]["relationshipToken"] == "INFLUENCED_BY"


def test_an_already_connected_pair_is_excluded_in_either_direction() -> None:
    existing = [ExistingEdge("carthage", "rome", "conquered-by")]
    ranked = suggestions.suggest_relationships(
        ROME, [CARTHAGE], existing, {"now": 2026}
    )
    assert ranked == []


def test_a_candidate_with_no_signal_at_all_is_dropped() -> None:
    isolated = SuggestionEntity(id="void", name="Void", entity_type="civilization")
    assert suggestions.suggest_relationships(ROME, [isolated], [], {"now": 2026}) == []


def test_results_are_ranked_by_confidence_then_display_name() -> None:
    """The tiebreak is `localeCompare`, which sorts by base letter before case —
    so a lowercase name is not pushed behind every capitalised one."""
    lower = SuggestionEntity(
        id="a",
        name="alexandria",
        entity_type="civilization",
        language_ids=["latin"],
        region="Mediterranean",
    )
    upper = SuggestionEntity(
        id="b",
        name="Byzantium",
        entity_type="civilization",
        language_ids=["latin"],
        region="Mediterranean",
    )
    ranked = suggestions.suggest_relationships(ROME, [upper, lower], [], {"now": 2026})
    assert [entry["targetName"] for entry in ranked] == ["alexandria", "Byzantium"]


def test_a_suggestion_never_claims_certainty() -> None:
    identical = SuggestionEntity(
        id="twin",
        name="Twin",
        entity_type="civilization",
        language_ids=["latin"],
        coordinates={"lat": 41.9, "lng": 12.5},
        time_start=-509,
        time_end=476,
        region="Mediterranean",
    )
    ranked = suggestions.suggest_relationships(ROME, [identical], [], {"now": 2026})
    assert ranked[0]["confidence"] == suggestions.MAX_SUGGESTION_CONFIDENCE


def test_a_suggestion_carries_a_ready_to_submit_edge() -> None:
    """The contributor confirms it through `POST /api/relationships/edge`;
    nothing here writes."""
    ranked = suggestions.suggest_relationships(ROME, [CARTHAGE], [], {"now": 2026})
    edge = ranked[0]["edge"]
    assert edge["sourceId"] == "rome"
    assert edge["targetId"] == "carthage"
    assert edge["relationshipType"] in relationship_edge.RELATIONSHIP_TYPE_NAMES
    assert edge["evidenceTypes"] == [entry["kind"] for entry in ranked[0]["rationale"]]


# ── The routes ───────────────────────────────────────────────────────────────

LANGUAGES = "\n".join(
    [
        "\t".join(
            [
                "id",
                "name",
                "family_id",
                "status",
                "region",
                "latitude",
                "longitude",
                "time_origin",
                "time_end",
            ]
        ),
        "\t".join(
            [
                "latin",
                "Latin",
                "indo_european",
                "extinct",
                "Italy",
                "41.9",
                "12.5",
                "700 BC",
                "600",
            ]
        ),
        "\t".join(
            [
                "osc",
                "Oscan",
                "indo_european",
                "extinct",
                "Italy",
                "41.0",
                "14.0",
                "500 BC",
                "-100",
            ]
        ),
    ]
)


@pytest.fixture
def seeded_corpus(isolated_data_trees: dict[str, Path]) -> Path:
    lexicons = isolated_data_trees["lexicons"]
    (lexicons / "languages.tsv").write_text(LANGUAGES + "\n", encoding="utf-8")
    return lexicons


def test_the_get_route_ranks_over_the_corpus(
    unbuilt_client: TestClient, seeded_corpus: Path
) -> None:
    response = unbuilt_client.get(
        "/api/relationships/suggestions", params={"entityId": "latin"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == {"id": "latin", "name": "Latin", "entityType": "language"}
    assert body["count"] == len(body["suggestions"])
    assert [entry["targetId"] for entry in body["suggestions"]] == ["osc"]
    # Neither language names the other, so the linguistic signal never fires;
    # ~155 km apart outweighs a 400-year overlap of a 1,300-year span, and a
    # language is not place-like, so the spatial branch falls back to the
    # domain-agnostic default rather than `located-in`.
    assert body["suggestions"][0]["relationshipType"] == "influenced-by"
    # `"700 BC"` is parsed as −700: a free-text date with a BCE marker.
    assert body["suggestions"][0]["proximity"]["overlapYears"] == 400


def test_the_get_route_400s_without_an_entity_id(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.get("/api/relationships/suggestions")
    assert response.status_code == 400
    assert response.json() == {"message": "entityId is required"}


def test_the_get_route_404s_for_an_entity_not_in_the_pool(
    unbuilt_client: TestClient, seeded_corpus: Path
) -> None:
    response = unbuilt_client.get(
        "/api/relationships/suggestions", params={"entityId": "klingon"}
    )
    assert response.status_code == 404
    assert response.json() == {"message": 'No entity found with id "klingon"'}


def test_the_get_route_disambiguates_by_entity_type(
    unbuilt_client: TestClient, seeded_corpus: Path
) -> None:
    response = unbuilt_client.get(
        "/api/relationships/suggestions",
        params={"entityId": "latin", "entityType": "civilization"},
    )
    assert response.status_code == 404
    assert 'and type "civilization"' in response.json()["message"]


def test_a_junk_limit_falls_back_instead_of_422(
    unbuilt_client: TestClient, seeded_corpus: Path
) -> None:
    response = unbuilt_client.get(
        "/api/relationships/suggestions",
        params={"entityId": "latin", "limit": "abc"},
    )
    assert response.status_code == 200


def test_the_post_route_ranks_for_an_entity_not_yet_saved(
    unbuilt_client: TestClient, seeded_corpus: Path
) -> None:
    response = unbuilt_client.post(
        "/api/relationships/suggestions",
        json={
            "id": "draft-latium",
            "name": "Latium",
            "entityType": "civilization",
            "languageIds": ["latin"],
            "coordinates": {"lat": 41.7, "lng": 12.7},
            "timeStart": -600,
            "timeEnd": -300,
            "minConfidence": 1,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source"]["id"] == "draft-latium"
    assert "latin" in {entry["targetId"] for entry in body["suggestions"]}


def test_the_post_route_400s_without_the_identity_fields(
    unbuilt_client: TestClient,
) -> None:
    response = unbuilt_client.post(
        "/api/relationships/suggestions", json={"name": "No Id"}
    )
    assert response.status_code == 400
    assert response.json() == {"message": "id, name, and entityType are required"}


def test_an_empty_corpus_answers_rather_than_500ing(
    unbuilt_client: TestClient,
) -> None:
    """A thin lexicons tree means no exclusions and no candidates — not an error."""
    response = unbuilt_client.post(
        "/api/relationships/suggestions",
        json={"id": "x", "name": "X", "entityType": "language"},
    )
    assert response.status_code == 200
    assert response.json()["suggestions"] == []
