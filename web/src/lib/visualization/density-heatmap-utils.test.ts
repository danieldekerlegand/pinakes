import { describe, it, expect } from 'vitest';
import {
  clampIntensity,
  normaliseValues,
  centroidFromGeometry,
  featuresToHeatPoints,
  coordsToHeatPoints,
  mergeHeatPoints,
  DENSITY_GRADIENTS,
} from './density-heatmap-utils';

// ---------------------------------------------------------------------------
// clampIntensity
// ---------------------------------------------------------------------------
describe('clampIntensity', () => {
  it('returns the value when within 0-1', () => {
    expect(clampIntensity(0.5)).toBe(0.5);
  });

  it('clamps negative values to 0', () => {
    expect(clampIntensity(-0.3)).toBe(0);
  });

  it('clamps values above 1 to 1', () => {
    expect(clampIntensity(1.7)).toBe(1);
  });

  it('handles boundary values', () => {
    expect(clampIntensity(0)).toBe(0);
    expect(clampIntensity(1)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// normaliseValues
// ---------------------------------------------------------------------------
describe('normaliseValues', () => {
  it('returns empty array for empty input', () => {
    expect(normaliseValues([])).toEqual([]);
  });

  it('returns 0.5 for all values when they are identical', () => {
    expect(normaliseValues([7, 7, 7])).toEqual([0.5, 0.5, 0.5]);
  });

  it('maps min to 0 and max to 1', () => {
    const result = normaliseValues([10, 20, 30]);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0.5);
    expect(result[2]).toBe(1);
  });

  it('handles negative values', () => {
    const result = normaliseValues([-10, 0, 10]);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0.5);
    expect(result[2]).toBe(1);
  });

  it('handles a single value', () => {
    expect(normaliseValues([42])).toEqual([0.5]);
  });
});

// ---------------------------------------------------------------------------
// centroidFromGeometry
// ---------------------------------------------------------------------------
describe('centroidFromGeometry', () => {
  it('extracts lat/lng from a Point geometry', () => {
    const result = centroidFromGeometry({ type: 'Point', coordinates: [10, 20] });
    expect(result).toEqual({ lat: 20, lng: 10 });
  });

  it('computes centroid of a Polygon', () => {
    const result = centroidFromGeometry({
      type: 'Polygon',
      coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10]]],
    });
    expect(result).not.toBeNull();
    expect(result!.lat).toBe(5);
    expect(result!.lng).toBe(5);
  });

  it('computes centroid of a MultiPolygon', () => {
    const result = centroidFromGeometry({
      type: 'MultiPolygon',
      coordinates: [
        [[[0, 0], [2, 0], [2, 2], [0, 2]]],
        [[[10, 10], [12, 10], [12, 12], [10, 12]]],
      ],
    });
    expect(result).not.toBeNull();
    // Average of all 8 ring vertices
    expect(result!.lat).toBeCloseTo(6);
    expect(result!.lng).toBeCloseTo(6);
  });

  it('returns null for unsupported geometry type', () => {
    expect(centroidFromGeometry({ type: 'LineString', coordinates: [[0, 0], [1, 1]] })).toBeNull();
  });

  it('returns null for null geometry', () => {
    expect(centroidFromGeometry(null as any)).toBeNull();
  });

  it('returns null for missing coordinates', () => {
    expect(centroidFromGeometry({ type: 'Point', coordinates: undefined } as any)).toBeNull();
  });

  it('returns null for non-finite point coordinates', () => {
    expect(centroidFromGeometry({ type: 'Point', coordinates: [NaN, Infinity] })).toBeNull();
  });

  it('returns null for empty polygon ring', () => {
    expect(centroidFromGeometry({ type: 'Polygon', coordinates: [[]] })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// featuresToHeatPoints
// ---------------------------------------------------------------------------
describe('featuresToHeatPoints', () => {
  const features = [
    {
      geometry: { type: 'Point', coordinates: [10, 20] },
      properties: { population: 100 },
    },
    {
      geometry: { type: 'Point', coordinates: [30, 40] },
      properties: { population: 300 },
    },
    {
      geometry: { type: 'Point', coordinates: [20, 30] },
      properties: { population: 200 },
    },
  ];

  it('converts features with uniform intensity when no intensityFn', () => {
    const result = featuresToHeatPoints(features);
    expect(result).toHaveLength(3);
    // All uniform → all get 0.5
    for (const p of result) {
      expect(p.intensity).toBe(0.5);
    }
  });

  it('uses intensityFn to weight points', () => {
    const result = featuresToHeatPoints(features, (p) => p.population);
    expect(result).toHaveLength(3);
    // Sorted by lat: 20→100 (min), 30→200 (mid), 40→300 (max)
    const byLat = [...result].sort((a, b) => a.lat - b.lat);
    expect(byLat[0].intensity).toBe(0); // population 100 → min
    expect(byLat[1].intensity).toBe(0.5); // population 200 → mid
    expect(byLat[2].intensity).toBe(1); // population 300 → max
  });

  it('returns empty array for empty input', () => {
    expect(featuresToHeatPoints([])).toEqual([]);
  });

  it('skips features with invalid geometry', () => {
    const mixed = [
      { geometry: { type: 'Point', coordinates: [5, 10] }, properties: {} },
      { geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: {} },
    ];
    const result = featuresToHeatPoints(mixed);
    expect(result).toHaveLength(1);
    expect(result[0].lat).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// coordsToHeatPoints
// ---------------------------------------------------------------------------
describe('coordsToHeatPoints', () => {
  it('converts items with lat/lng fields', () => {
    const items = [
      { lat: 10, lng: 20 },
      { lat: 30, lng: 40 },
    ];
    const result = coordsToHeatPoints(items);
    expect(result).toHaveLength(2);
    expect(result[0].lat).toBe(10);
    expect(result[1].lat).toBe(30);
  });

  it('converts items with latitude/longitude fields', () => {
    const items = [{ latitude: 15, longitude: 25 }];
    const result = coordsToHeatPoints(items);
    expect(result).toHaveLength(1);
    expect(result[0].lat).toBe(15);
    expect(result[0].lng).toBe(25);
  });

  it('converts items with nested coordinates object', () => {
    const items = [{ coordinates: { lat: 5, lng: 10 } }];
    const result = coordsToHeatPoints(items);
    expect(result).toHaveLength(1);
    expect(result[0].lat).toBe(5);
  });

  it('uses intensityField for weighting', () => {
    const items = [
      { lat: 0, lng: 0, pop: 10 },
      { lat: 1, lng: 1, pop: 50 },
    ];
    const result = coordsToHeatPoints(items, 'pop');
    const sorted = [...result].sort((a, b) => a.lat - b.lat);
    expect(sorted[0].intensity).toBe(0); // pop=10 → min
    expect(sorted[1].intensity).toBe(1); // pop=50 → max
  });

  it('skips items with invalid coordinates', () => {
    const items = [
      { lat: 10, lng: 20 },
      { lat: NaN, lng: 30 },
      { name: 'no coords' },
    ];
    const result = coordsToHeatPoints(items);
    expect(result).toHaveLength(1);
  });

  it('returns empty array for empty input', () => {
    expect(coordsToHeatPoints([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mergeHeatPoints
// ---------------------------------------------------------------------------
describe('mergeHeatPoints', () => {
  it('merges multiple arrays', () => {
    const a = [{ lat: 1, lng: 2, intensity: 0.5 }];
    const b = [{ lat: 3, lng: 4, intensity: 0.8 }];
    const result = mergeHeatPoints(a, b);
    expect(result).toHaveLength(2);
  });

  it('handles empty arrays', () => {
    const result = mergeHeatPoints([], [], [{ lat: 0, lng: 0, intensity: 1 }]);
    expect(result).toHaveLength(1);
  });

  it('handles no arguments', () => {
    expect(mergeHeatPoints()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DENSITY_GRADIENTS
// ---------------------------------------------------------------------------
describe('DENSITY_GRADIENTS', () => {
  it('has expected preset keys', () => {
    expect(Object.keys(DENSITY_GRADIENTS)).toContain('thermal');
    expect(Object.keys(DENSITY_GRADIENTS)).toContain('cool');
    expect(Object.keys(DENSITY_GRADIENTS)).toContain('warm');
    expect(Object.keys(DENSITY_GRADIENTS)).toContain('viridis');
    expect(Object.keys(DENSITY_GRADIENTS)).toContain('monochrome');
  });

  it('each gradient has stops at 0 and 1', () => {
    for (const [name, gradient] of Object.entries(DENSITY_GRADIENTS)) {
      const stops = Object.keys(gradient).map(Number);
      expect(stops).toContain(0);
      expect(stops).toContain(1);
    }
  });
});
