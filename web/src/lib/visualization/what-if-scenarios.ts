/**
 * What-If scenario overlay system (US-001).
 *
 * Scenarios are speculative / educational overlays rendered *on top of* the real
 * map. They are strictly data-driven — authored in `what-if-scenarios.json` (or any
 * compatible source) — so new counterfactuals can be added without touching code.
 *
 * A scenario NEVER mutates the underlying datasets. It only:
 *   1. contributes its own overlay geometry (rendered with distinct speculative styling), and
 *   2. names the existing base layers it recontextualises (`affectedLayers`) so the map
 *      can surface them for comparison while the scenario is active.
 *
 * This module is intentionally pure (no React / no Leaflet) so the loading + toggle
 * behaviour is unit-testable in the node vitest environment.
 */

import rawScenarios from './what-if-scenarios.json';

/** Persistent banner shown whenever a scenario overlay is active. */
export const SCENARIO_BANNER_TEXT =
  'Speculative / educational overlay — a hypothetical "what-if", not a historical reconstruction.';

export type ScenarioOverlayKind = 'polygon' | 'line' | 'marker';

/** A single speculative geometry contributed by a scenario. */
export interface ScenarioOverlay {
  id: string;
  kind: ScenarioOverlayKind;
  label: string;
  note?: string;
  /**
   * GeoJSON-style coordinates ([lng, lat]) matching `kind`:
   *   - polygon: number[][][]  (rings)
   *   - line:    number[][]     (positions)
   *   - marker:  number[]       (single position)
   */
  coordinates: number[] | number[][] | number[][][];
}

export interface ScenarioTimeRange {
  start: number | null;
  end: number | null;
}

export interface WhatIfScenario {
  id: string;
  title: string;
  summary: string;
  category: string;
  /** IDs of existing map layers this scenario recontextualises. */
  affectedLayers: string[];
  timeRange: ScenarioTimeRange;
  overlays: ScenarioOverlay[];
  sources: string[];
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Validate a single overlay's coordinate shape against its declared kind. */
function isValidOverlay(raw: any): boolean {
  if (!raw || typeof raw.id !== 'string' || typeof raw.label !== 'string') return false;
  const kind = raw.kind;
  const coords = raw.coordinates;
  if (!Array.isArray(coords)) return false;

  if (kind === 'marker') {
    return coords.length >= 2 && isFiniteNumber(coords[0]) && isFiniteNumber(coords[1]);
  }
  if (kind === 'line') {
    return (
      coords.length >= 2 &&
      coords.every(
        (p: any) => Array.isArray(p) && p.length >= 2 && isFiniteNumber(p[0]) && isFiniteNumber(p[1]),
      )
    );
  }
  if (kind === 'polygon') {
    return (
      coords.length >= 1 &&
      coords.every(
        (ring: any) =>
          Array.isArray(ring) &&
          ring.length >= 3 &&
          ring.every(
            (p: any) => Array.isArray(p) && p.length >= 2 && isFiniteNumber(p[0]) && isFiniteNumber(p[1]),
          ),
      )
    );
  }
  return false;
}

function normalizeTimeRange(raw: any): ScenarioTimeRange {
  const start = isFiniteNumber(raw?.start) ? raw.start : null;
  const end = isFiniteNumber(raw?.end) ? raw.end : null;
  return { start, end };
}

/**
 * Parse + validate raw scenario data. Invalid scenarios (missing id/title, or with
 * no usable overlays) are dropped rather than throwing, so a single bad row in the
 * authored data can never break the map.
 */
export function parseScenarios(raw: unknown): WhatIfScenario[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.scenarios)
      ? (raw as any).scenarios
      : [];

  const seen = new Set<string>();
  const out: WhatIfScenario[] = [];

  for (const s of list) {
    if (!s || typeof s.id !== 'string' || typeof s.title !== 'string') continue;
    if (seen.has(s.id)) continue;

    const overlays = Array.isArray(s.overlays) ? s.overlays.filter(isValidOverlay) : [];
    if (overlays.length === 0) continue;

    seen.add(s.id);
    out.push({
      id: s.id,
      title: s.title,
      summary: typeof s.summary === 'string' ? s.summary : '',
      category: typeof s.category === 'string' ? s.category : 'counterfactual',
      affectedLayers: Array.isArray(s.affectedLayers)
        ? s.affectedLayers.filter((x: unknown): x is string => typeof x === 'string')
        : [],
      timeRange: normalizeTimeRange(s.timeRange),
      overlays: overlays.map((o: any) => ({
        id: o.id,
        kind: o.kind,
        label: o.label,
        note: typeof o.note === 'string' ? o.note : undefined,
        coordinates: o.coordinates,
      })),
      sources: Array.isArray(s.sources)
        ? s.sources.filter((x: unknown): x is string => typeof x === 'string')
        : [],
    });
  }

  return out;
}

/** Load the bundled, authored scenarios. */
export function loadScenarios(): WhatIfScenario[] {
  return parseScenarios(rawScenarios);
}

export function getScenarioById(
  scenarios: WhatIfScenario[],
  id: string | null | undefined,
): WhatIfScenario | null {
  if (!id) return null;
  return scenarios.find((s) => s.id === id) ?? null;
}

/**
 * Pure toggle reducer for the "active scenario" selection. Selecting the currently
 * active scenario clears it (toggle off); selecting a different one switches to it.
 * At most one scenario is active at a time.
 */
export function toggleScenario(current: string | null, id: string): string | null {
  return current === id ? null : id;
}

/**
 * Layers a scenario recontextualises. The map surfaces these (e.g. makes them visible)
 * for comparison while the scenario is active. This is a *view* adjustment only — it
 * never mutates the fetched datasets.
 */
export function affectedLayersFor(scenario: WhatIfScenario | null): string[] {
  return scenario ? [...scenario.affectedLayers] : [];
}

/**
 * Whether a scenario overlay applies at the given year. Scenarios with an open-ended
 * (null) bound extend to infinity in that direction; a scenario with no time range at
 * all always applies.
 */
export function scenarioAppliesAtYear(scenario: WhatIfScenario, year: number | undefined): boolean {
  if (year === undefined) return true;
  const { start, end } = scenario.timeRange;
  if (start === null && end === null) return true;
  const lo = start ?? -Infinity;
  const hi = end ?? Infinity;
  return year >= lo && year <= hi;
}
