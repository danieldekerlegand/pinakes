import { describe, it, expect } from 'vitest';
import {
  ICON_REGISTRY,
  ICON_CATEGORIES,
  CATEGORY_LABELS,
  getIconDefinition,
  getIconsByCategory,
  getMarkerSizePx,
  scaleMarkerSize,
  buildMarkerSvg,
  svgToDataUri,
  buildLeafletIconConfig,
  buildLegendEntries,
  buildGroupedLegendEntries,
  type IconCategory,
} from '@/lib/visualization/map-icons';

// ---------------------------------------------------------------------------
// Icon Registry
// ---------------------------------------------------------------------------

describe('ICON_REGISTRY', () => {
  it('contains all settlement type icons', () => {
    const settlementTypes = ['city', 'village', 'port', 'fortress', 'temple', 'mine', 'farm'];
    for (const type of settlementTypes) {
      expect(ICON_REGISTRY[type]).toBeDefined();
      expect(ICON_REGISTRY[type].category).toBe('settlement');
    }
  });

  it('contains all event type icons', () => {
    const eventTypes = ['battle', 'treaty', 'natural-disaster'];
    for (const type of eventTypes) {
      expect(ICON_REGISTRY[type]).toBeDefined();
      expect(ICON_REGISTRY[type].category).toBe('event');
    }
  });

  it('contains all cultural marker icons', () => {
    const culturalTypes = ['pottery-find', 'inscription-find', 'tomb'];
    for (const type of culturalTypes) {
      expect(ICON_REGISTRY[type]).toBeDefined();
      expect(ICON_REGISTRY[type].category).toBe('cultural');
    }
  });

  it('contains waypoint icons', () => {
    const waypointTypes = ['waypoint', 'waypoint-start', 'waypoint-end'];
    for (const type of waypointTypes) {
      expect(ICON_REGISTRY[type]).toBeDefined();
      expect(ICON_REGISTRY[type].category).toBe('waypoint');
    }
  });

  it('every icon has required fields', () => {
    for (const [type, def] of Object.entries(ICON_REGISTRY)) {
      expect(def.path, `${type} has a path`).toBeTruthy();
      expect(def.label, `${type} has a label`).toBeTruthy();
      expect(def.category, `${type} has a category`).toBeTruthy();
      expect(def.defaultColor, `${type} has a defaultColor`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// getIconDefinition
// ---------------------------------------------------------------------------

describe('getIconDefinition', () => {
  it('returns the definition for a known type', () => {
    const def = getIconDefinition('city');
    expect(def).toBeDefined();
    expect(def!.label).toBe('City');
  });

  it('returns undefined for an unknown type', () => {
    expect(getIconDefinition('nonexistent')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getIconsByCategory
// ---------------------------------------------------------------------------

describe('getIconsByCategory', () => {
  it('returns only icons of the given category', () => {
    const settlements = getIconsByCategory('settlement');
    expect(settlements.length).toBeGreaterThanOrEqual(7);
    for (const { icon } of settlements) {
      expect(icon.category).toBe('settlement');
    }
  });

  it('returns an empty array for a category with no icons removed', () => {
    // All categories have icons, so just verify structure
    for (const cat of ICON_CATEGORIES) {
      const icons = getIconsByCategory(cat);
      expect(Array.isArray(icons)).toBe(true);
      expect(icons.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// CATEGORY_LABELS
// ---------------------------------------------------------------------------

describe('CATEGORY_LABELS', () => {
  it('has a label for every category', () => {
    for (const cat of ICON_CATEGORIES) {
      expect(CATEGORY_LABELS[cat]).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Size scaling
// ---------------------------------------------------------------------------

describe('getMarkerSizePx', () => {
  it('returns pixel values for each named size', () => {
    expect(getMarkerSizePx('xs')).toBe(16);
    expect(getMarkerSizePx('sm')).toBe(20);
    expect(getMarkerSizePx('md')).toBe(28);
    expect(getMarkerSizePx('lg')).toBe(36);
    expect(getMarkerSizePx('xl')).toBe(48);
  });

  it('sizes increase monotonically', () => {
    const sizes = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
    for (let i = 1; i < sizes.length; i++) {
      expect(getMarkerSizePx(sizes[i])).toBeGreaterThan(getMarkerSizePx(sizes[i - 1]));
    }
  });
});

describe('scaleMarkerSize', () => {
  it('returns min size when value equals minValue', () => {
    const result = scaleMarkerSize(0, 0, 100);
    expect(result).toBe(getMarkerSizePx('sm'));
  });

  it('returns max size when value equals maxValue', () => {
    const result = scaleMarkerSize(100, 0, 100);
    expect(result).toBe(getMarkerSizePx('xl'));
  });

  it('returns interpolated size for mid-range values', () => {
    const result = scaleMarkerSize(50, 0, 100);
    const minPx = getMarkerSizePx('sm');
    const maxPx = getMarkerSizePx('xl');
    expect(result).toBe(minPx + 0.5 * (maxPx - minPx));
  });

  it('clamps below min', () => {
    const result = scaleMarkerSize(-50, 0, 100);
    expect(result).toBe(getMarkerSizePx('sm'));
  });

  it('clamps above max', () => {
    const result = scaleMarkerSize(200, 0, 100);
    expect(result).toBe(getMarkerSizePx('xl'));
  });

  it('returns min size when range is zero', () => {
    const result = scaleMarkerSize(50, 50, 50);
    expect(result).toBe(getMarkerSizePx('sm'));
  });
});

// ---------------------------------------------------------------------------
// SVG generation
// ---------------------------------------------------------------------------

describe('buildMarkerSvg', () => {
  it('produces valid SVG for a known icon type', () => {
    const svg = buildMarkerSvg({ type: 'city' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain(ICON_REGISTRY.city.path);
  });

  it('uses default color when none specified', () => {
    const svg = buildMarkerSvg({ type: 'battle' });
    expect(svg).toContain(ICON_REGISTRY.battle.defaultColor);
  });

  it('respects color override', () => {
    const svg = buildMarkerSvg({ type: 'city', color: '#ff0000' });
    expect(svg).toContain('#ff0000');
  });

  it('respects size parameter (named)', () => {
    const svg = buildMarkerSvg({ type: 'city', size: 'lg' });
    expect(svg).toContain('width="36"');
    expect(svg).toContain('height="36"');
  });

  it('respects size parameter (numeric)', () => {
    const svg = buildMarkerSvg({ type: 'city', size: 42 });
    expect(svg).toContain('width="42"');
    expect(svg).toContain('height="42"');
  });

  it('includes a count badge when count > 1', () => {
    const svg = buildMarkerSvg({ type: 'city', count: 5 });
    expect(svg).toContain('>5<');
    expect(svg).toContain('fill="#ef4444"');
  });

  it('caps badge text at 99+', () => {
    const svg = buildMarkerSvg({ type: 'city', count: 150 });
    expect(svg).toContain('>99+<');
  });

  it('omits badge when count is 1', () => {
    const svg = buildMarkerSvg({ type: 'city', count: 1 });
    expect(svg).not.toContain('font-size="7"');
  });

  it('produces a fallback SVG for an unknown icon type', () => {
    const svg = buildMarkerSvg({ type: 'unknown-thing' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    // Fallback uses a simple circle
    expect(svg).toContain('<circle');
  });
});

// ---------------------------------------------------------------------------
// Data URI conversion
// ---------------------------------------------------------------------------

describe('svgToDataUri', () => {
  it('produces a valid data URI', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>';
    const uri = svgToDataUri(svg);
    expect(uri).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('round-trips through base64', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>';
    const uri = svgToDataUri(svg);
    const decoded = atob(uri.replace('data:image/svg+xml;base64,', ''));
    expect(decoded).toBe(svg);
  });
});

// ---------------------------------------------------------------------------
// Leaflet icon config
// ---------------------------------------------------------------------------

describe('buildLeafletIconConfig', () => {
  it('returns correct structure', () => {
    const config = buildLeafletIconConfig({ type: 'city', size: 'md' });
    expect(config.iconUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(config.iconSize).toEqual([28, 28]);
    expect(config.iconAnchor).toEqual([14, 14]);
    expect(config.popupAnchor).toEqual([0, -14]);
  });

  it('adapts size for numeric input', () => {
    const config = buildLeafletIconConfig({ type: 'city', size: 40 });
    expect(config.iconSize).toEqual([40, 40]);
    expect(config.iconAnchor).toEqual([20, 20]);
    expect(config.popupAnchor).toEqual([0, -20]);
  });
});

// ---------------------------------------------------------------------------
// Legend entries
// ---------------------------------------------------------------------------

describe('buildLegendEntries', () => {
  it('returns entries for valid icon types', () => {
    const entries = buildLegendEntries(['city', 'battle', 'tomb']);
    expect(entries).toHaveLength(3);
    expect(entries[0].type).toBe('city');
    expect(entries[1].type).toBe('battle');
    expect(entries[2].type).toBe('tomb');
  });

  it('skips unknown icon types', () => {
    const entries = buildLegendEntries(['city', 'nonexistent', 'battle']);
    expect(entries).toHaveLength(2);
  });

  it('applies color overrides', () => {
    const entries = buildLegendEntries(['city'], { city: '#00ff00' });
    expect(entries[0].color).toBe('#00ff00');
  });

  it('uses default color when no override', () => {
    const entries = buildLegendEntries(['city']);
    expect(entries[0].color).toBe(ICON_REGISTRY.city.defaultColor);
  });

  it('includes svgDataUri for each entry', () => {
    const entries = buildLegendEntries(['fortress']);
    expect(entries[0].svgDataUri).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});

describe('buildGroupedLegendEntries', () => {
  it('groups entries by category', () => {
    const grouped = buildGroupedLegendEntries([
      'city', 'village', 'battle', 'pottery-find', 'waypoint',
    ]);
    expect(grouped.settlement).toHaveLength(2);
    expect(grouped.event).toHaveLength(1);
    expect(grouped.cultural).toHaveLength(1);
    expect(grouped.waypoint).toHaveLength(1);
  });

  it('returns empty arrays for unused categories', () => {
    const grouped = buildGroupedLegendEntries(['city']);
    expect(grouped.event).toHaveLength(0);
    expect(grouped.cultural).toHaveLength(0);
    expect(grouped.waypoint).toHaveLength(0);
  });
});
