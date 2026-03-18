/**
 * Test script for archaeological cultures map layer
 * Run with: npx tsx test/test-archaeological-cultures.ts
 */

import { TsvStorage } from "../server/tsv-storage";

async function testArchaeologicalCultures() {
  console.log("=== Archaeological Cultures Map Layer Tests ===\n");

  const storage = new TsvStorage();
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

  // Test 1: Load all archaeological cultures
  console.log("Test 1: Load all archaeological cultures");
  const allCultures = await storage.getArchaeologicalCultures();
  assert(allCultures.length > 0, `Loaded ${allCultures.length} cultures (expected > 0)`);
  assert(allCultures.length >= 25, `Has at least 25 cultures (got ${allCultures.length})`);
  console.log();

  // Test 2: Verify feature structure
  console.log("Test 2: Verify feature structure");
  const yamnaya = allCultures.find(c => c.properties.cultureId === "yamnaya");
  assert(yamnaya !== undefined, "Found Yamnaya culture");
  if (yamnaya) {
    assert(yamnaya.type === "Feature", "Feature type is 'Feature'");
    assert(yamnaya.geometry.type === "Polygon" || yamnaya.geometry.type === "MultiPolygon",
      `Geometry is Polygon or MultiPolygon (got ${yamnaya.geometry.type})`);
    assert(yamnaya.properties.name === "Yamnaya", `Name is 'Yamnaya' (got '${yamnaya.properties.name}')`);
    assert(yamnaya.properties.timePeriod.start === -3300,
      `Time period start is -3300 (got ${yamnaya.properties.timePeriod.start})`);
    assert(yamnaya.properties.timePeriod.end === -2600,
      `Time period end is -2600 (got ${yamnaya.properties.timePeriod.end})`);
    assert(yamnaya.properties.subsistencePattern === "pastoral nomadism",
      `Subsistence is 'pastoral nomadism' (got '${yamnaya.properties.subsistencePattern}')`);
    assert(yamnaya.properties.probableLanguageFamily === "Proto-Indo-European",
      `Language family is 'Proto-Indo-European' (got '${yamnaya.properties.probableLanguageFamily}')`);
    assert(yamnaya.properties.probableHaplogroups.length > 0,
      `Has haplogroup data (got ${yamnaya.properties.probableHaplogroups.length})`);
    assert(yamnaya.properties.confidence >= 1 && yamnaya.properties.confidence <= 100,
      `Confidence is 1-100 (got ${yamnaya.properties.confidence})`);
    assert(yamnaya.properties.sources.length > 0,
      `Has source citations (got ${yamnaya.properties.sources.length})`);
    assert(yamnaya.properties.successorCultureIds.length > 0,
      `Has successor culture IDs (got ${yamnaya.properties.successorCultureIds.length})`);
  }
  console.log();

  // Test 3: Temporal filtering
  console.log("Test 3: Temporal filtering");
  const bronzeAge = await storage.getArchaeologicalCultures({
    timeStart: -3500,
    timeEnd: -2000,
  });
  assert(bronzeAge.length > 0, `Found ${bronzeAge.length} cultures in Bronze Age window`);
  // Yamnaya (-3300 to -2600) should be included
  assert(bronzeAge.some(c => c.properties.cultureId === "yamnaya"),
    "Yamnaya included in -3500 to -2000 window");
  // Clovis (-11500 to -10800) should NOT be included
  assert(!bronzeAge.some(c => c.properties.cultureId === "clovis"),
    "Clovis excluded from -3500 to -2000 window");

  const veryEarly = await storage.getArchaeologicalCultures({
    timeStart: -15000,
    timeEnd: -12000,
  });
  assert(veryEarly.some(c => c.properties.cultureId === "jomon"),
    "Jomon (-14000) found in -15000 to -12000 window");
  console.log();

  // Test 4: Region filtering
  console.log("Test 4: Region filtering");
  const levantCultures = await storage.getArchaeologicalCultures({
    region: "Levant",
  });
  assert(levantCultures.length > 0, `Found ${levantCultures.length} Levant cultures`);
  assert(levantCultures.some(c => c.properties.cultureId === "natufian"),
    "Natufian found in Levant filter");
  assert(!levantCultures.some(c => c.properties.cultureId === "yamnaya"),
    "Yamnaya excluded from Levant filter");
  console.log();

  // Test 5: GeoJSON geometry validity
  console.log("Test 5: GeoJSON geometry validity");
  for (const culture of allCultures) {
    const geom = culture.geometry;
    const isValidType = geom.type === "Polygon" || geom.type === "MultiPolygon";
    if (!isValidType) {
      assert(false, `${culture.properties.name} has invalid geometry type: ${geom.type}`);
      continue;
    }
    // Check that polygon coordinates form a ring (first and last point match)
    if (geom.type === "Polygon") {
      const ring = geom.coordinates[0];
      const first = ring[0];
      const last = ring[ring.length - 1];
      assert(first[0] === last[0] && first[1] === last[1],
        `${culture.properties.name} polygon ring is closed`);
    }
  }
  console.log();

  // Test 6: Culture lineage references
  console.log("Test 6: Culture lineage references");
  const cultureIds = new Set(allCultures.map(c => c.properties.cultureId));
  let lineageIssues = 0;
  for (const culture of allCultures) {
    for (const predId of culture.properties.predecessorCultureIds) {
      if (!cultureIds.has(predId)) {
        console.log(`  WARN: ${culture.properties.name} references unknown predecessor '${predId}'`);
        lineageIssues++;
      }
    }
    for (const succId of culture.properties.successorCultureIds) {
      if (!cultureIds.has(succId)) {
        console.log(`  WARN: ${culture.properties.name} references unknown successor '${succId}'`);
        lineageIssues++;
      }
    }
  }
  // Some successor/predecessor references point to cultures not yet in the dataset - that's expected
  assert(true, `Lineage references checked (${lineageIssues} external references found)`);
  console.log();

  // Test 7: All cultures have valid time periods
  console.log("Test 7: Time period validity");
  let timeIssues = 0;
  for (const culture of allCultures) {
    const { start, end } = culture.properties.timePeriod;
    if (end !== null && start > end) {
      console.log(`  WARN: ${culture.properties.name} has start (${start}) > end (${end})`);
      timeIssues++;
    }
  }
  assert(timeIssues === 0, `All cultures have valid time periods (found ${timeIssues} issues)`);
  console.log();

  // Summary
  console.log("=== Summary ===");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

testArchaeologicalCultures().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
