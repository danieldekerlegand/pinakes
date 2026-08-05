"""Viewport (bbox) culling + pagination for GeoJSON layers.

Ported off `server/services/geo-bbox.ts`.

A pure, read-only filter over features the corpus loaders already produced: parse
``bbox=west,south,east,north`` (plus ``limit``/``offset``) off a query string, keep
the features that intersect it, page the rest, and report what happened in a
`meta` block the caller merges into its response `metadata`.

**This module has no route of its own, and that is on purpose.** Its callers are
the `/api/map/*` GeoJSON endpoints, which belong to a different port unit; it
lands here with pinakes:63 US-2 because `place-resolver` and it are the two halves
of `server/services/*` the map layer sits on, and porting one without the other
would leave that unit reaching back across the split. When the map routes land,
they use this — they should not grow a second viewport filter.

Three behaviours are contract, not implementation, and all three are the kind a
rewrite would quietly "improve":

* **A feature whose bounds cannot be computed is KEPT.** A geometry-less or
  malformed record still surfaces client-side rather than vanishing from a
  viewport it might well be inside.
* **A malformed or absent bbox is a no-op**, not an error — a stale bookmark
  returns the whole layer instead of failing.
* **Swapped corners are normalized**, so a west/east or south/north the client
  sent backwards still describes the box it meant.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, TypeVar

from pinakes.analytics.tsv import js_number

Feature = TypeVar("Feature", bound="dict[str, Any]")


@dataclass(frozen=True)
class Bbox:
    """A viewport, in degrees. ``west <= east`` and ``south <= north``."""

    west: float
    south: float
    east: float
    north: float

    def as_dict(self) -> dict[str, float]:
        """The JSON shape the `meta` block carries."""
        return {
            "west": self.west,
            "south": self.south,
            "east": self.east,
            "north": self.north,
        }


def parse_bbox(raw: str | None) -> Bbox | None:
    """``"west,south,east,north"`` → a :class:`Bbox`, or ``None`` if malformed.

    ``None`` rather than an error: the caller treats a bad bbox as "no viewport
    filter". Each part is read with ``Number()`` semantics — the whole trimmed
    string must be numeric, so ``"12abc"`` invalidates the box rather than
    parsing as 12.
    """
    if not raw:
        return None
    parts = [js_number(part.strip()) for part in raw.split(",")]
    if len(parts) != 4 or any(not math.isfinite(part) for part in parts):
        return None
    west, south, east, north = parts
    if west > east:
        west, east = east, west
    if south > north:
        south, north = north, south
    return Bbox(west=west, south=south, east=east, north=north)


def parse_non_negative_int(raw: str | None) -> int | None:
    """A non-negative **integer** query param, else ``None``.

    A fractional value is rejected outright rather than truncated — `limit=1.5`
    is a client bug, and silently paging 1 item would hide it.
    """
    if raw is None or raw == "":
        return None
    value = js_number(raw)
    if not math.isfinite(value) or value < 0 or not float(value).is_integer():
        return None
    return int(value)


def _walk_coordinates(geometry: Any, visit: Any) -> None:
    """Invoke ``visit(lng, lat)`` for every coordinate pair in a geometry."""
    if not isinstance(geometry, dict):
        return
    if geometry.get("type") == "GeometryCollection":
        for nested in geometry.get("geometries") or []:
            _walk_coordinates(nested, visit)
        return

    def walk(node: Any) -> None:
        if not isinstance(node, list):
            return
        if (
            len(node) >= 2
            and isinstance(node[0], (int, float))
            and not isinstance(node[0], bool)
            and isinstance(node[1], (int, float))
            and not isinstance(node[1], bool)
        ):
            visit(float(node[0]), float(node[1]))
            return
        for child in node:
            walk(child)

    walk(geometry.get("coordinates"))


def geometry_bounds(geometry: Any) -> Bbox | None:
    """The bounding box of a geometry, or ``None`` when it has no coordinates."""
    seen = False
    west = south = math.inf
    east = north = -math.inf

    def visit(lng: float, lat: float) -> None:
        nonlocal seen, west, south, east, north
        seen = True
        west = min(west, lng)
        east = max(east, lng)
        south = min(south, lat)
        north = max(north, lat)

    _walk_coordinates(geometry, visit)
    if not seen:
        return None
    return Bbox(west=west, south=south, east=east, north=north)


def bbox_intersects(first: Bbox, second: Bbox) -> bool:
    """Inclusive bounding-box overlap test."""
    return (
        first.west <= second.east
        and first.east >= second.west
        and first.south <= second.north
        and first.north >= second.south
    )


def feature_intersects_bbox(feature: dict[str, Any], bbox: Bbox) -> bool:
    """Whether a feature's geometry meets the viewport. Unbounded features stay."""
    bounds = geometry_bounds(feature.get("geometry"))
    if bounds is None:
        return True
    return bbox_intersects(bounds, bbox)


def filter_by_bbox(
    features: list[Feature], bbox: Bbox | None = None
) -> list[Feature]:
    """Keep the features meeting the viewport; a missing bbox is a no-op."""
    if bbox is None:
        return list(features)
    return [feature for feature in features if feature_intersects_bbox(feature, bbox)]


@dataclass(frozen=True)
class ViewportOptions:
    """What a request asked for: a box, a page size, a page offset."""

    bbox: Bbox | None = None
    limit: int | None = None
    offset: int | None = None


def viewport_options_from_query(
    bbox: str | None = None, limit: str | None = None, offset: str | None = None
) -> ViewportOptions:
    """Build :class:`ViewportOptions` from raw query-string values."""
    return ViewportOptions(
        bbox=parse_bbox(bbox),
        limit=parse_non_negative_int(limit),
        offset=parse_non_negative_int(offset),
    )


def apply_viewport(
    features: list[Feature], options: ViewportOptions | None = None
) -> tuple[list[Feature], dict[str, Any]]:
    """Filter then page, returning ``(features, meta)``.

    With no bbox and no limit this returns every feature — backward-compatible
    with the whole-FeatureCollection responses — while still reporting counts, so
    a client can adopt the `meta` block before it adopts the paging.
    """
    options = options or ViewportOptions()
    filtered = filter_by_bbox(features, options.bbox)
    total = len(filtered)
    offset = options.offset or 0
    if options.limit is not None:
        page = filtered[offset : offset + options.limit]
    elif offset > 0:
        page = filtered[offset:]
    else:
        page = filtered
    meta = {
        "total": total,
        "returned": len(page),
        "offset": offset,
        "limit": options.limit,
        "hasMore": offset + len(page) < total,
        "bbox": options.bbox.as_dict() if options.bbox else None,
    }
    return page, meta


__all__ = [
    "Bbox",
    "ViewportOptions",
    "apply_viewport",
    "bbox_intersects",
    "feature_intersects_bbox",
    "filter_by_bbox",
    "geometry_bounds",
    "parse_bbox",
    "parse_non_negative_int",
    "viewport_options_from_query",
]
