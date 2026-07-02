import { useEffect, useRef, useCallback } from 'react';
import type { ViewMode } from '../lib/visualization/types';

/**
 * Shareable view state that can be encoded in URL parameters
 */
export interface ShareableViewState {
  // Visualization context state
  view?: ViewMode;
  selectedLanguages?: string[];
  selectedFamilies?: string[];
  searchQuery?: string;
  filterStatus?: string[];
  filterRegion?: string;
  // Temporal state
  year?: number;
  // Map state
  lat?: number;
  lng?: number;
  zoom?: number;
  // Dashboard panel state
  panel?: string;
  langDetail?: string;
  // Layers are handled separately by useMapLayers
}

const PARAM_KEYS = {
  view: 'view',
  selectedLanguages: 'lang',
  selectedFamilies: 'fam',
  searchQuery: 'q',
  filterStatus: 'status',
  filterRegion: 'region',
  year: 'year',
  lat: 'lat',
  lng: 'lng',
  zoom: 'zoom',
  panel: 'panel',
  langDetail: 'langDetail',
} as const;

/**
 * Parse shareable state from current URL search params
 */
export function parseShareableState(): ShareableViewState {
  const params = new URLSearchParams(window.location.search);
  const state: ShareableViewState = {};

  const view = params.get(PARAM_KEYS.view);
  if (view) state.view = view as ViewMode;

  const lang = params.get(PARAM_KEYS.selectedLanguages);
  if (lang) state.selectedLanguages = lang.split(',').filter(Boolean);

  const fam = params.get(PARAM_KEYS.selectedFamilies);
  if (fam) state.selectedFamilies = fam.split(',').filter(Boolean);

  const q = params.get(PARAM_KEYS.searchQuery);
  if (q) state.searchQuery = q;

  const status = params.get(PARAM_KEYS.filterStatus);
  if (status) state.filterStatus = status.split(',').filter(Boolean);

  const region = params.get(PARAM_KEYS.filterRegion);
  if (region) state.filterRegion = region;

  const year = params.get(PARAM_KEYS.year);
  if (year) state.year = parseInt(year, 10);

  const lat = params.get(PARAM_KEYS.lat);
  if (lat) state.lat = parseFloat(lat);

  const lng = params.get(PARAM_KEYS.lng);
  if (lng) state.lng = parseFloat(lng);

  const zoom = params.get(PARAM_KEYS.zoom);
  if (zoom) state.zoom = parseFloat(zoom);

  const panel = params.get(PARAM_KEYS.panel);
  if (panel) state.panel = panel;

  const langDetail = params.get(PARAM_KEYS.langDetail);
  if (langDetail) state.langDetail = langDetail;

  return state;
}

/**
 * Encode shareable state into URL search params string, preserving existing params (like layers/opacities)
 */
export function encodeShareableState(state: ShareableViewState): string {
  const params = new URLSearchParams(window.location.search);

  // Helper to set or delete a param
  function setParam(key: string, value: string | undefined | null) {
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
  }

  setParam(PARAM_KEYS.view, state.view);
  setParam(PARAM_KEYS.selectedLanguages, state.selectedLanguages?.length ? state.selectedLanguages.join(',') : null);
  setParam(PARAM_KEYS.selectedFamilies, state.selectedFamilies?.length ? state.selectedFamilies.join(',') : null);
  setParam(PARAM_KEYS.searchQuery, state.searchQuery || null);
  setParam(PARAM_KEYS.filterStatus, state.filterStatus?.length ? state.filterStatus.join(',') : null);
  setParam(PARAM_KEYS.filterRegion, state.filterRegion && state.filterRegion !== 'all-regions' ? state.filterRegion : null);
  setParam(PARAM_KEYS.year, state.year != null ? String(state.year) : null);
  setParam(PARAM_KEYS.lat, state.lat != null ? state.lat.toFixed(4) : null);
  setParam(PARAM_KEYS.lng, state.lng != null ? state.lng.toFixed(4) : null);
  setParam(PARAM_KEYS.zoom, state.zoom != null ? state.zoom.toFixed(1) : null);
  setParam(PARAM_KEYS.panel, state.panel || null);
  setParam(PARAM_KEYS.langDetail, state.langDetail || null);

  const paramStr = params.toString();
  return paramStr ? `?${paramStr}` : '';
}

/**
 * Generate a full shareable URL for the current view state
 */
export function generateShareableURL(state: ShareableViewState): string {
  const paramStr = encodeShareableState(state);
  return `${window.location.origin}${window.location.pathname}${paramStr}`;
}

/**
 * Sync current state to URL without adding to browser history
 */
export function syncStateToURL(state: ShareableViewState): void {
  const paramStr = encodeShareableState(state);
  const newURL = `${window.location.pathname}${paramStr}${window.location.hash}`;
  window.history.replaceState(null, '', newURL);
}

/**
 * Hook that syncs shareable state to URL params via replaceState.
 * Returns a function to generate a shareable URL from current state.
 */
export function useShareableState(state: ShareableViewState) {
  const isInitializedRef = useRef(false);

  useEffect(() => {
    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
      return;
    }
    syncStateToURL(state);
  }, [
    state.view,
    state.searchQuery,
    state.filterRegion,
    state.year,
    state.lat,
    state.lng,
    state.zoom,
    state.panel,
    state.langDetail,
    // For arrays, stringify to detect changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    state.selectedLanguages?.join(','),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    state.selectedFamilies?.join(','),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    state.filterStatus?.join(','),
  ]);

  const getShareableURL = useCallback(() => {
    return generateShareableURL(state);
  }, [state]);

  return { getShareableURL };
}
