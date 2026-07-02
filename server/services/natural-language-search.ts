/**
 * Natural Language Search Service
 *
 * Parses temporal-spatial queries like:
 *   "What languages were spoken in Mesopotamia in 3000 BCE?"
 *   "civilizations near 35.5, 44.2 in 500 BCE"
 *   "battles in Europe around 1200 CE"
 *
 * Also provides autocomplete suggestions for query patterns.
 */

import { storage } from "../storage";
import type {
  Battle,
  MigrationRoute,
  Religion,
  MusicTradition,
  Cuisine,
  ArtTradition,
  TradeGood,
  FoodwayEvent,
} from "../tsv-storage";

export interface ParsedQuery {
  /** Original query text */
  raw: string;
  /** Extracted entity type filter (e.g., "language", "civilization", "battle") or null for all */
  entityType: string | null;
  /** Extracted location name (e.g., "Mesopotamia", "Europe") */
  locationName: string | null;
  /** Extracted lat/lng coordinates */
  coordinates: { lat: number; lng: number } | null;
  /** Extracted year (negative = BCE) */
  year: number | null;
  /** Search radius in km (default 500) */
  radiusKm: number;
}

export interface SpatialSearchResult {
  entityType: string;
  id: string;
  displayName: string;
  description: string;
  distanceKm: number | null;
  coordinates: { lat: number; lng: number } | null;
  timePeriod: string | null;
}

export interface SpatialSearchResponse {
  results: SpatialSearchResult[];
  query: ParsedQuery;
  totalCount: number;
}

/** Well-known location names mapped to approximate coordinates */
const KNOWN_LOCATIONS: Record<string, { lat: number; lng: number }> = {
  mesopotamia: { lat: 33.3, lng: 44.4 },
  "fertile crescent": { lat: 33.0, lng: 42.0 },
  egypt: { lat: 26.8, lng: 30.8 },
  "nile valley": { lat: 25.0, lng: 32.9 },
  levant: { lat: 33.0, lng: 36.0 },
  anatolia: { lat: 39.0, lng: 35.0 },
  persia: { lat: 32.4, lng: 53.7 },
  india: { lat: 20.6, lng: 78.9 },
  "indus valley": { lat: 27.0, lng: 68.0 },
  china: { lat: 35.9, lng: 104.2 },
  "yellow river": { lat: 35.0, lng: 110.0 },
  japan: { lat: 36.2, lng: 138.3 },
  korea: { lat: 35.9, lng: 127.8 },
  europe: { lat: 48.0, lng: 10.0 },
  "western europe": { lat: 48.0, lng: 3.0 },
  "eastern europe": { lat: 50.0, lng: 30.0 },
  "northern europe": { lat: 60.0, lng: 15.0 },
  scandinavia: { lat: 62.0, lng: 15.0 },
  "southern europe": { lat: 40.0, lng: 15.0 },
  mediterranean: { lat: 36.0, lng: 18.0 },
  balkans: { lat: 42.0, lng: 22.0 },
  iberia: { lat: 40.0, lng: -4.0 },
  britain: { lat: 53.0, lng: -2.0 },
  france: { lat: 46.6, lng: 2.2 },
  germany: { lat: 51.2, lng: 10.4 },
  italy: { lat: 41.9, lng: 12.6 },
  greece: { lat: 39.1, lng: 21.8 },
  rome: { lat: 41.9, lng: 12.5 },
  athens: { lat: 37.98, lng: 23.73 },
  "central asia": { lat: 42.0, lng: 65.0 },
  steppe: { lat: 48.0, lng: 68.0 },
  "silk road": { lat: 40.0, lng: 65.0 },
  africa: { lat: 0, lng: 25.0 },
  "west africa": { lat: 10.0, lng: -5.0 },
  "east africa": { lat: -2.0, lng: 37.0 },
  "north africa": { lat: 30.0, lng: 10.0 },
  "south africa": { lat: -30.0, lng: 25.0 },
  "sahara": { lat: 23.0, lng: 12.0 },
  "sub-saharan africa": { lat: 5.0, lng: 20.0 },
  "southeast asia": { lat: 10.0, lng: 107.0 },
  "middle east": { lat: 29.0, lng: 42.0 },
  "near east": { lat: 33.0, lng: 40.0 },
  "far east": { lat: 35.0, lng: 120.0 },
  americas: { lat: 15.0, lng: -90.0 },
  "north america": { lat: 45.0, lng: -100.0 },
  "south america": { lat: -15.0, lng: -60.0 },
  mesoamerica: { lat: 17.0, lng: -92.0 },
  andes: { lat: -15.0, lng: -72.0 },
  oceania: { lat: -25.0, lng: 140.0 },
  polynesia: { lat: -15.0, lng: -150.0 },
  australia: { lat: -25.0, lng: 134.0 },
  caucasus: { lat: 42.3, lng: 44.3 },
  siberia: { lat: 60.0, lng: 100.0 },
  arabia: { lat: 23.0, lng: 45.0 },
  babylon: { lat: 32.5, lng: 44.4 },
  jerusalem: { lat: 31.77, lng: 35.23 },
  constantinople: { lat: 41.01, lng: 28.98 },
  istanbul: { lat: 41.01, lng: 28.98 },
};

/** Entity type keywords to detect in queries */
const ENTITY_TYPE_KEYWORDS: Record<string, string[]> = {
  language: ["language", "languages", "tongue", "tongues", "spoken", "speak"],
  civilization: ["civilization", "civilizations", "culture", "cultures", "empire", "empires", "kingdom", "kingdoms"],
  battle: ["battle", "battles", "war", "wars", "conflict", "conflicts", "fought"],
  "migration-route": ["migration", "migrations", "route", "routes", "movement", "movements"],
  religion: ["religion", "religions", "faith", "faiths", "worship", "worshipped", "belief"],
  "music-tradition": ["music", "musical", "song", "songs", "instrument", "instruments"],
  cuisine: ["cuisine", "cuisines", "food", "foods", "dish", "dishes", "cooking"],
  "art-tradition": ["art", "arts", "artistic", "painting", "sculpture"],
  "trade-good": ["trade", "traded", "goods", "commodity", "commodities", "commerce"],
  "archaeological-site": ["archaeological", "archaeology", "site", "sites", "ruins", "excavation", "dig"],
};

/** Parse a year string like "3000 BCE", "500 CE", "1200", "3000 bc" */
function parseYear(text: string): number | null {
  // Match patterns: "3000 BCE", "500 CE", "3000 bc", "500 ad", "1200"
  const bceMatch = text.match(/(\d{1,5})\s*(?:bce|bc|b\.c\.e?\.?)/i);
  if (bceMatch) return -parseInt(bceMatch[1], 10);

  const ceMatch = text.match(/(\d{1,5})\s*(?:ce|ad|a\.d\.?)/i);
  if (ceMatch) return parseInt(ceMatch[1], 10);

  // Standalone 4-digit year (assume CE if > 0)
  const yearMatch = text.match(/\b(\d{4})\b/);
  if (yearMatch) {
    const y = parseInt(yearMatch[1], 10);
    if (y >= 100 && y <= 2100) return y;
  }

  return null;
}

/** Parse coordinate pair like "35.5, 44.2" or "lat 35.5 lng 44.2" */
function parseCoordinates(text: string): { lat: number; lng: number } | null {
  // "35.5, 44.2" or "35.5,44.2"
  const pairMatch = text.match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  if (pairMatch) {
    const lat = parseFloat(pairMatch[1]);
    const lng = parseFloat(pairMatch[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

/** Try to resolve a location name from the query */
function parseLocationName(text: string): { name: string; coords: { lat: number; lng: number } } | null {
  const lower = text.toLowerCase();

  // Remove temporal phrases and question words to isolate location
  const cleaned = lower
    .replace(/\b(?:what|which|where|who|how|was|were|are|is|in|at|near|around|during|the|there|here)\b/g, " ")
    .replace(/\b\d{1,5}\s*(?:bce|bc|ce|ad|b\.c\.e?\.?|a\.d\.?)\b/gi, " ")
    .replace(/\b\d{4}\b/g, " ")
    .trim();

  // Check known locations (longest match first)
  const sortedLocations = Object.keys(KNOWN_LOCATIONS).sort((a, b) => b.length - a.length);
  for (const loc of sortedLocations) {
    if (lower.includes(loc)) {
      return { name: loc, coords: KNOWN_LOCATIONS[loc] };
    }
  }

  return null;
}

/** Detect entity type from query keywords */
function detectEntityType(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [entityType, keywords] of Object.entries(ENTITY_TYPE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        return entityType;
      }
    }
  }
  return null;
}

/** Parse a natural language query into structured components */
export function parseNaturalLanguageQuery(query: string): ParsedQuery {
  const trimmed = query.trim();
  if (!trimmed) {
    return { raw: "", entityType: null, locationName: null, coordinates: null, year: null, radiusKm: 500 };
  }

  const entityType = detectEntityType(trimmed);
  const year = parseYear(trimmed);
  const coordinates = parseCoordinates(trimmed);
  const location = parseLocationName(trimmed);

  return {
    raw: trimmed,
    entityType,
    locationName: location?.name || null,
    coordinates: coordinates || location?.coords || null,
    year,
    radiusKm: 500,
  };
}

/** Haversine distance between two points in km */
function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Check if a year falls within a time range */
function isInTimeRange(year: number | null, start: number | string | null, end: number | string | null): boolean {
  if (year === null) return true;

  const parseNum = (v: number | string | null): number | null => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return v;
    // Parse "3000 BCE" style strings
    const parsed = parseYear(String(v));
    if (parsed !== null) return parsed;
    const n = parseInt(String(v), 10);
    return isNaN(n) ? null : n;
  };

  const s = parseNum(start);
  const e = parseNum(end);

  if (s !== null && e !== null) return year >= s && year <= e;
  if (s !== null) return year >= s;
  if (e !== null) return year <= e;
  return true;
}

/** Format a year for display */
function formatYear(year: number | null): string | null {
  if (year === null) return null;
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
}

/** Perform a spatial search given parsed query parameters */
export async function spatialSearch(query: ParsedQuery): Promise<SpatialSearchResponse> {
  if (!query.coordinates && !query.locationName && !query.year && !query.entityType) {
    return { results: [], query, totalCount: 0 };
  }

  const results: SpatialSearchResult[] = [];
  const { coordinates, year, entityType, radiusKm } = query;

  const shouldSearch = (type: string) => !entityType || entityType === type;

  // Helper: add result if within radius
  const addIfNearby = (
    type: string,
    id: string,
    name: string,
    desc: string,
    coords: { lat: number; lng: number } | null,
    timeStart: number | string | null,
    timeEnd: number | string | null,
  ) => {
    if (!isInTimeRange(year, timeStart, timeEnd)) return;

    let distanceKm: number | null = null;
    if (coordinates && coords) {
      distanceKm = haversineDistance(coordinates.lat, coordinates.lng, coords.lat, coords.lng);
      if (distanceKm > radiusKm) return;
    } else if (coordinates && !coords) {
      return; // Can't compute distance, skip
    }

    const timePeriod = timeStart || timeEnd
      ? `${formatYear(typeof timeStart === "number" ? timeStart : parseYear(String(timeStart ?? "")) ) ?? "?"} – ${formatYear(typeof timeEnd === "number" ? timeEnd : parseYear(String(timeEnd ?? ""))) ?? "present"}`
      : null;

    results.push({ entityType: type, id, displayName: name, description: desc, distanceKm, coordinates: coords, timePeriod });
  };

  // Search languages
  if (shouldSearch("language")) {
    const languages = await storage.getLanguages();
    for (const lang of languages) {
      if (!lang.coordinates) continue;
      addIfNearby(
        "language", lang.id, lang.name,
        lang.nativeName || lang.region || "",
        lang.coordinates,
        lang.timeOrigin ?? null, lang.timeEnd ?? null,
      );
    }
  }

  // Search civilizations
  if (shouldSearch("civilization")) {
    const civs = await storage.getCivilizations();
    for (const civ of civs) {
      const props = civ.properties;
      const name = props?.name as string | undefined;
      const civId = props?.civilizationId as string | undefined;
      const capital = props?.capital as string | undefined;
      const startYear = props?.startYear as number | undefined;
      const endYear = props?.endYear as number | undefined;

      // Try to get coordinates from geometry centroid
      let coords: { lat: number; lng: number } | null = null;
      if (civ.geometry?.type === "Polygon" && civ.geometry.coordinates?.[0]?.[0]) {
        const ring = civ.geometry.coordinates[0];
        const avgLat = ring.reduce((s: number, c: number[]) => s + c[1], 0) / ring.length;
        const avgLng = ring.reduce((s: number, c: number[]) => s + c[0], 0) / ring.length;
        coords = { lat: avgLat, lng: avgLng };
      }

      if (name) {
        addIfNearby(
          "civilization", civId || String(civ.id), name,
          capital ? `Capital: ${capital}` : "",
          coords,
          startYear ?? null, endYear ?? null,
        );
      }
    }
  }

  // Search battles
  if (shouldSearch("battle")) {
    const battles = await storage.getBattles();
    for (const b of battles) {
      const coords = b.coordinates
        ? { lat: b.coordinates[1], lng: b.coordinates[0] }
        : null;
      const battleYear = parseYear(b.date);
      addIfNearby(
        "battle", b.id, b.name,
        `${b.warName} — ${b.significance}`,
        coords,
        battleYear, battleYear,
      );
    }
  }

  // Search religions
  if (shouldSearch("religion")) {
    const religions = await storage.getReligions();
    for (const r of religions) {
      addIfNearby(
        "religion", r.id, r.name,
        `${r.religionType} — ${r.originRegion}`,
        r.coordinates,
        r.timeOrigin, r.timeEnd,
      );
    }
  }

  // Search music traditions
  if (shouldSearch("music-tradition")) {
    const traditions = await storage.getMusicTraditions();
    for (const mt of traditions) {
      addIfNearby(
        "music-tradition", mt.id, mt.name,
        mt.description?.slice(0, 120) || mt.region,
        mt.coordinates,
        mt.timeOrigin, mt.timeEnd,
      );
    }
  }

  // Search cuisines
  if (shouldSearch("cuisine")) {
    const cuisines = await storage.getCuisines();
    for (const c of cuisines) {
      addIfNearby(
        "cuisine", c.id, c.name,
        c.description?.slice(0, 120) || c.region,
        c.coordinates,
        c.timeOrigin, c.timeEnd,
      );
    }
  }

  // Search art traditions
  if (shouldSearch("art-tradition")) {
    const arts = await storage.getArtTraditions();
    for (const at of arts) {
      addIfNearby(
        "art-tradition", at.id, at.name,
        at.description?.slice(0, 120) || at.category,
        at.originCoordinates,
        at.originDate, at.endDate,
      );
    }
  }

  // Search trade goods
  if (shouldSearch("trade-good")) {
    const goods = await storage.getTradeGoods();
    for (const tg of goods) {
      addIfNearby(
        "trade-good", tg.id, tg.name,
        `${tg.category} — ${tg.originRegion}`,
        tg.originCoordinates,
        null, null,
      );
    }
  }

  // Search archaeological sites
  if (shouldSearch("archaeological-site")) {
    const sites = await storage.getArchaeologicalSites();
    for (const site of sites) {
      const props = site.properties;
      const name = props?.name as string | undefined;
      const siteId = props?.siteId as string | undefined;
      const siteType = props?.siteType as string | undefined;
      const startYear = props?.startYear as number | undefined;
      const endYear = props?.endYear as number | undefined;

      let coords: { lat: number; lng: number } | null = null;
      if (site.geometry?.type === "Point" && site.geometry.coordinates) {
        coords = { lat: site.geometry.coordinates[1], lng: site.geometry.coordinates[0] };
      }

      if (name) {
        addIfNearby(
          "archaeological-site", siteId || String(site.id), name,
          siteType || "",
          coords,
          startYear ?? null, endYear ?? null,
        );
      }
    }
  }

  // Sort by distance (nearest first), then by name
  results.sort((a, b) => {
    if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
    if (a.distanceKm !== null) return -1;
    if (b.distanceKm !== null) return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  const top = results.slice(0, 50);
  return { results: top, query, totalCount: results.length };
}

/** Perform a "What was here?" query for a specific map click location */
export async function whatWasHere(
  lat: number,
  lng: number,
  year: number | null,
  radiusKm: number = 200,
): Promise<SpatialSearchResponse> {
  const query: ParsedQuery = {
    raw: `What was here? (${lat.toFixed(2)}, ${lng.toFixed(2)})`,
    entityType: null,
    locationName: null,
    coordinates: { lat, lng },
    year,
    radiusKm,
  };
  return spatialSearch(query);
}

/** Autocomplete suggestions based on partial input */
export function getQuerySuggestions(partial: string): string[] {
  const lower = partial.toLowerCase().trim();
  if (!lower) return [];

  const suggestions: string[] = [];

  // Location-based suggestions
  const locationNames = Object.keys(KNOWN_LOCATIONS);
  for (const loc of locationNames) {
    if (loc.startsWith(lower) || lower.includes(loc.slice(0, 3))) {
      suggestions.push(`What was in ${loc}?`);
      suggestions.push(`Languages spoken in ${loc}`);
      suggestions.push(`Civilizations in ${loc}`);
      if (suggestions.length >= 8) break;
    }
  }

  // If typing a temporal query
  if (lower.includes("in") || lower.includes("around") || lower.includes("during")) {
    for (const loc of locationNames.slice(0, 5)) {
      if (lower.includes(loc)) {
        suggestions.push(`Languages in ${loc} in 3000 BCE`);
        suggestions.push(`Civilizations in ${loc} in 1000 BCE`);
        suggestions.push(`Battles in ${loc} in 500 CE`);
        break;
      }
    }
  }

  // Entity type suggestions
  if (lower.startsWith("what")) {
    suggestions.push(
      "What languages were spoken in Mesopotamia?",
      "What civilizations existed in 3000 BCE?",
      "What battles were fought in Europe?",
      "What religions originated in the Middle East?",
    );
  }

  // Pattern-based suggestions
  const patterns = [
    "Languages spoken in {location}",
    "Civilizations in {location} in {year}",
    "Battles near {location}",
    "Trade goods from {location}",
    "Religions in {location}",
    "Archaeological sites near {location}",
  ];

  if (suggestions.length < 3) {
    for (const p of patterns) {
      if (p.toLowerCase().includes(lower.slice(0, 4))) {
        suggestions.push(p);
      }
    }
  }

  // Deduplicate and limit
  return [...new Set(suggestions)].slice(0, 8);
}

// Re-export for convenience
export { KNOWN_LOCATIONS };
