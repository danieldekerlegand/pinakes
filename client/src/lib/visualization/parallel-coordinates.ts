/**
 * Data transformation utilities for parallel coordinates visualization.
 * Converts raw multi-dimensional data into a format suitable for D3 rendering.
 */

export interface ParallelCoordinatesDimension {
  key: string;
  label: string;
  type: 'numeric' | 'categorical';
  domain?: [number, number]; // for numeric
  categories?: string[]; // for categorical
}

export interface ParallelCoordinatesDataPoint {
  id: string;
  label: string;
  group?: string;
  values: Record<string, number | string | null>;
}

export interface ParallelCoordinatesData {
  dimensions: ParallelCoordinatesDimension[];
  dataPoints: ParallelCoordinatesDataPoint[];
}

/**
 * Infer dimension metadata from raw data points.
 * Detects numeric vs categorical and computes domains/categories.
 */
export function inferDimensions(
  dataPoints: ParallelCoordinatesDataPoint[],
  dimensionKeys: string[],
  labels?: Record<string, string>
): ParallelCoordinatesDimension[] {
  return dimensionKeys.map((key) => {
    const values = dataPoints
      .map((d) => d.values[key])
      .filter((v) => v !== null && v !== undefined);

    const numericValues = values.filter((v) => typeof v === 'number') as number[];
    const isNumeric = numericValues.length > values.length * 0.5;

    if (isNumeric && numericValues.length > 0) {
      const min = Math.min(...numericValues);
      const max = Math.max(...numericValues);
      return {
        key,
        label: labels?.[key] ?? key,
        type: 'numeric' as const,
        domain: [min, max === min ? max + 1 : max] as [number, number],
      };
    }

    const categories = Array.from(new Set(values.map(String))).sort();
    return {
      key,
      label: labels?.[key] ?? key,
      type: 'categorical' as const,
      categories,
    };
  });
}

/**
 * Normalize a value to [0, 1] range for a given dimension.
 */
export function normalizeValue(
  value: number | string | null,
  dimension: ParallelCoordinatesDimension
): number | null {
  if (value === null || value === undefined) return null;

  if (dimension.type === 'numeric') {
    const num = typeof value === 'number' ? value : parseFloat(String(value));
    if (isNaN(num) || !dimension.domain) return null;
    const [min, max] = dimension.domain;
    if (max === min) return 0.5;
    return (num - min) / (max - min);
  }

  if (dimension.categories) {
    const idx = dimension.categories.indexOf(String(value));
    if (idx === -1) return null;
    const count = dimension.categories.length;
    return count <= 1 ? 0.5 : idx / (count - 1);
  }

  return null;
}

/**
 * Compute the normalized path coordinates for a single data point.
 * Returns array of [dimensionIndex, normalizedValue] pairs, skipping nulls.
 */
export function computePath(
  dataPoint: ParallelCoordinatesDataPoint,
  dimensions: ParallelCoordinatesDimension[]
): Array<[number, number]> {
  const path: Array<[number, number]> = [];
  for (let i = 0; i < dimensions.length; i++) {
    const dim = dimensions[i];
    const raw = dataPoint.values[dim.key];
    const norm = normalizeValue(raw, dim);
    if (norm !== null) {
      path.push([i, norm]);
    }
  }
  return path;
}

/**
 * Filter data points that have a value within a range on a specific dimension.
 * Range is in normalized [0, 1] space.
 */
export function filterByBrush(
  dataPoints: ParallelCoordinatesDataPoint[],
  dimensions: ParallelCoordinatesDimension[],
  brushes: Record<string, [number, number]>
): ParallelCoordinatesDataPoint[] {
  const brushKeys = Object.keys(brushes);
  if (brushKeys.length === 0) return dataPoints;

  return dataPoints.filter((point) => {
    return brushKeys.every((key) => {
      const dim = dimensions.find((d) => d.key === key);
      if (!dim) return true;
      const norm = normalizeValue(point.values[key], dim);
      if (norm === null) return false;
      const [lo, hi] = brushes[key];
      return norm >= lo && norm <= hi;
    });
  });
}

/**
 * Build a complete ParallelCoordinatesData object from raw records.
 */
export function buildParallelCoordinatesData(
  records: Array<Record<string, any>>,
  dimensionKeys: string[],
  options?: {
    idKey?: string;
    labelKey?: string;
    groupKey?: string;
    dimensionLabels?: Record<string, string>;
  }
): ParallelCoordinatesData {
  const idKey = options?.idKey ?? 'id';
  const labelKey = options?.labelKey ?? 'name';
  const groupKey = options?.groupKey;

  const dataPoints: ParallelCoordinatesDataPoint[] = records.map((record, i) => ({
    id: String(record[idKey] ?? i),
    label: String(record[labelKey] ?? `Item ${i}`),
    group: groupKey ? String(record[groupKey] ?? '') : undefined,
    values: Object.fromEntries(
      dimensionKeys.map((key) => [key, record[key] ?? null])
    ),
  }));

  const dimensions = inferDimensions(
    dataPoints,
    dimensionKeys,
    options?.dimensionLabels
  );

  return { dimensions, dataPoints };
}
