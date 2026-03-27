import { describe, it, expect } from 'vitest';
import {
  BASE_MAP_TILES,
  DEFAULT_BASE_MAP_ID,
} from './geospatial-types';
import type { BaseMapId, BaseMapTile } from './geospatial-types';

describe('BASE_MAP_TILES', () => {
  it('contains at least 5 tile options', () => {
    expect(BASE_MAP_TILES.length).toBeGreaterThanOrEqual(5);
  });

  it('has unique IDs for all tiles', () => {
    const ids = BASE_MAP_TILES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes terrain/topographic options', () => {
    const ids = BASE_MAP_TILES.map((t) => t.id);
    expect(ids).toContain('opentopomap');
    expect(ids).toContain('stamen-terrain');
    expect(ids).toContain('esri-world-topo');
  });

  it('includes the default OSM standard tile', () => {
    const ids = BASE_MAP_TILES.map((t) => t.id);
    expect(ids).toContain('osm-standard');
  });

  it('includes satellite imagery option', () => {
    const ids = BASE_MAP_TILES.map((t) => t.id);
    expect(ids).toContain('esri-world-imagery');
  });

  it('all tiles have required fields', () => {
    BASE_MAP_TILES.forEach((tile) => {
      expect(tile.id).toBeTruthy();
      expect(tile.name).toBeTruthy();
      expect(tile.description).toBeTruthy();
      expect(tile.url).toBeTruthy();
      expect(tile.attribution).toBeTruthy();
      expect(tile.url).toContain('{z}');
      expect(tile.url).toContain('{x}');
      expect(tile.url).toContain('{y}');
    });
  });

  it('all tiles have valid maxZoom values', () => {
    BASE_MAP_TILES.forEach((tile) => {
      if (tile.maxZoom !== undefined) {
        expect(tile.maxZoom).toBeGreaterThanOrEqual(10);
        expect(tile.maxZoom).toBeLessThanOrEqual(22);
      }
    });
  });
});

describe('DEFAULT_BASE_MAP_ID', () => {
  it('is osm-standard', () => {
    expect(DEFAULT_BASE_MAP_ID).toBe('osm-standard');
  });

  it('references a valid tile in BASE_MAP_TILES', () => {
    const tile = BASE_MAP_TILES.find((t) => t.id === DEFAULT_BASE_MAP_ID);
    expect(tile).toBeDefined();
  });
});

describe('BaseMapId type coverage', () => {
  it('all BASE_MAP_TILES ids can be assigned to BaseMapId', () => {
    // This is a compile-time check; at runtime we verify the array is non-empty
    const ids: BaseMapId[] = BASE_MAP_TILES.map((t) => t.id);
    expect(ids.length).toBeGreaterThan(0);
  });
});
