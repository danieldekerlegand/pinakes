/**
 * Territorial shading utilities for cultural region fill patterns.
 *
 * Supports four fill types:
 * - solid: uniform fill (default)
 * - gradient: center-outward radial gradient (core = full saturation, periphery fades)
 * - hatched: diagonal line pattern (disputed/uncertain regions)
 * - striped: vertical stripe pattern (overlapping claims)
 */

import type { Position } from 'geojson';

export type TerritorialFillType = 'solid' | 'gradient' | 'hatched' | 'striped';

/**
 * Compute the centroid of a polygon ring.
 * Uses the signed-area weighted centroid formula for accuracy.
 */
export function polygonCentroid(ring: Position[]): Position {
  const pts =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;

  const n = pts.length;
  if (n === 0) return [0, 0];
  if (n === 1) return [pts[0][0], pts[0][1]];
  if (n === 2) return [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];

  let area = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cross = pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
    area += cross;
    cx += (pts[i][0] + pts[j][0]) * cross;
    cy += (pts[i][1] + pts[j][1]) * cross;
  }

  area /= 2;
  if (Math.abs(area) < 1e-10) {
    // Degenerate polygon — fall back to arithmetic mean
    const sx = pts.reduce((s, p) => s + p[0], 0);
    const sy = pts.reduce((s, p) => s + p[1], 0);
    return [sx / n, sy / n];
  }

  cx /= 6 * area;
  cy /= 6 * area;
  return [cx, cy];
}

/**
 * Generate concentric inward rings for gradient fill.
 * Creates rings from the boundary inward toward the centroid,
 * with increasing opacity toward the center (core-to-periphery gradient).
 *
 * @param ring - Outer polygon ring
 * @param layers - Number of concentric layers
 * @returns Array of { ring, opacityMultiplier } where higher multiplier = closer to core
 */
export function generateInwardGradientRings(
  ring: Position[],
  layers: number = 4,
): { ring: Position[]; opacityMultiplier: number }[] {
  const centroid = polygonCentroid(ring);
  const pts =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : [...ring];

  const result: { ring: Position[]; opacityMultiplier: number }[] = [];

  // Generate rings from outermost (lowest opacity) to innermost (highest opacity)
  for (let i = 1; i <= layers; i++) {
    const fraction = i / (layers + 1); // how far toward centroid (0 = boundary, 1 = centroid)
    const interpolated: Position[] = pts.map((pt) => [
      pt[0] + (centroid[0] - pt[0]) * fraction,
      pt[1] + (centroid[1] - pt[1]) * fraction,
    ]);
    // Close the ring
    interpolated.push([interpolated[0][0], interpolated[0][1]]);

    result.push({
      ring: interpolated,
      opacityMultiplier: 0.3 + fraction * 0.7, // 0.3 at periphery → 1.0 at core
    });
  }

  return result;
}

/**
 * Unique SVG pattern ID for a given color + fill type.
 */
export function patternId(fillType: TerritorialFillType, colorHex: string): string {
  const colorKey = colorHex.replace('#', '');
  return `territorial-${fillType}-${colorKey}`;
}

/**
 * Create SVG pattern markup for hatched fill.
 * Produces diagonal lines at 45 degrees.
 */
export function createHatchedPatternSVG(color: string, id: string, size: number = 8): string {
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${size}" height="${size}" patternTransform="rotate(45)">
    <rect width="${size}" height="${size}" fill="${color}" fill-opacity="0.15"/>
    <line x1="0" y1="0" x2="0" y2="${size}" stroke="${color}" stroke-width="1.5" stroke-opacity="0.6"/>
  </pattern>`;
}

/**
 * Create SVG pattern markup for striped fill.
 * Produces vertical stripes.
 */
export function createStripedPatternSVG(color: string, id: string, size: number = 10): string {
  const halfSize = size / 2;
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${size}" height="${size}">
    <rect width="${halfSize}" height="${size}" fill="${color}" fill-opacity="0.3"/>
    <rect x="${halfSize}" width="${halfSize}" height="${size}" fill="${color}" fill-opacity="0.1"/>
  </pattern>`;
}

/**
 * Build the className string for a feature based on its fill type.
 * Layers use className to apply CSS fill via url(#pattern-id).
 */
export function territorialClassName(fillType: TerritorialFillType, colorHex: string): string {
  if (fillType === 'solid' || fillType === 'gradient') return '';
  return `territorial-fill-${patternId(fillType, colorHex)}`;
}

/**
 * Build a CSS rule that applies the pattern fill to elements with the given className.
 */
export function buildPatternCSS(fillType: TerritorialFillType, colorHex: string): string {
  if (fillType === 'solid' || fillType === 'gradient') return '';
  const id = patternId(fillType, colorHex);
  const cls = `territorial-fill-${id}`;
  return `.${cls} { fill: url(#${id}) !important; }`;
}
