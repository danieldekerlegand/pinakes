"""`server/services/geo-bbox.test.ts` — viewport culling and pagination.

The module has no route yet (the `/api/map/*` layers are a different port unit),
so this suite *is* its gate. Three behaviours a rewrite would quietly "improve"
are asserted here explicitly, because nothing else will catch them until those
routes land.
"""

from __future__ import annotations

from typing import Any

import pytest

from pinakes.geo import bbox as geo

BOX = geo.Bbox(west=0.0, south=0.0, east=10.0, north=10.0)


def point(lng: float, lat: float) -> dict[str, Any]:
    return {"geometry": {"type": "Point", "coordinates": [lng, lat]}}


# ── Parsing ──────────────────────────────────────────────────────────────────


def test_a_bbox_parses_west_south_east_north() -> None:
    assert geo.parse_bbox("1,2,3,4") == geo.Bbox(west=1, south=2, east=3, north=4)


def test_swapped_corners_are_normalized() -> None:
    assert geo.parse_bbox("3,4,1,2") == geo.Bbox(west=1, south=2, east=3, north=4)


@pytest.mark.parametrize(
    "raw", [None, "", "1,2,3", "1,2,3,4,5", "1,2,3,abc", "not a bbox"]
)
def test_a_malformed_bbox_is_a_no_op_not_an_error(raw: str | None) -> None:
    """A stale bookmark returns the whole layer rather than failing."""
    assert geo.parse_bbox(raw) is None
    assert geo.filter_by_bbox([point(50, 50)], geo.parse_bbox(raw)) == [point(50, 50)]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("0", 0),
        ("5", 5),
        (None, None),
        ("", None),
        ("-1", None),
        ("1.5", None),
        ("x", None),
    ],
)
def test_non_negative_integer_parsing(raw: str | None, expected: int | None) -> None:
    assert geo.parse_non_negative_int(raw) == expected


# ── Bounds ───────────────────────────────────────────────────────────────────


def test_bounds_walk_every_geometry_type_including_a_collection() -> None:
    collection = {
        "type": "GeometryCollection",
        "geometries": [
            {"type": "Point", "coordinates": [1, 2]},
            {"type": "LineString", "coordinates": [[5, 6], [-1, 9]]},
        ],
    }
    assert geo.geometry_bounds(collection) == geo.Bbox(
        west=-1, south=2, east=5, north=9
    )


def test_a_polygon_ring_is_walked_to_its_corners() -> None:
    polygon = {"type": "Polygon", "coordinates": [[[0, 0], [0, 5], [5, 5], [0, 0]]]}
    assert geo.geometry_bounds(polygon) == geo.Bbox(west=0, south=0, east=5, north=5)


@pytest.mark.parametrize(
    "geometry", [None, {}, {"type": "Point"}, {"type": "Point", "coordinates": []}]
)
def test_a_geometry_with_no_coordinates_has_no_bounds(geometry: Any) -> None:
    assert geo.geometry_bounds(geometry) is None


def test_overlap_is_inclusive_at_the_edge() -> None:
    assert geo.bbox_intersects(BOX, geo.Bbox(west=10, south=10, east=20, north=20))
    assert not geo.bbox_intersects(BOX, geo.Bbox(west=11, south=11, east=20, north=20))


def test_a_feature_with_no_computable_bounds_is_kept_never_dropped() -> None:
    """Conservative on purpose: a malformed record still surfaces client-side."""
    assert geo.feature_intersects_bbox({}, BOX) is True
    assert geo.feature_intersects_bbox({"geometry": None}, BOX) is True


def test_filtering_keeps_only_what_meets_the_viewport() -> None:
    features = [point(5, 5), point(50, 50), point(0, 0)]
    assert geo.filter_by_bbox(features, BOX) == [point(5, 5), point(0, 0)]


# ── Paging ───────────────────────────────────────────────────────────────────


def test_no_bbox_and_no_limit_returns_everything_and_still_reports_counts() -> None:
    features = [point(1, 1), point(2, 2)]
    page, meta = geo.apply_viewport(features)
    assert page == features
    assert meta == {
        "total": 2,
        "returned": 2,
        "offset": 0,
        "limit": None,
        "hasMore": False,
        "bbox": None,
    }


def test_paging_reports_has_more_and_echoes_the_applied_box() -> None:
    features = [point(index, index) for index in range(5)]
    page, meta = geo.apply_viewport(
        features, geo.ViewportOptions(bbox=BOX, limit=2, offset=1)
    )
    assert page == [point(1, 1), point(2, 2)]
    assert meta["total"] == 5
    assert meta["returned"] == 2
    assert meta["hasMore"] is True
    assert meta["bbox"] == {"west": 0.0, "south": 0.0, "east": 10.0, "north": 10.0}


def test_an_offset_past_the_end_is_an_empty_page_not_an_error() -> None:
    page, meta = geo.apply_viewport([point(1, 1)], geo.ViewportOptions(offset=9))
    assert page == []
    assert meta["hasMore"] is False


def test_options_come_straight_off_the_query_string() -> None:
    options = geo.viewport_options_from_query(bbox="1,2,3,4", limit="10", offset="abc")
    assert options.bbox == geo.Bbox(west=1, south=2, east=3, north=4)
    assert options.limit == 10
    assert options.offset is None
