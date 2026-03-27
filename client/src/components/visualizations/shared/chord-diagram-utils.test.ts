import { describe, it, expect } from 'vitest';
import {
  defaultColorFn,
  defaultGroupTooltip,
  defaultRibbonTooltip,
  validateChordData,
  computeGroupTotal,
  buildChordDataFromRelationships,
} from './chord-diagram-utils';

describe('defaultColorFn', () => {
  it('returns a hex color for any index', () => {
    for (let i = 0; i < 15; i++) {
      expect(defaultColorFn(i)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('cycles through colors consistently', () => {
    expect(defaultColorFn(0)).toBe(defaultColorFn(10));
    expect(defaultColorFn(1)).toBe(defaultColorFn(11));
  });

  it('returns different colors for different indices within palette size', () => {
    expect(defaultColorFn(0)).not.toBe(defaultColorFn(1));
    expect(defaultColorFn(2)).not.toBe(defaultColorFn(3));
  });
});

describe('defaultGroupTooltip', () => {
  it('formats name and total', () => {
    expect(defaultGroupTooltip('English', 42)).toBe('English\nTotal: 42');
  });

  it('handles zero value', () => {
    expect(defaultGroupTooltip('Latin', 0)).toBe('Latin\nTotal: 0');
  });
});

describe('defaultRibbonTooltip', () => {
  it('formats source, target, and value', () => {
    expect(defaultRibbonTooltip('English', 'French', 15)).toBe('English ↔ French\nValue: 15');
  });
});

describe('validateChordData', () => {
  it('accepts valid square matrix', () => {
    const result = validateChordData(
      ['A', 'B', 'C'],
      [
        [0, 1, 2],
        [1, 0, 3],
        [2, 3, 0],
      ],
    );
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('rejects empty names', () => {
    const result = validateChordData([], []);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('rejects matrix row count mismatch', () => {
    const result = validateChordData(
      ['A', 'B'],
      [[0, 1, 2], [1, 0, 3], [2, 3, 0]],
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('rows');
  });

  it('rejects matrix column count mismatch', () => {
    const result = validateChordData(
      ['A', 'B'],
      [[0, 1], [1]],
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('columns');
  });

  it('accepts a 1x1 matrix', () => {
    const result = validateChordData(['A'], [[5]]);
    expect(result.valid).toBe(true);
  });
});

describe('computeGroupTotal', () => {
  const matrix = [
    [0, 5, 3],
    [5, 0, 2],
    [3, 2, 0],
  ];

  it('sums the row for the given index', () => {
    expect(computeGroupTotal(matrix, 0)).toBe(8);  // 0+5+3
    expect(computeGroupTotal(matrix, 1)).toBe(7);  // 5+0+2
    expect(computeGroupTotal(matrix, 2)).toBe(5);  // 3+2+0
  });
});

describe('buildChordDataFromRelationships', () => {
  it('builds names and symmetric matrix from relationships', () => {
    const relationships = [
      { source: 'English', target: 'French', value: 10 },
      { source: 'French', target: 'German', value: 5 },
      { source: 'English', target: 'German', value: 3 },
    ];

    const result = buildChordDataFromRelationships(relationships);

    expect(result.names).toEqual(['English', 'French', 'German']);
    expect(result.matrix.length).toBe(3);
    // Symmetric: matrix[i][j] === matrix[j][i]
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(result.matrix[i][j]).toBe(result.matrix[j][i]);
      }
    }
    // English-French = 10 in both directions
    const ei = result.names.indexOf('English');
    const fi = result.names.indexOf('French');
    expect(result.matrix[ei][fi]).toBe(10);
    expect(result.matrix[fi][ei]).toBe(10);
  });

  it('accumulates multiple relationships between same pair', () => {
    const relationships = [
      { source: 'A', target: 'B', value: 3 },
      { source: 'A', target: 'B', value: 7 },
    ];

    const result = buildChordDataFromRelationships(relationships);
    const ai = result.names.indexOf('A');
    const bi = result.names.indexOf('B');
    expect(result.matrix[ai][bi]).toBe(10);
    expect(result.matrix[bi][ai]).toBe(10);
  });

  it('handles single relationship', () => {
    const result = buildChordDataFromRelationships([
      { source: 'X', target: 'Y', value: 1 },
    ]);
    expect(result.names).toEqual(['X', 'Y']);
    expect(result.matrix).toEqual([[0, 1], [1, 0]]);
  });

  it('handles empty relationships', () => {
    const result = buildChordDataFromRelationships([]);
    expect(result.names).toEqual([]);
    expect(result.matrix).toEqual([]);
  });
});
