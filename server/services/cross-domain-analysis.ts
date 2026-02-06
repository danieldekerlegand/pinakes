/**
 * Cross-Domain Analysis Service
 * 
 * Discovers relationships between entities across all cultural domains:
 * cuisines, music traditions, religions, haplogroups, civilizations,
 * archaeological sites, and languages.
 */

import { TsvStorage } from "../tsv-storage";
import type {
  Cuisine,
  CuisineItem,
  MusicTradition,
  MusicalInstrument,
  Religion,
  Haplogroup,
} from "../tsv-storage";

// ============================================================================
// Unified Entity Types
// ============================================================================

export type EntityType =
  | "cuisine"
  | "cuisine-item"
  | "music-tradition"
  | "musical-instrument"
  | "religion"
  | "haplogroup"
  | "civilization"
  | "archaeological-site"
  | "language-range";

export interface UnifiedEntity {
  id: string;
  name: string;
  nativeName?: string;
  entityType: EntityType;
  region?: string;
  coordinates?: { lat: number; lng: number };
  timeOrigin: number | null;
  timeEnd: number | null;
  associatedLanguageIds: string[];
  description?: string;
}

export interface EntityRelationship {
  source: UnifiedEntity;
  target: UnifiedEntity;
  relationshipType: RelationshipType;
  strength: number; // 0-1
  sharedAttributes: string[];
}

export type RelationshipType =
  | "shared-language"
  | "shared-region"
  | "temporal-overlap"
  | "direct-reference"
  | "cultural-proximity";

export interface CrossDomainQuery {
  entityId?: string;
  entityType?: EntityType;
  languageId?: string;
  region?: string;
  year?: number;
  searchText?: string;
  limit?: number;
}

export interface CrossDomainResult {
  entities: UnifiedEntity[];
  relationships: EntityRelationship[];
  query: CrossDomainQuery;
  totalCount: number;
}

// ============================================================================
// Cross-Domain Analysis Service
// ============================================================================

export class CrossDomainAnalysis {
  constructor(private storage: TsvStorage) {}

  /**
   * Convert any domain entity to a UnifiedEntity
   */
  private toUnified(entity: any, type: EntityType): UnifiedEntity {
    switch (type) {
      case "cuisine":
        return {
          id: entity.id,
          name: entity.name,
          nativeName: entity.nativeName,
          entityType: "cuisine",
          region: entity.region,
          coordinates: entity.coordinates,
          timeOrigin: entity.timeOrigin,
          timeEnd: entity.timeEnd,
          associatedLanguageIds: entity.associatedLanguageIds ?? [],
          description: entity.description,
        };
      case "music-tradition":
        return {
          id: entity.id,
          name: entity.name,
          nativeName: entity.nativeName,
          entityType: "music-tradition",
          region: entity.region,
          coordinates: entity.coordinates,
          timeOrigin: entity.timeOrigin,
          timeEnd: entity.timeEnd,
          associatedLanguageIds: entity.associatedLanguageIds ?? [],
          description: entity.description,
        };
      case "religion":
        return {
          id: entity.id,
          name: entity.name,
          nativeName: entity.nativeName,
          entityType: "religion",
          region: entity.originRegion,
          coordinates: entity.coordinates,
          timeOrigin: entity.timeOrigin,
          timeEnd: entity.timeEnd,
          associatedLanguageIds: entity.associatedLanguageIds ?? [],
          description: entity.description,
        };
      case "haplogroup":
        return {
          id: entity.id,
          name: entity.name,
          entityType: "haplogroup",
          region: entity.geographicOrigin,
          timeOrigin: entity.timeOrigin,
          timeEnd: null,
          associatedLanguageIds: entity.associatedLanguageFamilyIds ?? [],
          description: entity.description,
        };
      case "civilization":
        return {
          id: entity.id ?? entity.properties?.civilizationId,
          name: entity.properties?.name ?? entity.name,
          nativeName: entity.properties?.nativeName,
          entityType: "civilization",
          timeOrigin: entity.properties?.timePeriod?.start ?? null,
          timeEnd: entity.properties?.timePeriod?.end ?? null,
          associatedLanguageIds: entity.properties?.associatedLanguageIds ?? [],
          description: undefined,
        };
      case "archaeological-site":
        return {
          id: entity.id ?? entity.properties?.siteId,
          name: entity.properties?.name ?? entity.name,
          entityType: "archaeological-site",
          timeOrigin: entity.properties?.timePeriod?.start ?? null,
          timeEnd: entity.properties?.timePeriod?.end ?? null,
          associatedLanguageIds: entity.properties?.associatedLanguageIds ?? [],
          description: undefined,
        };
      default:
        return {
          id: entity.id,
          name: entity.name ?? entity.id,
          entityType: type,
          timeOrigin: null,
          timeEnd: null,
          associatedLanguageIds: [],
        };
    }
  }

  /**
   * Load all entities across all domains as UnifiedEntities
   */
  async getAllEntities(filters?: {
    year?: number;
    region?: string;
    types?: EntityType[];
  }): Promise<UnifiedEntity[]> {
    const entities: UnifiedEntity[] = [];
    const types = filters?.types;

    if (!types || types.includes("cuisine")) {
      const cuisines = await this.storage.getCuisines({
        year: filters?.year,
        region: filters?.region,
      });
      entities.push(...cuisines.map((c) => this.toUnified(c, "cuisine")));
    }

    if (!types || types.includes("music-tradition")) {
      const music = await this.storage.getMusicTraditions({
        year: filters?.year,
        region: filters?.region,
      });
      entities.push(...music.map((m) => this.toUnified(m, "music-tradition")));
    }

    if (!types || types.includes("religion")) {
      const religions = await this.storage.getReligions({
        year: filters?.year,
        region: filters?.region,
      });
      entities.push(...religions.map((r) => this.toUnified(r, "religion")));
    }

    if (!types || types.includes("haplogroup")) {
      const haplogroups = await this.storage.getHaplogroups();
      entities.push(
        ...haplogroups.map((h) => this.toUnified(h, "haplogroup"))
      );
    }

    if (!types || types.includes("civilization")) {
      const civs = await this.storage.getCivilizations();
      entities.push(
        ...civs.map((c) => this.toUnified(c, "civilization"))
      );
    }

    if (!types || types.includes("archaeological-site")) {
      const sites = await this.storage.getArchaeologicalSites();
      entities.push(
        ...sites.map((s) => this.toUnified(s, "archaeological-site"))
      );
    }

    return entities;
  }

  /**
   * Find entities connected to a given entity through shared attributes
   */
  async findConnections(
    entityId: string,
    entityType: EntityType,
    maxResults: number = 20,
  ): Promise<EntityRelationship[]> {
    // Get the source entity
    const allEntities = await this.getAllEntities();
    const source = allEntities.find(
      (e) => e.id === entityId && e.entityType === entityType
    );
    if (!source) return [];

    const relationships: EntityRelationship[] = [];

    for (const target of allEntities) {
      if (target.id === source.id && target.entityType === source.entityType) continue;

      const rel = this.computeRelationship(source, target);
      if (rel) {
        relationships.push(rel);
      }
    }

    // Sort by strength descending
    relationships.sort((a, b) => b.strength - a.strength);
    return relationships.slice(0, maxResults);
  }

  /**
   * Compute relationship between two entities
   */
  private computeRelationship(
    source: UnifiedEntity,
    target: UnifiedEntity,
  ): EntityRelationship | null {
    const sharedAttributes: string[] = [];
    let strength = 0;

    // Check shared languages
    const sharedLangs = source.associatedLanguageIds.filter((id) =>
      target.associatedLanguageIds.includes(id)
    );
    if (sharedLangs.length > 0) {
      sharedAttributes.push(`shared languages: ${sharedLangs.join(", ")}`);
      strength += Math.min(sharedLangs.length * 0.2, 0.6);
    }

    // Check regional overlap
    if (source.region && target.region) {
      const srcRegion = source.region.toLowerCase();
      const tgtRegion = target.region.toLowerCase();
      if (
        srcRegion === tgtRegion ||
        srcRegion.includes(tgtRegion) ||
        tgtRegion.includes(srcRegion)
      ) {
        sharedAttributes.push(`shared region: ${source.region}`);
        strength += 0.2;
      }
    }

    // Check temporal overlap
    if (source.timeOrigin !== null && target.timeOrigin !== null) {
      const sStart = source.timeOrigin;
      const sEnd = source.timeEnd ?? new Date().getFullYear();
      const tStart = target.timeOrigin;
      const tEnd = target.timeEnd ?? new Date().getFullYear();

      const overlapStart = Math.max(sStart, tStart);
      const overlapEnd = Math.min(sEnd, tEnd);
      if (overlapStart <= overlapEnd) {
        const overlapYears = overlapEnd - overlapStart;
        const maxSpan = Math.max(sEnd - sStart, tEnd - tStart, 1);
        const overlapRatio = Math.min(overlapYears / maxSpan, 1);
        if (overlapRatio > 0.1) {
          sharedAttributes.push(
            `temporal overlap: ${overlapYears} years`
          );
          strength += overlapRatio * 0.2;
        }
      }
    }

    // No meaningful relationship found
    if (strength < 0.1) return null;

    // Determine primary relationship type
    let relationshipType: RelationshipType = "cultural-proximity";
    if (sharedAttributes.some((a) => a.startsWith("shared languages"))) {
      relationshipType = "shared-language";
    } else if (sharedAttributes.some((a) => a.startsWith("shared region"))) {
      relationshipType = "shared-region";
    } else if (sharedAttributes.some((a) => a.startsWith("temporal"))) {
      relationshipType = "temporal-overlap";
    }

    return {
      source,
      target,
      relationshipType,
      strength: Math.min(strength, 1),
      sharedAttributes,
    };
  }

  /**
   * Search across all domains by text query
   */
  async search(
    query: string,
    filters?: { year?: number; types?: EntityType[]; limit?: number },
  ): Promise<UnifiedEntity[]> {
    const allEntities = await this.getAllEntities({
      year: filters?.year,
      types: filters?.types,
    });

    const q = query.toLowerCase();
    const scored = allEntities
      .map((e) => {
        let score = 0;
        if (e.name.toLowerCase().includes(q)) score += 3;
        if (e.nativeName?.toLowerCase().includes(q)) score += 2;
        if (e.description?.toLowerCase().includes(q)) score += 1;
        if (e.region?.toLowerCase().includes(q)) score += 1;
        if (e.associatedLanguageIds.some((id) => id.includes(q))) score += 1;
        if (e.id.includes(q)) score += 1;
        return { entity: e, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, filters?.limit ?? 50).map((s) => s.entity);
  }

  /**
   * Find all entities associated with a specific language
   */
  async findByLanguage(languageId: string): Promise<UnifiedEntity[]> {
    const allEntities = await this.getAllEntities();
    return allEntities.filter((e) =>
      e.associatedLanguageIds.includes(languageId)
    );
  }

  /**
   * Get entities co-located in a time period
   */
  async findByTimePeriod(
    year: number,
    types?: EntityType[],
  ): Promise<UnifiedEntity[]> {
    return this.getAllEntities({ year, types });
  }

  /**
   * Get summary statistics across all domains
   */
  async getSummary(): Promise<{
    totalEntities: number;
    byType: Record<string, number>;
    languageCoverage: number;
    temporalRange: { min: number; max: number };
  }> {
    const all = await this.getAllEntities();

    const byType: Record<string, number> = {};
    let minTime = Infinity;
    let maxTime = -Infinity;
    const langSet = new Set<string>();

    for (const e of all) {
      byType[e.entityType] = (byType[e.entityType] ?? 0) + 1;
      if (e.timeOrigin !== null) {
        minTime = Math.min(minTime, e.timeOrigin);
        maxTime = Math.max(maxTime, e.timeOrigin);
      }
      for (const lang of e.associatedLanguageIds) {
        langSet.add(lang);
      }
    }

    return {
      totalEntities: all.length,
      byType,
      languageCoverage: langSet.size,
      temporalRange: {
        min: minTime === Infinity ? 0 : minTime,
        max: maxTime === -Infinity ? 0 : maxTime,
      },
    };
  }
}
