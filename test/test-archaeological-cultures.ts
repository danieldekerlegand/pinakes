/**
 * Test script for archaeological cultures TSV loader and storage
 * Run with: npx tsx test/test-archaeological-cultures.ts
 */

import { TsvStorage } from "../server/tsv-storage";

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

async function testArchaeologicalCultures() {
  console.log("=== Archaeological Cultures TSV Loader Test ===\n");

  const storage = new TsvStorage();

  // Test 1: Load all cultures
  console.log("Test 1: Load all archaeological cultures");
  const allCultures = await storage.getArchaeologicalCultures();
  assert(allCultures.length > 0, `Loaded ${allCultures.length} cultures`);
  assert(allCultures.length >= 60, `At least 60 cultures loaded (got ${allCultures.length})`);

  // Test 2: Verify structure of a known culture
  console.log("\nTest 2: Verify Yamnaya culture structure");
  const yamnaya = await storage.getArchaeologicalCultureById("yamnaya");
  assert(yamnaya !== null, "Yamnaya culture found");
  if (yamnaya) {
    assert(yamnaya.name === "Yamnaya", `Name is correct: ${yamnaya.name}`);
    assert(yamnaya.region === "Pontic-Caspian Steppe", `Region is correct: ${yamnaya.region}`);
    assert(yamnaya.coordinates.lat === 47.0, `Latitude correct: ${yamnaya.coordinates.lat}`);
    assert(yamnaya.coordinates.lng === 40.0, `Longitude correct: ${yamnaya.coordinates.lng}`);
    assert(yamnaya.timePeriodStart === -3300, `Start date correct: ${yamnaya.timePeriodStart}`);
    assert(yamnaya.timePeriodEnd === -2600, `End date correct: ${yamnaya.timePeriodEnd}`);
    assert(yamnaya.associatedLanguageIds.includes("pie"), `Associated language includes PIE`);
    assert(yamnaya.successorCultureIds.length > 0, `Has successor cultures`);
    assert(yamnaya.materialGoods.length > 0, `Has material goods`);
    assert(yamnaya.confidence === 90, `Confidence is 90: ${yamnaya.confidence}`);
    assert(yamnaya.sources.length > 0, `Has sources`);
  }

  // Test 3: Filter by region
  console.log("\nTest 3: Filter by region");
  const europeanCultures = await storage.getArchaeologicalCultures({ region: "Europe" });
  assert(europeanCultures.length > 0, `Found ${europeanCultures.length} European cultures`);
  assert(
    europeanCultures.every((c) => c.region.toLowerCase().includes("europe")),
    "All results contain 'Europe' in region"
  );

  // Test 4: Filter by language
  console.log("\nTest 4: Filter by language");
  const pieCultures = await storage.getArchaeologicalCultures({ languageId: "pie" });
  assert(pieCultures.length > 0, `Found ${pieCultures.length} PIE-associated cultures`);
  assert(
    pieCultures.every((c) => c.associatedLanguageIds.includes("pie")),
    "All results include PIE in associated languages"
  );

  // Test 5: Filter by time range
  console.log("\nTest 5: Filter by time range");
  const bronzeAgeCultures = await storage.getArchaeologicalCultures({
    timeStart: -3000,
    timeEnd: -1000,
  });
  assert(bronzeAgeCultures.length > 0, `Found ${bronzeAgeCultures.length} Bronze Age cultures`);
  assert(
    bronzeAgeCultures.every((c) => {
      const end = c.timePeriodEnd ?? Infinity;
      const start = c.timePeriodStart ?? -Infinity;
      return end >= -3000 && start <= -1000;
    }),
    "All results overlap with the time range"
  );

  // Test 6: Get by ID - not found
  console.log("\nTest 6: Non-existent culture returns null");
  const notFound = await storage.getArchaeologicalCultureById("nonexistent-culture");
  assert(notFound === null, "Returns null for nonexistent culture");

  // Test 7: Combined filters
  console.log("\nTest 7: Combined filters (region + time)");
  const filteredCultures = await storage.getArchaeologicalCultures({
    region: "China",
    timeStart: -5000,
    timeEnd: -2000,
  });
  assert(filteredCultures.length > 0, `Found ${filteredCultures.length} Chinese Neolithic cultures`);
  assert(
    filteredCultures.every((c) => c.region.toLowerCase().includes("china")),
    "All results contain 'China' in region"
  );

  // Test 8: Verify predecessor/successor relationships
  console.log("\nTest 8: Predecessor/successor relationships");
  const cordedWare = await storage.getArchaeologicalCultureById("corded-ware");
  assert(cordedWare !== null, "Corded Ware culture found");
  if (cordedWare) {
    assert(cordedWare.predecessorCultureId === "yamnaya", `Predecessor is Yamnaya: ${cordedWare.predecessorCultureId}`);
  }
  if (yamnaya) {
    assert(yamnaya.successorCultureIds.includes("corded-ware"), "Yamnaya successor includes Corded Ware");
  }

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

testArchaeologicalCultures().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
