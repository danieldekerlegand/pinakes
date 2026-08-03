import { describe, it, expect } from 'vitest';
import {
  computeAffineTransform,
  applyAffineTransform,
  computeGeoreferencedBounds,
} from './useImageGeoreference';
import type { ControlPoint } from './useImageGeoreference';

describe('computeAffineTransform', () => {
  it('returns null with fewer than 3 control points', () => {
    const points: ControlPoint[] = [
      { id: 'a', imagePos: [0, 0], mapPos: [40, 30] },
      { id: 'b', imagePos: [1, 0], mapPos: [40, 35] },
    ];
    expect(computeAffineTransform(points)).toBeNull();
  });

  it('computes a valid transform for 3 non-collinear control points', () => {
    const points: ControlPoint[] = [
      { id: 'a', imagePos: [0, 0], mapPos: [40, 30] },
      { id: 'b', imagePos: [1, 0], mapPos: [40, 35] },
      { id: 'c', imagePos: [0, 1], mapPos: [45, 30] },
    ];
    const transform = computeAffineTransform(points);
    expect(transform).not.toBeNull();
    expect(transform).toHaveLength(6);
  });

  it('maps control points back to their expected positions', () => {
    const points: ControlPoint[] = [
      { id: 'a', imagePos: [0, 0], mapPos: [40, 30] },
      { id: 'b', imagePos: [1, 0], mapPos: [40, 35] },
      { id: 'c', imagePos: [0, 1], mapPos: [45, 30] },
    ];
    const transform = computeAffineTransform(points)!;

    // Each input point should map back to its expected map position
    for (const cp of points) {
      const [lat, lng] = applyAffineTransform(transform, cp.imagePos);
      expect(lat).toBeCloseTo(cp.mapPos[0], 5);
      expect(lng).toBeCloseTo(cp.mapPos[1], 5);
    }
  });

  it('handles a simple identity-like mapping', () => {
    // Image (0,0)->(1,1) maps to map (0,0)->(1,1)
    const points: ControlPoint[] = [
      { id: 'a', imagePos: [0, 0], mapPos: [0, 0] },
      { id: 'b', imagePos: [1, 0], mapPos: [1, 0] },
      { id: 'c', imagePos: [0, 1], mapPos: [0, 1] },
    ];
    const transform = computeAffineTransform(points)!;
    expect(transform).not.toBeNull();

    // Test a midpoint
    const [lat, lng] = applyAffineTransform(transform, [0.5, 0.5]);
    expect(lat).toBeCloseTo(0.5, 5);
    expect(lng).toBeCloseTo(0.5, 5);
  });

  it('handles 4+ points using least-squares fit', () => {
    const points: ControlPoint[] = [
      { id: 'a', imagePos: [0, 0], mapPos: [10, 20] },
      { id: 'b', imagePos: [1, 0], mapPos: [10, 30] },
      { id: 'c', imagePos: [0, 1], mapPos: [20, 20] },
      { id: 'd', imagePos: [1, 1], mapPos: [20, 30] },
    ];
    const transform = computeAffineTransform(points)!;
    expect(transform).not.toBeNull();

    // All 4 points should map closely (perfect for affine since the mapping is affine)
    for (const cp of points) {
      const [lat, lng] = applyAffineTransform(transform, cp.imagePos);
      expect(lat).toBeCloseTo(cp.mapPos[0], 4);
      expect(lng).toBeCloseTo(cp.mapPos[1], 4);
    }
  });

  it('returns null for collinear points', () => {
    const points: ControlPoint[] = [
      { id: 'a', imagePos: [0, 0], mapPos: [0, 0] },
      { id: 'b', imagePos: [0.5, 0.5], mapPos: [5, 5] },
      { id: 'c', imagePos: [1, 1], mapPos: [10, 10] },
    ];
    // These are collinear in image space, so the matrix should be singular
    const transform = computeAffineTransform(points);
    expect(transform).toBeNull();
  });
});

describe('applyAffineTransform', () => {
  it('applies a simple translation transform', () => {
    // a=1, b=0, c=10, d=0, e=1, f=20 => lat = imgX + 10, lng = imgY + 20
    const transform: [number, number, number, number, number, number] = [1, 0, 10, 0, 1, 20];
    expect(applyAffineTransform(transform, [0, 0])).toEqual([10, 20]);
    expect(applyAffineTransform(transform, [5, 3])).toEqual([15, 23]);
  });

  it('applies a scaling transform', () => {
    // Scale by 2x in both dims
    const transform: [number, number, number, number, number, number] = [2, 0, 0, 0, 2, 0];
    const result = applyAffineTransform(transform, [0.5, 0.5]);
    expect(result[0]).toBeCloseTo(1, 5);
    expect(result[1]).toBeCloseTo(1, 5);
  });
});

describe('computeGeoreferencedBounds', () => {
  it('computes bounds from a simple identity-like transform', () => {
    // lat = imgX * 10 + 30, lng = imgY * 10 + 40
    const transform: [number, number, number, number, number, number] = [10, 0, 30, 0, 10, 40];
    const bounds = computeGeoreferencedBounds(transform);

    // Corners: (0,0)->(30,40), (1,0)->(40,40), (0,1)->(30,50), (1,1)->(40,50)
    expect(bounds[0][0]).toBeCloseTo(30, 5); // min lat
    expect(bounds[0][1]).toBeCloseTo(40, 5); // min lng
    expect(bounds[1][0]).toBeCloseTo(40, 5); // max lat
    expect(bounds[1][1]).toBeCloseTo(50, 5); // max lng
  });

  it('handles transforms with rotation-like effects', () => {
    // A transform that swaps axes: lat = imgY, lng = imgX
    const transform: [number, number, number, number, number, number] = [0, 1, 0, 1, 0, 0];
    const bounds = computeGeoreferencedBounds(transform);

    // Corners: (0,0)->(0,0), (1,0)->(0,1), (0,1)->(1,0), (1,1)->(1,1)
    expect(bounds[0][0]).toBeCloseTo(0, 5);
    expect(bounds[0][1]).toBeCloseTo(0, 5);
    expect(bounds[1][0]).toBeCloseTo(1, 5);
    expect(bounds[1][1]).toBeCloseTo(1, 5);
  });
});
