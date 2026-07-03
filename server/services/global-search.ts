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
import * as culturescrape from "./culturescrape-client";
import type { SearchHit } from "./culturescrape-client";
import { getGraphResolver } from "./graph-resolver";
import type { GraphResolver } from "./graph-resolver";

/** Where a search result originated: the local TSV corpus or the shared graph. */
export type SearchSource = "local" | "graph";

/** Provenance/confidence attached to a shared-graph search hit. */
export interface GraphProvenance {
  /** Human label for the origin, e.g. `"culture-scrape graph"`. */
  source: string;
  /** Wikidata QID when the node carries one. */
  qid?: string;
  /** Which field matched in the sidecar (`csid` / `wikidata_qid` / `name`). */
  matchField?: string;
  /** Relative link to the node's graph view, when the sidecar could resolve one. */
  graphLink?: string | null;
}

export interface SearchResult {
  entityType: string;
  id: string;
  displayName: string;
  description: string;
  linkPath: string;
  relevance: number;
  /** Origin of the result; local corpus unless it came from the shared graph. */
  source: SearchSource;
  /** Shared-graph id — set on graph hits, and on local hits that resolve to a csid. */
  csid?: string;
  /** 0–1 confidence for a graph hit (1.0 for an exact csid/QID field match). */
  confidence?: number;
  /** Provenance for graph hits so the UI can attribute the fact. */
  provenance?: GraphProvenance;
}

/** One facet bucket: a distinct value and how many results carry it. */
export interface FacetCount {
  /** the facet value — an entityType id, or a source (`"local"`/`"graph"`). */
  value: string;
  /** number of results in the **unfiltered** match set with this value. */
  count: number;
}

/** Facet breakdowns computed over a search result set. */
export interface SearchFacets {
  /** counts per `entityType`, descending by count then value. */
  entityType: FacetCount[];
  /** counts per `source` (`"local"`/`"graph"`), descending by count then value. */
  source: FacetCount[];
}

/**
 * Facet filters that narrow a search result set. An empty/absent dimension does
 * not narrow; within a dimension values are OR-ed; dimensions are AND-ed.
 */
export interface SearchFilters {
  /** keep only results whose `entityType` is one of these. */
  entityTypes?: string[];
  /** keep only results whose `source` is one of these. */
  sources?: SearchSource[];
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  totalCount: number;
  /**
   * Facet counts over the **full, unfiltered** match set so the UI can show all
   * available filters (with counts) even while a filter is active. Absent for a
   * blank query.
   */
  facets?: SearchFacets;
  /** The facet filters applied to produce `results` (echoed back to the client). */
  filters?: SearchFilters;
}

/** A local hit before it is stamped with its `source`/graph metadata. */
type LocalHit = Omit<SearchResult, "source" | "csid" | "confidence" | "provenance">;

// ── Faceting (pure) ───────────────────────────────────────────────────────────

/** Sort facet buckets by count descending, then value ascending (stable/deterministic). */
function facetSort(a: FacetCount, b: FacetCount): number {
  if (b.count !== a.count) return b.count - a.count;
  return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
}

/** Count one dimension of a result set into descending-sorted facet buckets. */
function countBy<T>(items: T[], key: (t: T) => string | undefined): FacetCount[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    if (!value) continue; // skip undefined / empty-string values
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts, ([value, count]) => ({ value, count })).sort(facetSort);
}

/** An empty facet set (blank query / no results). */
export function emptyFacets(): SearchFacets {
  return { entityType: [], source: [] };
}

/** Compute `entityType` + `source` facet counts over a result set. Pure. */
export function computeFacets(
  results: Pick<SearchResult, "entityType" | "source">[],
): SearchFacets {
  return {
    entityType: countBy(results, (r) => r.entityType),
    source: countBy(results, (r) => r.source),
  };
}

/** Merge two facet sets by summing counts per value. Pure. */
export function combineFacets(a: SearchFacets, b: SearchFacets): SearchFacets {
  const mergeDim = (x: FacetCount[], y: FacetCount[]): FacetCount[] => {
    const counts = new Map<string, number>();
    for (const { value, count } of [...x, ...y]) {
      counts.set(value, (counts.get(value) ?? 0) + count);
    }
    return Array.from(counts, ([value, count]) => ({ value, count })).sort(facetSort);
  };
  return {
    entityType: mergeDim(a.entityType, b.entityType),
    source: mergeDim(a.source, b.source),
  };
}

/** Does a result pass the facet filters? Empty dimensions match everything. Pure. */
export function matchesFilters(
  result: Pick<SearchResult, "entityType" | "source">,
  filters: SearchFilters,
): boolean {
  if (filters.entityTypes?.length && !filters.entityTypes.includes(result.entityType)) {
    return false;
  }
  if (filters.sources?.length && !filters.sources.includes(result.source)) {
    return false;
  }
  return true;
}

/** Keep only results passing the facet filters (no-op when no filter is set). Pure. */
export function applyFacetFilters<
  T extends Pick<SearchResult, "entityType" | "source">,
>(results: T[], filters: SearchFilters): T[] {
  if (!filters.entityTypes?.length && !filters.sources?.length) return results;
  return results.filter((r) => matchesFilters(r, filters));
}

/**
 * Parse `types`/`sources` (comma-separated) request query params into
 * {@link SearchFilters}. Unknown source values are dropped; blanks are ignored.
 * Pure — safe to unit-test against a plain object. Route usage:
 * `federatedSearch(q, parseSearchFilters(req.query))`.
 */
export function parseSearchFilters(params: {
  types?: unknown;
  sources?: unknown;
}): SearchFilters {
  const splitCsv = (v: unknown): string[] =>
    typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const filters: SearchFilters = {};
  const entityTypes = splitCsv(params.types);
  if (entityTypes.length) filters.entityTypes = entityTypes;
  const sources = splitCsv(params.sources).filter(
    (s): s is SearchSource => s === "local" || s === "graph",
  );
  if (sources.length) filters.sources = sources;
  return filters;
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

export async function globalSearch(
  query: string,
  filters: SearchFilters = {},
): Promise<SearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { results: [], query: trimmed, totalCount: 0, facets: emptyFacets(), filters };
  }

  const queryTokens = trimmed.toLowerCase().split(/\s+/);
  const allResults: LocalHit[] = [];

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

  // Sort by relevance descending, stamp source, compute facets over the FULL
  // match set (before filtering/slicing), then apply facet filters and cap to 50.
  allResults.sort((a, b) => b.relevance - a.relevance);
  const stamped = allResults.map((r): SearchResult => ({ ...r, source: "local" }));
  const facets = computeFacets(stamped);
  const filtered = applyFacetFilters(stamped, filters);

  return {
    results: filtered.slice(0, 50),
    query: trimmed,
    totalCount: filtered.length,
    facets,
    filters,
  };
}

// ── Federated search (local corpus + shared graph) ───────────────────────────

/** How many graph hits to request from the sidecar per federated query. */
const GRAPH_SEARCH_LIMIT = 25;

/** Map a sidecar `:LABEL` to the app's hyphenated entityType convention. */
function labelToEntityType(label: string): string {
  return label.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

/**
 * Merge shared-graph hits into an already-computed local result set.
 *
 * **Ranking strategy.** Local hits keep their fuzzy token score (`[0, 1]`). A
 * graph hit that matched an authoritative field (`csid` / `wikidata_qid`) ranks
 * `1.0`; a name match ranks by the same fuzzy scorer against the query (never
 * below a small floor so a real hit is not dropped). The two sets are merged and
 * sorted by relevance descending, capped at 50.
 *
 * **Dedup.** An entity present in both stores is matched by **csid alias**: each
 * local result is resolved to its csid via the US-006 resolver, and any graph
 * hit sharing that csid is dropped (the local result wins — it carries an
 * in-app navigable link). Duplicate csids within the sidecar payload are also
 * collapsed. Pure and deterministic.
 */
export function mergeGraphResults(
  localResults: SearchResult[],
  graphHits: SearchHit[],
  resolver: Pick<GraphResolver, "resolve">,
  query: string,
  filters: SearchFilters = {},
): { results: SearchResult[]; graphCount: number; facets: SearchFacets } {
  // Resolve each local result to its csid so we can dedup graph hits against it.
  const localCsids = new Set<string>();
  const stampedLocal = localResults.map((r): SearchResult => {
    const resolved = resolver.resolve({
      type: r.entityType,
      id: r.id,
      name: r.displayName,
    });
    if (resolved) {
      localCsids.add(resolved.csid);
      return { ...r, csid: resolved.csid };
    }
    return r;
  });

  const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const seenGraphCsids = new Set<string>();
  const graphResults: SearchResult[] = [];
  for (const hit of graphHits) {
    if (localCsids.has(hit.csid)) continue; // present in both → deduped, local wins
    if (seenGraphCsids.has(hit.csid)) continue; // sidecar-side duplicate guard
    seenGraphCsids.add(hit.csid);

    const exact = hit.field === "csid" || hit.field === "wikidata_qid";
    const relevance = exact ? 1 : Math.max(fuzzyMatch(hit.name, queryTokens), 0.4);
    graphResults.push({
      entityType: labelToEntityType(hit.label),
      id: hit.csid,
      displayName: hit.name,
      description: hit.label,
      linkPath: hit.graph ?? "",
      relevance,
      source: "graph",
      csid: hit.csid,
      confidence: exact ? 1 : relevance,
      provenance: {
        source: "culture-scrape graph",
        qid: hit.qid || undefined,
        matchField: hit.field || undefined,
        graphLink: hit.graph,
      },
    });
  }

  // Facets cover the full (deduped, unfiltered) graph contribution so the UI can
  // still offer graph-only facets while a filter is active; the merged results
  // themselves are filtered.
  const facets = computeFacets(graphResults);
  const filteredGraph = applyFacetFilters(graphResults, filters);
  const merged = [...stampedLocal, ...filteredGraph].sort(
    (a, b) => b.relevance - a.relevance,
  );
  return { results: merged.slice(0, 50), graphCount: filteredGraph.length, facets };
}

/** Injectable dependencies for {@link federatedSearch} (defaults wire the real services). */
export interface FederatedSearchDeps {
  /** Local corpus search (defaults to {@link globalSearch}). */
  localSearch: (query: string, filters?: SearchFilters) => Promise<SearchResponse>;
  /** Shared-graph search (defaults to the culture-scrape sidecar client). */
  graphSearch: (query: string, limit?: number) => Promise<culturescrape.SearchResponse>;
  /** Entity → csid resolver for dedup (defaults to the lexicon-backed singleton). */
  resolver: Pick<GraphResolver, "resolve">;
}

/**
 * Federated global search: local corpus results merged with shared-graph hits.
 *
 * Degrades to **local-only** whenever the graph is unavailable, disabled, or
 * returns a malformed payload — the sidecar failure is swallowed and never
 * surfaced to the user (the local results still come back). See
 * {@link mergeGraphResults} for the ranking/dedup contract.
 */
export async function federatedSearch(
  query: string,
  filters: SearchFilters = {},
  deps: Partial<FederatedSearchDeps> = {},
): Promise<SearchResponse> {
  const localSearch = deps.localSearch ?? globalSearch;
  const graphSearch = deps.graphSearch ?? culturescrape.search;

  const trimmed = query.trim();
  const local = await localSearch(trimmed, filters);
  if (!trimmed) return local;

  let graphHits: SearchHit[];
  try {
    const resp = await graphSearch(trimmed, GRAPH_SEARCH_LIMIT);
    graphHits = resp.results;
  } catch {
    // Graph unavailable / disabled / malformed: silently degrade to local-only
    // (local already carries local-corpus facets + the applied filters).
    return local;
  }

  const resolver = deps.resolver ?? getGraphResolver();
  const { results, graphCount, facets: graphFacets } = mergeGraphResults(
    local.results,
    graphHits,
    resolver,
    trimmed,
    filters,
  );
  return {
    results,
    query: trimmed,
    totalCount: local.totalCount + graphCount,
    facets: combineFacets(local.facets ?? emptyFacets(), graphFacets),
    filters,
  };
}
