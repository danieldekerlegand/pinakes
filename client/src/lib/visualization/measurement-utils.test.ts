import { describe, it, expect } from 'vitest';
import {
  pointToPointDistance,
  polylineDistance,
  calculateArea,
  generateIsochrones,
  formatDistance,
  formatArea,
  formatTravelTime,
  TRAVEL_SPEEDS,
} from './measurement-utils';

// ============================================================================
// Distance Measurement
// ============================================================================

describe('pointToPointDistance', () => {
  it('returns 0 for identical points', () => {
    const dist = pointToPointDistance([0, 0], [0, 0]);
    expect(dist).toBe(0);
  });

  it('calculates distance in km between known cities', () => {
    // London [lng, lat] to Paris — approximately 344 km
    const london = [-0.1278, 51.5074];
    const paris = [2.3522, 48.8566];
    const dist = pointToPointDistance(london, paris, 'km');
    expect(dist).toBeGreaterThan(330);
    expect(dist).toBeLessThan(360);
  });

  it('calculates distance in miles', () => {
    const london = [-0.1278, 51.5074];
    const paris = [2.3522, 48.8566];
    const distKm = pointToPointDistance(london, paris, 'km');
    const distMi = pointToPointDistance(london, paris, 'miles');
    // 1 km ≈ 0.621 miles
    expect(distMi).toBeCloseTo(distKm * 0.621371, 0);
  });
});

describe('polylineDistance', () => {
  it('returns zero for fewer than 2 points', () => {
    const result = polylineDistance([[0, 0]]);
    expect(result.totalDistance).toBe(0);
    expect(result.segments).toHaveLength(0);
  });

  it('calculates total and segment distances', () => {
    const points = [
      [-0.1278, 51.5074], // London
      [2.3522, 48.8566],  // Paris
      [12.4964, 41.9028], // Rome
    ];
    const result = polylineDistance(points, 'km');
    expect(result.segments).toHaveLength(2);
    expect(result.totalDistance).toBeGreaterThan(0);
    // Total should equal sum of segments
    const segmentSum = result.segments.reduce((s, seg) => s + seg.distance, 0);
    expect(result.totalDistance).toBeCloseTo(segmentSum, 10);
  });

  it('respects unit parameter', () => {
    const points = [[0, 0], [1, 1]];
    const km = polylineDistance(points, 'km');
    const mi = polylineDistance(points, 'miles');
    expect(km.unit).toBe('km');
    expect(mi.unit).toBe('miles');
    expect(mi.totalDistance).toBeLessThan(km.totalDistance);
  });
});

// ============================================================================
// Area Calculation
// ============================================================================

describe('calculateArea', () => {
  it('returns zero for fewer than 3 vertices', () => {
    const result = calculateArea([[0, 0], [1, 1]]);
    expect(result.area).toBe(0);
    expect(result.perimeter).toBe(0);
  });

  it('calculates area for a known region', () => {
    // Roughly a 1° × 1° square at the equator ≈ 12,309 km²
    const vertices = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const result = calculateArea(vertices);
    expect(result.area).toBeGreaterThan(12000);
    expect(result.area).toBeLessThan(12500);
  });

  it('provides area in multiple units', () => {
    const vertices = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const result = calculateArea(vertices);
    expect(result.areaSqMiles).toBeCloseTo(result.area * 0.386102, 0);
    expect(result.areaAcres).toBeCloseTo(result.areaSqMiles * 640, 0);
  });

  it('calculates perimeter', () => {
    const vertices = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const result = calculateArea(vertices);
    // Perimeter of ~1° square at equator ≈ 4 × 111 km = 444 km
    expect(result.perimeter).toBeGreaterThan(430);
    expect(result.perimeter).toBeLessThan(460);
  });
});

// ============================================================================
// Isochrone Generation
// ============================================================================

describe('generateIsochrones', () => {
  it('generates rings for each time interval', () => {
    const result = generateIsochrones([35, 33], 'walking');
    expect(result.rings).toHaveLength(5); // default 5 intervals
    expect(result.travelMode).toBe('walking');
    expect(result.center).toEqual([35, 33]);
  });

  it('calculates radius from speed × time', () => {
    const result = generateIsochrones([0, 0], 'horseback', [1, 2]);
    expect(result.rings[0].radiusKm).toBe(TRAVEL_SPEEDS.horseback * 1);
    expect(result.rings[1].radiusKm).toBe(TRAVEL_SPEEDS.horseback * 2);
  });

  it('sorts rings by hours ascending', () => {
    const result = generateIsochrones([0, 0], 'ship', [24, 1, 8]);
    const hours = result.rings.map((r) => r.hours);
    expect(hours).toEqual([1, 8, 24]);
  });

  it('produces valid GeoJSON polygons', () => {
    const result = generateIsochrones([0, 0], 'walking', [1]);
    const ring = result.rings[0];
    expect(ring.polygon.type).toBe('Feature');
    expect(ring.polygon.geometry.type).toBe('Polygon');
    expect(ring.polygon.geometry.coordinates[0].length).toBeGreaterThan(3);
  });

  it('uses correct speeds for different modes', () => {
    const walk = generateIsochrones([0, 0], 'walking', [1]);
    const horse = generateIsochrones([0, 0], 'horseback', [1]);
    const ship = generateIsochrones([0, 0], 'ship', [1]);

    expect(walk.rings[0].radiusKm).toBe(5);
    expect(horse.rings[0].radiusKm).toBe(12);
    expect(ship.rings[0].radiusKm).toBe(8);
  });
});

// ============================================================================
// Formatting Helpers
// ============================================================================

describe('formatDistance', () => {
  it('formats sub-kilometer as meters', () => {
    expect(formatDistance(0.5, 'km')).toBe('500 m');
  });

  it('formats sub-mile as feet', () => {
    expect(formatDistance(0.5, 'miles')).toBe('2640 ft');
  });

  it('formats medium distances with one decimal', () => {
    expect(formatDistance(42.195, 'km')).toBe('42.2 km');
  });

  it('formats large distances with thousands separator', () => {
    const result = formatDistance(1234, 'km');
    expect(result).toContain('1');
    expect(result).toContain('234');
    expect(result).toContain('km');
  });
});

describe('formatArea', () => {
  it('formats sub-km² as m²', () => {
    expect(formatArea(0.5)).toBe('500000 m²');
  });

  it('formats medium areas with decimals', () => {
    expect(formatArea(42.5)).toBe('42.50 km²');
  });

  it('formats large areas rounded', () => {
    const result = formatArea(1234);
    expect(result).toContain('1');
    expect(result).toContain('234');
    expect(result).toContain('km²');
  });
});

describe('formatTravelTime', () => {
  it('formats sub-hour as minutes', () => {
    expect(formatTravelTime(0.5)).toBe('30 min');
  });

  it('formats hours', () => {
    expect(formatTravelTime(8)).toBe('8 hr');
  });

  it('formats whole days', () => {
    expect(formatTravelTime(48)).toBe('2 days');
  });

  it('formats single day', () => {
    expect(formatTravelTime(24)).toBe('1 day');
  });

  it('formats fractional days', () => {
    expect(formatTravelTime(36)).toBe('1.5 days');
  });
});
