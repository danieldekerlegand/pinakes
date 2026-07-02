import { describe, it, expect } from 'vitest';
import {
  CORE_PALETTE,
  INTERACTION_COLORS,
  VIS_TEXT_COLORS,
  NODE_STATE_COLORS,
  STATUS_COLORS,
  LEVEL_BG_COLORS,
  LEVEL_BORDER_COLORS,
  CONTACT_TYPE_COLORS,
  RELIGION_COLORS,
  MYTHOLOGY_COLORS,
  HAPLOGROUP_COLORS,
  COOKING_TECHNIQUE_COLORS,
  DANCE_TYPE_COLORS,
  KINSHIP_SYSTEM_COLORS,
  KINSHIP_TERM_COLORS,
  MATERIAL_CULTURE_COLORS,
  ARCHAEOLOGICAL_SITE_COLORS,
  ARCHAEOLOGICAL_CULTURE_PALETTE,
  CIVILIZATION_PALETTE,
  ROUTE_TYPE_COLORS,
  FOODWAY_MECHANISM_COLORS,
  BATTLE_COLORS,
  GENETIC_CORRELATION_COLORS,
  BOUNDARY_DRAWING_COLORS,
  REGION_COLORS,
  MUSIC_REGION_COLORS,
  ARCHITECTURE_REGION_COLORS,
  SLIDER_COLORS,
  RELATIONSHIP_COLORS,
  LANGUAGE_CONTACT_COLORS,
  hexToRgba,
  hashIndex,
  paletteColor,
  domainColor,
  correlationColor,
} from './color-theme';

const HEX_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

function allHex(obj: Record<string, string> | readonly string[]) {
  const values = Array.isArray(obj) ? obj : Object.values(obj);
  for (const v of values) {
    expect(v).toMatch(HEX_RE);
  }
}

describe('color-theme palettes', () => {
  it('CORE_PALETTE has 10 valid hex colors', () => {
    expect(CORE_PALETTE).toHaveLength(10);
    allHex(CORE_PALETTE);
  });

  it('LEVEL_BG_COLORS and LEVEL_BORDER_COLORS have matching lengths', () => {
    expect(LEVEL_BG_COLORS.length).toBe(LEVEL_BORDER_COLORS.length);
    allHex(LEVEL_BG_COLORS);
    allHex(LEVEL_BORDER_COLORS);
  });

  it('ARCHAEOLOGICAL_CULTURE_PALETTE has 10 colors', () => {
    expect(ARCHAEOLOGICAL_CULTURE_PALETTE).toHaveLength(10);
    allHex(ARCHAEOLOGICAL_CULTURE_PALETTE);
  });

  it('CIVILIZATION_PALETTE has 6 colors', () => {
    expect(CIVILIZATION_PALETTE).toHaveLength(6);
    allHex(CIVILIZATION_PALETTE);
  });

  it.each([
    ['INTERACTION_COLORS', INTERACTION_COLORS],
    ['VIS_TEXT_COLORS', VIS_TEXT_COLORS],
    ['NODE_STATE_COLORS', NODE_STATE_COLORS],
    ['STATUS_COLORS', STATUS_COLORS],
    ['CONTACT_TYPE_COLORS', CONTACT_TYPE_COLORS],
    ['LANGUAGE_CONTACT_COLORS', LANGUAGE_CONTACT_COLORS],
    ['RELATIONSHIP_COLORS', RELATIONSHIP_COLORS],
    ['RELIGION_COLORS', RELIGION_COLORS],
    ['MYTHOLOGY_COLORS', MYTHOLOGY_COLORS],
    ['HAPLOGROUP_COLORS', HAPLOGROUP_COLORS],
    ['COOKING_TECHNIQUE_COLORS', COOKING_TECHNIQUE_COLORS],
    ['DANCE_TYPE_COLORS', DANCE_TYPE_COLORS],
    ['KINSHIP_SYSTEM_COLORS', KINSHIP_SYSTEM_COLORS],
    ['KINSHIP_TERM_COLORS', KINSHIP_TERM_COLORS],
    ['MATERIAL_CULTURE_COLORS', MATERIAL_CULTURE_COLORS],
    ['ARCHAEOLOGICAL_SITE_COLORS', ARCHAEOLOGICAL_SITE_COLORS],
    ['ROUTE_TYPE_COLORS', ROUTE_TYPE_COLORS],
    ['FOODWAY_MECHANISM_COLORS', FOODWAY_MECHANISM_COLORS],
    ['BATTLE_COLORS', BATTLE_COLORS],
    ['GENETIC_CORRELATION_COLORS', GENETIC_CORRELATION_COLORS],
    ['BOUNDARY_DRAWING_COLORS', BOUNDARY_DRAWING_COLORS],
    ['REGION_COLORS', REGION_COLORS],
    ['MUSIC_REGION_COLORS', MUSIC_REGION_COLORS],
    ['ARCHITECTURE_REGION_COLORS', ARCHITECTURE_REGION_COLORS],
    ['SLIDER_COLORS', SLIDER_COLORS],
  ])('%s contains only valid hex colors', (_name, map) => {
    allHex(map as Record<string, string>);
  });
});

describe('hexToRgba', () => {
  it('converts hex to rgba', () => {
    expect(hexToRgba('#3b82f6', 0.5)).toBe('rgba(59, 130, 246, 0.5)');
  });

  it('handles full opacity', () => {
    expect(hexToRgba('#000000', 1)).toBe('rgba(0, 0, 0, 1)');
  });

  it('handles white', () => {
    expect(hexToRgba('#ffffff', 0)).toBe('rgba(255, 255, 255, 0)');
  });
});

describe('hashIndex', () => {
  it('returns a value in range [0, paletteLength)', () => {
    for (const key of ['English', 'Indo-European', '日本語', '', 'x']) {
      const idx = hashIndex(key, 10);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(10);
    }
  });

  it('is deterministic', () => {
    expect(hashIndex('test', 10)).toBe(hashIndex('test', 10));
  });

  it('distributes different keys', () => {
    const indices = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k) => hashIndex(k, 10)),
    );
    expect(indices.size).toBeGreaterThan(1);
  });
});

describe('paletteColor', () => {
  it('returns a color from the palette', () => {
    const color = paletteColor('Indo-European', CORE_PALETTE);
    expect(CORE_PALETTE).toContain(color);
  });

  it('is deterministic', () => {
    expect(paletteColor('foo', CORE_PALETTE)).toBe(paletteColor('foo', CORE_PALETTE));
  });
});

describe('domainColor', () => {
  it('returns the mapped color when key exists', () => {
    expect(domainColor(STATUS_COLORS, 'living')).toBe('#10b981');
  });

  it('returns fallback for unknown key', () => {
    expect(domainColor(STATUS_COLORS, 'nonexistent')).toBe(INTERACTION_COLORS.defaultFallback);
  });

  it('allows custom fallback', () => {
    expect(domainColor(STATUS_COLORS, 'nonexistent', '#111111')).toBe('#111111');
  });
});

describe('correlationColor', () => {
  it('returns divergence color when isDivergence is true', () => {
    expect(correlationColor(0.9, true)).toBe(GENETIC_CORRELATION_COLORS.divergence);
  });

  it('returns strong color for score >= 0.7', () => {
    expect(correlationColor(0.8, false)).toBe(GENETIC_CORRELATION_COLORS.strong);
  });

  it('returns moderate color for score >= 0.4', () => {
    expect(correlationColor(0.5, false)).toBe(GENETIC_CORRELATION_COLORS.moderate);
  });

  it('returns weak color for score < 0.4', () => {
    expect(correlationColor(0.2, false)).toBe(GENETIC_CORRELATION_COLORS.weak);
  });

  it('handles boundary values', () => {
    expect(correlationColor(0.7, false)).toBe(GENETIC_CORRELATION_COLORS.strong);
    expect(correlationColor(0.4, false)).toBe(GENETIC_CORRELATION_COLORS.moderate);
  });
});
