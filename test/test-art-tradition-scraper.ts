/**
 * Test script for art tradition scraper, style evolutions, and TSV storage
 * Run with: npx tsx test/test-art-tradition-scraper.ts
 */

import fs from "node:fs";
import { TsvStorage } from "../server/tsv-storage";
import { ArtTraditionScraper } from "../server/services/art-tradition-scraper";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function testArtTraditions() {
  console.log("=== Testing Art Traditions TSV Storage ===\n");

  const storage = new TsvStorage();

  // Test 1: Load all art traditions
  console.log("1. Loading all art traditions:");
  const all = await storage.getArtTraditions();
  assert(all.length >= 19, `Loaded ${all.length} traditions (expected >= 19)`);

  // Test 2: Verify data structure
  console.log("\n2. Verifying data structure:");
  const egyptian = all.find((t) => t.id === "art-001");
  assert(egyptian !== undefined, "Found Egyptian Monumental");
  if (egyptian) {
    assert(egyptian.name === "Egyptian Monumental", `Name: ${egyptian.name}`);
    assert(egyptian.category === "architecture", `Category: ${egyptian.category}`);
    assert(egyptian.stylePeriod === "Ancient Egyptian", `Style period: ${egyptian.stylePeriod}`);
    assert(egyptian.originDate === -3100, `Origin date: ${egyptian.originDate}`);
    assert(egyptian.endDate === -30, `End date: ${egyptian.endDate}`);
    assert(egyptian.originCoordinates.lat !== 0, `Has coordinates`);
    assert(egyptian.associatedLanguages.length > 0, `Has languages: ${egyptian.associatedLanguages.join(", ")}`);
    assert(egyptian.keyFeatures.length > 0, `Has features: ${egyptian.keyFeatures.length}`);
    assert(egyptian.notableExamples.length > 0, `Has examples: ${egyptian.notableExamples.length}`);
    assert(egyptian.description.length > 0, "Has description");
  }

  // Test 3: Filter by category
  console.log("\n3. Filtering by category:");
  const paintings = await storage.getArtTraditions({ category: "painting" });
  assert(paintings.length > 0, `Found ${paintings.length} painting traditions`);
  assert(paintings.every((t) => t.category === "painting"), "All results are paintings");

  // Test 4: Filter by style period
  console.log("\n4. Filtering by style period:");
  const classical = await storage.getArtTraditions({ stylePeriod: "Classical" });
  assert(classical.length > 0, `Found ${classical.length} Classical traditions`);
  assert(classical.every((t) => t.stylePeriod === "Classical"), "All results are Classical");

  // Test 5: Get by ID
  console.log("\n5. Getting by ID:");
  const greek = await storage.getArtTraditionById("art-002");
  assert(greek !== null, "Found Greek Classical by ID");
  assert(greek?.name === "Greek Classical", `Name: ${greek?.name}`);

  const notFound = await storage.getArtTraditionById("nonexistent");
  assert(notFound === null, "Returns null for nonexistent ID");

  // Test 6: Verify unique IDs
  console.log("\n6. Verifying unique IDs:");
  const ids = all.map((t) => t.id);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === ids.length, `All ${ids.length} IDs are unique`);
}

async function testStyleEvolutions() {
  console.log("\n=== Testing Style Evolutions TSV Storage ===\n");

  const storage = new TsvStorage();

  // Test 1: Load all style evolutions
  console.log("1. Loading all style evolutions:");
  const all = await storage.getStyleEvolutions();
  assert(all.length >= 4, `Loaded ${all.length} evolutions (expected >= 4)`);

  // Test 2: Verify data structure
  console.log("\n2. Verifying data structure:");
  const greekToRoman = all.find((e) => e.id === "art-002__art-003");
  assert(greekToRoman !== undefined, "Found Greek → Roman evolution");
  if (greekToRoman) {
    assert(greekToRoman.fromTraditionId === "art-002", `From: ${greekToRoman.fromTraditionId}`);
    assert(greekToRoman.toTraditionId === "art-003", `To: ${greekToRoman.toTraditionId}`);
    assert(greekToRoman.transitionType === "direct_evolution", `Type: ${greekToRoman.transitionType}`);
    assert(greekToRoman.transitionDate === -146, `Date: ${greekToRoman.transitionDate}`);
    assert(greekToRoman.description.length > 0, "Has description");
    assert(greekToRoman.keyChanges.length > 0, `Has key changes: ${greekToRoman.keyChanges.length}`);
    assert(greekToRoman.catalysts.length > 0, `Has catalysts: ${greekToRoman.catalysts.length}`);
  }

  // Test 3: Filter by tradition ID
  console.log("\n3. Filtering by tradition ID:");
  const romanEvolutions = await storage.getStyleEvolutions({ traditionId: "art-003" });
  assert(romanEvolutions.length >= 2, `Found ${romanEvolutions.length} evolutions involving Roman Art`);
  assert(
    romanEvolutions.every((e) => e.fromTraditionId === "art-003" || e.toTraditionId === "art-003"),
    "All results involve art-003"
  );

  // Test 4: Filter by transition type
  console.log("\n4. Filtering by transition type:");
  const directEvolutions = await storage.getStyleEvolutions({ transitionType: "direct_evolution" });
  assert(directEvolutions.length > 0, `Found ${directEvolutions.length} direct evolutions`);
  assert(
    directEvolutions.every((e) => e.transitionType === "direct_evolution"),
    "All results are direct_evolution"
  );

  const revivals = await storage.getStyleEvolutions({ transitionType: "revival" });
  assert(revivals.length >= 1, `Found ${revivals.length} revival connections`);

  // Test 5: Get by ID
  console.log("\n5. Getting by ID:");
  const evolution = await storage.getStyleEvolutionById("art-002__art-003");
  assert(evolution !== null, "Found evolution by ID");
  assert(evolution?.fromTraditionId === "art-002", "Correct from tradition");

  const notFound = await storage.getStyleEvolutionById("nonexistent");
  assert(notFound === null, "Returns null for nonexistent ID");

  // Test 6: Unique IDs
  console.log("\n6. Verifying unique IDs:");
  const ids = all.map((e) => e.id);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === ids.length, `All ${ids.length} IDs are unique`);
}

async function testScraperHelpers() {
  console.log("\n=== Testing Scraper Helper Methods ===\n");

  const scraper = new ArtTraditionScraper();

  // Test 1: TSV file existence
  console.log("1. Verifying TSV files exist:");
  assert(fs.existsSync("lexicons/art-traditions.tsv"), "art-traditions.tsv exists");
  assert(fs.existsSync("lexicons/art-style-evolutions.tsv"), "art-style-evolutions.tsv exists");

  // Test 2: TSV file structure - art traditions
  console.log("\n2. Verifying art-traditions.tsv structure:");
  const artContent = fs.readFileSync("lexicons/art-traditions.tsv", "utf8");
  const artLines = artContent.split("\n").filter((l) => l.trim());
  const artHeader = artLines[0].split("\t");
  assert(artHeader.includes("id"), "Has id column");
  assert(artHeader.includes("name"), "Has name column");
  assert(artHeader.includes("category"), "Has category column");
  assert(artHeader.includes("style_period"), "Has style_period column");
  assert(artHeader.includes("origin_date"), "Has origin_date column");
  assert(artHeader.includes("end_date"), "Has end_date column");
  assert(artHeader.includes("origin_coordinates"), "Has origin_coordinates column");
  assert(artHeader.includes("key_features"), "Has key_features column");
  assert(artHeader.includes("notable_examples"), "Has notable_examples column");

  // Verify all rows have correct column count
  const expectedCols = artHeader.length;
  const allRowsMatch = artLines.slice(1).every((line) => line.split("\t").length === expectedCols);
  assert(allRowsMatch, `All rows have ${expectedCols} columns`);

  // Test 3: TSV file structure - style evolutions
  console.log("\n3. Verifying art-style-evolutions.tsv structure:");
  const evoContent = fs.readFileSync("lexicons/art-style-evolutions.tsv", "utf8");
  const evoLines = evoContent.split("\n").filter((l) => l.trim());
  const evoHeader = evoLines[0].split("\t");
  assert(evoHeader.includes("id"), "Has id column");
  assert(evoHeader.includes("from_tradition_id"), "Has from_tradition_id column");
  assert(evoHeader.includes("to_tradition_id"), "Has to_tradition_id column");
  assert(evoHeader.includes("transition_type"), "Has transition_type column");
  assert(evoHeader.includes("transition_date"), "Has transition_date column");
  assert(evoHeader.includes("key_changes"), "Has key_changes column");
  assert(evoHeader.includes("catalysts"), "Has catalysts column");

  const evoCols = evoHeader.length;
  const allEvoRowsMatch = evoLines.slice(1).every((line) => line.split("\t").length === evoCols);
  assert(allEvoRowsMatch, `All evolution rows have ${evoCols} columns`);

  // Test 4: Style evolution references valid art tradition IDs
  console.log("\n4. Verifying evolution references:");
  const artIds = new Set(artLines.slice(1).map((l) => l.split("\t")[0]));
  const evolutions = evoLines.slice(1).map((l) => l.split("\t"));
  const fromIdx = evoHeader.indexOf("from_tradition_id");
  const toIdx = evoHeader.indexOf("to_tradition_id");

  const allRefsValid = evolutions.every(
    (row) => artIds.has(row[fromIdx]) && artIds.has(row[toIdx])
  );
  assert(allRefsValid, "All evolution references point to valid art tradition IDs");

  // Test 5: Scraper requires GEMINI_API_KEY
  console.log("\n5. Verifying scraper validation:");
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await scraper.scrapeArtTraditions();
    assert(false, "Should throw without GEMINI_API_KEY");
  } catch (err: any) {
    assert(err.message.includes("GEMINI_API_KEY"), "Throws correct error without API key");
  } finally {
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
  }
}

async function main() {
  await testArtTraditions();
  await testStyleEvolutions();
  await testScraperHelpers();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
