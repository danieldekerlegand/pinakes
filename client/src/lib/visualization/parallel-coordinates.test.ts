import { describe, it, expect } from 'vitest';
import {
  inferDimensions,
  normalizeValue,
  computePath,
  filterByBrush,
  buildParallelCoordinatesData,
  type ParallelCoordinatesDimension,
  type ParallelCoordinatesDataPoint,
} from './parallel-coordinates';

// ============================================================================
// Test Helpers
// ============================================================================

function makePoint(
  id: string,
  values: Record<string, number | string | null>,
  group?: string
): ParallelCoordinatesDataPoint {
  return { id, label: id, group, values };
}

const samplePoints: ParallelCoordinatesDataPoint[] = [
  makePoint('a', { speakers: 1000, status: 'living', region: 'Europe' }, 'indo-european'),
  makePoint('b', { speakers: 5000, status: 'endangered', region: 'Asia' }, 'sino-tibetan'),
  makePoint('c', { speakers: 200, status: 'extinct', region: 'Europe' }, 'indo-european'),
  makePoint('d', { speakers: 3000, status: 'living', region: 'Africa' }, 'niger-congo'),
];

// ============================================================================
// inferDimensions
// ============================================================================

describe('inferDimensions', () => {
  it('detects numeric dimensions with correct domain', () => {
    const dims = inferDimensions(samplePoints, ['speakers']);
    expect(dims).toHaveLength(1);
    expect(dims[0].type).toBe('numeric');
    expect(dims[0].domain).toEqual([200, 5000]);
  });

  it('detects categorical dimensions with sorted categories', () => {
    const dims = inferDimensions(samplePoints, ['status']);
    expect(dims).toHaveLength(1);
    expect(dims[0].type).toBe('categorical');
    expect(dims[0].categories).toEqual(['endangered', 'extinct', 'living']);
  });

  it('uses custom labels when provided', () => {
    const dims = inferDimensions(samplePoints, ['speakers'], {
      speakers: 'Total Speakers',
    });
    expect(dims[0].label).toBe('Total Speakers');
  });

  it('falls back to key as label', () => {
    const dims = inferDimensions(samplePoints, ['speakers']);
    expect(dims[0].label).toBe('speakers');
  });

  it('handles multiple dimensions', () => {
    const dims = inferDimensions(samplePoints, ['speakers', 'status', 'region']);
    expect(dims).toHaveLength(3);
    expect(dims[0].type).toBe('numeric');
    expect(dims[1].type).toBe('categorical');
    expect(dims[2].type).toBe('categorical');
  });

  it('handles all-null values as categorical with empty categories', () => {
    const points = [makePoint('x', { val: null })];
    const dims = inferDimensions(points, ['val']);
    expect(dims[0].type).toBe('categorical');
    expect(dims[0].categories).toEqual([]);
  });

  it('adds +1 to max when min equals max for numeric', () => {
    const points = [makePoint('x', { val: 5 }), makePoint('y', { val: 5 })];
    const dims = inferDimensions(points, ['val']);
    expect(dims[0].domain).toEqual([5, 6]);
  });
});

// ============================================================================
// normalizeValue
// ============================================================================

describe('normalizeValue', () => {
  const numericDim: ParallelCoordinatesDimension = {
    key: 'speakers',
    label: 'Speakers',
    type: 'numeric',
    domain: [0, 1000],
  };

  const catDim: ParallelCoordinatesDimension = {
    key: 'status',
    label: 'Status',
    type: 'categorical',
    categories: ['endangered', 'extinct', 'living'],
  };

  it('normalizes numeric values to [0, 1]', () => {
    expect(normalizeValue(0, numericDim)).toBe(0);
    expect(normalizeValue(500, numericDim)).toBe(0.5);
    expect(normalizeValue(1000, numericDim)).toBe(1);
  });

  it('normalizes categorical values by index position', () => {
    expect(normalizeValue('endangered', catDim)).toBe(0);
    expect(normalizeValue('extinct', catDim)).toBe(0.5);
    expect(normalizeValue('living', catDim)).toBe(1);
  });

  it('returns null for null input', () => {
    expect(normalizeValue(null, numericDim)).toBeNull();
    expect(normalizeValue(null, catDim)).toBeNull();
  });

  it('returns null for unknown categorical value', () => {
    expect(normalizeValue('unknown', catDim)).toBeNull();
  });

  it('returns 0.5 for single-category dimension', () => {
    const singleCat: ParallelCoordinatesDimension = {
      key: 'x',
      label: 'x',
      type: 'categorical',
      categories: ['only'],
    };
    expect(normalizeValue('only', singleCat)).toBe(0.5);
  });

  it('returns 0.5 for equal min/max numeric dimension', () => {
    const flatDim: ParallelCoordinatesDimension = {
      key: 'x',
      label: 'x',
      type: 'numeric',
      domain: [5, 5],
    };
    expect(normalizeValue(5, flatDim)).toBe(0.5);
  });
});

// ============================================================================
// computePath
// ============================================================================

describe('computePath', () => {
  const dims: ParallelCoordinatesDimension[] = [
    { key: 'a', label: 'A', type: 'numeric', domain: [0, 100] },
    { key: 'b', label: 'B', type: 'numeric', domain: [0, 10] },
    { key: 'c', label: 'C', type: 'categorical', categories: ['x', 'y'] },
  ];

  it('returns normalized [dimIndex, value] pairs', () => {
    const point = makePoint('p', { a: 50, b: 5, c: 'y' });
    const path = computePath(point, dims);
    expect(path).toEqual([
      [0, 0.5],
      [1, 0.5],
      [2, 1],
    ]);
  });

  it('skips dimensions with null values', () => {
    const point = makePoint('p', { a: 100, b: null, c: 'x' });
    const path = computePath(point, dims);
    expect(path).toEqual([
      [0, 1],
      [2, 0],
    ]);
  });

  it('returns empty array when all values are null', () => {
    const point = makePoint('p', { a: null, b: null, c: null });
    const path = computePath(point, dims);
    expect(path).toEqual([]);
  });
});

// ============================================================================
// filterByBrush
// ============================================================================

describe('filterByBrush', () => {
  const dims = inferDimensions(samplePoints, ['speakers', 'status']);

  it('returns all points when no brushes active', () => {
    const result = filterByBrush(samplePoints, dims, {});
    expect(result).toHaveLength(4);
  });

  it('filters by numeric brush range', () => {
    // speakers domain is [200, 5000], so normalize 1000 = (1000-200)/(5000-200) ≈ 0.167
    // and 3500 ≈ (3500-200)/4800 ≈ 0.688
    const result = filterByBrush(samplePoints, dims, {
      speakers: [0.15, 0.7],
    });
    // Should include speakers=1000 (0.167) and speakers=3000 (0.583)
    const ids = result.map((r) => r.id);
    expect(ids).toContain('a'); // 1000
    expect(ids).toContain('d'); // 3000
    expect(ids).not.toContain('c'); // 200 -> 0.0, below 0.15
  });

  it('filters by categorical brush range', () => {
    // categories sorted: ['endangered', 'extinct', 'living'] -> indices 0, 0.5, 1
    const result = filterByBrush(samplePoints, dims, {
      status: [0.4, 0.6], // should only include 'extinct' (0.5)
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c');
  });

  it('supports multiple simultaneous brushes (AND logic)', () => {
    const result = filterByBrush(samplePoints, dims, {
      speakers: [0, 0.5],
      status: [0.9, 1.0], // 'living' only
    });
    // speakers <= ~2600 AND status = 'living' => only 'a' (speakers=1000, status=living)
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });
});

// ============================================================================
// buildParallelCoordinatesData
// ============================================================================

describe('buildParallelCoordinatesData', () => {
  const records = [
    { id: 'lang1', name: 'English', family: 'IE', speakers: 1500000000, vowels: 12 },
    { id: 'lang2', name: 'Mandarin', family: 'ST', speakers: 900000000, vowels: 9 },
    { id: 'lang3', name: 'Swahili', family: 'NC', speakers: 100000000, vowels: 5 },
  ];

  it('builds complete data from records', () => {
    const result = buildParallelCoordinatesData(records, ['speakers', 'vowels'], {
      groupKey: 'family',
      dimensionLabels: { speakers: 'Total Speakers', vowels: 'Vowel Count' },
    });

    expect(result.dimensions).toHaveLength(2);
    expect(result.dimensions[0].label).toBe('Total Speakers');
    expect(result.dimensions[1].label).toBe('Vowel Count');
    expect(result.dataPoints).toHaveLength(3);
    expect(result.dataPoints[0].group).toBe('IE');
    expect(result.dataPoints[0].values.speakers).toBe(1500000000);
  });

  it('uses index as id when no id key present', () => {
    const noIdRecords = [{ val: 1 }, { val: 2 }];
    const result = buildParallelCoordinatesData(noIdRecords, ['val']);
    expect(result.dataPoints[0].id).toBe('0');
    expect(result.dataPoints[1].id).toBe('1');
  });

  it('handles missing values as null', () => {
    const sparse = [{ id: '1', name: 'A', x: 10 }, { id: '2', name: 'B' }];
    const result = buildParallelCoordinatesData(sparse, ['x']);
    expect(result.dataPoints[1].values.x).toBeNull();
  });
});
