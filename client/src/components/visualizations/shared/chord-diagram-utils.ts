/**
 * Utility functions for the ChordDiagram component.
 * Extracted for testability and reuse.
 */

const DEFAULT_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
  '#6366f1', '#84cc16',
];

/** Default color assignment by index, cycling through a palette */
export function defaultColorFn(index: number): string {
  return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

/** Default group (arc) tooltip text */
export function defaultGroupTooltip(name: string, value: number): string {
  return `${name}\nTotal: ${value}`;
}

/** Default ribbon (chord) tooltip text */
export function defaultRibbonTooltip(source: string, target: string, value: number): string {
  return `${source} ↔ ${target}\nValue: ${value}`;
}

/** Validate that chord data has a square matrix matching names length */
export function validateChordData(names: string[], matrix: number[][]): { valid: boolean; error?: string } {
  if (names.length === 0) {
    return { valid: false, error: 'Names array is empty' };
  }
  if (matrix.length !== names.length) {
    return { valid: false, error: `Matrix rows (${matrix.length}) must match names length (${names.length})` };
  }
  for (let i = 0; i < matrix.length; i++) {
    if (matrix[i].length !== names.length) {
      return { valid: false, error: `Matrix row ${i} has ${matrix[i].length} columns, expected ${names.length}` };
    }
  }
  return { valid: true };
}

/** Compute total value for a group (sum of row + column, minus diagonal to avoid double-counting) */
export function computeGroupTotal(matrix: number[][], index: number): number {
  let total = 0;
  for (let j = 0; j < matrix.length; j++) {
    total += matrix[index][j];
  }
  return total;
}

/** Build a chord data object from a list of relationships */
export function buildChordDataFromRelationships(
  relationships: Array<{ source: string; target: string; value: number }>,
): { names: string[]; matrix: number[][] } {
  const nameSet = new Set<string>();
  for (const r of relationships) {
    nameSet.add(r.source);
    nameSet.add(r.target);
  }
  const names = Array.from(nameSet).sort();
  const nameIndex = new Map(names.map((n, i) => [n, i]));
  const n = names.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (const r of relationships) {
    const si = nameIndex.get(r.source)!;
    const ti = nameIndex.get(r.target)!;
    matrix[si][ti] += r.value;
    matrix[ti][si] += r.value;
  }

  return { names, matrix };
}
