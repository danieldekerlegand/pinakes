import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  encodeBookmarkToURL,
  decodeBookmarkFromURL,
  generateBookmarkId,
  loadBookmarksFromStorage,
  saveBookmarksToStorage,
} from './useMapBookmarks';
import type { MapBookmark } from '../../../lib/visualization/geospatial-types';

// ---------------------------------------------------------------------------
// URL encoding / decoding
// ---------------------------------------------------------------------------

describe('encodeBookmarkToURL', () => {
  it('encodes center, zoom, and layers', () => {
    const bookmark: MapBookmark = {
      id: 'test-1',
      name: 'Test',
      center: { lat: 33.5, lng: 44.25 },
      zoom: 5,
      activeLayers: ['civilizations', 'settlements'],
      isBuiltIn: true,
    };

    const result = encodeBookmarkToURL(bookmark);
    const params = new URLSearchParams(result);

    expect(params.get('lat')).toBe('33.5000');
    expect(params.get('lng')).toBe('44.2500');
    expect(params.get('zoom')).toBe('5.0');
    expect(params.get('layers')).toBe('civilizations,settlements');
  });

  it('includes year when present', () => {
    const bookmark: MapBookmark = {
      id: 'test-2',
      name: 'Test',
      center: { lat: 0, lng: 0 },
      zoom: 3,
      activeLayers: [],
      year: -2000,
      isBuiltIn: true,
    };

    const result = encodeBookmarkToURL(bookmark);
    const params = new URLSearchParams(result);

    expect(params.get('year')).toBe('-2000');
  });

  it('includes basemap when present', () => {
    const bookmark: MapBookmark = {
      id: 'test-3',
      name: 'Test',
      center: { lat: 0, lng: 0 },
      zoom: 3,
      activeLayers: [],
      baseMapId: 'stamen-terrain',
      isBuiltIn: true,
    };

    const result = encodeBookmarkToURL(bookmark);
    const params = new URLSearchParams(result);

    expect(params.get('basemap')).toBe('stamen-terrain');
  });

  it('includes layer opacities when present', () => {
    const bookmark: MapBookmark = {
      id: 'test-4',
      name: 'Test',
      center: { lat: 10, lng: 20 },
      zoom: 4,
      activeLayers: ['civilizations'],
      layerOpacities: { civilizations: 0.5, routes: 0.8 },
      isBuiltIn: true,
    };

    const result = encodeBookmarkToURL(bookmark);
    const params = new URLSearchParams(result);
    const opacities = params.get('opacities');

    expect(opacities).toContain('civilizations:0.50');
    expect(opacities).toContain('routes:0.80');
  });

  it('omits layers param when activeLayers is empty', () => {
    const bookmark: MapBookmark = {
      id: 'test-5',
      name: 'Test',
      center: { lat: 0, lng: 0 },
      zoom: 2,
      activeLayers: [],
      isBuiltIn: true,
    };

    const result = encodeBookmarkToURL(bookmark);
    const params = new URLSearchParams(result);

    expect(params.has('layers')).toBe(false);
  });
});

describe('decodeBookmarkFromURL', () => {
  it('returns null when lat/lng/zoom are missing', () => {
    expect(decodeBookmarkFromURL('')).toBeNull();
    expect(decodeBookmarkFromURL('?lat=10')).toBeNull();
    expect(decodeBookmarkFromURL('?lat=10&lng=20')).toBeNull();
  });

  it('decodes center and zoom', () => {
    const result = decodeBookmarkFromURL('?lat=33.5&lng=44.25&zoom=5');

    expect(result).not.toBeNull();
    expect(result!.center).toEqual({ lat: 33.5, lng: 44.25 });
    expect(result!.zoom).toBe(5);
  });

  it('decodes layers', () => {
    const result = decodeBookmarkFromURL('?lat=0&lng=0&zoom=2&layers=civilizations,settlements');

    expect(result!.activeLayers).toEqual(['civilizations', 'settlements']);
  });

  it('decodes year', () => {
    const result = decodeBookmarkFromURL('?lat=0&lng=0&zoom=2&year=-2000');

    expect(result!.year).toBe(-2000);
  });

  it('decodes basemap', () => {
    const result = decodeBookmarkFromURL('?lat=0&lng=0&zoom=2&basemap=stamen-terrain');

    expect(result!.baseMapId).toBe('stamen-terrain');
  });

  it('decodes layer opacities', () => {
    const result = decodeBookmarkFromURL('?lat=0&lng=0&zoom=2&opacities=civ:0.50,routes:0.80');

    expect(result!.layerOpacities).toEqual({ civ: 0.5, routes: 0.8 });
  });

  it('roundtrips with encodeBookmarkToURL', () => {
    const bookmark: MapBookmark = {
      id: 'roundtrip',
      name: 'Roundtrip',
      center: { lat: 38.123, lng: -90.456 },
      zoom: 6,
      activeLayers: ['civilizations', 'routes', 'settlements'],
      layerOpacities: { civilizations: 0.7 },
      year: 500,
      baseMapId: 'osm-standard',
      isBuiltIn: false,
    };

    const encoded = encodeBookmarkToURL(bookmark);
    const decoded = decodeBookmarkFromURL(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.center!.lat).toBeCloseTo(38.123, 3);
    expect(decoded!.center!.lng).toBeCloseTo(-90.456, 3);
    expect(decoded!.zoom).toBe(6);
    expect(decoded!.activeLayers).toEqual(['civilizations', 'routes', 'settlements']);
    expect(decoded!.year).toBe(500);
    expect(decoded!.baseMapId).toBe('osm-standard');
    expect(decoded!.layerOpacities!['civilizations']).toBeCloseTo(0.7, 1);
  });
});

// ---------------------------------------------------------------------------
// Bookmark ID generation
// ---------------------------------------------------------------------------

describe('generateBookmarkId', () => {
  it('returns a string starting with "bm-"', () => {
    const id = generateBookmarkId();
    expect(id).toMatch(/^bm-/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateBookmarkId()));
    expect(ids.size).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

describe('loadBookmarksFromStorage / saveBookmarksToStorage', () => {
  const store: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k in store) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };

  beforeEach(() => {
    mockLocalStorage.clear();
    vi.stubGlobal('localStorage', mockLocalStorage);
  });

  it('returns empty array when storage is empty', () => {
    expect(loadBookmarksFromStorage()).toEqual([]);
  });

  it('returns empty array when storage has invalid JSON', () => {
    localStorage.setItem('pinakes-map-bookmarks', '{not valid json');
    expect(loadBookmarksFromStorage()).toEqual([]);
  });

  it('returns empty array when storage has non-array JSON', () => {
    localStorage.setItem('pinakes-map-bookmarks', '{"foo": "bar"}');
    expect(loadBookmarksFromStorage()).toEqual([]);
  });

  it('roundtrips through save and load', () => {
    const bookmarks: MapBookmark[] = [
      {
        id: 'bm-test',
        name: 'Test Bookmark',
        center: { lat: 10, lng: 20 },
        zoom: 5,
        activeLayers: ['civilizations'],
        isBuiltIn: false,
        createdAt: 1700000000000,
      },
    ];

    saveBookmarksToStorage(bookmarks);
    const loaded = loadBookmarksFromStorage();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('bm-test');
    expect(loaded[0].name).toBe('Test Bookmark');
    expect(loaded[0].center).toEqual({ lat: 10, lng: 20 });
    expect(loaded[0].activeLayers).toEqual(['civilizations']);
  });
});
