import { describe, it, expect } from 'vitest';
import {
  projectToIsometric,
  extrudePolygon,
  computeCentroid,
  generateSideFaces,
  simplifyPolygon,
  buildExtrudedRegions,
  darkenColor,
  hexWithAlpha,
  lerp,
  formatMetricValue,
  type RegionInput,
  type ProjectionConfig,
  type ExtrusionMetric,
  METRIC_LABELS,
} from '@/lib/visualization/extrusion-utils';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const sampleConfig: ProjectionConfig = {
  width: 800,
  height: 600,
  centerLng: 44,
  centerLat: 33,
  scale: 20,
  tiltAngle: 30,
  maxExtrusionHeight: 120,
};

function makeSquareRegion(
  id: string,
  name: string,
  centerLng: number,
  centerLat: number,
  size: number,
  population: number,
): RegionInput {
  const half = size / 2;
  return {
    id,
    name,
    color: '#3b82f6',
    coordinates: [
      [
        [centerLng - half, centerLat - half],
        [centerLng + half, centerLat - half],
        [centerLng + half, centerLat + half],
        [centerLng - half, centerLat + half],
        [centerLng - half, centerLat - half], // close ring
      ],
    ],
    metrics: { population },
  };
}

const sampleRegions: RegionInput[] = [
  makeSquareRegion('roman', 'Roman Empire', 20, 42, 10, 60_000_000),
  makeSquareRegion('persian', 'Persian Empire', 52, 32, 8, 35_000_000),
  makeSquareRegion('han', 'Han Dynasty', 108, 34, 12, 57_000_000),
];

// ---------------------------------------------------------------------------
// projectToIsometric
// ---------------------------------------------------------------------------

describe('projectToIsometric', () => {
  it('maps center point to canvas center', () => {
    const [x, y] = projectToIsometric(44, 33, sampleConfig);
    expect(x).toBeCloseTo(400);
    // Y is compressed by cos(30°)
    expect(y).toBeCloseTo(300 * Math.cos((30 * Math.PI) / 180));
  });

  it('longitude offset maps to X offset', () => {
    const [x1] = projectToIsometric(44, 33, sampleConfig);
    const [x2] = projectToIsometric(54, 33, sampleConfig);
    // 10 degrees * scale 20 = 200px offset
    expect(x2 - x1).toBeCloseTo(200);
  });

  it('latitude offset maps to negative Y offset (compressed)', () => {
    const [, y1] = projectToIsometric(44, 33, sampleConfig);
    const [, y2] = projectToIsometric(44, 43, sampleConfig);
    // Higher lat → smaller Y (moves up), compressed by cos(tilt)
    expect(y2).toBeLessThan(y1);
  });

  it('with tilt=0 gives flat projection', () => {
    const cfg = { ...sampleConfig, tiltAngle: 0 };
    const [x, y] = projectToIsometric(44, 33, cfg);
    expect(x).toBeCloseTo(400);
    expect(y).toBeCloseTo(300); // cos(0) = 1, no compression
  });
});

// ---------------------------------------------------------------------------
// extrudePolygon
// ---------------------------------------------------------------------------

describe('extrudePolygon', () => {
  it('shifts polygon upward by height', () => {
    const base: [number, number][] = [
      [100, 200],
      [200, 200],
      [200, 300],
      [100, 300],
    ];
    const top = extrudePolygon(base, 50);
    expect(top).toEqual([
      [100, 150],
      [200, 150],
      [200, 250],
      [100, 250],
    ]);
  });

  it('with height=0 returns same Y values', () => {
    const base: [number, number][] = [
      [10, 20],
      [30, 40],
    ];
    const top = extrudePolygon(base, 0);
    expect(top[0][1]).toBe(20);
    expect(top[1][1]).toBe(40);
  });

  it('preserves X coordinates', () => {
    const base: [number, number][] = [
      [50, 100],
      [150, 100],
    ];
    const top = extrudePolygon(base, 75);
    expect(top[0][0]).toBe(50);
    expect(top[1][0]).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// computeCentroid
// ---------------------------------------------------------------------------

describe('computeCentroid', () => {
  it('computes average of coordinate ring', () => {
    const ring = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const [cx, cy] = computeCentroid(ring);
    expect(cx).toBe(5);
    expect(cy).toBe(5);
  });

  it('handles empty array', () => {
    const [cx, cy] = computeCentroid([]);
    expect(cx).toBe(0);
    expect(cy).toBe(0);
  });

  it('handles single point', () => {
    const [cx, cy] = computeCentroid([[42, 17]]);
    expect(cx).toBe(42);
    expect(cy).toBe(17);
  });
});

// ---------------------------------------------------------------------------
// generateSideFaces
// ---------------------------------------------------------------------------

describe('generateSideFaces', () => {
  it('generates one face per edge', () => {
    const base: [number, number][] = [
      [0, 100],
      [100, 100],
      [100, 0],
      [0, 0],
    ];
    const top = extrudePolygon(base, 50);
    const faces = generateSideFaces(base, top);
    expect(faces).toHaveLength(4);
  });

  it('each face has 4 corner points', () => {
    const base: [number, number][] = [
      [0, 10],
      [10, 10],
      [10, 0],
    ];
    const top = extrudePolygon(base, 20);
    const faces = generateSideFaces(base, top);
    for (const face of faces) {
      expect(face.points).toHaveLength(4);
    }
  });

  it('classifies lit faces based on edge direction', () => {
    const base: [number, number][] = [
      [0, 100],
      [100, 100], // edge goes right → lit
      [100, 0], // edge goes left (up) → not lit
      [0, 0], // edge goes left → not lit
    ];
    const top = extrudePolygon(base, 30);
    const faces = generateSideFaces(base, top);
    // First edge: (0,100)→(100,100), dx=100 > 0 → lit
    expect(faces[0].isLit).toBe(true);
    // Second edge: (100,100)→(100,0), dx=0 → not lit
    expect(faces[1].isLit).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// simplifyPolygon
// ---------------------------------------------------------------------------

describe('simplifyPolygon', () => {
  it('returns original if under max points', () => {
    const pts = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ];
    expect(simplifyPolygon(pts, 10)).toEqual(pts);
  });

  it('reduces points to approximately maxPoints', () => {
    const pts = Array.from({ length: 100 }, (_, i) => [
      Math.cos((i * 2 * Math.PI) / 100),
      Math.sin((i * 2 * Math.PI) / 100),
    ]);
    const simplified = simplifyPolygon(pts, 20);
    expect(simplified.length).toBeLessThanOrEqual(25); // some tolerance
    expect(simplified.length).toBeGreaterThanOrEqual(15);
  });

  it('closes the ring if needed', () => {
    const pts = Array.from({ length: 50 }, (_, i) => [i, i * 2]);
    const simplified = simplifyPolygon(pts, 10);
    const first = simplified[0];
    const last = simplified[simplified.length - 1];
    expect(first[0]).toBe(last[0]);
    expect(first[1]).toBe(last[1]);
  });
});

// ---------------------------------------------------------------------------
// buildExtrudedRegions
// ---------------------------------------------------------------------------

describe('buildExtrudedRegions', () => {
  it('returns extruded regions for valid input', () => {
    const result = buildExtrudedRegions(sampleRegions, 'population', sampleConfig);
    expect(result).toHaveLength(3);
  });

  it('normalizes heights relative to max metric value', () => {
    const result = buildExtrudedRegions(sampleRegions, 'population', sampleConfig);
    // Roman Empire has the highest population (60M)
    const roman = result.find((r) => r.id === 'roman')!;
    expect(roman.normalizedHeight).toBeCloseTo(1);

    // Persian Empire has 35M / 60M
    const persian = result.find((r) => r.id === 'persian')!;
    expect(persian.normalizedHeight).toBeCloseTo(35 / 60);
  });

  it('computes extrusion height proportional to metric', () => {
    const result = buildExtrudedRegions(sampleRegions, 'population', sampleConfig);
    const roman = result.find((r) => r.id === 'roman')!;
    expect(roman.extrusionHeight).toBeCloseTo(sampleConfig.maxExtrusionHeight);
  });

  it('sorts regions by centroid latitude (back to front)', () => {
    const result = buildExtrudedRegions(sampleRegions, 'population', sampleConfig);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].centroid[1]).toBeGreaterThanOrEqual(
        result[i - 1].centroid[1],
      );
    }
  });

  it('skips regions with fewer than 3 coordinates', () => {
    const badRegion: RegionInput = {
      id: 'bad',
      name: 'Bad',
      color: '#000',
      coordinates: [[[0, 0], [1, 1]]], // Only 2 points
      metrics: { population: 100 },
    };
    const result = buildExtrudedRegions([badRegion], 'population', sampleConfig);
    expect(result).toHaveLength(0);
  });

  it('handles missing metric gracefully (defaults to 0)', () => {
    const region: RegionInput = {
      id: 'test',
      name: 'Test',
      color: '#abc',
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
      metrics: {}, // No population metric
    };
    const result = buildExtrudedRegions([region], 'population', sampleConfig);
    expect(result).toHaveLength(1);
    expect(result[0].metricValue).toBe(0);
    expect(result[0].extrusionHeight).toBe(0);
  });

  it('generates side faces for each region', () => {
    const result = buildExtrudedRegions(sampleRegions, 'population', sampleConfig);
    for (const region of result) {
      expect(region.sideFaces.length).toBeGreaterThan(0);
    }
  });

  it('generates top polygons offset by extrusion height', () => {
    const result = buildExtrudedRegions(sampleRegions, 'population', sampleConfig);
    for (const region of result) {
      // Top polygon Y values should be less than base polygon Y values
      for (let i = 0; i < region.basePolygon.length; i++) {
        expect(region.topPolygon[i][1]).toBeLessThanOrEqual(
          region.basePolygon[i][1],
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

describe('darkenColor', () => {
  it('with factor 1 returns original color as rgb', () => {
    expect(darkenColor('#ff8000', 1)).toBe('rgb(255, 128, 0)');
  });

  it('with factor 0 returns black', () => {
    expect(darkenColor('#ff8000', 0)).toBe('rgb(0, 0, 0)');
  });

  it('with factor 0.5 halves each channel', () => {
    expect(darkenColor('#808080', 0.5)).toBe('rgb(64, 64, 64)');
  });
});

describe('hexWithAlpha', () => {
  it('converts hex to rgba', () => {
    expect(hexWithAlpha('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('handles full alpha', () => {
    expect(hexWithAlpha('#00ff00', 1)).toBe('rgba(0, 255, 0, 1)');
  });
});

// ---------------------------------------------------------------------------
// lerp
// ---------------------------------------------------------------------------

describe('lerp', () => {
  it('returns from at t=0', () => {
    expect(lerp(10, 50, 0)).toBe(10);
  });

  it('returns to at t=1', () => {
    expect(lerp(10, 50, 1)).toBe(50);
  });

  it('returns midpoint at t=0.5', () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
  });

  it('clamps t below 0', () => {
    expect(lerp(0, 100, -0.5)).toBe(0);
  });

  it('clamps t above 1', () => {
    expect(lerp(0, 100, 1.5)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// formatMetricValue
// ---------------------------------------------------------------------------

describe('formatMetricValue', () => {
  it('formats billions', () => {
    expect(formatMetricValue(2_500_000_000)).toBe('2.5B');
  });

  it('formats millions', () => {
    expect(formatMetricValue(45_000_000)).toBe('45.0M');
  });

  it('formats thousands', () => {
    expect(formatMetricValue(12_500)).toBe('12.5K');
  });

  it('formats small numbers as-is', () => {
    expect(formatMetricValue(42)).toBe('42');
  });

  it('formats zero', () => {
    expect(formatMetricValue(0)).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// METRIC_LABELS
// ---------------------------------------------------------------------------

describe('METRIC_LABELS', () => {
  it('has labels for all metrics', () => {
    const expectedMetrics: ExtrusionMetric[] = [
      'population',
      'territory',
      'military',
      'trade',
      'speakers',
    ];
    for (const m of expectedMetrics) {
      expect(METRIC_LABELS[m]).toBeDefined();
      expect(typeof METRIC_LABELS[m]).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// Multiple metrics
// ---------------------------------------------------------------------------

describe('buildExtrudedRegions with different metrics', () => {
  it('uses territory metric when specified', () => {
    const regions: RegionInput[] = [
      {
        id: 'a',
        name: 'A',
        color: '#f00',
        coordinates: [
          [
            [0, 0], [5, 0], [5, 5], [0, 5], [0, 0],
          ],
        ],
        metrics: { population: 100, territory: 500_000 },
      },
      {
        id: 'b',
        name: 'B',
        color: '#0f0',
        coordinates: [
          [
            [10, 0], [15, 0], [15, 5], [10, 5], [10, 0],
          ],
        ],
        metrics: { population: 200, territory: 250_000 },
      },
    ];

    const byPop = buildExtrudedRegions(regions, 'population', sampleConfig);
    const byTerritory = buildExtrudedRegions(regions, 'territory', sampleConfig);

    // By population: B is taller
    const bPop = byPop.find((r) => r.id === 'b')!;
    expect(bPop.normalizedHeight).toBeCloseTo(1);

    // By territory: A is taller
    const aTerritory = byTerritory.find((r) => r.id === 'a')!;
    expect(aTerritory.normalizedHeight).toBeCloseTo(1);
  });
});
