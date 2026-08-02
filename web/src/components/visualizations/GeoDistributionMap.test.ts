import { describe, it, expect } from 'vitest';
import { computeCenter, computeBounds } from './geo-distribution-utils';
import type { GeoDataPoint, MarkerStyle, LegendItem } from './geo-distribution-utils';

describe('computeCenter', () => {
  it('returns default center [20, 0] for empty array', () => {
    expect(computeCenter([])).toEqual([20, 0]);
  });

  it('returns the point itself for a single point', () => {
    const points: GeoDataPoint[] = [{ lat: 48.8566, lng: 2.3522 }];
    expect(computeCenter(points)).toEqual([48.8566, 2.3522]);
  });

  it('computes average of multiple points', () => {
    const points: GeoDataPoint[] = [
      { lat: 0, lng: 0 },
      { lat: 10, lng: 20 },
      { lat: 20, lng: 40 },
    ];
    const [lat, lng] = computeCenter(points);
    expect(lat).toBeCloseTo(10);
    expect(lng).toBeCloseTo(20);
  });

  it('handles negative coordinates (southern/western hemispheres)', () => {
    const points: GeoDataPoint[] = [
      { lat: -33.8688, lng: 151.2093 }, // Sydney
      { lat: -22.9068, lng: -43.1729 }, // Rio
    ];
    const [lat, lng] = computeCenter(points);
    expect(lat).toBeCloseTo(-28.3878);
    expect(lng).toBeCloseTo(54.0182);
  });
});

describe('computeBounds', () => {
  it('returns empty array for empty input', () => {
    expect(computeBounds([])).toEqual([]);
  });

  it('converts points to [lat, lng] tuples', () => {
    const points: GeoDataPoint[] = [
      { lat: 51.5074, lng: -0.1278 },
      { lat: 48.8566, lng: 2.3522 },
    ];
    expect(computeBounds(points)).toEqual([
      [51.5074, -0.1278],
      [48.8566, 2.3522],
    ]);
  });

  it('preserves order of points', () => {
    const points: GeoDataPoint[] = [
      { lat: 10, lng: 20 },
      { lat: 30, lng: 40 },
      { lat: 50, lng: 60 },
    ];
    const bounds = computeBounds(points);
    expect(bounds[0]).toEqual([10, 20]);
    expect(bounds[1]).toEqual([30, 40]);
    expect(bounds[2]).toEqual([50, 60]);
  });
});

describe('GeoDistributionMap type contracts', () => {
  it('GeoDataPoint has lat and lng', () => {
    const point: GeoDataPoint = { lat: 40.7128, lng: -74.006 };
    expect(point.lat).toBe(40.7128);
    expect(point.lng).toBe(-74.006);
  });

  it('MarkerStyle has all required fields', () => {
    const style: MarkerStyle = {
      fillColor: '#3b82f6',
      fillOpacity: 0.7,
      color: '#ffffff',
      weight: 2,
      radius: 8,
    };
    expect(style.fillColor).toBe('#3b82f6');
    expect(style.radius).toBe(8);
  });

  it('LegendItem has label and color', () => {
    const item: LegendItem = { label: 'Active', color: '#10b981' };
    expect(item.label).toBe('Active');
    expect(item.color).toBe('#10b981');
  });
});

// Helper function tests - testing common patterns users would use with the component
describe('common marker style patterns', () => {
  // Replicate a typical getMarkerStyle function to verify the pattern works
  function getMarkerStyleBySize(
    value: number,
    isSelected: boolean
  ): MarkerStyle {
    const baseRadius = value > 1_000_000 ? 12 : value > 100_000 ? 9 : 6;
    return {
      fillColor: isSelected ? '#3b82f6' : '#10b981',
      fillOpacity: isSelected ? 0.9 : 0.7,
      color: isSelected ? '#1d4ed8' : '#ffffff',
      weight: isSelected ? 3 : 2,
      radius: isSelected ? baseRadius * 1.5 : baseRadius,
    };
  }

  it('returns larger radius for large values', () => {
    const style = getMarkerStyleBySize(5_000_000, false);
    expect(style.radius).toBe(12);
  });

  it('returns medium radius for medium values', () => {
    const style = getMarkerStyleBySize(500_000, false);
    expect(style.radius).toBe(9);
  });

  it('returns small radius for small values', () => {
    const style = getMarkerStyleBySize(1_000, false);
    expect(style.radius).toBe(6);
  });

  it('applies selection styling when selected', () => {
    const style = getMarkerStyleBySize(1_000, true);
    expect(style.fillColor).toBe('#3b82f6');
    expect(style.fillOpacity).toBe(0.9);
    expect(style.weight).toBe(3);
    expect(style.radius).toBe(9); // 6 * 1.5
  });

  it('applies default styling when not selected', () => {
    const style = getMarkerStyleBySize(1_000, false);
    expect(style.fillColor).toBe('#10b981');
    expect(style.fillOpacity).toBe(0.7);
    expect(style.weight).toBe(2);
  });
});
