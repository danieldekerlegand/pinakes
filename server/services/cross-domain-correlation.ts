/**
 * Cross-Domain Correlation Service
 *
 * Computes correlations between cultural domains (language, cuisine, music,
 * religion, haplogroup, civilization) using co-occurrence, temporal correlation,
 * and geographic overlap analysis.
 */

import { TsvStorage } from "../tsv-storage";

// ============================================================================
// Types
// ============================================================================

export type DomainType =
  | "language"
  | "cuisine"
  | "music"
  | "religion"
  | "haplogroup"
  | "civilization";

export type RelationshipType =
  | "co-occurrence"
  | "temporal-correlation"
  | "geographic-overlap";

export interface CorrelationRequest {
  domainA: DomainType;
  domainB: DomainType;
  relationshipType: RelationshipType;
}

export interface CorrelationEntry {
  entityA: { id: string; name: string; domain: DomainType };
  entityB: { id: string; name: string; domain: DomainType };
  score: number;
  evidence: string[];
}

export interface CorrelationResult {
  domainA: DomainType;
  domainB: DomainType;
  correlations: CorrelationEntry[];
  summary: string;
}

export interface PrebuiltQuery {
  id: string;
  name: string;
  description: string;
  request: CorrelationRequest;
}

// ============================================================================
// Domain Entity
// ============================================================================

/**
 * The storage-agnostic shape the correlation algorithms operate over. Both the
 * in-memory TSV loaders (below) and the graph-backed loader
 * (cross-domain-correlation-graph.ts, US-007) project their source into this
 * shape, so the scoring is computed by the exact same pure functions regardless
 * of where the entities came from — which is what makes the two paths produce
 * bit-identical results on a shared fixture.
 */
export interface DomainEntity {
  id: string;
  name: string;
  domain: DomainType;
  languageIds: string[];
  region: string | null;
  coordinates: { lat: number; lng: number } | null;
  timeStart: number | null;
  timeEnd: number | null;
}

// ============================================================================
// Pre-built Queries
// ============================================================================

const PREBUILT_QUERIES: PrebuiltQuery[] = [
  {
    id: "ie-r1b",
    name: "Indo-European languages vs. R1b haplogroup distribution",
    description:
      "Explores the co-occurrence of Indo-European language speakers and the R1b Y-DNA haplogroup, which is concentrated in Western Europe and often linked to the spread of Celtic and Italic branches.",
    request: {
      domainA: "language",
      domainB: "haplogroup",
      relationshipType: "co-occurrence",
    },
  },
  {
    id: "islam-arabic",
    name: "Spread of Islam vs. Arabic loanwords",
    description:
      "Examines the temporal and geographic correlation between the expansion of Islam and the adoption of Arabic loanwords across contact languages from Swahili to Malay.",
    request: {
      domainA: "religion",
      domainB: "language",
      relationshipType: "temporal-correlation",
    },
  },
  {
    id: "austronesian-outrigger",
    name: "Austronesian expansion vs. outrigger canoe archaeology",
    description:
      "Traces the geographic overlap between Austronesian-speaking populations and archaeological evidence of outrigger canoe technology from Taiwan to Madagascar.",
    request: {
      domainA: "language",
      domainB: "civilization",
      relationshipType: "geographic-overlap",
    },
  },
  {
    id: "roman-roads-romance",
    name: "Roman roads vs. Romance language boundaries",
    description:
      "Investigates how Roman infrastructure and civilization boundaries correlate with the modern distribution of Romance languages descended from Latin.",
    request: {
      domainA: "civilization",
      domainB: "language",
      relationshipType: "geographic-overlap",
    },
  },
];

// ============================================================================
// Correlation core (pure — shared by the in-memory and graph-backed paths)
// ============================================================================

/**
 * Score a correlation query over two already-loaded domain entity sets. Pure and
 * storage-agnostic: it makes no distinction between entities loaded from TSV and
 * entities projected out of Neo4j, so the graph-backed path (US-007) reuses it
 * verbatim to guarantee parity with the in-memory path. `nowYear` fills the end
 * of an open-ended span and is a parameter so results are deterministic.
 */
export function scoreCorrelations(
  relationshipType: RelationshipType,
  entitiesA: DomainEntity[],
  entitiesB: DomainEntity[],
  nowYear: number = new Date().getFullYear(),
): CorrelationEntry[] {
  switch (relationshipType) {
    case "co-occurrence":
      return computeCoOccurrence(entitiesA, entitiesB);
    case "temporal-correlation":
      return computeTemporalCorrelation(entitiesA, entitiesB, nowYear);
    case "geographic-overlap":
      return computeGeographicOverlap(entitiesA, entitiesB);
  }
}

/**
 * Rank scored correlations into the final result: sort by score descending, keep
 * the top 50, and build the summary line. Pure; shared by both paths so the
 * ranked output is identical.
 */
export function rankCorrelations(
  domainA: DomainType,
  domainB: DomainType,
  relationshipType: RelationshipType,
  correlations: CorrelationEntry[],
): CorrelationResult {
  const sorted = [...correlations].sort((a, b) => b.score - a.score).slice(0, 50);
  const avgScore =
    sorted.length > 0
      ? sorted.reduce((sum, c) => sum + c.score, 0) / sorted.length
      : 0;
  const summary = `Found ${sorted.length} ${relationshipType} correlations between ${domainA} and ${domainB} domains (avg score: ${avgScore.toFixed(2)}).`;
  return { domainA, domainB, correlations: sorted, summary };
}

/**
 * Co-occurrence: entities that share associated languages, scored by Jaccard
 * similarity of their language-id sets.
 */
export function computeCoOccurrence(
  entitiesA: DomainEntity[],
  entitiesB: DomainEntity[],
): CorrelationEntry[] {
  const correlations: CorrelationEntry[] = [];

  for (const a of entitiesA) {
    if (a.languageIds.length === 0) continue;
    for (const b of entitiesB) {
      if (b.languageIds.length === 0) continue;
      if (a.id === b.id && a.domain === b.domain) continue;

      const shared = a.languageIds.filter((id) => b.languageIds.includes(id));
      if (shared.length === 0) continue;

      // Jaccard similarity
      const union = new Set([...a.languageIds, ...b.languageIds]);
      const score = shared.length / union.size;

      correlations.push({
        entityA: { id: a.id, name: a.name, domain: a.domain },
        entityB: { id: b.id, name: b.name, domain: b.domain },
        score: Math.round(score * 100) / 100,
        evidence: [
          `Shared language IDs: ${shared.join(", ")}`,
          `Jaccard similarity: ${shared.length}/${union.size}`,
        ],
      });
    }
  }

  return correlations;
}

/**
 * Temporal correlation: entities whose active time spans overlap. `nowYear` fills
 * an open-ended span; pass it explicitly for deterministic results.
 */
export function computeTemporalCorrelation(
  entitiesA: DomainEntity[],
  entitiesB: DomainEntity[],
  nowYear: number = new Date().getFullYear(),
): CorrelationEntry[] {
  const correlations: CorrelationEntry[] = [];

  for (const a of entitiesA) {
    if (a.timeStart === null) continue;
    const aEnd = a.timeEnd ?? nowYear;
    for (const b of entitiesB) {
      if (b.timeStart === null) continue;
      if (a.id === b.id && a.domain === b.domain) continue;
      const bEnd = b.timeEnd ?? nowYear;

      const overlapStart = Math.max(a.timeStart, b.timeStart);
      const overlapEnd = Math.min(aEnd, bEnd);
      if (overlapStart > overlapEnd) continue;

      const overlapYears = overlapEnd - overlapStart;
      const maxSpan = Math.max(aEnd - a.timeStart, bEnd - b.timeStart, 1);
      const score = Math.min(overlapYears / maxSpan, 1);
      if (score < 0.1) continue;

      // Boost if they also share languages
      const sharedLangs = a.languageIds.filter((id) => b.languageIds.includes(id));
      const boostedScore = Math.min(score + sharedLangs.length * 0.05, 1);

      const evidence = [
        `Temporal overlap: ${overlapYears} years (${overlapStart} to ${overlapEnd})`,
      ];
      if (sharedLangs.length > 0) {
        evidence.push(`Also share languages: ${sharedLangs.join(", ")}`);
      }

      correlations.push({
        entityA: { id: a.id, name: a.name, domain: a.domain },
        entityB: { id: b.id, name: b.name, domain: b.domain },
        score: Math.round(boostedScore * 100) / 100,
        evidence,
      });
    }
  }

  return correlations;
}

/** Geographic overlap: entities in similar regions / close coordinates. */
export function computeGeographicOverlap(
  entitiesA: DomainEntity[],
  entitiesB: DomainEntity[],
): CorrelationEntry[] {
  const correlations: CorrelationEntry[] = [];

  for (const a of entitiesA) {
    for (const b of entitiesB) {
      if (a.id === b.id && a.domain === b.domain) continue;

      const evidence: string[] = [];
      let score = 0;

      // Coordinate-based proximity
      if (a.coordinates && b.coordinates) {
        const dist = haversineKm(a.coordinates, b.coordinates);
        if (dist < 2000) {
          const proxScore = 1 - dist / 2000;
          score = Math.max(score, proxScore);
          evidence.push(`Geographic distance: ${Math.round(dist)} km`);
        }
      }

      // Region string matching
      if (a.region && b.region) {
        const aReg = a.region.toLowerCase();
        const bReg = b.region.toLowerCase();
        if (aReg === bReg || aReg.includes(bReg) || bReg.includes(aReg)) {
          score = Math.max(score, 0.5);
          evidence.push(`Shared region: ${a.region}`);
        }
      }

      // Boost if they also share languages
      const sharedLangs = a.languageIds.filter((id) => b.languageIds.includes(id));
      if (sharedLangs.length > 0) {
        score = Math.min(score + sharedLangs.length * 0.05, 1);
        evidence.push(`Shared languages: ${sharedLangs.join(", ")}`);
      }

      if (score < 0.1 || evidence.length === 0) continue;

      correlations.push({
        entityA: { id: a.id, name: a.name, domain: a.domain },
        entityB: { id: b.id, name: b.name, domain: b.domain },
        score: Math.round(score * 100) / 100,
        evidence,
      });
    }
  }

  return correlations;
}

/** Great-circle distance between two lat/lng points, in kilometers. */
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

// ============================================================================
// Service
// ============================================================================

export class CrossDomainCorrelation {
  constructor(private storage: TsvStorage) {}

  /**
   * Get the list of pre-built queries
   */
  getPrebuiltQueries(): PrebuiltQuery[] {
    return PREBUILT_QUERIES;
  }

  /**
   * Execute a correlation query between two domains (in-memory TSV path). This is
   * the fallback for the graph-backed path in cross-domain-correlation-graph.ts.
   */
  async queryCorrelation(
    domainA: DomainType,
    domainB: DomainType,
    relationshipType: RelationshipType,
  ): Promise<CorrelationResult> {
    const entitiesA = await this.loadDomain(domainA);
    const entitiesB = await this.loadDomain(domainB);
    const correlations = scoreCorrelations(relationshipType, entitiesA, entitiesB);
    return rankCorrelations(domainA, domainB, relationshipType, correlations);
  }

  // --------------------------------------------------------------------------
  // Domain loaders
  // --------------------------------------------------------------------------

  private async loadDomain(domain: DomainType): Promise<DomainEntity[]> {
    switch (domain) {
      case "language":
        return this.loadLanguages();
      case "cuisine":
        return this.loadCuisines();
      case "music":
        return this.loadMusic();
      case "religion":
        return this.loadReligions();
      case "haplogroup":
        return this.loadHaplogroups();
      case "civilization":
        return this.loadCivilizations();
    }
  }

  private async loadLanguages(): Promise<DomainEntity[]> {
    const languages = await this.storage.getLanguages();
    return languages.map((l) => ({
      id: l.id,
      name: l.name,
      domain: "language" as DomainType,
      languageIds: [l.id],
      region: l.region ?? null,
      coordinates: l.coordinates ?? null,
      timeStart: null,
      timeEnd: null,
    }));
  }

  private async loadCuisines(): Promise<DomainEntity[]> {
    const cuisines = await this.storage.getCuisines({});
    return cuisines.map((c) => ({
      id: c.id,
      name: c.name,
      domain: "cuisine" as DomainType,
      languageIds: c.associatedLanguageIds ?? [],
      region: c.region ?? null,
      coordinates: c.coordinates ?? null,
      timeStart: c.timeOrigin ?? null,
      timeEnd: c.timeEnd ?? null,
    }));
  }

  private async loadMusic(): Promise<DomainEntity[]> {
    const music = await this.storage.getMusicTraditions({});
    return music.map((m) => ({
      id: m.id,
      name: m.name,
      domain: "music" as DomainType,
      languageIds: m.associatedLanguageIds ?? [],
      region: m.region ?? null,
      coordinates: m.coordinates ?? null,
      timeStart: m.timeOrigin ?? null,
      timeEnd: m.timeEnd ?? null,
    }));
  }

  private async loadReligions(): Promise<DomainEntity[]> {
    const religions = await this.storage.getReligions({});
    return religions.map((r) => ({
      id: r.id,
      name: r.name,
      domain: "religion" as DomainType,
      languageIds: r.associatedLanguageIds ?? [],
      region: r.originRegion ?? null,
      coordinates: r.coordinates ?? null,
      timeStart: r.timeOrigin ?? null,
      timeEnd: r.timeEnd ?? null,
    }));
  }

  private async loadHaplogroups(): Promise<DomainEntity[]> {
    const haplogroups = await this.storage.getHaplogroups();
    return haplogroups.map((h) => ({
      id: h.id,
      name: h.name,
      domain: "haplogroup" as DomainType,
      languageIds: h.associatedLanguageFamilyIds ?? [],
      region: h.geographicOrigin ?? null,
      coordinates: null,
      timeStart: h.timeOrigin ?? null,
      timeEnd: null,
    }));
  }

  private async loadCivilizations(): Promise<DomainEntity[]> {
    const civs = await this.storage.getCivilizations();
    return civs.map((c) => ({
      id: c.properties?.civilizationId ?? c.id,
      name: c.properties?.name ?? (c as any).name ?? c.id,
      domain: "civilization" as DomainType,
      languageIds: c.properties?.associatedLanguageIds ?? [],
      region: null,
      coordinates: null,
      timeStart: c.properties?.timePeriod?.start ?? null,
      timeEnd: c.properties?.timePeriod?.end ?? null,
    }));
  }

}
