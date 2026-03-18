/**
 * Tests for urheimat hypotheses TSV loader and API data access
 * Run with: npx tsx test/test-urheimat-hypotheses.ts
 */

import { TsvStorage } from "../server/tsv-storage";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

async function testUrheimatHypotheses() {
  console.log("=== Urheimat Hypotheses Tests ===\n");

  const storage = new TsvStorage();

  // Test: Load all hypotheses
  console.log("Loading all hypotheses...");
  const all = await storage.getUrheimatHypotheses();
  assert(all.length >= 20, `Should have at least 20 hypotheses (got ${all.length})`);

  // Test: Each hypothesis has required fields
  console.log("\nValidating hypothesis fields...");
  for (const h of all) {
    assert(!!h.id, `Hypothesis has id: ${h.id}`);
    assert(!!h.languageFamilyId, `${h.id} has languageFamilyId`);
    assert(!!h.hypothesisName, `${h.id} has hypothesisName`);
    assert(!!h.proposedRegion, `${h.id} has proposedRegion`);
    assert(typeof h.proposedCoordinates.lat === "number", `${h.id} has lat coordinate`);
    assert(typeof h.proposedCoordinates.lng === "number", `${h.id} has lng coordinate`);
    assert(typeof h.scholarlyConsensusLevel === "number", `${h.id} has consensus level`);
    assert(h.scholarlyConsensusLevel >= 0 && h.scholarlyConsensusLevel <= 1, `${h.id} consensus in [0,1]`);
    assert(Array.isArray(h.keyProponents), `${h.id} has keyProponents array`);
    assert(Array.isArray(h.sources), `${h.id} has sources array`);
    assert(Array.isArray(h.competingHypotheses), `${h.id} has competingHypotheses array`);
    assert(!!h.supportingEvidence.linguistic, `${h.id} has linguistic evidence`);
    assert(!!h.supportingEvidence.archaeological, `${h.id} has archaeological evidence`);
    assert(!!h.supportingEvidence.genetic, `${h.id} has genetic evidence`);
  }

  // Test: Filter by language family
  console.log("\nFiltering by language family...");
  const ieHypotheses = await storage.getUrheimatHypotheses({ languageFamilyId: "indo-european" });
  assert(ieHypotheses.length >= 2, `Should have multiple IE hypotheses (got ${ieHypotheses.length})`);
  assert(
    ieHypotheses.every((h) => h.languageFamilyId === "indo-european"),
    "All filtered results should be indo-european",
  );

  const aaHypotheses = await storage.getUrheimatHypotheses({ languageFamilyId: "afro-asiatic" });
  assert(aaHypotheses.length >= 2, `Should have multiple AA hypotheses (got ${aaHypotheses.length})`);

  // Test: Filter by consensus level
  console.log("\nFiltering by consensus level...");
  const highConsensus = await storage.getUrheimatHypotheses({ consensusMin: 0.8 });
  assert(highConsensus.length > 0, `Should have high-consensus hypotheses (got ${highConsensus.length})`);
  assert(
    highConsensus.every((h) => h.scholarlyConsensusLevel >= 0.8),
    "All high-consensus results should have consensus >= 0.8",
  );

  const lowConsensus = await storage.getUrheimatHypotheses({ consensusMin: 0.01 });
  assert(lowConsensus.length > highConsensus.length, "Lower threshold should return more results");

  // Test: Combined filters
  console.log("\nCombined filters...");
  const ieHighConsensus = await storage.getUrheimatHypotheses({
    languageFamilyId: "indo-european",
    consensusMin: 0.8,
  });
  assert(
    ieHighConsensus.length >= 1,
    `Should have at least 1 high-consensus IE hypothesis (got ${ieHighConsensus.length})`,
  );
  assert(
    ieHighConsensus.every((h) => h.languageFamilyId === "indo-european" && h.scholarlyConsensusLevel >= 0.8),
    "Combined filter results match both criteria",
  );

  // Test: Get by ID
  console.log("\nGet by ID...");
  const steppe = await storage.getUrheimatHypothesis("ie-steppe");
  assert(steppe !== null, "Should find ie-steppe hypothesis");
  assert(steppe!.hypothesisName === "Pontic-Caspian Steppe Hypothesis", "Correct hypothesis name");
  assert(steppe!.scholarlyConsensusLevel === 0.85, "Correct consensus level");
  assert(steppe!.competingHypotheses.includes("ie-anatolian"), "Competing hypotheses include Anatolian");

  const notFound = await storage.getUrheimatHypothesis("nonexistent");
  assert(notFound === null, "Should return null for nonexistent ID");

  // Test: GeoJSON boundary parsed correctly
  console.log("\nGeoJSON boundary parsing...");
  assert(steppe!.proposedBoundary.type === "Polygon", "Boundary should be a Polygon");
  assert(
    Array.isArray((steppe!.proposedBoundary as { coordinates: number[][][] }).coordinates),
    "Boundary should have coordinates array",
  );

  // Test: Supporting evidence structure
  console.log("\nSupporting evidence structure...");
  assert(steppe!.supportingEvidence.linguistic.length > 0, "Should have linguistic evidence");
  assert(steppe!.supportingEvidence.archaeological.length > 0, "Should have archaeological evidence");
  assert(steppe!.supportingEvidence.genetic.length > 0, "Should have genetic evidence");

  // Test: Taiwan hypothesis (high consensus)
  console.log("\nSpecific hypothesis checks...");
  const taiwan = await storage.getUrheimatHypothesis("an-taiwan");
  assert(taiwan !== null, "Should find Taiwan Austronesian hypothesis");
  assert(taiwan!.scholarlyConsensusLevel === 0.9, "Taiwan hypothesis should have 0.9 consensus");

  // Test: Nonexistent language family filter returns empty
  const noResults = await storage.getUrheimatHypotheses({ languageFamilyId: "nonexistent-family" });
  assert(noResults.length === 0, "Nonexistent family filter returns empty array");

  // Summary
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

testUrheimatHypotheses().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
