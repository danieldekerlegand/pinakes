/**
 * Test script for urheimat hypotheses TSV loading and API
 * Run with: npx tsx test/test-urheimat-hypotheses.ts
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

async function testUrheimatHypotheses() {
  console.log("=== Testing Urheimat Hypotheses ===\n");

  const storage = new TsvStorage();

  // Test 1: Load all hypotheses
  console.log("1. Loading all hypotheses...");
  const allHypotheses = await storage.getUrheimatHypotheses();
  assert(allHypotheses.length > 0, `Loaded ${allHypotheses.length} hypotheses (expected > 0)`);
  assert(allHypotheses.length >= 30, `Has at least 30 entries (got ${allHypotheses.length})`);

  // Test 2: Check required fields on first entry
  console.log("\n2. Checking required fields...");
  const first = allHypotheses[0];
  assert(typeof first.id === "string" && first.id.length > 0, "id is non-empty string");
  assert(typeof first.languageFamilyId === "string" && first.languageFamilyId.length > 0, "languageFamilyId is non-empty string");
  assert(typeof first.hypothesisName === "string" && first.hypothesisName.length > 0, "hypothesisName is non-empty string");
  assert(typeof first.proposedRegion === "string" && first.proposedRegion.length > 0, "proposedRegion is non-empty string");
  assert(typeof first.proposedCoordinates === "object", "proposedCoordinates is an object");
  assert(typeof first.proposedCoordinates.lat === "number", "proposedCoordinates.lat is a number");
  assert(typeof first.proposedCoordinates.lng === "number", "proposedCoordinates.lng is a number");
  assert(typeof first.proposedBoundary === "object", "proposedBoundary is an object");
  assert((first.proposedBoundary as any).type === "Polygon", "proposedBoundary.type is Polygon");
  assert(typeof first.scholarlyConsensusLevel === "number", "scholarlyConsensusLevel is a number");
  assert(first.scholarlyConsensusLevel >= 0 && first.scholarlyConsensusLevel <= 100, `scholarlyConsensusLevel in range 0-100 (got ${first.scholarlyConsensusLevel})`);
  assert(Array.isArray(first.keyProponents), "keyProponents is an array");
  assert(Array.isArray(first.sources), "sources is an array");

  // Test 3: Check supporting evidence structure
  console.log("\n3. Checking supporting evidence structure...");
  assert(typeof first.supportingEvidence === "object", "supportingEvidence is an object");
  assert(Array.isArray(first.supportingEvidence.linguistic), "supportingEvidence.linguistic is an array");
  assert(Array.isArray(first.supportingEvidence.archaeological), "supportingEvidence.archaeological is an array");
  assert(Array.isArray(first.supportingEvidence.genetic), "supportingEvidence.genetic is an array");
  assert(first.supportingEvidence.linguistic.length > 0, "Has linguistic evidence");
  assert(first.supportingEvidence.archaeological.length > 0, "Has archaeological evidence");
  assert(first.supportingEvidence.genetic.length > 0, "Has genetic evidence");

  // Test 4: Check competing hypotheses
  console.log("\n4. Checking competing hypotheses...");
  const ieSteppe = allHypotheses.find((h) => h.id === "ie-steppe");
  assert(ieSteppe !== undefined, "Found Indo-European Steppe Hypothesis");
  if (ieSteppe) {
    assert(Array.isArray(ieSteppe.competingHypotheses), "competingHypotheses is an array");
    assert(ieSteppe.competingHypotheses.length > 0, `Has ${ieSteppe.competingHypotheses.length} competing hypothesis(es)`);
    assert(ieSteppe.competingHypotheses.includes("ie-anatolian"), "Steppe competes with Anatolian");
  }

  // Test 5: Filter by language family
  console.log("\n5. Testing language family filter...");
  const ieHypotheses = await storage.getUrheimatHypotheses({ languageFamily: "indo_european__indo_european" });
  assert(ieHypotheses.length >= 2, `Found ${ieHypotheses.length} IE hypotheses (expected >= 2)`);
  assert(ieHypotheses.every((h) => h.languageFamilyId === "indo_european__indo_european"), "All filtered results are IE");

  // Test 6: Filter by consensus minimum
  console.log("\n6. Testing consensus minimum filter...");
  const highConsensus = await storage.getUrheimatHypotheses({ consensusMin: 70 });
  assert(highConsensus.length > 0, `Found ${highConsensus.length} high-consensus hypotheses`);
  assert(highConsensus.every((h) => h.scholarlyConsensusLevel >= 70), "All results have consensus >= 70");

  // Test 7: Get by ID
  console.log("\n7. Testing get by ID...");
  const steppe = await storage.getUrheimatHypothesisById("ie-steppe");
  assert(steppe !== null, "Found hypothesis by ID 'ie-steppe'");
  if (steppe) {
    assert(steppe.hypothesisName === "Steppe Hypothesis", `Name is 'Steppe Hypothesis' (got '${steppe.hypothesisName}')`);
    assert(steppe.scholarlyConsensusLevel === 85, `Consensus is 85 (got ${steppe.scholarlyConsensusLevel})`);
  }

  const notFound = await storage.getUrheimatHypothesisById("nonexistent");
  assert(notFound === null, "Returns null for nonexistent ID");

  // Test 8: Time ranges
  console.log("\n8. Checking time ranges...");
  const withTimeRanges = allHypotheses.filter((h) => h.timeRangeStart !== null && h.timeRangeEnd !== null);
  assert(withTimeRanges.length > 0, `${withTimeRanges.length} hypotheses have time ranges`);
  for (const h of withTimeRanges.slice(0, 5)) {
    assert(h.timeRangeStart! < h.timeRangeEnd!, `${h.id}: start (${h.timeRangeStart}) < end (${h.timeRangeEnd})`);
  }

  // Test 9: GeoJSON boundary coordinates are valid
  console.log("\n9. Checking GeoJSON boundary validity...");
  for (const h of allHypotheses.slice(0, 10)) {
    const boundary = h.proposedBoundary as any;
    assert(boundary.type === "Polygon", `${h.id}: boundary is Polygon`);
    assert(Array.isArray(boundary.coordinates), `${h.id}: has coordinates array`);
    assert(boundary.coordinates[0].length >= 4, `${h.id}: polygon ring has >= 4 points (got ${boundary.coordinates[0].length})`);
    // First and last coordinate should be the same (closed ring)
    const ring = boundary.coordinates[0];
    assert(
      ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1],
      `${h.id}: polygon ring is closed`
    );
  }

  // Test 10: Coverage of major language families
  console.log("\n10. Checking coverage of major language families...");
  const familyIds = new Set(allHypotheses.map((h) => h.languageFamilyId));
  const expectedFamilies = [
    "indo_european__indo_european",
    "afro_asiatic__afro_asiatic",
    "austronesian__austronesian",
    "sino_tibetan__sino_tibetan",
  ];
  for (const fam of expectedFamilies) {
    assert(familyIds.has(fam), `Covers ${fam}`);
  }

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

testUrheimatHypotheses().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
