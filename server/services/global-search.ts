/**
 * Global Search Service
 *
 * Provides unified fuzzy search across all data domains:
 * languages, words, civilizations, cuisines, instruments, battles,
 * archaeological sites, writing systems, sample texts, etc.
 */

import { storage } from "../storage";
import type {
  WritingSystem,
  Battle,
  MigrationRoute,
  Religion,
  MusicTradition,
  MusicalInstrument,
  Cuisine,
  CuisineItem,
  ArtTradition,
  ArchitecturalStyle,
  KinshipSystem,
  TradeGood,
  FoodwayEvent,
} from "../tsv-storage";

export interface SearchResult {
  entityType: string;
  id: string;
  displayName: string;
  description: string;
  linkPath: string;
  relevance: number;
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  totalCount: number;
}

/** Simple fuzzy match: checks if all query tokens appear in the text (case-insensitive) */
function fuzzyMatch(text: string, queryTokens: string[]): number {
  const lower = text.toLowerCase();
  let matched = 0;
  for (const token of queryTokens) {
    if (lower.includes(token)) {
      matched++;
    }
  }
  if (matched === 0) return 0;
  // Score: ratio of matched tokens, boosted by exact substring match
  let score = matched / queryTokens.length;
  const fullQuery = queryTokens.join(" ");
  if (lower.includes(fullQuery)) {
    score += 0.3;
  }
  if (lower === fullQuery) {
    score += 0.5;
  }
  return Math.min(score, 1.0);
}

function bestScore(queryTokens: string[], ...fields: (string | undefined | null)[]): number {
  let best = 0;
  for (const field of fields) {
    if (field) {
      const s = fuzzyMatch(field, queryTokens);
      if (s > best) best = s;
    }
  }
  return best;
}

export async function globalSearch(query: string): Promise<SearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { results: [], query: trimmed, totalCount: 0 };
  }

  const queryTokens = trimmed.toLowerCase().split(/\s+/);
  const allResults: SearchResult[] = [];

  // Search all domains in parallel
  const [
    languages,
    words,
    families,
    writingSystems,
    battles,
    migrationRoutes,
    religions,
    musicTraditions,
    instruments,
    cuisines,
    cuisineItems,
    artTraditions,
    architecturalStyles,
    kinshipSystems,
    tradeGoods,
    foodwayEvents,
    civilizations,
    archaeologicalSites,
  ] = await Promise.all([
    storage.getLanguages(),
    storage.getBaseWords(),
    storage.getLanguageFamilies(),
    storage.getWritingSystems(),
    storage.getBattles(),
    storage.getMigrationRoutes(),
    storage.getReligions(),
    storage.getMusicTraditions(),
    storage.getMusicalInstruments(),
    storage.getCuisines(),
    storage.getCuisineItems(),
    storage.getArtTraditions(),
    storage.getArchitecturalStyles(),
    storage.getKinshipSystems(),
    storage.getTradeGoods(),
    storage.getFoodwayEvents(),
    storage.getCivilizations(),
    storage.getArchaeologicalSites(),
  ]);

  // Languages
  for (const lang of languages) {
    const score = bestScore(queryTokens, lang.name, lang.nativeName, lang.id);
    if (score > 0) {
      allResults.push({
        entityType: "language",
        id: lang.id,
        displayName: lang.name,
        description: lang.nativeName ? `${lang.nativeName} — ${lang.id}` : lang.id,
        linkPath: `/languages/${lang.id}`,
        relevance: score,
      });
    }
  }

  // Words
  for (const word of words) {
    const score = bestScore(queryTokens, word.word, word.definition, word.category);
    if (score > 0) {
      allResults.push({
        entityType: "word",
        id: String(word.id),
        displayName: word.word,
        description: word.definition || word.category || "",
        linkPath: `/words/${word.id}`,
        relevance: score,
      });
    }
  }

  // Language Families
  for (const fam of families) {
    const score = bestScore(queryTokens, fam.name);
    if (score > 0) {
      allResults.push({
        entityType: "language-family",
        id: String(fam.id),
        displayName: fam.name,
        description: "Language family",
        linkPath: `/language-families/${fam.id}`,
        relevance: score,
      });
    }
  }

  // Writing Systems
  for (const ws of writingSystems) {
    const score = bestScore(queryTokens, ws.name, ws.type, ws.originRegion);
    if (score > 0) {
      allResults.push({
        entityType: "writing-system",
        id: ws.id,
        displayName: ws.name,
        description: `${ws.type} — ${ws.direction} — ${ws.originRegion}`,
        linkPath: `/writing-systems/${ws.id}`,
        relevance: score,
      });
    }
  }

  // Battles
  for (const b of battles) {
    const score = bestScore(queryTokens, b.name, b.warName, b.significance);
    if (score > 0) {
      allResults.push({
        entityType: "battle",
        id: b.id,
        displayName: b.name,
        description: `${b.warName} — ${b.date}`,
        linkPath: `/battles/${b.id}`,
        relevance: score,
      });
    }
  }

  // Migration Routes
  for (const r of migrationRoutes) {
    const score = bestScore(queryTokens, r.name, r.description, r.peoples?.join(" "));
    if (score > 0) {
      allResults.push({
        entityType: "migration-route",
        id: r.id,
        displayName: r.name,
        description: r.description?.slice(0, 120) || r.routeType,
        linkPath: `/migration-routes/${r.id}`,
        relevance: score,
      });
    }
  }

  // Religions
  for (const rel of religions) {
    const score = bestScore(queryTokens, rel.name, rel.originRegion, rel.religionType, rel.description);
    if (score > 0) {
      allResults.push({
        entityType: "religion",
        id: rel.id,
        displayName: rel.name,
        description: `${rel.religionType} — ${rel.originRegion}`,
        linkPath: `/religions/${rel.id}`,
        relevance: score,
      });
    }
  }

  // Music Traditions
  for (const mt of musicTraditions) {
    const score = bestScore(queryTokens, mt.name, mt.region, mt.description);
    if (score > 0) {
      allResults.push({
        entityType: "music-tradition",
        id: mt.id,
        displayName: mt.name,
        description: mt.description?.slice(0, 120) || mt.region,
        linkPath: `/music-traditions/${mt.id}`,
        relevance: score,
      });
    }
  }

  // Musical Instruments
  for (const inst of instruments) {
    const score = bestScore(queryTokens, inst.name, inst.instrumentFamily, inst.originRegion);
    if (score > 0) {
      allResults.push({
        entityType: "musical-instrument",
        id: inst.id,
        displayName: inst.name,
        description: `${inst.instrumentFamily} — ${inst.originRegion}`,
        linkPath: `/musical-instruments/${inst.id}`,
        relevance: score,
      });
    }
  }

  // Cuisines
  for (const c of cuisines) {
    const score = bestScore(queryTokens, c.name, c.region, c.description);
    if (score > 0) {
      allResults.push({
        entityType: "cuisine",
        id: c.id,
        displayName: c.name,
        description: c.description?.slice(0, 120) || c.region,
        linkPath: `/cuisines/${c.id}`,
        relevance: score,
      });
    }
  }

  // Cuisine Items
  for (const ci of cuisineItems) {
    const score = bestScore(queryTokens, ci.name, ci.foodType);
    if (score > 0) {
      allResults.push({
        entityType: "cuisine-item",
        id: ci.id,
        displayName: ci.name,
        description: ci.foodType,
        linkPath: `/cuisine-items/${ci.id}`,
        relevance: score,
      });
    }
  }

  // Art Traditions
  for (const at of artTraditions) {
    const score = bestScore(queryTokens, at.name, at.category, at.description);
    if (score > 0) {
      allResults.push({
        entityType: "art-tradition",
        id: at.id,
        displayName: at.name,
        description: at.description?.slice(0, 120) || at.category,
        linkPath: `/art-traditions/${at.id}`,
        relevance: score,
      });
    }
  }

  // Architectural Styles
  for (const as_ of architecturalStyles) {
    const score = bestScore(queryTokens, as_.name, as_.stylePeriod, as_.region, as_.description);
    if (score > 0) {
      allResults.push({
        entityType: "architectural-style",
        id: as_.id,
        displayName: as_.name,
        description: as_.description?.slice(0, 120) || as_.stylePeriod,
        linkPath: `/architectural-styles/${as_.id}`,
        relevance: score,
      });
    }
  }

  // Kinship Systems
  for (const ks of kinshipSystems) {
    const score = bestScore(queryTokens, ks.id, ks.systemType, ks.descentRule, ks.residenceRule);
    if (score > 0) {
      allResults.push({
        entityType: "kinship-system",
        id: ks.id,
        displayName: `${ks.systemType} (${ks.id})`,
        description: `${ks.descentRule} — ${ks.residenceRule}`,
        linkPath: `/kinship-systems/${ks.id}`,
        relevance: score,
      });
    }
  }

  // Trade Goods
  for (const tg of tradeGoods) {
    const score = bestScore(queryTokens, tg.name, tg.category, tg.economicSignificance);
    if (score > 0) {
      allResults.push({
        entityType: "trade-good",
        id: tg.id,
        displayName: tg.name,
        description: `${tg.category} — ${tg.originRegion}`,
        linkPath: `/trade-goods/${tg.id}`,
        relevance: score,
      });
    }
  }

  // Foodway Events
  for (const fe of foodwayEvents) {
    const score = bestScore(queryTokens, fe.name, fe.foodItem, fe.mechanism);
    if (score > 0) {
      allResults.push({
        entityType: "foodway-event",
        id: fe.id,
        displayName: fe.name,
        description: `${fe.foodItem} — ${fe.mechanism}`,
        linkPath: `/foodway-events/${fe.id}`,
        relevance: score,
      });
    }
  }

  // Civilizations
  for (const civ of civilizations) {
    const props = civ.properties;
    const name = props?.name as string | undefined;
    const civId = props?.civilizationId as string | undefined;
    const capital = props?.capital as string | undefined;
    const politicalStructure = props?.politicalStructure as string | undefined;
    const score = bestScore(queryTokens, name, capital, politicalStructure);
    if (score > 0) {
      allResults.push({
        entityType: "civilization",
        id: civId || String(civ.id),
        displayName: name || `Civilization ${civ.id}`,
        description: [politicalStructure, capital ? `Capital: ${capital}` : ""].filter(Boolean).join(" — "),
        linkPath: `/civilizations/${civId || civ.id}`,
        relevance: score,
      });
    }
  }

  // Archaeological Sites
  for (const site of archaeologicalSites) {
    const props = site.properties;
    const name = props?.name as string | undefined;
    const siteId = props?.siteId as string | undefined;
    const siteType = props?.siteType as string | undefined;
    const findings = props?.findings as string[] | undefined;
    const score = bestScore(queryTokens, name, siteType, findings?.join(" "));
    if (score > 0) {
      allResults.push({
        entityType: "archaeological-site",
        id: siteId || String(site.id),
        displayName: name || `Site ${site.id}`,
        description: siteType || "",
        linkPath: `/archaeological-sites/${siteId || site.id}`,
        relevance: score,
      });
    }
  }

  // Sort by relevance descending, limit to 50
  allResults.sort((a, b) => b.relevance - a.relevance);
  const top = allResults.slice(0, 50);

  return {
    results: top,
    query: trimmed,
    totalCount: allResults.length,
  };
}
