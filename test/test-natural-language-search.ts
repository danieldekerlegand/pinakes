/**
 * Test script for natural language search query parsing
 * Run with: npx tsx test/test-natural-language-search.ts
 *
 * Tests the pure parsing functions independently of storage.
 */

// Inline the pure functions to avoid importing storage-dependent modules

/** Well-known location names mapped to approximate coordinates */
const KNOWN_LOCATIONS: Record<string, { lat: number; lng: number }> = {
  mesopotamia: { lat: 33.3, lng: 44.4 },
  "fertile crescent": { lat: 33.0, lng: 42.0 },
  egypt: { lat: 26.8, lng: 30.8 },
  levant: { lat: 33.0, lng: 36.0 },
  anatolia: { lat: 39.0, lng: 35.0 },
  persia: { lat: 32.4, lng: 53.7 },
  india: { lat: 20.6, lng: 78.9 },
  china: { lat: 35.9, lng: 104.2 },
  europe: { lat: 48.0, lng: 10.0 },
  rome: { lat: 41.9, lng: 12.5 },
  "middle east": { lat: 29.0, lng: 42.0 },
  "west africa": { lat: 10.0, lng: -5.0 },
  "southeast asia": { lat: 10.0, lng: 107.0 },
  mesoamerica: { lat: 17.0, lng: -92.0 },
  scandinavia: { lat: 62.0, lng: 15.0 },
};

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

interface ParsedQuery {
  raw: string;
  entityType: string | null;
  locationName: string | null;
  coordinates: { lat: number; lng: number } | null;
  year: number | null;
  radiusKm: number;
}

function parseYear(text: string): number | null {
  const bceMatch = text.match(/(\d{1,5})\s*(?:bce|bc|b\.c\.e?\.?)/i);
  if (bceMatch) return -parseInt(bceMatch[1], 10);
  const ceMatch = text.match(/(\d{1,5})\s*(?:ce|ad|a\.d\.?)/i);
  if (ceMatch) return parseInt(ceMatch[1], 10);
  const yearMatch = text.match(/\b(\d{4})\b/);
  if (yearMatch) {
    const y = parseInt(yearMatch[1], 10);
    if (y >= 100 && y <= 2100) return y;
  }
  return null;
}

function parseCoordinates(text: string): { lat: number; lng: number } | null {
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

function parseLocationName(text: string): { name: string; coords: { lat: number; lng: number } } | null {
  const lower = text.toLowerCase();
  const sortedLocations = Object.keys(KNOWN_LOCATIONS).sort((a, b) => b.length - a.length);
  for (const loc of sortedLocations) {
    if (lower.includes(loc)) {
      return { name: loc, coords: KNOWN_LOCATIONS[loc] };
    }
  }
  return null;
}

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

function parseNaturalLanguageQuery(query: string): ParsedQuery {
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

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

function getQuerySuggestions(partial: string): string[] {
  const lower = partial.toLowerCase().trim();
  if (!lower) return [];
  const suggestions: string[] = [];
  const locationNames = Object.keys(KNOWN_LOCATIONS);
  for (const loc of locationNames) {
    if (loc.startsWith(lower) || lower.includes(loc.slice(0, 3))) {
      suggestions.push(`What was in ${loc}?`);
      suggestions.push(`Languages spoken in ${loc}`);
      suggestions.push(`Civilizations in ${loc}`);
      if (suggestions.length >= 8) break;
    }
  }
  if (lower.startsWith("what")) {
    suggestions.push(
      "What languages were spoken in Mesopotamia?",
      "What civilizations existed in 3000 BCE?",
      "What battles were fought in Europe?",
      "What religions originated in the Middle East?",
    );
  }
  return [...new Set(suggestions)].slice(0, 8);
}

function isNaturalLanguageQuery(q: string): boolean {
  const lower = q.toLowerCase().trim();
  if (/^(what|which|where|who|how|show|find|list)\b/.test(lower)) return true;
  if (/\b(in|near|around|during)\b.*\b(bce|bc|ce|ad|\d{3,4})\b/i.test(lower)) return true;
  if (/\b\d{1,5}\s*(bce|bc|ce|ad|b\.c\.e?\.?|a\.d\.?)\b/i.test(lower)) return true;
  return false;
}

// ===== Test runner =====

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

console.log("=== Natural Language Search Tests ===\n");

// Test 1: Year parsing
console.log("Test 1: Year parsing");
assert(parseYear("3000 BCE") === -3000, "Parses '3000 BCE' as -3000");
assert(parseYear("500 CE") === 500, "Parses '500 CE' as 500");
assert(parseYear("1200 ad") === 1200, "Parses '1200 ad' as 1200");
assert(parseYear("500 bc") === -500, "Parses '500 bc' as -500");
assert(parseYear("2000 B.C.E.") === -2000, "Parses '2000 B.C.E.' as -2000");
assert(parseYear("hello world") === null, "Returns null for no year");
assert(parseYear("year 1500") === 1500, "Parses standalone 4-digit year");

// Test 2: Coordinate parsing
console.log("\nTest 2: Coordinate parsing");
assert(parseCoordinates("35.5, 44.2") !== null, "Parses decimal coordinate pair");
assert(parseCoordinates("35.5, 44.2")?.lat === 35.5, "Parses latitude correctly");
assert(parseCoordinates("35.5, 44.2")?.lng === 44.2, "Parses longitude correctly");
assert(parseCoordinates("-33.8, 151.2") !== null, "Parses negative coordinates");
assert(parseCoordinates("hello") === null, "Returns null for no coordinates");
assert(parseCoordinates("100, 200") === null, "Rejects out-of-range coordinates");

// Test 3: Location name parsing
console.log("\nTest 3: Location name parsing");
assert(parseLocationName("what was in mesopotamia")?.name === "mesopotamia", "Finds Mesopotamia");
assert(parseLocationName("near Rome")?.name === "rome", "Finds Rome");
assert(parseLocationName("in Egypt")?.name === "egypt", "Finds Egypt");
assert(parseLocationName("in the middle east")?.name === "middle east", "Finds Middle East (multi-word)");
assert(parseLocationName("hello world") === null, "Returns null for unknown location");

// Test 4: Entity type detection
console.log("\nTest 4: Entity type detection");
assert(detectEntityType("languages spoken") === "language", "Detects language");
assert(detectEntityType("civilizations existed") === "civilization", "Detects civilization");
assert(detectEntityType("battles fought") === "battle", "Detects battle");
assert(detectEntityType("trade goods from") === "trade-good", "Detects trade-good");
assert(detectEntityType("archaeological sites") === "archaeological-site", "Detects archaeological-site");
assert(detectEntityType("music traditions") === "music-tradition", "Detects music-tradition");
assert(detectEntityType("cuisine in") === "cuisine", "Detects cuisine");
assert(detectEntityType("religions in") === "religion", "Detects religion");
assert(detectEntityType("art traditions") === "art-tradition", "Detects art-tradition");
assert(detectEntityType("migration routes") === "migration-route", "Detects migration-route");
assert(detectEntityType("random text") === null, "Returns null for unknown entity");

// Test 5: Full query parsing
console.log("\nTest 5: Full query parsing");

const q1 = parseNaturalLanguageQuery("What languages were spoken in Mesopotamia in 3000 BCE?");
assert(q1.entityType === "language", "Full query: detects language entity");
assert(q1.locationName === "mesopotamia", "Full query: finds Mesopotamia");
assert(q1.year === -3000, "Full query: parses 3000 BCE");
assert(q1.coordinates !== null, "Full query: resolves coordinates");

const q2 = parseNaturalLanguageQuery("civilizations near 35.5, 44.2 in 500 CE");
assert(q2.entityType === "civilization", "Coords query: detects civilization");
assert(q2.coordinates?.lat === 35.5, "Coords query: parses lat from explicit coords");
assert(q2.year === 500, "Coords query: parses 500 CE");

const q3 = parseNaturalLanguageQuery("");
assert(q3.raw === "", "Empty query: raw is empty");
assert(q3.entityType === null, "Empty query: no entity type");
assert(q3.coordinates === null, "Empty query: no coordinates");

// Test 6: Haversine distance
console.log("\nTest 6: Haversine distance");
const d1 = haversineDistance(0, 0, 0, 0);
assert(d1 === 0, "Same point has 0 distance");
const d2 = haversineDistance(51.5, -0.12, 48.85, 2.35); // London to Paris
assert(d2 > 300 && d2 < 400, `London-Paris distance ~340km (got ${Math.round(d2)})`);
const d3 = haversineDistance(40.71, -74.0, 34.05, -118.24); // NYC to LA
assert(d3 > 3900 && d3 < 4000, `NYC-LA distance ~3940km (got ${Math.round(d3)})`);

// Test 7: Autocomplete suggestions
console.log("\nTest 7: Autocomplete suggestions");
const s1 = getQuerySuggestions("what");
assert(s1.length > 0, "Returns suggestions for 'what'");
assert(s1.some(s => s.toLowerCase().includes("what")), "Suggestions contain 'what'");

const s2 = getQuerySuggestions("meso");
assert(s2.length > 0, "Returns suggestions for 'meso' (Mesopotamia prefix)");
assert(s2.some(s => s.toLowerCase().includes("mesopotamia")), "Suggestions mention Mesopotamia");

const s3 = getQuerySuggestions("");
assert(s3.length === 0, "No suggestions for empty input");

const s4 = getQuerySuggestions("xyz");
assert(s4.length === 0, "No suggestions for unrecognized prefix");

// Test 8: Natural language query detection
console.log("\nTest 8: Natural language query detection");
assert(isNaturalLanguageQuery("What languages were spoken?") === true, "Detects 'What' question");
assert(isNaturalLanguageQuery("show me civilizations") === true, "Detects 'show' command");
assert(isNaturalLanguageQuery("find battles in 500 BCE") === true, "Detects 'find' + date");
assert(isNaturalLanguageQuery("languages in Egypt in 3000 BCE") === true, "Detects location + date pattern");
assert(isNaturalLanguageQuery("Latin") === false, "Simple keyword is not NL");
assert(isNaturalLanguageQuery("Sumerian") === false, "Single word is not NL");

// Summary
console.log(`\n${"=".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

if (failed > 0) {
  process.exit(1);
}
