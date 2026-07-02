/**
 * Tests for the Archaeological Site Scraper
 * Run with: npx tsx test/test-archaeological-site-scraper.ts
 */

import * as fs from "fs";
import * as path from "path";
import {
  ArchaeologicalSiteScraper,
  NOTABLE_PLEIADES_IDS,
  type ScrapedSite,
} from "../server/services/archaeological-site-scraper";

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

const scraper = new ArchaeologicalSiteScraper();

// ---- Unit Tests for Pleiades parsing ----

function testParsePleiadesPlace() {
  console.log("\n=== Parse Pleiades Place ===");

  const mockPlace = {
    id: "570491",
    title: "Mycenae",
    description: "An ancient Greek city famous for its archaeological significance.",
    reprPoint: [22.7564, 37.7308] as [number, number],
    placeTypes: ["settlement", "fortified-place"],
    locations: [
      {
        start: -1600,
        end: -1100,
        featureType: ["settlement"],
        geometry: { type: "Point", coordinates: [22.7564, 37.7308] },
        attestations: [{ timePeriod: "Late Bronze Age", confidence: "confident" }],
      },
    ],
    names: [
      { romanized: "Mycenae", language: "la", attested: "" },
      { romanized: "Mykenai", language: "grc", attested: "Μυκῆναι" },
    ],
    features: [],
  };

  const site = scraper.parsePleiadesPlace(mockPlace);
  assert(site !== null, "Parses valid place successfully");
  assert(site!.name === "Mycenae", "Extracts name correctly");
  assert(site!.coordinates.lat === 37.7308, "Extracts latitude from reprPoint");
  assert(site!.coordinates.lng === 22.7564, "Extracts longitude from reprPoint");
  assert(site!.siteType === "settlement", "Maps place type correctly");
  assert(site!.timePeriodStart === -1600, "Extracts time period start");
  assert(site!.timePeriodEnd === -1100, "Extracts time period end");
  assert(site!.associatedLanguageIds.includes("la"), "Extracts Latin language ID");
  assert(site!.associatedLanguageIds.includes("grc"), "Extracts Greek language ID");
  assert(site!.sources[0].includes("pleiades.stoa.org"), "Includes Pleiades source URL");
  assert(site!.confidence === 70, "Sets default confidence for Pleiades");
}

function testParsePleiadesPlaceNullCoords() {
  console.log("\n=== Parse Pleiades Place - No Coordinates ===");

  const mockPlace = {
    id: "999999",
    title: "Unknown Place",
    description: "",
    reprPoint: null,
    placeTypes: [],
    locations: [],
    names: [],
    features: [],
  };

  const site = scraper.parsePleiadesPlace(mockPlace);
  assert(site === null, "Returns null for place with no coordinates");
}

function testParsePleiadesPlaceFallbackCoords() {
  console.log("\n=== Parse Pleiades Place - Fallback Coordinates ===");

  const mockPlace = {
    id: "123456",
    title: "Fallback Place",
    description: "A place with coords only in locations.",
    reprPoint: null,
    placeTypes: ["temple"],
    locations: [
      {
        start: -500,
        end: 200,
        featureType: ["temple"],
        geometry: { type: "Point", coordinates: [35.5, 31.2] },
        attestations: [],
      },
    ],
    names: [],
    features: [],
  };

  const site = scraper.parsePleiadesPlace(mockPlace);
  assert(site !== null, "Falls back to location geometry");
  assert(site!.coordinates.lat === 31.2, "Gets lat from location geometry");
  assert(site!.coordinates.lng === 35.5, "Gets lng from location geometry");
  assert(site!.siteType === "temple", "Maps temple type correctly");
}

// ---- Unit Tests for type mapping ----

function testPlaceTypeMapping() {
  console.log("\n=== Place Type Mapping ===");

  const cases: [string[], string][] = [
    [["settlement"], "settlement"],
    [["urban-settlement"], "settlement"],
    [["city"], "city"],
    [["port"], "city"],
    [["temple"], "temple"],
    [["sanctuary"], "temple"],
    [["cemetery"], "burial"],
    [["tomb"], "burial"],
    [["fort"], "fortress"],
    [["fortress"], "fortress"],
    [["cave"], "cave_art"],
    [["workshop"], "workshop"],
    [["mine"], "workshop"],
    [["amphitheatre"], "ceremonial"],
    [["theatre"], "ceremonial"],
    [["unknown-type-xyz"], "unknown"],
    [[], "unknown"],
  ];

  for (const [input, expected] of cases) {
    const mockPlace = {
      id: "test",
      title: "Test",
      description: "",
      reprPoint: [10, 20] as [number, number],
      placeTypes: input,
      locations: [],
      names: [],
      features: [],
    };
    const site = scraper.parsePleiadesPlace(mockPlace);
    assert(
      site!.siteType === expected,
      `Maps [${input.join(",")}] → "${expected}"`,
    );
  }
}

// ---- UNESCO data tests ----

function testUnescoSites() {
  console.log("\n=== UNESCO Archaeological Sites ===");

  const sites = scraper.getUnescoArchaeologicalSites();
  assert(sites.length >= 15, `Has 15+ UNESCO sites (actual: ${sites.length})`);

  // Check all have valid coordinates
  let allValid = true;
  for (const s of sites) {
    if (s.coordinates.lat < -90 || s.coordinates.lat > 90) allValid = false;
    if (s.coordinates.lng < -180 || s.coordinates.lng > 180) allValid = false;
  }
  assert(allValid, "All UNESCO sites have valid coordinates");

  // Check all have IDs
  const allHaveIds = sites.every((s) => s.id && s.id.startsWith("unesco-"));
  assert(allHaveIds, "All UNESCO sites have prefixed IDs");

  // Check all have descriptions
  const allHaveDesc = sites.every((s) => s.description.length >= 10);
  assert(allHaveDesc, "All UNESCO sites have descriptions");

  // Check geographic diversity
  const hasAsia = sites.some((s) => s.coordinates.lng > 60 && s.coordinates.lat > 0);
  const hasAmericas = sites.some((s) => s.coordinates.lng < -30);
  const hasAfrica = sites.some((s) => s.coordinates.lat < 0 && s.coordinates.lng > 20 && s.coordinates.lng < 55);
  const hasOceania = sites.some((s) => s.coordinates.lng > 100 && s.coordinates.lat < 10);
  assert(hasAsia, "UNESCO sites include Asia");
  assert(hasAmericas, "UNESCO sites include Americas");
  assert(hasAfrica, "UNESCO sites include Africa");
  assert(hasOceania, "UNESCO sites include Oceania");

  // Check importance/confidence ranges
  const allInRange = sites.every(
    (s) => s.importance >= 1 && s.importance <= 100 && s.confidence >= 1 && s.confidence <= 100,
  );
  assert(allInRange, "All importance/confidence values in 1-100 range");
}

// ---- Merge logic tests ----

function testMergeWithExisting() {
  console.log("\n=== Merge Logic ===");

  const existing: ScrapedSite[] = [
    {
      id: "existing-1",
      name: "Pompeii",
      coordinates: { lat: 40.75, lng: 14.48 },
      siteType: "settlement",
      timePeriodStart: -600,
      timePeriodEnd: 79,
      timePeriodLabel: "600 BCE - 79 CE",
      associatedLanguageIds: ["lat"],
      associatedCultureIds: [],
      associatedCivilizationIds: [],
      excavationStatus: "extensive",
      findings: [],
      importance: 95,
      confidence: 100,
      sources: [],
      description: "Roman city",
    },
  ];

  const newSites: ScrapedSite[] = [
    {
      id: "new-1",
      name: "Pompeii", // duplicate by name
      coordinates: { lat: 40.75, lng: 14.48 },
      siteType: "settlement",
      timePeriodStart: -600,
      timePeriodEnd: 79,
      timePeriodLabel: "",
      associatedLanguageIds: [],
      associatedCultureIds: [],
      associatedCivilizationIds: [],
      excavationStatus: "partial",
      findings: [],
      importance: 50,
      confidence: 70,
      sources: [],
      description: "",
    },
    {
      id: "new-2",
      name: "Troy",
      coordinates: { lat: 39.95, lng: 26.24 },
      siteType: "settlement",
      timePeriodStart: -3000,
      timePeriodEnd: 500,
      timePeriodLabel: "",
      associatedLanguageIds: [],
      associatedCultureIds: [],
      associatedCivilizationIds: [],
      excavationStatus: "extensive",
      findings: [],
      importance: 90,
      confidence: 85,
      sources: [],
      description: "Ancient city of Troy",
    },
  ];

  const merged = scraper.mergeWithExisting(existing, newSites);
  assert(merged.length === 2, `Merge keeps existing + unique new (expected 2, got ${merged.length})`);
  assert(merged[0].id === "existing-1", "Preserves existing entry");
  assert(merged[1].name === "Troy", "Adds new unique entry");
}

// ---- TSV write/read round-trip ----

function testTsvRoundTrip() {
  console.log("\n=== TSV Write/Read Round Trip ===");

  const tmpDir = path.join(import.meta.dirname!, "..", ".tmp-test");
  const tmpFile = path.join(tmpDir, "test-sites.tsv");

  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    const sites: ScrapedSite[] = [
      {
        id: "test-athens",
        name: "Athens",
        coordinates: { lat: 37.9715, lng: 23.7267 },
        siteType: "city",
        timePeriodStart: -3000,
        timePeriodEnd: 500,
        timePeriodLabel: "3000 BCE - 500 CE",
        associatedLanguageIds: ["grc"],
        associatedCultureIds: ["hellenic"],
        associatedCivilizationIds: ["ancient-greece"],
        excavationStatus: "extensive",
        findings: ["Parthenon", "Agora"],
        importance: 95,
        confidence: 100,
        sources: ["Wikipedia"],
        description: "Ancient Greek city-state",
      },
    ];

    // Write synchronously for test
    const headers = [
      "id", "name", "coordinates", "site_type", "time_period_start",
      "time_period_end", "time_period_label", "associated_language_ids",
      "associated_culture_ids", "associated_civilization_ids",
      "excavation_status", "findings", "importance", "confidence",
      "sources", "description",
    ];
    const row = [
      sites[0].id, sites[0].name, JSON.stringify(sites[0].coordinates),
      sites[0].siteType, sites[0].timePeriodStart!.toString(),
      sites[0].timePeriodEnd!.toString(), sites[0].timePeriodLabel,
      JSON.stringify(sites[0].associatedLanguageIds),
      JSON.stringify(sites[0].associatedCultureIds),
      JSON.stringify(sites[0].associatedCivilizationIds),
      sites[0].excavationStatus, JSON.stringify(sites[0].findings),
      sites[0].importance.toString(), sites[0].confidence.toString(),
      JSON.stringify(sites[0].sources), sites[0].description,
    ].join("\t");
    fs.writeFileSync(tmpFile, headers.join("\t") + "\n" + row + "\n");

    // Read back
    const readBack = scraper.readExistingSites(tmpFile);
    assert(readBack.length === 1, "Reads back 1 site");
    assert(readBack[0].id === "test-athens", "ID preserved");
    assert(readBack[0].name === "Athens", "Name preserved");
    assert(readBack[0].coordinates.lat === 37.9715, "Lat preserved");
    assert(readBack[0].coordinates.lng === 23.7267, "Lng preserved");
    assert(readBack[0].siteType === "city", "Site type preserved");
    assert(readBack[0].timePeriodStart === -3000, "Time start preserved");
    assert(readBack[0].timePeriodEnd === 500, "Time end preserved");
    assert(readBack[0].associatedLanguageIds[0] === "grc", "Language IDs preserved");
    assert(readBack[0].findings.length === 2, "Findings array preserved");
    assert(readBack[0].importance === 95, "Importance preserved");
    assert(readBack[0].confidence === 100, "Confidence preserved");
  } finally {
    // Cleanup
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    try { fs.rmdirSync(tmpDir); } catch { /* ignore */ }
  }
}

// ---- Notable Pleiades IDs validation ----

function testNotablePleiadesIds() {
  console.log("\n=== Notable Pleiades IDs ===");

  assert(NOTABLE_PLEIADES_IDS.length >= 30, `Has 30+ notable IDs (actual: ${NOTABLE_PLEIADES_IDS.length})`);

  // All should be numeric strings
  const allNumeric = NOTABLE_PLEIADES_IDS.every((id) => /^\d+$/.test(id));
  assert(allNumeric, "All Pleiades IDs are numeric strings");

  // No duplicates
  const unique = new Set(NOTABLE_PLEIADES_IDS);
  assert(unique.size === NOTABLE_PLEIADES_IDS.length, "No duplicate Pleiades IDs");
}

// ---- Read non-existent file ----

function testReadNonExistentFile() {
  console.log("\n=== Read Non-Existent File ===");

  const sites = scraper.readExistingSites("/tmp/does-not-exist-abc123.tsv");
  assert(sites.length === 0, "Returns empty array for missing file");
}

// Run all tests
console.log("=== Archaeological Site Scraper Tests ===");

testParsePleiadesPlace();
testParsePleiadesPlaceNullCoords();
testParsePleiadesPlaceFallbackCoords();
testPlaceTypeMapping();
testUnescoSites();
testMergeWithExisting();
testTsvRoundTrip();
testNotablePleiadesIds();
testReadNonExistentFile();

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
