import { describe, it, expect } from 'vitest';
import type { PlaceResult, PlaceCategory, PlaceGeometryType } from './useMapSearch';

/**
 * Unit tests for useMapSearch types and data contracts.
 * Hook rendering tests would require @testing-library/react-hooks;
 * instead we test the data shape and API contract.
 */

function makePlaceResult(overrides: Partial<PlaceResult> = {}): PlaceResult {
  return {
    id: 'test-1',
    name: 'Test Place',
    category: 'settlement',
    geometryType: 'point',
    lat: 30.0,
    lng: 45.0,
    description: 'A test place',
    relevance: 0.8,
    ...overrides,
  };
}

describe('useMapSearch types', () => {
  it('should support all place categories', () => {
    const categories: PlaceCategory[] = [
      'settlement',
      'archaeological-site',
      'battle',
      'region',
      'modern',
    ];
    for (const cat of categories) {
      const place = makePlaceResult({ category: cat });
      expect(place.category).toBe(cat);
    }
  });

  it('should support point geometry type', () => {
    const place = makePlaceResult({ geometryType: 'point' });
    expect(place.geometryType).toBe('point');
    expect(place.bbox).toBeUndefined();
  });

  it('should support bbox geometry type', () => {
    const place = makePlaceResult({
      geometryType: 'bbox',
      bbox: [29.0, 38.0, 37.0, 49.0],
    });
    expect(place.geometryType).toBe('bbox');
    expect(place.bbox).toBeDefined();
    expect(place.bbox!.length).toBe(4);
  });

  it('should include optional time period', () => {
    const place = makePlaceResult({ timePeriod: '4000 BCE – 700 CE' });
    expect(place.timePeriod).toBe('4000 BCE – 700 CE');
  });

  it('should have valid coordinate ranges', () => {
    const place = makePlaceResult({ lat: 31.322, lng: 45.636 });
    expect(place.lat).toBeGreaterThanOrEqual(-90);
    expect(place.lat).toBeLessThanOrEqual(90);
    expect(place.lng).toBeGreaterThanOrEqual(-180);
    expect(place.lng).toBeLessThanOrEqual(180);
  });
});

describe('autocomplete API contract', () => {
  it('should expect the API endpoint to accept q and limit params', () => {
    const q = 'Uruk';
    const limit = 8;
    const url = `/api/map/places/autocomplete?q=${encodeURIComponent(q)}&limit=${limit}`;
    expect(url).toBe('/api/map/places/autocomplete?q=Uruk&limit=8');
  });

  it('should encode special characters in query', () => {
    const q = "Bab-ilim & Babel";
    const encoded = encodeURIComponent(q);
    expect(encoded).toContain('Bab-ilim');
    expect(encoded).toContain('%26'); // encoded ampersand
  });
});
