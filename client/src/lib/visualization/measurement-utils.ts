/**
 * Measurement utilities for distance calculation, area computation,
 * and isochrone generation based on historical travel speeds.
 */

import * as turf from '@turf/turf';
import type { Position } from 'geojson';

// ============================================================================
// Types
// ============================================================================

export type DistanceUnit = 'km' | 'miles';

export type TravelMode = 'walking' | 'horseback' | 'ship';

export interface SegmentMeasurement {
  from: Position;
  to: Position;
  distance: number; // in current unit
}

export interface DistanceResult {
  segments: SegmentMeasurement[];
  totalDistance: number;
  unit: DistanceUnit;
}

export interface AreaResult {
  area: number; // square kilometers
  areaAcres: number;
  areaSqMiles: number;
  perimeter: number; // kilometers
}

export interface IsochroneRing {
  hours: number;
  radiusKm: number;
  polygon: GeoJSON.Feature<GeoJSON.Polygon>;
}

export interface IsochroneResult {
  center: Position;
  travelMode: TravelMode;
  rings: IsochroneRing[];
}

// ============================================================================
// Constants — Historical Travel Speeds
// ============================================================================

/** Average speeds in km/h for historical travel modes */
export const TRAVEL_SPEEDS: Record<TravelMode, number> = {
  walking: 5, // ~5 km/h on foot
  horseback: 12, // ~12 km/h sustained horseback
  ship: 8, // ~8 km/h ancient sailing vessel
};

export const TRAVEL_MODE_LABELS: Record<TravelMode, string> = {
  walking: 'On Foot (~5 km/h)',
  horseback: 'Horseback (~12 km/h)',
  ship: 'Sailing Vessel (~8 km/h)',
};

// ============================================================================
// Distance Measurement
// ============================================================================

/**
 * Calculate the geodesic distance between two points.
 */
export function pointToPointDistance(
  from: Position,
  to: Position,
  unit: DistanceUnit = 'km'
): number {
  const turfUnit = unit === 'km' ? 'kilometers' : 'miles';
  return turf.distance(turf.point(from), turf.point(to), { units: turfUnit });
}

/**
 * Calculate total distance along a polyline (sequence of points).
 */
export function polylineDistance(
  points: Position[],
  unit: DistanceUnit = 'km'
): DistanceResult {
  if (points.length < 2) {
    return { segments: [], totalDistance: 0, unit };
  }

  const segments: SegmentMeasurement[] = [];
  let totalDistance = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const dist = pointToPointDistance(points[i], points[i + 1], unit);
    segments.push({ from: points[i], to: points[i + 1], distance: dist });
    totalDistance += dist;
  }

  return { segments, totalDistance, unit };
}

// ============================================================================
// Area Calculation
// ============================================================================

/**
 * Calculate the area and perimeter of a polygon defined by vertices.
 * Vertices should be [lng, lat] positions. The ring is auto-closed.
 */
export function calculateArea(vertices: Position[]): AreaResult {
  if (vertices.length < 3) {
    return { area: 0, areaAcres: 0, areaSqMiles: 0, perimeter: 0 };
  }

  // Close the ring
  const ring = [...vertices, vertices[0]];
  const polygon = turf.polygon([ring]);

  const areaSqMeters = turf.area(polygon);
  const areaSqKm = areaSqMeters / 1_000_000;
  const areaSqMiles = areaSqKm * 0.386102;
  const areaAcres = areaSqMiles * 640;

  const perimeterLine = turf.lineString(ring);
  const perimeter = turf.length(perimeterLine, { units: 'kilometers' });

  return { area: areaSqKm, areaAcres, areaSqMiles, perimeter };
}

// ============================================================================
// Isochrone Generation
// ============================================================================

/** Default isochrone time intervals in hours */
const DEFAULT_HOURS = [1, 4, 8, 24, 72];

/**
 * Generate isochrone rings showing travel distance from a center point
 * based on historical travel mode speeds.
 *
 * Creates concentric circle approximations (64-sided polygons) for each time step.
 */
export function generateIsochrones(
  center: Position,
  travelMode: TravelMode,
  hours: number[] = DEFAULT_HOURS
): IsochroneResult {
  const speed = TRAVEL_SPEEDS[travelMode];
  const sortedHours = [...hours].sort((a, b) => a - b);

  const rings: IsochroneRing[] = sortedHours.map((h) => {
    const radiusKm = speed * h;
    const circle = turf.circle(turf.point(center), radiusKm, {
      steps: 64,
      units: 'kilometers',
    });
    return { hours: h, radiusKm, polygon: circle };
  });

  return { center, travelMode, rings };
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Format a distance value with appropriate precision.
 */
export function formatDistance(value: number, unit: DistanceUnit): string {
  if (value < 1) {
    const subUnit = unit === 'km' ? 'm' : 'ft';
    const converted = unit === 'km' ? value * 1000 : value * 5280;
    return `${Math.round(converted)} ${subUnit}`;
  }
  if (value < 100) {
    return `${value.toFixed(1)} ${unit}`;
  }
  return `${Math.round(value).toLocaleString()} ${unit}`;
}

/**
 * Format an area value with appropriate precision.
 */
export function formatArea(sqKm: number): string {
  if (sqKm < 1) {
    return `${(sqKm * 1_000_000).toFixed(0)} m²`;
  }
  if (sqKm < 100) {
    return `${sqKm.toFixed(2)} km²`;
  }
  return `${Math.round(sqKm).toLocaleString()} km²`;
}

/**
 * Format hours into a human-readable travel time string.
 */
export function formatTravelTime(hours: number): string {
  if (hours < 1) {
    return `${Math.round(hours * 60)} min`;
  }
  if (hours < 24) {
    return `${hours} hr`;
  }
  const days = hours / 24;
  if (Number.isInteger(days)) {
    return `${days} day${days > 1 ? 's' : ''}`;
  }
  return `${days.toFixed(1)} days`;
}
