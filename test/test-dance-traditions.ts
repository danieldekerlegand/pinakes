/**
 * Test script for dance traditions TSV loader and API
 * Run with: npx tsx test/test-dance-traditions.ts
 */

import { TsvStorage } from "../server/tsv-storage";

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

async function testDanceTraditions() {
  console.log("=== Testing Dance Traditions ===\n");

  const storage = new TsvStorage();

  // Test 1: Load all dance traditions
  console.log("1. Loading all dance traditions:");
  const all = await storage.getDanceTraditions();
  assert(all.length >= 30, `Loaded ${all.length} traditions (expected >= 30)`);

  // Test 2: Verify data structure of first tradition
  console.log("\n2. Verifying data structure:");
  const bharatanatyam = all.find((t) => t.id === "bharatanatyam");
  assert(bharatanatyam !== undefined, "Found Bharatanatyam");
  if (bharatanatyam) {
    assert(bharatanatyam.name === "Bharatanatyam", `Name: ${bharatanatyam.name}`);
    assert(bharatanatyam.region === "South Asia", `Region: ${bharatanatyam.region}`);
    assert(bharatanatyam.danceType === "classical", `Dance type: ${bharatanatyam.danceType}`);
    assert(bharatanatyam.coordinates.lat !== 0, `Has coordinates: ${bharatanatyam.coordinates.lat}, ${bharatanatyam.coordinates.lng}`);
    assert(bharatanatyam.timeOrigin === -200, `Time origin: ${bharatanatyam.timeOrigin}`);
    assert(bharatanatyam.associatedLanguageIds.length > 0, `Has language IDs: ${bharatanatyam.associatedLanguageIds.join(", ")}`);
    assert(bharatanatyam.keyMovements.length > 0, `Has key movements: ${bharatanatyam.keyMovements.length}`);
    assert(bharatanatyam.costumes.length > 0, `Has costumes: ${bharatanatyam.costumes.length}`);
    assert(bharatanatyam.associatedMusicTraditionIds.length > 0, `Has music tradition links: ${bharatanatyam.associatedMusicTraditionIds.join(", ")}`);
    assert(bharatanatyam.description.length > 0, "Has description");
    assert(bharatanatyam.culturalSignificance.length > 0, "Has cultural significance");
  }

  // Test 3: Filter by region
  console.log("\n3. Filtering by region:");
  const southAsian = await storage.getDanceTraditions({ region: "South Asia" });
  assert(southAsian.length > 0, `Found ${southAsian.length} South Asian traditions`);
  assert(southAsian.every((t) => t.region.toLowerCase().includes("south asia")), "All results match region filter");

  // Test 4: Filter by dance type
  console.log("\n4. Filtering by dance type:");
  const classical = await storage.getDanceTraditions({ danceType: "classical" });
  assert(classical.length > 0, `Found ${classical.length} classical traditions`);
  assert(classical.every((t) => t.danceType === "classical"), "All results are classical");

  // Test 5: Filter by year
  console.log("\n5. Filtering by year:");
  const modern = await storage.getDanceTraditions({ year: 2000 });
  assert(modern.length > 0, `Found ${modern.length} traditions active in 2000`);
  const ancient = await storage.getDanceTraditions({ year: -1000 });
  assert(ancient.length < modern.length, `Fewer traditions in -1000 (${ancient.length}) than 2000 (${modern.length})`);

  // Test 6: Filter by language
  console.log("\n6. Filtering by language:");
  const japanese = await storage.getDanceTraditions({ languageId: "japanese" });
  assert(japanese.length > 0, `Found ${japanese.length} Japanese traditions`);
  assert(japanese.every((t) => t.associatedLanguageIds.includes("japanese")), "All results include Japanese");

  // Test 7: Get by ID
  console.log("\n7. Getting by ID:");
  const flamenco = await storage.getDanceTraditionById("flamenco-dance");
  assert(flamenco !== null, "Found flamenco by ID");
  assert(flamenco?.name === "Flamenco Dance", `Name: ${flamenco?.name}`);

  const notFound = await storage.getDanceTraditionById("nonexistent");
  assert(notFound === null, "Returns null for nonexistent ID");

  // Test 8: Verify null time_end handling
  console.log("\n8. Verifying null handling:");
  const ballet = all.find((t) => t.id === "ballet");
  assert(ballet !== undefined && ballet.timeEnd === null, "Ballet has null timeEnd (still active)");

  const ottoman = all.find((t) => t.id === "ottoman-classical");
  if (ottoman) {
    assert(ottoman === undefined, "No Ottoman classical in dance traditions (it's music only)");
  } else {
    assert(true, "Correctly no Ottoman classical in dance traditions");
  }

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

testDanceTraditions().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
