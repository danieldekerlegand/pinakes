"""The four non-corpus `/api/map/*` routes (pinakes:80 US-1).

Half of this file is about the state a plain checkout is actually in — no
`data/boundaries/`, no Glottolog submodule, therefore an empty index — and half
about what the resolver does once a directory *is* there, which is the part a
future `data/boundaries/` will be graded by.

`analyze-image` is asserted up to the model call: the request that reaches it is
built here, and the missing-key 500 is what this checkout answers.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from pinakes import paths
from pinakes.geo import boundaries
from pinakes.media import map_image


def square(west: float, south: float, east: float, north: float) -> dict[str, Any]:
    return {
        "type": "Polygon",
        "coordinates": [
            [[west, south], [west, north], [east, north], [east, south], [west, south]]
        ],
    }


@pytest.fixture
def boundary_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A seeded `data/boundaries` equivalent, plus an absent Glottolog dir."""
    directory = tmp_path / "boundaries"
    directory.mkdir()
    (directory / "regions.geojson").write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "id": "anatolia-plateau",
                        "properties": {"name": "Anatolian Plateau", "ADMIN": "Türkiye"},
                        "geometry": square(26, 36, 45, 42),
                    },
                    {
                        "type": "Feature",
                        "properties": {"id": "levant-coast", "NAME": "Levant Coast"},
                        "geometry": square(34, 31, 37, 37),
                    },
                    {
                        "type": "Feature",
                        "properties": {"name": "A Road"},
                        "geometry": {"type": "LineString", "coordinates": [[0, 0]]},
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv(paths.BOUNDARIES_DIR_ENV, str(directory))
    monkeypatch.setenv(
        paths.GLOTTOLOG_VORONOI_DIR_ENV, str(tmp_path / "no-such-glottolog")
    )
    return directory


@pytest.fixture
def empty_sources(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(paths.BOUNDARIES_DIR_ENV, str(tmp_path / "no-boundaries"))
    monkeypatch.setenv(paths.GLOTTOLOG_VORONOI_DIR_ENV, str(tmp_path / "no-glottolog"))


# ── The state a plain checkout is in ─────────────────────────────────────────


def test_a_checkout_with_no_boundary_directory_resolves_nothing(
    unbuilt_client: TestClient, empty_sources: None
) -> None:
    response = unbuilt_client.get("/api/map/boundaries/resolve?name=Levant")
    assert response.status_code == 404
    assert response.json() == {"message": 'No boundary found for "Levant"'}


def test_the_empty_index_lists_no_boundaries(
    unbuilt_client: TestClient, empty_sources: None
) -> None:
    assert unbuilt_client.get("/api/map/boundaries/search").json() == {
        "boundaries": [],
        "total": 0,
    }


def test_an_unresolvable_feature_is_handed_back_unchanged(
    unbuilt_client: TestClient, empty_sources: None
) -> None:
    feature = {
        "type": "Feature",
        "properties": {"name": "Levant"},
        "geometry": square(0, 0, 1, 1),
    }
    body = unbuilt_client.post(
        "/api/map/boundaries/resolve-features", json={"features": [feature]}
    ).json()
    assert body == {"type": "FeatureCollection", "features": [feature]}


# ── With a directory present ─────────────────────────────────────────────────


def test_a_boundary_resolves_by_name_id_and_alias(
    unbuilt_client: TestClient, boundary_dir: Path
) -> None:
    by_name = unbuilt_client.get(
        "/api/map/boundaries/resolve?name=anatolian%20plateau"
    ).json()
    assert by_name["id"] == "anatolia-plateau"
    assert by_name["source"] == "regions.geojson"
    assert by_name["geometry"]["type"] == "Polygon"

    assert (
        unbuilt_client.get(
            "/api/map/boundaries/resolve?name=anatolia-plateau"
        ).json()["id"]
        == "anatolia-plateau"
    )
    assert (
        unbuilt_client.get("/api/map/boundaries/resolve?name=T%C3%BCrkiye").json()["id"]
        == "anatolia-plateau"
    )


def test_a_feature_id_falls_back_to_a_property_id(
    unbuilt_client: TestClient, boundary_dir: Path
) -> None:
    body = unbuilt_client.get("/api/map/boundaries/resolve?name=Levant Coast").json()
    assert body["id"] == "levant-coast"


def test_a_non_polygonal_feature_is_not_indexed(
    unbuilt_client: TestClient, boundary_dir: Path
) -> None:
    body = unbuilt_client.get("/api/map/boundaries/search").json()
    assert body["boundaries"] == ["Anatolian Plateau", "Levant Coast"]
    assert body["total"] == 2


def test_search_matches_a_substring_either_way_round(
    unbuilt_client: TestClient, boundary_dir: Path
) -> None:
    body = unbuilt_client.get("/api/map/boundaries/search?q=plateau").json()
    assert body == {
        "results": [
            {
                "id": "anatolia-plateau",
                "name": "Anatolian Plateau",
                "source": "regions.geojson",
            }
        ]
    }


def test_a_junk_limit_means_unlimited_rather_than_empty(
    unbuilt_client: TestClient, boundary_dir: Path
) -> None:
    """`results.length >= NaN` is never true, so the loop never breaks early."""
    body = unbuilt_client.get("/api/map/boundaries/search?q=coast&limit=abc").json()
    assert len(body["results"]) == 1


def test_a_resolved_feature_records_where_its_geometry_came_from(
    unbuilt_client: TestClient, boundary_dir: Path
) -> None:
    body = unbuilt_client.post(
        "/api/map/boundaries/resolve-features",
        json={
            "features": [
                {
                    "type": "Feature",
                    "properties": {"region": "Levant Coast", "era": "Iron Age"},
                    "geometry": square(0, 0, 1, 1),
                }
            ],
            "regionNameKey": "region",
        },
    ).json()
    properties = body["features"][0]["properties"]
    assert properties["_boundaryResolved"] is True
    assert properties["_boundarySource"] == "regions.geojson"
    assert properties["era"] == "Iron Age"
    assert body["features"][0]["geometry"] == square(34, 31, 37, 37)


def test_the_region_name_key_defaults_to_name(
    unbuilt_client: TestClient, boundary_dir: Path
) -> None:
    body = unbuilt_client.post(
        "/api/map/boundaries/resolve-features",
        json={
            "features": [
                {
                    "type": "Feature",
                    "properties": {"name": "Levant Coast"},
                    "geometry": square(0, 0, 1, 1),
                }
            ]
        },
    ).json()
    assert body["features"][0]["properties"]["_boundaryResolved"] is True


# ── Refusals ─────────────────────────────────────────────────────────────────


def test_resolve_requires_a_name(
    unbuilt_client: TestClient, empty_sources: None
) -> None:
    response = unbuilt_client.get("/api/map/boundaries/resolve")
    assert response.status_code == 400
    assert response.json() == {"message": "name query parameter is required"}


def test_resolve_features_requires_an_array(
    unbuilt_client: TestClient, empty_sources: None
) -> None:
    response = unbuilt_client.post(
        "/api/map/boundaries/resolve-features", json={"features": "all of them"}
    )
    assert response.status_code == 400
    assert response.json() == {
        "message": "features array is required in request body"
    }


# ── The resolver's own rules ─────────────────────────────────────────────────


def test_punctuation_does_not_distinguish_two_names() -> None:
    assert boundaries.normalize_name("  G|ui  ") == boundaries.normalize_name("Gui")
    assert boundaries.normalize_name("Fertile   Crescent") == "fertile crescent"


def test_a_composite_of_one_component_is_that_component() -> None:
    resolver = boundaries.BoundaryResolver()
    resolver.register_boundary(
        {
            "id": "turkey",
            "name": "Turkey",
            "geometry": square(26, 36, 45, 42),
            "source": "x",
        }
    )
    resolver.register_composite_region(dict(boundaries.WELL_KNOWN_COMPOSITES[4]))
    resolved = resolver.resolve("anatolia")
    assert resolved is not None
    assert resolved["source"] == "composite"
    assert resolved["geometry"] == square(26, 36, 45, 42)


def test_a_composite_with_no_registered_component_is_unresolvable() -> None:
    resolver = boundaries.BoundaryResolver()
    resolver.register_composite_region(dict(boundaries.WELL_KNOWN_COMPOSITES[3]))
    assert resolver.resolve("levant") is None


def test_a_multi_component_composite_aggregates_rather_than_dissolving() -> None:
    """The one deliberate divergence from `turf.union` — `geo/boundaries.py`."""
    resolver = boundaries.BoundaryResolver()
    for identifier, west in (("syria", 36.0), ("lebanon", 35.0)):
        resolver.register_boundary(
            {
                "id": identifier,
                "name": identifier.title(),
                "geometry": square(west, 33, west + 1, 35),
                "source": "x",
            }
        )
    resolver.register_composite_region(dict(boundaries.WELL_KNOWN_COMPOSITES[3]))
    resolved = resolver.resolve("levant")
    assert resolved is not None
    assert resolved["geometry"]["type"] == "MultiPolygon"
    assert len(resolved["geometry"]["coordinates"]) == 2


def test_simplify_drops_a_collinear_vertex_and_keeps_the_ring_closed() -> None:
    ring = [[0.0, 0.0], [1.0, 0.001], [2.0, 0.0], [2.0, 2.0], [0.0, 0.0]]
    simplified = boundaries.simplify_ring(ring, 0.01)
    assert simplified[0] == simplified[-1]
    assert [1.0, 0.001] not in simplified
    assert len(simplified) == 4


def test_a_tolerance_of_zero_leaves_the_geometry_alone(boundary_dir: Path) -> None:
    resolver = boundaries.get_default_boundary_resolver(
        data_dir=boundary_dir, glottolog_dir=boundary_dir / "nope"
    )
    plain = resolver.resolve("Levant Coast")
    zeroed = resolver.resolve("Levant Coast", 0)
    assert plain is not None and zeroed is not None
    assert "simplificationTolerance" not in zeroed
    assert zeroed["geometry"] == plain["geometry"]


# ── analyze-image ────────────────────────────────────────────────────────────


BOUNDS = [[30.0, 20.0], [40.0, 35.0]]


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"imageBase64": "x", "mimeType": "image/png"},
        {"imageBase64": "x", "bounds": BOUNDS},
        {"mimeType": "image/png", "bounds": BOUNDS},
    ],
)
def test_analyze_image_names_the_three_required_fields(
    unbuilt_client: TestClient, payload: dict[str, Any]
) -> None:
    response = unbuilt_client.post("/api/map/analyze-image", json=payload)
    assert response.status_code == 400
    assert response.json() == {
        "message": "Missing required fields: imageBase64, mimeType, bounds"
    }


def test_bounds_must_be_a_pair_of_corners(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.post(
        "/api/map/analyze-image",
        json={"imageBase64": "x", "mimeType": "image/png", "bounds": [[1, 2]]},
    )
    assert response.status_code == 400
    assert response.json() == {
        "message": "bounds must be [[south, west], [north, east]]"
    }


def test_a_checkout_with_no_key_is_a_500_naming_the_variable(
    unbuilt_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv(map_image.API_KEY_ENV, raising=False)
    response = unbuilt_client.post(
        "/api/map/analyze-image",
        json={"imageBase64": "x", "mimeType": "image/png", "bounds": BOUNDS},
    )
    assert response.status_code == 500
    assert response.json() == {
        "message": (
            "GEMINI_API_KEY environment variable is required for map image analysis"
        )
    }


def test_the_prompt_prints_both_corners_to_four_places() -> None:
    prompt = map_image.build_extraction_prompt(BOUNDS, ["settlements", "labels"])
    assert "- South-West corner: 30.0000°N, 20.0000°E" in prompt
    assert "- North-East corner: 40.0000°N, 35.0000°E" in prompt
    assert "Extract the following feature types: settlements, labels" in prompt


def test_the_cleaner_clamps_narrows_and_leaves_the_rest_alone() -> None:
    cleaned = map_image.validate_and_clean_result(
        {
            "settlements": [
                {"name": "Far", "lat": 99, "lng": 0, "type": "citadel", "confidence": 4}
            ],
            "routes": [
                {
                    "name": "Road",
                    "waypoints": [[35.0, 25.0]],
                    "type": "trade",
                    "confidence": -1,
                }
            ],
            "mapDescription": "A map",
            "unexpected": "kept",
        },
        BOUNDS,
    )
    settlement = cleaned["settlements"][0]
    assert settlement["type"] == "unknown"
    assert settlement["confidence"] == 1
    assert settlement["lat"] == pytest.approx(41.5)
    assert settlement["lng"] == pytest.approx(18.5)
    assert cleaned["routes"][0]["confidence"] == 0
    assert cleaned["routes"][0]["waypoints"] == [[35.0, 25.0]]
    assert cleaned["labels"] == []
    assert cleaned["unexpected"] == "kept"
    assert cleaned["mapDescription"] == "A map"


def test_a_confidence_that_is_not_a_number_serialises_as_null() -> None:
    cleaned = map_image.validate_and_clean_result(
        {
            "labels": [
                {
                    "text": "Here",
                    "lat": 35,
                    "lng": 25,
                    "category": "place",
                    "confidence": "high",
                }
            ]
        },
        BOUNDS,
    )
    assert cleaned["labels"][0]["confidence"] is None
