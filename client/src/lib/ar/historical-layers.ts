/**
 * AR historical-layer overlay — pure core (US-008)
 *
 * Two responsibilities, both browser-global-free so they can be unit-tested in
 * the node vitest env (see the codebase "make browser globals injectable" pattern):
 *
 *  1. `detectArSupport` — feature-detect WebXR `immersive-ar` + geolocation off an
 *     injectable environment, so the UI can gracefully fall back on unsupported
 *     devices (a phone browser without WebXR falls back to the flat temporal map).
 *  2. `selectHistoricalLayers` — given the user's location + the existing temporal
 *     map data (archaeological sites / civilizations, each a GeoJSON feature with a
 *     `timePeriod`), pick the nearby layers to overlay on the camera view for a
 *     chosen era, sorted by relevance (active-at-year first, then distance).
 *
 * The `.tsx` page is a thin wrapper that reads the real `navigator` and renders
 * these layers; all decision logic lives here.
 */

import { centroidFromGeometry } from '@/lib/visualization/density-heatmap-utils';
import { haversineDistance } from '@/lib/visualization/terrain-route-utils';
import type { TimePeriod } from '@/lib/visualization/geospatial-types';

// ============================================================================
// Feature detection
// ============================================================================

/** Minimal shape of the bits of `navigator` we probe (all optional). */
export interface ArEnvironment {
  xr?: {
    isSessionSupported?: (mode: string) => Promise<boolean>;
  } | null;
  geolocation?: {
    getCurrentPosition?: unknown;
  } | null;
  /** `window.isSecureContext` — WebXR + geolocation require https/localhost. */
  isSecureContext?: boolean;
}

export type ArSupportReason =
  | 'supported'
  | 'insecure-context'
  | 'no-webxr'
  | 'no-immersive-ar'
  | 'no-geolocation';

export interface ArSupport {
  /** True only when the full AR path (WebXR immersive-ar + geolocation) is usable. */
  supported: boolean;
  hasWebXr: boolean;
  hasImmersiveAr: boolean;
  hasGeolocation: boolean;
  secureContext: boolean;
  reason: ArSupportReason;
  /** Which UI mode to render: full AR camera overlay, or the flat map fallback. */
  mode: 'ar' | 'fallback';
}

/**
 * Detect whether the AR overlay can run. Never throws: an `isSessionSupported`
 * that rejects (some browsers throw for unknown modes) is treated as "no AR".
 */
export async function detectArSupport(env: ArEnvironment | null | undefined): Promise<ArSupport> {
  const secureContext = env?.isSecureContext !== false; // default optimistic (SSR/tests)
  const hasGeolocation = Boolean(
    env?.geolocation && typeof env.geolocation.getCurrentPosition === 'function',
  );
  const hasWebXr = Boolean(env?.xr && typeof env.xr.isSessionSupported === 'function');

  let hasImmersiveAr = false;
  if (hasWebXr && secureContext) {
    try {
      hasImmersiveAr = (await env!.xr!.isSessionSupported!('immersive-ar')) === true;
    } catch {
      hasImmersiveAr = false;
    }
  }

  let reason: ArSupportReason = 'supported';
  if (!secureContext) reason = 'insecure-context';
  else if (!hasWebXr) reason = 'no-webxr';
  else if (!hasImmersiveAr) reason = 'no-immersive-ar';
  else if (!hasGeolocation) reason = 'no-geolocation';

  const supported = reason === 'supported';
  return {
    supported,
    hasWebXr,
    hasImmersiveAr,
    hasGeolocation,
    secureContext,
    reason,
    mode: supported ? 'ar' : 'fallback',
  };
}

// ============================================================================
// Layer selection
// ============================================================================

export interface UserLocation {
  lat: number;
  lng: number;
}

/** GeoJSON-feature-ish input — matches the temporal map endpoints' `.features[]`. */
export interface GeoFeatureLike {
  geometry?: { type: string; coordinates: unknown } | null;
  properties?: Record<string, unknown> | null;
}

export type HistoricalLayerKind = 'site' | 'civilization' | 'feature';

export interface HistoricalLayer {
  id: string;
  name: string;
  kind: HistoricalLayerKind;
  center: UserLocation;
  /** Great-circle distance from the user, km. */
  distanceKm: number;
  /** Compass bearing from the user to the layer, 0–360° (0 = north). */
  bearingDeg: number;
  timePeriod: TimePeriod;
  /** True when the selected `year` falls inside the layer's time period. */
  activeAtYear: boolean;
  sources: string[];
  /** 1–100 relevance for marker sizing when present (sites/civilizations). */
  importance?: number;
}

export interface LayerSelectionOptions {
  /** Selected era year (negative = BCE). Undefined = all eras. */
  year?: number;
  /** Only include layers whose time period contains `year`. Default true when `year` set. */
  onlyActive?: boolean;
  /** Max great-circle radius around the user, km. Default 500. */
  radiusKm?: number;
  /** Cap on returned layers. Default 12. */
  maxLayers?: number;
}

const DEFAULT_RADIUS_KM = 500;
const DEFAULT_MAX_LAYERS = 12;

/**
 * Initial compass bearing from point A to point B, degrees clockwise from north.
 */
export function bearingBetween(from: UserLocation, to: UserLocation): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(from.lat);
  const φ2 = toRad(to.lat);
  const Δλ = toRad(to.lng - from.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

function readTimePeriod(props: Record<string, unknown> | null | undefined): TimePeriod {
  const tp = props?.timePeriod as Partial<TimePeriod> | undefined;
  const start = typeof tp?.start === 'number' ? tp.start : Number.NaN;
  const end = tp?.end === null ? null : typeof tp?.end === 'number' ? tp.end : null;
  const label = typeof tp?.label === 'string' ? tp.label : '';
  return { start, end, label };
}

/** True when `year` is inside `[start, end]` (end null = to present). */
export function isActiveAtYear(tp: TimePeriod, year: number | undefined): boolean {
  if (year === undefined) return true;
  if (!Number.isFinite(tp.start)) return false;
  if (year < tp.start) return false;
  if (tp.end !== null && year > tp.end) return false;
  return true;
}

function classify(props: Record<string, unknown> | null | undefined, geometryType?: string): {
  kind: HistoricalLayerKind;
  id: string;
  name: string;
} {
  const p = props ?? {};
  if (typeof p.siteId === 'string') {
    return { kind: 'site', id: p.siteId, name: (p.name as string) ?? p.siteId };
  }
  if (typeof p.civilizationId === 'string') {
    return { kind: 'civilization', id: p.civilizationId, name: (p.name as string) ?? p.civilizationId };
  }
  const id = (p.id as string) ?? (p.name as string) ?? 'feature';
  const kind: HistoricalLayerKind = geometryType === 'Point' ? 'site' : 'feature';
  return { kind, id, name: (p.name as string) ?? id };
}

function readSources(props: Record<string, unknown> | null | undefined): string[] {
  const s = props?.sources;
  if (Array.isArray(s)) return s.filter((x): x is string => typeof x === 'string');
  return [];
}

/**
 * Select the historical layers to overlay near the user, from the existing
 * temporal map features (archaeological sites, civilizations, …).
 *
 * Ordering: active-at-year first, then nearest, then most important. Layers
 * outside `radiusKm` or (when `onlyActive`) outside the selected era are dropped.
 */
export function selectHistoricalLayers(
  user: UserLocation,
  features: readonly GeoFeatureLike[] | null | undefined,
  options: LayerSelectionOptions = {},
): HistoricalLayer[] {
  if (!features || !Number.isFinite(user?.lat) || !Number.isFinite(user?.lng)) return [];

  const radiusKm = options.radiusKm ?? DEFAULT_RADIUS_KM;
  const maxLayers = options.maxLayers ?? DEFAULT_MAX_LAYERS;
  const onlyActive = options.onlyActive ?? options.year !== undefined;

  const layers: HistoricalLayer[] = [];
  for (const feature of features) {
    if (!feature?.geometry) continue;
    const center = centroidFromGeometry(feature.geometry as { type: string; coordinates: unknown });
    if (!center) continue;

    const distanceKm = haversineDistance(user.lat, user.lng, center.lat, center.lng);
    if (distanceKm > radiusKm) continue;

    const timePeriod = readTimePeriod(feature.properties);
    const activeAtYear = isActiveAtYear(timePeriod, options.year);
    if (onlyActive && !activeAtYear) continue;

    const { kind, id, name } = classify(feature.properties, feature.geometry.type);
    const importanceRaw = feature.properties?.importance;
    const importance = typeof importanceRaw === 'number' ? importanceRaw : undefined;

    layers.push({
      id,
      name,
      kind,
      center,
      distanceKm,
      bearingDeg: bearingBetween(user, center),
      timePeriod,
      activeAtYear,
      sources: readSources(feature.properties),
      importance,
    });
  }

  layers.sort((a, b) => {
    if (a.activeAtYear !== b.activeAtYear) return a.activeAtYear ? -1 : 1;
    if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
    const ia = a.importance ?? 0;
    const ib = b.importance ?? 0;
    if (ia !== ib) return ib - ia;
    return a.id.localeCompare(b.id);
  });

  return layers.slice(0, maxLayers);
}
