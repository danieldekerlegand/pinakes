import { describe, it, expect } from 'vitest';
import type { Feature } from 'geojson';
import {
  featureBounds,
  boundsOverlap,
  cullToViewport,
  bboxToParam,
  viewportParams,
} from './map-performance';
import type { BoundingBox } from './geospatial-types';

const VIEWPORT: BoundingBox = { west: 0, south: 0, east: 10, north: 10 };

const point = (lng: number, lat: number): Feature => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'Point', coordinates: [lng, lat] },
});

describe('featureBounds', () => {
  it('bounds a point', () => {
    expect(featureBounds(point(3, 4))).toEqual({ west: 3, south: 4, east: 3, north: 4 });
  });
});

describe('boundsOverlap', () => {
  it('detects overlap and disjoint', () => {
    expect(boundsOverlap(VIEWPORT, { west: 5, south: 5, east: 15, north: 15 })).toBe(true);
    expect(boundsOverlap(VIEWPORT, { west: 20, south: 20, east: 30, north: 30 })).toBe(false);
  });
});

describe('cullToViewport', () => {
  it('keeps only intersecting features', () => {
    const kept = cullToViewport([point(5, 5), point(50, 50)], VIEWPORT);
    expect(kept).toHaveLength(1);
  });
});

describe('bboxToParam', () => {
  it('serializes to west,south,east,north', () => {
    expect(bboxToParam(VIEWPORT)).toBe('0,0,10,10');
  });

  it('rounds to 5 decimal places for stable cache keys', () => {
    expect(bboxToParam({ west: 1.234567, south: -2.7654321, east: 3, north: 4 })).toBe(
      '1.23457,-2.76543,3,4',
    );
  });
});

describe('viewportParams', () => {
  it('returns an empty object when the viewport is unknown', () => {
    expect(viewportParams(null)).toEqual({});
    expect(viewportParams(null, 5, 100)).toEqual({});
  });

  it('emits a bbox param from the viewport', () => {
    expect(viewportParams(VIEWPORT)).toEqual({ bbox: '0,0,10,10' });
  });

  it('includes rounded zoom and limit when provided', () => {
    expect(viewportParams(VIEWPORT, 6.7, 500)).toEqual({
      bbox: '0,0,10,10',
      zoom: '7',
      limit: '500',
    });
  });

  it('omits non-finite / non-positive zoom and limit', () => {
    expect(viewportParams(VIEWPORT, NaN, 0)).toEqual({ bbox: '0,0,10,10' });
    expect(viewportParams(VIEWPORT, undefined, -5)).toEqual({ bbox: '0,0,10,10' });
  });

  it('produces identical params for identical viewports (cache-key stability)', () => {
    const a = viewportParams({ west: 0.1, south: 0.2, east: 0.3, north: 0.4 }, 5);
    const b = viewportParams({ west: 0.1, south: 0.2, east: 0.3, north: 0.4 }, 5);
    expect(a).toEqual(b);
  });
});
