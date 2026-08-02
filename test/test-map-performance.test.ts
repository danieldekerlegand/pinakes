import { describe, it, expect } from 'vitest';
import type { Feature, Polygon, MultiPolygon, Point, LineString } from 'geojson';
import {
  featureBounds,
  extractCoordinates,
  boundsOverlap,
  cullToViewport,
  simplifyRing,
  toleranceForZoom,
  simplifyFeature,
  TileCache,
  shouldUseWebGL,
  isWebGLSupported,
  WEBGL_FEATURE_THRESHOLD,
} from '../web/src/lib/visualization/map-performance';
import type { BoundingBox } from '../web/src/lib/visualization/geospatial-types';

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makePolygonFeature(coords: number[][][]): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: coords },
  };
}

function makePointFeature(lng: number, lat: number): Feature<Point> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [lng, lat] },
  };
}

function makeLineFeature(coords: number[][]): Feature<LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: coords },
  };
}

function makeMultiPolygonFeature(coords: number[][][][]): Feature<MultiPolygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'MultiPolygon', coordinates: coords },
  };
}

// A simple square polygon [0,0] -> [10,10]
const squareRing = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
const squareFeature = makePolygonFeature([squareRing]);

// ---------------------------------------------------------------------------
// extractCoordinates
// ---------------------------------------------------------------------------

describe('extractCoordinates', () => {
  it('extracts from Point', () => {
    const coords = extractCoordinates(makePointFeature(5, 10));
    expect(coords).toEqual([[5, 10]]);
  });

  it('extracts from LineString', () => {
    const coords = extractCoordinates(makeLineFeature([[0, 0], [1, 1], [2, 2]]));
    expect(coords).toEqual([[0, 0], [1, 1], [2, 2]]);
  });

  it('extracts from Polygon', () => {
    const coords = extractCoordinates(squareFeature);
    expect(coords).toEqual(squareRing);
  });

  it('extracts from MultiPolygon', () => {
    const mp = makeMultiPolygonFeature([[squareRing]]);
    const coords = extractCoordinates(mp);
    expect(coords).toEqual(squareRing);
  });

  it('returns empty for null geometry', () => {
    const f = { type: 'Feature' as const, properties: {}, geometry: null as any };
    expect(extractCoordinates(f)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// featureBounds
// ---------------------------------------------------------------------------

describe('featureBounds', () => {
  it('computes bounds for a polygon', () => {
    const bounds = featureBounds(squareFeature);
    expect(bounds).toEqual({ west: 0, south: 0, east: 10, north: 10 });
  });

  it('computes bounds for a point', () => {
    const bounds = featureBounds(makePointFeature(5, -3));
    expect(bounds).toEqual({ west: 5, south: -3, east: 5, north: -3 });
  });

  it('returns null for empty geometry', () => {
    const f = { type: 'Feature' as const, properties: {}, geometry: null as any };
    expect(featureBounds(f)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// boundsOverlap
// ---------------------------------------------------------------------------

describe('boundsOverlap', () => {
  const a: BoundingBox = { west: 0, south: 0, east: 10, north: 10 };

  it('detects overlap', () => {
    const b: BoundingBox = { west: 5, south: 5, east: 15, north: 15 };
    expect(boundsOverlap(a, b)).toBe(true);
  });

  it('detects no overlap (completely east)', () => {
    const b: BoundingBox = { west: 20, south: 0, east: 30, north: 10 };
    expect(boundsOverlap(a, b)).toBe(false);
  });

  it('detects no overlap (completely north)', () => {
    const b: BoundingBox = { west: 0, south: 20, east: 10, north: 30 };
    expect(boundsOverlap(a, b)).toBe(false);
  });

  it('detects edge-touching as overlap', () => {
    const b: BoundingBox = { west: 10, south: 0, east: 20, north: 10 };
    expect(boundsOverlap(a, b)).toBe(true);
  });

  it('detects containment as overlap', () => {
    const b: BoundingBox = { west: 2, south: 2, east: 8, north: 8 };
    expect(boundsOverlap(a, b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// cullToViewport
// ---------------------------------------------------------------------------

describe('cullToViewport', () => {
  const viewport: BoundingBox = { west: -10, south: -10, east: 20, north: 20 };

  it('keeps features inside viewport', () => {
    const result = cullToViewport([squareFeature], viewport);
    expect(result).toHaveLength(1);
  });

  it('removes features outside viewport', () => {
    const farAway = makePointFeature(100, 100);
    const result = cullToViewport([farAway], viewport);
    expect(result).toHaveLength(0);
  });

  it('keeps features partially overlapping viewport', () => {
    // Square [0,0]-[10,10] partially in viewport [-10,-10]-[5,5]
    const smallVP: BoundingBox = { west: -10, south: -10, east: 5, north: 5 };
    const result = cullToViewport([squareFeature], smallVP);
    expect(result).toHaveLength(1);
  });

  it('handles empty features array', () => {
    expect(cullToViewport([], viewport)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// simplifyRing
// ---------------------------------------------------------------------------

describe('simplifyRing', () => {
  it('preserves rings with 3 or fewer points', () => {
    const ring = [[0, 0], [1, 1], [0, 0]];
    expect(simplifyRing(ring, 0.5)).toEqual(ring);
  });

  it('simplifies a detailed ring', () => {
    // Create a zigzag ring with small perturbations
    const ring: number[][] = [];
    for (let i = 0; i <= 20; i++) {
      ring.push([i, i % 2 === 0 ? 0 : 0.01]); // tiny zigzag
    }
    ring.push([0, 0]); // close ring

    const simplified = simplifyRing(ring, 0.1);
    // Should be significantly fewer points
    expect(simplified.length).toBeLessThan(ring.length);
    expect(simplified.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps endpoints', () => {
    const ring = [[0, 0], [5, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const simplified = simplifyRing(ring, 0.1);
    expect(simplified[0]).toEqual([0, 0]);
  });

  it('ensures ring closure', () => {
    const ring = [[0, 0], [5, 5], [10, 0], [5, -5], [0, 0]];
    const simplified = simplifyRing(ring, 0.001);
    const first = simplified[0];
    const last = simplified[simplified.length - 1];
    expect(first[0]).toBe(last[0]);
    expect(first[1]).toBe(last[1]);
  });
});

// ---------------------------------------------------------------------------
// toleranceForZoom
// ---------------------------------------------------------------------------

describe('toleranceForZoom', () => {
  it('returns 0 for high zoom (full detail)', () => {
    expect(toleranceForZoom(10)).toBe(0);
    expect(toleranceForZoom(15)).toBe(0);
  });

  it('returns larger tolerance for low zoom', () => {
    const low = toleranceForZoom(2);
    const mid = toleranceForZoom(6);
    const high = toleranceForZoom(10);
    expect(low).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(high);
  });

  it('returns positive tolerance at world-view zoom', () => {
    expect(toleranceForZoom(2)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// simplifyFeature
// ---------------------------------------------------------------------------

describe('simplifyFeature', () => {
  it('returns the same feature at high zoom (no simplification)', () => {
    const result = simplifyFeature(squareFeature, 12);
    expect(result.geometry.coordinates).toEqual(squareFeature.geometry.coordinates);
  });

  it('simplifies at low zoom', () => {
    // Create a polygon with many points
    const ring: number[][] = [];
    for (let i = 0; i < 100; i++) {
      const angle = (i / 100) * 2 * Math.PI;
      ring.push([Math.cos(angle) * 10, Math.sin(angle) * 10]);
    }
    ring.push(ring[0]); // close
    const detailed = makePolygonFeature([ring]);

    const simplified = simplifyFeature(detailed, 2);
    const simplifiedRing = simplified.geometry.coordinates[0];
    expect(simplifiedRing.length).toBeLessThan(ring.length);
  });

  it('handles MultiPolygon', () => {
    const mp = makeMultiPolygonFeature([[squareRing]]);
    const result = simplifyFeature(mp, 2);
    expect(result.geometry.type).toBe('MultiPolygon');
  });

  it('does not mutate the original feature', () => {
    const original = JSON.parse(JSON.stringify(squareFeature));
    simplifyFeature(squareFeature, 2);
    expect(squareFeature.geometry.coordinates).toEqual(original.geometry.coordinates);
  });
});

// ---------------------------------------------------------------------------
// TileCache
// ---------------------------------------------------------------------------

describe('TileCache', () => {
  it('stores and retrieves values', () => {
    const cache = new TileCache<string>();
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('returns undefined for missing keys', () => {
    const cache = new TileCache<string>();
    expect(cache.get('missing')).toBeUndefined();
  });

  it('evicts oldest entry when full', () => {
    const cache = new TileCache<number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4); // should evict 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('d')).toBe(4);
  });

  it('generates viewport keys', () => {
    const key = TileCache.viewportKey({ west: 0, south: 0, east: 10, north: 10 }, 5);
    expect(key).toBe('5/0.00/0.00/10.00/10.00');
  });

  it('has() returns true for existing keys', () => {
    const cache = new TileCache<string>();
    cache.set('x', 'y');
    expect(cache.has('x')).toBe(true);
    expect(cache.has('z')).toBe(false);
  });

  it('clear() empties the cache', () => {
    const cache = new TileCache<string>();
    cache.set('a', '1');
    cache.set('b', '2');
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });

  it('reports size correctly', () => {
    const cache = new TileCache<number>();
    expect(cache.size).toBe(0);
    cache.set('a', 1);
    expect(cache.size).toBe(1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// WebGL threshold
// ---------------------------------------------------------------------------

describe('WebGL threshold', () => {
  it('WEBGL_FEATURE_THRESHOLD is 1000', () => {
    expect(WEBGL_FEATURE_THRESHOLD).toBe(1000);
  });

  it('shouldUseWebGL returns false for small counts', () => {
    expect(shouldUseWebGL(100)).toBe(false);
    expect(shouldUseWebGL(999)).toBe(false);
    expect(shouldUseWebGL(1000)).toBe(false);
  });

  it('shouldUseWebGL returns true for large counts', () => {
    expect(shouldUseWebGL(1001)).toBe(true);
    expect(shouldUseWebGL(5000)).toBe(true);
  });

  it('isWebGLSupported returns boolean (node env)', () => {
    // In node test env, document is not defined, so should return false
    expect(typeof isWebGLSupported()).toBe('boolean');
  });
});
