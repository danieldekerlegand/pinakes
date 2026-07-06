/**
 * Anomaly Detection Service (US-006)
 *
 * Scans cross-domain cultural data for *statistically unexpected* similarities
 * between distant cultures — a rare shared trait (a myth motif, a pottery style,
 * a musical scale, a haplogroup) turning up in two cultures that are far apart in
 * space AND unrelated by language/lineage is a lead for undiscovered contact,
 * shared ancestry, or independent innovation.
 *
 * Everything here is PURE (no fs / express / clock / storage) and operates over
 * a generic `CultureNode` shape so it is unit-testable on synthetic fixtures and
 * dataset-agnostic — the route (routes/anomaly-detection.ts) projects live
 * storage rows into `CultureNode`s and wires the HTTP boundary.
 *
 * The scoring is honest about what it is: a *surprise* metric, not a claim. Every
 * result is framed as a hypothesis and carries its supporting evidence + the
 * provenance of the underlying records.
 */

// ============================================================================
// Types
// ============================================================================

/** One distinctive trait a culture exhibits, namespaced by `type`. */
export interface NodeFeature {
  /** Domain namespace, e.g. "myth-motif", "material-category", "music-scale". */
  type: string;
  /** Stable within-type key used for matching (lowercased/normalized upstream). */
  key: string;
  /** Human-readable label for evidence display. */
  label: string;
}

/** A culture/entity carrying a set of features, with locality + grouping. */
export interface CultureNode {
  id: string;
  name: string;
  /** Source domain of the node (e.g. "music-tradition"), for display + pairing. */
  domain: string;
  coordinates?: { lat: number; lng: number } | null;
  /** Free-text region (macro-area) used as a coarse locality signal. */
  region?: string | null;
  /**
   * Ids of the "expected similarity" groups this node belongs to — typically the
   * associated language / language-family ids. Two nodes sharing a group are
   * expected to resemble each other, so they are NOT flagged as anomalies.
   */
  groupIds?: string[];
  features: NodeFeature[];
  /** Record-level citations backing this node (provenance). */
  sources?: string[];
}

export interface SharedFeature {
  type: string;
  key: string;
  label: string;
  /** How many nodes in the corpus carry this feature. */
  prevalence: number;
  /** Fraction of nodes carrying it (0..1). */
  frequency: number;
  /** Normalized self-information of the feature (0..1); rarer ⇒ higher. */
  rarity: number;
}

export interface Separation {
  /** Great-circle distance in km when both nodes have coordinates, else null. */
  km: number | null;
  /** Separation factor in (0..1]; larger ⇒ more distant/unexpected. */
  factor: number;
  /** Whether the pair is considered "distant" (an anomaly candidate at all). */
  distant: boolean;
  /** Human-readable basis, e.g. "~11,200 km apart" or "different regions". */
  basis: string;
}

export interface CulturalAnomaly {
  entityA: { id: string; name: string; domain: string };
  entityB: { id: string; name: string; domain: string };
  sharedFeatures: SharedFeature[];
  separation: Separation;
  /** 0..1 — how statistically surprising the similarity is. Primary ranking key. */
  surpriseScore: number;
  /** 0..~0.9 — how well-supported the observation is (evidence + provenance). */
  confidence: number;
  /** Plain-language, explicitly-speculative framing of the lead. */
  hypothesis: string;
  /** Always true — these are leads, never conclusions. */
  speculative: true;
  /** Union of the two nodes' record-level citations. */
  provenance: string[];
}

export interface AnomalyOptions {
  /** Minimum surprise score to report (default 0.15). */
  minSurprise?: number;
  /** Max anomalies returned (default 50). */
  limit?: number;
  /**
   * Distance (km) below which a pair is "near" and therefore an *expected*
   * similarity, not an anomaly (default 1500).
   */
  nearKm?: number;
  /** Distance used to normalize the separation factor to 1.0 (default 20015 km). */
  maxKm?: number;
  /** Hard cap on nodes to guard the O(n²) scan (default 4000). */
  maxNodes?: number;
}

export interface AnomalyResult {
  anomalies: CulturalAnomaly[];
  stats: {
    nodesConsidered: number;
    pairsEvaluated: number;
    featuresIndexed: number;
  };
  disclaimer: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MIN_SURPRISE = 0.15;
const DEFAULT_LIMIT = 50;
const DEFAULT_NEAR_KM = 1500;
/** Half the Earth's circumference — the maximum possible great-circle distance. */
const DEFAULT_MAX_KM = 20015;
const DEFAULT_MAX_NODES = 4000;

export const ANOMALY_DISCLAIMER =
  "Hypotheses only. A statistically surprising similarity does not establish " +
  "historical contact — independent invention, shared deep ancestry, and " +
  "data-sampling artifacts are all alternative explanations. Treat these as " +
  "leads for further research, not conclusions.";

// ============================================================================
// Pure helpers
// ============================================================================

/** Great-circle distance in km between two lat/lng points. */
export function haversineKm(
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

/** Compose a `type` + `key` into a single index key. */
export function featureKey(f: { type: string; key: string }): string {
  return `${f.type}::${f.key}`;
}

/**
 * Count how many nodes carry each feature. A node contributes at most once per
 * feature key (deduped), so prevalence is a node count, not an occurrence count.
 */
export function computeFeaturePrevalence(
  nodes: CultureNode[],
): Map<string, number> {
  const prevalence = new Map<string, number>();
  for (const node of nodes) {
    const seen = new Set<string>();
    for (const feature of node.features) {
      const k = featureKey(feature);
      if (seen.has(k)) continue;
      seen.add(k);
      prevalence.set(k, (prevalence.get(k) ?? 0) + 1);
    }
  }
  return prevalence;
}

/**
 * Normalized self-information of a feature: `-log2(freq) / log2(total)`, clamped
 * to [0,1]. A feature carried by a single node ⇒ ~1 (maximally rare); a feature
 * carried by every node ⇒ 0 (uninformative).
 */
export function featureRarity(prevalence: number, total: number): number {
  if (total <= 1 || prevalence <= 0) return 0;
  const freq = prevalence / total;
  const info = -Math.log2(freq);
  const maxInfo = Math.log2(total);
  if (maxInfo <= 0) return 0;
  return Math.min(1, Math.max(0, info / maxInfo));
}

/**
 * Compute how "distant" two nodes are. Coordinates give a real great-circle
 * distance; otherwise fall back to region/group mismatch as a coarse proxy.
 */
export function separation(
  a: CultureNode,
  b: CultureNode,
  opts?: { nearKm?: number; maxKm?: number },
): Separation {
  const nearKm = opts?.nearKm ?? DEFAULT_NEAR_KM;
  const maxKm = opts?.maxKm ?? DEFAULT_MAX_KM;

  if (a.coordinates && b.coordinates) {
    const km = haversineKm(a.coordinates, b.coordinates);
    const factor = Math.max(0, Math.min(1, km / maxKm));
    return {
      km: Math.round(km),
      factor,
      distant: km >= nearKm,
      basis: `~${Math.round(km).toLocaleString("en-US")} km apart`,
    };
  }

  // No coordinates on one/both sides — use region + group mismatch as a proxy.
  const sameRegion = regionsMatch(a.region, b.region);
  const sameGroup = groupsOverlap(a.groupIds, b.groupIds);
  const distant = !sameRegion && !sameGroup;
  return {
    km: null,
    factor: distant ? 0.6 : 0,
    distant,
    basis: distant
      ? "different regions and unrelated groups (no coordinates)"
      : sameRegion
        ? "same region"
        : "related groups",
  };
}

function regionsMatch(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function groupsOverlap(a?: string[], b?: string[]): boolean {
  if (!a || !b || a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  return b.some((g) => set.has(g));
}

/** Round to 3 decimals for stable, readable scores. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ============================================================================
// Pairwise anomaly
// ============================================================================

/**
 * Evaluate a single pair. Returns null when the pair is not an anomaly:
 * no shared (non-universal) features, an expected similarity (same group /
 * geographically near), or below-surprise.
 */
export function pairAnomaly(
  a: CultureNode,
  b: CultureNode,
  prevalence: Map<string, number>,
  total: number,
  opts?: AnomalyOptions,
): CulturalAnomaly | null {
  const minSurprise = opts?.minSurprise ?? DEFAULT_MIN_SURPRISE;

  // Sharing a language/lineage group is an EXPECTED similarity — never an anomaly.
  if (groupsOverlap(a.groupIds, b.groupIds)) return null;

  const sep = separation(a, b, opts);
  if (!sep.distant) return null;

  const shared = sharedFeatures(a, b, prevalence, total);
  if (shared.length === 0) return null;

  // Rarity of the single most surprising shared trait drives the score, with a
  // bounded boost for corroborating shared traits.
  const maxRarity = shared.reduce((m, f) => Math.max(m, f.rarity), 0);
  const multiBoost = Math.min(0.15 * (shared.length - 1), 0.3);
  const rarityScore = Math.min(1, maxRarity + multiBoost);

  const surpriseScore = round3(rarityScore * sep.factor);
  if (surpriseScore < minSurprise) return null;

  const provenance = mergeProvenance(a.sources, b.sources);
  const hasCitations = provenance.length > 0;
  const hasCoords = sep.km !== null;
  const confidence = round3(
    Math.max(
      0,
      Math.min(
        0.9,
        0.25 +
          0.15 * shared.length +
          (hasCitations ? 0.2 : 0) +
          (hasCoords ? 0.1 : 0),
      ),
    ),
  );

  return {
    entityA: { id: a.id, name: a.name, domain: a.domain },
    entityB: { id: b.id, name: b.name, domain: b.domain },
    sharedFeatures: shared,
    separation: sep,
    surpriseScore,
    confidence,
    hypothesis: buildHypothesis(a, b, shared, sep),
    speculative: true,
    provenance,
  };
}

/** Non-universal features present in BOTH nodes, with rarity, rarest-first. */
function sharedFeatures(
  a: CultureNode,
  b: CultureNode,
  prevalence: Map<string, number>,
  total: number,
): SharedFeature[] {
  const bKeys = new Map<string, NodeFeature>();
  for (const f of b.features) bKeys.set(featureKey(f), f);

  const shared: SharedFeature[] = [];
  const seen = new Set<string>();
  for (const f of a.features) {
    const k = featureKey(f);
    if (seen.has(k) || !bKeys.has(k)) continue;
    seen.add(k);
    const count = prevalence.get(k) ?? 0;
    // A feature carried by every node carries no surprise — skip it.
    if (count >= total) continue;
    shared.push({
      type: f.type,
      key: f.key,
      label: f.label,
      prevalence: count,
      frequency: round3(total > 0 ? count / total : 0),
      rarity: round3(featureRarity(count, total)),
    });
  }
  shared.sort((x, y) => y.rarity - x.rarity || x.key.localeCompare(y.key));
  return shared;
}

function mergeProvenance(a?: string[], b?: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of [...(a ?? []), ...(b ?? [])]) {
    const v = (s ?? "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function buildHypothesis(
  a: CultureNode,
  b: CultureNode,
  shared: SharedFeature[],
  sep: Separation,
): string {
  const labels = shared.slice(0, 3).map((f) => `"${f.label}"`).join(", ");
  const more = shared.length > 3 ? ` (+${shared.length - 3} more)` : "";
  return (
    `${a.name} and ${b.name} both exhibit ${labels}${more}, yet are ${sep.basis}. ` +
    `This unexpected shared trait may hint at undocumented contact, deep shared ` +
    `ancestry, or independent innovation — a lead worth investigating, not a conclusion.`
  );
}

// ============================================================================
// Corpus scan
// ============================================================================

/**
 * Scan all comparable node pairs and return the most surprising anomalies,
 * ranked by surprise (then confidence, then stable id order).
 */
export function detectAnomalies(
  nodes: CultureNode[],
  opts?: AnomalyOptions,
): AnomalyResult {
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const maxNodes = opts?.maxNodes ?? DEFAULT_MAX_NODES;

  const considered = nodes.slice(0, maxNodes);
  const prevalence = computeFeaturePrevalence(considered);
  const total = considered.length;

  const anomalies: CulturalAnomaly[] = [];
  let pairsEvaluated = 0;
  for (let i = 0; i < considered.length; i++) {
    for (let j = i + 1; j < considered.length; j++) {
      pairsEvaluated++;
      const anomaly = pairAnomaly(
        considered[i],
        considered[j],
        prevalence,
        total,
        opts,
      );
      if (anomaly) anomalies.push(anomaly);
    }
  }

  anomalies.sort(
    (x, y) =>
      y.surpriseScore - x.surpriseScore ||
      y.confidence - x.confidence ||
      x.entityA.id.localeCompare(y.entityA.id) ||
      x.entityB.id.localeCompare(y.entityB.id),
  );

  return {
    anomalies: anomalies.slice(0, limit),
    stats: {
      nodesConsidered: total,
      pairsEvaluated,
      featuresIndexed: prevalence.size,
    },
    disclaimer: ANOMALY_DISCLAIMER,
  };
}
