/**
 * Rubber-sheet (piecewise affine) transformation for image georeferencing.
 *
 * Uses Delaunay triangulation of control points in image space, then computes
 * an exact affine transform per triangle. Points inside the convex hull get
 * exact interpolation at all control points with smooth transitions between
 * triangles. Points outside the hull fall back to the global affine transform.
 */

import type { ControlPoint } from './useImageGeoreference';
import { computeAffineTransform, applyAffineTransform } from './useImageGeoreference';

// ============================================================================
// Types
// ============================================================================

export interface Triangle {
  /** Indices into the control points array */
  indices: [number, number, number];
  /** Per-triangle affine transform [a, b, c, d, e, f] */
  transform: [number, number, number, number, number, number];
}

export interface RubberSheetTransform {
  triangles: Triangle[];
  /** Fallback global affine for points outside the convex hull */
  globalAffine: [number, number, number, number, number, number];
  /** Control points used to build the transform */
  controlPoints: ControlPoint[];
}

// ============================================================================
// Delaunay triangulation (Bowyer-Watson algorithm)
// ============================================================================

interface Point2D {
  x: number;
  y: number;
}

interface TriIndices {
  a: number;
  b: number;
  c: number;
}

/**
 * Compute the circumcircle of a triangle defined by three points.
 * Returns center (cx, cy) and radius squared.
 */
function circumcircle(
  p1: Point2D,
  p2: Point2D,
  p3: Point2D
): { cx: number; cy: number; r2: number } | null {
  const ax = p1.x, ay = p1.y;
  const bx = p2.x, by = p2.y;
  const cx = p3.x, cy = p3.y;

  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;

  const ux =
    ((ax * ax + ay * ay) * (by - cy) +
      (bx * bx + by * by) * (cy - ay) +
      (cx * cx + cy * cy) * (ay - by)) /
    d;
  const uy =
    ((ax * ax + ay * ay) * (cx - bx) +
      (bx * bx + by * by) * (ax - cx) +
      (cx * cx + cy * cy) * (bx - ax)) /
    d;

  const r2 = (ax - ux) * (ax - ux) + (ay - uy) * (ay - uy);
  return { cx: ux, cy: uy, r2 };
}

/**
 * Check if a point lies inside the circumcircle of a triangle.
 */
function inCircumcircle(
  p: Point2D,
  circ: { cx: number; cy: number; r2: number }
): boolean {
  const dx = p.x - circ.cx;
  const dy = p.y - circ.cy;
  return dx * dx + dy * dy <= circ.r2 + 1e-10;
}

/**
 * Bowyer-Watson Delaunay triangulation.
 * Returns triangle indices referencing the input points array.
 */
export function delaunayTriangulate(points: Point2D[]): TriIndices[] {
  const n = points.length;
  if (n < 3) return [];

  // Create a super-triangle that contains all points
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const dx = maxX - minX;
  const dy = maxY - minY;
  const dmax = Math.max(dx, dy);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  // Super-triangle vertices (stored at indices n, n+1, n+2)
  const superPoints: Point2D[] = [
    { x: midX - 20 * dmax, y: midY - dmax },
    { x: midX, y: midY + 20 * dmax },
    { x: midX + 20 * dmax, y: midY - dmax },
  ];

  const allPoints = [...points, ...superPoints];

  // Start with the super-triangle
  let triangles: TriIndices[] = [{ a: n, b: n + 1, c: n + 2 }];

  // Insert each point one at a time
  for (let i = 0; i < n; i++) {
    const p = allPoints[i];
    const badTriangles: number[] = [];

    // Find all triangles whose circumcircle contains the point
    for (let t = 0; t < triangles.length; t++) {
      const tri = triangles[t];
      const circ = circumcircle(allPoints[tri.a], allPoints[tri.b], allPoints[tri.c]);
      if (circ && inCircumcircle(p, circ)) {
        badTriangles.push(t);
      }
    }

    // Find the boundary polygon of the bad triangles (edges not shared by two bad triangles)
    const edges: [number, number][] = [];
    for (const t of badTriangles) {
      const tri = triangles[t];
      edges.push([tri.a, tri.b], [tri.b, tri.c], [tri.c, tri.a]);
    }

    const boundaryEdges: [number, number][] = [];
    for (let e = 0; e < edges.length; e++) {
      const [ea, eb] = edges[e];
      let shared = false;
      for (let f = 0; f < edges.length; f++) {
        if (e === f) continue;
        if (
          (edges[f][0] === ea && edges[f][1] === eb) ||
          (edges[f][0] === eb && edges[f][1] === ea)
        ) {
          shared = true;
          break;
        }
      }
      if (!shared) boundaryEdges.push([ea, eb]);
    }

    // Remove bad triangles (in reverse order to preserve indices)
    badTriangles.sort((a, b) => b - a);
    for (const t of badTriangles) {
      triangles.splice(t, 1);
    }

    // Create new triangles from boundary edges to the inserted point
    for (const [ea, eb] of boundaryEdges) {
      triangles.push({ a: i, b: ea, c: eb });
    }
  }

  // Remove any triangles that reference super-triangle vertices
  triangles = triangles.filter(
    (tri) => tri.a < n && tri.b < n && tri.c < n
  );

  return triangles;
}

// ============================================================================
// Per-triangle affine transform
// ============================================================================

/**
 * Compute an exact affine transform for 3 control points (a triangle).
 * Unlike the least-squares version, this gives an exact solution.
 */
function computeTriangleAffine(
  cp0: ControlPoint,
  cp1: ControlPoint,
  cp2: ControlPoint
): [number, number, number, number, number, number] | null {
  const [ix0, iy0] = cp0.imagePos;
  const [ix1, iy1] = cp1.imagePos;
  const [ix2, iy2] = cp2.imagePos;

  const det = (ix0 - ix2) * (iy1 - iy2) - (ix1 - ix2) * (iy0 - iy2);
  if (Math.abs(det) < 1e-12) return null;

  const invDet = 1 / det;

  // Solve for lat transform: lat = a*ix + b*iy + c
  const [mx0, my0] = cp0.mapPos;
  const [mx1, my1] = cp1.mapPos;
  const [mx2, my2] = cp2.mapPos;

  const a = ((mx0 - mx2) * (iy1 - iy2) - (mx1 - mx2) * (iy0 - iy2)) * invDet;
  const b = ((ix0 - ix2) * (mx1 - mx2) - (ix1 - ix2) * (mx0 - mx2)) * invDet;
  const c = mx0 - a * ix0 - b * iy0;

  // Solve for lng transform: lng = d*ix + e*iy + f
  const d = ((my0 - my2) * (iy1 - iy2) - (my1 - my2) * (iy0 - iy2)) * invDet;
  const e = ((ix0 - ix2) * (my1 - my2) - (ix1 - ix2) * (my0 - my2)) * invDet;
  const f = my0 - d * ix0 - e * iy0;

  return [a, b, c, d, e, f];
}

// ============================================================================
// Point-in-triangle test
// ============================================================================

/**
 * Barycentric coordinate test for point-in-triangle.
 * Returns barycentric coordinates [u, v, w] if inside, null otherwise.
 */
export function barycentricCoords(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): [number, number, number] | null {
  const v0x = cx - ax, v0y = cy - ay;
  const v1x = bx - ax, v1y = by - ay;
  const v2x = px - ax, v2y = py - ay;

  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;

  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-12) return null;

  const invDenom = 1 / denom;
  const u = (dot00 * dot12 - dot01 * dot02) * invDenom;
  const v = (dot11 * dot02 - dot01 * dot12) * invDenom;
  const w = 1 - u - v;

  // Allow small epsilon for edge cases
  const eps = -1e-8;
  if (u >= eps && v >= eps && w >= eps) {
    return [u, v, w];
  }
  return null;
}

// ============================================================================
// Rubber-sheet transform construction and application
// ============================================================================

/**
 * Build a rubber-sheet transform from control points.
 * Requires 4+ points (falls back to global affine for 3).
 */
export function buildRubberSheetTransform(
  controlPoints: ControlPoint[]
): RubberSheetTransform | null {
  if (controlPoints.length < 4) return null;

  const globalAffine = computeAffineTransform(controlPoints);
  if (!globalAffine) return null;

  // Triangulate in image space
  const imagePoints: Point2D[] = controlPoints.map((cp) => ({
    x: cp.imagePos[0],
    y: cp.imagePos[1],
  }));

  const triIndices = delaunayTriangulate(imagePoints);
  if (triIndices.length === 0) return null;

  // Compute per-triangle affine transforms
  const triangles: Triangle[] = [];
  for (const tri of triIndices) {
    const transform = computeTriangleAffine(
      controlPoints[tri.a],
      controlPoints[tri.b],
      controlPoints[tri.c]
    );
    if (transform) {
      triangles.push({
        indices: [tri.a, tri.b, tri.c],
        transform,
      });
    }
  }

  if (triangles.length === 0) return null;

  return { triangles, globalAffine, controlPoints };
}

/**
 * Apply a rubber-sheet transform to an image position.
 * Finds the triangle containing the point and uses its local affine transform.
 * Falls back to global affine for points outside the triangulation.
 */
export function applyRubberSheetTransform(
  rst: RubberSheetTransform,
  imagePos: [number, number]
): [number, number] {
  const [px, py] = imagePos;

  // Search for the containing triangle
  for (const tri of rst.triangles) {
    const [ia, ib, ic] = tri.indices;
    const cps = rst.controlPoints;
    const bary = barycentricCoords(
      px, py,
      cps[ia].imagePos[0], cps[ia].imagePos[1],
      cps[ib].imagePos[0], cps[ib].imagePos[1],
      cps[ic].imagePos[0], cps[ic].imagePos[1]
    );

    if (bary) {
      return applyAffineTransform(tri.transform, imagePos);
    }
  }

  // Outside convex hull - use global affine fallback
  return applyAffineTransform(rst.globalAffine, imagePos);
}

/**
 * Compute georeferenced bounds using rubber-sheet transform.
 * Samples a grid of points across the image to find the extent.
 */
export function computeRubberSheetBounds(
  rst: RubberSheetTransform
): [[number, number], [number, number]] {
  const samplePoints: [number, number][] = [];

  // Sample corners and a grid across the image
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      samplePoints.push([i / steps, j / steps]);
    }
  }

  const mapped = samplePoints.map((p) => applyRubberSheetTransform(rst, p));

  const lats = mapped.map((m) => m[0]);
  const lngs = mapped.map((m) => m[1]);

  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
}
