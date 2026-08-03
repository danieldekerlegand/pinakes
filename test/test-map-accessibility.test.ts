import { describe, it, expect } from 'vitest';
import {
  formatYearForSR,
  describeFeature,
  describeMapState,
  HIGH_CONTRAST_PALETTE,
  STANDARD_PALETTE,
  getMapPalette,
  MAP_KEYBOARD_SHORTCUTS,
} from '../web/src/lib/visualization/map-accessibility';
import type { MapFeatureType, FeatureDescriptionInput } from '../web/src/lib/visualization/map-accessibility';

// ---------------------------------------------------------------------------
// formatYearForSR
// ---------------------------------------------------------------------------

describe('formatYearForSR', () => {
  it('formats BCE years', () => {
    expect(formatYearForSR(-3500)).toBe('3500 BCE');
    expect(formatYearForSR(-1)).toBe('1 BCE');
  });

  it('formats CE years', () => {
    expect(formatYearForSR(476)).toBe('476 CE');
    expect(formatYearForSR(2024)).toBe('2024 CE');
  });

  it('formats year 0 as CE', () => {
    expect(formatYearForSR(0)).toBe('0 CE');
  });
});

// ---------------------------------------------------------------------------
// describeFeature
// ---------------------------------------------------------------------------

describe('describeFeature', () => {
  it('builds basic description with name and type', () => {
    const desc = describeFeature({ type: 'settlement', name: 'Uruk' });
    expect(desc).toBe('Settlement: Uruk');
  });

  it('includes time range when provided', () => {
    const desc = describeFeature({
      type: 'civilization',
      name: 'Roman Empire',
      timeStart: -753,
      timeEnd: 476,
    });
    expect(desc).toBe('Civilization: Roman Empire, from 753 BCE to 476 CE');
  });

  it('handles "to present" when timeEnd is null', () => {
    const desc = describeFeature({
      type: 'language-range',
      name: 'English',
      timeStart: 450,
      timeEnd: null,
    });
    expect(desc).toContain('to present');
  });

  it('includes extra properties', () => {
    const desc = describeFeature({
      type: 'settlement',
      name: 'Babylon',
      timeStart: -1894,
      timeEnd: -539,
      extra: { population: 200000, type: 'capital' },
    });
    expect(desc).toContain('population: 200000');
    expect(desc).toContain('type: capital');
  });

  it('skips empty/undefined extra values', () => {
    const desc = describeFeature({
      type: 'battle',
      name: 'Thermopylae',
      extra: { result: 'Persian victory', empty: undefined, blank: '' },
    });
    expect(desc).toContain('result: Persian victory');
    expect(desc).not.toContain('empty');
    expect(desc).not.toContain('blank');
  });

  it('hyphenated types are rendered as spaces', () => {
    const desc = describeFeature({ type: 'archaeological-site', name: 'Gobekli Tepe' });
    expect(desc).toBe('Archaeological site: Gobekli Tepe');
  });

  it('capitalizes first letter of type', () => {
    const desc = describeFeature({ type: 'route', name: 'Silk Road' });
    expect(desc).toMatch(/^Route:/);
  });
});

// ---------------------------------------------------------------------------
// describeMapState
// ---------------------------------------------------------------------------

describe('describeMapState', () => {
  it('builds a complete map state description', () => {
    const desc = describeMapState({
      visibleLayerCount: 3,
      featureCount: 150,
      currentYear: -500,
      isPlaying: false,
      zoom: 5,
    });
    expect(desc).toContain('3 layers active');
    expect(desc).toContain('150 features visible');
    expect(desc).toContain('500 BCE');
    expect(desc).toContain('paused');
    expect(desc).toContain('regional view');
  });

  it('reports playing state', () => {
    const desc = describeMapState({
      visibleLayerCount: 1,
      featureCount: 10,
      currentYear: 1000,
      isPlaying: true,
      zoom: 3,
    });
    expect(desc).toContain('playing');
  });

  it('reports world view at low zoom', () => {
    const desc = describeMapState({
      visibleLayerCount: 1,
      featureCount: 10,
      currentYear: 0,
      isPlaying: false,
      zoom: 2,
    });
    expect(desc).toContain('world view');
  });

  it('reports detailed view at high zoom', () => {
    const desc = describeMapState({
      visibleLayerCount: 1,
      featureCount: 10,
      currentYear: 0,
      isPlaying: false,
      zoom: 8,
    });
    expect(desc).toContain('detailed view');
  });
});

// ---------------------------------------------------------------------------
// Color Palettes
// ---------------------------------------------------------------------------

describe('color palettes', () => {
  it('HIGH_CONTRAST_PALETTE has all required keys', () => {
    const keys = ['languageRange', 'civilization', 'archaeologicalSite', 'route',
      'settlement', 'battle', 'religion', 'cuisine', 'haplogroup', 'deity', 'urheimat',
      'selectedOutline', 'focusRing', 'background', 'foreground', 'secondaryForeground'];
    for (const key of keys) {
      expect(HIGH_CONTRAST_PALETTE).toHaveProperty(key);
    }
  });

  it('STANDARD_PALETTE has all required keys', () => {
    const keys = Object.keys(HIGH_CONTRAST_PALETTE);
    for (const key of keys) {
      expect(STANDARD_PALETTE).toHaveProperty(key);
    }
  });

  it('all palette values are valid hex colors', () => {
    const hexPattern = /^#[0-9A-Fa-f]{6}$/;
    for (const value of Object.values(HIGH_CONTRAST_PALETTE)) {
      expect(value).toMatch(hexPattern);
    }
    for (const value of Object.values(STANDARD_PALETTE)) {
      expect(value).toMatch(hexPattern);
    }
  });

  it('getMapPalette returns high-contrast palette when enabled', () => {
    expect(getMapPalette(true)).toBe(HIGH_CONTRAST_PALETTE);
  });

  it('getMapPalette returns standard palette when disabled', () => {
    expect(getMapPalette(false)).toBe(STANDARD_PALETTE);
  });

  it('high-contrast colors differ from standard colors', () => {
    // At least some colors should be different
    let differences = 0;
    for (const key of Object.keys(HIGH_CONTRAST_PALETTE) as (keyof typeof HIGH_CONTRAST_PALETTE)[]) {
      if (HIGH_CONTRAST_PALETTE[key] !== STANDARD_PALETTE[key]) {
        differences++;
      }
    }
    expect(differences).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// Keyboard Shortcuts
// ---------------------------------------------------------------------------

describe('MAP_KEYBOARD_SHORTCUTS', () => {
  it('has at least 8 shortcuts defined', () => {
    expect(MAP_KEYBOARD_SHORTCUTS.length).toBeGreaterThanOrEqual(8);
  });

  it('each shortcut has key, label, and description', () => {
    for (const shortcut of MAP_KEYBOARD_SHORTCUTS) {
      expect(shortcut.key).toBeTruthy();
      expect(shortcut.label).toBeTruthy();
      expect(shortcut.description).toBeTruthy();
    }
  });

  it('includes Space for play/pause', () => {
    const space = MAP_KEYBOARD_SHORTCUTS.find((s) => s.key === 'Space');
    expect(space).toBeDefined();
    expect(space!.description.toLowerCase()).toContain('play');
  });

  it('includes arrow keys for timeline navigation', () => {
    const left = MAP_KEYBOARD_SHORTCUTS.find((s) => s.key === 'ArrowLeft');
    const right = MAP_KEYBOARD_SHORTCUTS.find((s) => s.key === 'ArrowRight');
    expect(left).toBeDefined();
    expect(right).toBeDefined();
  });

  it('includes h for high-contrast toggle', () => {
    const h = MAP_KEYBOARD_SHORTCUTS.find((s) => s.key === 'h');
    expect(h).toBeDefined();
    expect(h!.description.toLowerCase()).toContain('contrast');
  });

  it('includes ? for help', () => {
    const help = MAP_KEYBOARD_SHORTCUTS.find((s) => s.key === '?');
    expect(help).toBeDefined();
  });

  it('all keys are unique', () => {
    const keys = MAP_KEYBOARD_SHORTCUTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// Feature types
// ---------------------------------------------------------------------------

describe('MapFeatureType coverage', () => {
  const allTypes: MapFeatureType[] = [
    'settlement', 'civilization', 'language-range', 'archaeological-site',
    'route', 'battle', 'religion', 'cuisine', 'haplogroup', 'deity', 'urheimat',
  ];

  it('describeFeature handles all feature types', () => {
    for (const type of allTypes) {
      const desc = describeFeature({ type, name: 'Test' });
      expect(desc).toContain('Test');
    }
  });
});
