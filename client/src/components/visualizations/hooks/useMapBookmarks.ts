import { useState, useCallback, useMemo } from 'react';
import type { MapBookmark, BaseMapId } from '../../../lib/visualization/geospatial-types';
import { VIEW_PRESETS } from '../../../lib/visualization/geospatial-types';

const STORAGE_KEY = 'pinakes-map-bookmarks';

// ---------------------------------------------------------------------------
// localStorage helpers (exported for testing)
// ---------------------------------------------------------------------------

export function loadBookmarksFromStorage(): MapBookmark[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function saveBookmarksToStorage(bookmarks: MapBookmark[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
}

// ---------------------------------------------------------------------------
// URL encoding / decoding (exported for testing)
// ---------------------------------------------------------------------------

export function encodeBookmarkToURL(bookmark: MapBookmark): string {
  const params = new URLSearchParams();
  params.set('lat', bookmark.center.lat.toFixed(4));
  params.set('lng', bookmark.center.lng.toFixed(4));
  params.set('zoom', bookmark.zoom.toFixed(1));

  if (bookmark.activeLayers.length > 0) {
    params.set('layers', bookmark.activeLayers.join(','));
  }

  if (bookmark.layerOpacities && Object.keys(bookmark.layerOpacities).length > 0) {
    const pairs = Object.entries(bookmark.layerOpacities).map(
      ([id, val]) => `${id}:${val.toFixed(2)}`
    );
    params.set('opacities', pairs.join(','));
  }

  if (bookmark.year != null) {
    params.set('year', String(bookmark.year));
  }

  if (bookmark.baseMapId) {
    params.set('basemap', bookmark.baseMapId);
  }

  return `?${params.toString()}`;
}

export function decodeBookmarkFromURL(search: string): Partial<MapBookmark> | null {
  const params = new URLSearchParams(search);
  const lat = params.get('lat');
  const lng = params.get('lng');
  const zoom = params.get('zoom');

  if (!lat || !lng || !zoom) return null;

  const result: Partial<MapBookmark> = {
    center: { lat: parseFloat(lat), lng: parseFloat(lng) },
    zoom: parseFloat(zoom),
  };

  const layers = params.get('layers');
  if (layers) {
    result.activeLayers = layers.split(',').filter(Boolean);
  }

  const opacities = params.get('opacities');
  if (opacities) {
    result.layerOpacities = {};
    opacities.split(',').forEach((pair) => {
      const [id, val] = pair.split(':');
      if (id && val) {
        result.layerOpacities![id] = parseFloat(val);
      }
    });
  }

  const year = params.get('year');
  if (year) {
    result.year = parseInt(year, 10);
  }

  const basemap = params.get('basemap');
  if (basemap) {
    result.baseMapId = basemap as BaseMapId;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Bookmark ID generator
// ---------------------------------------------------------------------------

export function generateBookmarkId(): string {
  return `bm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface MapViewState {
  center: { lat: number; lng: number };
  zoom: number;
  activeLayers: string[];
  layerOpacities: Record<string, number>;
  year?: number;
  baseMapId?: BaseMapId;
}

export interface UseMapBookmarksReturn {
  bookmarks: MapBookmark[];
  builtInPresets: MapBookmark[];
  saveBookmark: (name: string, viewState: MapViewState, description?: string) => MapBookmark;
  deleteBookmark: (id: string) => void;
  renameBookmark: (id: string, name: string) => void;
  getShareableURL: (bookmark: MapBookmark) => string;
}

export function useMapBookmarks(): UseMapBookmarksReturn {
  const [userBookmarks, setUserBookmarks] = useState<MapBookmark[]>(loadBookmarksFromStorage);

  const saveBookmark = useCallback(
    (name: string, viewState: MapViewState, description?: string): MapBookmark => {
      const bookmark: MapBookmark = {
        id: generateBookmarkId(),
        name,
        description,
        center: viewState.center,
        zoom: viewState.zoom,
        activeLayers: viewState.activeLayers,
        layerOpacities: viewState.layerOpacities,
        year: viewState.year,
        baseMapId: viewState.baseMapId,
        isBuiltIn: false,
        createdAt: Date.now(),
      };

      setUserBookmarks((prev) => {
        const next = [...prev, bookmark];
        saveBookmarksToStorage(next);
        return next;
      });

      return bookmark;
    },
    []
  );

  const deleteBookmark = useCallback((id: string) => {
    setUserBookmarks((prev) => {
      const next = prev.filter((b) => b.id !== id);
      saveBookmarksToStorage(next);
      return next;
    });
  }, []);

  const renameBookmark = useCallback((id: string, name: string) => {
    setUserBookmarks((prev) => {
      const next = prev.map((b) => (b.id === id ? { ...b, name } : b));
      saveBookmarksToStorage(next);
      return next;
    });
  }, []);

  const getShareableURL = useCallback((bookmark: MapBookmark): string => {
    const paramStr = encodeBookmarkToURL(bookmark);
    return `${window.location.origin}${window.location.pathname}${paramStr}`;
  }, []);

  const bookmarks = useMemo(() => userBookmarks, [userBookmarks]);

  return {
    bookmarks,
    builtInPresets: VIEW_PRESETS,
    saveBookmark,
    deleteBookmark,
    renameBookmark,
    getShareableURL,
  };
}
