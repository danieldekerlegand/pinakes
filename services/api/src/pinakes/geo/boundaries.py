"""Named regions to precise GeoJSON — `server/services/boundary-resolver.ts`.

Ported for the three `/api/map/boundaries/*` routes (pinakes:80 US-1, the tenth
slice). A directory of GeoJSON files is indexed by name and by alias; a lookup
falls back through composites and then to a substring match; a hit can be
simplified on the way out.

**On this checkout the index is empty and every route answers as if the corpus
had no boundaries at all.** Neither source directory exists — `data/boundaries/`
is unpopulated and `sources/glottolog/` is an unchecked-out submodule — so
`resolve` is always a 404 and `search` always answers `{boundaries: [], total: 0}`.
That is the *Express* answer too; the port is written out in full because the
directories are configuration, not code.

Two things carry over unchanged and one does not:

* **`normalizeName` strips everything that is not a lowercase letter, a digit or
  a space**, which is what makes `G|ui` and `Gui` the same key — and why an
  alias list of punctuation collapses to the empty string, matching *every*
  query through the substring fallback. Kept.
* **`simplify` is the port of `simplify-js`'s Douglas-Peucker**, tolerance
  squared, `highQuality` throughout (so the radial-distance pre-pass turf skips
  is not written here either), plus turf's ring repair: back off the tolerance
  by 1% until the ring can still be a triangle, then re-close it.
* **The composite union is NOT turf's.** `turf.union` dissolves shared borders
  via a polygon-clipping library with no stdlib equivalent; taking a geometry
  dependency on for a code path this corpus cannot reach would be the trade
  `search/places.py` declined for HTTP. :func:`_combine` therefore *aggregates*
  the components into a MultiPolygon — which is **identical** to turf's answer
  for disjoint components and keeps the internal borders for adjacent ones. Every
  registered composite (Fertile Crescent, the Mediterranean basin, Mesopotamia,
  the Levant, Anatolia) is a set of adjacent countries, so this is a real
  difference the day `data/boundaries/` is populated: revisit it then, with a
  geometry library, rather than pretending it agrees.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any, Final

Record = dict[str, Any]
Position = list[float]

#: Everything `normalizeName` deletes, and the whitespace run it collapses.
_NOT_KEPT = re.compile("[^a-z0-9\\s]")
_SPACES = re.compile("\\s+")

#: The property keys `extractAliases` reads, in order.
ALIAS_KEYS: Final[tuple[str, ...]] = (
    "NAME_LONG",
    "NAME_EN",
    "name_en",
    "name_long",
    "ADMIN",
    "admin",
    "aliases",
)

#: `registerWellKnownComposites`, verbatim. Component ids are boundary ids, so
#: none of them resolves until a boundary file supplies one.
WELL_KNOWN_COMPOSITES: Final[tuple[Record, ...]] = (
    {
        "id": "fertile-crescent",
        "name": "Fertile Crescent",
        "componentRegionIds": [
            "iraq",
            "syria",
            "lebanon",
            "jordan",
            "israel",
            "palestine",
            "kuwait",
        ],
    },
    {
        "id": "mediterranean-basin",
        "name": "Mediterranean Basin",
        "componentRegionIds": [
            "italy",
            "greece",
            "spain",
            "france",
            "turkey",
            "egypt",
            "tunisia",
            "libya",
            "algeria",
            "morocco",
        ],
    },
    {
        "id": "mesopotamia",
        "name": "Mesopotamia",
        "componentRegionIds": ["iraq", "syria-east"],
    },
    {
        "id": "levant",
        "name": "Levant",
        "componentRegionIds": ["syria", "lebanon", "jordan", "israel", "palestine"],
    },
    {"id": "anatolia", "name": "Anatolia", "componentRegionIds": ["turkey"]},
)


def normalize_name(name: str) -> str:
    """Lowercase, trimmed, punctuation removed, whitespace runs collapsed."""
    return _SPACES.sub(" ", _NOT_KEPT.sub("", name.lower().strip()))


def extract_aliases(properties: Any) -> list[str]:
    """Every string in :data:`ALIAS_KEYS`, plus the strings of any array there."""
    if not isinstance(properties, dict):
        return []
    aliases: list[str] = []
    for key in ALIAS_KEYS:
        value = properties.get(key)
        if isinstance(value, str) and value:
            aliases.append(value)
        elif isinstance(value, list):
            aliases.extend(item for item in value if isinstance(item, str))
    return aliases


# ── simplify-js, as turf calls it ────────────────────────────────────────────


def _sq_seg_dist(point: Position, start: Position, end: Position) -> float:
    x, y = start[0], start[1]
    dx, dy = end[0] - x, end[1] - y
    if dx != 0 or dy != 0:
        t = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy)
        if t > 1:
            x, y = end[0], end[1]
        elif t > 0:
            x += dx * t
            y += dy * t
    dx, dy = point[0] - x, point[1] - y
    return dx * dx + dy * dy


def _dp_step(
    points: list[Position],
    first: int,
    last: int,
    sq_tolerance: float,
    simplified: list[Position],
) -> None:
    max_sq_dist = sq_tolerance
    index = -1
    for position in range(first + 1, last):
        distance = _sq_seg_dist(points[position], points[first], points[last])
        if distance > max_sq_dist:
            index = position
            max_sq_dist = distance
    if max_sq_dist > sq_tolerance and index >= 0:
        if index - first > 1:
            _dp_step(points, first, index, sq_tolerance, simplified)
        simplified.append(points[index])
        if last - index > 1:
            _dp_step(points, index, last, sq_tolerance, simplified)


def simplify_points(points: list[Position], tolerance: float) -> list[Position]:
    """`simplify(points, tolerance, /* highestQuality */ true)`."""
    if len(points) <= 2:
        return points
    sq_tolerance = tolerance * tolerance
    last = len(points) - 1
    simplified: list[Position] = [points[0]]
    _dp_step(points, 0, last, sq_tolerance, simplified)
    simplified.append(points[last])
    return simplified


def _ring_is_valid(ring: list[Position]) -> bool:
    """`checkValidity` — three points, and not a degenerate closed pair."""
    if len(ring) < 3:
        return False
    if len(ring) == 3 and ring[2] == ring[0]:
        return False
    return True


def simplify_ring(ring: list[Position], tolerance: float) -> list[Position]:
    """One ring, simplified and repaired the way `turf.simplify` repairs it."""
    if len(ring) < 4:
        raise ValueError("invalid polygon")
    working = tolerance
    simple = simplify_points(ring, working)
    guard = 0
    while not _ring_is_valid(simple) and guard < 1000:
        working -= working * 0.01
        simple = simplify_points(ring, working)
        guard += 1
    if simple[-1][0] != simple[0][0] or simple[-1][1] != simple[0][1]:
        simple = [*simple, simple[0]]
    return simple


def simplify_geometry(geometry: Record, tolerance: float) -> Record:
    """A Polygon or MultiPolygon, ring by ring."""
    kind = geometry.get("type")
    coordinates = geometry.get("coordinates") or []
    if kind == "Polygon":
        return {
            **geometry,
            "coordinates": [simplify_ring(ring, tolerance) for ring in coordinates],
        }
    if kind == "MultiPolygon":
        return {
            **geometry,
            "coordinates": [
                [simplify_ring(ring, tolerance) for ring in polygon]
                for polygon in coordinates
            ],
        }
    return geometry


def _polygons_of(geometry: Record) -> list[Any]:
    if geometry.get("type") == "Polygon":
        return [geometry.get("coordinates") or []]
    if geometry.get("type") == "MultiPolygon":
        return list(geometry.get("coordinates") or [])
    return []


def _combine(geometries: list[Record]) -> Record:
    """Aggregate components into one geometry — see the module docstring.

    Exactly `turf.union` for disjoint components; for adjacent ones it keeps the
    shared border that turf would have dissolved.
    """
    if len(geometries) == 1:
        return geometries[0]
    polygons: list[Any] = []
    for geometry in geometries:
        polygons.extend(_polygons_of(geometry))
    return {"type": "MultiPolygon", "coordinates": polygons}


# ── The resolver ─────────────────────────────────────────────────────────────


class BoundaryResolver:
    """The index: boundaries by id, a normalized-name index, and composites."""

    def __init__(
        self,
        *,
        data_dir: Path | None = None,
        default_simplify_tolerance: float = 0.0,
    ) -> None:
        self.data_dir = data_dir
        self.default_simplify_tolerance = default_simplify_tolerance
        self._boundaries: dict[str, Record] = {}
        self._name_index: dict[str, str] = {}
        self._composites: dict[str, Record] = {}
        self._composite_cache: dict[str, Record] = {}

    # -- loading -------------------------------------------------------------

    def load_from_directory(self, directory: Path | None = None) -> int:
        """Every `*.geojson` / `*.json` under *directory*. Absent ⇒ zero."""
        target = directory if directory is not None else self.data_dir
        if target is None or not target.is_dir():
            return 0
        loaded = 0
        for path in sorted(target.iterdir()):
            if path.suffix in {".geojson", ".json"}:
                loaded += self.load_geojson_file(path)
        return loaded

    def load_geojson_file(self, path: Path) -> int:
        """Register the polygonal features of one file.

        The id falls back `feature.id` → `properties.id` → `<source>-<n>`, where
        `n` counts only the features **registered so far from this file** — so a
        file whose first feature is a LineString numbers its second feature `-0`.
        Reproduced.
        """
        document = json.loads(path.read_text(encoding="utf-8"))
        source = path.name
        count = 0
        stem = re.sub(r"\.\w+$", "", source)

        def register(feature: Record, fallback_id: str) -> bool:
            geometry = feature.get("geometry") or {}
            if geometry.get("type") not in {"Polygon", "MultiPolygon"}:
                return False
            properties = feature.get("properties") or {}
            name = (
                properties.get("name")
                if properties.get("name") is not None
                else properties.get("NAME")
                if properties.get("NAME") is not None
                else stem
            )
            identifier = (
                str(feature["id"])
                if feature.get("id") is not None
                else properties.get("id")
                if properties.get("id") is not None
                else fallback_id
            )
            self.register_boundary(
                {
                    "id": identifier,
                    "name": name,
                    "geometry": geometry,
                    "source": source,
                    "aliases": extract_aliases(properties),
                }
            )
            return True

        if document.get("type") == "FeatureCollection":
            for feature in document.get("features") or []:
                if register(feature, f"{source}-{count}"):
                    count += 1
        elif document.get("type") == "Feature":
            if register(document, stem):
                count += 1
        return count

    def register_boundary(self, boundary: Record) -> None:
        self._boundaries[str(boundary["id"])] = boundary
        self._name_index[normalize_name(str(boundary["name"]))] = str(boundary["id"])
        for alias in boundary.get("aliases") or []:
            self._name_index[normalize_name(str(alias))] = str(boundary["id"])

    def register_composite_region(self, definition: Record) -> None:
        self._composites[str(definition["id"])] = definition
        self._name_index[normalize_name(str(definition["name"]))] = str(
            definition["id"]
        )

    # -- lookup --------------------------------------------------------------

    def resolve(
        self, id_or_name: str, simplify_tolerance: float | None = None
    ) -> Record | None:
        """By id, then by composite id, then by name, then by substring."""
        direct = self._boundaries.get(id_or_name)
        if direct is not None:
            return self._maybe_simplify(direct, simplify_tolerance)

        composite = self._composites.get(id_or_name)
        if composite is not None:
            return self._resolve_composite(composite, simplify_tolerance)

        resolved_id = self._name_index.get(normalize_name(id_or_name))
        if resolved_id is not None:
            boundary = self._boundaries.get(resolved_id)
            if boundary is not None:
                return self._maybe_simplify(boundary, simplify_tolerance)
            found = self._composites.get(resolved_id)
            if found is not None:
                return self._resolve_composite(found, simplify_tolerance)

        return self._fuzzy_search(id_or_name, simplify_tolerance)

    def resolve_feature(self, feature: Any, region_name_key: str = "name") -> Any:
        """Swap in a precise geometry, or hand the feature back untouched.

        A resolved feature gains `_boundarySource` and `_boundaryResolved` on its
        properties; an unresolved one is returned **by identity**, so a caller
        cannot tell "no such boundary" from "no name to look up".
        """
        if not isinstance(feature, dict):
            return feature
        properties = feature.get("properties")
        region_name = (
            properties.get(region_name_key) if isinstance(properties, dict) else None
        )
        if not region_name or not isinstance(region_name, str):
            return feature
        resolved = self.resolve(region_name)
        if resolved is None:
            return feature
        return {
            **feature,
            "geometry": resolved["geometry"],
            "properties": {
                **(properties if isinstance(properties, dict) else {}),
                "_boundarySource": resolved["source"],
                "_boundaryResolved": True,
            },
        }

    def resolve_features(
        self, features: list[Any], region_name_key: str = "name"
    ) -> list[Any]:
        return [self.resolve_feature(feature, region_name_key) for feature in features]

    def list_boundary_ids(self) -> list[str]:
        return list(self._boundaries)

    def list_boundary_names(self) -> list[str]:
        return [str(boundary["name"]) for boundary in self._boundaries.values()]

    def search(self, query: str, limit: float = 10) -> list[Record]:
        """Substring match either way round, then aliases — **and it double-counts**.

        A boundary whose *name* matched can match again on an alias and be pushed
        twice, because the alias loop is not guarded by the name hit. The limit
        is also checked *after* the push, so a result list can be one longer than
        `limit` — and a `NaN` limit (`?limit=abc`) is never reached at all, so it
        means *unlimited* rather than zero. All three are the TypeScript's.
        """
        normalized = normalize_name(query)
        results: list[Record] = []
        for boundary in self._boundaries.values():
            if normalized in normalize_name(str(boundary["name"])) or normalize_name(
                str(boundary["name"])
            ) in normalized:
                results.append(boundary)
                if len(results) >= limit:
                    break
            aliases = boundary.get("aliases")
            if aliases:
                for alias in aliases:
                    if normalized in normalize_name(str(alias)):
                        results.append(boundary)
                        break
                if len(results) >= limit:
                    break
        return results

    @property
    def size(self) -> int:
        return len(self._boundaries)

    # -- private -------------------------------------------------------------

    def _resolve_composite(
        self, definition: Record, simplify_tolerance: float | None
    ) -> Record | None:
        cached = self._composite_cache.get(str(definition["id"]))
        if cached is not None:
            return self._maybe_simplify(cached, simplify_tolerance)

        components = [
            self._boundaries[component]["geometry"]
            for component in definition.get("componentRegionIds") or []
            if component in self._boundaries
        ]
        if not components:
            return None

        resolved = {
            "id": definition["id"],
            "name": definition["name"],
            "geometry": _combine(components),
            "source": "composite",
        }
        self._composite_cache[str(definition["id"])] = resolved
        return self._maybe_simplify(resolved, simplify_tolerance)

    def _maybe_simplify(
        self, boundary: Record, tolerance: float | None
    ) -> Record:
        applied = (
            tolerance
            if tolerance is not None and not math.isnan(tolerance)
            else self.default_simplify_tolerance
        )
        if applied <= 0:
            return boundary
        return {
            **boundary,
            "geometry": simplify_geometry(boundary["geometry"], applied),
            "simplificationTolerance": applied,
        }

    def _fuzzy_search(
        self, query: str, simplify_tolerance: float | None
    ) -> Record | None:
        normalized = normalize_name(query)
        for name, identifier in self._name_index.items():
            if normalized in name or name in normalized:
                boundary = self._boundaries.get(identifier)
                if boundary is not None:
                    return self._maybe_simplify(boundary, simplify_tolerance)
        return None


_default: BoundaryResolver | None = None


def get_default_boundary_resolver(
    *, data_dir: Path, glottolog_dir: Path
) -> BoundaryResolver:
    """Build the shared resolver once, as `getDefaultBoundaryResolver` does.

    Cached in module state because building it reads a directory of GeoJSON; the
    two directories are passed in rather than resolved here so that
    :mod:`pinakes.paths` stays the one place that knows where things are.
    """
    global _default
    if _default is not None:
        return _default
    resolver = BoundaryResolver(data_dir=data_dir)
    resolver.load_from_directory()
    resolver.load_from_directory(glottolog_dir)
    for composite in WELL_KNOWN_COMPOSITES:
        resolver.register_composite_region(dict(composite))
    _default = resolver
    return resolver


def reset_default_boundary_resolver() -> None:
    """Drop the cached resolver — the counterpart of `resetDefaultBoundaryResolver`."""
    global _default
    _default = None
