/**
 * Utilities for extruded 3D region visualization.
 *
 * Converts GeoJSON polygons into isometric 3D projections where height
 * encodes a metric (population, military strength, trade volume, etc.).
 * The result is a "bar chart on the map" effect.
 */

export type ExtrusionMetric =
  | 'population'
  | 'territory'
  | 'military'
  | 'trade'
  | 'speakers';

export const METRIC_LABELS: Record<ExtrusionMetric, string> = {
  population: 'Population Estimate',
  territory: 'Territorial Area (km²)',
  military: 'Military Strength',
  trade: 'Trade Volume',
  speakers: 'Number of Speakers',
};

export interface ExtrudedRegion {
  id: string;
  name: string;
  color: string;
  /** Centroid [lng, lat] of the polygon */
  centroid: [number, number];
  /** Projected polygon points in pixel coordinates */
  basePolygon: [number, number][];
  /** Metric value used for height */
  metricValue: number;
  /** Normalized height (0-1) relative to max in dataset */
  normalizedHeight: number;
  /** The computed pixel height for extrusion */
  extrusionHeight: number;
  /** Top polygon (base shifted up by extrusionHeight) */
  topPolygon: [number, number][];
  /** Side faces connecting base to top (for 3D effect) */
  sideFaces: SideFace[];
  /** Additional metadata */
  metadata: Record<string, string | number | undefined>;
}

export interface SideFace {
  /** Four corners: [bottomLeft, bottomRight, topRight, topLeft] */
  points: [number, number][];
  /** Whether this face is "lit" (facing the light source) */
  isLit: boolean;
}

export interface ProjectionConfig {
  /** Canvas width */
  width: number;
  /** Canvas height */
  height: number;
  /** Center longitude */
  centerLng: number;
  /** Center latitude */
  centerLat: number;
  /** Zoom scale (pixels per degree) */
  scale: number;
  /** Isometric tilt angle in degrees (0 = top-down, 45 = max tilt) */
  tiltAngle: number;
  /** Maximum extrusion height in pixels */
  maxExtrusionHeight: number;
}

/**
 * Convert [lng, lat] to isometric pixel coordinates.
 */
export function projectToIsometric(
  lng: number,
  lat: number,
  config: ProjectionConfig,
): [number, number] {
  const { width, height, centerLng, centerLat, scale, tiltAngle } = config;
  const tiltRad = (tiltAngle * Math.PI) / 180;
  const cosT = Math.cos(tiltRad);

  // Mercator-like projection
  const x = (lng - centerLng) * scale + width / 2;
  const yFlat = -(lat - centerLat) * scale + height / 2;
  // Apply tilt: compress Y axis to simulate looking at an angle
  const y = yFlat * cosT;

  return [x, y];
}

/**
 * Shift a polygon upward by a given pixel height (extrusion).
 */
export function extrudePolygon(
  polygon: [number, number][],
  height: number,
): [number, number][] {
  return polygon.map(([x, y]) => [x, y - height]);
}

/**
 * Compute centroid of a GeoJSON coordinate ring.
 */
export function computeCentroid(
  coordinates: number[][],
): [number, number] {
  if (coordinates.length === 0) return [0, 0];
  let sumLng = 0;
  let sumLat = 0;
  for (const [lng, lat] of coordinates) {
    sumLng += lng;
    sumLat += lat;
  }
  return [sumLng / coordinates.length, sumLat / coordinates.length];
}

/**
 * Generate side faces for the extrusion by connecting base and top polygons.
 * Only generates faces for edges that would be visible from the viewer's perspective.
 */
export function generateSideFaces(
  basePolygon: [number, number][],
  topPolygon: [number, number][],
): SideFace[] {
  const faces: SideFace[] = [];
  const n = basePolygon.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const bl = basePolygon[i];
    const br = basePolygon[j];
    const tr = topPolygon[j];
    const tl = topPolygon[i];

    // Determine if face is "lit" based on edge normal direction
    // Edge pointing right → face is lit (facing light from top-left)
    const edgeDx = br[0] - bl[0];
    const isLit = edgeDx > 0;

    faces.push({
      points: [bl, br, tr, tl],
      isLit,
    });
  }

  return faces;
}

/**
 * Simplify a polygon by keeping every nth point, preserving shape.
 */
export function simplifyPolygon(
  points: number[][],
  maxPoints: number,
): number[][] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const result: number[][] = [];
  for (let i = 0; i < points.length; i += step) {
    result.push(points[i]);
  }
  // Ensure the ring is closed
  if (
    result.length > 1 &&
    (result[0][0] !== result[result.length - 1][0] ||
      result[0][1] !== result[result.length - 1][1])
  ) {
    result.push(result[0]);
  }
  return result;
}

export interface RegionInput {
  id: string;
  name: string;
  color: string;
  coordinates: number[][][]; // GeoJSON polygon coordinates (array of rings)
  metrics: Partial<Record<ExtrusionMetric, number>>;
  metadata?: Record<string, string | number | undefined>;
}

/**
 * Transform region inputs into extruded 3D regions ready for rendering.
 */
export function buildExtrudedRegions(
  regions: RegionInput[],
  metric: ExtrusionMetric,
  config: ProjectionConfig,
): ExtrudedRegion[] {
  // Extract metric values and find max for normalization
  const values = regions.map((r) => r.metrics[metric] ?? 0);
  const maxValue = Math.max(...values, 1); // Avoid division by zero

  return regions
    .map((region, idx) => {
      const outerRing = region.coordinates[0];
      if (!outerRing || outerRing.length < 3) return null;

      const simplified = simplifyPolygon(outerRing, 40);
      const centroid = computeCentroid(simplified);

      const basePolygon = simplified.map(([lng, lat]) =>
        projectToIsometric(lng, lat, config),
      ) as [number, number][];

      const metricValue = values[idx];
      const normalizedHeight = metricValue / maxValue;
      const extrusionHeight = normalizedHeight * config.maxExtrusionHeight;

      const topPolygon = extrudePolygon(basePolygon, extrusionHeight);
      const sideFaces = generateSideFaces(basePolygon, topPolygon);

      return {
        id: region.id,
        name: region.name,
        color: region.color,
        centroid: centroid as [number, number],
        basePolygon,
        metricValue,
        normalizedHeight,
        extrusionHeight,
        topPolygon,
        sideFaces,
        metadata: region.metadata ?? {},
      } satisfies ExtrudedRegion;
    })
    .filter((r): r is ExtrudedRegion => r !== null)
    // Sort by centroid latitude (back to front) so nearer regions paint over farther ones
    .sort((a, b) => a.centroid[1] - b.centroid[1]);
}

/**
 * Darken a hex color by a factor (0 = black, 1 = original).
 */
export function darkenColor(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
}

/**
 * Add alpha to a hex color.
 */
export function hexWithAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Interpolate between two values for smooth animation.
 */
export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * Math.max(0, Math.min(1, t));
}

/**
 * Format large numbers for display (e.g., 45000000 → "45M").
 */
export function formatMetricValue(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}
