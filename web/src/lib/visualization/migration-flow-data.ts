import type { HistoricalRouteFeature } from './geospatial-types';

// ============================================================================
// Migration Flow Types
// ============================================================================

export interface MigrationFlowNode {
  id: string;
  name: string;
  group: string; // Region or people grouping
  lat?: number;
  lng?: number;
}

export interface MigrationFlowLink {
  source: string;
  target: string;
  value: number;
  migrationName: string;
  timePeriod: string;
  routeType: string;
  languageIds: string[];
}

export interface MigrationFlowData {
  nodes: MigrationFlowNode[];
  links: MigrationFlowLink[];
}

export interface GeoMigrationRoute {
  id: string;
  name: string;
  coordinates: [number, number][];
  routeType: string;
  timePeriod: { start: number; end: number | null; label: string };
  languageIds: string[];
  direction: 'bidirectional' | 'unidirectional';
  value: number;
}

// ============================================================================
// Sample Migration Data
// ============================================================================

const MIGRATION_WAVES: Array<{
  name: string;
  source: { id: string; name: string; group: string; lat: number; lng: number };
  target: { id: string; name: string; group: string; lat: number; lng: number };
  value: number;
  timePeriod: string;
  routeType: string;
  languageIds: string[];
  coordinates: [number, number][];
}> = [
  {
    name: 'Bantu Expansion',
    source: { id: 'west-africa', name: 'West Africa (Nigeria/Cameroon)', group: 'Africa', lat: 6.5, lng: 3.4 },
    target: { id: 'east-africa', name: 'East Africa', group: 'Africa', lat: -1.3, lng: 36.8 },
    value: 85,
    timePeriod: '3000 BCE – 500 CE',
    routeType: 'migration',
    languageIds: ['bantu-swahili', 'bantu-zulu', 'bantu-shona'],
    coordinates: [[3.4, 6.5], [18.0, 4.0], [29.0, -1.0], [36.8, -1.3]],
  },
  {
    name: 'Bantu Expansion (Southern)',
    source: { id: 'west-africa', name: 'West Africa (Nigeria/Cameroon)', group: 'Africa', lat: 6.5, lng: 3.4 },
    target: { id: 'southern-africa', name: 'Southern Africa', group: 'Africa', lat: -26.2, lng: 28.0 },
    value: 70,
    timePeriod: '3000 BCE – 500 CE',
    routeType: 'migration',
    languageIds: ['bantu-zulu', 'bantu-xhosa', 'bantu-sotho'],
    coordinates: [[3.4, 6.5], [15.0, -4.3], [25.0, -15.0], [28.0, -26.2]],
  },
  {
    name: 'Indo-European Spread (West)',
    source: { id: 'pontic-steppe', name: 'Pontic-Caspian Steppe', group: 'Eurasia', lat: 47.0, lng: 39.0 },
    target: { id: 'western-europe', name: 'Western Europe', group: 'Europe', lat: 48.9, lng: 2.3 },
    value: 90,
    timePeriod: '4000 – 2500 BCE',
    routeType: 'migration',
    languageIds: ['ie-celtic', 'ie-germanic', 'ie-italic'],
    coordinates: [[39.0, 47.0], [28.0, 46.0], [18.0, 48.0], [10.0, 48.5], [2.3, 48.9]],
  },
  {
    name: 'Indo-European Spread (South)',
    source: { id: 'pontic-steppe', name: 'Pontic-Caspian Steppe', group: 'Eurasia', lat: 47.0, lng: 39.0 },
    target: { id: 'south-asia', name: 'South Asia', group: 'Asia', lat: 28.6, lng: 77.2 },
    value: 80,
    timePeriod: '2000 – 1500 BCE',
    routeType: 'migration',
    languageIds: ['ie-indo-aryan', 'ie-iranian'],
    coordinates: [[39.0, 47.0], [52.0, 40.0], [65.0, 35.0], [77.2, 28.6]],
  },
  {
    name: 'Austronesian Expansion',
    source: { id: 'taiwan', name: 'Taiwan', group: 'East Asia', lat: 23.7, lng: 120.9 },
    target: { id: 'maritime-sea', name: 'Maritime Southeast Asia', group: 'Southeast Asia', lat: 1.3, lng: 103.8 },
    value: 75,
    timePeriod: '3000 – 1500 BCE',
    routeType: 'migration',
    languageIds: ['an-malay', 'an-javanese', 'an-tagalog'],
    coordinates: [[120.9, 23.7], [118.0, 16.0], [110.0, 7.0], [103.8, 1.3]],
  },
  {
    name: 'Austronesian Expansion (Pacific)',
    source: { id: 'maritime-sea', name: 'Maritime Southeast Asia', group: 'Southeast Asia', lat: 1.3, lng: 103.8 },
    target: { id: 'polynesia', name: 'Polynesia', group: 'Pacific', lat: -17.7, lng: -149.4 },
    value: 50,
    timePeriod: '1500 BCE – 1000 CE',
    routeType: 'migration',
    languageIds: ['an-samoan', 'an-tongan', 'an-maori'],
    coordinates: [[103.8, 1.3], [140.0, -5.0], [170.0, -12.0], [-149.4, -17.7]],
  },
  {
    name: 'Turkic Expansion',
    source: { id: 'central-asia-steppe', name: 'Central Asian Steppe', group: 'Central Asia', lat: 47.9, lng: 67.0 },
    target: { id: 'anatolia', name: 'Anatolia', group: 'West Asia', lat: 39.9, lng: 32.9 },
    value: 65,
    timePeriod: '600 – 1300 CE',
    routeType: 'migration',
    languageIds: ['turkic-turkish', 'turkic-azerbaijani'],
    coordinates: [[67.0, 47.9], [55.0, 40.0], [44.0, 38.0], [32.9, 39.9]],
  },
  {
    name: 'Arab Expansion',
    source: { id: 'arabian-peninsula', name: 'Arabian Peninsula', group: 'West Asia', lat: 24.7, lng: 46.7 },
    target: { id: 'north-africa', name: 'North Africa', group: 'Africa', lat: 33.9, lng: 2.4 },
    value: 70,
    timePeriod: '632 – 750 CE',
    routeType: 'conquest',
    languageIds: ['semitic-arabic'],
    coordinates: [[46.7, 24.7], [35.0, 30.0], [25.0, 31.0], [10.0, 33.0], [2.4, 33.9]],
  },
  {
    name: 'Uralic Spread',
    source: { id: 'ural-region', name: 'Ural Mountains Region', group: 'Eurasia', lat: 56.8, lng: 60.6 },
    target: { id: 'finland-baltic', name: 'Finland & Baltic', group: 'Europe', lat: 60.2, lng: 24.9 },
    value: 45,
    timePeriod: '4000 – 2000 BCE',
    routeType: 'migration',
    languageIds: ['uralic-finnish', 'uralic-estonian', 'uralic-hungarian'],
    coordinates: [[60.6, 56.8], [50.0, 58.0], [35.0, 59.0], [24.9, 60.2]],
  },
  {
    name: 'Na-Dene Migration',
    source: { id: 'beringia', name: 'Beringia/Alaska', group: 'North America', lat: 64.2, lng: -152.5 },
    target: { id: 'southwest-na', name: 'Southwest North America', group: 'North America', lat: 35.0, lng: -111.0 },
    value: 40,
    timePeriod: '8000 – 1000 BCE',
    routeType: 'migration',
    languageIds: ['nadene-navajo', 'nadene-tlingit', 'nadene-apache'],
    coordinates: [[-152.5, 64.2], [-140.0, 60.0], [-125.0, 50.0], [-111.0, 35.0]],
  },
  {
    name: 'Polynesian Expansion to New Zealand',
    source: { id: 'polynesia', name: 'Polynesia', group: 'Pacific', lat: -17.7, lng: -149.4 },
    target: { id: 'new-zealand', name: 'New Zealand (Aotearoa)', group: 'Pacific', lat: -41.3, lng: 174.8 },
    value: 30,
    timePeriod: '1250 – 1300 CE',
    routeType: 'migration',
    languageIds: ['an-maori'],
    coordinates: [[-149.4, -17.7], [-170.0, -25.0], [174.8, -41.3]],
  },
  {
    name: 'Tupi Expansion',
    source: { id: 'amazon-basin', name: 'Amazon Basin', group: 'South America', lat: -3.1, lng: -60.0 },
    target: { id: 'brazil-coast', name: 'Brazilian Coast', group: 'South America', lat: -22.9, lng: -43.2 },
    value: 55,
    timePeriod: '500 BCE – 1500 CE',
    routeType: 'migration',
    languageIds: ['tupi-guarani', 'tupi-tupinamba'],
    coordinates: [[-60.0, -3.1], [-50.0, -8.0], [-43.2, -22.9]],
  },
];

/**
 * Build MigrationFlowData from the built-in migration wave dataset.
 * Optionally filter by time range or region group.
 */
export function buildMigrationFlowData(options?: {
  filterGroup?: string;
  timeStart?: number;
  timeEnd?: number;
}): MigrationFlowData {
  const nodeMap = new Map<string, MigrationFlowNode>();
  const links: MigrationFlowLink[] = [];

  for (const wave of MIGRATION_WAVES) {
    if (options?.filterGroup && wave.source.group !== options.filterGroup && wave.target.group !== options.filterGroup) {
      continue;
    }

    if (!nodeMap.has(wave.source.id)) {
      nodeMap.set(wave.source.id, { ...wave.source });
    }
    if (!nodeMap.has(wave.target.id)) {
      nodeMap.set(wave.target.id, { ...wave.target });
    }

    links.push({
      source: wave.source.id,
      target: wave.target.id,
      value: wave.value,
      migrationName: wave.name,
      timePeriod: wave.timePeriod,
      routeType: wave.routeType,
      languageIds: wave.languageIds,
    });
  }

  return {
    nodes: Array.from(nodeMap.values()),
    links,
  };
}

/**
 * Build GeoMigrationRoute array for map rendering.
 */
export function buildGeoMigrationRoutes(options?: {
  filterGroup?: string;
}): GeoMigrationRoute[] {
  return MIGRATION_WAVES
    .filter((wave) => {
      if (options?.filterGroup && wave.source.group !== options.filterGroup && wave.target.group !== options.filterGroup) {
        return false;
      }
      return true;
    })
    .map((wave, i) => ({
      id: `migration-${i}`,
      name: wave.name,
      coordinates: wave.coordinates,
      routeType: wave.routeType,
      timePeriod: parseTimePeriod(wave.timePeriod),
      languageIds: wave.languageIds,
      direction: 'unidirectional' as const,
      value: wave.value,
    }));
}

/**
 * Convert HistoricalRouteFeatures (from the API) into MigrationFlowData.
 */
export function routeFeaturesToFlowData(features: HistoricalRouteFeature[]): MigrationFlowData {
  const migrationRoutes = features.filter((f) => f.properties.routeType === 'migration' || f.properties.routeType === 'diaspora');
  const nodeMap = new Map<string, MigrationFlowNode>();
  const links: MigrationFlowLink[] = [];

  for (const feature of migrationRoutes) {
    const coords = feature.geometry.coordinates;
    if (coords.length < 2) continue;

    const startCoord = coords[0];
    const endCoord = coords[coords.length - 1];
    const sourceId = `${startCoord[0].toFixed(1)},${startCoord[1].toFixed(1)}`;
    const targetId = `${endCoord[0].toFixed(1)},${endCoord[1].toFixed(1)}`;

    if (!nodeMap.has(sourceId)) {
      nodeMap.set(sourceId, {
        id: sourceId,
        name: `Origin (${feature.properties.name})`,
        group: feature.properties.routeType,
        lat: startCoord[1],
        lng: startCoord[0],
      });
    }
    if (!nodeMap.has(targetId)) {
      nodeMap.set(targetId, {
        id: targetId,
        name: `Destination (${feature.properties.name})`,
        group: feature.properties.routeType,
        lat: endCoord[1],
        lng: endCoord[0],
      });
    }

    links.push({
      source: sourceId,
      target: targetId,
      value: 50,
      migrationName: feature.properties.name,
      timePeriod: feature.properties.timePeriod.label,
      routeType: feature.properties.routeType,
      languageIds: feature.properties.associatedLanguageIds,
    });
  }

  return {
    nodes: Array.from(nodeMap.values()),
    links,
  };
}

/**
 * Parse a human-readable time period string into structured data.
 */
function parseTimePeriod(str: string): { start: number; end: number | null; label: string } {
  const match = str.match(/(-?\d+)\s*(BCE|CE)?\s*[–-]\s*(-?\d+|present)?\s*(BCE|CE)?/i);
  if (!match) return { start: -3000, end: null, label: str };

  let start = parseInt(match[1], 10);
  if (match[2]?.toUpperCase() === 'BCE') start = -start;

  let end: number | null = null;
  if (match[3] && match[3].toLowerCase() !== 'present') {
    end = parseInt(match[3], 10);
    if (match[4]?.toUpperCase() === 'BCE') end = -end;
  }

  return { start, end, label: str };
}

/**
 * Get unique region groups from the migration data.
 */
export function getMigrationGroups(): string[] {
  const groups = new Set<string>();
  for (const wave of MIGRATION_WAVES) {
    groups.add(wave.source.group);
    groups.add(wave.target.group);
  }
  return Array.from(groups).sort();
}
