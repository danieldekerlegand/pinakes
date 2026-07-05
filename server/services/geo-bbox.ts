/**
 * Server-side viewport (bbox) filtering + pagination for GeoJSON map layers.
 *
 * The map data endpoints (`/api/map/*`) can accept `bbox`/`zoom` query params so
 * the server returns only the features intersecting the current viewport, plus
 * optional `limit`/`offset` pagination — so large layers no longer require a
 * whole-FeatureCollection round-trip. TSV remains the source of truth; this is a
 * pure, read-only filter over the features the storage layer already produced.
 *
 * Kept dependency-free (structural GeoJSON types) and pure so it is trivially
 * unit-testable and cannot depend on Express/storage internals.
 */

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

// Minimal structural GeoJSON geometry — matches what the storage feature types
// expose without pulling in the full `geojson` type surface.
type Position = number[];
interface GeometryLike {
  type: string;
  coordinates?: unknown;
  geometries?: GeometryLike[];
}
interface FeatureLike {
  geometry?: GeometryLike | null;
}

/**
 * Parse a `west,south,east,north` bbox string (as produced by the client
 * viewport helper). Returns `undefined` for anything malformed so callers can
 * treat a bad/absent bbox as "no viewport filter" (return the full layer).
 * Swapped corners are normalized so `west<=east`, `south<=north`.
 */
export function parseBbox(raw?: string | null): Bbox | undefined {
  if (!raw) return undefined;
  const parts = raw.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return undefined;
  let [west, south, east, north] = parts;
  if (west > east) [west, east] = [east, west];
  if (south > north) [south, north] = [north, south];
  return { west, south, east, north };
}

/** Parse a non-negative integer query param, or `undefined` if absent/invalid. */
export function parseNonNegativeInt(raw?: string | null): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return undefined;
  return n;
}

/**
 * Walk every coordinate pair in a geometry (any GeoJSON geometry type,
 * including GeometryCollection) and invoke `visit(lng, lat)`.
 */
function walkCoordinates(geom: GeometryLike | null | undefined, visit: (lng: number, lat: number) => void): void {
  if (!geom) return;
  if (geom.type === "GeometryCollection") {
    for (const g of geom.geometries ?? []) walkCoordinates(g, visit);
    return;
  }
  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    // A coordinate pair is [number, number, ...]
    if (typeof node[0] === "number" && typeof node[1] === "number") {
      visit(node[0], node[1]);
      return;
    }
    for (const child of node) walk(child);
  };
  walk(geom.coordinates);
}

/**
 * Compute the bounding box of a geometry, or `null` when it has no usable
 * coordinates.
 */
export function geometryBounds(geom: GeometryLike | null | undefined): Bbox | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let seen = false;
  walkCoordinates(geom, (lng, lat) => {
    seen = true;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  });
  if (!seen) return null;
  return { west, south, east, north };
}

/** Inclusive bounding-box overlap test. */
export function bboxIntersects(a: Bbox, b: Bbox): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

/**
 * Whether a feature's geometry intersects the viewport bbox. Features whose
 * bounds cannot be computed are conservatively **kept** (never silently dropped)
 * so a geometry-less or malformed record still surfaces client-side.
 */
export function featureIntersectsBbox(feature: FeatureLike, bbox: Bbox): boolean {
  const bounds = geometryBounds(feature.geometry);
  if (!bounds) return true;
  return bboxIntersects(bounds, bbox);
}

/** Filter features to those intersecting the bbox; a missing bbox is a no-op. */
export function filterByBbox<T extends FeatureLike>(features: T[], bbox?: Bbox): T[] {
  if (!bbox) return features;
  return features.filter((f) => featureIntersectsBbox(f, bbox));
}

export interface ViewportOptions {
  bbox?: Bbox;
  limit?: number;
  offset?: number;
}

export interface ViewportMeta {
  /** Total features after bbox filtering (before pagination). */
  total: number;
  /** Number of features actually returned in this page. */
  returned: number;
  /** Applied offset (0 when unpaginated). */
  offset: number;
  /** Applied limit, or `null` when the whole (filtered) set was returned. */
  limit: number | null;
  /** Whether more features exist beyond this page. */
  hasMore: boolean;
  /** The bbox that was applied, or `null` when unfiltered. */
  bbox: Bbox | null;
}

export interface ViewportResult<T> {
  features: T[];
  meta: ViewportMeta;
}

/**
 * Apply viewport bbox filtering then optional `offset`/`limit` pagination.
 * With no bbox and no limit this returns every feature (backward-compatible with
 * the old whole-FeatureCollection responses) while still reporting counts.
 */
export function applyViewport<T extends FeatureLike>(features: T[], opts: ViewportOptions = {}): ViewportResult<T> {
  const filtered = filterByBbox(features, opts.bbox);
  const total = filtered.length;
  const offset = opts.offset ?? 0;
  const hasLimit = opts.limit !== undefined;
  const page = hasLimit ? filtered.slice(offset, offset + (opts.limit as number)) : offset > 0 ? filtered.slice(offset) : filtered;
  return {
    features: page,
    meta: {
      total,
      returned: page.length,
      offset,
      limit: hasLimit ? (opts.limit as number) : null,
      hasMore: offset + page.length < total,
      bbox: opts.bbox ?? null,
    },
  };
}

/**
 * Build `ViewportOptions` straight from Express-style query params. Accepts the
 * raw `req.query` string values and defends against arrays/garbage.
 */
export function viewportOptionsFromQuery(query: {
  bbox?: unknown;
  limit?: unknown;
  offset?: unknown;
}): ViewportOptions {
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  return {
    bbox: parseBbox(str(query.bbox)),
    limit: parseNonNegativeInt(str(query.limit)),
    offset: parseNonNegativeInt(str(query.offset)),
  };
}
