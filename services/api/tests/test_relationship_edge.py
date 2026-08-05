"""`/api/relationships/edge*` — authoring a typed edge, and refusing a duplicate.

The dedup half is what these cases are really about, and it has two sources that
must both be consulted: the corpus's canonical edges and the contribution queue.
A duplicate found in either is a **409**, distinct from the 400 a malformed
submission gets — the client acts on them differently.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from pinakes.authoring import relationship_edge

VALID: dict[str, Any] = {
    "sourceId": "sumerian",
    "targetId": "akkadian",
    "relationshipType": "influenced-by",
    "timeStart": -2500,
    "timeEnd": -2000,
}

#: A `cultural-lineages.tsv` carrying one edge the corpus already records.
LINEAGES = "\n".join(
    [
        "\t".join(
            [
                "id",
                "source_id",
                "target_id",
                "relationship_type",
                "time_start",
                "time_end",
                "confidence",
                "sources",
            ]
        ),
        "\t".join(
            ["cl-1", "hittite", "luwian", "split-from", "-1600", "-1200", "80", "[]"]
        ),
    ]
)


@pytest.fixture
def seeded_corpus(isolated_data_trees: dict[str, Path]) -> Path:
    """A temp lexicons directory with one recorded lineage edge."""
    lexicons = isolated_data_trees["lexicons"]
    (lexicons / "cultural-lineages.tsv").write_text(LINEAGES + "\n", encoding="utf-8")
    return lexicons


def test_a_new_edge_is_queued_with_a_confirmation_summary(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    response = unbuilt_client.post("/api/relationships/edge", json=VALID)

    assert response.status_code == 201
    body = response.json()
    contribution = body["contribution"]
    assert contribution["entityType"] == "relationship"
    assert contribution["entityData"]["source"] == (
        relationship_edge.RELATIONSHIP_PROVENANCE
    )
    # The confirmation the client renders — including the Neo4j token, which is
    # what makes the authored edge readable as a shared-graph relationship.
    assert body["relationship"] == {
        "sourceId": "sumerian",
        "sourceName": "sumerian",
        "targetId": "akkadian",
        "targetName": "akkadian",
        "relationshipType": "influenced-by",
        "relationshipToken": "INFLUENCED_BY",
        "timeStart": -2500,
        "timeEnd": -2000,
        "confidence": 60,
    }
    assert len(list(isolated_data_trees["contributions"].iterdir())) == 1


def test_a_blank_time_bound_serialises_as_an_empty_cell(
    unbuilt_client: TestClient,
) -> None:
    """Not a null: the TSV's blank cells are empty strings, and the loader would
    read the literal text `null` as a value."""
    payload = {
        key: value
        for key, value in VALID.items()
        if key not in {"timeStart", "timeEnd"}
    }
    response = unbuilt_client.post("/api/relationships/edge", json=payload)
    serialized = response.json()["contribution"]["entityData"]["serialized"]
    assert serialized["time_start"] == ""
    assert serialized["time_end"] == ""


def test_a_duplicate_of_a_corpus_edge_is_409(
    unbuilt_client: TestClient, seeded_corpus: Path
) -> None:
    response = unbuilt_client.post(
        "/api/relationships/edge",
        json={
            "sourceId": "hittite",
            "targetId": "luwian",
            "relationshipType": "split-from",
        },
    )
    assert response.status_code == 409
    body = response.json()
    assert body["duplicate"] is True
    assert body["message"] == "Duplicate relationship"
    assert body["errors"] == [
        'a "split-from" relationship from hittite to luwian already exists'
    ]


def test_the_reverse_of_a_corpus_edge_is_not_a_duplicate(
    unbuilt_client: TestClient, seeded_corpus: Path
) -> None:
    """Direction matters: `A -split-from-> B` and its reverse are distinct edges."""
    response = unbuilt_client.post(
        "/api/relationships/edge",
        json={
            "sourceId": "luwian",
            "targetId": "hittite",
            "relationshipType": "split-from",
        },
    )
    assert response.status_code == 201


def test_a_duplicate_of_a_queued_edge_is_409(unbuilt_client: TestClient) -> None:
    """A *pending* duplicate is still a collision — two contributors authoring
    the same edge an hour apart is the case this exists for."""
    assert unbuilt_client.post("/api/relationships/edge", json=VALID).status_code == 201
    second = unbuilt_client.post("/api/relationships/edge", json=VALID)
    assert second.status_code == 409
    assert second.json()["duplicate"] is True


def test_a_self_edge_is_400(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.post(
        "/api/relationships/edge",
        json={**VALID, "targetId": "sumerian"},
    )
    assert response.status_code == 400
    assert response.json()["duplicate"] is False
    assert (
        "a relationship cannot connect an entity to itself (self edge)"
        in response.json()["errors"]
    )


def test_a_non_canonical_relationship_type_is_400(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.post(
        "/api/relationships/edge", json={**VALID, "relationshipType": "vibes-with"}
    )
    assert response.status_code == 400
    assert any(
        error.startswith("relationshipType must be one of:")
        for error in response.json()["errors"]
    )


def test_an_inverted_time_range_is_400(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.post(
        "/api/relationships/edge", json={**VALID, "timeEnd": -3000}
    )
    assert response.status_code == 400
    assert (
        "timeEnd must not be earlier than timeStart (inverted range)"
        in response.json()["errors"]
    )


def test_the_options_route_publishes_the_vocabulary_and_the_existing_edges(
    unbuilt_client: TestClient, seeded_corpus: Path
) -> None:
    """The UI reads both so it can pre-empt a 409 before the contributor submits."""
    body = unbuilt_client.get("/api/relationships/edge/options").json()

    names = [option["name"] for option in body["relationshipTypes"]]
    assert "influenced-by" in names
    assert "descended-from" in names
    assert body["relationshipTypes"][0] == {
        "name": "descended-from",
        "token": "DESCENDS_FROM",
        "description": (
            "Genealogical descent (language→ancestor, culture→predecessor). Uses "
            "pinakes-engine's existing DESCENDS_FROM token."
        ),
    }
    assert {
        "sourceId": "hittite",
        "targetId": "luwian",
        "relationshipType": "split-from",
    } in body["existingEdges"]


def test_the_vocabulary_is_the_canonical_schema_not_a_local_list() -> None:
    """A canonical edge type added upstream shows up here with no edit."""
    from pinakes_contracts.canonical_schema import EDGE_TYPES

    assert [
        option["name"] for option in relationship_edge.RELATIONSHIP_TYPE_OPTIONS
    ] == [entry.name for entry in EDGE_TYPES]
