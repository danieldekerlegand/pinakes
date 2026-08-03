import { describe, it, expect } from 'vitest';
import {
  detectArSupport,
  selectHistoricalLayers,
  bearingBetween,
  isActiveAtYear,
  type ArEnvironment,
  type GeoFeatureLike,
} from './historical-layers';

// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------

const fullEnv = (supportsAr = true): ArEnvironment => ({
  isSecureContext: true,
  geolocation: { getCurrentPosition: () => {} },
  xr: { isSessionSupported: async (mode: string) => mode === 'immersive-ar' && supportsAr },
});

describe('detectArSupport', () => {
  it('reports full support on a secure WebXR + geolocation device', async () => {
    const s = await detectArSupport(fullEnv(true));
    expect(s.supported).toBe(true);
    expect(s.mode).toBe('ar');
    expect(s.reason).toBe('supported');
    expect(s.hasImmersiveAr).toBe(true);
  });

  it('falls back when WebXR is absent (e.g. desktop browser)', async () => {
    const s = await detectArSupport({ isSecureContext: true, geolocation: { getCurrentPosition: () => {} } });
    expect(s.supported).toBe(false);
    expect(s.mode).toBe('fallback');
    expect(s.reason).toBe('no-webxr');
    expect(s.hasWebXr).toBe(false);
  });

  it('falls back when WebXR exists but immersive-ar is unsupported', async () => {
    const s = await detectArSupport(fullEnv(false));
    expect(s.supported).toBe(false);
    expect(s.hasWebXr).toBe(true);
    expect(s.hasImmersiveAr).toBe(false);
    expect(s.reason).toBe('no-immersive-ar');
  });

  it('falls back on an insecure context and never probes WebXR there', async () => {
    let probed = false;
    const s = await detectArSupport({
      isSecureContext: false,
      geolocation: { getCurrentPosition: () => {} },
      xr: { isSessionSupported: async () => { probed = true; return true; } },
    });
    expect(s.reason).toBe('insecure-context');
    expect(s.supported).toBe(false);
    expect(probed).toBe(false);
  });

  it('falls back (no-geolocation) when geolocation API is missing', async () => {
    const s = await detectArSupport({
      isSecureContext: true,
      xr: { isSessionSupported: async () => true },
    });
    expect(s.reason).toBe('no-geolocation');
    expect(s.supported).toBe(false);
  });

  it('treats a throwing isSessionSupported as no AR (never rejects)', async () => {
    const s = await detectArSupport({
      isSecureContext: true,
      geolocation: { getCurrentPosition: () => {} },
      xr: { isSessionSupported: async () => { throw new Error('unknown mode'); } },
    });
    expect(s.hasImmersiveAr).toBe(false);
    expect(s.reason).toBe('no-immersive-ar');
  });

  it('handles a null/undefined environment gracefully', async () => {
    const s = await detectArSupport(null);
    expect(s.supported).toBe(false);
    expect(s.mode).toBe('fallback');
  });
});

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

describe('bearingBetween', () => {
  it('points north / east / south / west correctly', () => {
    const o = { lat: 0, lng: 0 };
    expect(bearingBetween(o, { lat: 1, lng: 0 })).toBeCloseTo(0, 1);
    expect(bearingBetween(o, { lat: 0, lng: 1 })).toBeCloseTo(90, 1);
    expect(bearingBetween(o, { lat: -1, lng: 0 })).toBeCloseTo(180, 1);
    expect(bearingBetween(o, { lat: 0, lng: -1 })).toBeCloseTo(270, 1);
  });
});

describe('isActiveAtYear', () => {
  const tp = { start: -500, end: 200, label: 'x' };
  it('is inclusive of the boundaries', () => {
    expect(isActiveAtYear(tp, -500)).toBe(true);
    expect(isActiveAtYear(tp, 200)).toBe(true);
  });
  it('excludes years outside the range', () => {
    expect(isActiveAtYear(tp, -501)).toBe(false);
    expect(isActiveAtYear(tp, 201)).toBe(false);
  });
  it('treats null end as "to present" and undefined year as always-active', () => {
    expect(isActiveAtYear({ start: 1000, end: null, label: '' }, 2026)).toBe(true);
    expect(isActiveAtYear(tp, undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Layer selection
// ---------------------------------------------------------------------------

const user = { lat: 40, lng: 10 };

// A point ~feature builder: sites are GeoJSON Points [lng, lat].
const site = (
  id: string,
  lat: number,
  lng: number,
  period: { start: number; end: number | null },
  importance?: number,
): GeoFeatureLike => ({
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: {
    siteId: id,
    name: id.toUpperCase(),
    timePeriod: { ...period, label: `${period.start}` },
    importance,
    sources: ['Author (2020)'],
  },
});

// A civilization polygon around a center.
const civ = (
  id: string,
  lat: number,
  lng: number,
  period: { start: number; end: number | null },
): GeoFeatureLike => ({
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [lng - 0.5, lat - 0.5],
      [lng + 0.5, lat - 0.5],
      [lng + 0.5, lat + 0.5],
      [lng - 0.5, lat + 0.5],
      [lng - 0.5, lat - 0.5],
    ]],
  },
  properties: { civilizationId: id, name: id, timePeriod: { ...period, label: id } },
});

describe('selectHistoricalLayers', () => {
  it('drops features beyond the radius', () => {
    const near = site('near', 40.1, 10.1, { start: 0, end: 500 });
    const far = site('far', 0, 0, { start: 0, end: 500 }); // ~4600 km away
    const layers = selectHistoricalLayers(user, [near, far], { radiusKm: 500 });
    expect(layers.map((l) => l.id)).toEqual(['near']);
  });

  it('computes distance, bearing, center, kind and sources', () => {
    const layers = selectHistoricalLayers(user, [site('s', 41, 10, { start: 0, end: 100 })]);
    expect(layers).toHaveLength(1);
    const l = layers[0];
    expect(l.kind).toBe('site');
    expect(l.center).toEqual({ lat: 41, lng: 10 });
    expect(l.distanceKm).toBeGreaterThan(100);
    expect(l.distanceKm).toBeLessThan(120);
    expect(l.bearingDeg).toBeCloseTo(0, 0); // due north
    expect(l.sources).toEqual(['Author (2020)']);
  });

  it('classifies civilization polygons via centroid', () => {
    const layers = selectHistoricalLayers(user, [civ('rome', 40.2, 10.2, { start: -100, end: 400 })]);
    expect(layers).toHaveLength(1);
    expect(layers[0].kind).toBe('civilization');
    // centroid of the square ring (incl. the closing point) lands near the center
    expect(layers[0].center.lat).toBeCloseTo(40.2, 0);
    expect(layers[0].center.lng).toBeCloseTo(10.2, 0);
  });

  it('filters to the selected era when a year is given', () => {
    const classical = site('classical', 40.1, 10.1, { start: -500, end: 0 });
    const modern = site('modern', 40.1, 10.1, { start: 1500, end: null });
    const layers = selectHistoricalLayers(user, [classical, modern], { year: -200 });
    expect(layers.map((l) => l.id)).toEqual(['classical']);
    expect(layers[0].activeAtYear).toBe(true);
  });

  it('keeps inactive layers (flagged) when onlyActive is false', () => {
    const classical = site('classical', 40.1, 10.1, { start: -500, end: 0 });
    const modern = site('modern', 40.2, 10.2, { start: 1500, end: null });
    const layers = selectHistoricalLayers(user, [classical, modern], { year: -200, onlyActive: false });
    expect(layers).toHaveLength(2);
    // active-at-year sorts first
    expect(layers[0].id).toBe('classical');
    expect(layers[0].activeAtYear).toBe(true);
    expect(layers[1].activeAtYear).toBe(false);
  });

  it('sorts active-first, then nearest, then by importance', () => {
    const a = site('a', 40.3, 10.0, { start: 0, end: 100 }, 10); // farther
    const b = site('b', 40.1, 10.0, { start: 0, end: 100 }, 10); // nearest
    const c = site('c', 40.1, 10.0, { start: 0, end: 100 }, 90); // same dist as b, higher importance
    const layers = selectHistoricalLayers(user, [a, b, c], { year: 50 });
    expect(layers[0].id).toBe('c'); // nearest tie broken by importance
    expect(layers[1].id).toBe('b');
    expect(layers[2].id).toBe('a');
  });

  it('caps the result to maxLayers', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      site(`s${i}`, 40 + i * 0.001, 10, { start: 0, end: 100 }));
    const layers = selectHistoricalLayers(user, many, { maxLayers: 5 });
    expect(layers).toHaveLength(5);
  });

  it('returns [] for empty/invalid input', () => {
    expect(selectHistoricalLayers(user, null)).toEqual([]);
    expect(selectHistoricalLayers(user, [])).toEqual([]);
    expect(selectHistoricalLayers({ lat: NaN, lng: 10 }, [site('s', 40, 10, { start: 0, end: 1 })])).toEqual([]);
  });

  it('skips features with no usable geometry', () => {
    const bad: GeoFeatureLike = { geometry: null, properties: { siteId: 'x' } };
    const good = site('ok', 40.1, 10.1, { start: 0, end: 100 });
    const layers = selectHistoricalLayers(user, [bad, good]);
    expect(layers.map((l) => l.id)).toEqual(['ok']);
  });
});
