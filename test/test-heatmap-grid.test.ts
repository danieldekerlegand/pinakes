import { describe, it, expect } from 'vitest';

/**
 * Unit tests for HeatmapGrid component logic.
 * Tests the data transformation and color scale logic used by the component.
 */

// Reproduce the core logic from HeatmapGrid for testability
import * as d3 from 'd3';

function buildColorScale(
  data: (number | null)[][],
  colorScheme: 'sequential' | 'diverging',
  colorRange?: string[],
  domain?: [number, number],
) {
  const flat = data.flat().filter((v): v is number => v !== null);
  if (flat.length === 0) {
    return { colorScale: () => '#e5e7eb', minVal: 0, maxVal: 0 };
  }
  const min = domain?.[0] ?? d3.min(flat)!;
  const max = domain?.[1] ?? d3.max(flat)!;

  if (colorScheme === 'diverging') {
    const absMax = Math.max(Math.abs(min), Math.abs(max));
    const colors = colorRange ?? ['#2563eb', '#f5f5f5', '#dc2626'];
    const scale = d3.scaleLinear<string>()
      .domain([-absMax, 0, absMax])
      .range(colors)
      .clamp(true);
    return { colorScale: scale as (v: number) => string, minVal: -absMax, maxVal: absMax };
  }

  const colors = colorRange ?? ['#f0f9ff', '#1e40af'];
  const scale = d3.scaleLinear<string>()
    .domain([min, max])
    .range(colors)
    .clamp(true);
  return { colorScale: scale as (v: number) => string, minVal: min, maxVal: max };
}

function computeCellSize(width: number, numCols: number) {
  const MARGIN_LEFT = 120;
  const MARGIN_RIGHT = 20;
  const MIN_CELL_SIZE = 14;
  const MAX_CELL_SIZE = 60;
  if (width === 0 || numCols === 0) return MIN_CELL_SIZE;
  const availableWidth = width - MARGIN_LEFT - MARGIN_RIGHT;
  const size = Math.floor(availableWidth / numCols);
  return Math.max(MIN_CELL_SIZE, Math.min(MAX_CELL_SIZE, size));
}

describe('HeatmapGrid color scale logic', () => {
  it('should build a sequential color scale from data', () => {
    const data = [[0, 5], [10, 15]];
    const { colorScale, minVal, maxVal } = buildColorScale(data, 'sequential');
    expect(minVal).toBe(0);
    expect(maxVal).toBe(15);
    // Low values should be lighter, high values darker
    const lowColor = colorScale(0);
    const highColor = colorScale(15);
    expect(lowColor).not.toBe(highColor);
  });

  it('should handle all-null data', () => {
    const data: (number | null)[][] = [[null, null], [null, null]];
    const { colorScale, minVal, maxVal } = buildColorScale(data, 'sequential');
    expect(minVal).toBe(0);
    expect(maxVal).toBe(0);
    expect(colorScale(0)).toBe('#e5e7eb');
  });

  it('should handle mixed null and numeric data', () => {
    const data: (number | null)[][] = [[null, 3], [7, null]];
    const { minVal, maxVal } = buildColorScale(data, 'sequential');
    expect(minVal).toBe(3);
    expect(maxVal).toBe(7);
  });

  it('should build a diverging color scale', () => {
    const data = [[-5, 0], [3, 8]];
    const { colorScale, minVal, maxVal } = buildColorScale(data, 'diverging');
    // absMax = max(5, 8) = 8
    expect(minVal).toBe(-8);
    expect(maxVal).toBe(8);
    const negColor = colorScale(-8);
    const midColor = colorScale(0);
    const posColor = colorScale(8);
    expect(negColor).not.toBe(midColor);
    expect(midColor).not.toBe(posColor);
  });

  it('should respect custom domain', () => {
    const data = [[1, 2], [3, 4]];
    const { minVal, maxVal } = buildColorScale(data, 'sequential', undefined, [0, 10]);
    expect(minVal).toBe(0);
    expect(maxVal).toBe(10);
  });

  it('should respect custom color range for sequential', () => {
    const data = [[0, 10]];
    const { colorScale } = buildColorScale(data, 'sequential', ['#000000', '#ffffff']);
    const low = colorScale(0);
    const high = colorScale(10);
    expect(low).toMatch(/rgb/);
    expect(high).toMatch(/rgb/);
    expect(low).not.toBe(high);
  });
});

describe('HeatmapGrid cell size computation', () => {
  it('should return MIN_CELL_SIZE when width is 0', () => {
    expect(computeCellSize(0, 10)).toBe(14);
  });

  it('should return MIN_CELL_SIZE when numCols is 0', () => {
    expect(computeCellSize(800, 0)).toBe(14);
  });

  it('should compute cell size based on available width', () => {
    // available = 800 - 120 - 20 = 660, 660/10 = 66 -> clamped to 60
    expect(computeCellSize(800, 10)).toBe(60);
  });

  it('should clamp to MIN_CELL_SIZE for many columns', () => {
    // available = 300 - 120 - 20 = 160, 160/100 = 1 -> clamped to 14
    expect(computeCellSize(300, 100)).toBe(14);
  });

  it('should compute reasonable sizes for typical grids', () => {
    // available = 600 - 120 - 20 = 460, 460/20 = 23
    expect(computeCellSize(600, 20)).toBe(23);
  });
});

describe('HeatmapGrid data validation', () => {
  it('should handle single-cell matrix', () => {
    const data = [[42]];
    const { minVal, maxVal } = buildColorScale(data, 'sequential');
    expect(minVal).toBe(42);
    expect(maxVal).toBe(42);
  });

  it('should handle large matrix dimensions', () => {
    const rows = 50;
    const cols = 50;
    const data = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => r * cols + c),
    );
    const { minVal, maxVal } = buildColorScale(data, 'sequential');
    expect(minVal).toBe(0);
    expect(maxVal).toBe(rows * cols - 1);
  });

  it('should handle negative values in sequential mode', () => {
    const data = [[-10, -5], [-2, 0]];
    const { minVal, maxVal } = buildColorScale(data, 'sequential');
    expect(minVal).toBe(-10);
    expect(maxVal).toBe(0);
  });
});
