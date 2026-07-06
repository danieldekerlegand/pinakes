/**
 * Automated Hypothesis & Site-Location Generation (US-007)
 *
 * Two families of *generated, explicitly-speculative* research leads over the
 * shared cross-domain corpus:
 *
 *  1. **Common-ancestor hypotheses** — clusters of three-or-more distant, unrelated
 *     cultures that all share the SAME rare trait(s) (a pottery style, a haplogroup
 *     marker, a myth motif, …). Such a coincidence among cultures that are far apart
 *     in space and unrelated by language is a lead for a shared ancestor, a diffusion
 *     source, or independent innovation — never a conclusion. This generalizes the
 *     pairwise US-006 anomaly to n-way clusters and reuses its rarity primitives.
 *
 *  2. **Undiscovered-site-region predictions** — regions where an as-yet-unexcavated
 *     site is *likely*, inferred from documented migration corridors and settlement
 *     patterns: a long stretch of a migration route that runs far from any known site
 *     or settlement is a gap where travellers must have passed but nothing is recorded.
 *     Each prediction is a center + an **uncertainty radius** (bigger gap ⇒ larger,
 *     less certain region) so the client can render it as a map overlay with uncertainty.
 *
 * Everything here is PURE (no fs / express / clock / storage), operating over generic
 * inputs so it is unit-testable on synthetic fixtures and dataset-agnostic; the route
 * (routes/hypotheses.ts) projects live storage into these shapes and owns the HTTP
 * boundary. These generated hypotheses are DISTINCT from the curated
 * `urheimat-hypotheses` dataset — they are marked `generated: true` + `speculative: true`
 * and never overwrite or masquerade as that scholarly, human-curated resource.
 */

import {
  type CultureNode,
  type NodeFeature,
  computeFeaturePrevalence,
  featureKey,
  featureRarity,
  haversineKm,
} from "./anomaly-detection";

// Re-export the node shape so route/tests import from one place.
export type { CultureNode, NodeFeature } from "./anomaly-detection";

// ============================================================================
// Types
// ============================================================================

/** One rare trait shared across a cluster, with its corpus-wide rarity. */
export interface SharedTrait {
  type: string;
  key: string;
  label: string;
  /** How many nodes in the corpus carry this trait. */
  prevalence: number;
  /** Fraction of nodes carrying it (0..1). */
  frequency: number;
  /** Normalized self-information (0..1); rarer ⇒ higher. */
  rarity: number;
}

/** A generated "these cultures may share an ancestor" lead. */
export interface CommonAncestorHypothesis {
  id: string;
  kind: "common-ancestor";
  /** The clustered cultures (≥ minMembers). */
  members: { id: string; name: string; domain: string }[];
  /** Rare traits every member shares — the evidence. */
  sharedTraits: SharedTrait[];
  /** Mean coordinate of members with coordinates (null if none). */
  centroid: { lat: number; lng: number } | null;
  /** Max pairwise great-circle distance among located members (null if <2). */
  spreadKm: number | null;
  /** 0..~0.9 — how well-supported the lead is (traits + members + provenance + spread). */
  confidence: number;
  /** Plain-language, explicitly-speculative framing. */
  hypothesis: string;
  speculative: true;
  /** Always true — this is a generated lead, not the curated urheimat dataset. */
  generated: true;
  /** Deduped union of members' record-level citations. */
  provenance: string[];
}

/** A migration/trade corridor as an ordered list of lat/lng points. */
export interface CorridorInput {
  id: string;
  name: string;
  /** Ordered waypoints (already parsed to lat/lng). */
  points: { lat: number; lng: number }[];
  /** Optional label of the peoples/route type, for the rationale. */
  peoples?: string[];
}

/** A generated "an undiscovered site is likely near here" prediction. */
export interface PredictedSiteRegion {
  id: string;
  kind: "site-location";
  /** Predicted region center. */
  center: { lat: number; lng: number };
  /** Radius (km) of the uncertainty region — larger ⇒ less certain. */
  uncertaintyRadiusKm: number;
  /** 0..~0.85 — confidence a site exists in the region. */
  confidence: number;
  /** Distance (km) to the nearest known site/settlement (the gap size). */
  nearestKnownKm: number;
  /** The corridor this gap sits on. */
  basedOn: { corridorId: string; corridorName: string };
  rationale: string;
  speculative: true;
  generated: true;
}

export interface HypothesisInput {
  /** Feature-bearing culture nodes for the ancestor clustering. */
  nodes: CultureNode[];
  /** Migration/trade corridors for the site prediction. */
  corridors: CorridorInput[];
  /** Coordinates of already-known sites + settlements. */
  knownSites: { lat: number; lng: number }[];
}

export interface HypothesisOptions {
  // --- ancestor clustering ---
  /** Minimum cultures in a cluster (default 3 — "cultures A/B/C"). */
  minMembers?: number;
  /** Minimum rarity for a trait to anchor a cluster (default 0.4). */
  minRarity?: number;
  /**
   * Max corpus prevalence for an anchoring trait — a trait carried by many
   * cultures is not a distinctive shared signal (default 8).
   */
  maxAnchorPrevalence?: number;
  /** Minimum spread (km) between the two farthest members to count as "distant" (default 2000). */
  minSpreadKm?: number;
  /** Max ancestor hypotheses returned (default 25). */
  maxAncestorHypotheses?: number;
  /** Hard cap on nodes to guard the clustering scan (default 4000). */
  maxNodes?: number;

  // --- site prediction ---
  /**
   * A corridor point counts as a "gap" (candidate) when the nearest known
   * site is at least this far away, in km (default 300).
   */
  minGapKm?: number;
  /** Cap on how large an uncertainty radius can grow, in km (default 400). */
  maxUncertaintyKm?: number;
  /** Max site predictions returned (default 25). */
  maxSitePredictions?: number;
}

export interface HypothesisResult {
  ancestorHypotheses: CommonAncestorHypothesis[];
  sitePredictions: PredictedSiteRegion[];
  stats: {
    nodesConsidered: number;
    traitsIndexed: number;
    clustersFound: number;
    corridorsScanned: number;
    knownSites: number;
  };
  disclaimer: string;
  /** How these generated leads relate to the curated urheimat dataset. */
  distinctFromCurated: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MIN_MEMBERS = 3;
const DEFAULT_MIN_RARITY = 0.4;
const DEFAULT_MAX_ANCHOR_PREVALENCE = 8;
const DEFAULT_MIN_SPREAD_KM = 2000;
const DEFAULT_MAX_ANCESTOR = 25;
const DEFAULT_MAX_NODES = 4000;

const DEFAULT_MIN_GAP_KM = 300;
const DEFAULT_MAX_UNCERTAINTY_KM = 400;
const DEFAULT_MAX_SITE_PREDICTIONS = 25;
/**
 * Effective gap for a corridor point with NO known site anywhere in the corpus —
 * a whole corridor devoid of recorded sites is the strongest "undiscovered" signal,
 * so we treat it as a large (but finite, capped) gap rather than dropping it.
 */
const NO_KNOWN_SITE_GAP_KM = 3000;

export const HYPOTHESIS_DISCLAIMER =
  "Automatically generated hypotheses. These are computational leads, not " +
  "findings: a shared rare trait may reflect independent invention or sampling " +
  "bias, and a predicted site region is a probabilistic guess from incomplete " +
  "data. Treat every item here as a direction for research to confirm or refute.";

export const DISTINCT_FROM_CURATED =
  "Generated leads — distinct from the curated `urheimat-hypotheses` dataset, " +
  "which is a human-reviewed scholarly resource. These are produced by the " +
  "correlation engine, marked speculative, and never overwrite or stand in for it.";

// ============================================================================
// Small pure helpers
// ============================================================================

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Mean of a list of coordinates (null when empty). */
export function centroidOf(
  coords: { lat: number; lng: number }[],
): { lat: number; lng: number } | null {
  if (coords.length === 0) return null;
  let lat = 0;
  let lng = 0;
  for (const c of coords) {
    lat += c.lat;
    lng += c.lng;
  }
  return { lat: round3(lat / coords.length), lng: round3(lng / coords.length) };
}

/** Largest pairwise great-circle distance among the coordinates (null when <2). */
export function maxSpreadKm(
  coords: { lat: number; lng: number }[],
): number | null {
  if (coords.length < 2) return null;
  let max = 0;
  for (let i = 0; i < coords.length; i++) {
    for (let j = i + 1; j < coords.length; j++) {
      const d = haversineKm(coords[i], coords[j]);
      if (d > max) max = d;
    }
  }
  return Math.round(max);
}

function mergeProvenance(lists: (string[] | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const s of list ?? []) {
      const v = (s ?? "").trim();
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/** Whether every member shares at least one groupId (an expected, same-lineage cluster). */
function allShareAGroup(members: CultureNode[]): boolean {
  if (members.length < 2) return true;
  // Count group membership; a group present in ALL members makes the cluster "expected".
  const counts = new Map<string, number>();
  for (const m of members) {
    const groups = Array.from(new Set(m.groupIds ?? []));
    for (const g of groups) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  for (const c of Array.from(counts.values())) {
    if (c === members.length) return true;
  }
  return false;
}

// ============================================================================
// Common-ancestor hypotheses
// ============================================================================

/**
 * Cluster cultures that all carry the same rare trait. Each rare trait whose
 * carrier set is large enough (≥ minMembers), diverse enough (not all one
 * lineage), and geographically spread becomes a candidate cluster; the cluster's
 * evidence is EVERY rare trait its whole membership shares (the anchor plus any
 * corroborating co-occurring rare traits).
 */
export function generateAncestorHypotheses(
  nodes: CultureNode[],
  opts?: HypothesisOptions,
): CommonAncestorHypothesis[] {
  const minMembers = opts?.minMembers ?? DEFAULT_MIN_MEMBERS;
  const minRarity = opts?.minRarity ?? DEFAULT_MIN_RARITY;
  const maxAnchorPrev = opts?.maxAnchorPrevalence ?? DEFAULT_MAX_ANCHOR_PREVALENCE;
  const minSpreadKm = opts?.minSpreadKm ?? DEFAULT_MIN_SPREAD_KM;
  const maxOut = opts?.maxAncestorHypotheses ?? DEFAULT_MAX_ANCESTOR;
  const maxNodes = opts?.maxNodes ?? DEFAULT_MAX_NODES;

  const considered = nodes.slice(0, maxNodes);
  const total = considered.length;
  const prevalence = computeFeaturePrevalence(considered);

  // Index: feature key -> the nodes carrying it (deduped).
  const carriers = new Map<string, CultureNode[]>();
  for (const node of considered) {
    const seen = new Set<string>();
    for (const f of node.features) {
      const k = featureKey(f);
      if (seen.has(k)) continue;
      seen.add(k);
      const list = carriers.get(k) ?? [];
      list.push(node);
      carriers.set(k, list);
    }
  }

  const hypotheses: CommonAncestorHypothesis[] = [];
  const emittedMemberKeys = new Set<string>();

  // Anchor on rare traits, rarest-first for stable, meaningful ids.
  const anchors = Array.from(carriers.keys())
    .map((k) => ({
      k,
      prev: prevalence.get(k) ?? 0,
      rarity: featureRarity(prevalence.get(k) ?? 0, total),
    }))
    .filter(
      (a) =>
        a.prev >= minMembers &&
        a.prev <= maxAnchorPrev &&
        a.rarity >= minRarity,
    )
    .sort((x, y) => y.rarity - x.rarity || x.k.localeCompare(y.k));

  for (const anchor of anchors) {
    const members = carriers.get(anchor.k) ?? [];
    if (members.length < minMembers) continue;

    // Same-lineage clusters are expected, not hypotheses.
    if (allShareAGroup(members)) continue;

    // Require real geographic spread among located members.
    const located = members
      .map((m) => m.coordinates)
      .filter((c): c is { lat: number; lng: number } => !!c);
    const spread = maxSpreadKm(located);
    // If we have coordinates for ≥2 members, they must actually be far apart.
    if (spread !== null && spread < minSpreadKm) continue;

    // Dedup identical member sets (a corroborating trait shared by the same set).
    const memberKey = members
      .map((m) => m.id)
      .sort()
      .join("|");
    if (emittedMemberKeys.has(memberKey)) continue;
    emittedMemberKeys.add(memberKey);

    const shared = traitsSharedByAll(members, prevalence, total, minRarity);
    // The anchor should be present; guard against an empty evidence set.
    if (shared.length === 0) continue;

    hypotheses.push(
      buildAncestorHypothesis(members, shared, spread, located),
    );
  }

  hypotheses.sort(
    (x, y) =>
      y.confidence - x.confidence ||
      y.sharedTraits.length - x.sharedTraits.length ||
      x.id.localeCompare(y.id),
  );
  return hypotheses.slice(0, maxOut);
}

/** Rare traits present in EVERY member, rarest-first. */
function traitsSharedByAll(
  members: CultureNode[],
  prevalence: Map<string, number>,
  total: number,
  minRarity: number,
): SharedTrait[] {
  if (members.length === 0) return [];
  // Start from the first member's trait set, intersect with the rest.
  const label = new Map<string, NodeFeature>();
  let common: Set<string> | null = null;
  for (const m of members) {
    const keys = new Set<string>();
    for (const f of m.features) {
      const k = featureKey(f);
      keys.add(k);
      if (!label.has(k)) label.set(k, f);
    }
    if (common === null) {
      common = keys;
    } else {
      const prev: Set<string> = common;
      common = new Set(Array.from(prev).filter((k: string) => keys.has(k)));
    }
  }
  const commonKeys: string[] = common ? Array.from(common) : [];
  const out: SharedTrait[] = [];
  for (const k of commonKeys) {
    const count = prevalence.get(k) ?? 0;
    if (count >= total) continue; // universal ⇒ no signal
    const rarity = round3(featureRarity(count, total));
    if (rarity < minRarity) continue;
    const f = label.get(k)!;
    out.push({
      type: f.type,
      key: f.key,
      label: f.label,
      prevalence: count,
      frequency: round3(total > 0 ? count / total : 0),
      rarity,
    });
  }
  out.sort((x, y) => y.rarity - x.rarity || x.key.localeCompare(y.key));
  return out;
}

function buildAncestorHypothesis(
  members: CultureNode[],
  shared: SharedTrait[],
  spread: number | null,
  located: { lat: number; lng: number }[],
): CommonAncestorHypothesis {
  const sorted = [...members].sort((a, b) => a.id.localeCompare(b.id));
  const provenance = mergeProvenance(sorted.map((m) => m.sources));
  const centroid = centroidOf(located);

  // Confidence: more independent rare traits + more members + provenance + real
  // coordinates all raise support; capped below certainty.
  const confidence = round3(
    clamp(
      0.2 +
        0.1 * Math.min(shared.length, 4) +
        0.05 * Math.min(members.length - DEFAULT_MIN_MEMBERS + 1, 4) +
        (provenance.length > 0 ? 0.15 : 0) +
        (spread !== null ? 0.1 : 0),
      0,
      0.9,
    ),
  );

  const id = `ancestor:${sorted.map((m) => m.id).join("+")}`.slice(0, 200);
  return {
    id,
    kind: "common-ancestor",
    members: sorted.map((m) => ({ id: m.id, name: m.name, domain: m.domain })),
    sharedTraits: shared,
    centroid,
    spreadKm: spread,
    confidence,
    hypothesis: buildAncestorProse(sorted, shared, spread),
    speculative: true,
    generated: true,
    provenance,
  };
}

function buildAncestorProse(
  members: CultureNode[],
  shared: SharedTrait[],
  spread: number | null,
): string {
  const names = members.map((m) => m.name);
  const nameList =
    names.length <= 3
      ? names.join(", ")
      : `${names.slice(0, 3).join(", ")} (+${names.length - 3} more)`;
  const traits = shared
    .slice(0, 3)
    .map((t) => `"${t.label}"`)
    .join(", ");
  const more = shared.length > 3 ? ` and ${shared.length - 3} other rare traits` : "";
  const distance =
    spread !== null
      ? ` despite lying up to ~${spread.toLocaleString("en-US")} km apart`
      : "";
  return (
    `${nameList} all share ${traits}${more}${distance}. A rare trait recurring ` +
    `across cultures this distant and unrelated may point to a common ancestor, an ` +
    `undocumented diffusion route, or independent innovation — a lead to investigate, ` +
    `not a conclusion.`
  );
}

// ============================================================================
// Undiscovered-site-region prediction
// ============================================================================

/** Distance from a point to the nearest of a set of known points (∞ if none). */
export function nearestKnownKm(
  point: { lat: number; lng: number },
  known: { lat: number; lng: number }[],
): number {
  let min = Infinity;
  for (const k of known) {
    const d = haversineKm(point, k);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Scan each corridor's waypoints (and their midpoints, so long straight legs are
 * sampled) for points that lie far from any known site — a gap where travellers
 * passed but nothing is recorded. Each surviving gap becomes a predicted region
 * whose uncertainty radius scales with the gap size.
 */
export function predictSiteRegions(
  corridors: CorridorInput[],
  knownSites: { lat: number; lng: number }[],
  opts?: HypothesisOptions,
): PredictedSiteRegion[] {
  const minGapKm = opts?.minGapKm ?? DEFAULT_MIN_GAP_KM;
  const maxUncertainty = opts?.maxUncertaintyKm ?? DEFAULT_MAX_UNCERTAINTY_KM;
  const maxOut = opts?.maxSitePredictions ?? DEFAULT_MAX_SITE_PREDICTIONS;

  const predictions: PredictedSiteRegion[] = [];

  for (const corridor of corridors) {
    const samples = sampleCorridor(corridor.points);
    // Keep only the single best (largest-gap) prediction per corridor leg region,
    // deduping near-identical centers so one long empty corridor isn't spammy.
    const seenCells = new Set<string>();
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      const raw = nearestKnownKm(p, knownSites);
      // No known site anywhere ⇒ a capped "very far" gap (strongest signal).
      const gap = Number.isFinite(raw) ? raw : NO_KNOWN_SITE_GAP_KM;
      if (gap < minGapKm) continue;

      // ~1° cell dedup so adjacent samples in the same empty stretch collapse.
      const cell = `${Math.round(p.lat)},${Math.round(p.lng)}`;
      if (seenCells.has(cell)) continue;
      seenCells.add(cell);

      const uncertainty = Math.round(clamp(gap * 0.5, 50, maxUncertainty));
      // Confidence: a bigger gap on a documented corridor is a stronger lead, but
      // an enormous gap is also more uncertain — so cap and taper.
      const confidence = round3(
        clamp(0.25 + 0.4 * Math.min(gap / 1500, 1), 0.2, 0.85),
      );

      predictions.push({
        id: `site:${corridor.id}:${Math.round(p.lat)}:${Math.round(p.lng)}`,
        kind: "site-location",
        center: { lat: round3(p.lat), lng: round3(p.lng) },
        uncertaintyRadiusKm: uncertainty,
        confidence,
        nearestKnownKm: Math.round(gap),
        basedOn: { corridorId: corridor.id, corridorName: corridor.name },
        rationale: buildSiteRationale(corridor, gap),
        speculative: true,
        generated: true,
      });
    }
  }

  predictions.sort(
    (a, b) =>
      b.nearestKnownKm - a.nearestKnownKm ||
      b.confidence - a.confidence ||
      a.id.localeCompare(b.id),
  );
  return predictions.slice(0, maxOut);
}

/**
 * Return each waypoint plus the midpoint of every leg, so a long straight segment
 * between two waypoints is still sampled in its middle (where a gap would hide).
 */
export function sampleCorridor(
  points: { lat: number; lng: number }[],
): { lat: number; lng: number }[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [points[0]];
  const out: { lat: number; lng: number }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    out.push(a);
    out.push({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
  }
  out.push(points[points.length - 1]);
  return out;
}

function buildSiteRationale(corridor: CorridorInput, gap: number): string {
  const peoples =
    corridor.peoples && corridor.peoples.length > 0
      ? ` (${corridor.peoples.join(", ")})`
      : "";
  return (
    `On the ${corridor.name} corridor${peoples}, this point lies ~${Math.round(
      gap,
    ).toLocaleString("en-US")} km from the nearest recorded site — a stretch ` +
    `travellers crossed but where no settlement is documented. An undiscovered ` +
    `site may lie within the highlighted region; the radius reflects the ` +
    `positional uncertainty.`
  );
}

// ============================================================================
// GeoJSON overlay
// ============================================================================

export interface UncertaintyCircleFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    id: string;
    kind: "site-location";
    uncertaintyRadiusKm: number;
    confidence: number;
    nearestKnownKm: number;
    corridorName: string;
    rationale: string;
    speculative: true;
    generated: true;
  };
}

export interface UncertaintyFeatureCollection {
  type: "FeatureCollection";
  features: UncertaintyCircleFeature[];
}

/**
 * Project site predictions into a GeoJSON `FeatureCollection` of points carrying
 * an `uncertaintyRadiusKm`, so the map layer can draw each as a circle whose size
 * = the uncertainty region and whose styling = the confidence.
 */
export function sitePredictionsToGeoJSON(
  predictions: PredictedSiteRegion[],
): UncertaintyFeatureCollection {
  return {
    type: "FeatureCollection",
    features: predictions.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.center.lng, p.center.lat] },
      properties: {
        id: p.id,
        kind: "site-location",
        uncertaintyRadiusKm: p.uncertaintyRadiusKm,
        confidence: p.confidence,
        nearestKnownKm: p.nearestKnownKm,
        corridorName: p.basedOn.corridorName,
        rationale: p.rationale,
        speculative: true,
        generated: true,
      },
    })),
  };
}

// ============================================================================
// Orchestrator
// ============================================================================

export function generateHypotheses(
  input: HypothesisInput,
  opts?: HypothesisOptions,
): HypothesisResult {
  const maxNodes = opts?.maxNodes ?? DEFAULT_MAX_NODES;
  const considered = input.nodes.slice(0, maxNodes);
  const prevalence = computeFeaturePrevalence(considered);

  const ancestorHypotheses = generateAncestorHypotheses(input.nodes, opts);
  const sitePredictions = predictSiteRegions(
    input.corridors,
    input.knownSites,
    opts,
  );

  return {
    ancestorHypotheses,
    sitePredictions,
    stats: {
      nodesConsidered: considered.length,
      traitsIndexed: prevalence.size,
      clustersFound: ancestorHypotheses.length,
      corridorsScanned: input.corridors.length,
      knownSites: input.knownSites.length,
    },
    disclaimer: HYPOTHESIS_DISCLAIMER,
    distinctFromCurated: DISTINCT_FROM_CURATED,
  };
}
