import { describe, it, expect } from 'vitest';
import type { HistoricalRouteFeature } from './geospatial-types';
import {
  buildMigrationFlowData,
  buildGeoMigrationRoutes,
  getMigrationGroups,
  routeFeaturesToFlowData,
} from './migration-flow-data';

// ============================================================================
// buildMigrationFlowData
// ============================================================================

describe('buildMigrationFlowData', () => {
  it('returns nodes and links for all migrations when no filter', () => {
    const data = buildMigrationFlowData();
    expect(data.nodes.length).toBeGreaterThan(0);
    expect(data.links.length).toBeGreaterThan(0);
  });

  it('each link references existing node ids', () => {
    const data = buildMigrationFlowData();
    const nodeIds = new Set(data.nodes.map((n) => n.id));
    for (const link of data.links) {
      expect(nodeIds.has(link.source)).toBe(true);
      expect(nodeIds.has(link.target)).toBe(true);
    }
  });

  it('links have positive values', () => {
    const data = buildMigrationFlowData();
    for (const link of data.links) {
      expect(link.value).toBeGreaterThan(0);
    }
  });

  it('nodes have required fields', () => {
    const data = buildMigrationFlowData();
    for (const node of data.nodes) {
      expect(node.id).toBeTruthy();
      expect(node.name).toBeTruthy();
      expect(node.group).toBeTruthy();
    }
  });

  it('filters by group when filterGroup is provided', () => {
    const allData = buildMigrationFlowData();
    const filtered = buildMigrationFlowData({ filterGroup: 'Africa' });
    expect(filtered.links.length).toBeLessThan(allData.links.length);
    expect(filtered.links.length).toBeGreaterThan(0);
  });

  it('returns empty data for non-existent group', () => {
    const data = buildMigrationFlowData({ filterGroup: 'Nonexistent' });
    expect(data.nodes).toHaveLength(0);
    expect(data.links).toHaveLength(0);
  });

  it('does not produce duplicate nodes', () => {
    const data = buildMigrationFlowData();
    const ids = data.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ============================================================================
// buildGeoMigrationRoutes
// ============================================================================

describe('buildGeoMigrationRoutes', () => {
  it('returns routes with coordinates', () => {
    const routes = buildGeoMigrationRoutes();
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route.coordinates.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('each route has required fields', () => {
    const routes = buildGeoMigrationRoutes();
    for (const route of routes) {
      expect(route.id).toBeTruthy();
      expect(route.name).toBeTruthy();
      expect(route.routeType).toBeTruthy();
      expect(route.timePeriod).toBeDefined();
      expect(route.timePeriod.label).toBeTruthy();
      expect(route.value).toBeGreaterThan(0);
    }
  });

  it('filters by group', () => {
    const allRoutes = buildGeoMigrationRoutes();
    const filtered = buildGeoMigrationRoutes({ filterGroup: 'Africa' });
    expect(filtered.length).toBeLessThan(allRoutes.length);
    expect(filtered.length).toBeGreaterThan(0);
  });

  it('coordinates are [lng, lat] pairs', () => {
    const routes = buildGeoMigrationRoutes();
    for (const route of routes) {
      for (const coord of route.coordinates) {
        expect(coord).toHaveLength(2);
        expect(typeof coord[0]).toBe('number');
        expect(typeof coord[1]).toBe('number');
        // longitude range
        expect(coord[0]).toBeGreaterThanOrEqual(-180);
        expect(coord[0]).toBeLessThanOrEqual(180);
        // latitude range
        expect(coord[1]).toBeGreaterThanOrEqual(-90);
        expect(coord[1]).toBeLessThanOrEqual(90);
      }
    }
  });
});

// ============================================================================
// getMigrationGroups
// ============================================================================

describe('getMigrationGroups', () => {
  it('returns sorted unique groups', () => {
    const groups = getMigrationGroups();
    expect(groups.length).toBeGreaterThan(0);
    // Check sorted
    const sorted = [...groups].sort();
    expect(groups).toEqual(sorted);
    // Check unique
    expect(new Set(groups).size).toBe(groups.length);
  });

  it('includes expected regions', () => {
    const groups = getMigrationGroups();
    expect(groups).toContain('Africa');
    expect(groups).toContain('Europe');
  });
});

// ============================================================================
// routeFeaturesToFlowData
// ============================================================================

describe('routeFeaturesToFlowData', () => {
  function makeRouteFeature(
    name: string,
    routeType: string,
    coordinates: [number, number][]
  ): HistoricalRouteFeature {
    return {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties: {
        routeId: `route-${name}`,
        name,
        routeType: routeType as any,
        timePeriod: { start: -1000, end: 500, label: '1000 BCE – 500 CE' },
        associatedLanguageIds: ['lang-a'],
        sources: [],
      },
    };
  }

  it('converts migration route features to flow data', () => {
    const features = [
      makeRouteFeature('Test Migration', 'migration', [[10, 20], [30, 40]]),
    ];
    const data = routeFeaturesToFlowData(features);
    expect(data.nodes).toHaveLength(2);
    expect(data.links).toHaveLength(1);
    expect(data.links[0].migrationName).toBe('Test Migration');
  });

  it('filters out non-migration routes', () => {
    const features = [
      makeRouteFeature('Trade Route', 'trade', [[10, 20], [30, 40]]),
      makeRouteFeature('Migration Route', 'migration', [[50, 60], [70, 80]]),
    ];
    const data = routeFeaturesToFlowData(features);
    expect(data.links).toHaveLength(1);
    expect(data.links[0].migrationName).toBe('Migration Route');
  });

  it('includes diaspora routes', () => {
    const features = [
      makeRouteFeature('Diaspora', 'diaspora', [[10, 20], [30, 40]]),
    ];
    const data = routeFeaturesToFlowData(features);
    expect(data.links).toHaveLength(1);
  });

  it('handles empty features', () => {
    const data = routeFeaturesToFlowData([]);
    expect(data.nodes).toHaveLength(0);
    expect(data.links).toHaveLength(0);
  });

  it('skips routes with fewer than 2 coordinates', () => {
    const features = [
      makeRouteFeature('Short', 'migration', [[10, 20]]),
    ];
    const data = routeFeaturesToFlowData(features);
    expect(data.nodes).toHaveLength(0);
    expect(data.links).toHaveLength(0);
  });
});
