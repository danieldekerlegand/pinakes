import { describe, it, expect } from 'vitest';
import {
  delaunayTriangulate,
  barycentricCoords,
  buildRubberSheetTransform,
  applyRubberSheetTransform,
  computeRubberSheetBounds,
} from './rubber-sheet-transform';
import type { ControlPoint } from './useImageGeoreference';

// ============================================================================
// Delaunay triangulation tests
// ============================================================================

describe('delaunayTriangulate', () => {
  it('returns empty for fewer than 3 points', () => {
    expect(delaunayTriangulate([])).toEqual([]);
    expect(delaunayTriangulate([{ x: 0, y: 0 }])).toEqual([]);
    expect(delaunayTriangulate([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toEqual([]);
  });

  it('triangulates 3 points into 1 triangle', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.5, y: 1 },
    ];
    const tris = delaunayTriangulate(points);
    expect(tris).toHaveLength(1);
    const indices = new Set([tris[0].a, tris[0].b, tris[0].c]);
    expect(indices).toEqual(new Set([0, 1, 2]));
  });

  it('triangulates 4 points (square) into 2 triangles', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const tris = delaunayTriangulate(points);
    expect(tris).toHaveLength(2);
    // All indices should be in range [0, 3]
    for (const tri of tris) {
      expect(tri.a).toBeGreaterThanOrEqual(0);
      expect(tri.a).toBeLessThan(4);
      expect(tri.b).toBeGreaterThanOrEqual(0);
      expect(tri.b).toBeLessThan(4);
      expect(tri.c).toBeGreaterThanOrEqual(0);
      expect(tri.c).toBeLessThan(4);
    }
  });

  it('triangulates 5 points correctly', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 0.5, y: 0.5 },
    ];
    const tris = delaunayTriangulate(points);
    // 5 points with center should create 4 triangles
    expect(tris.length).toBeGreaterThanOrEqual(4);
  });

  it('handles a grid of 9 points', () => {
    const points = [];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        points.push({ x: i * 0.5, y: j * 0.5 });
      }
    }
    const tris = delaunayTriangulate(points);
    // A 3x3 grid should produce 8 triangles
    expect(tris.length).toBeGreaterThanOrEqual(8);
    // All indices should be valid
    for (const tri of tris) {
      expect(tri.a).toBeGreaterThanOrEqual(0);
      expect(tri.a).toBeLessThan(9);
    }
  });
});

// ============================================================================
// Barycentric coordinates tests
// ============================================================================

describe('barycentricCoords', () => {
  it('returns coords for a point inside a triangle', () => {
    // Triangle: (0,0), (1,0), (0,1). Test point: (0.25, 0.25)
    const result = barycentricCoords(0.25, 0.25, 0, 0, 1, 0, 0, 1);
    expect(result).not.toBeNull();
    const [u, v, w] = result!;
    expect(u + v + w).toBeCloseTo(1, 10);
    expect(u).toBeGreaterThan(0);
    expect(v).toBeGreaterThan(0);
    expect(w).toBeGreaterThan(0);
  });

  it('returns null for a point outside a triangle', () => {
    const result = barycentricCoords(2, 2, 0, 0, 1, 0, 0, 1);
    expect(result).toBeNull();
  });

  it('returns coords for a point on the edge', () => {
    // Point on edge (0,0)-(1,0): (0.5, 0)
    const result = barycentricCoords(0.5, 0, 0, 0, 1, 0, 0, 1);
    expect(result).not.toBeNull();
  });

  it('returns coords for a vertex', () => {
    const result = barycentricCoords(0, 0, 0, 0, 1, 0, 0, 1);
    expect(result).not.toBeNull();
  });
});

// ============================================================================
// Rubber-sheet transform tests
// ============================================================================

describe('buildRubberSheetTransform', () => {
  it('returns null for fewer than 4 control points', () => {
    const points: ControlPoint[] = [
      { id: 'a', imagePos: [0, 0], mapPos: [40, 30] },
      { id: 'b', imagePos: [1, 0], mapPos: [40, 35] },
      { id: 'c', imagePos: [0, 1], mapPos: [45, 30] },
    ];
    expect(buildRubberSheetTransform(points)).toBeNull();
  });

  it('builds a transform for 4 control points', () => {
    const points: ControlPoint[] = [
      { id: 'a', imagePos: [0, 0], mapPos: [40, 30] },
      { id: 'b', imagePos: [1, 0], mapPos: [40, 35] },
      { id: 'c', imagePos: [0, 1], mapPos: [45, 30] },
      { id: 'd', imagePos: [1, 1], mapPos: [45, 35] },
    ];
    const rst = buildRubberSheetTransform(points);
    expect(rst).not.toBeNull();
    expect(rst!.triangles.length).toBeGreaterThanOrEqual(2);
    expect(rst!.globalAffine).toHaveLength(6);
  });

  it('builds a transform for 6+ control points', () => {
    const points: ControlPoint[] = [
      { id: 'a', imagePos: [0, 0], mapPos: [40, 30] },
      { id: 'b', imagePos: [1, 0], mapPos: [40, 35] },
      { id: 'c', imagePos: [0, 1], mapPos: [45, 30] },
      { id: 'd', imagePos: [1, 1], mapPos: [45, 35] },
      { id: 'e', imagePos: [0.5, 0], mapPos: [40, 32.5] },
      { id: 'f', imagePos: [0.5, 0.5], mapPos: [42.5, 32.5] },
    ];
    const rst = buildRubberSheetTransform(points);
    expect(rst).not.toBeNull();
    expect(rst!.triangles.length).toBeGreaterThanOrEqual(4);
  });
});

describe('applyRubberSheetTransform', () => {
  // Simple affine case: all 4 corners of a rectangle map linearly
  const linearPoints: ControlPoint[] = [
    { id: 'a', imagePos: [0, 0], mapPos: [10, 20] },
    { id: 'b', imagePos: [1, 0], mapPos: [10, 30] },
    { id: 'c', imagePos: [0, 1], mapPos: [20, 20] },
    { id: 'd', imagePos: [1, 1], mapPos: [20, 30] },
  ];

  it('maps control points exactly back to their map positions', () => {
    const rst = buildRubberSheetTransform(linearPoints)!;
    expect(rst).not.toBeNull();

    for (const cp of linearPoints) {
      const [lat, lng] = applyRubberSheetTransform(rst, cp.imagePos);
      expect(lat).toBeCloseTo(cp.mapPos[0], 4);
      expect(lng).toBeCloseTo(cp.mapPos[1], 4);
    }
  });

  it('interpolates interior points correctly for a linear mapping', () => {
    const rst = buildRubberSheetTransform(linearPoints)!;
    // Center of image should map to center of map region
    const [lat, lng] = applyRubberSheetTransform(rst, [0.5, 0.5]);
    expect(lat).toBeCloseTo(15, 2);
    expect(lng).toBeCloseTo(25, 2);
  });

  it('handles non-linear distortion with rubber-sheet', () => {
    // Deliberately distort the 4th point so a global affine can't match all 4 exactly
    const distortedPoints: ControlPoint[] = [
      { id: 'a', imagePos: [0, 0], mapPos: [10, 20] },
      { id: 'b', imagePos: [1, 0], mapPos: [10, 30] },
      { id: 'c', imagePos: [0, 1], mapPos: [20, 20] },
      { id: 'd', imagePos: [1, 1], mapPos: [22, 32] }, // distorted!
    ];
    const rst = buildRubberSheetTransform(distortedPoints)!;
    expect(rst).not.toBeNull();

    // Rubber-sheet should exactly match ALL control points despite distortion
    for (const cp of distortedPoints) {
      const [lat, lng] = applyRubberSheetTransform(rst, cp.imagePos);
      expect(lat).toBeCloseTo(cp.mapPos[0], 4);
      expect(lng).toBeCloseTo(cp.mapPos[1], 4);
    }
  });

  it('falls back to global affine for points outside the convex hull', () => {
    const rst = buildRubberSheetTransform(linearPoints)!;
    // Point outside the image bounds should still return a result (via global affine)
    const [lat, lng] = applyRubberSheetTransform(rst, [-0.5, -0.5]);
    expect(typeof lat).toBe('number');
    expect(typeof lng).toBe('number');
    expect(isNaN(lat)).toBe(false);
    expect(isNaN(lng)).toBe(false);
  });
});

describe('computeRubberSheetBounds', () => {
  it('computes bounds for a simple rectangular mapping', () => {
    const points: ControlPoint[] = [
      { id: 'a', imagePos: [0, 0], mapPos: [10, 20] },
      { id: 'b', imagePos: [1, 0], mapPos: [10, 30] },
      { id: 'c', imagePos: [0, 1], mapPos: [20, 20] },
      { id: 'd', imagePos: [1, 1], mapPos: [20, 30] },
    ];
    const rst = buildRubberSheetTransform(points)!;
    const bounds = computeRubberSheetBounds(rst);

    expect(bounds[0][0]).toBeCloseTo(10, 0); // min lat
    expect(bounds[0][1]).toBeCloseTo(20, 0); // min lng
    expect(bounds[1][0]).toBeCloseTo(20, 0); // max lat
    expect(bounds[1][1]).toBeCloseTo(30, 0); // max lng
  });

  it('computes bounds for a distorted mapping', () => {
    const points: ControlPoint[] = [
      { id: 'a', imagePos: [0, 0], mapPos: [10, 20] },
      { id: 'b', imagePos: [1, 0], mapPos: [10, 30] },
      { id: 'c', imagePos: [0, 1], mapPos: [20, 20] },
      { id: 'd', imagePos: [1, 1], mapPos: [22, 32] },
    ];
    const rst = buildRubberSheetTransform(points)!;
    const bounds = computeRubberSheetBounds(rst);

    // Bounds should encompass all control points
    expect(bounds[0][0]).toBeLessThanOrEqual(10);
    expect(bounds[0][1]).toBeLessThanOrEqual(20);
    expect(bounds[1][0]).toBeGreaterThanOrEqual(22);
    expect(bounds[1][1]).toBeGreaterThanOrEqual(32);
  });
});
