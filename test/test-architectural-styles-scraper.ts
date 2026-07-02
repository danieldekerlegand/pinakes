/**
 * Test script for architectural styles scraper and building type taxonomy
 * Run with: npx tsx test/test-architectural-styles-scraper.ts
 */

import { TsvStorage } from "../server/tsv-storage";
import { architecturalStylesScraper } from "../server/services/architectural-styles-scraper";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.log(`  FAIL: ${message}`);
    failed++;
  }
}

async function testBuildingTypeTaxonomy() {
  console.log("\n=== Testing Building Type Taxonomy ===\n");

  // Test 1: Taxonomy is populated
  const taxonomy = architecturalStylesScraper.getBuildingTypeTaxonomy();
  assert(taxonomy.length > 30, `Taxonomy has ${taxonomy.length} building types (expected > 30)`);

  // Test 2: Each building type has required fields
  const allValid = taxonomy.every(
    (bt) =>
      bt.id && bt.name && bt.category && bt.parentTypeId && bt.description
  );
  assert(allValid, "All building types have required fields");

  // Test 3: Categories are available
  const categories = architecturalStylesScraper.getBuildingCategories();
  assert(categories.length > 5, `Has ${categories.length} categories (expected > 5)`);

  // Test 4: Filter by category
  const religious = architecturalStylesScraper.getBuildingTypesByCategory("Religious");
  assert(religious.length > 5, `Religious category has ${religious.length} types (expected > 5)`);
  assert(
    religious.every((bt) => bt.category === "Religious"),
    "All filtered types are Religious"
  );

  // Test 5: Get by ID
  const temple = architecturalStylesScraper.getBuildingTypeById("temple");
  assert(temple !== null, "Found temple building type");
  assert(temple?.name === "Temple", `Temple name is "${temple?.name}"`);

  // Test 6: Get by non-existent ID
  const notFound = architecturalStylesScraper.getBuildingTypeById("nonexistent");
  assert(notFound === null, "Non-existent ID returns null");

  // Test 7: Get children
  const churchChildren = architecturalStylesScraper.getBuildingTypeChildren("church");
  assert(churchChildren.length > 0, `Church has ${churchChildren.length} children`);
  assert(
    churchChildren.some((c) => c.id === "cathedral"),
    "Cathedral is a child of Church"
  );

  // Test 8: Hierarchy integrity - all parentTypeIds reference valid types or categories
  const validIds = new Set([
    ...taxonomy.map((bt) => bt.id),
    ...categories.map((c) => c.id),
  ]);
  const orphans = taxonomy.filter((bt) => !validIds.has(bt.parentTypeId));
  assert(orphans.length === 0, `No orphan building types (found ${orphans.length})`);

  // Test 9: No duplicate IDs
  const ids = taxonomy.map((bt) => bt.id);
  const uniqueIds = new Set(ids);
  assert(ids.length === uniqueIds.size, "All building type IDs are unique");

  // Test 10: Structural features are arrays
  const allArrays = taxonomy.every(
    (bt) => Array.isArray(bt.structuralFeatures) && Array.isArray(bt.regions)
  );
  assert(allArrays, "Structural features and regions are arrays");
}

async function testBuildingTypesTSV() {
  console.log("\n=== Testing Building Types TSV Loading ===\n");

  const storage = new TsvStorage();

  // Test 1: Load all building types from TSV
  const allTypes = await storage.getBuildingTypes();
  assert(allTypes.length > 30, `Loaded ${allTypes.length} building types from TSV`);

  // Test 2: Verify structure
  const first = allTypes[0];
  const requiredFields = [
    "id", "name", "category", "parentTypeId", "description",
    "historicalPeriod", "regions", "structuralFeatures", "culturalFunction",
  ];
  const missingFields = requiredFields.filter((f) => !(f in first));
  assert(missingFields.length === 0, `All required fields present (missing: ${missingFields.join(", ")})`);

  // Test 3: Filter by category
  const military = await storage.getBuildingTypes({ category: "Military" });
  assert(military.length > 0, `Military category has ${military.length} types`);
  assert(
    military.every((t) => t.category === "Military"),
    "All filtered types are Military"
  );

  // Test 4: Get by ID
  const mosque = await storage.getBuildingTypeById("mosque");
  assert(mosque !== null, "Found mosque by ID");
  assert(mosque?.category === "Religious", `Mosque category is "${mosque?.category}"`);

  // Test 5: JSON array fields parsed correctly
  const hasArrays = allTypes.every(
    (t) => Array.isArray(t.regions) && Array.isArray(t.structuralFeatures)
  );
  assert(hasArrays, "All JSON array fields parsed correctly");
}

async function testArchitecturalStylesBuildingTypeLink() {
  console.log("\n=== Testing Architectural Styles <-> Building Types Link ===\n");

  const storage = new TsvStorage();

  // Test 1: Filter architectural styles by building type
  const templeStyles = await storage.getArchitecturalStylesByBuildingType("temple");
  assert(templeStyles.length > 0, `Found ${templeStyles.length} styles with "temple" building type`);
  assert(
    templeStyles.every((s) => s.buildingTypes.includes("temple")),
    "All filtered styles include temple building type"
  );

  // Test 2: Styles reference valid building types
  const allStyles = await storage.getArchitecturalStyles();
  const taxonomy = architecturalStylesScraper.getBuildingTypeTaxonomy();
  const validTypeIds = new Set(taxonomy.map((bt) => bt.id));

  let invalidRefs = 0;
  for (const style of allStyles) {
    for (const bt of style.buildingTypes) {
      if (!validTypeIds.has(bt)) {
        invalidRefs++;
      }
    }
  }
  assert(
    invalidRefs === 0,
    `All building type references in styles are valid (${invalidRefs} invalid)`
  );

  // Test 3: Multiple styles can share a building type
  const palaceStyles = await storage.getArchitecturalStylesByBuildingType("palace");
  assert(
    palaceStyles.length >= 2,
    `Multiple styles use "palace" building type (found ${palaceStyles.length})`
  );
}

async function testScraperState() {
  console.log("\n=== Testing Scraper State ===\n");

  // Test: Scraper rejects when no API key is set
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await architecturalStylesScraper.scrapeArchitecturalStyles();
    assert(false, "Should throw without GEMINI_API_KEY");
  } catch (e) {
    assert(
      (e as Error).message.includes("GEMINI_API_KEY"),
      "Throws missing API key error"
    );
  } finally {
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
  }
}

async function main() {
  console.log("=== Architectural Styles Scraper & Building Type Taxonomy Tests ===");

  await testBuildingTypeTaxonomy();
  await testBuildingTypesTSV();
  await testArchitecturalStylesBuildingTypeLink();
  await testScraperState();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
