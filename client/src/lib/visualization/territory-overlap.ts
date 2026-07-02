/**
 * Territory overlap detection and blend mode utilities.
 *
 * Detects overlapping polygon features across multiple map layers
 * and computes blended colors for overlap regions.
 */

import * as turf from '@turf/turf';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import type { BlendMode } from './geospatial-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TerritoryFeature {
  id: string;
  layerId: string;
  color: string;
  feature: Feature<Polygon | MultiPolygon>;
}

export interface OverlapRegion {
  id: string;
  geometry: Polygon;
  sourceIds: string[];
  sourceLayerIds: string[];
  colors: string[];
  overlapCount: number;
}

// ---------------------------------------------------------------------------
// Color blending
// ---------------------------------------------------------------------------

/** Parse a hex color (#rrggbb or #rgb) into [r, g, b] 0-255. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const n = parseInt(h, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Convert [r, g, b] 0-255 back to #rrggbb. */
export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

/**
 * Blend two colors using the given blend mode.
 * All operations use normalised [0-1] channel values internally.
 */
export function blendColors(
  baseHex: string,
  topHex: string,
  mode: BlendMode,
): string {
  if (mode === 'normal') return topHex;

  const [br, bg, bb] = hexToRgb(baseHex).map((v) => v / 255);
  const [tr, tg, tb] = hexToRgb(topHex).map((v) => v / 255);

  let r: number, g: number, b: number;

  switch (mode) {
    case 'multiply':
      r = br * tr;
      g = bg * tg;
      b = bb * tb;
      break;
    case 'screen':
      r = 1 - (1 - br) * (1 - tr);
      g = 1 - (1 - bg) * (1 - tg);
      b = 1 - (1 - bb) * (1 - tb);
      break;
    case 'overlay':
      r = br < 0.5 ? 2 * br * tr : 1 - 2 * (1 - br) * (1 - tr);
      g = bg < 0.5 ? 2 * bg * tg : 1 - 2 * (1 - bg) * (1 - tg);
      b = bb < 0.5 ? 2 * bb * tb : 1 - 2 * (1 - bb) * (1 - tb);
      break;
    default:
      return topHex;
  }

  return rgbToHex(r * 255, g * 255, b * 255);
}

/**
 * Blend an array of colors sequentially using the given blend mode.
 * Returns the first color if only one is provided.
 */
export function blendMultipleColors(colors: string[], mode: BlendMode): string {
  if (colors.length === 0) return '#888888';
  if (colors.length === 1) return colors[0];

  let result = colors[0];
  for (let i = 1; i < colors.length; i++) {
    result = blendColors(result, colors[i], mode);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Overlap detection
// ---------------------------------------------------------------------------

/**
 * Safely convert a MultiPolygon feature into individual Polygon features.
 * If already a Polygon, returns it wrapped in an array.
 */
function toPolygons(feature: Feature<Polygon | MultiPolygon>): Feature<Polygon>[] {
  if (feature.geometry.type === 'Polygon') {
    return [feature as Feature<Polygon>];
  }
  return feature.geometry.coordinates.map((coords) => ({
    type: 'Feature' as const,
    properties: feature.properties,
    geometry: { type: 'Polygon' as const, coordinates: coords },
  }));
}

/**
 * Detect overlapping regions between an array of territory features.
 *
 * For performance, only pairwise intersections are computed.
 * Features that share no area are skipped.
 */
export function detectOverlaps(territories: TerritoryFeature[]): OverlapRegion[] {
  if (territories.length < 2) return [];

  const overlaps: OverlapRegion[] = [];
  const polygons: { territory: TerritoryFeature; poly: Feature<Polygon> }[] = [];

  // Flatten all territories into individual polygons
  for (const t of territories) {
    for (const poly of toPolygons(t.feature)) {
      polygons.push({ territory: t, poly });
    }
  }

  // Pairwise intersection
  for (let i = 0; i < polygons.length; i++) {
    for (let j = i + 1; j < polygons.length; j++) {
      const a = polygons[i];
      const b = polygons[j];

      // Skip same-territory polygons
      if (a.territory.id === b.territory.id) continue;

      // Quick bbox check
      const bboxA = turf.bbox(a.poly);
      const bboxB = turf.bbox(b.poly);
      if (
        bboxA[2] < bboxB[0] || bboxB[2] < bboxA[0] ||
        bboxA[3] < bboxB[1] || bboxB[3] < bboxA[1]
      ) {
        continue;
      }

      try {
        const intersection = turf.intersect(
          turf.featureCollection([a.poly, b.poly]),
        );
        if (!intersection) continue;

        // Only keep Polygon results (skip Point/LineString tangencies)
        const geom = intersection.geometry;
        if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') continue;

        const resultPolygons =
          geom.type === 'Polygon'
            ? [geom as Polygon]
            : (geom as MultiPolygon).coordinates.map(
                (coords): Polygon => ({ type: 'Polygon', coordinates: coords }),
              );

        for (const poly of resultPolygons) {
          const area = turf.area({ type: 'Feature', geometry: poly, properties: {} });
          // Skip tiny slivers (< 1 km²)
          if (area < 1_000_000) continue;

          overlaps.push({
            id: `overlap-${a.territory.id}-${b.territory.id}-${overlaps.length}`,
            geometry: poly,
            sourceIds: [a.territory.id, b.territory.id],
            sourceLayerIds: [a.territory.layerId, b.territory.layerId],
            colors: [a.territory.color, b.territory.color],
            overlapCount: 2,
          });
        }
      } catch {
        // Turf intersection can fail on degenerate geometries – skip silently
      }
    }
  }

  return overlaps;
}

// ---------------------------------------------------------------------------
// SVG hatching pattern ID helpers
// ---------------------------------------------------------------------------

/** Generate a unique SVG pattern ID for a pair of overlap colors. */
export function hatchPatternId(color1: string, color2: string): string {
  return `hatch-${color1.replace('#', '')}-${color2.replace('#', '')}`;
}
