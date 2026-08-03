/**
 * Temporal filtering utilities for cultural entities
 * 
 * Provides functions to filter entities based on temporal validity,
 * parse time strings, and calculate temporal relationships.
 */

/**
 * Interface for entities with temporal validity
 */
export interface TemporalEntity {
  id: string;
  name?: string;
  /** Year entity became valid (negative for BCE) */
  timeOrigin?: string | number | null;
  /** Year entity ended (negative for BCE, null = present) */
  timeEnd?: string | number | null;
  /** Alternative field names */
  validFrom?: number | null;
  validTo?: number | null;
  time_period_start?: number | null;
  time_period_end?: number | null;
}

/**
 * Parse a time string into a numeric year
 * Handles various formats: "500 BCE", "-500", "1500 CE", "15th century", etc.
 * 
 * @param timeStr - The time string to parse
 * @returns The numeric year (negative for BCE) or null if unparseable
 */
export function parseTimeString(timeStr: string | number | null | undefined): number | null {
  if (timeStr === null || timeStr === undefined) {
    return null;
  }

  // Already a number
  if (typeof timeStr === 'number') {
    return timeStr;
  }

  const str = timeStr.trim().toLowerCase();
  
  if (str === '' || str === 'present' || str === 'current') {
    return null; // Represents "now" or ongoing
  }

  // Handle "X BCE" or "X BC"
  const bceMatch = str.match(/^(\d+)\s*(bce?|b\.c\.e?\.?)$/i);
  if (bceMatch) {
    return -parseInt(bceMatch[1], 10);
  }

  // Handle "X CE" or "X AD"
  const ceMatch = str.match(/^(\d+)\s*(ce?|a\.d\.?)$/i);
  if (ceMatch) {
    return parseInt(ceMatch[1], 10);
  }

  // Handle century notation: "15th century", "15th century BCE"
  const centuryMatch = str.match(/^(\d+)(?:st|nd|rd|th)\s+century\s*(bce?|b\.c\.e?\.?)?$/i);
  if (centuryMatch) {
    const century = parseInt(centuryMatch[1], 10);
    // 15th century = 1400-1500, so we use midpoint 1450
    const midpoint = (century - 1) * 100 + 50;
    return centuryMatch[2] ? -midpoint : midpoint;
  }

  // Handle ranges: "500-400 BCE" -> use start
  const rangeMatch = str.match(/^(\d+)\s*[-–—]\s*(\d+)\s*(bce?|b\.c\.e?\.?)?$/i);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    return rangeMatch[3] ? -start : start;
  }

  // Handle plain negative numbers
  if (str.startsWith('-')) {
    const num = parseInt(str, 10);
    if (!isNaN(num)) {
      return num;
    }
  }

  // Handle plain positive numbers
  const plainNum = parseInt(str, 10);
  if (!isNaN(plainNum)) {
    return plainNum;
  }

  // Handle approximate dates: "c. 500 BCE", "circa 1500"
  const circaMatch = str.match(/^(?:c\.?|circa)\s*(\d+)\s*(bce?|b\.c\.e?\.?)?$/i);
  if (circaMatch) {
    const year = parseInt(circaMatch[1], 10);
    return circaMatch[2] ? -year : year;
  }

  return null;
}

/**
 * Get the start year from an entity, checking multiple possible field names
 */
export function getEntityStartYear(entity: TemporalEntity): number | null {
  // Check various field names in order of preference
  if (entity.validFrom !== undefined && entity.validFrom !== null) {
    return entity.validFrom;
  }
  if (entity.time_period_start !== undefined && entity.time_period_start !== null) {
    return entity.time_period_start;
  }
  if (entity.timeOrigin !== undefined && entity.timeOrigin !== null) {
    return parseTimeString(entity.timeOrigin);
  }
  return null;
}

/**
 * Get the end year from an entity, checking multiple possible field names
 */
export function getEntityEndYear(entity: TemporalEntity): number | null {
  // Check various field names in order of preference
  if (entity.validTo !== undefined && entity.validTo !== null) {
    return entity.validTo;
  }
  if (entity.time_period_end !== undefined && entity.time_period_end !== null) {
    return entity.time_period_end;
  }
  if (entity.timeEnd !== undefined && entity.timeEnd !== null) {
    return parseTimeString(entity.timeEnd);
  }
  return null; // null means "present" or "ongoing"
}

/**
 * Check if an entity is valid at a specific year
 * 
 * @param entity - The entity to check
 * @param year - The year to check (negative for BCE)
 * @returns true if the entity is valid at the given year
 */
export function isEntityValidAtYear<T extends TemporalEntity>(
  entity: T,
  year: number
): boolean {
  const startYear = getEntityStartYear(entity);
  const endYear = getEntityEndYear(entity);

  // If no start year, assume entity has always existed (or data is incomplete)
  const effectiveStart = startYear ?? -Infinity;
  
  // If no end year, assume entity still exists
  const effectiveEnd = endYear ?? Infinity;

  return year >= effectiveStart && year <= effectiveEnd;
}

/**
 * Filter a collection of entities to only those valid at a specific year
 * 
 * @param entities - Array of entities to filter
 * @param year - The year to filter by (negative for BCE)
 * @returns Array of entities valid at the given year
 */
export function filterEntitiesByYear<T extends TemporalEntity>(
  entities: T[],
  year: number
): T[] {
  return entities.filter(entity => isEntityValidAtYear(entity, year));
}

/**
 * Filter a collection of entities to those valid within a time range
 * 
 * @param entities - Array of entities to filter
 * @param startYear - Start of the range (inclusive)
 * @param endYear - End of the range (inclusive)
 * @returns Array of entities that overlap with the given range
 */
export function filterEntitiesByTimeRange<T extends TemporalEntity>(
  entities: T[],
  startYear: number,
  endYear: number
): T[] {
  return entities.filter(entity => {
    const entityStart = getEntityStartYear(entity) ?? -Infinity;
    const entityEnd = getEntityEndYear(entity) ?? Infinity;

    // Check if ranges overlap
    return entityStart <= endYear && entityEnd >= startYear;
  });
}

/**
 * Calculate the temporal overlap between an entity and a time range
 * 
 * @param entity - The entity to check
 * @param startYear - Start of the range
 * @param endYear - End of the range
 * @returns Overlap ratio (0-1) or null if entity has no temporal data
 */
export function calculateTemporalOverlap<T extends TemporalEntity>(
  entity: T,
  startYear: number,
  endYear: number
): number | null {
  const entityStart = getEntityStartYear(entity);
  const entityEnd = getEntityEndYear(entity);

  if (entityStart === null && entityEnd === null) {
    return null; // No temporal data
  }

  const effectiveStart = entityStart ?? startYear;
  const effectiveEnd = entityEnd ?? endYear;

  const overlapStart = Math.max(effectiveStart, startYear);
  const overlapEnd = Math.min(effectiveEnd, endYear);

  if (overlapStart > overlapEnd) {
    return 0; // No overlap
  }

  const overlapDuration = overlapEnd - overlapStart;
  const rangeDuration = endYear - startYear;

  return rangeDuration > 0 ? overlapDuration / rangeDuration : 1;
}

/**
 * Sort entities by their start year (earliest first)
 */
export function sortEntitiesByStartYear<T extends TemporalEntity>(
  entities: T[],
  ascending = true
): T[] {
  return [...entities].sort((a, b) => {
    const startA = getEntityStartYear(a) ?? (ascending ? Infinity : -Infinity);
    const startB = getEntityStartYear(b) ?? (ascending ? Infinity : -Infinity);
    return ascending ? startA - startB : startB - startA;
  });
}

/**
 * Group entities by century
 */
export function groupEntitiesByCentury<T extends TemporalEntity>(
  entities: T[]
): Map<number, T[]> {
  const groups = new Map<number, T[]>();

  for (const entity of entities) {
    const startYear = getEntityStartYear(entity);
    if (startYear === null) continue;

    // Calculate century (e.g., 1450 -> 15, -450 -> -5)
    const century = startYear >= 0 
      ? Math.floor(startYear / 100) + 1
      : Math.ceil(startYear / 100);

    const existing = groups.get(century) || [];
    existing.push(entity);
    groups.set(century, existing);
  }

  return groups;
}

/**
 * Format a century number for display
 */
export function formatCentury(century: number): string {
  if (century < 0) {
    return `${Math.abs(century)}${getOrdinalSuffix(Math.abs(century))} century BCE`;
  }
  return `${century}${getOrdinalSuffix(century)} century CE`;
}

/**
 * Get ordinal suffix for a number (1st, 2nd, 3rd, etc.)
 */
function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/**
 * Calculate the time span of an entity in years
 */
export function calculateEntityLifespan<T extends TemporalEntity>(
  entity: T,
  currentYear: number = new Date().getFullYear()
): number | null {
  const startYear = getEntityStartYear(entity);
  if (startYear === null) return null;

  const endYear = getEntityEndYear(entity) ?? currentYear;
  return endYear - startYear;
}

/**
 * Preset historical time periods for quick navigation
 */
export const HISTORICAL_PRESETS = [
  { label: 'Prehistoric', year: -10000, description: 'Before written history' },
  { label: 'Bronze Age', year: -3000, description: 'Early metalworking civilizations' },
  { label: 'Iron Age', year: -1200, description: 'Iron technology spreads' },
  { label: 'Classical Antiquity', year: -500, description: 'Greek and Roman period' },
  { label: 'Roman Empire Peak', year: 117, description: 'Maximum extent under Trajan' },
  { label: 'Fall of Rome', year: 476, description: 'Western Roman Empire falls' },
  { label: 'Medieval Period', year: 1000, description: 'High Middle Ages' },
  { label: 'Renaissance', year: 1450, description: 'Cultural rebirth in Europe' },
  { label: 'Age of Exploration', year: 1500, description: 'European maritime exploration' },
  { label: 'Industrial Revolution', year: 1800, description: 'Mechanization begins' },
  { label: 'Modern Era', year: 1900, description: '20th century' },
  { label: 'Present Day', year: new Date().getFullYear(), description: 'Current year' },
] as const;

export type HistoricalPreset = typeof HISTORICAL_PRESETS[number];
