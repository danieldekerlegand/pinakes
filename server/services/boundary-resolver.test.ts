import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  BoundaryResolver,
  resetDefaultBoundaryResolver,
} from './boundary-resolver';
import type { Feature, Polygon, MultiPolygon, FeatureCollection } from 'geojson';

// ============================================================================
// Test Helpers
// ============================================================================

function makePolygon(coords: number[][][]): Polygon {
  return { type: 'Polygon', coordinates: coords };
}

function makeMultiPolygon(coords: number[][][][]): MultiPolygon {
  return { type: 'MultiPolygon', coordinates: coords };
}

const squarePolygon = makePolygon([
  [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
]);

const trianglePolygon = makePolygon([
  [[0, 0], [5, 10], [10, 0], [0, 0]],
]);

const offsetSquarePolygon = makePolygon([
  [[5, 5], [15, 5], [15, 15], [5, 15], [5, 5]],
]);

function createTempGeoJSON(features: Feature[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boundary-test-'));
  const collection: FeatureCollection = {
    type: 'FeatureCollection',
    features,
  };
  const filePath = path.join(dir, 'test-boundaries.geojson');
  fs.writeFileSync(filePath, JSON.stringify(collection));
  return dir;
}

// ============================================================================
// Tests
// ============================================================================

describe('BoundaryResolver', () => {
  let resolver: BoundaryResolver;

  beforeEach(() => {
    resolver = new BoundaryResolver();
    resetDefaultBoundaryResolver();
  });

  describe('registerBoundary', () => {
    it('should register and resolve a boundary by ID', () => {
      resolver.registerBoundary({
        id: 'test-region',
        name: 'Test Region',
        geometry: squarePolygon,
        source: 'test',
      });

      const result = resolver.resolve('test-region');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('test-region');
      expect(result!.name).toBe('Test Region');
      expect(result!.geometry).toEqual(squarePolygon);
    });

    it('should resolve by name (case-insensitive)', () => {
      resolver.registerBoundary({
        id: 'test-region',
        name: 'Test Region',
        geometry: squarePolygon,
        source: 'test',
      });

      const result = resolver.resolve('test region');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('test-region');
    });

    it('should resolve by alias', () => {
      resolver.registerBoundary({
        id: 'test-region',
        name: 'Test Region',
        geometry: squarePolygon,
        source: 'test',
        aliases: ['My Region', 'Alt Name'],
      });

      const result = resolver.resolve('alt name');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('test-region');
    });

    it('should return null for unknown regions', () => {
      const result = resolver.resolve('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('registerCompositeRegion', () => {
    it('should resolve a composite region as union of components', () => {
      resolver.registerBoundary({
        id: 'region-a',
        name: 'Region A',
        geometry: squarePolygon,
        source: 'test',
      });

      resolver.registerBoundary({
        id: 'region-b',
        name: 'Region B',
        geometry: offsetSquarePolygon,
        source: 'test',
      });

      resolver.registerCompositeRegion({
        id: 'composite-ab',
        name: 'Composite AB',
        componentRegionIds: ['region-a', 'region-b'],
      });

      const result = resolver.resolve('composite-ab');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('composite-ab');
      expect(result!.source).toBe('composite');
      // The result should be a Polygon or MultiPolygon
      expect(['Polygon', 'MultiPolygon']).toContain(result!.geometry.type);
    });

    it('should return null for composite with no valid components', () => {
      resolver.registerCompositeRegion({
        id: 'empty-composite',
        name: 'Empty Composite',
        componentRegionIds: ['nonexistent-1', 'nonexistent-2'],
      });

      const result = resolver.resolve('empty-composite');
      expect(result).toBeNull();
    });

    it('should resolve single-component composite without union', () => {
      resolver.registerBoundary({
        id: 'region-a',
        name: 'Region A',
        geometry: squarePolygon,
        source: 'test',
      });

      resolver.registerCompositeRegion({
        id: 'single-composite',
        name: 'Single Composite',
        componentRegionIds: ['region-a'],
      });

      const result = resolver.resolve('single-composite');
      expect(result).not.toBeNull();
      expect(result!.geometry).toEqual(squarePolygon);
    });
  });

  describe('simplification', () => {
    it('should simplify geometry when tolerance is provided', () => {
      // Create a polygon with many vertices
      const detailedCoords: number[][] = [];
      for (let i = 0; i < 100; i++) {
        const angle = (i / 100) * 2 * Math.PI;
        detailedCoords.push([
          Math.cos(angle) * 10 + (Math.random() * 0.01),
          Math.sin(angle) * 10 + (Math.random() * 0.01),
        ]);
      }
      detailedCoords.push(detailedCoords[0]); // close ring

      resolver.registerBoundary({
        id: 'detailed',
        name: 'Detailed Region',
        geometry: makePolygon([detailedCoords]),
        source: 'test',
      });

      const original = resolver.resolve('detailed', 0);
      const simplified = resolver.resolve('detailed', 1);

      expect(original).not.toBeNull();
      expect(simplified).not.toBeNull();

      // Simplified should have fewer or equal coordinates
      const origCoords = original!.geometry.type === 'Polygon'
        ? original!.geometry.coordinates[0].length : 0;
      const simpCoords = simplified!.geometry.type === 'Polygon'
        ? simplified!.geometry.coordinates[0].length : 0;
      expect(simpCoords).toBeLessThanOrEqual(origCoords);
    });
  });

  describe('loadGeoJSONFile', () => {
    it('should load features from a GeoJSON file', async () => {
      const dir = createTempGeoJSON([
        {
          type: 'Feature',
          id: 'loaded-1',
          geometry: squarePolygon,
          properties: { name: 'Loaded Region', id: 'loaded-1' },
        },
        {
          type: 'Feature',
          id: 'loaded-2',
          geometry: trianglePolygon,
          properties: { name: 'Triangle Land', id: 'loaded-2' },
        },
      ]);

      const count = await resolver.loadBoundariesFromDirectory(dir);
      expect(count).toBe(2);
      expect(resolver.size).toBe(2);

      const result = resolver.resolve('loaded region');
      expect(result).not.toBeNull();
      expect(result!.geometry).toEqual(squarePolygon);

      // Clean up
      fs.rmSync(dir, { recursive: true });
    });

    it('should skip non-polygon features', async () => {
      const dir = createTempGeoJSON([
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: { name: 'A Point' },
        } as any,
        {
          type: 'Feature',
          id: 'poly-1',
          geometry: squarePolygon,
          properties: { name: 'A Polygon', id: 'poly-1' },
        },
      ]);

      const count = await resolver.loadBoundariesFromDirectory(dir);
      expect(count).toBe(1);

      fs.rmSync(dir, { recursive: true });
    });

    it('should handle non-existent directory gracefully', async () => {
      const count = await resolver.loadBoundariesFromDirectory('/nonexistent/dir');
      expect(count).toBe(0);
    });
  });

  describe('resolveFeature', () => {
    it('should replace feature geometry with precise boundary', () => {
      resolver.registerBoundary({
        id: 'rome',
        name: 'Roman Empire',
        geometry: squarePolygon,
        source: 'natural-earth',
      });

      const feature: Feature<Polygon> = {
        type: 'Feature',
        id: 'civ-1',
        geometry: trianglePolygon,
        properties: {
          name: 'Roman Empire',
          civilizationId: 'roman',
        },
      };

      const resolved = resolver.resolveFeature(feature);
      expect(resolved.geometry).toEqual(squarePolygon);
      expect(resolved.properties._boundaryResolved).toBe(true);
      expect(resolved.properties._boundarySource).toBe('natural-earth');
    });

    it('should preserve original geometry when no match found', () => {
      const feature: Feature<Polygon> = {
        type: 'Feature',
        id: 'civ-1',
        geometry: trianglePolygon,
        properties: {
          name: 'Unknown Civilization',
          civilizationId: 'unknown',
        },
      };

      const resolved = resolver.resolveFeature(feature);
      expect(resolved.geometry).toEqual(trianglePolygon);
      expect(resolved.properties._boundaryResolved).toBeUndefined();
    });

    it('should use custom region name key', () => {
      resolver.registerBoundary({
        id: 'latin',
        name: 'Latin',
        geometry: squarePolygon,
        source: 'test',
      });

      const feature: Feature<Polygon> = {
        type: 'Feature',
        id: 'lang-1',
        geometry: trianglePolygon,
        properties: {
          languageName: 'Latin',
          name: 'Something Else',
        },
      };

      const resolved = resolver.resolveFeature(feature, 'languageName');
      expect(resolved.geometry).toEqual(squarePolygon);
      expect(resolved.properties._boundaryResolved).toBe(true);
    });
  });

  describe('resolveFeatures', () => {
    it('should resolve multiple features', () => {
      resolver.registerBoundary({
        id: 'rome',
        name: 'Roman Empire',
        geometry: squarePolygon,
        source: 'test',
      });

      const features: Feature<Polygon>[] = [
        {
          type: 'Feature',
          id: 'civ-1',
          geometry: trianglePolygon,
          properties: { name: 'Roman Empire' },
        },
        {
          type: 'Feature',
          id: 'civ-2',
          geometry: trianglePolygon,
          properties: { name: 'Unknown Empire' },
        },
      ];

      const resolved = resolver.resolveFeatures(features);
      expect(resolved).toHaveLength(2);
      expect(resolved[0].geometry).toEqual(squarePolygon);
      expect(resolved[0].properties._boundaryResolved).toBe(true);
      expect(resolved[1].geometry).toEqual(trianglePolygon);
      expect(resolved[1].properties._boundaryResolved).toBeUndefined();
    });
  });

  describe('search', () => {
    it('should find boundaries by partial name', () => {
      resolver.registerBoundary({
        id: 'roman-empire',
        name: 'Roman Empire',
        geometry: squarePolygon,
        source: 'test',
      });
      resolver.registerBoundary({
        id: 'holy-roman',
        name: 'Holy Roman Empire',
        geometry: trianglePolygon,
        source: 'test',
      });

      const results = resolver.search('roman');
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('should respect limit', () => {
      for (let i = 0; i < 20; i++) {
        resolver.registerBoundary({
          id: `region-${i}`,
          name: `Test Region ${i}`,
          geometry: squarePolygon,
          source: 'test',
        });
      }

      const results = resolver.search('region', 5);
      expect(results.length).toBe(5);
    });
  });

  describe('listBoundaryIds and listBoundaryNames', () => {
    it('should list all registered boundaries', () => {
      resolver.registerBoundary({
        id: 'a',
        name: 'Region A',
        geometry: squarePolygon,
        source: 'test',
      });
      resolver.registerBoundary({
        id: 'b',
        name: 'Region B',
        geometry: trianglePolygon,
        source: 'test',
      });

      expect(resolver.listBoundaryIds()).toEqual(['a', 'b']);
      expect(resolver.listBoundaryNames()).toEqual(['Region A', 'Region B']);
      expect(resolver.size).toBe(2);
    });
  });

  describe('MultiPolygon support', () => {
    it('should handle MultiPolygon geometries', () => {
      const multiPoly = makeMultiPolygon([
        [[[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]]],
        [[[10, 10], [15, 10], [15, 15], [10, 15], [10, 10]]],
      ]);

      resolver.registerBoundary({
        id: 'multi',
        name: 'Multi Region',
        geometry: multiPoly,
        source: 'test',
      });

      const result = resolver.resolve('multi');
      expect(result).not.toBeNull();
      expect(result!.geometry.type).toBe('MultiPolygon');
    });
  });

  describe('fuzzy search fallback', () => {
    it('should find boundaries with partial name match', () => {
      resolver.registerBoundary({
        id: 'byzantine-empire',
        name: 'Byzantine Empire',
        geometry: squarePolygon,
        source: 'test',
      });

      const result = resolver.resolve('Byzantine');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('byzantine-empire');
    });
  });
});
