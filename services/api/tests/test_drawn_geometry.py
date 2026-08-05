"""`/api/map/drawn-geometry*` — the authoring surface on the map.

The cases moved here from `server/routes/drawn-geometry.test.ts`, which now only
asserts the 501 hand-over. Two of them are the ones a rewrite quietly loses: an
unclosed ring is rejected, and a target and a geometry that disagree are rejected
*even though each is individually valid*.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from pinakes.authoring import drawn_geometry

SQUARE: dict[str, Any] = {
    "type": "Polygon",
    "coordinates": [[[0, 40], [2, 40], [2, 42], [0, 42], [0, 40]]],
}
LINE: dict[str, Any] = {
    "type": "LineString",
    "coordinates": [[108.94, 34.26], [105, 36], [95, 38]],
}

VALID: dict[str, Any] = {
    "geometry": SQUARE,
    "target": "boundary",
    "name": "Akkadian core",
    "associatedEntityId": "akkad",
    "timePeriodStart": -2334,
    "timePeriodEnd": -2154,
}


def test_a_drawn_polygon_is_queued_with_user_drawn_provenance(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    response = unbuilt_client.post("/api/map/drawn-geometry", json=VALID)

    assert response.status_code == 201
    contribution = response.json()["contribution"]
    assert contribution["entityType"] == "boundary"
    assert contribution["entityId"] == "akkad"
    assert contribution["confidence"] == 60
    data = contribution["entityData"]
    assert data["source"] == drawn_geometry.DRAWN_PROVENANCE
    assert data["drawingMode"] == "polygon"
    assert data["geometry"] == SQUARE
    # The serialized cell is what a reviewer pastes into a `geometry` column:
    # compact separators, `[lng, lat]` order preserved.
    assert data["geometrySerialized"] == (
        '{"type":"Polygon","coordinates":[[[0,40],[2,40],[2,42],[0,42],[0,40]]]}'
    )
    assert len(list(isolated_data_trees["contributions"].iterdir())) == 1


def test_a_drawn_line_is_queued_for_a_route_target(
    unbuilt_client: TestClient,
) -> None:
    response = unbuilt_client.post(
        "/api/map/drawn-geometry",
        json={**VALID, "geometry": LINE, "target": "trade-route", "name": "Silk Road"},
    )
    assert response.status_code == 201
    data = response.json()["contribution"]["entityData"]
    assert data["drawingMode"] == "polyline"
    assert response.json()["contribution"]["entityType"] == "trade-route"


def test_a_language_range_mirrors_its_entity_into_language_id(
    unbuilt_client: TestClient,
) -> None:
    """Without the mirror the queue would reject a valid drawing one layer down:
    `language-range` requires a `languageId` in `REQUIRED_FIELDS`."""
    response = unbuilt_client.post(
        "/api/map/drawn-geometry",
        json={**VALID, "target": "language-range", "associatedEntityId": "akk"},
    )
    assert response.status_code == 201
    assert response.json()["contribution"]["entityData"]["languageId"] == "akk"


def test_an_unclosed_polygon_is_rejected(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.post(
        "/api/map/drawn-geometry",
        json={
            **VALID,
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[0, 40], [2, 40], [2, 42], [0, 42]]],
            },
        },
    )
    assert response.status_code == 400
    assert "Polygon ring 0 is not closed (first and last positions must match)" in (
        response.json()["errors"]
    )


def test_a_target_and_geometry_that_disagree_are_rejected(
    unbuilt_client: TestClient,
) -> None:
    """Each half is valid on its own — the *pair* is what is wrong."""
    response = unbuilt_client.post(
        "/api/map/drawn-geometry", json={**VALID, "geometry": LINE}
    )
    assert response.status_code == 400
    assert (
        "target 'boundary' expects a Polygon geometry but received a LineString"
        in response.json()["errors"]
    )


def test_an_out_of_world_coordinate_is_rejected(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.post(
        "/api/map/drawn-geometry",
        json={
            **VALID,
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[0, 40], [200, 40], [2, 42], [0, 40]]],
            },
        },
    )
    assert response.status_code == 400
    assert (
        "Polygon ring 0 position 1 is not a valid [lng, lat] within world bounds"
        in response.json()["errors"]
    )


def test_a_submission_with_no_associated_entity_is_rejected(
    unbuilt_client: TestClient,
) -> None:
    payload = {
        key: value for key, value in VALID.items() if key != "associatedEntityId"
    }
    response = unbuilt_client.post("/api/map/drawn-geometry", json=payload)
    assert response.status_code == 400
    assert (
        "associatedEntityId is required — a drawn geometry must be associated "
        "with an entity" in response.json()["errors"]
    )


def test_an_inverted_time_range_is_rejected(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.post(
        "/api/map/drawn-geometry", json={**VALID, "timePeriodEnd": -3000}
    )
    assert response.status_code == 400
    assert any("inverted range" in error for error in response.json()["errors"])


def test_an_empty_submission_reports_every_error(unbuilt_client: TestClient) -> None:
    body = unbuilt_client.post("/api/map/drawn-geometry", json={}).json()
    assert body["message"] == "Invalid drawn geometry"
    assert body["errors"] == [
        "target must be one of: boundary, language-range, trade-route, "
        "migration-route",
        "name is required",
        "associatedEntityId is required — a drawn geometry must be associated "
        "with an entity",
        "timePeriodStart is required and must be a number (negative = BCE)",
        "geometry is required and must be an object",
    ]
    assert body["warnings"] == ["confidence not specified, defaulting to 60"]


def test_the_targets_route_publishes_the_drawing_vocabulary(
    unbuilt_client: TestClient,
) -> None:
    assert unbuilt_client.get("/api/map/drawn-geometry/targets").json() == {
        "targets": ["boundary", "language-range", "trade-route", "migration-route"]
    }
