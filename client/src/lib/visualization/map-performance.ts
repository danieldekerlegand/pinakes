/**
 * Map performance utilities: viewport culling, level-of-detail polygon
 * simplification, tile-based computation caching, and WebGL threshold detection.
 */

import type { Feature, Polygon, MultiPolygon, Point, LineString, Position } from 'geojson';
import type { BoundingBox } from './geospatial-types';

// ---------------------------------------------------------------------------
// Viewport Culling
// ---------------------------------------------------------------------------

/**
 * Compute a bounding box for a GeoJSON feature geometry.
 */
export function featureBounds(feature: Feature): BoundingBox | null {
  const coords = extractCoordinates(feature);
  if (coords.length === 0) return null;

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const [lng, lat] of coords) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }

  return { west, south, east, north };
}

/**
 * Extract all coordinate pairs from a GeoJSON feature.
 */
export function extractCoordinates(feature: Feature): Position[] {
  const geom = feature.geometry;
  if (!geom) return [];

  switch (geom.type) {
    case 'Point':
      return [geom.coordinates];
    case 'MultiPoint':
      return geom.coordinates;
    case 'LineString':
      return geom.coordinates;
    case 'MultiLineString':
      return geom.coordinates.flat();
    case 'Polygon':
      return geom.coordinates.flat();
    case 'MultiPolygon':
      return geom.coordinates.flat(2);
    default:
      return [];
  }
}

/**
 * Test whether two bounding boxes overlap.
 */
export function boundsOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

/**
 * Filter an array of GeoJSON features to only those intersecting the viewport.
 */
export function cullToViewport<T extends Feature>(features: T[], viewport: BoundingBox): T[] {
  return features.filter((f) => {
    const fb = featureBounds(f);
    if (!fb) return false;
    return boundsOverlap(fb, viewport);
  });
}

// ---------------------------------------------------------------------------
// Server-side viewport requests
// ---------------------------------------------------------------------------

/**
 * Serialize a viewport to the `west,south,east,north` bbox string understood by
 * the `/api/map/*` endpoints (see server/services/geo-bbox.ts). Coordinates are
 * rounded to 5 decimal places (~1m) so identical viewports produce identical
 * cache keys.
 */
export function bboxToParam(b: BoundingBox): string {
  const f = (n: number) => Number(n.toFixed(5)).toString();
  return `${f(b.west)},${f(b.south)},${f(b.east)},${f(b.north)}`;
}

/**
 * Build the query-param object appended to a map data request's React Query key
 * so the server culls to the current viewport. Returns an empty object when the
 * viewport is unknown (initial mount) — the server then returns the full layer,
 * matching the pre-viewport behavior. The object shape is consumed by
 * `getQueryFn` (client/src/lib/queryClient.ts), which turns object query-key
 * parts into URL query params.
 */
export function viewportParams(
  viewport: BoundingBox | null,
  zoom?: number,
  limit?: number,
): Record<string, string> {
  if (!viewport) return {};
  const params: Record<string, string> = { bbox: bboxToParam(viewport) };
  if (typeof zoom === 'number' && Number.isFinite(zoom)) params.zoom = String(Math.round(zoom));
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) params.limit = String(Math.floor(limit));
  return params;
}

// ---------------------------------------------------------------------------
// Level-of-Detail Polygon Simplification
// ---------------------------------------------------------------------------

/**
 * Simplify a coordinate ring using the Douglas-Peucker algorithm.
 * `tolerance` is in degrees — larger values produce coarser output.
 */
export function simplifyRing(ring: Position[], tolerance: number): Position[] {
  if (ring.length <= 3) return ring;

  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;

  dpSimplify(ring, 0, ring.length - 1, tolerance * tolerance, keep);

  const result: Position[] = [];
  for (let i = 0; i < ring.length; i++) {
    if (keep[i]) result.push(ring[i]);
  }

  // Ensure ring closure
  if (result.length >= 2) {
    const first = result[0];
    const last = result[result.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      result.push([...first]);
    }
  }

  return result;
}

function dpSimplify(ring: Position[], start: number, end: number, tolSq: number, keep: Uint8Array): void {
  if (end - start < 2) return;

  let maxDistSq = 0;
  let maxIdx = start;

  const ax = ring[start][0];
  const ay = ring[start][1];
  const bx = ring[end][0];
  const by = ring[end][1];

  for (let i = start + 1; i < end; i++) {
    const d = perpendicularDistSq(ring[i][0], ring[i][1], ax, ay, bx, by);
    if (d > maxDistSq) {
      maxDistSq = d;
      maxIdx = i;
    }
  }

  if (maxDistSq > tolSq) {
    keep[maxIdx] = 1;
    dpSimplify(ring, start, maxIdx, tolSq, keep);
    dpSimplify(ring, maxIdx, end, tolSq, keep);
  }
}

function perpendicularDistSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    const ex = px - ax;
    const ey = py - ay;
    return ex * ex + ey * ey;
  }

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

/**
 * Get the simplification tolerance based on current zoom level.
 * Lower zoom (zoomed out) → higher tolerance → coarser polygons.
 */
export function toleranceForZoom(zoom: number): number {
  // At zoom 2 (world view) use ~1 degree tolerance
  // At zoom 8+ use near-zero tolerance (full detail)
  if (zoom >= 10) return 0;
  if (zoom >= 8) return 0.001;
  if (zoom >= 6) return 0.01;
  if (zoom >= 4) return 0.05;
  if (zoom >= 3) return 0.2;
  return 0.5;
}

/**
 * Apply level-of-detail simplification to a polygon feature.
 * Returns a new feature with simplified coordinates (original is not mutated).
 */
export function simplifyFeature<T extends Feature<Polygon | MultiPolygon>>(
  feature: T,
  zoom: number
): T {
  const tolerance = toleranceForZoom(zoom);
  if (tolerance === 0) return feature;

  const geom = feature.geometry;

  if (geom.type === 'Polygon') {
    const simplified = geom.coordinates.map((ring) => simplifyRing(ring, tolerance));
    return {
      ...feature,
      geometry: { ...geom, coordinates: simplified },
    };
  }

  if (geom.type === 'MultiPolygon') {
    const simplified = geom.coordinates.map((polygon) =>
      polygon.map((ring) => simplifyRing(ring, tolerance))
    );
    return {
      ...feature,
      geometry: { ...geom, coordinates: simplified },
    };
  }

  return feature;
}

// ---------------------------------------------------------------------------
// Tile-Based Computation Cache
// ---------------------------------------------------------------------------

interface TileCacheEntry<T> {
  value: T;
  timestamp: number;
}

/**
 * A simple tile-key–based cache for expensive map computations.
 * Keys are typically `${zoom}/${x}/${y}` or `${zoom}/${bounds}`.
 */
export class TileCache<T> {
  private cache = new Map<string, TileCacheEntry<T>>();
  private maxEntries: number;
  private ttlMs: number;

  constructor(maxEntries = 256, ttlMs = 60_000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  /** Generate a cache key from viewport bounds and zoom. */
  static viewportKey(bounds: BoundingBox, zoom: number): string {
    const precision = 2;
    return `${zoom}/${bounds.west.toFixed(precision)}/${bounds.south.toFixed(precision)}/${bounds.east.toFixed(precision)}/${bounds.north.toFixed(precision)}`;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    // Evict oldest if full
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// ---------------------------------------------------------------------------
// WebGL Threshold Detection
// ---------------------------------------------------------------------------

/** The feature count above which we recommend WebGL/Canvas rendering */
export const WEBGL_FEATURE_THRESHOLD = 1000;

/**
 * Check whether the current browser environment supports WebGL.
 */
export function isWebGLSupported(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl') || canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

/**
 * Determine whether a layer should use WebGL rendering based on feature count.
 */
export function shouldUseWebGL(featureCount: number): boolean {
  return featureCount > WEBGL_FEATURE_THRESHOLD;
}
