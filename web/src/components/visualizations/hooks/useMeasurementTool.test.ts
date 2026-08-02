/**
 * Tests for the measurement tool state logic.
 * Since @testing-library/react is not available, we test the underlying
 * calculation functions that the hook delegates to, plus verify the types.
 */
import { describe, it, expect } from 'vitest';
import {
  polylineDistance,
  calculateArea,
  generateIsochrones,
  TRAVEL_SPEEDS,
} from '../../../lib/visualization/measurement-utils';

describe('useMeasurementTool integration logic', () => {
  describe('distance mode calculations', () => {
    it('returns null-equivalent for fewer than 2 points', () => {
      const result = polylineDistance([[0, 0]]);
      expect(result.segments).toHaveLength(0);
      expect(result.totalDistance).toBe(0);
    });

    it('computes correctly for 3 waypoints', () => {
      const points = [[0, 0], [1, 0], [1, 1]];
      const km = polylineDistance(points, 'km');
      const mi = polylineDistance(points, 'miles');

      expect(km.segments).toHaveLength(2);
      expect(mi.totalDistance).toBeLessThan(km.totalDistance);
    });
  });

  describe('area mode calculations', () => {
    it('returns zero for fewer than 3 vertices', () => {
      expect(calculateArea([[0, 0], [1, 0]]).area).toBe(0);
    });

    it('computes area for triangle', () => {
      const result = calculateArea([[0, 0], [1, 0], [0.5, 1]]);
      expect(result.area).toBeGreaterThan(0);
      expect(result.perimeter).toBeGreaterThan(0);
    });
  });

  describe('isochrone mode calculations', () => {
    it('generates isochrones that replace on second click', () => {
      // First "click"
      const first = generateIsochrones([0, 0], 'walking');
      // Second "click" replaces center
      const second = generateIsochrones([10, 10], 'walking');
      expect(first.center).toEqual([0, 0]);
      expect(second.center).toEqual([10, 10]);
    });

    it('recalculates for different travel modes', () => {
      const walk = generateIsochrones([0, 0], 'walking', [1]);
      const horse = generateIsochrones([0, 0], 'horseback', [1]);
      expect(horse.rings[0].radiusKm).toBeGreaterThan(walk.rings[0].radiusKm);
    });

    it('produces rings with correct radius = speed * time', () => {
      const result = generateIsochrones([0, 0], 'ship', [4]);
      expect(result.rings[0].radiusKm).toBe(TRAVEL_SPEEDS.ship * 4);
    });
  });
});
