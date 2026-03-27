import { useState, useCallback, useRef, useMemo } from 'react';
import type { LatLngBounds, LatLng } from 'leaflet';

// ============================================================================
// Types
// ============================================================================

export interface ControlPoint {
  id: string;
  /** Pixel position on the image [x, y] in fraction (0-1) */
  imagePos: [number, number];
  /** Geographic coordinates [lat, lng] */
  mapPos: [number, number];
}

export interface ImageOverlayState {
  /** Data URL or object URL of the imported image */
  imageUrl: string | null;
  /** Original image dimensions */
  imageDimensions: { width: number; height: number } | null;
  /** Image opacity 0-1 */
  opacity: number;
  /** Rotation in degrees */
  rotation: number;
  /** Initial placement bounds on the map */
  bounds: [[number, number], [number, number]] | null;
  /** Control points for georeferencing */
  controlPoints: ControlPoint[];
  /** Whether the georeferencing tool is active */
  isActive: boolean;
  /** Whether we are placing a control point */
  isPlacingControlPoint: boolean;
  /** Pending control point (image position set, waiting for map click) */
  pendingImagePos: [number, number] | null;
}

// ============================================================================
// Affine transformation helpers
// ============================================================================

/**
 * Compute an affine transformation matrix from control point pairs.
 * Uses least-squares for 3+ points to find the best-fit affine transform.
 * Returns [a, b, c, d, e, f] where:
 *   mapX = a*imgX + b*imgY + c
 *   mapY = d*imgX + e*imgY + f
 */
export function computeAffineTransform(
  controlPoints: ControlPoint[]
): [number, number, number, number, number, number] | null {
  const n = controlPoints.length;
  if (n < 3) return null;

  // Build matrices for least squares: A * params = B
  // For X: a*ix + b*iy + c = mx
  // For Y: d*ix + e*iy + f = my
  let sumIx = 0, sumIy = 0, sumIxIx = 0, sumIyIy = 0, sumIxIy = 0;
  let sumMx = 0, sumMy = 0, sumIxMx = 0, sumIyMx = 0, sumIxMy = 0, sumIyMy = 0;

  for (const cp of controlPoints) {
    const [ix, iy] = cp.imagePos;
    const [mx, my] = cp.mapPos;
    sumIx += ix; sumIy += iy;
    sumIxIx += ix * ix; sumIyIy += iy * iy; sumIxIy += ix * iy;
    sumMx += mx; sumMy += my;
    sumIxMx += ix * mx; sumIyMx += iy * mx;
    sumIxMy += ix * my; sumIyMy += iy * my;
  }

  // Solve via least-squares using normal equations: M * params = rhs
  const M = [
    [sumIxIx, sumIxIy, sumIx],
    [sumIxIy, sumIyIy, sumIy],
    [sumIx, sumIy, n],
  ];

  const inv = invert3x3(M);
  if (!inv) return null;

  const bx = [sumIxMx, sumIyMx, sumMx];
  const by = [sumIxMy, sumIyMy, sumMy];

  const pa = dot3(inv[0], bx);
  const pb = dot3(inv[1], bx);
  const pc = dot3(inv[2], bx);
  const pd = dot3(inv[0], by);
  const pe = dot3(inv[1], by);
  const pf = dot3(inv[2], by);

  return [pa, pb, pc, pd, pe, pf];
}

function dot3(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function invert3x3(m: number[][]): number[][] | null {
  const [a, b, c] = [m[0][0], m[0][1], m[0][2]];
  const [d, e, f] = [m[1][0], m[1][1], m[1][2]];
  const [g, h, i] = [m[2][0], m[2][1], m[2][2]];

  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;

  const invDet = 1 / det;
  return [
    [(e * i - f * h) * invDet, (c * h - b * i) * invDet, (b * f - c * e) * invDet],
    [(f * g - d * i) * invDet, (a * i - c * g) * invDet, (c * d - a * f) * invDet],
    [(d * h - e * g) * invDet, (b * g - a * h) * invDet, (a * e - b * d) * invDet],
  ];
}

/**
 * Apply an affine transform to a normalized image position,
 * returning [lat, lng].
 */
export function applyAffineTransform(
  transform: [number, number, number, number, number, number],
  imagePos: [number, number]
): [number, number] {
  const [a, b, c, d, e, f] = transform;
  const [ix, iy] = imagePos;
  return [a * ix + b * iy + c, d * ix + e * iy + f];
}

/**
 * Compute georeferenced bounds from an affine transform by mapping image corners.
 */
export function computeGeoreferencedBounds(
  transform: [number, number, number, number, number, number]
): [[number, number], [number, number]] {
  const corners: [number, number][] = [
    applyAffineTransform(transform, [0, 0]),
    applyAffineTransform(transform, [1, 0]),
    applyAffineTransform(transform, [0, 1]),
    applyAffineTransform(transform, [1, 1]),
  ];

  const lats = corners.map(c => c[0]);
  const lngs = corners.map(c => c[1]);

  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
}

// ============================================================================
// Hook
// ============================================================================

let controlPointId = 0;

export function useImageGeoreference() {
  const [state, setState] = useState<ImageOverlayState>({
    imageUrl: null,
    imageDimensions: null,
    opacity: 0.6,
    rotation: 0,
    bounds: null,
    controlPoints: [],
    isActive: false,
    isPlacingControlPoint: false,
    pendingImagePos: null,
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activate = useCallback(() => {
    setState(s => ({ ...s, isActive: true }));
  }, []);

  const deactivate = useCallback(() => {
    setState(s => ({
      ...s,
      isActive: false,
      isPlacingControlPoint: false,
      pendingImagePos: null,
    }));
  }, []);

  const loadImage = useCallback((file: File, mapCenter: [number, number], mapZoom: number) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Compute initial bounds around the map center
      // Spread depends on zoom: smaller spread at higher zoom
      const spread = 10 / Math.pow(2, mapZoom - 3);
      const aspectRatio = img.width / img.height;
      const latSpread = spread;
      const lngSpread = spread * aspectRatio;

      setState(s => ({
        ...s,
        imageUrl: url,
        imageDimensions: { width: img.width, height: img.height },
        bounds: [
          [mapCenter[0] - latSpread / 2, mapCenter[1] - lngSpread / 2],
          [mapCenter[0] + latSpread / 2, mapCenter[1] + lngSpread / 2],
        ],
        controlPoints: [],
        isActive: true,
      }));
    };
    img.src = url;
  }, []);

  const removeImage = useCallback(() => {
    setState(s => {
      if (s.imageUrl) URL.revokeObjectURL(s.imageUrl);
      return {
        ...s,
        imageUrl: null,
        imageDimensions: null,
        bounds: null,
        controlPoints: [],
        isPlacingControlPoint: false,
        pendingImagePos: null,
      };
    });
  }, []);

  const setOpacity = useCallback((opacity: number) => {
    setState(s => ({ ...s, opacity: Math.max(0, Math.min(1, opacity)) }));
  }, []);

  const setRotation = useCallback((rotation: number) => {
    setState(s => ({ ...s, rotation: rotation % 360 }));
  }, []);

  const setBounds = useCallback((bounds: [[number, number], [number, number]]) => {
    setState(s => ({ ...s, bounds }));
  }, []);

  const startPlacingControlPoint = useCallback((imagePos: [number, number]) => {
    setState(s => ({
      ...s,
      isPlacingControlPoint: true,
      pendingImagePos: imagePos,
    }));
  }, []);

  const confirmControlPointPlacement = useCallback((mapPos: [number, number]) => {
    setState(s => {
      if (!s.pendingImagePos) return s;
      const newPoint: ControlPoint = {
        id: `cp-${++controlPointId}`,
        imagePos: s.pendingImagePos,
        mapPos,
      };
      return {
        ...s,
        controlPoints: [...s.controlPoints, newPoint],
        isPlacingControlPoint: false,
        pendingImagePos: null,
      };
    });
  }, []);

  const cancelPlacingControlPoint = useCallback(() => {
    setState(s => ({
      ...s,
      isPlacingControlPoint: false,
      pendingImagePos: null,
    }));
  }, []);

  const removeControlPoint = useCallback((id: string) => {
    setState(s => ({
      ...s,
      controlPoints: s.controlPoints.filter(cp => cp.id !== id),
    }));
  }, []);

  const updateControlPointMapPos = useCallback((id: string, mapPos: [number, number]) => {
    setState(s => ({
      ...s,
      controlPoints: s.controlPoints.map(cp =>
        cp.id === id ? { ...cp, mapPos } : cp
      ),
    }));
  }, []);

  const affineTransform = useMemo(() => {
    if (state.controlPoints.length < 3) return null;
    return computeAffineTransform(state.controlPoints);
  }, [state.controlPoints]);

  const georeferencedBounds = useMemo(() => {
    if (!affineTransform) return null;
    return computeGeoreferencedBounds(affineTransform);
  }, [affineTransform]);

  const clearControlPoints = useCallback(() => {
    setState(s => ({ ...s, controlPoints: [], isPlacingControlPoint: false, pendingImagePos: null }));
  }, []);

  return {
    state,
    fileInputRef,
    activate,
    deactivate,
    loadImage,
    removeImage,
    setOpacity,
    setRotation,
    setBounds,
    startPlacingControlPoint,
    confirmControlPointPlacement,
    cancelPlacingControlPoint,
    removeControlPoint,
    updateControlPointMapPos,
    clearControlPoints,
    affineTransform,
    georeferencedBounds,
  };
}

export type ImageGeoreferenceReturn = ReturnType<typeof useImageGeoreference>;
