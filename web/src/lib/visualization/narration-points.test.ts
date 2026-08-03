import { describe, it, expect } from 'vitest';
import type { NarrationPoint } from './geospatial-types';
import {
  DEFAULT_NARRATION_POINTS,
  findNarrationPointsInRange,
  findNextNarrationPoint,
  findPreviousNarrationPoint,
  narrationPointPosition,
} from './narration-points';

const SAMPLE_POINTS: NarrationPoint[] = [
  { id: 'a', year: -3000, title: 'Event A', description: 'Desc A', category: 'political' },
  { id: 'b', year: -1200, title: 'Event B', description: 'Desc B', category: 'military' },
  { id: 'c', year: 0, title: 'Event C', description: 'Desc C', category: 'cultural' },
  { id: 'd', year: 476, title: 'Event D', description: 'Desc D', category: 'political' },
  { id: 'e', year: 1492, title: 'Event E', description: 'Desc E', category: 'scientific' },
];

describe('narration-points', () => {
  describe('DEFAULT_NARRATION_POINTS', () => {
    it('contains a non-empty array of narration points', () => {
      expect(DEFAULT_NARRATION_POINTS.length).toBeGreaterThan(0);
    });

    it('all points have required fields', () => {
      for (const point of DEFAULT_NARRATION_POINTS) {
        expect(point.id).toBeTruthy();
        expect(typeof point.year).toBe('number');
        expect(point.title).toBeTruthy();
        expect(point.description).toBeTruthy();
      }
    });

    it('points have unique ids', () => {
      const ids = DEFAULT_NARRATION_POINTS.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('points are broadly ordered chronologically', () => {
      for (let i = 1; i < DEFAULT_NARRATION_POINTS.length; i++) {
        expect(DEFAULT_NARRATION_POINTS[i].year).toBeGreaterThanOrEqual(
          DEFAULT_NARRATION_POINTS[i - 1].year,
        );
      }
    });
  });

  describe('findNarrationPointsInRange', () => {
    it('returns points within the inclusive range', () => {
      const result = findNarrationPointsInRange(SAMPLE_POINTS, -1200, 476);
      expect(result.map((p) => p.id)).toEqual(['b', 'c', 'd']);
    });

    it('returns empty array when no points in range', () => {
      const result = findNarrationPointsInRange(SAMPLE_POINTS, 500, 1000);
      expect(result).toEqual([]);
    });

    it('includes boundary points', () => {
      const result = findNarrationPointsInRange(SAMPLE_POINTS, -3000, -3000);
      expect(result.map((p) => p.id)).toEqual(['a']);
    });

    it('returns all points when range covers everything', () => {
      const result = findNarrationPointsInRange(SAMPLE_POINTS, -5000, 2000);
      expect(result.length).toBe(SAMPLE_POINTS.length);
    });
  });

  describe('findNextNarrationPoint', () => {
    it('returns the next point after the given year', () => {
      const result = findNextNarrationPoint(SAMPLE_POINTS, -1500);
      expect(result?.id).toBe('b');
    });

    it('skips the current year (strictly greater)', () => {
      const result = findNextNarrationPoint(SAMPLE_POINTS, -1200);
      expect(result?.id).toBe('c');
    });

    it('returns undefined when no point exists after the year', () => {
      const result = findNextNarrationPoint(SAMPLE_POINTS, 2000);
      expect(result).toBeUndefined();
    });

    it('returns the first point when before all points', () => {
      const result = findNextNarrationPoint(SAMPLE_POINTS, -5000);
      expect(result?.id).toBe('a');
    });
  });

  describe('findPreviousNarrationPoint', () => {
    it('returns the previous point before the given year', () => {
      const result = findPreviousNarrationPoint(SAMPLE_POINTS, 100);
      expect(result?.id).toBe('c');
    });

    it('skips the current year (strictly less)', () => {
      const result = findPreviousNarrationPoint(SAMPLE_POINTS, 0);
      expect(result?.id).toBe('b');
    });

    it('returns undefined when no point exists before the year', () => {
      const result = findPreviousNarrationPoint(SAMPLE_POINTS, -4000);
      expect(result).toBeUndefined();
    });
  });

  describe('narrationPointPosition', () => {
    it('returns 0 for the minimum year', () => {
      expect(narrationPointPosition(-3000, -3000, 2024)).toBe(0);
    });

    it('returns 100 for the maximum year', () => {
      expect(narrationPointPosition(2024, -3000, 2024)).toBe(100);
    });

    it('returns 50 for the midpoint', () => {
      expect(narrationPointPosition(0, -100, 100)).toBe(50);
    });

    it('returns 0 when min equals max', () => {
      expect(narrationPointPosition(100, 100, 100)).toBe(0);
    });

    it('handles negative year ranges', () => {
      const pct = narrationPointPosition(-2000, -3000, -1000);
      expect(pct).toBe(50);
    });
  });
});
