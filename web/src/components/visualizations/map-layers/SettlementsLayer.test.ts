import { describe, it, expect } from 'vitest';
import type { SettlementFeature } from './SettlementsLayer';

// ── helpers (pure-function tests — no DOM / React needed) ──────────

/** Replicates the populationToRadius logic from the component. */
function populationToRadius(pop: number | null): number {
  if (!pop || pop <= 0) return 5;
  const log = Math.log10(pop);
  return Math.min(18, Math.max(5, 2 + log * 3));
}

function typeLabel(type: string): string {
  return type
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatYear(year: number | null): string {
  if (year === null || year === undefined) return 'unknown';
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

function formatPopulation(pop: number | null): string {
  if (!pop) return 'unknown';
  if (pop >= 1_000_000) return `~${(pop / 1_000_000).toFixed(1)}M`;
  if (pop >= 1_000) return `~${(pop / 1_000).toFixed(0)}K`;
  return `~${pop}`;
}

/** Replicates the visibility filter. */
function isVisible(s: SettlementFeature, currentYear: number): boolean {
  if (s.foundedYear !== null && s.foundedYear > currentYear) return false;
  if (s.abandonedYear !== null && s.abandonedYear < currentYear) return false;
  return true;
}

// ── Sample data ──────────────────────────────────────────────────────

const SAMPLE_SETTLEMENTS: SettlementFeature[] = [
  {
    id: 'ur',
    name: 'Ur',
    alternateNames: ['Urim'],
    latitude: 30.962,
    longitude: 46.103,
    type: 'city-state',
    cultureId: 'sumerian',
    civilizationId: 'sumerian',
    foundedYear: -3800,
    abandonedYear: null,
    peakPopulation: 65000,
    notableFeatures: ['Great Ziggurat', 'Royal Tombs'],
    associatedLanguages: ['sux', 'akk'],
    modernName: 'Tell el-Muqayyar',
    region: 'Mesopotamia',
  },
  {
    id: 'uruk',
    name: 'Uruk',
    alternateNames: ['Warka', 'Erech'],
    latitude: 31.322,
    longitude: 45.636,
    type: 'city-state',
    cultureId: 'sumerian',
    civilizationId: 'sumerian',
    foundedYear: -4000,
    abandonedYear: 700,
    peakPopulation: 80000,
    notableFeatures: ['White Temple', 'earliest writing tablets'],
    associatedLanguages: ['sux'],
    modernName: 'Warka',
    region: 'Mesopotamia',
  },
  {
    id: 'babylon',
    name: 'Babylon',
    alternateNames: ['Bab-ilim', 'Babel'],
    latitude: 32.536,
    longitude: 44.421,
    type: 'capital',
    cultureId: '',
    civilizationId: 'babylonian-empire',
    foundedYear: -2300,
    abandonedYear: null,
    peakPopulation: 200000,
    notableFeatures: ['Ishtar Gate', 'Hanging Gardens'],
    associatedLanguages: ['akk', 'arc'],
    modernName: 'Hillah',
    region: 'Mesopotamia',
  },
  {
    id: 'tyre',
    name: 'Tyre',
    alternateNames: ['Sor'],
    latitude: 33.27,
    longitude: 35.196,
    type: 'port',
    cultureId: 'phoenician',
    civilizationId: 'phoenician',
    foundedYear: -2750,
    abandonedYear: null,
    peakPopulation: 40000,
    notableFeatures: ['Purple dye production'],
    associatedLanguages: ['phn'],
    modernName: 'Sur',
    region: 'Levant',
  },
];

// ── Tests ────────────────────────────────────────────────────────────

describe('SettlementsLayer helpers', () => {
  describe('populationToRadius', () => {
    it('returns minimum radius for null/zero population', () => {
      expect(populationToRadius(null)).toBe(5);
      expect(populationToRadius(0)).toBe(5);
      expect(populationToRadius(-1)).toBe(5);
    });

    it('scales with population (log scale)', () => {
      const small = populationToRadius(1000);   // log10=3 → 2+9=11
      const large = populationToRadius(100000); // log10=5 → 2+15=17
      expect(large).toBeGreaterThan(small);
    });

    it('clamps to max radius 18', () => {
      expect(populationToRadius(10_000_000)).toBe(18);
    });

    it('returns at least 5 for very small populations', () => {
      expect(populationToRadius(1)).toBeGreaterThanOrEqual(5);
    });
  });

  describe('typeLabel', () => {
    it('capitalizes simple types', () => {
      expect(typeLabel('capital')).toBe('Capital');
      expect(typeLabel('port')).toBe('Port');
    });

    it('capitalizes hyphenated types', () => {
      expect(typeLabel('city-state')).toBe('City State');
      expect(typeLabel('trading-post')).toBe('Trading Post');
      expect(typeLabel('religious-center')).toBe('Religious Center');
    });
  });

  describe('formatYear', () => {
    it('formats BCE years', () => {
      expect(formatYear(-3800)).toBe('3800 BCE');
    });

    it('formats CE years', () => {
      expect(formatYear(700)).toBe('700 CE');
    });

    it('returns "unknown" for null', () => {
      expect(formatYear(null)).toBe('unknown');
    });
  });

  describe('formatPopulation', () => {
    it('formats millions', () => {
      expect(formatPopulation(1_500_000)).toBe('~1.5M');
    });

    it('formats thousands', () => {
      expect(formatPopulation(65000)).toBe('~65K');
    });

    it('formats small numbers directly', () => {
      expect(formatPopulation(500)).toBe('~500');
    });

    it('returns "unknown" for null/zero', () => {
      expect(formatPopulation(null)).toBe('unknown');
      expect(formatPopulation(0)).toBe('unknown');
    });
  });
});

describe('SettlementsLayer visibility filter', () => {
  it('shows settlements founded before or at current year', () => {
    const ur = SAMPLE_SETTLEMENTS[0]; // founded -3800
    expect(isVisible(ur, -3000)).toBe(true);
    expect(isVisible(ur, -3800)).toBe(true);
  });

  it('hides settlements not yet founded', () => {
    const ur = SAMPLE_SETTLEMENTS[0]; // founded -3800
    expect(isVisible(ur, -4000)).toBe(false);
  });

  it('hides abandoned settlements after their end year', () => {
    const uruk = SAMPLE_SETTLEMENTS[1]; // abandoned 700
    expect(isVisible(uruk, 500)).toBe(true);
    expect(isVisible(uruk, 700)).toBe(true);
    expect(isVisible(uruk, 701)).toBe(false);
  });

  it('shows settlements with no abandonment date at any future year', () => {
    const babylon = SAMPLE_SETTLEMENTS[2]; // abandonedYear: null
    expect(isVisible(babylon, 2024)).toBe(true);
  });

  it('filters correctly for a specific year', () => {
    // At year -3500: Uruk (founded -4000) and Ur (founded -3800) exist
    // Babylon (founded -2300) doesn't exist yet
    const visible = SAMPLE_SETTLEMENTS.filter((s) => isVisible(s, -3500));
    const ids = visible.map((s) => s.id);
    expect(ids).toContain('ur');
    expect(ids).toContain('uruk');
    expect(ids).not.toContain('babylon');
  });
});

describe('SettlementFeature data shape', () => {
  it('has required coordinate fields', () => {
    for (const s of SAMPLE_SETTLEMENTS) {
      expect(typeof s.latitude).toBe('number');
      expect(typeof s.longitude).toBe('number');
      expect(s.latitude).toBeGreaterThanOrEqual(-90);
      expect(s.latitude).toBeLessThanOrEqual(90);
      expect(s.longitude).toBeGreaterThanOrEqual(-180);
      expect(s.longitude).toBeLessThanOrEqual(180);
    }
  });

  it('has valid type field', () => {
    const validTypes = ['city-state', 'capital', 'trading-post', 'religious-center', 'fortress', 'port', 'colony'];
    for (const s of SAMPLE_SETTLEMENTS) {
      expect(validTypes).toContain(s.type);
    }
  });

  it('has arrays for list fields', () => {
    for (const s of SAMPLE_SETTLEMENTS) {
      expect(Array.isArray(s.alternateNames)).toBe(true);
      expect(Array.isArray(s.notableFeatures)).toBe(true);
      expect(Array.isArray(s.associatedLanguages)).toBe(true);
    }
  });
});
