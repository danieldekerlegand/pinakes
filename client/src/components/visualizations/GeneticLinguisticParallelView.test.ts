import { describe, it, expect } from 'vitest';

// Test the pure data transformation logic extracted from the view

interface Correlation {
  haplogroupId: string;
  haplogroupName: string;
  haplogroupType: string;
  languageFamilyId: string;
  languageFamilyName: string;
  overlapScore: number;
  sharedRegions: string[];
  divergence: string | null;
}

interface ParallelDatum {
  id: string;
  label: string;
  category?: string;
  values: Record<string, number | string>;
}

// Replicate the transformation logic from the component
function correlationsToParallelData(correlations: Correlation[]): ParallelDatum[] {
  return correlations.map(c => ({
    id: `${c.haplogroupId}__${c.languageFamilyId}`,
    label: `${c.haplogroupName} ↔ ${c.languageFamilyName}`,
    category: c.haplogroupType,
    values: {
      haplogroupType: c.haplogroupType,
      overlapScore: c.overlapScore,
      sharedRegionCount: c.sharedRegions.length,
      hasDivergence: c.divergence ? 'Yes' : 'No',
      languageFamily: c.languageFamilyName,
    },
  }));
}

function filterCorrelations(correlations: Correlation[], filterType: string): Correlation[] {
  if (filterType === 'all') return correlations;
  return correlations.filter(c =>
    c.haplogroupType.toLowerCase().replace('-', '') === filterType.toLowerCase().replace('-', '')
  );
}

function buildDynamicFamilyDomain(correlations: Correlation[]): string[] {
  return Array.from(new Set(correlations.map(c => c.languageFamilyName))).sort();
}

const SAMPLE_CORRELATIONS: Correlation[] = [
  {
    haplogroupId: 'r1b',
    haplogroupName: 'R1b',
    haplogroupType: 'Y-DNA',
    languageFamilyId: 'indo-european',
    languageFamilyName: 'Indo-European',
    overlapScore: 0.85,
    sharedRegions: ['Western Europe', 'Central Europe'],
    divergence: null,
  },
  {
    haplogroupId: 'n',
    haplogroupName: 'N',
    haplogroupType: 'Y-DNA',
    languageFamilyId: 'uralic',
    languageFamilyName: 'Uralic',
    overlapScore: 0.72,
    sharedRegions: ['Northern Europe'],
    divergence: 'Finno-Ugric N haplogroup divergence',
  },
  {
    haplogroupId: 'h',
    haplogroupName: 'H',
    haplogroupType: 'mtDNA',
    languageFamilyId: 'indo-european',
    languageFamilyName: 'Indo-European',
    overlapScore: 0.6,
    sharedRegions: ['Europe'],
    divergence: null,
  },
  {
    haplogroupId: 'o',
    haplogroupName: 'O',
    haplogroupType: 'Y-DNA',
    languageFamilyId: 'sino-tibetan',
    languageFamilyName: 'Sino-Tibetan',
    overlapScore: 0.9,
    sharedRegions: ['East Asia', 'Southeast Asia'],
    divergence: null,
  },
];

describe('correlationsToParallelData', () => {
  it('transforms correlations into parallel coordinate data', () => {
    const result = correlationsToParallelData(SAMPLE_CORRELATIONS);
    expect(result).toHaveLength(4);
    expect(result[0].id).toBe('r1b__indo-european');
    expect(result[0].label).toBe('R1b ↔ Indo-European');
    expect(result[0].category).toBe('Y-DNA');
  });

  it('maps values correctly for each axis', () => {
    const result = correlationsToParallelData(SAMPLE_CORRELATIONS);
    const first = result[0];
    expect(first.values.haplogroupType).toBe('Y-DNA');
    expect(first.values.overlapScore).toBe(0.85);
    expect(first.values.sharedRegionCount).toBe(2);
    expect(first.values.hasDivergence).toBe('No');
    expect(first.values.languageFamily).toBe('Indo-European');
  });

  it('marks divergence correctly', () => {
    const result = correlationsToParallelData(SAMPLE_CORRELATIONS);
    expect(result[1].values.hasDivergence).toBe('Yes');
    expect(result[0].values.hasDivergence).toBe('No');
    expect(result[2].values.hasDivergence).toBe('No');
  });

  it('handles empty input', () => {
    expect(correlationsToParallelData([])).toEqual([]);
  });

  it('counts shared regions correctly', () => {
    const result = correlationsToParallelData(SAMPLE_CORRELATIONS);
    expect(result[0].values.sharedRegionCount).toBe(2); // Western Europe, Central Europe
    expect(result[1].values.sharedRegionCount).toBe(1); // Northern Europe
    expect(result[3].values.sharedRegionCount).toBe(2); // East Asia, Southeast Asia
  });
});

describe('filterCorrelations', () => {
  it('returns all correlations when filter is "all"', () => {
    const result = filterCorrelations(SAMPLE_CORRELATIONS, 'all');
    expect(result).toHaveLength(4);
  });

  it('filters by Y-DNA', () => {
    const result = filterCorrelations(SAMPLE_CORRELATIONS, 'ydna');
    expect(result).toHaveLength(3);
    expect(result.every(c => c.haplogroupType === 'Y-DNA')).toBe(true);
  });

  it('filters by mtDNA', () => {
    const result = filterCorrelations(SAMPLE_CORRELATIONS, 'mtdna');
    expect(result).toHaveLength(1);
    expect(result[0].haplogroupType).toBe('mtDNA');
  });

  it('handles case-insensitive filter with hyphen', () => {
    const result = filterCorrelations(SAMPLE_CORRELATIONS, 'Y-DNA');
    expect(result).toHaveLength(3);
  });

  it('returns empty for non-matching filter', () => {
    const result = filterCorrelations(SAMPLE_CORRELATIONS, 'xdna');
    expect(result).toHaveLength(0);
  });
});

describe('buildDynamicFamilyDomain', () => {
  it('extracts unique sorted family names', () => {
    const result = buildDynamicFamilyDomain(SAMPLE_CORRELATIONS);
    expect(result).toEqual(['Indo-European', 'Sino-Tibetan', 'Uralic']);
  });

  it('deduplicates family names', () => {
    // Indo-European appears twice in sample data
    const result = buildDynamicFamilyDomain(SAMPLE_CORRELATIONS);
    expect(result.filter(n => n === 'Indo-European')).toHaveLength(1);
  });

  it('handles empty input', () => {
    expect(buildDynamicFamilyDomain([])).toEqual([]);
  });

  it('sorts alphabetically', () => {
    const result = buildDynamicFamilyDomain(SAMPLE_CORRELATIONS);
    const sorted = [...result].sort();
    expect(result).toEqual(sorted);
  });
});
