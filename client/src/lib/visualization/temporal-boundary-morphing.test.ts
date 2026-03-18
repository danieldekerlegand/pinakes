import { describe, it, expect } from 'vitest';
import type { Position } from 'geojson';
import type { CivilizationFeature } from './geospatial-types';
import {
  resampleRing,
  lerpPosition,
  easeInOutCubic,
  interpolateRings,
  interpolatePolygonCoordinates,
  extractPolygonCoordinates,
  groupSnapshotsByCivilization,
  findBracketingSnapshots,
  generateMorphedBoundaries,
  interpolateAlongRoute,
  generateMigrationParticles,
  type TemporalSnapshot,
} from './temporal-boundary-morphing';

// ============================================================================
// Test Helpers
// ============================================================================

function makeFeature(
  civId: string,
  startYear: number,
  endYear: number | null,
  coords: Position[][]
): CivilizationFeature {
  return {
    type: 'Feature',
    id: `${civId}-${startYear}`,
    geometry: { type: 'Polygon', coordinates: coords },
    properties: {
      civilizationId: civId,
      name: `${civId} at ${startYear}`,
      timePeriod: { start: startYear, end: endYear, label: `${startYear}` },
      associatedLanguageIds: [],
      writingSystems: [],
      sources: [],
    },
  };
}

const squareCoords: Position[][] = [
  [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
];

const bigSquareCoords: Position[][] = [
  [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]],
];

const triangleCoords: Position[][] = [
  [[0, 0], [10, 0], [5, 10], [0, 0]],
];

// ============================================================================
// resampleRing
// ============================================================================

describe('resampleRing', () => {
  it('returns empty array for empty ring', () => {
    expect(resampleRing([], 5)).toEqual([]);
  });

  it('returns filled array for single-point ring', () => {
    const result = resampleRing([[5, 5]], 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual([5, 5]);
  });

  it('resamples to correct count', () => {
    const ring: Position[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const result = resampleRing(ring, 10);
    expect(result).toHaveLength(10);
  });

  it('first and last points approximate original start/end', () => {
    const ring: Position[] = [[0, 0], [10, 0], [10, 10]];
    const result = resampleRing(ring, 5);
    expect(result[0][0]).toBeCloseTo(0);
    expect(result[0][1]).toBeCloseTo(0);
    expect(result[4][0]).toBeCloseTo(10);
    expect(result[4][1]).toBeCloseTo(10);
  });

  it('returns single point when targetCount is 1', () => {
    const ring: Position[] = [[0, 0], [10, 0]];
    const result = resampleRing(ring, 1);
    expect(result).toHaveLength(1);
  });
});

// ============================================================================
// lerpPosition
// ============================================================================

describe('lerpPosition', () => {
  it('returns start at t=0', () => {
    const result = lerpPosition([0, 0], [10, 10], 0);
    expect(result[0]).toBeCloseTo(0);
    expect(result[1]).toBeCloseTo(0);
  });

  it('returns end at t=1', () => {
    const result = lerpPosition([0, 0], [10, 10], 1);
    expect(result[0]).toBeCloseTo(10);
    expect(result[1]).toBeCloseTo(10);
  });

  it('returns midpoint at t=0.5', () => {
    const result = lerpPosition([0, 0], [10, 10], 0.5);
    expect(result[0]).toBeCloseTo(5);
    expect(result[1]).toBeCloseTo(5);
  });
});

// ============================================================================
// easeInOutCubic
// ============================================================================

describe('easeInOutCubic', () => {
  it('returns 0 at t=0', () => {
    expect(easeInOutCubic(0)).toBe(0);
  });

  it('returns 1 at t=1', () => {
    expect(easeInOutCubic(1)).toBeCloseTo(1);
  });

  it('returns 0.5 at t=0.5', () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
  });

  it('is slower at start and end, faster in middle', () => {
    const quarter = easeInOutCubic(0.25);
    expect(quarter).toBeLessThan(0.25); // Slower at start
    const threeQuarter = easeInOutCubic(0.75);
    expect(threeQuarter).toBeGreaterThan(0.75); // Faster past midpoint
  });
});

// ============================================================================
// interpolateRings
// ============================================================================

describe('interpolateRings', () => {
  it('returns ringA at t=0', () => {
    const ringA: Position[] = [[0, 0], [10, 0], [10, 10], [0, 0]];
    const ringB: Position[] = [[0, 0], [20, 0], [20, 20], [0, 0]];
    const result = interpolateRings(ringA, ringB, 0);
    // At t=0, easeInOutCubic(0) = 0, so should be ringA
    expect(result[0][0]).toBeCloseTo(0);
    expect(result[0][1]).toBeCloseTo(0);
  });

  it('returns ringB at t=1', () => {
    const ringA: Position[] = [[0, 0], [10, 0], [10, 10], [0, 0]];
    const ringB: Position[] = [[0, 0], [20, 0], [20, 20], [0, 0]];
    const result = interpolateRings(ringA, ringB, 1);
    // At t=1, easeInOutCubic(1) = 1, so should approximate ringB
    // Last point should be close to [0,0] (closed ring resampled)
    expect(result.length).toBeGreaterThanOrEqual(4);
  });

  it('handles rings of different lengths', () => {
    const ringA: Position[] = [[0, 0], [10, 0], [10, 10], [0, 0]];
    const ringB: Position[] = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10], [5, 10], [0, 10], [0, 0]];
    const result = interpolateRings(ringA, ringB, 0.5);
    // Should have the max count
    expect(result.length).toBe(Math.max(ringA.length, ringB.length));
  });
});

// ============================================================================
// interpolatePolygonCoordinates
// ============================================================================

describe('interpolatePolygonCoordinates', () => {
  it('interpolates outer rings', () => {
    const result = interpolatePolygonCoordinates(squareCoords, bigSquareCoords, 0.5);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].length).toBeGreaterThan(0);
  });

  it('preserves holes from closer snapshot', () => {
    const withHole: Position[][] = [
      [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]],
      [[5, 5], [15, 5], [15, 15], [5, 15], [5, 5]], // hole
    ];
    // t < 0.5 -> holes from coordsA
    const result1 = interpolatePolygonCoordinates(withHole, squareCoords, 0.3);
    expect(result1.length).toBe(2); // outer + 1 hole

    // t >= 0.5 -> holes from coordsB (which has none)
    const result2 = interpolatePolygonCoordinates(withHole, squareCoords, 0.7);
    expect(result2.length).toBe(1); // just outer ring
  });
});

// ============================================================================
// extractPolygonCoordinates
// ============================================================================

describe('extractPolygonCoordinates', () => {
  it('extracts from Polygon', () => {
    const feature = makeFeature('test', 100, 200, squareCoords);
    const result = extractPolygonCoordinates(feature);
    expect(result).toEqual(squareCoords);
  });

  it('extracts first polygon from MultiPolygon', () => {
    const feature: CivilizationFeature = {
      type: 'Feature',
      id: 'multi-test',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [squareCoords, bigSquareCoords],
      },
      properties: {
        civilizationId: 'test',
        name: 'Test',
        timePeriod: { start: 100, end: 200, label: '100' },
        associatedLanguageIds: [],
        writingSystems: [],
        sources: [],
      },
    };
    const result = extractPolygonCoordinates(feature);
    expect(result).toEqual(squareCoords);
  });
});

// ============================================================================
// groupSnapshotsByCivilization
// ============================================================================

describe('groupSnapshotsByCivilization', () => {
  it('groups features by civilizationId', () => {
    const features = [
      makeFeature('rome', 100, 200, squareCoords),
      makeFeature('rome', 200, 300, bigSquareCoords),
      makeFeature('greece', -500, -200, triangleCoords),
    ];
    const groups = groupSnapshotsByCivilization(features);
    expect(groups.size).toBe(2);
    expect(groups.get('rome')!.length).toBe(2);
    expect(groups.get('greece')!.length).toBe(1);
  });

  it('sorts snapshots by year within each group', () => {
    const features = [
      makeFeature('rome', 300, 400, squareCoords),
      makeFeature('rome', 100, 200, bigSquareCoords),
      makeFeature('rome', 200, 300, triangleCoords),
    ];
    const groups = groupSnapshotsByCivilization(features);
    const romeSnapshots = groups.get('rome')!;
    expect(romeSnapshots[0].year).toBe(100);
    expect(romeSnapshots[1].year).toBe(200);
    expect(romeSnapshots[2].year).toBe(300);
  });
});

// ============================================================================
// findBracketingSnapshots
// ============================================================================

describe('findBracketingSnapshots', () => {
  const snapshots: TemporalSnapshot[] = [
    { year: 100, feature: makeFeature('test', 100, 200, squareCoords) },
    { year: 200, feature: makeFeature('test', 200, 300, bigSquareCoords) },
    { year: 300, feature: makeFeature('test', 300, 400, triangleCoords) },
  ];

  it('returns null for empty snapshots', () => {
    expect(findBracketingSnapshots([], 150)).toBeNull();
  });

  it('returns first snapshot with progress 0 when before all snapshots', () => {
    const result = findBracketingSnapshots(snapshots, 50);
    expect(result).not.toBeNull();
    expect(result!.before.year).toBe(100);
    expect(result!.after.year).toBe(100);
    expect(result!.progress).toBe(0);
  });

  it('returns last snapshot with progress 1 when after all snapshots', () => {
    const result = findBracketingSnapshots(snapshots, 500);
    expect(result).not.toBeNull();
    expect(result!.before.year).toBe(300);
    expect(result!.progress).toBe(1);
  });

  it('finds correct bracketing pair', () => {
    const result = findBracketingSnapshots(snapshots, 150);
    expect(result).not.toBeNull();
    expect(result!.before.year).toBe(100);
    expect(result!.after.year).toBe(200);
    expect(result!.progress).toBeCloseTo(0.5);
  });

  it('returns correct bracket when year matches a snapshot boundary', () => {
    const result = findBracketingSnapshots(snapshots, 200);
    expect(result).not.toBeNull();
    // 200 is on the boundary between [100,200] and [200,300]
    // It falls in [100,200] range with progress=1, or [200,300] with progress=0
    expect(result!.before.year).toBe(100);
    expect(result!.after.year).toBe(200);
    expect(result!.progress).toBe(1);
  });
});

// ============================================================================
// generateMorphedBoundaries
// ============================================================================

describe('generateMorphedBoundaries', () => {
  it('generates morphed boundaries for active civilizations', () => {
    const features = [
      makeFeature('rome', 100, 300, squareCoords),
      makeFeature('rome', 300, 500, bigSquareCoords),
    ];
    const groups = groupSnapshotsByCivilization(features);
    const result = generateMorphedBoundaries(groups, 200);
    expect(result.length).toBe(1);
    expect(result[0].civilizationId).toBe('rome');
    expect(result[0].progress).toBeCloseTo(0.5);
  });

  it('excludes civilizations outside their time range', () => {
    const features = [
      makeFeature('rome', 100, 300, squareCoords),
      makeFeature('rome', 300, 500, bigSquareCoords),
    ];
    const groups = groupSnapshotsByCivilization(features);
    const result = generateMorphedBoundaries(groups, 50);
    expect(result.length).toBe(0);
  });

  it('handles multiple civilizations', () => {
    const features = [
      makeFeature('rome', 100, 300, squareCoords),
      makeFeature('rome', 300, 500, bigSquareCoords),
      makeFeature('greece', -500, -200, triangleCoords),
      makeFeature('greece', -200, 100, squareCoords),
    ];
    const groups = groupSnapshotsByCivilization(features);
    const result = generateMorphedBoundaries(groups, -300);
    // Only greece should be active at -300
    expect(result.length).toBe(1);
    expect(result[0].civilizationId).toBe('greece');
  });
});

// ============================================================================
// interpolateAlongRoute
// ============================================================================

describe('interpolateAlongRoute', () => {
  const route: Position[] = [[0, 0], [10, 0], [10, 10]];

  it('returns start at progress 0', () => {
    const result = interpolateAlongRoute(route, 0);
    expect(result[0]).toBeCloseTo(0);
    expect(result[1]).toBeCloseTo(0);
  });

  it('returns end at progress 1', () => {
    const result = interpolateAlongRoute(route, 1);
    expect(result[0]).toBeCloseTo(10);
    expect(result[1]).toBeCloseTo(10);
  });

  it('returns midpoint along route at progress 0.5', () => {
    const result = interpolateAlongRoute(route, 0.5);
    // Route is L-shaped: [0,0]->[10,0]->[10,10], total ~20 units
    // Midpoint at ~10 units = [10, 0] (the corner)
    expect(result[0]).toBeCloseTo(10);
    expect(result[1]).toBeCloseTo(0);
  });

  it('handles empty route', () => {
    const result = interpolateAlongRoute([], 0.5);
    expect(result).toEqual([0, 0]);
  });

  it('handles single-point route', () => {
    const result = interpolateAlongRoute([[5, 5]], 0.5);
    expect(result[0]).toBe(5);
    expect(result[1]).toBe(5);
  });
});

// ============================================================================
// generateMigrationParticles
// ============================================================================

describe('generateMigrationParticles', () => {
  const route: Position[] = [[0, 0], [10, 0], [10, 10]];

  it('generates correct number of particles', () => {
    const result = generateMigrationParticles(route, 5, 0, '#ff0000');
    expect(result.length).toBe(5);
  });

  it('assigns correct color', () => {
    const result = generateMigrationParticles(route, 3, 0, '#3b82f6');
    result.forEach(p => expect(p.color).toBe('#3b82f6'));
  });

  it('returns empty for route with less than 2 points', () => {
    expect(generateMigrationParticles([[0, 0]], 5, 0, '#ff0000')).toEqual([]);
    expect(generateMigrationParticles([], 5, 0, '#ff0000')).toEqual([]);
  });

  it('distributes particles along the route', () => {
    const result = generateMigrationParticles(route, 4, 0, '#ff0000');
    // Particles should be at different positions
    const positions = result.map(p => p.routeProgress);
    const uniquePositions = new Set(positions.map(p => p.toFixed(3)));
    expect(uniquePositions.size).toBe(4);
  });
});
