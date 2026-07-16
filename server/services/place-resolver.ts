/**
 * Place Resolver Service
 *
 * Maps both historical and modern place names to geographic coordinates.
 * Sources:
 *   1. Local TSV data: settlements, archaeological sites, battles
 *   2. Known regions: well-known historical regions with coordinates/bounding boxes
 *   3. GeoNames: standardized place names + stable geonames_id (preferred external)
 *   4. Nominatim (OpenStreetMap): modern place name geocoding (fallback)
 *
 * For external geocoding the resolver **prefers GeoNames** (standardized naming and
 * a stable `geonamesId`) and **falls back to Nominatim** when GeoNames is
 * unavailable / unconfigured / returns nothing. Every externally-resolved result
 * carries {@link PlaceProvenance}. Network access is behind the injectable
 * {@link PlaceResolverDeps} so tests drive it with recorded fixtures (no live fetch).
 *
 * Supports fuzzy matching, autocomplete, and multiple geometry types
 * (point, bounding box).
 */

import { storage } from "../storage";

// ── Types ──────────────────────────────────────────────────────

export type PlaceGeometryType = "point" | "bbox";

/** Where an externally-resolved place came from (GeoNames / Nominatim / OSM). */
export interface PlaceProvenance {
  /** Authority the record was resolved from. */
  source: "geonames" | "nominatim";
  /** Stable id within that authority (geonameId or Nominatim place_id), as a string. */
  sourceId: string;
  /** Canonical URL for the record when derivable. */
  sourceUrl?: string;
}

export interface PlaceResult {
  id: string;
  name: string;
  /** Category of the place source */
  category:
    | "settlement"
    | "archaeological-site"
    | "battle"
    | "region"
    | "modern"
    | "geonames";
  /** Geometry type */
  geometryType: PlaceGeometryType;
  /** Center point coordinates */
  lat: number;
  lng: number;
  /** Bounding box [south, west, north, east] for regions */
  bbox?: [number, number, number, number];
  /** Brief description for info card */
  description: string;
  /** Time period if applicable */
  timePeriod?: string;
  /** Relevance score 0-1 */
  relevance: number;
  /** Provenance for externally-resolved (GeoNames/Nominatim) results. */
  provenance?: PlaceProvenance;
}

export interface PlaceSearchResponse {
  results: PlaceResult[];
  query: string;
}

/**
 * A standardized, canonical place record returned by the resolve API — carries
 * `geonamesId` when resolved via GeoNames (null on the Nominatim fallback).
 */
export interface CanonicalPlaceRecord {
  name: string;
  lat: number;
  lng: number;
  /** GeoNames id when resolved via GeoNames; `null` on the Nominatim fallback. */
  geonamesId: number | null;
  /** Country name when the authority provides it. */
  countryName?: string;
  /** Feature type / class label when available (e.g. `capital of a country`). */
  featureType?: string;
  /** Bounding box [south, west, north, east] when the authority provides one. */
  bbox?: [number, number, number, number];
  provenance: PlaceProvenance;
}

export interface CanonicalPlaceResponse {
  results: CanonicalPlaceRecord[];
  query: string;
  /** Which authority produced the results (`null` when none resolved). */
  source: "geonames" | "nominatim" | null;
}

// ── Known Regions with bounding boxes ──────────────────────────

interface KnownRegion {
  name: string;
  aliases: string[];
  lat: number;
  lng: number;
  bbox: [number, number, number, number]; // [south, west, north, east]
  description: string;
}

const KNOWN_REGIONS: KnownRegion[] = [
  { name: "Mesopotamia", aliases: ["land between rivers"], lat: 33.3, lng: 44.4, bbox: [29.0, 38.0, 37.0, 49.0], description: "Ancient region between the Tigris and Euphrates rivers" },
  { name: "Fertile Crescent", aliases: [], lat: 33.0, lng: 42.0, bbox: [28.0, 32.0, 38.0, 50.0], description: "Arc of fertile land from Egypt to Mesopotamia" },
  { name: "Levant", aliases: ["eastern mediterranean"], lat: 33.0, lng: 36.0, bbox: [29.0, 34.0, 37.5, 42.0], description: "Eastern Mediterranean coastal region" },
  { name: "Anatolia", aliases: ["asia minor"], lat: 39.0, lng: 35.0, bbox: [36.0, 26.0, 42.0, 45.0], description: "Peninsula of modern Turkey" },
  { name: "Egypt", aliases: ["kemet"], lat: 26.8, lng: 30.8, bbox: [22.0, 25.0, 31.5, 35.0], description: "Ancient civilization along the Nile" },
  { name: "Nile Valley", aliases: [], lat: 25.0, lng: 32.9, bbox: [22.0, 28.0, 31.0, 35.0], description: "Nile River valley region" },
  { name: "Persia", aliases: ["iran"], lat: 32.4, lng: 53.7, bbox: [25.0, 44.0, 40.0, 63.0], description: "Ancient Persian Empire region" },
  { name: "India", aliases: ["bharata", "hindustan"], lat: 20.6, lng: 78.9, bbox: [6.0, 68.0, 36.0, 97.0], description: "Indian subcontinent" },
  { name: "Indus Valley", aliases: ["harappan"], lat: 27.0, lng: 68.0, bbox: [23.0, 64.0, 32.0, 76.0], description: "Indus Valley civilization region" },
  { name: "China", aliases: ["zhongguo"], lat: 35.9, lng: 104.2, bbox: [18.0, 73.0, 54.0, 135.0], description: "Chinese civilization region" },
  { name: "Mediterranean", aliases: ["mediterranean basin", "mare nostrum"], lat: 36.0, lng: 18.0, bbox: [30.0, -6.0, 46.0, 36.0], description: "Mediterranean Sea basin" },
  { name: "Europe", aliases: [], lat: 48.0, lng: 10.0, bbox: [35.0, -10.0, 71.0, 40.0], description: "European continent" },
  { name: "Central Asia", aliases: ["inner asia"], lat: 42.0, lng: 65.0, bbox: [30.0, 50.0, 55.0, 80.0], description: "Central Asian steppe and oases" },
  { name: "Arabia", aliases: ["arabian peninsula"], lat: 23.0, lng: 45.0, bbox: [12.0, 34.0, 32.0, 60.0], description: "Arabian Peninsula" },
  { name: "Scandinavia", aliases: ["nordic"], lat: 62.0, lng: 15.0, bbox: [54.0, 4.0, 71.0, 32.0], description: "Nordic region of Europe" },
  { name: "Balkans", aliases: ["southeast europe"], lat: 42.0, lng: 22.0, bbox: [35.0, 13.0, 47.0, 30.0], description: "Balkan Peninsula" },
  { name: "Caucasus", aliases: [], lat: 42.3, lng: 44.3, bbox: [38.0, 36.0, 44.0, 51.0], description: "Caucasus mountain region" },
  { name: "Mesoamerica", aliases: [], lat: 17.0, lng: -92.0, bbox: [7.0, -105.0, 24.0, -82.0], description: "Pre-Columbian civilizations of Central America" },
  { name: "West Africa", aliases: [], lat: 10.0, lng: -5.0, bbox: [-5.0, -18.0, 25.0, 16.0], description: "Western Africa region" },
  { name: "East Africa", aliases: [], lat: -2.0, lng: 37.0, bbox: [-12.0, 28.0, 12.0, 52.0], description: "Eastern Africa region" },
  { name: "Southeast Asia", aliases: [], lat: 10.0, lng: 107.0, bbox: [-10.0, 92.0, 28.0, 140.0], description: "Southeast Asian region" },
  { name: "Siberia", aliases: [], lat: 60.0, lng: 100.0, bbox: [50.0, 60.0, 75.0, 170.0], description: "Siberian region of Northern Asia" },
  { name: "Oceania", aliases: [], lat: -25.0, lng: 140.0, bbox: [-50.0, 100.0, 0.0, 180.0], description: "Oceania and Pacific Islands" },
  { name: "Polynesia", aliases: [], lat: -15.0, lng: -150.0, bbox: [-30.0, -180.0, 0.0, -120.0], description: "Polynesian Triangle region" },
  { name: "Andes", aliases: ["andean region"], lat: -15.0, lng: -72.0, bbox: [-35.0, -82.0, 5.0, -60.0], description: "Andean mountain civilization region" },
];

// ── Fuzzy matching ─────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ");
}

/** Token-based fuzzy match score (0-1) */
function fuzzyScore(query: string, target: string): number {
  const q = normalize(query);
  const t = normalize(target);
  if (!q || !t) return 0;

  // Exact match
  if (q === t) return 1.0;

  // Prefix match bonus
  if (t.startsWith(q)) return 0.9;

  // Substring match
  if (t.includes(q)) return 0.7;

  // Token-based matching
  const qTokens = q.split(" ");
  let matched = 0;
  for (const token of qTokens) {
    if (t.includes(token)) matched++;
  }
  if (matched === 0) return 0;

  return (matched / qTokens.length) * 0.6;
}

/** Best fuzzy score across name and aliases */
function bestFuzzyScore(query: string, name: string, aliases: string[]): number {
  let best = fuzzyScore(query, name);
  for (const alias of aliases) {
    const s = fuzzyScore(query, alias);
    if (s > best) best = s;
  }
  return best;
}

// ── Place Resolver ─────────────────────────────────────────────

/** Search for places matching a query string. Returns ranked results. */
export async function searchPlaces(query: string, limit: number = 15): Promise<PlaceSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { results: [], query: trimmed };
  }

  const results: PlaceResult[] = [];

  // 1. Search known regions
  for (const region of KNOWN_REGIONS) {
    const score = bestFuzzyScore(trimmed, region.name, region.aliases);
    if (score > 0) {
      results.push({
        id: `region-${normalize(region.name).replace(/\s+/g, "-")}`,
        name: region.name,
        category: "region",
        geometryType: "bbox",
        lat: region.lat,
        lng: region.lng,
        bbox: region.bbox,
        description: region.description,
        relevance: score,
      });
    }
  }

  // 2. Search settlements from TSV data
  const settlements = await storage.getSettlements();
  for (const s of settlements) {
    const aliases = [
      ...(s.alternateNames || []),
      ...(s.modernName ? [s.modernName] : []),
    ];
    const score = bestFuzzyScore(trimmed, s.name, aliases);
    if (score > 0) {
      const period = formatTimePeriod(s.foundedYear, s.abandonedYear);
      results.push({
        id: `settlement-${s.id}`,
        name: s.name,
        category: "settlement",
        geometryType: "point",
        lat: s.latitude,
        lng: s.longitude,
        description: [
          s.type ? capitalize(s.type.replace(/-/g, " ")) : null,
          s.region || null,
          s.modernName ? `Modern: ${s.modernName}` : null,
        ].filter(Boolean).join(" · "),
        timePeriod: period || undefined,
        relevance: score,
      });
    }
  }

  // 3. Search archaeological sites
  const sites = await storage.getArchaeologicalSites();
  for (const site of sites) {
    const props = site.properties;
    const name = props?.name as string | undefined;
    if (!name) continue;
    const siteId = props?.siteId as string | undefined;
    const lat = (site.geometry as any)?.coordinates?.[1];
    const lng = (site.geometry as any)?.coordinates?.[0];
    if (lat == null || lng == null) continue;

    const score = fuzzyScore(trimmed, name);
    if (score > 0) {
      const siteType = props?.siteType as string | undefined;
      results.push({
        id: `site-${siteId || site.id}`,
        name,
        category: "archaeological-site",
        geometryType: "point",
        lat,
        lng,
        description: siteType ? capitalize(siteType) : "Archaeological site",
        relevance: score * 0.95, // Slightly lower priority than settlements
      });
    }
  }

  // 4. Search battles
  const battles = await storage.getBattles();
  for (const b of battles) {
    const score = fuzzyScore(trimmed, b.name);
    if (score > 0 && b.coordinates && b.coordinates.length === 2) {
      results.push({
        id: `battle-${b.id}`,
        name: b.name,
        category: "battle",
        geometryType: "point",
        lat: b.coordinates[1],
        lng: b.coordinates[0],
        description: [b.warName, b.date].filter(Boolean).join(" · "),
        relevance: score * 0.9,
      });
    }
  }

  // Sort by relevance, deduplicate by close coordinates + similar name
  results.sort((a, b) => b.relevance - a.relevance);
  const deduped = deduplicateResults(results);
  return { results: deduped.slice(0, limit), query: trimmed };
}

/**
 * Search with an external geocoder fallback for modern place names. Prefers
 * GeoNames (standardized naming + `geonamesId`) and falls back to Nominatim, then
 * merges with the local results. `deps` is injectable so tests use recorded
 * fixtures; production defaults to {@link liveDeps}.
 */
export async function searchPlacesWithNominatim(
  query: string,
  limit: number = 15,
  deps: PlaceResolverDeps = liveDeps,
): Promise<PlaceSearchResponse> {
  const local = await searchPlaces(query, limit);

  // If we have good local results, skip the external geocoder
  if (local.results.length >= 3 && local.results[0].relevance >= 0.7) {
    return local;
  }

  const external = await queryExternalPlaces(
    query,
    Math.max(5, limit - local.results.length),
    deps,
  );
  if (external.length === 0) return local;

  const combined = [...local.results, ...external];
  combined.sort((a, b) => b.relevance - a.relevance);
  return { results: deduplicateResults(combined).slice(0, limit), query };
}

/**
 * Resolve a query to canonical place records (name, lat/lng, geonames_id).
 * Prefers GeoNames for standardized naming and falls back to Nominatim; every
 * record carries provenance. `deps` is injectable for fixture-backed tests.
 */
export async function resolvePlace(
  query: string,
  limit: number = 10,
  deps: PlaceResolverDeps = liveDeps,
): Promise<CanonicalPlaceResponse> {
  const trimmed = query.trim();
  if (!trimmed) return { results: [], query: "", source: null };

  // 1. Prefer GeoNames — standardized naming + stable geonamesId.
  try {
    const gn = await deps.fetchGeoNames(trimmed, limit);
    if (gn.length > 0) {
      return {
        results: gn.map(geoNamesToCanonical),
        query: trimmed,
        source: "geonames",
      };
    }
  } catch {
    // GeoNames unconfigured / rate-limited / down — fall through to Nominatim.
  }

  // 2. Fall back to Nominatim (OpenStreetMap).
  try {
    const nom = await deps.fetchNominatim(trimmed, limit);
    return {
      results: nom.map(nominatimToCanonical),
      query: trimmed,
      source: nom.length > 0 ? "nominatim" : null,
    };
  } catch {
    return { results: [], query: trimmed, source: null };
  }
}

/** Autocomplete: fast prefix-based search across local data only */
export async function autocompletePlaces(query: string, limit: number = 8): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const response = await searchPlaces(trimmed, limit);
  return response.results;
}

// ── External geocoders (GeoNames preferred, Nominatim fallback) ─────────────────

/** Raw GeoNames `searchJSON` result (subset used here). */
export interface GeoNamesResult {
  geonameId: number;
  name: string;
  toponymName?: string;
  lat: string;
  lng: string;
  /** Feature-code label, e.g. `capital of a country`. */
  fcodeName?: string;
  countryName?: string;
  adminName1?: string;
}

/** Raw Nominatim `search` result (subset used here). */
export interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  boundingbox?: string[];
}

/**
 * Injectable network boundary for external geocoders. Tests pass a fixture-backed
 * implementation; production uses {@link liveDeps}.
 */
export interface PlaceResolverDeps {
  /** GeoNames standardized-name search (preferred). */
  fetchGeoNames(query: string, limit: number): Promise<GeoNamesResult[]>;
  /** Nominatim / OSM search (fallback). */
  fetchNominatim(query: string, limit: number): Promise<NominatimResult[]>;
}

const GEONAMES_URL = "https://www.geonames.org/";

/** Nominatim boundingbox [south, north, west, east] → [south, west, north, east]. */
function nominatimBbox(
  boundingbox: string[] | undefined,
): [number, number, number, number] | undefined {
  if (!boundingbox || boundingbox.length < 4) return undefined;
  return [
    parseFloat(boundingbox[0]),
    parseFloat(boundingbox[2]),
    parseFloat(boundingbox[1]),
    parseFloat(boundingbox[3]),
  ];
}

// ── Pure mappers (raw authority record → PlaceResult / CanonicalPlaceRecord) ────

/** GeoNames record → search {@link PlaceResult} (with provenance). */
export function geoNamesToPlaceResult(item: GeoNamesResult, i: number): PlaceResult {
  return {
    id: `geonames-${item.geonameId}`,
    name: item.name,
    category: "geonames",
    geometryType: "point",
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lng),
    description: [item.fcodeName, item.adminName1, item.countryName]
      .filter(Boolean)
      .join(" · ") || "GeoNames place",
    // Preferred over Nominatim (0.6): standardized naming ranks slightly higher.
    relevance: 0.68 - i * 0.05,
    provenance: {
      source: "geonames",
      sourceId: String(item.geonameId),
      sourceUrl: `${GEONAMES_URL}${item.geonameId}`,
    },
  };
}

/** Nominatim record → search {@link PlaceResult} (with provenance). */
export function nominatimToPlaceResult(item: NominatimResult, i: number): PlaceResult {
  const bbox = nominatimBbox(item.boundingbox);
  return {
    id: `nominatim-${item.place_id}`,
    name: item.display_name.split(",")[0].trim(),
    category: "modern",
    geometryType: bbox ? "bbox" : "point",
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
    bbox,
    description: item.display_name,
    relevance: 0.6 - i * 0.05, // Slightly below local + GeoNames results
    provenance: {
      source: "nominatim",
      sourceId: String(item.place_id),
      sourceUrl: `https://www.openstreetmap.org/?place_id=${item.place_id}`,
    },
  };
}

/** GeoNames record → canonical resolve record (carries `geonamesId`). */
export function geoNamesToCanonical(item: GeoNamesResult): CanonicalPlaceRecord {
  return {
    name: item.name,
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lng),
    geonamesId: item.geonameId,
    countryName: item.countryName,
    featureType: item.fcodeName,
    provenance: {
      source: "geonames",
      sourceId: String(item.geonameId),
      sourceUrl: `${GEONAMES_URL}${item.geonameId}`,
    },
  };
}

/** Nominatim record → canonical resolve record (`geonamesId` is null). */
export function nominatimToCanonical(item: NominatimResult): CanonicalPlaceRecord {
  return {
    name: item.display_name.split(",")[0].trim(),
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
    geonamesId: null,
    bbox: nominatimBbox(item.boundingbox),
    provenance: {
      source: "nominatim",
      sourceId: String(item.place_id),
      sourceUrl: `https://www.openstreetmap.org/?place_id=${item.place_id}`,
    },
  };
}

/**
 * Query external geocoders for a modern place name — GeoNames first (preferred),
 * Nominatim as fallback. Returns ranked {@link PlaceResult}s with provenance.
 */
export async function queryExternalPlaces(
  query: string,
  limit: number,
  deps: PlaceResolverDeps = liveDeps,
): Promise<PlaceResult[]> {
  // 1. Prefer GeoNames.
  try {
    const gn = await deps.fetchGeoNames(query, limit);
    if (gn.length > 0) return gn.map(geoNamesToPlaceResult);
  } catch {
    // Fall through to Nominatim.
  }
  // 2. Fall back to Nominatim.
  try {
    return (await deps.fetchNominatim(query, limit)).map(nominatimToPlaceResult);
  } catch {
    return [];
  }
}

// ── Live network implementation ─────────────────────────────────────────────────

const USER_AGENT = "pinakes/1.0 (historical-linguistics-research)";

let lastNominatimCall = 0;
const NOMINATIM_RATE_LIMIT_MS = 1100; // Nominatim requires >= 1 req/sec

/** Live deps hitting the real GeoNames / Nominatim REST APIs. */
export const liveDeps: PlaceResolverDeps = {
  async fetchGeoNames(query: string, limit: number): Promise<GeoNamesResult[]> {
    // GeoNames requires a (free) username; without one, throw so we fall back.
    const username = process.env.GEONAMES_USERNAME;
    if (!username) {
      throw new Error("GEONAMES_USERNAME not configured");
    }
    const params = new URLSearchParams({
      q: query,
      maxRows: String(limit),
      style: "MEDIUM",
      orderby: "relevance",
      username,
    });
    const response = await fetch(
      `https://secure.geonames.org/searchJSON?${params}`,
      { headers: { "User-Agent": USER_AGENT } },
    );
    if (!response.ok) throw new Error(`GeoNames returned ${response.status}`);
    const data = (await response.json()) as {
      geonames?: GeoNamesResult[];
      status?: { message: string; value: number };
    };
    // GeoNames signals quota/errors in a 200 body under `status`.
    if (data.status) throw new Error(`GeoNames error: ${data.status.message}`);
    return data.geonames ?? [];
  },

  async fetchNominatim(query: string, limit: number): Promise<NominatimResult[]> {
    // Rate-limit to comply with Nominatim usage policy.
    const now = Date.now();
    const waitMs = NOMINATIM_RATE_LIMIT_MS - (now - lastNominatimCall);
    if (waitMs > 0) {
      await new Promise((r) => setTimeout(r, waitMs));
    }
    lastNominatimCall = Date.now();

    const params = new URLSearchParams({
      q: query,
      format: "json",
      limit: String(limit),
      addressdetails: "1",
    });
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?${params}`,
      { headers: { "User-Agent": USER_AGENT } },
    );
    if (!response.ok) return [];
    return (await response.json()) as NominatimResult[];
  },
};

// ── Helpers ────────────────────────────────────────────────────

function formatTimePeriod(founded: number | null, abandoned: number | null): string | null {
  if (founded == null) return null;
  const f = formatYear(founded);
  const a = abandoned != null ? formatYear(abandoned) : "present";
  return `${f} – ${a}`;
}

function formatYear(y: number): string {
  if (y < 0) return `${Math.abs(y)} BCE`;
  return `${y} CE`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Remove near-duplicate results (same name + close coordinates) */
function deduplicateResults(results: PlaceResult[]): PlaceResult[] {
  const seen = new Set<string>();
  const out: PlaceResult[] = [];
  for (const r of results) {
    // Key: rounded coordinates + normalized name
    const key = `${normalize(r.name)}|${r.lat.toFixed(1)},${r.lng.toFixed(1)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
