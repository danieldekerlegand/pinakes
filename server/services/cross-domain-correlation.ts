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
// Domain Entity (internal)
// ============================================================================

interface DomainEntity {
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
   * Execute a correlation query between two domains
   */
  async queryCorrelation(
    domainA: DomainType,
    domainB: DomainType,
    relationshipType: RelationshipType,
  ): Promise<CorrelationResult> {
    const entitiesA = await this.loadDomain(domainA);
    const entitiesB = await this.loadDomain(domainB);

    let correlations: CorrelationEntry[];

    switch (relationshipType) {
      case "co-occurrence":
        correlations = this.computeCoOccurrence(entitiesA, entitiesB);
        break;
      case "temporal-correlation":
        correlations = this.computeTemporalCorrelation(entitiesA, entitiesB);
        break;
      case "geographic-overlap":
        correlations = this.computeGeographicOverlap(entitiesA, entitiesB);
        break;
    }

    // Sort by score descending, take top 50
    correlations.sort((a, b) => b.score - a.score);
    correlations = correlations.slice(0, 50);

    const avgScore =
      correlations.length > 0
        ? correlations.reduce((sum, c) => sum + c.score, 0) / correlations.length
        : 0;

    const summary = `Found ${correlations.length} ${relationshipType} correlations between ${domainA} and ${domainB} domains (avg score: ${avgScore.toFixed(2)}).`;

    return { domainA, domainB, correlations, summary };
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

  // --------------------------------------------------------------------------
  // Correlation algorithms
  // --------------------------------------------------------------------------

  /**
   * Co-occurrence: entities share associated languages
   */
  private computeCoOccurrence(
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
   * Temporal correlation: entities overlap in time
   */
  private computeTemporalCorrelation(
    entitiesA: DomainEntity[],
    entitiesB: DomainEntity[],
  ): CorrelationEntry[] {
    const correlations: CorrelationEntry[] = [];
    const now = new Date().getFullYear();

    for (const a of entitiesA) {
      if (a.timeStart === null) continue;
      const aEnd = a.timeEnd ?? now;
      for (const b of entitiesB) {
        if (b.timeStart === null) continue;
        if (a.id === b.id && a.domain === b.domain) continue;
        const bEnd = b.timeEnd ?? now;

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

  /**
   * Geographic overlap: entities in similar regions
   */
  private computeGeographicOverlap(
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
          const dist = this.haversineKm(a.coordinates, b.coordinates);
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

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private haversineKm(
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
}
