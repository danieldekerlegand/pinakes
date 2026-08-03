/**
 * Authoring-time suggested relationships (US-010).
 *
 * When a contributor creates or edits an entity, this pure service surfaces the
 * *most likely* relationships to nearby entities — computed from the same
 * proximity math the cross-domain services already use
 * (`cross-domain-analysis.ts` / `cross-domain-correlation.ts`): linguistic
 * (shared associated languages), temporal (overlapping time spans), and spatial
 * (coordinate distance / shared region) proximity.
 *
 * A suggestion is exactly that — a *proposal*. It carries a rationale (which
 * proximity signals fired) and a confidence, and it is packaged with a
 * ready-to-submit {@link RelationshipEdgeInput} so the contributor can *confirm*
 * it through the normal `POST /api/relationships/edge` path (US-003). Nothing
 * here creates an edge: {@link suggestRelationships} only ranks and returns.
 *
 * The relationship-type vocabulary is the canonical edge vocabulary
 * (`RELATIONSHIP_TYPE_OPTIONS`, from `@contracts/canonical-schema` via
 * `relationship-edge.ts`) so a confirmed suggestion stays forward-compatible
 * with the shared graph.
 *
 * Everything in this module is pure — no fs / express / storage — so suggestion
 * ranking is unit-tested directly on fixtures.
 */

import {
  RELATIONSHIP_TYPE_OPTIONS,
  DEFAULT_RELATIONSHIP_CONFIDENCE,
  edgeKey,
  type RelationshipEdgeInput,
  type ExistingEdge,
} from "./relationship-edge";

// ============================================================================
// Types
// ============================================================================

/**
 * A normalized entity used as either the authoring subject (`source`) or a
 * candidate to suggest against. Deliberately domain-agnostic — anything with a
 * name, a type, and any subset of {language ids, coordinates, time span,
 * region} can participate.
 */
export interface SuggestionEntity {
  id: string;
  name: string;
  /** Free-form entity type (e.g. `civilization`, `language`, `religion`). */
  entityType: string;
  /** Associated language ids (drives the linguistic signal). */
  languageIds?: string[];
  coordinates?: { lat: number; lng: number } | null;
  /** Inclusive lower bound of the entity's active period (negative = BCE). */
  timeStart?: number | null;
  /** Inclusive upper bound; open-ended spans fall back to `now`. */
  timeEnd?: number | null;
  region?: string | null;
}

/** The three proximity dimensions plus the raw evidence behind each. */
export interface Proximity {
  /** 0..1 linguistic proximity (Jaccard of associated languages). */
  linguistic: number;
  /** 0..1 temporal proximity (share of the shorter span that overlaps). */
  temporal: number;
  /** 0..1 spatial proximity (coordinate distance and/or region match). */
  spatial: number;
  /** A dimension is *applicable* only when both entities carry its data. */
  applicable: { linguistic: boolean; temporal: boolean; spatial: boolean };
  sharedLanguages: string[];
  overlapYears: number | null;
  distanceKm: number | null;
  sharedRegion: string | null;
}

export type RationaleKind = "linguistic" | "temporal" | "spatial";

/** One human-readable reason a suggestion was surfaced. */
export interface SuggestionRationale {
  kind: RationaleKind;
  /** 0..1 proximity for this dimension. */
  score: number;
  detail: string;
}

/** A single ranked relationship proposal. */
export interface SuggestedRelationship {
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  targetType: string;
  /** Canonical edge name (e.g. `contemporary-with`). */
  relationshipType: string;
  /** Neo4j `:TYPE` token for the chosen relationship. */
  relationshipToken: string;
  /** 1..100 combined confidence over the *applicable* proximity dimensions. */
  confidence: number;
  proximity: Proximity;
  rationale: SuggestionRationale[];
  /**
   * A ready-to-submit relationship the contributor confirms unchanged (or edits)
   * — fed straight to `POST /api/relationships/edge`. Suggestions never submit.
   */
  edge: RelationshipEdgeInput;
}

export interface SuggestionWeights {
  linguistic: number;
  temporal: number;
  spatial: number;
}

export interface SuggestionOptions {
  /** Max suggestions returned (default 10). */
  limit?: number;
  /** Drop suggestions below this 1..100 confidence (default 20). */
  minConfidence?: number;
  /** Relative weight of each dimension in the combined confidence. */
  weights?: SuggestionWeights;
  /** Coordinate distance (km) at/above which spatial proximity is 0 (default 2000). */
  maxDistanceKm?: number;
  /** Reference year for open-ended time spans (default current year). */
  now?: number;
}

const DEFAULT_WEIGHTS: SuggestionWeights = {
  linguistic: 0.4,
  temporal: 0.3,
  spatial: 0.3,
};

const DEFAULT_MAX_DISTANCE_KM = 2000;
const DEFAULT_LIMIT = 10;
const DEFAULT_MIN_CONFIDENCE = 20;
/** Suggestions never claim certainty — they always need human confirmation. */
const MAX_SUGGESTION_CONFIDENCE = 95;

const RELATIONSHIP_TYPE_NAMES: ReadonlySet<string> = new Set(
  RELATIONSHIP_TYPE_OPTIONS.map((o) => o.name),
);

function tokenFor(name: string): string {
  return RELATIONSHIP_TYPE_OPTIONS.find((o) => o.name === name)?.token ?? "";
}

// ============================================================================
// Proximity math (shared with the cross-domain services)
// ============================================================================

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const aLat = (a.lat * Math.PI) / 180;
  const bLat = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(aLat) * Math.cos(bLat) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function regionsMatch(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * Compute the three-dimensional proximity between the authoring subject and a
 * candidate. A dimension is *applicable* only when both entities carry its data
 * — so a language with no coordinates simply doesn't contribute a spatial score
 * (rather than a misleading 0).
 */
export function computeProximity(
  source: SuggestionEntity,
  candidate: SuggestionEntity,
  options: SuggestionOptions = {},
): Proximity {
  const maxDistanceKm = options.maxDistanceKm ?? DEFAULT_MAX_DISTANCE_KM;
  const now = options.now ?? new Date().getFullYear();

  // --- Linguistic (Jaccard of associated languages) ---
  const srcLangs = source.languageIds ?? [];
  const tgtLangs = candidate.languageIds ?? [];
  const linguisticApplicable = srcLangs.length > 0 && tgtLangs.length > 0;
  const shared = srcLangs.filter((id) => tgtLangs.includes(id));
  let linguistic = 0;
  if (linguisticApplicable && shared.length > 0) {
    const union = new Set([...srcLangs, ...tgtLangs]);
    linguistic = shared.length / union.size;
  }

  // --- Temporal (overlap share of the shorter span) ---
  const temporalApplicable =
    source.timeStart != null && candidate.timeStart != null;
  let temporal = 0;
  let overlapYears: number | null = null;
  if (temporalApplicable) {
    const sStart = source.timeStart as number;
    const sEnd = source.timeEnd ?? now;
    const tStart = candidate.timeStart as number;
    const tEnd = candidate.timeEnd ?? now;
    const overlapStart = Math.max(sStart, tStart);
    const overlapEnd = Math.min(sEnd, tEnd);
    if (overlapStart <= overlapEnd) {
      overlapYears = overlapEnd - overlapStart;
      const maxSpan = Math.max(sEnd - sStart, tEnd - tStart, 1);
      temporal = Math.min(overlapYears / maxSpan, 1);
    } else {
      overlapYears = 0;
    }
  }

  // --- Spatial (coordinate distance and/or region match) ---
  const hasCoords = !!source.coordinates && !!candidate.coordinates;
  const hasRegions = !!source.region && !!candidate.region;
  const spatialApplicable = hasCoords || hasRegions;
  let spatial = 0;
  let distanceKm: number | null = null;
  let sharedRegion: string | null = null;
  if (hasCoords) {
    distanceKm = haversineKm(source.coordinates!, candidate.coordinates!);
    if (distanceKm < maxDistanceKm) {
      spatial = Math.max(spatial, 1 - distanceKm / maxDistanceKm);
    }
  }
  if (hasRegions && regionsMatch(source.region!, candidate.region!)) {
    spatial = Math.max(spatial, 0.5);
    sharedRegion = source.region ?? null;
  }

  return {
    linguistic,
    temporal,
    spatial,
    applicable: {
      linguistic: linguisticApplicable,
      temporal: temporalApplicable,
      spatial: spatialApplicable,
    },
    sharedLanguages: shared,
    overlapYears,
    distanceKm,
    sharedRegion,
  };
}

// ============================================================================
// Confidence + relationship-type selection
// ============================================================================

/**
 * Combined confidence (1..100) as the weighted average over the *applicable*
 * dimensions only — a signal that can't apply (e.g. no coordinates) neither
 * boosts nor dilutes the score. Returns 0 when nothing is applicable. Capped
 * below 100 so a suggestion always reads as "confirm me", never "trust me".
 */
export function combinedConfidence(
  proximity: Proximity,
  weights: SuggestionWeights = DEFAULT_WEIGHTS,
): number {
  let weighted = 0;
  let weightSum = 0;
  if (proximity.applicable.linguistic) {
    weighted += weights.linguistic * proximity.linguistic;
    weightSum += weights.linguistic;
  }
  if (proximity.applicable.temporal) {
    weighted += weights.temporal * proximity.temporal;
    weightSum += weights.temporal;
  }
  if (proximity.applicable.spatial) {
    weighted += weights.spatial * proximity.spatial;
    weightSum += weights.spatial;
  }
  if (weightSum === 0) return 0;
  const raw = Math.round((weighted / weightSum) * 100);
  return Math.max(1, Math.min(MAX_SUGGESTION_CONFIDENCE, raw));
}

function isLanguageLike(entityType: string): boolean {
  return entityType.toLowerCase().includes("language");
}

function isPlaceLike(entityType: string): boolean {
  const t = entityType.toLowerCase();
  return (
    t.includes("place") ||
    t.includes("site") ||
    t.includes("settlement") ||
    t.includes("battle")
  );
}

/**
 * Pick the canonical relationship type a suggestion should default to, from the
 * dominant proximity signal and the two entities' types. The choice is always a
 * valid canonical edge name (falls back to `influenced-by`, the domain-agnostic
 * default). The contributor can override it before confirming.
 */
export function suggestRelationshipType(
  source: SuggestionEntity,
  candidate: SuggestionEntity,
  proximity: Proximity,
): string {
  const scored: Array<[RationaleKind, number]> = [
    ["linguistic", proximity.applicable.linguistic ? proximity.linguistic : -1],
    ["temporal", proximity.applicable.temporal ? proximity.temporal : -1],
    ["spatial", proximity.applicable.spatial ? proximity.spatial : -1],
  ];
  scored.sort((a, b) => b[1] - a[1]);
  const dominant = scored[0][1] > 0 ? scored[0][0] : null;

  let name: string;
  switch (dominant) {
    case "linguistic":
      name =
        isLanguageLike(source.entityType) && isLanguageLike(candidate.entityType)
          ? "cognate-with"
          : "influenced-by";
      break;
    case "temporal":
      name = "contemporary-with";
      break;
    case "spatial":
      name = isPlaceLike(candidate.entityType) ? "located-in" : "influenced-by";
      break;
    default:
      name = "influenced-by";
  }
  return RELATIONSHIP_TYPE_NAMES.has(name) ? name : "influenced-by";
}

function buildRationale(proximity: Proximity): SuggestionRationale[] {
  const rationale: SuggestionRationale[] = [];

  if (proximity.applicable.linguistic && proximity.linguistic > 0) {
    const langs = proximity.sharedLanguages;
    rationale.push({
      kind: "linguistic",
      score: proximity.linguistic,
      detail: `Shares ${langs.length} associated language${langs.length === 1 ? "" : "s"} (${langs.join(", ")})`,
    });
  }
  if (proximity.applicable.temporal && proximity.temporal > 0) {
    rationale.push({
      kind: "temporal",
      score: proximity.temporal,
      detail: `Overlapping time span (${proximity.overlapYears} years)`,
    });
  }
  if (proximity.applicable.spatial && proximity.spatial > 0) {
    const detail = proximity.sharedRegion
      ? `Shared region: ${proximity.sharedRegion}`
      : `~${Math.round(proximity.distanceKm ?? 0)} km apart`;
    rationale.push({ kind: "spatial", score: proximity.spatial, detail });
  }

  // Strongest reason first.
  rationale.sort((a, b) => b.score - a.score);
  return rationale;
}

// ============================================================================
// Ranking
// ============================================================================

/** Undirected pair key so an existing edge blocks a suggestion either way. */
function pairKey(a: string, b: string): string {
  const x = a.trim();
  const y = b.trim();
  return x < y ? `${x} ${y}` : `${y} ${x}`;
}

/**
 * Rank the relationships worth suggesting for `source`, given the candidate
 * pool and the relationships that already exist (corpus + queue). Candidates
 * that are the subject itself, or already connected to it in *either* direction,
 * are excluded — suggestions surface *new* likely links, never ones already
 * authored. Results are ordered by confidence (desc), then name.
 */
export function suggestRelationships(
  source: SuggestionEntity,
  candidates: readonly SuggestionEntity[],
  existingEdges: readonly ExistingEdge[] = [],
  options: SuggestionOptions = {},
): SuggestedRelationship[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const weights = options.weights ?? DEFAULT_WEIGHTS;

  const connected = new Set<string>();
  for (const e of existingEdges) {
    connected.add(pairKey(e.sourceId, e.targetId));
  }

  const suggestions: SuggestedRelationship[] = [];

  for (const candidate of candidates) {
    if (candidate.id === source.id) continue;
    if (connected.has(pairKey(source.id, candidate.id))) continue;

    const proximity = computeProximity(source, candidate, options);
    const anySignal =
      (proximity.applicable.linguistic && proximity.linguistic > 0) ||
      (proximity.applicable.temporal && proximity.temporal > 0) ||
      (proximity.applicable.spatial && proximity.spatial > 0);
    if (!anySignal) continue;

    const confidence = combinedConfidence(proximity, weights);
    if (confidence < minConfidence) continue;

    const relationshipType = suggestRelationshipType(source, candidate, proximity);
    const rationale = buildRationale(proximity);

    const edge: RelationshipEdgeInput = {
      sourceId: source.id,
      sourceName: source.name,
      targetId: candidate.id,
      targetName: candidate.name,
      relationshipType,
      timeStart: source.timeStart ?? candidate.timeStart ?? null,
      timeEnd: source.timeEnd ?? candidate.timeEnd ?? null,
      confidence,
      evidenceTypes: rationale.map((r) => r.kind),
      description: rationale.map((r) => r.detail).join("; "),
    };

    suggestions.push({
      sourceId: source.id,
      sourceName: source.name,
      targetId: candidate.id,
      targetName: candidate.name,
      targetType: candidate.entityType,
      relationshipType,
      relationshipToken: tokenFor(relationshipType),
      confidence,
      proximity,
      rationale,
      edge,
    });
  }

  suggestions.sort(
    (a, b) => b.confidence - a.confidence || a.targetName.localeCompare(b.targetName),
  );
  return suggestions.slice(0, limit);
}

/** Re-exported for callers building the existing-edge exclusion set. */
export { edgeKey };
export type { ExistingEdge };
