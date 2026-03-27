/**
 * Temporal Boundary Morphing
 *
 * Provides smooth interpolation of polygon geometries between temporal snapshots,
 * enabling animated transitions as the time slider moves.
 */

import type { Position } from 'geojson';
import type { CivilizationFeature } from './geospatial-types';

// ============================================================================
// Types
// ============================================================================

export interface TemporalSnapshot {
  year: number;
  feature: CivilizationFeature;
}

export interface BracketingSnapshots {
  before: TemporalSnapshot;
  after: TemporalSnapshot;
  progress: number; // 0-1 interpolation factor
}

export interface MorphedBoundary {
  coordinates: Position[][];
  civilizationId: string;
  progress: number;
  properties: CivilizationFeature['properties'];
}

export interface EmpireSettlementOverlay {
  settlementId: string;
  name: string;
  position: [number, number]; // [lng, lat]
  empireId: string;
  empireColor: string;
  isCapital: boolean;
  type: string;
}

export interface EmpireLabelInfo {
  empireId: string;
  name: string;
  centroid: [number, number]; // [lng, lat]
  color: string;
}

export interface MigrationParticle {
  id: string;
  position: [number, number]; // [lng, lat]
  routeProgress: number; // 0-1 along route
  color: string;
  size: number;
}

// ============================================================================
// Snapshot Grouping
// ============================================================================

/**
 * Group civilization features by civilizationId, sorted by time period start
 */
export function groupSnapshotsByCivilization(
  features: CivilizationFeature[]
): Map<string, TemporalSnapshot[]> {
  const groups = new Map<string, TemporalSnapshot[]>();

  for (const feature of features) {
    const civId = feature.properties.civilizationId;
    const year = feature.properties.timePeriod.start;

    if (!groups.has(civId)) {
      groups.set(civId, []);
    }
    groups.get(civId)!.push({ year, feature });
  }

  // Sort each group by year
  for (const [, snapshots] of groups) {
    snapshots.sort((a, b) => a.year - b.year);
  }

  return groups;
}

// ============================================================================
// Bracketing / Interpolation Progress
// ============================================================================

/**
 * Find the two snapshots that bracket the current year for a civilization.
 * Returns null if the year is outside all snapshot ranges.
 */
export function findBracketingSnapshots(
  snapshots: TemporalSnapshot[],
  currentYear: number
): BracketingSnapshots | null {
  if (snapshots.length === 0) return null;

  // Before first snapshot
  if (currentYear <= snapshots[0].year) {
    return {
      before: snapshots[0],
      after: snapshots[0],
      progress: 0,
    };
  }

  // After last snapshot
  const last = snapshots[snapshots.length - 1];
  if (currentYear >= last.year) {
    return {
      before: last,
      after: last,
      progress: 1,
    };
  }

  // Find bracketing pair
  for (let i = 0; i < snapshots.length - 1; i++) {
    const before = snapshots[i];
    const after = snapshots[i + 1];

    if (currentYear >= before.year && currentYear <= after.year) {
      const range = after.year - before.year;
      const progress = range > 0 ? (currentYear - before.year) / range : 0;
      return { before, after, progress };
    }
  }

  return null;
}

// ============================================================================
// Polygon Coordinate Interpolation
// ============================================================================

/**
 * Resample a ring (array of positions) to have exactly `targetCount` points.
 * Uses linear interpolation along the perimeter.
 */
export function resampleRing(ring: Position[], targetCount: number): Position[] {
  if (ring.length === 0) return [];
  if (ring.length === 1) return Array(targetCount).fill(ring[0]);
  if (targetCount <= 1) return [ring[0]];

  // Calculate cumulative distances
  const distances: number[] = [0];
  for (let i = 1; i < ring.length; i++) {
    const dx = ring[i][0] - ring[i - 1][0];
    const dy = ring[i][1] - ring[i - 1][1];
    distances.push(distances[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const totalLength = distances[distances.length - 1];

  if (totalLength === 0) {
    return Array(targetCount).fill(ring[0]);
  }

  const result: Position[] = [];
  for (let i = 0; i < targetCount; i++) {
    const targetDist = (i / (targetCount - 1)) * totalLength;

    // Find segment containing this distance
    let segIdx = 0;
    while (segIdx < distances.length - 1 && distances[segIdx + 1] < targetDist) {
      segIdx++;
    }

    if (segIdx >= ring.length - 1) {
      result.push([...ring[ring.length - 1]]);
      continue;
    }

    const segLen = distances[segIdx + 1] - distances[segIdx];
    const t = segLen > 0 ? (targetDist - distances[segIdx]) / segLen : 0;

    result.push([
      ring[segIdx][0] + t * (ring[segIdx + 1][0] - ring[segIdx][0]),
      ring[segIdx][1] + t * (ring[segIdx + 1][1] - ring[segIdx][1]),
    ]);
  }

  return result;
}

/**
 * Interpolate between two positions
 */
export function lerpPosition(a: Position, b: Position, t: number): Position {
  return [
    a[0] + t * (b[0] - a[0]),
    a[1] + t * (b[1] - a[1]),
  ];
}

/**
 * Apply easing function (ease-in-out cubic) for smoother transitions
 */
export function easeInOutCubic(t: number): number {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Interpolate between two polygon rings.
 * Resamples both rings to the same point count, then interpolates each point.
 */
export function interpolateRings(
  ringA: Position[],
  ringB: Position[],
  t: number
): Position[] {
  const easedT = easeInOutCubic(t);
  const targetCount = Math.max(ringA.length, ringB.length, 4);

  const resampledA = resampleRing(ringA, targetCount);
  const resampledB = resampleRing(ringB, targetCount);

  return resampledA.map((posA, i) => lerpPosition(posA, resampledB[i], easedT));
}

/**
 * Interpolate between two polygon coordinate arrays (outer ring + holes).
 * Only interpolates the outer ring; holes are taken from whichever side is closer.
 */
export function interpolatePolygonCoordinates(
  coordsA: Position[][],
  coordsB: Position[][],
  t: number
): Position[][] {
  const outerA = coordsA[0] || [];
  const outerB = coordsB[0] || [];

  const interpolatedOuter = interpolateRings(outerA, outerB, t);

  // For holes, use the closer snapshot's holes
  const holes = t < 0.5 ? coordsA.slice(1) : coordsB.slice(1);

  return [interpolatedOuter, ...holes];
}

// ============================================================================
// Morphed Boundary Generation
// ============================================================================

/**
 * Extract polygon coordinates from a CivilizationFeature.
 * Handles both Polygon and MultiPolygon (uses first polygon of MultiPolygon).
 */
export function extractPolygonCoordinates(feature: CivilizationFeature): Position[][] {
  const geom = feature.geometry;
  if (geom.type === 'Polygon') {
    return geom.coordinates;
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates[0] || [[]];
  }
  return [[]];
}

/**
 * Generate morphed boundaries for all civilizations at a given year.
 */
export function generateMorphedBoundaries(
  snapshotGroups: Map<string, TemporalSnapshot[]>,
  currentYear: number
): MorphedBoundary[] {
  const results: MorphedBoundary[] = [];

  for (const [civId, snapshots] of snapshotGroups) {
    const bracketing = findBracketingSnapshots(snapshots, currentYear);
    if (!bracketing) continue;

    // Check if this civilization is active at the current year
    const firstSnapshot = snapshots[0];
    const lastSnapshot = snapshots[snapshots.length - 1];
    const startYear = firstSnapshot.feature.properties.timePeriod.start;
    const endYear = lastSnapshot.feature.properties.timePeriod.end ?? Infinity;

    if (currentYear < startYear || currentYear > endYear) continue;

    const coordsA = extractPolygonCoordinates(bracketing.before.feature);
    const coordsB = extractPolygonCoordinates(bracketing.after.feature);

    const interpolated = interpolatePolygonCoordinates(
      coordsA,
      coordsB,
      bracketing.progress
    );

    // Merge properties from both snapshots
    const props = bracketing.progress < 0.5
      ? bracketing.before.feature.properties
      : bracketing.after.feature.properties;

    results.push({
      coordinates: interpolated,
      civilizationId: civId,
      progress: bracketing.progress,
      properties: props,
    });
  }

  return results;
}

// ============================================================================
// Migration Particle Animation
// ============================================================================

/**
 * Generate particle positions along a route for a given animation time.
 */
export function generateMigrationParticles(
  routeCoordinates: Position[],
  particleCount: number,
  animationTime: number,
  color: string
): MigrationParticle[] {
  if (routeCoordinates.length < 2) return [];

  const particles: MigrationParticle[] = [];

  for (let i = 0; i < particleCount; i++) {
    // Stagger particles along the route
    const baseProgress = (i / particleCount + animationTime) % 1;
    const position = interpolateAlongRoute(routeCoordinates, baseProgress);

    particles.push({
      id: `particle-${i}`,
      position,
      routeProgress: baseProgress,
      color,
      size: 3 + Math.sin(baseProgress * Math.PI) * 2, // Larger in middle
    });
  }

  return particles;
}

/**
 * Get a position along a route at a given progress (0-1).
 */
export function interpolateAlongRoute(
  coordinates: Position[],
  progress: number
): [number, number] {
  if (coordinates.length === 0) return [0, 0];
  if (coordinates.length === 1) return [coordinates[0][0], coordinates[0][1]];

  // Calculate cumulative distances
  const distances: number[] = [0];
  for (let i = 1; i < coordinates.length; i++) {
    const dx = coordinates[i][0] - coordinates[i - 1][0];
    const dy = coordinates[i][1] - coordinates[i - 1][1];
    distances.push(distances[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const totalLength = distances[distances.length - 1];
  if (totalLength === 0) return [coordinates[0][0], coordinates[0][1]];

  const targetDist = progress * totalLength;

  // Find the segment
  let segIdx = 0;
  while (segIdx < distances.length - 1 && distances[segIdx + 1] < targetDist) {
    segIdx++;
  }
  if (segIdx >= coordinates.length - 1) {
    const last = coordinates[coordinates.length - 1];
    return [last[0], last[1]];
  }

  const segLen = distances[segIdx + 1] - distances[segIdx];
  const t = segLen > 0 ? (targetDist - distances[segIdx]) / segLen : 0;

  return [
    coordinates[segIdx][0] + t * (coordinates[segIdx + 1][0] - coordinates[segIdx][0]),
    coordinates[segIdx][1] + t * (coordinates[segIdx + 1][1] - coordinates[segIdx][1]),
  ];
}

// ============================================================================
// Geometry Utilities for Empire Boundary + Settlement Overlay
// ============================================================================

/**
 * Compute the centroid of a polygon ring using the shoelace formula.
 * Returns [lng, lat].
 */
export function computePolygonCentroid(ring: Position[]): [number, number] {
  if (ring.length === 0) return [0, 0];
  if (ring.length === 1) return [ring[0][0], ring[0][1]];

  let area = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < ring.length - 1; i++) {
    const x0 = ring[i][0];
    const y0 = ring[i][1];
    const x1 = ring[i + 1][0];
    const y1 = ring[i + 1][1];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }

  area /= 2;
  if (Math.abs(area) < 1e-10) {
    // Degenerate polygon - return average of points
    const sumX = ring.reduce((s, p) => s + p[0], 0);
    const sumY = ring.reduce((s, p) => s + p[1], 0);
    return [sumX / ring.length, sumY / ring.length];
  }

  cx /= 6 * area;
  cy /= 6 * area;
  return [cx, cy];
}

/**
 * Ray-casting point-in-polygon test.
 * Tests if a point [lng, lat] is inside a polygon ring.
 */
export function isPointInPolygon(point: [number, number], ring: Position[]): boolean {
  if (ring.length < 3) return false;

  const [px, py] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];

    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Given morphed empire boundaries and a list of settlements, determine which
 * settlements fall within each empire boundary. Settlements inherit the
 * empire's color. Capitals are flagged.
 */
export function computeSettlementOverlays(
  morphedBoundaries: MorphedBoundary[],
  settlements: Array<{
    id: string;
    name: string;
    longitude: number;
    latitude: number;
    type: string;
  }>,
  getEmpireColor: (empireId: string) => string
): EmpireSettlementOverlay[] {
  const overlays: EmpireSettlementOverlay[] = [];

  for (const settlement of settlements) {
    const point: [number, number] = [settlement.longitude, settlement.latitude];

    for (const boundary of morphedBoundaries) {
      const outerRing = boundary.coordinates[0];
      if (!outerRing || outerRing.length < 3) continue;

      if (isPointInPolygon(point, outerRing)) {
        const capital = boundary.properties.capital;
        const isCapital = capital !== undefined &&
          capital.toLowerCase() === settlement.name.toLowerCase();

        overlays.push({
          settlementId: settlement.id,
          name: settlement.name,
          position: point,
          empireId: boundary.civilizationId,
          empireColor: getEmpireColor(boundary.civilizationId),
          isCapital,
          type: settlement.type,
        });
        break; // A settlement belongs to the first containing empire
      }
    }
  }

  return overlays;
}

/**
 * Generate label info (name + centroid position) for each morphed empire boundary.
 */
export function computeEmpireLabels(
  morphedBoundaries: MorphedBoundary[],
  getEmpireColor: (empireId: string) => string
): EmpireLabelInfo[] {
  return morphedBoundaries.map((boundary) => {
    const outerRing = boundary.coordinates[0] || [];
    const centroid = computePolygonCentroid(outerRing);
    return {
      empireId: boundary.civilizationId,
      name: boundary.properties.name,
      centroid,
      color: getEmpireColor(boundary.civilizationId),
    };
  });
}
