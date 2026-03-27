import { describe, it, expect } from 'vitest';
import {
  getLifecycleState,
  capitalPulse,
  type SettlementLifecyclePhase,
} from '@/lib/visualization/settlement-lifecycle';

// Re-define Settlement type locally for test data (mirrors the component's interface)
interface Settlement {
  id: string;
  name: string;
  alternateNames: string[];
  latitude: number;
  longitude: number;
  type: string;
  cultureId: string;
  civilizationId: string;
  foundedYear: number | null;
  abandonedYear: number | null;
  peakPopulation: number | null;
  notableFeatures: string[];
  associatedLanguages: string[];
  modernName: string;
  region: string;
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

function makeSettlement(overrides: Partial<Settlement> = {}): Settlement {
  return {
    id: 'test-city',
    name: 'Test City',
    alternateNames: [],
    latitude: 32.0,
    longitude: 44.0,
    type: 'city-state',
    cultureId: 'sumerian',
    civilizationId: 'sumerian',
    foundedYear: -3000,
    abandonedYear: -1500,
    peakPopulation: 50000,
    notableFeatures: ['Great Temple'],
    associatedLanguages: ['sux'],
    modernName: 'Test Site',
    region: 'Mesopotamia',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getLifecycleState
// ---------------------------------------------------------------------------

describe('getLifecycleState', () => {
  it('returns hidden before founding', () => {
    const result = getLifecycleState(-3000, -1500, -3500);
    expect(result.phase).toBe('hidden');
    expect(result.visibility).toBe(0);
  });

  it('returns founding phase during transition window', () => {
    // Founded at -3000, transition window is 50 years, so -2980 is 20 years in
    const result = getLifecycleState(-3000, -1500, -2980);
    expect(result.phase).toBe('founding');
    expect(result.visibility).toBeGreaterThan(0);
    expect(result.visibility).toBeLessThan(1);
    // 20/50 = 0.4
    expect(result.visibility).toBeCloseTo(0.4, 5);
  });

  it('returns active phase during main lifetime', () => {
    const result = getLifecycleState(-3000, -1500, -2000);
    expect(result.phase).toBe('active');
    expect(result.visibility).toBe(1);
  });

  it('returns abandoning phase near end of life', () => {
    // Abandoned at -1500, transition starts 50 years before = -1550
    // At -1520, there are 20 years left → visibility = 20/50 = 0.4
    const result = getLifecycleState(-3000, -1500, -1520);
    expect(result.phase).toBe('abandoning');
    expect(result.visibility).toBeCloseTo(0.4, 5);
  });

  it('returns destroyed phase right after abandonment', () => {
    const result = getLifecycleState(-3000, -1500, -1495);
    expect(result.phase).toBe('destroyed');
    expect(result.visibility).toBe(0.8);
  });

  it('returns hidden after destruction burst', () => {
    // Burst window is 20 years after abandonment
    const result = getLifecycleState(-3000, -1500, -1470);
    expect(result.phase).toBe('hidden');
    expect(result.visibility).toBe(0);
  });

  it('handles null foundedYear as always active', () => {
    const result = getLifecycleState(null, null, -5000);
    expect(result.phase).toBe('active');
    expect(result.visibility).toBe(1);
  });

  it('handles null abandonedYear as never abandoned', () => {
    const result = getLifecycleState(-3000, null, 2000);
    expect(result.phase).toBe('active');
    expect(result.visibility).toBe(1);
  });

  it('founding visibility increases linearly', () => {
    const v1 = getLifecycleState(-3000, -1500, -2990).visibility;
    const v2 = getLifecycleState(-3000, -1500, -2975).visibility;
    const v3 = getLifecycleState(-3000, -1500, -2960).visibility;
    expect(v2).toBeGreaterThan(v1);
    expect(v3).toBeGreaterThan(v2);
  });

  it('abandoning visibility decreases as year approaches abandonedYear', () => {
    const v1 = getLifecycleState(-3000, -1500, -1545).visibility;
    const v2 = getLifecycleState(-3000, -1500, -1520).visibility;
    const v3 = getLifecycleState(-3000, -1500, -1505).visibility;
    expect(v1).toBeGreaterThan(v2);
    expect(v2).toBeGreaterThan(v3);
  });

  it('exact founding year starts the founding phase', () => {
    const result = getLifecycleState(-3000, -1500, -3000);
    expect(result.phase).toBe('founding');
    expect(result.visibility).toBe(0);
  });

  it('exact abandonment year starts destroyed phase', () => {
    const result = getLifecycleState(-3000, -1500, -1500);
    expect(result.phase).toBe('destroyed');
    expect(result.visibility).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// capitalPulse
// ---------------------------------------------------------------------------

describe('capitalPulse', () => {
  it('returns 1.0 when reducedMotion is true', () => {
    expect(capitalPulse(-3000, true)).toBe(1.0);
    expect(capitalPulse(-2500, true)).toBe(1.0);
    expect(capitalPulse(0, true)).toBe(1.0);
  });

  it('returns value between 0.7 and 1.0 when reducedMotion is false', () => {
    for (let year = -5000; year <= 2000; year += 137) {
      const pulse = capitalPulse(year, false);
      expect(pulse).toBeGreaterThanOrEqual(0.7);
      expect(pulse).toBeLessThanOrEqual(1.0);
    }
  });

  it('varies across different years', () => {
    const values = new Set<number>();
    for (let year = 0; year < 100; year += 10) {
      values.add(Math.round(capitalPulse(year, false) * 1000));
    }
    // Should have at least a few distinct values
    expect(values.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Settlement type interface validation
// ---------------------------------------------------------------------------

describe('Settlement interface', () => {
  it('supports all expected settlement types', () => {
    const types = ['city-state', 'capital', 'religious-center', 'trading-post', 'fortress', 'port', 'colony', 'burial'];
    types.forEach((type) => {
      const s = makeSettlement({ type });
      expect(s.type).toBe(type);
    });
  });

  it('supports settlements with all null optional fields', () => {
    const s = makeSettlement({
      foundedYear: null,
      abandonedYear: null,
      peakPopulation: null,
    });
    const { phase } = getLifecycleState(s.foundedYear, s.abandonedYear, -2000);
    expect(phase).toBe('active');
  });

  it('supports negative (BCE) years', () => {
    const s = makeSettlement({ foundedYear: -6000, abandonedYear: -612 });
    expect(getLifecycleState(s.foundedYear, s.abandonedYear, -4000).phase).toBe('active');
    expect(getLifecycleState(s.foundedYear, s.abandonedYear, -7000).phase).toBe('hidden');
  });

  it('supports positive (CE) years', () => {
    const s = makeSettlement({ foundedYear: 330, abandonedYear: 1453 });
    expect(getLifecycleState(s.foundedYear, s.abandonedYear, 1000).phase).toBe('active');
    expect(getLifecycleState(s.foundedYear, s.abandonedYear, 200).phase).toBe('hidden');
  });
});

// ---------------------------------------------------------------------------
// Lifecycle phase transitions are ordered correctly
// ---------------------------------------------------------------------------

describe('lifecycle phase ordering', () => {
  it('transitions through all phases in chronological order', () => {
    const founded = -3000;
    const abandoned = -1500;
    const expectedPhases: SettlementLifecyclePhase[] = [
      'hidden', 'founding', 'active', 'abandoning', 'destroyed', 'hidden',
    ];
    const testYears = [-4000, -2980, -2000, -1520, -1490, -1400];

    testYears.forEach((year, i) => {
      const { phase } = getLifecycleState(founded, abandoned, year);
      expect(phase).toBe(expectedPhases[i]);
    });
  });

  it('no gaps in visibility — founding ends where active begins', () => {
    const founded = -3000;
    const abandoned = -1500;
    // End of founding transition = foundedYear + 50 = -2950
    const endOfFounding = getLifecycleState(founded, abandoned, -2951);
    const startOfActive = getLifecycleState(founded, abandoned, -2950);
    expect(endOfFounding.phase).toBe('founding');
    expect(startOfActive.phase).toBe('active');
    expect(endOfFounding.visibility).toBeCloseTo(0.98, 1);
    expect(startOfActive.visibility).toBe(1);
  });
});
