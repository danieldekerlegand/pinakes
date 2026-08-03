/**
 * Utility functions for converting map layer data into heatmap density points.
 *
 * Each converter extracts [lat, lng, intensity] tuples from a specific data
 * source so the generic DensityHeatmapLayer can visualise point density for
 * any combination of active layers.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** A single point fed into leaflet.heat */
export interface HeatPoint {
  lat: number;
  lng: number;
  intensity: number; // 0-1
}

/** Which data source a heatmap should draw from */
export type DensitySource =
  | 'languages'
  | 'archaeological-sites'
  | 'settlements'
  | 'cuisines'
  | 'music'
  | 'religions'
  | 'battles';

/** Predefined colour gradients keyed by visual purpose */
export const DENSITY_GRADIENTS: Record<string, Record<number, string>> = {
  thermal: { 0.0: '#0000ff', 0.25: '#00ffff', 0.5: '#00ff00', 0.75: '#ffff00', 1.0: '#ff0000' },
  cool: { 0.0: '#f0f9ff', 0.4: '#3b82f6', 0.7: '#1e40af', 1.0: '#1e3a5f' },
  warm: { 0.0: '#fffbeb', 0.4: '#f59e0b', 0.7: '#dc2626', 1.0: '#7f1d1d' },
  viridis: { 0.0: '#440154', 0.25: '#31688e', 0.5: '#35b779', 0.75: '#90d743', 1.0: '#fde725' },
  monochrome: { 0.0: 'rgba(0,0,0,0)', 0.5: 'rgba(59,130,246,0.5)', 1.0: 'rgba(59,130,246,1)' },
};

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

/** Clamp a number to the 0-1 range */
export function clampIntensity(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Normalise an array of raw values to the 0-1 range (min-max scaling).
 * Returns 0.5 for every entry if all values are identical.
 */
export function normaliseValues(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

// ---------------------------------------------------------------------------
// Data-source converters
// ---------------------------------------------------------------------------

export interface PointWithCoords {
  lat: number;
  lng: number;
}

/**
 * Extract centroid from a GeoJSON geometry.
 * Supports Point, Polygon, and MultiPolygon.
 */
export function centroidFromGeometry(
  geometry: { type: string; coordinates: any },
): { lat: number; lng: number } | null {
  if (!geometry || !geometry.coordinates) return null;

  switch (geometry.type) {
    case 'Point': {
      const [lng, lat] = geometry.coordinates as [number, number];
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng };
    }
    case 'Polygon': {
      const ring = (geometry.coordinates as number[][][])[0];
      if (!ring || ring.length === 0) return null;
      let sumLat = 0;
      let sumLng = 0;
      for (const [lng, lat] of ring) {
        sumLat += lat;
        sumLng += lng;
      }
      return { lat: sumLat / ring.length, lng: sumLng / ring.length };
    }
    case 'MultiPolygon': {
      const polys = geometry.coordinates as number[][][][];
      let sumLat = 0;
      let sumLng = 0;
      let count = 0;
      for (const poly of polys) {
        const ring = poly[0];
        if (!ring) continue;
        for (const [lng, lat] of ring) {
          sumLat += lat;
          sumLng += lng;
          count++;
        }
      }
      if (count === 0) return null;
      return { lat: sumLat / count, lng: sumLng / count };
    }
    default:
      return null;
  }
}

/**
 * Convert an array of GeoJSON features (with any geometry type) into
 * density heat-points. An optional `intensityFn` derives each point's
 * intensity from its properties; defaults to uniform (1).
 */
export function featuresToHeatPoints<P extends Record<string, any>>(
  features: Array<{ geometry: { type: string; coordinates: any }; properties: P }>,
  intensityFn?: (props: P) => number,
): HeatPoint[] {
  const raw: Array<{ lat: number; lng: number; rawIntensity: number }> = [];
  for (const f of features) {
    const c = centroidFromGeometry(f.geometry);
    if (!c) continue;
    const rawIntensity = intensityFn ? intensityFn(f.properties) : 1;
    raw.push({ ...c, rawIntensity });
  }
  if (raw.length === 0) return [];

  const normalised = normaliseValues(raw.map((r) => r.rawIntensity));
  return raw.map((r, i) => ({
    lat: r.lat,
    lng: r.lng,
    intensity: clampIntensity(normalised[i]),
  }));
}

/**
 * Convert simple coordinate-bearing objects into density heat-points.
 * Works with any data that has `lat`/`lng` (or `latitude`/`longitude`)
 * and an optional numeric field for intensity weighting.
 */
export function coordsToHeatPoints(
  items: Array<Record<string, any>>,
  intensityField?: string,
): HeatPoint[] {
  const raw: Array<{ lat: number; lng: number; rawIntensity: number }> = [];

  for (const item of items) {
    const lat = item.lat ?? item.latitude ?? item.coordinates?.lat;
    const lng = item.lng ?? item.longitude ?? item.coordinates?.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const rawIntensity = intensityField && typeof item[intensityField] === 'number'
      ? item[intensityField]
      : 1;
    raw.push({ lat, lng, rawIntensity });
  }

  if (raw.length === 0) return [];
  const normalised = normaliseValues(raw.map((r) => r.rawIntensity));
  return raw.map((r, i) => ({
    lat: r.lat,
    lng: r.lng,
    intensity: clampIntensity(normalised[i]),
  }));
}

/**
 * Merge multiple heat-point arrays into a single set.
 * Points at the same location are not deduplicated — overlapping sources
 * naturally increase density in the heatmap rendering.
 */
export function mergeHeatPoints(...arrays: HeatPoint[][]): HeatPoint[] {
  return arrays.flat();
}
