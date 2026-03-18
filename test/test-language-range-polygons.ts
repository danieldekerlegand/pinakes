/**
 * Test script for language range polygons TSV loader and API
 * Run with: npx tsx test/test-language-range-polygons.ts
 */

import { TsvStorage } from "../server/tsv-storage";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function testLanguageRangePolygonsLoader() {
  console.log("=== Testing Language Range Polygons TSV Loader ===\n");

  const storage = new TsvStorage();

  // Test 1: Basic loading
  console.log("1. Basic loading");
  const allFeatures = await storage.getLanguageRangePolygons();
  assert(allFeatures.length > 0, `Loaded ${allFeatures.length} language range polygons`);
  assert(allFeatures.length >= 20, `Has at least 20 polygons (got ${allFeatures.length})`);

  // Test 2: Feature structure
  console.log("\n2. Feature structure validation");
  const first = allFeatures[0];
  assert(first.type === "Feature", "Feature type is 'Feature'");
  assert(typeof first.id === "string" && first.id.length > 0, "Feature has a non-empty id");
  assert(
    first.geometry.type === "Polygon" || first.geometry.type === "MultiPolygon",
    `Geometry type is Polygon or MultiPolygon (got ${first.geometry.type})`
  );
  assert(typeof first.properties.languageId === "string", "Has languageId property");
  assert(typeof first.properties.familyId === "string", "Has familyId property");
  assert(
    ["current", "historical", "reconstructed"].includes(first.properties.rangeType),
    `rangeType is valid (got ${first.properties.rangeType})`
  );
  assert(typeof first.properties.timePeriod.start === "number", "timePeriod.start is a number");
  assert(
    first.properties.timePeriod.end === null || typeof first.properties.timePeriod.end === "number",
    "timePeriod.end is null or number"
  );
  assert(typeof first.properties.confidence === "number", "confidence is a number");
  assert(Array.isArray(first.properties.sources), "sources is an array");

  // Test 3: Geometry validation
  console.log("\n3. Geometry validation");
  const polygons = allFeatures.filter((f) => f.geometry.type === "Polygon");
  const multiPolygons = allFeatures.filter((f) => f.geometry.type === "MultiPolygon");
  assert(polygons.length > 0, `Has ${polygons.length} Polygon features`);
  assert(multiPolygons.length > 0, `Has ${multiPolygons.length} MultiPolygon features`);

  for (const f of allFeatures) {
    if (f.geometry.type === "Polygon") {
      assert(
        Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length > 0,
        `Polygon ${f.id} has valid coordinates`
      );
    } else if (f.geometry.type === "MultiPolygon") {
      assert(
        Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length > 0,
        `MultiPolygon ${f.id} has valid coordinates`
      );
    }
  }

  // Test 4: Temporal filtering
  console.log("\n4. Temporal filtering");
  const historicalOnly = await storage.getLanguageRangePolygons({
    timeStart: -800,
    timeEnd: -100,
  });
  assert(historicalOnly.length > 0, `Found ${historicalOnly.length} features for 800-100 BCE`);
  assert(
    historicalOnly.length < allFeatures.length,
    "Temporal filter reduces result count"
  );

  // Verify all results are within the time window
  for (const f of historicalOnly) {
    const { start, end } = f.properties.timePeriod;
    const featureEnd = end ?? 2026;
    const overlaps = start <= -100 && featureEnd >= -800;
    assert(overlaps, `Feature ${f.id} (${start} to ${end ?? "present"}) overlaps 800-100 BCE`);
  }

  // Test 5: Family filtering
  console.log("\n5. Family filtering");
  const ieOnly = await storage.getLanguageRangePolygons({
    familyIds: ["indo-european"],
  });
  assert(ieOnly.length > 0, `Found ${ieOnly.length} Indo-European features`);
  for (const f of ieOnly) {
    assert(
      f.properties.familyId === "indo-european",
      `Feature ${f.id} is Indo-European`
    );
  }

  const afroAsiaticOnly = await storage.getLanguageRangePolygons({
    familyIds: ["afro-asiatic"],
  });
  assert(afroAsiaticOnly.length > 0, `Found ${afroAsiaticOnly.length} Afro-Asiatic features`);

  // Test 6: Range type filtering
  console.log("\n6. Range type filtering");
  const currentOnly = await storage.getLanguageRangePolygons({
    rangeType: "current",
  });
  assert(currentOnly.length > 0, `Found ${currentOnly.length} current-range features`);
  for (const f of currentOnly) {
    assert(f.properties.rangeType === "current", `Feature ${f.id} is current range`);
  }

  const historicalType = await storage.getLanguageRangePolygons({
    rangeType: "historical",
  });
  assert(historicalType.length > 0, `Found ${historicalType.length} historical-range features`);

  // Test 7: Combined filters
  console.log("\n7. Combined filters");
  const combinedFilters = await storage.getLanguageRangePolygons({
    familyIds: ["indo-european"],
    rangeType: "historical",
  });
  assert(combinedFilters.length > 0, `Found ${combinedFilters.length} IE historical features`);
  for (const f of combinedFilters) {
    assert(
      f.properties.familyId === "indo-european" && f.properties.rangeType === "historical",
      `Feature ${f.id} matches both filters`
    );
  }

  // Test 8: Empty filter returns nothing matching
  console.log("\n8. Edge cases");
  const noFamily = await storage.getLanguageRangePolygons({
    familyIds: ["nonexistent-family"],
  });
  assert(noFamily.length === 0, "Filtering by nonexistent family returns empty");

  const noRangeType = await storage.getLanguageRangePolygons({
    rangeType: "reconstructed",
  });
  // This is fine whether it returns 0 or more
  assert(typeof noRangeType.length === "number", `Reconstructed filter returned ${noRangeType.length} features`);

  // Test 9: Confidence values
  console.log("\n9. Confidence values");
  for (const f of allFeatures) {
    assert(
      f.properties.confidence >= 1 && f.properties.confidence <= 100,
      `Feature ${f.id} confidence ${f.properties.confidence} is in range 1-100`
    );
  }

  // Test 10: Unique IDs
  console.log("\n10. Unique IDs");
  const ids = allFeatures.map((f) => f.id);
  const uniqueIds = new Set(ids);
  assert(ids.length === uniqueIds.size, `All ${ids.length} features have unique IDs`);

  // Summary
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) {
    process.exit(1);
  }
}

testLanguageRangePolygonsLoader().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
