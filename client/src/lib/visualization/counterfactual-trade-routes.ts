/**
 * Counterfactual trade-route overlays (US-003).
 *
 * Speculative "what-if economic geography" routes (e.g. "Silk Road to the Americas")
 * rendered as a distinct, clearly-marked overlay on the map. They are strictly
 * data-driven — authored in `counterfactual-trade-routes.json` — so new speculative
 * routes can be added without touching code.
 *
 * These routes are a SEPARATE dataset from the real historical trade routes
 * (`HistoricalRouteFeature` served from `/api/trade-routes`). They are never mixed
 * into the real trade-routes dataset and toggle independently of it. To guarantee the
 * two can never collide, every counterfactual id is namespaced with `cf-` (real ids
 * are `tr-###`) and `assertSeparateFromReal()` verifies the disjointness.
 *
 * This module is intentionally pure (no React / no Leaflet) so loading + toggle +
 * separation behaviour is unit-testable in the node vitest environment.
 */

import rawRoutes from './counterfactual-trade-routes.json';

/** Persistent banner shown whenever a counterfactual trade-route overlay is active. */
export const COUNTERFACTUAL_BANNER_TEXT =
  'Speculative / educational overlay — hypothetical "what-if" trade routes, not real historical exchange.';

/**
 * Id namespace for counterfactual routes. Real trade-route ids are `tr-###`, so this
 * prefix guarantees a counterfactual route can never be confused with (or merged into)
 * a real one.
 */
export const COUNTERFACTUAL_ID_PREFIX = 'cf-';

export interface RouteTimeRange {
  start: number | null;
  end: number | null;
}

/** A single speculative trade route. `path` is GeoJSON-style [lng, lat] positions. */
export interface CounterfactualTradeRoute {
  id: string;
  name: string;
  summary: string;
  premise: string;
  goods: string[];
  timeRange: RouteTimeRange;
  path: number[][];
  sources: string[];
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isValidPath(path: unknown): path is number[][] {
  return (
    Array.isArray(path) &&
    path.length >= 2 &&
    path.every(
      (p: any) => Array.isArray(p) && p.length >= 2 && isFiniteNumber(p[0]) && isFiniteNumber(p[1]),
    )
  );
}

function normalizeTimeRange(raw: any): RouteTimeRange {
  const start = isFiniteNumber(raw?.start) ? raw.start : null;
  const end = isFiniteNumber(raw?.end) ? raw.end : null;
  return { start, end };
}

function toStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x: unknown): x is string => typeof x === 'string') : [];
}

/** Whether an id belongs to the counterfactual namespace. */
export function isCounterfactualRouteId(id: string): boolean {
  return id.startsWith(COUNTERFACTUAL_ID_PREFIX);
}

/**
 * Parse + validate raw counterfactual routes. Invalid rows (missing id/name, a path
 * with fewer than two valid coordinates, or an id outside the `cf-` namespace) are
 * dropped rather than throwing, so a single bad row can never break the map or leak a
 * real-looking id into the speculative layer.
 */
export function parseCounterfactualRoutes(raw: unknown): CounterfactualTradeRoute[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.routes)
      ? (raw as any).routes
      : [];

  const seen = new Set<string>();
  const out: CounterfactualTradeRoute[] = [];

  for (const r of list) {
    if (!r || typeof r.id !== 'string' || typeof r.name !== 'string') continue;
    // Enforce the namespace so speculative ids can never collide with real `tr-###` ids.
    if (!isCounterfactualRouteId(r.id)) continue;
    if (seen.has(r.id)) continue;
    if (!isValidPath(r.path)) continue;

    seen.add(r.id);
    out.push({
      id: r.id,
      name: r.name,
      summary: typeof r.summary === 'string' ? r.summary : '',
      premise: typeof r.premise === 'string' ? r.premise : '',
      goods: toStringArray(r.goods),
      timeRange: normalizeTimeRange(r.timeRange),
      path: r.path,
      sources: toStringArray(r.sources),
    });
  }

  return out;
}

/** Load the bundled, authored counterfactual trade routes. */
export function loadCounterfactualRoutes(): CounterfactualTradeRoute[] {
  return parseCounterfactualRoutes(rawRoutes);
}

export function getCounterfactualRouteById(
  routes: CounterfactualTradeRoute[],
  id: string | null | undefined,
): CounterfactualTradeRoute | null {
  if (!id) return null;
  return routes.find((r) => r.id === id) ?? null;
}

/**
 * Pure toggle reducer for the set of *active* counterfactual routes. Selecting a route
 * that is on turns it off, and vice-versa — several may be shown at once. This is
 * independent of the real trade-routes layer's own visibility.
 */
export function toggleCounterfactualRoute(active: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(active);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Turn every counterfactual route on (returns a fresh set of all ids). */
export function selectAllCounterfactualRoutes(routes: CounterfactualTradeRoute[]): Set<string> {
  return new Set(routes.map((r) => r.id));
}

/** Turn every counterfactual route off. */
export function clearCounterfactualRoutes(): Set<string> {
  return new Set();
}

/** The active routes, in authored order. */
export function activeCounterfactualRoutes(
  routes: CounterfactualTradeRoute[],
  active: ReadonlySet<string>,
): CounterfactualTradeRoute[] {
  return routes.filter((r) => active.has(r.id));
}

/**
 * Whether a route's speculative overlay applies at the given year. Open-ended (null)
 * bounds extend to infinity; a route with no time range at all always applies.
 */
export function routeAppliesAtYear(route: CounterfactualTradeRoute, year: number | undefined): boolean {
  if (year === undefined) return true;
  const { start, end } = route.timeRange;
  if (start === null && end === null) return true;
  const lo = start ?? -Infinity;
  const hi = end ?? Infinity;
  return year >= lo && year <= hi;
}

/**
 * Verifies the counterfactual routes are disjoint from a set of real trade-route ids.
 * Returns any counterfactual ids that collide with a real id (should always be empty).
 * This is the guarantee that speculative routes are never mixed into the real dataset.
 */
export function assertSeparateFromReal(
  routes: CounterfactualTradeRoute[],
  realRouteIds: Iterable<string>,
): string[] {
  const real = new Set(realRouteIds);
  return routes.filter((r) => real.has(r.id)).map((r) => r.id);
}
