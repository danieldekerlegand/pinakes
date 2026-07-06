/**
 * Urheimat hypothesis → migration-route selection (US-002).
 *
 * Competing Urheimat (homeland) hypotheses for a language family disagree about
 * where and when that family originated. Selecting one hypothesis should drive which
 * migration routes the map emphasises: the routes that carry the selected family's
 * expansion light up, every other route dims. Which routes belong to which hypothesis
 * is strictly data-driven — authored in `urheimat-migration-links.json` — so new links
 * need no code change.
 *
 * This module is intentionally pure (no React / no Leaflet) so the hypothesis-driven
 * route-selection logic is unit-testable in the node vitest environment. The `.tsx`
 * layer/control are thin render wrappers over these functions.
 */

import rawLinks from './urheimat-migration-links.json';

/**
 * Minimal shape a hypothesis needs for route selection. Mirrors the subset of
 * `UrheimatHypothesisFeature` (see UrheimatHypothesisLayer.tsx) this module reads —
 * kept local so the pure module carries no React/Leaflet dependency.
 */
export interface UrheimatHypothesisLike {
  id: string;
  languageFamilyId: string;
  hypothesisName: string;
  proposedRegion: string;
  scholarlyConsensusLevel: number;
  keyProponents: string[];
  competingHypotheses: string[];
  sources: string[];
}

/**
 * Links between hypotheses/families and the migration routes they imply.
 *   - `byFamily`:     languageFamilyId → route ids (the family-level default)
 *   - `byHypothesis`: hypothesis id    → route ids (optional per-hypothesis override)
 */
export interface HypothesisRouteLinks {
  byFamily: Record<string, string[]>;
  byHypothesis: Record<string, string[]>;
}

/** The result of resolving a selected hypothesis to its emphasised routes. */
export interface RouteSelection {
  hypothesisId: string | null;
  familyId: string | null;
  associatedRouteIds: string[];
}

/** How a route should be rendered given the active hypothesis selection. */
export type RouteEmphasis = 'highlight' | 'dim' | 'normal';

/** A group of competing hypotheses for one language family. */
export interface HypothesisFamilyGroup {
  familyId: string;
  hypotheses: UrheimatHypothesisLike[];
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** Normalise a raw `{familyId|hypId: string[]}` record, dropping malformed entries. */
function normalizeLinkMap(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== 'string') continue;
    if (!isStringArray(value)) continue;
    // Dedup while preserving order.
    out[key] = Array.from(new Set(value));
  }
  return out;
}

/**
 * Parse + validate raw link data. Malformed maps degrade to empty rather than
 * throwing, so bad authored data can never break the map.
 */
export function parseHypothesisRouteLinks(raw: unknown): HypothesisRouteLinks {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    byFamily: normalizeLinkMap(obj.byFamily),
    byHypothesis: normalizeLinkMap(obj.byHypothesis),
  };
}

/** Load the bundled, authored links. */
export function loadHypothesisRouteLinks(): HypothesisRouteLinks {
  return parseHypothesisRouteLinks(rawLinks);
}

/**
 * Pure toggle reducer for the active-hypothesis selection. Selecting the currently
 * active hypothesis clears it (toggle off); selecting a different one switches to it.
 * At most one hypothesis is active at a time.
 */
export function toggleHypothesis(current: string | null, id: string): string | null {
  return current === id ? null : id;
}

export function getHypothesisById<T extends { id: string }>(
  hypotheses: T[],
  id: string | null | undefined,
): T | null {
  if (!id) return null;
  return hypotheses.find((h) => h.id === id) ?? null;
}

/**
 * Group hypotheses by language family, sorted within a group by scholarly consensus
 * (descending) so the most-accepted hypothesis leads. Families appear in the order of
 * their first hypothesis in the input (stable), then internally sorted.
 */
export function groupHypothesesByFamily<T extends UrheimatHypothesisLike>(
  hypotheses: T[],
): HypothesisFamilyGroup[] {
  const order: string[] = [];
  const byFamily = new Map<string, T[]>();
  for (const h of hypotheses) {
    const fam = h.languageFamilyId;
    if (!byFamily.has(fam)) {
      byFamily.set(fam, []);
      order.push(fam);
    }
    byFamily.get(fam)!.push(h);
  }
  return order.map((familyId) => ({
    familyId,
    hypotheses: [...byFamily.get(familyId)!].sort(
      (a, b) => b.scholarlyConsensusLevel - a.scholarlyConsensusLevel,
    ),
  }));
}

/**
 * Families that actually have *competing* hypotheses (≥2) — the ones worth a toggle.
 * A family with a single hypothesis has nothing to switch between.
 */
export function competingFamilies<T extends UrheimatHypothesisLike>(
  hypotheses: T[],
): HypothesisFamilyGroup[] {
  return groupHypothesesByFamily(hypotheses).filter((g) => g.hypotheses.length >= 2);
}

/**
 * Resolve the migration routes associated with a hypothesis. A per-hypothesis override
 * (`byHypothesis`) takes precedence over the family-level default (`byFamily`); with
 * neither, the hypothesis has no associated routes.
 */
export function resolveAssociatedRouteIds(
  hypothesis: UrheimatHypothesisLike,
  links: HypothesisRouteLinks,
): string[] {
  const override = links.byHypothesis[hypothesis.id];
  if (override) return [...override];
  const family = links.byFamily[hypothesis.languageFamilyId];
  return family ? [...family] : [];
}

/**
 * Compute the route selection for the (optionally null) active hypothesis. With no
 * active hypothesis the selection is empty — every route renders normally.
 */
export function selectRoutesForHypothesis(
  hypothesis: UrheimatHypothesisLike | null,
  links: HypothesisRouteLinks,
): RouteSelection {
  if (!hypothesis) {
    return { hypothesisId: null, familyId: null, associatedRouteIds: [] };
  }
  return {
    hypothesisId: hypothesis.id,
    familyId: hypothesis.languageFamilyId,
    associatedRouteIds: resolveAssociatedRouteIds(hypothesis, links),
  };
}

/**
 * How a single route should render under the current selection:
 *   - no hypothesis active            → 'normal'  (routes render as usual)
 *   - route drives the selection      → 'highlight'
 *   - a different route               → 'dim'
 */
export function routeEmphasis(routeId: string, selection: RouteSelection): RouteEmphasis {
  if (!selection.hypothesisId) return 'normal';
  return selection.associatedRouteIds.includes(routeId) ? 'highlight' : 'dim';
}

/**
 * Partition a set of route ids into highlighted vs dimmed for the current selection.
 * Returns empty arrays when no hypothesis is active (nothing to emphasise/dim).
 */
export function partitionRoutes(
  routeIds: string[],
  selection: RouteSelection,
): { highlighted: string[]; dimmed: string[] } {
  if (!selection.hypothesisId) return { highlighted: [], dimmed: [] };
  const associated = new Set(selection.associatedRouteIds);
  const highlighted: string[] = [];
  const dimmed: string[] = [];
  for (const id of routeIds) {
    if (associated.has(id)) highlighted.push(id);
    else dimmed.push(id);
  }
  return { highlighted, dimmed };
}

/** Human-readable consensus tier for a 0–100 scholarly-consensus score. */
export function consensusLabel(level: number): string {
  if (level >= 80) return 'Strong consensus';
  if (level >= 60) return 'Moderate consensus';
  if (level >= 40) return 'Debated';
  if (level >= 20) return 'Minority view';
  return 'Fringe hypothesis';
}

/** Tailwind badge classes matching {@link consensusLabel} tiers. */
export function consensusBadgeColor(level: number): string {
  if (level >= 80) return 'bg-green-100 text-green-800';
  if (level >= 60) return 'bg-blue-100 text-blue-800';
  if (level >= 40) return 'bg-yellow-100 text-yellow-800';
  if (level >= 20) return 'bg-orange-100 text-orange-800';
  return 'bg-red-100 text-red-800';
}

/** Readable family name from a `language_family_id` (e.g. `indo-european` → `Indo European`). */
export function familyLabel(familyId: string): string {
  const leaf = familyId.split('__').pop() ?? familyId;
  return leaf
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
