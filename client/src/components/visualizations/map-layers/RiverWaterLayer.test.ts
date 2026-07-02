import { describe, it, expect } from 'vitest';
import type { RiverWaterFeature } from './RiverWaterLayer';

// ── helpers (pure-function tests — no DOM / React needed) ──────────

function getWaterColor(waterType: string): string {
  const WATER_TYPE_COLORS: Record<string, string> = {
    river: '#2563eb',
    lake: '#0ea5e9',
    sea: '#06b6d4',
    strait: '#0891b2',
    canal: '#6366f1',
  };
  return WATER_TYPE_COLORS[waterType] ?? WATER_TYPE_COLORS.river;
}

function getLineWeight(waterType: string, lengthKm: number | null): number {
  const baseWeight: Record<string, number> = {
    river: 2,
    lake: 2,
    sea: 3,
    strait: 2,
    canal: 1.5,
  };
  let weight = baseWeight[waterType] ?? 2;

  if (waterType === 'river' && lengthKm !== null && lengthKm > 0) {
    if (lengthKm >= 5000) weight = 4;
    else if (lengthKm >= 2000) weight = 3;
    else if (lengthKm >= 500) weight = 2.5;
  }

  return weight;
}

function isVisibleAtYear(feature: RiverWaterFeature, currentYear: number): boolean {
  if (feature.timeStart !== null && feature.timeStart > currentYear) return false;
  if (feature.timeEnd !== null && feature.timeEnd < currentYear) return false;
  return true;
}

function formatWaterType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// ── Sample data ──────────────────────────────────────────────────────

const SAMPLE_FEATURES: RiverWaterFeature[] = [
  {
    id: 'nile',
    name: 'Nile',
    alternateNames: ['Iteru', 'Hapi'],
    waterType: 'river',
    coordinates: [[31.5, 31.2], [31.4, 30.0], [32.9, 21.9]],
    lengthKm: 6650,
    region: 'Northeast Africa',
    timeStart: -10000,
    timeEnd: null,
    historicalImportance: 'settlement-hub',
    associatedCivilizations: ['ancient-egypt'],
    associatedLanguages: ['egy', 'cop'],
    modernName: 'Nile',
    description: 'Longest river in Africa',
  },
  {
    id: 'suez-canal',
    name: 'Suez Canal',
    alternateNames: [],
    waterType: 'canal',
    coordinates: [[32.3, 31.3], [32.3, 30.6], [32.5, 30.0]],
    lengthKm: 193,
    region: 'Middle East',
    timeStart: 1859,
    timeEnd: null,
    historicalImportance: 'trade-route',
    associatedCivilizations: [],
    associatedLanguages: ['arb', 'fra', 'eng'],
    modernName: 'Suez Canal',
    description: 'Artificial waterway',
  },
  {
    id: 'dead-sea',
    name: 'Dead Sea',
    alternateNames: ['Sea of Salt'],
    waterType: 'lake',
    coordinates: [[35.5, 31.5], [35.5, 31.3], [35.5, 31.2], [35.4, 31.5]],
    lengthKm: null,
    region: 'Levant',
    timeStart: -10000,
    timeEnd: null,
    historicalImportance: 'boundary',
    associatedCivilizations: ['israelite'],
    associatedLanguages: ['heb', 'arb'],
    modernName: 'Dead Sea',
    description: 'Lowest point on Earth',
  },
  {
    id: 'mediterranean',
    name: 'Mediterranean Sea',
    alternateNames: ['Mare Nostrum'],
    waterType: 'sea',
    coordinates: [[5.5, 43.3], [15.0, 37.0], [35.0, 35.0]],
    lengthKm: null,
    region: 'Mediterranean',
    timeStart: -10000,
    timeEnd: null,
    historicalImportance: 'trade-route',
    associatedCivilizations: ['roman-empire', 'greek'],
    associatedLanguages: ['lat', 'grc'],
    modernName: 'Mediterranean Sea',
    description: 'Center of ancient Western civilization',
  },
];

// ── Tests ────────────────────────────────────────────────────────────

describe('RiverWaterLayer helpers', () => {
  describe('getWaterColor', () => {
    it('returns correct color for each water type', () => {
      expect(getWaterColor('river')).toBe('#2563eb');
      expect(getWaterColor('lake')).toBe('#0ea5e9');
      expect(getWaterColor('sea')).toBe('#06b6d4');
      expect(getWaterColor('strait')).toBe('#0891b2');
      expect(getWaterColor('canal')).toBe('#6366f1');
    });

    it('falls back to river color for unknown types', () => {
      expect(getWaterColor('unknown')).toBe('#2563eb');
      expect(getWaterColor('')).toBe('#2563eb');
    });
  });

  describe('getLineWeight', () => {
    it('returns base weight for non-river types', () => {
      expect(getLineWeight('sea', null)).toBe(3);
      expect(getLineWeight('strait', null)).toBe(2);
      expect(getLineWeight('canal', null)).toBe(1.5);
    });

    it('scales river weight by length', () => {
      expect(getLineWeight('river', 100)).toBe(2);     // small river
      expect(getLineWeight('river', 500)).toBe(2.5);   // medium
      expect(getLineWeight('river', 2000)).toBe(3);    // large
      expect(getLineWeight('river', 6650)).toBe(4);    // very large (Nile)
    });

    it('returns base weight for rivers with no length', () => {
      expect(getLineWeight('river', null)).toBe(2);
      expect(getLineWeight('river', 0)).toBe(2);
    });

    it('defaults to 2 for unknown types', () => {
      expect(getLineWeight('unknown', null)).toBe(2);
    });
  });

  describe('formatWaterType', () => {
    it('capitalizes water types', () => {
      expect(formatWaterType('river')).toBe('River');
      expect(formatWaterType('lake')).toBe('Lake');
      expect(formatWaterType('sea')).toBe('Sea');
      expect(formatWaterType('strait')).toBe('Strait');
      expect(formatWaterType('canal')).toBe('Canal');
    });
  });
});

describe('RiverWaterLayer visibility filter', () => {
  it('shows features that exist at the current year', () => {
    const nile = SAMPLE_FEATURES[0]; // timeStart: -10000, timeEnd: null
    expect(isVisibleAtYear(nile, -5000)).toBe(true);
    expect(isVisibleAtYear(nile, 2024)).toBe(true);
  });

  it('hides features not yet existing', () => {
    const suez = SAMPLE_FEATURES[1]; // timeStart: 1859
    expect(isVisibleAtYear(suez, 1800)).toBe(false);
    expect(isVisibleAtYear(suez, 1859)).toBe(true);
    expect(isVisibleAtYear(suez, 2024)).toBe(true);
  });

  it('shows features with null timeEnd at any future year', () => {
    const nile = SAMPLE_FEATURES[0]; // timeEnd: null
    expect(isVisibleAtYear(nile, 2024)).toBe(true);
    expect(isVisibleAtYear(nile, 9999)).toBe(true);
  });

  it('filters correctly for a specific year', () => {
    // At year 1800: Nile, Dead Sea, Mediterranean exist; Suez Canal doesn't
    const visible = SAMPLE_FEATURES.filter((f) => isVisibleAtYear(f, 1800));
    const ids = visible.map((f) => f.id);
    expect(ids).toContain('nile');
    expect(ids).toContain('dead-sea');
    expect(ids).toContain('mediterranean');
    expect(ids).not.toContain('suez-canal');
  });

  it('hides features before their start year', () => {
    const nile = SAMPLE_FEATURES[0]; // timeStart: -10000
    expect(isVisibleAtYear(nile, -10000)).toBe(true);
    expect(isVisibleAtYear(nile, -10001)).toBe(false);
  });
});

describe('RiverWaterFeature data shape', () => {
  it('has required coordinate arrays', () => {
    for (const f of SAMPLE_FEATURES) {
      expect(Array.isArray(f.coordinates)).toBe(true);
      expect(f.coordinates.length).toBeGreaterThanOrEqual(2);
      for (const coord of f.coordinates) {
        expect(coord).toHaveLength(2);
        expect(typeof coord[0]).toBe('number');
        expect(typeof coord[1]).toBe('number');
      }
    }
  });

  it('has valid water type field', () => {
    const validTypes = ['river', 'lake', 'sea', 'strait', 'canal'];
    for (const f of SAMPLE_FEATURES) {
      expect(validTypes).toContain(f.waterType);
    }
  });

  it('has arrays for list fields', () => {
    for (const f of SAMPLE_FEATURES) {
      expect(Array.isArray(f.alternateNames)).toBe(true);
      expect(Array.isArray(f.associatedCivilizations)).toBe(true);
      expect(Array.isArray(f.associatedLanguages)).toBe(true);
    }
  });

  it('has non-negative lengthKm or null', () => {
    for (const f of SAMPLE_FEATURES) {
      if (f.lengthKm !== null) {
        expect(f.lengthKm).toBeGreaterThan(0);
      }
    }
  });
});
