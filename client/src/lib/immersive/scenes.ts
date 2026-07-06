/**
 * Immersive scenes — pure core (US-009: VR globe & virtual museum)
 *
 * Three browser-global-free responsibilities, unit-testable in the node vitest
 * env (see the codebase "make browser globals injectable" pattern from US-008):
 *
 *  1. `detectImmersiveSupport` — feature-detect WebXR `immersive-vr` + WebGL2 off
 *     an injectable environment, so the UI can pick a scene and gracefully degrade:
 *     no WebGL2 ⇒ only the flat map; WebGL2 but no WebXR ⇒ on-screen 3D globe /
 *     museum (mouse-drag), no headset button.
 *  2. `availableSceneModes` / `selectSceneMode` — the flat-map ⇄ globe ⇄ museum
 *     toggle, degrading a requested-but-unavailable mode to the best usable one.
 *  3. `buildFlyThroughPath` — turn the existing migration-route data (GeoJSON
 *     LineStrings + time periods) into an ordered time-space camera fly-through
 *     that follows each migration path in chronological order.
 *  4. `selectMuseumArtifacts` — pick which artifacts render as real glTF/3D models
 *     (only where a public-domain model URL exists) vs a placeholder pedestal.
 *
 * The `.tsx` page is a thin renderer (deck.gl GlobeView / mesh layers); all
 * decision logic lives here.
 */

import type { TimePeriod } from '@/lib/visualization/geospatial-types';

// ============================================================================
// Feature detection
// ============================================================================

/** Minimal shape of the bits of the environment we probe (all optional). */
export interface ImmersiveEnvironment {
  xr?: {
    isSessionSupported?: (mode: string) => Promise<boolean>;
  } | null;
  /** Whether a WebGL2 context could be created (probed by the hook). */
  webgl2?: boolean;
  /** `window.isSecureContext` — WebXR requires https/localhost. */
  isSecureContext?: boolean;
}

export type ImmersiveSupportReason =
  | 'immersive-vr'
  | 'on-screen-3d'
  | 'insecure-context'
  | 'no-webgl2';

export interface ImmersiveSupport {
  /** WebGL2 available ⇒ the 3D globe / museum can render on-screen. */
  canRender3d: boolean;
  /** WebXR immersive-vr available ⇒ a headset session can be entered. */
  hasImmersiveVr: boolean;
  hasWebXr: boolean;
  hasWebgl2: boolean;
  secureContext: boolean;
  reason: ImmersiveSupportReason;
}

/**
 * Detect what the immersive views can do. Never throws: an `isSessionSupported`
 * that rejects (some browsers throw for unknown modes) is treated as "no VR".
 * WebXR is only a *bonus* (headset) — the 3D scenes render with plain WebGL2,
 * so the absence of WebXR is NOT a hard fallback to the flat map.
 */
export async function detectImmersiveSupport(
  env: ImmersiveEnvironment | null | undefined,
): Promise<ImmersiveSupport> {
  const secureContext = env?.isSecureContext !== false; // default optimistic (SSR/tests)
  const hasWebgl2 = env?.webgl2 !== false; // default optimistic — the page confirms live
  const hasWebXr = Boolean(env?.xr && typeof env.xr.isSessionSupported === 'function');

  let hasImmersiveVr = false;
  if (hasWebXr && secureContext) {
    try {
      hasImmersiveVr = (await env!.xr!.isSessionSupported!('immersive-vr')) === true;
    } catch {
      hasImmersiveVr = false;
    }
  }

  let reason: ImmersiveSupportReason;
  if (!hasWebgl2) reason = 'no-webgl2';
  else if (!secureContext) reason = 'insecure-context';
  else if (hasImmersiveVr) reason = 'immersive-vr';
  else reason = 'on-screen-3d';

  return {
    canRender3d: hasWebgl2,
    hasImmersiveVr,
    hasWebXr,
    hasWebgl2,
    secureContext,
    reason,
  };
}

// ============================================================================
// Scene-mode selection (flat map ⇄ globe ⇄ museum)
// ============================================================================

export type SceneMode = 'flat' | 'globe' | 'museum';

/** All modes, in fallback-preference order (most immersive → least). */
export const SCENE_MODES: readonly SceneMode[] = ['museum', 'globe', 'flat'] as const;

/** Which scene modes the device can actually render. */
export function availableSceneModes(support: ImmersiveSupport | null | undefined): SceneMode[] {
  // The flat map always works (it is the graceful fallback). Globe + museum need WebGL2.
  if (support?.canRender3d) return ['flat', 'globe', 'museum'];
  return ['flat'];
}

export interface SceneModeSelection {
  mode: SceneMode;
  /** Set when the requested mode was unavailable and we degraded to `mode`. */
  degradedFrom?: SceneMode;
}

/**
 * Pick the scene mode to render: the requested one when the device supports it,
 * else the best available fallback (museum → globe → flat), reporting the degrade.
 */
export function selectSceneMode(
  requested: SceneMode,
  support: ImmersiveSupport | null | undefined,
): SceneModeSelection {
  const available = availableSceneModes(support);
  if (available.includes(requested)) return { mode: requested };
  // Degrade along the preference order to the first available mode.
  const fallback = SCENE_MODES.find((m) => available.includes(m)) ?? 'flat';
  return { mode: fallback, degradedFrom: requested };
}

// ============================================================================
// Time-space fly-through along migration paths
// ============================================================================

/** GeoJSON-feature-ish migration route — matches `/api/map/routes` `.features[]`. */
export interface RouteFeatureLike {
  geometry?: { type: string; coordinates: unknown } | null;
  properties?: Record<string, unknown> | null;
}

export interface LngLat {
  longitude: number;
  latitude: number;
}

export interface FlyThroughKeyframe extends LngLat {
  zoom: number;
  routeId: string;
  routeName: string;
  /** Route start year (negative = BCE); NaN when unknown. */
  year: number;
  /** Human-readable step label, e.g. "Bantu Expansion — waypoint 2/5". */
  label: string;
  /** True for the first keyframe of each route (the camera arrives here). */
  isRouteStart: boolean;
}

export interface FlyThroughOptions {
  /** Camera zoom for each keyframe (globe view). Default 2.2. */
  zoom?: number;
  /** Max waypoints sampled per route (evenly spaced). Default 6. */
  maxPointsPerRoute?: number;
  /** Cap on total keyframes across all routes. Default 60. */
  maxKeyframes?: number;
}

const DEFAULT_ZOOM = 2.2;
const DEFAULT_POINTS_PER_ROUTE = 6;
const DEFAULT_MAX_KEYFRAMES = 60;

/** Parse a GeoJSON LineString `coordinates` array into `[lng, lat]` points. */
function readLineString(geometry: RouteFeatureLike['geometry']): LngLat[] {
  const coords = (geometry as { coordinates?: unknown } | null | undefined)?.coordinates;
  if (!Array.isArray(coords)) return [];
  const out: LngLat[] = [];
  for (const pair of coords) {
    if (
      Array.isArray(pair) &&
      pair.length >= 2 &&
      typeof pair[0] === 'number' &&
      typeof pair[1] === 'number' &&
      Number.isFinite(pair[0]) &&
      Number.isFinite(pair[1])
    ) {
      out.push({ longitude: pair[0], latitude: pair[1] });
    }
  }
  return out;
}

function readRouteStartYear(props: Record<string, unknown> | null | undefined): number {
  const tp = props?.timePeriod as Partial<TimePeriod> | undefined;
  if (typeof tp?.start === 'number' && Number.isFinite(tp.start)) return tp.start;
  const raw = props?.startDate ?? props?.start_date;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return Number.NaN;
}

function readRouteId(props: Record<string, unknown> | null | undefined): { id: string; name: string } {
  const p = props ?? {};
  const id = (typeof p.routeId === 'string' && p.routeId) || (typeof p.id === 'string' && p.id) || 'route';
  const name = (typeof p.name === 'string' && p.name) || id;
  return { id, name };
}

/** Evenly sample up to `n` points from a polyline, always keeping the endpoints. */
function sampleEvenly(points: LngLat[], n: number): LngLat[] {
  if (n <= 0) return [];
  if (points.length <= n) return points;
  if (n === 1) return [points[0]];
  const out: LngLat[] = [];
  const step = (points.length - 1) / (n - 1);
  for (let i = 0; i < n; i += 1) {
    out.push(points[Math.round(i * step)]);
  }
  return out;
}

/**
 * Build an ordered time-space fly-through from the migration routes: routes are
 * visited oldest-first (a walk through deep time), and within each route the
 * camera follows the migration path waypoint by waypoint.
 *
 * Routes with fewer than two valid points are skipped (nothing to fly along).
 */
export function buildFlyThroughPath(
  routes: readonly RouteFeatureLike[] | null | undefined,
  options: FlyThroughOptions = {},
): FlyThroughKeyframe[] {
  if (!routes || routes.length === 0) return [];

  const zoom = options.zoom ?? DEFAULT_ZOOM;
  const pointsPerRoute = options.maxPointsPerRoute ?? DEFAULT_POINTS_PER_ROUTE;
  const maxKeyframes = options.maxKeyframes ?? DEFAULT_MAX_KEYFRAMES;

  interface PreparedRoute {
    id: string;
    name: string;
    year: number;
    points: LngLat[];
  }

  const prepared: PreparedRoute[] = [];
  for (const route of routes) {
    if (route?.geometry?.type !== 'LineString') continue;
    const points = readLineString(route.geometry);
    if (points.length < 2) continue;
    const { id, name } = readRouteId(route.properties);
    prepared.push({ id, name, year: readRouteStartYear(route.properties), points });
  }

  // Oldest migrations first; unknown-dated routes sort last, then alphabetical.
  prepared.sort((a, b) => {
    const aNaN = Number.isNaN(a.year);
    const bNaN = Number.isNaN(b.year);
    if (aNaN !== bNaN) return aNaN ? 1 : -1;
    if (!aNaN && a.year !== b.year) return a.year - b.year;
    return a.name.localeCompare(b.name);
  });

  const keyframes: FlyThroughKeyframe[] = [];
  for (const route of prepared) {
    const sampled = sampleEvenly(route.points, pointsPerRoute);
    sampled.forEach((pt, i) => {
      keyframes.push({
        longitude: pt.longitude,
        latitude: pt.latitude,
        zoom,
        routeId: route.id,
        routeName: route.name,
        year: route.year,
        label: `${route.name} — waypoint ${i + 1}/${sampled.length}`,
        isRouteStart: i === 0,
      });
    });
    if (keyframes.length >= maxKeyframes) break;
  }

  return keyframes.slice(0, maxKeyframes);
}

// ============================================================================
// Virtual museum: artifact / 3D-model selection
// ============================================================================

export interface MuseumArtifactInput {
  id: string;
  name: string;
  cultureId?: string | null;
  cultureName?: string | null;
  category?: string | null;
  /** URL of a glTF/GLB 3D model, if one exists. */
  modelUrl?: string | null;
  /** License string for the model (only public-domain models are rendered). */
  license?: string | null;
  attribution?: string | null;
  coordinates?: { lat: number; lng: number } | null;
}

export interface MuseumArtifact {
  id: string;
  name: string;
  cultureName: string | null;
  category: string | null;
  modelUrl: string | null;
  license: string | null;
  attribution: string | null;
  coordinates: { lat: number; lng: number } | null;
  /** True only when a public-domain 3D model is available to render. */
  hasModel: boolean;
  isPublicDomain: boolean;
}

/**
 * Whether a license permits rendering a bundled 3D model in the museum.
 * Conservative allow-list: public-domain / CC0 / CC-BY (attribution shown).
 * Anything non-commercial, no-derivatives, "all rights reserved", or unknown is
 * NOT rendered (we never ship a model we can't clearly redistribute).
 */
export function isPublicDomainLicense(license: string | null | undefined): boolean {
  if (!license) return false;
  const l = license.toLowerCase();
  if (/\bnc\b|non-?commercial|no-?deriv|\bnd\b|all rights reserved|copyright/.test(l)) return false;
  return (
    /\bcc0\b/.test(l) ||
    /public[\s-]?domain/.test(l) ||
    /\bpd\b/.test(l) ||
    /cc[\s-]?by(?![\s-]?(nc|nd))/.test(l)
  );
}

export interface MuseumSelectionOptions {
  /** Cap on returned artifacts. Default 48. */
  maxArtifacts?: number;
}

const DEFAULT_MAX_ARTIFACTS = 48;

/**
 * Normalize + rank artifacts for the virtual museum. Artifacts with a
 * public-domain 3D model render as real glTF meshes (`hasModel`); the rest get a
 * placeholder pedestal. Model-bearing artifacts sort first, then alphabetical.
 */
export function selectMuseumArtifacts(
  inputs: readonly MuseumArtifactInput[] | null | undefined,
  options: MuseumSelectionOptions = {},
): MuseumArtifact[] {
  if (!inputs) return [];
  const maxArtifacts = options.maxArtifacts ?? DEFAULT_MAX_ARTIFACTS;

  const artifacts: MuseumArtifact[] = [];
  for (const input of inputs) {
    if (!input || typeof input.id !== 'string' || typeof input.name !== 'string') continue;
    const isPublicDomain = isPublicDomainLicense(input.license);
    const hasModel = Boolean(input.modelUrl) && isPublicDomain;
    artifacts.push({
      id: input.id,
      name: input.name,
      cultureName: input.cultureName ?? input.cultureId ?? null,
      category: input.category ?? null,
      modelUrl: hasModel ? input.modelUrl! : null,
      license: input.license ?? null,
      attribution: input.attribution ?? null,
      coordinates: input.coordinates ?? null,
      hasModel,
      isPublicDomain,
    });
  }

  artifacts.sort((a, b) => {
    if (a.hasModel !== b.hasModel) return a.hasModel ? -1 : 1;
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return a.id.localeCompare(b.id);
  });

  return artifacts.slice(0, maxArtifacts);
}

/** Count of artifacts that have a renderable public-domain 3D model. */
export function countRenderableModels(artifacts: readonly MuseumArtifact[]): number {
  return artifacts.reduce((n, a) => (a.hasModel ? n + 1 : n), 0);
}
