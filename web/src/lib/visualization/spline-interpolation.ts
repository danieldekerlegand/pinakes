import type { Position, Feature, Polygon, MultiPolygon, GeoJsonProperties } from 'geojson';

/**
 * Catmull-Rom spline interpolation for smoothing polygon boundaries.
 * Creates organic, natural-looking cultural boundaries from coarse polygon data.
 */

/**
 * Compute a point on a Catmull-Rom spline segment.
 * Uses centripetal parameterization (alpha=0.5) for better curve behavior.
 */
function catmullRomPoint(
  p0: Position,
  p1: Position,
  p2: Position,
  p3: Position,
  t: number,
  alpha: number = 0.5
): Position {
  // Compute knot values using centripetal parameterization
  const d01 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const d12 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  const d23 = Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);

  const t0 = 0;
  const t1 = t0 + Math.pow(d01, alpha);
  const t2 = t1 + Math.pow(d12, alpha);
  const t3 = t2 + Math.pow(d23, alpha);

  // Avoid division by zero for duplicate points
  const eps = 1e-10;
  const s1 = Math.max(t1 - t0, eps);
  const s2 = Math.max(t2 - t0, eps);
  const s3 = Math.max(t2 - t1, eps);
  const s4 = Math.max(t3 - t1, eps);
  const s5 = Math.max(t3 - t2, eps);

  // Map t from [0,1] to [t1, t2]
  const tt = t1 + t * (t2 - t1);

  // Barry and Goldman's pyramidal formulation
  const a1x = ((t1 - tt) / s1) * p0[0] + ((tt - t0) / s1) * p1[0];
  const a1y = ((t1 - tt) / s1) * p0[1] + ((tt - t0) / s1) * p1[1];
  const a2x = ((t2 - tt) / s3) * p1[0] + ((tt - t1) / s3) * p2[0];
  const a2y = ((t2 - tt) / s3) * p1[1] + ((tt - t1) / s3) * p2[1];
  const a3x = ((t3 - tt) / s5) * p2[0] + ((tt - t2) / s5) * p3[0];
  const a3y = ((t3 - tt) / s5) * p2[1] + ((tt - t2) / s5) * p3[1];

  const b1x = ((t2 - tt) / s2) * a1x + ((tt - t0) / s2) * a2x;
  const b1y = ((t2 - tt) / s2) * a1y + ((tt - t0) / s2) * a2y;
  const b2x = ((t3 - tt) / s4) * a2x + ((tt - t1) / s4) * a3x;
  const b2y = ((t3 - tt) / s4) * a2y + ((tt - t1) / s4) * a3y;

  const cx = ((t2 - tt) / s3) * b1x + ((tt - t1) / s3) * b2x;
  const cy = ((t2 - tt) / s3) * b1y + ((tt - t1) / s3) * b2y;

  return [cx, cy];
}

/**
 * Interpolate a closed ring of coordinates using Catmull-Rom splines.
 * @param ring - Array of [lng, lat] positions (closed: first === last)
 * @param pointsPerSegment - Number of interpolated points per original segment
 * @param tension - Catmull-Rom alpha parameter (0=uniform, 0.5=centripetal, 1=chordal)
 */
export function smoothRing(
  ring: Position[],
  pointsPerSegment: number = 6,
  tension: number = 0.5
): Position[] {
  // Remove closing point if present (we'll re-close later)
  const pts = ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : [...ring];

  const n = pts.length;
  if (n < 3) return ring; // Can't smooth fewer than 3 points

  const result: Position[] = [];

  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];

    for (let j = 0; j < pointsPerSegment; j++) {
      const t = j / pointsPerSegment;
      result.push(catmullRomPoint(p0, p1, p2, p3, t, tension));
    }
  }

  // Close the ring
  result.push([result[0][0], result[0][1]]);

  return result;
}

/**
 * Smooth all rings of a Polygon geometry.
 */
export function smoothPolygon(
  coordinates: Position[][],
  pointsPerSegment: number = 6,
  tension: number = 0.5
): Position[][] {
  return coordinates.map((ring) => smoothRing(ring, pointsPerSegment, tension));
}

/**
 * Smooth a GeoJSON Polygon or MultiPolygon feature's geometry.
 * Returns a new feature with smoothed coordinates.
 */
export function smoothFeature<P extends GeoJsonProperties>(
  feature: Feature<Polygon | MultiPolygon, P>,
  pointsPerSegment: number = 6,
  tension: number = 0.5
): Feature<Polygon | MultiPolygon, P> {
  const { geometry } = feature;

  if (geometry.type === 'Polygon') {
    return {
      ...feature,
      geometry: {
        type: 'Polygon',
        coordinates: smoothPolygon(geometry.coordinates, pointsPerSegment, tension),
      },
    };
  }

  if (geometry.type === 'MultiPolygon') {
    return {
      ...feature,
      geometry: {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map((poly) =>
          smoothPolygon(poly, pointsPerSegment, tension)
        ),
      },
    };
  }

  return feature;
}

/**
 * Smooth an array of polygon features.
 */
export function smoothFeatures<P extends GeoJsonProperties>(
  features: Feature<Polygon | MultiPolygon, P>[],
  pointsPerSegment: number = 6,
  tension: number = 0.5
): Feature<Polygon | MultiPolygon, P>[] {
  return features.map((f) => smoothFeature(f, pointsPerSegment, tension));
}

/**
 * Generate a gradient edge polygon for transition zones.
 * Creates a buffer ring around the boundary that fades in opacity,
 * representing uncertain or gradual cultural boundaries.
 *
 * Returns an array of concentric offset rings with decreasing opacity values.
 */
export function generateGradientEdgeRings(
  ring: Position[],
  layers: number = 3,
  maxOffset: number = 0.5 // degrees offset for outermost ring
): { ring: Position[]; opacityMultiplier: number }[] {
  const result: { ring: Position[]; opacityMultiplier: number }[] = [];

  for (let i = 1; i <= layers; i++) {
    const fraction = i / layers;
    const offset = maxOffset * fraction;
    const offsetRing = offsetPolygonRing(ring, offset);
    result.push({
      ring: offsetRing,
      opacityMultiplier: 1 - fraction * 0.7, // fade from 1.0 to 0.3
    });
  }

  return result;
}

/**
 * Offset a polygon ring outward by a given distance (in degrees).
 * Uses simple normal-based offsetting for each vertex.
 */
function offsetPolygonRing(ring: Position[], offset: number): Position[] {
  // Remove closing point
  const pts = ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : [...ring];

  const n = pts.length;
  if (n < 3) return ring;

  const result: Position[] = [];

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];

    // Compute outward normal as average of edge normals
    const dx1 = curr[0] - prev[0];
    const dy1 = curr[1] - prev[1];
    const dx2 = next[0] - curr[0];
    const dy2 = next[1] - curr[1];

    // Normals (pointing outward for CCW winding)
    const len1 = Math.hypot(dx1, dy1) || 1e-10;
    const len2 = Math.hypot(dx2, dy2) || 1e-10;
    const nx1 = -dy1 / len1;
    const ny1 = dx1 / len1;
    const nx2 = -dy2 / len2;
    const ny2 = dx2 / len2;

    // Average normal
    let nx = (nx1 + nx2) / 2;
    let ny = (ny1 + ny2) / 2;
    const nlen = Math.hypot(nx, ny) || 1e-10;
    nx /= nlen;
    ny /= nlen;

    result.push([curr[0] + nx * offset, curr[1] + ny * offset]);
  }

  // Close the ring
  result.push([result[0][0], result[0][1]]);

  return result;
}
