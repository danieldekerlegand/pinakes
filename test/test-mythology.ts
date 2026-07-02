/**
 * Test script for mythology TSV loaders and API
 * Run with: npx tsx test/test-mythology.ts
 */

import { TsvStorage } from "../server/tsv-storage";

async function testMythology() {
  console.log("=== Testing Mythology TSV Loaders ===\n");

  const storage = new TsvStorage();

  // Test: Load deities
  console.log("--- Deities ---");
  const allDeities = await storage.getDeities();
  console.log(`Total deities loaded: ${allDeities.length}`);

  if (allDeities.length === 0) {
    console.error("FAIL: No deities loaded");
    process.exit(1);
  }
  console.log(`PASS: ${allDeities.length} deities loaded`);

  // Test: Deity has expected fields
  const zeus = await storage.getDeity("zeus");
  if (!zeus) {
    console.error("FAIL: Zeus not found by ID");
    process.exit(1);
  }
  console.log(`PASS: Zeus found - ${zeus.name} (${zeus.mythology})`);

  if (zeus.mythology !== "greek") {
    console.error(`FAIL: Zeus mythology should be 'greek', got '${zeus.mythology}'`);
    process.exit(1);
  }
  console.log("PASS: Zeus mythology is 'greek'");

  if (!zeus.domain.includes("thunder")) {
    console.error(`FAIL: Zeus domains should include 'thunder', got ${JSON.stringify(zeus.domain)}`);
    process.exit(1);
  }
  console.log("PASS: Zeus has 'thunder' domain");

  if (!zeus.equivalentDeityIds.includes("jupiter")) {
    console.error("FAIL: Zeus should have Jupiter as equivalent");
    process.exit(1);
  }
  console.log("PASS: Zeus has Jupiter as equivalent");

  // Test: Filter by mythology
  const norseDeities = await storage.getDeities({ mythology: "norse" });
  console.log(`\nNorse deities: ${norseDeities.length}`);
  if (norseDeities.length < 2) {
    console.error("FAIL: Should have at least 2 Norse deities (Odin, Thor)");
    process.exit(1);
  }
  console.log("PASS: Norse deities filter works");

  // Test: Filter by domain
  const thunderGods = await storage.getDeities({ domain: "thunder" });
  console.log(`Thunder deities: ${thunderGods.length}`);
  if (thunderGods.length < 3) {
    console.error("FAIL: Should have at least 3 thunder deities (Zeus, Thor, Indra)");
    process.exit(1);
  }
  console.log("PASS: Domain filter works");

  // Test: Deity equivalents
  const zeusEquivalents = await storage.getDeityEquivalents("zeus");
  console.log(`\nZeus equivalents: ${zeusEquivalents.map((d) => d.name).join(", ")}`);
  if (zeusEquivalents.length === 0) {
    console.error("FAIL: Zeus should have equivalents");
    process.exit(1);
  }
  console.log("PASS: Deity equivalents loaded");

  // Test: Non-existent deity
  const notFound = await storage.getDeity("nonexistent");
  if (notFound !== null) {
    console.error("FAIL: Non-existent deity should return null");
    process.exit(1);
  }
  console.log("PASS: Non-existent deity returns null");

  // Test: Load myth motifs
  console.log("\n--- Myth Motifs ---");
  const allMotifs = await storage.getMythMotifs();
  console.log(`Total motifs loaded: ${allMotifs.length}`);

  if (allMotifs.length === 0) {
    console.error("FAIL: No motifs loaded");
    process.exit(1);
  }
  console.log(`PASS: ${allMotifs.length} motifs loaded`);

  // Test: Motif by ID
  const floodMyth = await storage.getMythMotif("flood-myth");
  if (!floodMyth) {
    console.error("FAIL: Flood myth not found");
    process.exit(1);
  }
  console.log(`PASS: Flood myth found - ${floodMyth.name}`);

  if (floodMyth.motifType !== "cosmogonic") {
    console.error(`FAIL: Flood myth type should be 'cosmogonic', got '${floodMyth.motifType}'`);
    process.exit(1);
  }
  console.log("PASS: Flood myth type is 'cosmogonic'");

  if (floodMyth.mythologyIds.length < 3) {
    console.error("FAIL: Flood myth should appear in at least 3 mythologies");
    process.exit(1);
  }
  console.log(`PASS: Flood myth appears in ${floodMyth.mythologyIds.length} mythologies`);

  // Test: Filter motifs by type
  const heroMotifs = await storage.getMythMotifs({ motifType: "hero" });
  console.log(`\nHero motifs: ${heroMotifs.length}`);
  if (heroMotifs.length === 0) {
    console.error("FAIL: Should have hero motifs");
    process.exit(1);
  }
  console.log("PASS: Motif type filter works");

  // Test: Filter motifs by mythology
  const greekMotifs = await storage.getMythMotifs({ mythology: "greek" });
  console.log(`Greek motifs: ${greekMotifs.length}`);
  if (greekMotifs.length === 0) {
    console.error("FAIL: Should have Greek motifs");
    process.exit(1);
  }
  console.log("PASS: Motif mythology filter works");

  // Test: Motifs by deity
  const zeusMotifs = await storage.getMotifsByDeity("zeus");
  console.log(`\nMotifs for Zeus: ${zeusMotifs.length}`);
  if (zeusMotifs.length === 0) {
    console.error("FAIL: Zeus should have associated motifs");
    process.exit(1);
  }
  console.log("PASS: Motifs by deity works");

  // Test: Coordinates parsing
  console.log("\n--- Data Integrity ---");
  for (const deity of allDeities) {
    if (deity.coordinates.lat === 0 && deity.coordinates.lng === 0) {
      console.error(`FAIL: Deity '${deity.id}' has zero coordinates`);
      process.exit(1);
    }
  }
  console.log("PASS: All deities have valid coordinates");

  // Test: All deities have descriptions
  for (const deity of allDeities) {
    if (!deity.description) {
      console.error(`FAIL: Deity '${deity.id}' missing description`);
      process.exit(1);
    }
  }
  console.log("PASS: All deities have descriptions");

  // Test: Non-existent motif
  const noMotif = await storage.getMythMotif("nonexistent");
  if (noMotif !== null) {
    console.error("FAIL: Non-existent motif should return null");
    process.exit(1);
  }
  console.log("PASS: Non-existent motif returns null");

  console.log("\n=== All Mythology Tests Passed! ===");
}

testMythology().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
