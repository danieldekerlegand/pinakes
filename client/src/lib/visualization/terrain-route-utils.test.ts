import { describe, it, expect } from 'vitest';
import {
  haversineDistance,
  isOverWater,
  isNearRiver,
  classifyPointTerrain,
  classifyRouteTerrain,
  terrainFromRouteType,
  splitRouteByTerrain,
  estimateElevation,
  generateElevationProfile,
  getTerrainStyle,
  getTerrainLabel,
  getTerrainIcon,
} from './terrain-route-utils';

// ============================================================================
// haversineDistance
// ============================================================================

describe('haversineDistance', () => {
  it('returns 0 for same point', () => {
    expect(haversineDistance(40, -74, 40, -74)).toBe(0);
  });

  it('computes a known distance (London to Paris ~344 km)', () => {
    const d = haversineDistance(51.5, -0.12, 48.86, 2.35);
    expect(d).toBeGreaterThan(330);
    expect(d).toBeLessThan(360);
  });

  it('computes long distance (New York to Tokyo ~10,800 km)', () => {
    const d = haversineDistance(40.71, -74.01, 35.68, 139.69);
    expect(d).toBeGreaterThan(10500);
    expect(d).toBeLessThan(11200);
  });
});

// ============================================================================
// isOverWater
// ============================================================================

describe('isOverWater', () => {
  it('identifies mid-Atlantic as water', () => {
    expect(isOverWater(-40, 30)).toBe(true);
  });

  it('identifies Mediterranean as water', () => {
    expect(isOverWater(15, 37)).toBe(true);
  });

  it('identifies central France as land', () => {
    expect(isOverWater(2, 47)).toBe(false);
  });

  it('identifies central Sahara as land', () => {
    expect(isOverWater(10, 22)).toBe(false);
  });

  it('identifies central China as land', () => {
    expect(isOverWater(105, 35)).toBe(false);
  });

  it('identifies Arabian Sea as water', () => {
    expect(isOverWater(65, 15)).toBe(true);
  });
});

// ============================================================================
// isNearRiver
// ============================================================================

describe('isNearRiver', () => {
  it('identifies point near Nile as river', () => {
    expect(isNearRiver(31, 26)).toBe(true);
  });

  it('identifies point near Tigris-Euphrates as river', () => {
    expect(isNearRiver(44, 33)).toBe(true);
  });

  it('identifies central Sahara as not near river', () => {
    expect(isNearRiver(10, 22)).toBe(false);
  });

  it('identifies point near Ganges as river', () => {
    expect(isNearRiver(80, 25)).toBe(true);
  });
});

// ============================================================================
// classifyPointTerrain
// ============================================================================

describe('classifyPointTerrain', () => {
  it('classifies ocean point as maritime', () => {
    expect(classifyPointTerrain(-40, 30)).toBe('maritime');
  });

  it('classifies river point as river', () => {
    expect(classifyPointTerrain(31, 26)).toBe('river');
  });

  it('classifies inland point as land', () => {
    expect(classifyPointTerrain(105, 35)).toBe('land');
  });
});

// ============================================================================
// classifyRouteTerrain
// ============================================================================

describe('classifyRouteTerrain', () => {
  it('returns land for empty coordinates', () => {
    expect(classifyRouteTerrain([])).toBe('land');
  });

  it('classifies all-land route as land', () => {
    // Silk Road-like: all inland China/Central Asia
    const coords = [[105, 35], [95, 38], [85, 40], [75, 39]];
    expect(classifyRouteTerrain(coords)).toBe('land');
  });

  it('classifies all-ocean route as maritime', () => {
    // Mid-Atlantic crossing
    const coords = [[-40, 30], [-35, 32], [-30, 35]];
    expect(classifyRouteTerrain(coords)).toBe('maritime');
  });

  it('classifies mixed land/sea route as mixed', () => {
    // Starts inland, goes to Mediterranean
    const coords = [[2, 47], [5, 44], [10, 40], [15, 37]];
    expect(classifyRouteTerrain(coords)).toBe('mixed');
  });
});

// ============================================================================
// terrainFromRouteType
// ============================================================================

describe('terrainFromRouteType', () => {
  it('maps land', () => expect(terrainFromRouteType('land')).toBe('land'));
  it('maps maritime', () => expect(terrainFromRouteType('maritime')).toBe('maritime'));
  it('maps river', () => expect(terrainFromRouteType('river')).toBe('river'));
  it('defaults to land for unknown', () => expect(terrainFromRouteType('trade')).toBe('land'));
});

// ============================================================================
// splitRouteByTerrain
// ============================================================================

describe('splitRouteByTerrain', () => {
  it('returns empty array for empty coordinates', () => {
    expect(splitRouteByTerrain([])).toEqual([]);
  });

  it('returns single segment for single-terrain route', () => {
    const coords = [[105, 35], [100, 36], [95, 38]];
    const segments = splitRouteByTerrain(coords);
    expect(segments.length).toBe(1);
    expect(segments[0].terrainType).toBe('land');
    expect(segments[0].coordinates.length).toBe(3);
  });

  it('splits at land/sea transitions', () => {
    // Land point then Mediterranean point
    const coords = [[2, 47], [15, 37]];
    const segments = splitRouteByTerrain(coords);
    expect(segments.length).toBe(2);
    // First segment should be land, second maritime
    expect(segments[0].terrainType).toBe('land');
    expect(segments[1].terrainType).toBe('maritime');
  });

  it('preserves overlap points between segments', () => {
    const coords = [[2, 47], [15, 37]];
    const segments = splitRouteByTerrain(coords);
    if (segments.length === 2) {
      // Last coord of first segment should equal first coord of second
      const last = segments[0].coordinates[segments[0].coordinates.length - 1];
      const first = segments[1].coordinates[0];
      expect(last).toEqual(first);
    }
  });

  it('handles single coordinate', () => {
    const segments = splitRouteByTerrain([[105, 35]]);
    expect(segments.length).toBe(1);
    expect(segments[0].coordinates.length).toBe(1);
  });
});

// ============================================================================
// estimateElevation
// ============================================================================

describe('estimateElevation', () => {
  it('returns 0 for ocean points', () => {
    expect(estimateElevation(-40, 30)).toBe(0);
  });

  it('returns high elevation near Himalayas', () => {
    const elev = estimateElevation(86, 28);
    expect(elev).toBeGreaterThan(2000);
  });

  it('returns high elevation near Alps', () => {
    const elev = estimateElevation(10, 46);
    expect(elev).toBeGreaterThan(1000);
  });

  it('returns moderate elevation for flat inland areas', () => {
    // Central Kansas - far from any mountain range
    const elev = estimateElevation(-98, 38);
    expect(elev).toBeGreaterThan(0);
    expect(elev).toBeLessThan(1000);
  });
});

// ============================================================================
// generateElevationProfile
// ============================================================================

describe('generateElevationProfile', () => {
  it('returns empty profile for empty coordinates', () => {
    const profile = generateElevationProfile([]);
    expect(profile.points).toEqual([]);
    expect(profile.totalDistance).toBe(0);
  });

  it('generates profile with correct point count', () => {
    const coords = [[105, 35], [100, 36], [95, 38], [90, 38]];
    const profile = generateElevationProfile(coords);
    expect(profile.points.length).toBe(4);
  });

  it('first point has distance 0', () => {
    const coords = [[105, 35], [100, 36]];
    const profile = generateElevationProfile(coords);
    expect(profile.points[0].distance).toBe(0);
  });

  it('distance increases monotonically', () => {
    const coords = [[105, 35], [100, 36], [95, 38], [90, 38]];
    const profile = generateElevationProfile(coords);
    for (let i = 1; i < profile.points.length; i++) {
      expect(profile.points[i].distance).toBeGreaterThan(profile.points[i - 1].distance);
    }
  });

  it('totalDistance equals last point distance', () => {
    const coords = [[105, 35], [100, 36], [95, 38]];
    const profile = generateElevationProfile(coords);
    expect(profile.totalDistance).toBe(profile.points[profile.points.length - 1].distance);
  });

  it('minElevation <= maxElevation', () => {
    const coords = [[86, 28], [80, 25], [75, 20]];
    const profile = generateElevationProfile(coords);
    expect(profile.minElevation).toBeLessThanOrEqual(profile.maxElevation);
  });

  it('totalAscent and totalDescent are non-negative', () => {
    const coords = [[86, 28], [80, 25], [75, 20]];
    const profile = generateElevationProfile(coords);
    expect(profile.totalAscent).toBeGreaterThanOrEqual(0);
    expect(profile.totalDescent).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// Styling Utilities
// ============================================================================

describe('getTerrainStyle', () => {
  it('returns dashed style for maritime', () => {
    const style = getTerrainStyle('maritime');
    expect(style.dashArray).toBeDefined();
    expect(style.lineCap).toBe('round');
  });

  it('returns no dash for land', () => {
    const style = getTerrainStyle('land');
    expect(style.dashArray).toBeUndefined();
  });

  it('returns dash for river', () => {
    const style = getTerrainStyle('river');
    expect(style.dashArray).toBeDefined();
  });

  it('all styles have valid weight and opacity', () => {
    for (const type of ['land', 'maritime', 'river', 'mixed'] as const) {
      const style = getTerrainStyle(type);
      expect(style.weight).toBeGreaterThan(0);
      expect(style.opacity).toBeGreaterThan(0);
      expect(style.opacity).toBeLessThanOrEqual(1);
    }
  });
});

describe('getTerrainLabel', () => {
  it('returns human-readable labels', () => {
    expect(getTerrainLabel('land')).toBe('Land Route');
    expect(getTerrainLabel('maritime')).toBe('Sea Route');
    expect(getTerrainLabel('river')).toBe('River Route');
    expect(getTerrainLabel('mixed')).toBe('Mixed Route');
  });
});

describe('getTerrainIcon', () => {
  it('returns non-empty strings', () => {
    for (const type of ['land', 'maritime', 'river', 'mixed'] as const) {
      expect(getTerrainIcon(type).length).toBeGreaterThan(0);
    }
  });
});
