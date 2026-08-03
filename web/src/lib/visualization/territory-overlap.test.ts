import { describe, it, expect } from 'vitest';
import type { Feature, Polygon } from 'geojson';
import type { BlendMode } from './geospatial-types';
import {
  hexToRgb,
  rgbToHex,
  blendColors,
  blendMultipleColors,
  detectOverlaps,
  hatchPatternId,
  type TerritoryFeature,
} from './territory-overlap';

// ---------------------------------------------------------------------------
// hexToRgb / rgbToHex
// ---------------------------------------------------------------------------

describe('hexToRgb', () => {
  it('parses 6-digit hex', () => {
    expect(hexToRgb('#ff0000')).toEqual([255, 0, 0]);
    expect(hexToRgb('#00ff00')).toEqual([0, 255, 0]);
    expect(hexToRgb('#0000ff')).toEqual([0, 0, 255]);
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255]);
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
  });

  it('parses 3-digit shorthand hex', () => {
    expect(hexToRgb('#f00')).toEqual([255, 0, 0]);
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
  });

  it('handles mixed-case hex', () => {
    expect(hexToRgb('#FF8800')).toEqual([255, 136, 0]);
    expect(hexToRgb('#aaBBcc')).toEqual([170, 187, 204]);
  });
});

describe('rgbToHex', () => {
  it('converts RGB to hex', () => {
    expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
    expect(rgbToHex(0, 255, 0)).toBe('#00ff00');
    expect(rgbToHex(0, 0, 255)).toBe('#0000ff');
  });

  it('clamps out-of-range values', () => {
    expect(rgbToHex(300, -10, 128)).toBe('#ff0080');
  });

  it('rounds fractional values', () => {
    expect(rgbToHex(127.6, 0, 0)).toBe('#800000');
  });
});

// ---------------------------------------------------------------------------
// blendColors
// ---------------------------------------------------------------------------

describe('blendColors', () => {
  it('normal mode returns top color', () => {
    expect(blendColors('#ff0000', '#00ff00', 'normal')).toBe('#00ff00');
  });

  it('multiply mode darkens', () => {
    // red * green = black
    expect(blendColors('#ff0000', '#00ff00', 'multiply')).toBe('#000000');

    // white * any = any
    expect(blendColors('#ffffff', '#3b82f6', 'multiply')).toBe('#3b82f6');

    // any * black = black
    expect(blendColors('#ff8800', '#000000', 'multiply')).toBe('#000000');
  });

  it('screen mode brightens', () => {
    // red screen green = yellow
    expect(blendColors('#ff0000', '#00ff00', 'screen')).toBe('#ffff00');

    // black screen any = any
    expect(blendColors('#000000', '#3b82f6', 'screen')).toBe('#3b82f6');
  });

  it('overlay mode increases contrast', () => {
    // overlay with white on mid-gray
    const result = blendColors('#808080', '#ffffff', 'overlay');
    // overlay(0.5, 1) = 1 - 2*(1-0.5)*(1-1) = 1
    expect(result).toBe('#ffffff');
  });

  it('is symmetric for multiply', () => {
    const a = blendColors('#ff8800', '#0088ff', 'multiply');
    const b = blendColors('#0088ff', '#ff8800', 'multiply');
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// blendMultipleColors
// ---------------------------------------------------------------------------

describe('blendMultipleColors', () => {
  it('returns default for empty array', () => {
    expect(blendMultipleColors([], 'multiply')).toBe('#888888');
  });

  it('returns single color unchanged', () => {
    expect(blendMultipleColors(['#ff0000'], 'multiply')).toBe('#ff0000');
  });

  it('blends three colors sequentially', () => {
    const result = blendMultipleColors(['#ffffff', '#ff0000', '#00ff00'], 'multiply');
    // white * red = red, red * green = black
    expect(result).toBe('#000000');
  });

  it('screen of two complementary colors yields brighter result', () => {
    const result = blendMultipleColors(['#ff0000', '#00ffff'], 'screen');
    expect(result).toBe('#ffffff');
  });
});

// ---------------------------------------------------------------------------
// detectOverlaps
// ---------------------------------------------------------------------------

function makeSquare(west: number, south: number, east: number, north: number): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ]],
    },
  };
}

describe('detectOverlaps', () => {
  it('returns empty for fewer than 2 territories', () => {
    expect(detectOverlaps([])).toEqual([]);
    expect(
      detectOverlaps([
        { id: 'a', layerId: 'l1', color: '#ff0000', feature: makeSquare(0, 0, 10, 10) },
      ]),
    ).toEqual([]);
  });

  it('detects overlap between two overlapping squares', () => {
    const territories: TerritoryFeature[] = [
      { id: 'a', layerId: 'l1', color: '#ff0000', feature: makeSquare(0, 0, 10, 10) },
      { id: 'b', layerId: 'l2', color: '#00ff00', feature: makeSquare(5, 5, 15, 15) },
    ];

    const overlaps = detectOverlaps(territories);
    expect(overlaps.length).toBeGreaterThanOrEqual(1);

    const overlap = overlaps[0];
    expect(overlap.sourceIds).toContain('a');
    expect(overlap.sourceIds).toContain('b');
    expect(overlap.colors).toContain('#ff0000');
    expect(overlap.colors).toContain('#00ff00');
    expect(overlap.overlapCount).toBe(2);
    expect(overlap.geometry.type).toBe('Polygon');
  });

  it('returns empty for non-overlapping territories', () => {
    const territories: TerritoryFeature[] = [
      { id: 'a', layerId: 'l1', color: '#ff0000', feature: makeSquare(0, 0, 5, 5) },
      { id: 'b', layerId: 'l2', color: '#00ff00', feature: makeSquare(10, 10, 15, 15) },
    ];

    const overlaps = detectOverlaps(territories);
    expect(overlaps).toEqual([]);
  });

  it('handles multiple pairwise overlaps', () => {
    const territories: TerritoryFeature[] = [
      { id: 'a', layerId: 'l1', color: '#ff0000', feature: makeSquare(0, 0, 10, 10) },
      { id: 'b', layerId: 'l2', color: '#00ff00', feature: makeSquare(5, 0, 15, 10) },
      { id: 'c', layerId: 'l3', color: '#0000ff', feature: makeSquare(8, 0, 18, 10) },
    ];

    const overlaps = detectOverlaps(territories);
    // Should find a-b overlap and b-c overlap, possibly a-c overlap
    expect(overlaps.length).toBeGreaterThanOrEqual(2);
  });

  it('skips same-territory polygons', () => {
    const territories: TerritoryFeature[] = [
      { id: 'a', layerId: 'l1', color: '#ff0000', feature: makeSquare(0, 0, 10, 10) },
      { id: 'a', layerId: 'l1', color: '#ff0000', feature: makeSquare(5, 5, 15, 15) },
    ];

    const overlaps = detectOverlaps(territories);
    expect(overlaps).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// hatchPatternId
// ---------------------------------------------------------------------------

describe('hatchPatternId', () => {
  it('produces deterministic IDs', () => {
    const id1 = hatchPatternId('#ff0000', '#00ff00');
    const id2 = hatchPatternId('#ff0000', '#00ff00');
    expect(id1).toBe(id2);
  });

  it('strips # from color codes', () => {
    const id = hatchPatternId('#aabbcc', '#112233');
    expect(id).toBe('hatch-aabbcc-112233');
    expect(id).not.toContain('#');
  });
});
