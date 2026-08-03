/**
 * Test script for Glottolog scraper
 * Run with: npx tsx test/test-glottolog-scraper.ts
 */

import * as fs from "fs";
import * as path from "path";

// We test the scraper's parsing/conversion logic by importing the class
// and calling methods with mock data, without hitting the actual API.

const LEXICONS_DIR = path.join(import.meta.dirname!, "..", "data", "source", "lexicons");

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertEqual(actual: any, expected: any, message: string) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message} (expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)})`);
  }
}

// --- Mock data for Glottolog API responses ---

const mockFamilyResponse = {
  id: "indo1319",
  name: "Indo-European",
  level: "family",
  iso639_3: null,
  latitude: null,
  longitude: null,
  macroarea: "Eurasia",
  child_family_count: 10,
  child_language_count: 583,
  child_dialect_count: 0,
  children: [
    { id: "germ1287", name: "Germanic", level: "family" },
    { id: "roma1334", name: "Romance", level: "family" },
    { id: "slav1255", name: "Slavic", level: "family" },
  ],
  parent: null,
  classification: [],
};

const mockSubfamilyResponse = {
  id: "germ1287",
  name: "Germanic",
  level: "family",
  iso639_3: null,
  latitude: null,
  longitude: null,
  macroarea: "Eurasia",
  child_family_count: 3,
  child_language_count: 48,
  child_dialect_count: 0,
  children: [
    { id: "stan1295", name: "Standard English", level: "language" },
    { id: "stan1295", name: "Standard German", level: "language" },
  ],
  parent: { name: "Indo-European", id: "indo1319" },
  classification: [{ name: "Indo-European", id: "indo1319" }],
};

const mockLanguageResponse = {
  id: "stan1295",
  name: "Standard English",
  level: "language",
  iso639_3: "eng",
  latitude: 53.0,
  longitude: -1.0,
  macroarea: "Eurasia",
  child_family_count: 0,
  child_language_count: 0,
  child_dialect_count: 12,
  children: [
    { id: "amer1249", name: "American English", level: "dialect" },
  ],
  parent: { name: "Germanic", id: "germ1287" },
  classification: [
    { name: "Indo-European", id: "indo1319" },
    { name: "Germanic", id: "germ1287" },
  ],
};

const mockDialectResponse = {
  id: "amer1249",
  name: "American English",
  level: "dialect",
  iso639_3: null,
  latitude: 40.0,
  longitude: -100.0,
  macroarea: "North America",
  child_family_count: 0,
  child_language_count: 0,
  child_dialect_count: 0,
  children: [],
  parent: { name: "Standard English", id: "stan1295" },
  classification: [
    { name: "Indo-European", id: "indo1319" },
    { name: "Germanic", id: "germ1287" },
  ],
};

// --- Tests ---

async function testGlottologScraperImport() {
  console.log("\n=== Glottolog Scraper Import ===");
  const mod = await import("../server/services/glottolog-scraper");
  assert(typeof mod.GlottologScraper === "function", "GlottologScraper class is exported");
  assert(typeof mod.glottologScraper === "object", "glottologScraper singleton is exported");
  assert(typeof mod.glottologScraper.fetchLanguoid === "function", "fetchLanguoid method exists");
  assert(typeof mod.glottologScraper.scrapeGlottolog === "function", "scrapeGlottolog method exists");
  assert(typeof mod.glottologScraper.scrapeFamilyTree === "function", "scrapeFamilyTree method exists");
  assert(typeof mod.glottologScraper.scrapeTopLevelFamilies === "function", "scrapeTopLevelFamilies method exists");
}

async function testParseLanguoidToFamily() {
  console.log("\n=== Parse Languoid to Family ===");
  const { GlottologScraper } = await import("../server/services/glottolog-scraper");
  const scraper = new GlottologScraper();

  // Use the private parseLanguoidResponse via fetchLanguoid mock approach
  // Instead, test through scrapeFamilyTree with a mock fetch
  // We'll test the conversion logic by checking the output types

  // Test that a family languoid gets correct ID format
  const familyData = scraper["languoidToFamily"](
    scraper["parseLanguoidResponse"](mockFamilyResponse, "indo1319"),
    null
  );

  assertEqual(familyData.name, "Indo-European", "Family name is correct");
  assertEqual(familyData.parentId, null, "Top-level family has null parentId");
  assert(familyData.id === "indo_european", "Family ID is slugified");
  assert(familyData.taxonomicLevel === "Family", "Top-level has Family taxonomic level");
  assert(familyData.region === "Eurasia", "Region extracted from macroarea");
  assertEqual(familyData.languageCount, 583, "Language count preserved");
  assert(familyData.description!.includes("indo1319"), "Description includes glottocode");
  assertEqual(familyData.source, "scraped", "Source is scraped");
}

async function testParseLanguoidToSubfamily() {
  console.log("\n=== Parse Languoid to Subfamily ===");
  const { GlottologScraper } = await import("../server/services/glottolog-scraper");
  const scraper = new GlottologScraper();

  const subfamilyData = scraper["languoidToFamily"](
    scraper["parseLanguoidResponse"](mockSubfamilyResponse, "germ1287"),
    "indo_european"
  );

  assertEqual(subfamilyData.name, "Germanic", "Subfamily name is correct");
  assertEqual(subfamilyData.parentId, "indo_european", "Parent ID is set");
  assertEqual(subfamilyData.id, "indo_european__germanic", "Subfamily ID includes parent");
  assertEqual(subfamilyData.taxonomicLevel, "Subfamily", "Child of top-level is Subfamily");
}

async function testParseLanguoidToLanguage() {
  console.log("\n=== Parse Languoid to Language ===");
  const { GlottologScraper } = await import("../server/services/glottolog-scraper");
  const scraper = new GlottologScraper();

  const langData = scraper["languoidToLanguage"](
    scraper["parseLanguoidResponse"](mockLanguageResponse, "stan1295"),
    "indo_european__germanic"
  );

  assertEqual(langData.name, "Standard English", "Language name is correct");
  assertEqual(langData.id, "eng", "Language ID uses ISO 639-3 when available");
  assertEqual(langData.iso639_2, "eng", "ISO 639-3 code stored in iso639_2 field");
  assertEqual(langData.familyId, "indo_european__germanic", "Family ID is set");
  assertEqual(langData.region, "Eurasia", "Region from macroarea");
  assert(langData.coordinates !== null, "Coordinates are set");
  assertEqual(langData.coordinates!.lat, 53.0, "Latitude is correct");
  assertEqual(langData.coordinates!.lng, -1.0, "Longitude is correct");
  assert(langData.classification!.includes("Indo-European"), "Classification includes family name");
  assertEqual(langData.source, "scraped", "Source is scraped");
}

async function testLanguageWithoutIso() {
  console.log("\n=== Language Without ISO Code ===");
  const { GlottologScraper } = await import("../server/services/glottolog-scraper");
  const scraper = new GlottologScraper();

  const noIsoResponse = { ...mockLanguageResponse, iso639_3: null, name: "Some Rare Language" };
  const langData = scraper["languoidToLanguage"](
    scraper["parseLanguoidResponse"](noIsoResponse, "rare1234"),
    "test_family"
  );

  assertEqual(langData.id, "some_rare_language", "Falls back to slugified name when no ISO code");
}

async function testLanguageWithoutCoordinates() {
  console.log("\n=== Language Without Coordinates ===");
  const { GlottologScraper } = await import("../server/services/glottolog-scraper");
  const scraper = new GlottologScraper();

  const noCoordResponse = { ...mockLanguageResponse, latitude: null, longitude: null };
  const langData = scraper["languoidToLanguage"](
    scraper["parseLanguoidResponse"](noCoordResponse, "stan1295"),
    "test_family"
  );

  assertEqual(langData.coordinates, null, "Coordinates are null when not provided");
}

async function testTaxonomicLevelInference() {
  console.log("\n=== Taxonomic Level Inference ===");
  const { GlottologScraper } = await import("../server/services/glottolog-scraper");
  const scraper = new GlottologScraper();

  // Top level (no parent)
  const topLevel = scraper["inferTaxonomicLevel"](
    scraper["parseLanguoidResponse"](mockFamilyResponse, "indo1319"),
    null
  );
  assertEqual(topLevel, "Family", "No parent = Family level");

  // Direct child of top level
  const subLevel = scraper["inferTaxonomicLevel"](
    scraper["parseLanguoidResponse"](mockSubfamilyResponse, "germ1287"),
    "indo_european"
  );
  assertEqual(subLevel, "Subfamily", "Child of top-level = Subfamily");

  // Grandchild
  const genusLevel = scraper["inferTaxonomicLevel"](
    scraper["parseLanguoidResponse"](mockSubfamilyResponse, "germ1287"),
    "indo_european__germanic"
  );
  assertEqual(genusLevel, "Genus", "Grandchild = Genus");

  // Great-grandchild
  const subgenusLevel = scraper["inferTaxonomicLevel"](
    scraper["parseLanguoidResponse"](mockSubfamilyResponse, "germ1287"),
    "indo_european__germanic__west"
  );
  assertEqual(subgenusLevel, "Subgenus", "Great-grandchild = Subgenus");
}

async function testConcurrencyGuard() {
  console.log("\n=== Concurrency Guard ===");
  const { GlottologScraper } = await import("../server/services/glottolog-scraper");

  // Reset the flag
  GlottologScraper.resetScrapingFlag();

  // Set the flag manually to simulate an in-progress scrape
  (GlottologScraper as any).isScraping = true;

  const scraper = new GlottologScraper();
  let threw = false;
  try {
    await scraper.scrapeGlottolog({});
  } catch (e: any) {
    threw = true;
    assert(e.message.includes("already in progress"), "Error message mentions already in progress");
  }
  assert(threw, "Throws when scraping is already in progress");

  // Reset for other tests
  GlottologScraper.resetScrapingFlag();
}

async function testDialectsSkipped() {
  console.log("\n=== Dialects Skipped in Tree Traversal ===");
  const { GlottologScraper } = await import("../server/services/glottolog-scraper");

  // Verify that dialect-level children are present in mock but would be skipped
  const parsed = new GlottologScraper()["parseLanguoidResponse"](mockLanguageResponse, "stan1295");
  assert(parsed.children.length === 1, "Mock has 1 child (a dialect)");
  assertEqual(parsed.children[0].level, "dialect", "Child is a dialect");
  // The scrapeFamilyTree method skips dialects, so tree traversal won't recurse into them
}

async function testSlugify() {
  console.log("\n=== Slugify Function ===");
  // Import the module to test the slugify behavior through family/language ID generation
  const { GlottologScraper } = await import("../server/services/glottolog-scraper");
  const scraper = new GlottologScraper();

  // Test with diacritics
  const response = {
    ...mockFamilyResponse,
    name: "Tübatulabal-Kawaiisu",
  };
  const family = scraper["languoidToFamily"](
    scraper["parseLanguoidResponse"](response, "tuba1234"),
    null
  );
  assertEqual(family.id, "tubatulabal_kawaiisu", "Diacritics removed and hyphens converted");

  // Test with special characters
  const response2 = {
    ...mockFamilyResponse,
    name: "Sino-Tibetan (Trans-Himalayan)",
  };
  const family2 = scraper["languoidToFamily"](
    scraper["parseLanguoidResponse"](response2, "sino1234"),
    null
  );
  assertEqual(family2.id, "sino_tibetan_trans_himalayan", "Special chars become underscores");
}

async function testParseLanguoidResponse() {
  console.log("\n=== Parse Languoid Response ===");
  const { GlottologScraper } = await import("../server/services/glottolog-scraper");
  const scraper = new GlottologScraper();

  const parsed = scraper["parseLanguoidResponse"](mockFamilyResponse, "indo1319");

  assertEqual(parsed.id, "indo1319", "ID from response");
  assertEqual(parsed.name, "Indo-European", "Name parsed");
  assertEqual(parsed.level, "family", "Level parsed");
  assertEqual(parsed.glottocode, "indo1319", "Glottocode from parameter");
  assertEqual(parsed.macroarea, "Eurasia", "Macroarea parsed");
  assertEqual(parsed.children.length, 3, "Three children parsed");
  assertEqual(parsed.child_language_count, 583, "Language count parsed");

  // Test with missing/null fields
  const sparseResponse = { id: "test1234", name: "Test" };
  const sparseParsed = scraper["parseLanguoidResponse"](sparseResponse, "test1234");
  assertEqual(sparseParsed.level, "family", "Defaults to family level");
  assertEqual(sparseParsed.latitude, null, "Missing latitude is null");
  assertEqual(sparseParsed.children.length, 0, "Missing children defaults to empty array");
}

async function main() {
  console.log("=== Glottolog Scraper Tests ===\n");

  await testGlottologScraperImport();
  await testParseLanguoidResponse();
  await testParseLanguoidToFamily();
  await testParseLanguoidToSubfamily();
  await testParseLanguoidToLanguage();
  await testLanguageWithoutIso();
  await testLanguageWithoutCoordinates();
  await testTaxonomicLevelInference();
  await testConcurrencyGuard();
  await testDialectsSkipped();
  await testSlugify();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
