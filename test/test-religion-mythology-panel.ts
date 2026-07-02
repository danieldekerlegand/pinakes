/**
 * Test script for Religion & Mythology panel data layer
 * Verifies that all three data sources (religions, deities, myth-motifs)
 * load correctly and expose the fields needed by the panel component.
 *
 * Run with: npx tsx test/test-religion-mythology-panel.ts
 */

import { TsvStorage } from "../server/tsv-storage";

async function testReligionMythologyPanel() {
  console.log("=== Testing Religion & Mythology Panel Data ===\n");

  const storage = new TsvStorage();

  // ── Religions ────────────────────────────────────────────────────────────

  console.log("--- Religions ---");
  const religions = await storage.getReligions();
  console.log(`Total religions loaded: ${religions.length}`);

  if (religions.length === 0) {
    console.error("FAIL: No religions loaded");
    process.exit(1);
  }
  console.log(`PASS: ${religions.length} religions loaded`);

  // Verify unique IDs
  const religionIds = religions.map((r) => r.id);
  const uniqueReligionIds = new Set(religionIds);
  if (uniqueReligionIds.size !== religionIds.length) {
    console.error("FAIL: Duplicate religion IDs found");
    process.exit(1);
  }
  console.log("PASS: All religion IDs are unique");

  // Verify required fields for panel rendering
  for (const religion of religions) {
    if (!religion.name) {
      console.error(`FAIL: Religion '${religion.id}' missing name`);
      process.exit(1);
    }
    if (!religion.religionType) {
      console.error(`FAIL: Religion '${religion.id}' missing religionType`);
      process.exit(1);
    }
    if (!religion.originRegion) {
      console.error(`FAIL: Religion '${religion.id}' missing originRegion`);
      process.exit(1);
    }
    if (!religion.coordinates || (religion.coordinates.lat === 0 && religion.coordinates.lng === 0)) {
      console.error(`FAIL: Religion '${religion.id}' has invalid coordinates`);
      process.exit(1);
    }
  }
  console.log("PASS: All religions have required fields (name, type, region, coordinates)");

  // Verify filter by type
  const religionTypes = new Set(religions.map((r) => r.religionType));
  console.log(`Religion types found: ${Array.from(religionTypes).join(", ")}`);
  if (religionTypes.size < 2) {
    console.error("FAIL: Should have at least 2 distinct religion types");
    process.exit(1);
  }
  console.log("PASS: Multiple religion types available for filtering");

  const firstType = Array.from(religionTypes)[0];
  const filteredReligions = await storage.getReligions({ religionType: firstType });
  if (filteredReligions.length === 0) {
    console.error(`FAIL: Filter by type '${firstType}' returned no results`);
    process.exit(1);
  }
  if (filteredReligions.some((r) => r.religionType !== firstType)) {
    console.error("FAIL: Religion type filter returned wrong types");
    process.exit(1);
  }
  console.log(`PASS: Religion type filter works (${firstType}: ${filteredReligions.length} results)`);

  // Verify single religion lookup
  const firstReligion = await storage.getReligion(religions[0].id);
  if (!firstReligion) {
    console.error("FAIL: Could not look up religion by ID");
    process.exit(1);
  }
  console.log(`PASS: Single religion lookup works (${firstReligion.name})`);

  // Verify array fields parse correctly
  const religionWithTexts = religions.find((r) => r.sacredTexts.length > 0);
  if (!religionWithTexts) {
    console.error("FAIL: No religion has sacred texts (array field parsing may be broken)");
    process.exit(1);
  }
  console.log(`PASS: Array fields parse correctly (${religionWithTexts.name} has ${religionWithTexts.sacredTexts.length} sacred texts)`);

  // ── Deities ──────────────────────────────────────────────────────────────

  console.log("\n--- Deities ---");
  const deities = await storage.getDeities();
  console.log(`Total deities loaded: ${deities.length}`);

  if (deities.length === 0) {
    console.error("FAIL: No deities loaded");
    process.exit(1);
  }
  console.log(`PASS: ${deities.length} deities loaded`);

  // Verify unique IDs
  const deityIds = deities.map((d) => d.id);
  const uniqueDeityIds = new Set(deityIds);
  if (uniqueDeityIds.size !== deityIds.length) {
    console.error("FAIL: Duplicate deity IDs found");
    process.exit(1);
  }
  console.log("PASS: All deity IDs are unique");

  // Verify required fields
  for (const deity of deities) {
    if (!deity.name) {
      console.error(`FAIL: Deity '${deity.id}' missing name`);
      process.exit(1);
    }
    if (!deity.mythology) {
      console.error(`FAIL: Deity '${deity.id}' missing mythology`);
      process.exit(1);
    }
    if (!deity.domain || deity.domain.length === 0) {
      console.error(`FAIL: Deity '${deity.id}' missing domains`);
      process.exit(1);
    }
  }
  console.log("PASS: All deities have required fields (name, mythology, domain)");

  // Verify mythology filter
  const mythologies = new Set(deities.map((d) => d.mythology));
  console.log(`Mythologies found: ${Array.from(mythologies).join(", ")}`);
  if (mythologies.size < 3) {
    console.error("FAIL: Should have at least 3 distinct mythologies");
    process.exit(1);
  }
  console.log("PASS: Multiple mythologies available for filtering");

  const firstMyth = Array.from(mythologies)[0];
  const filteredDeities = await storage.getDeities({ mythology: firstMyth });
  if (filteredDeities.length === 0) {
    console.error(`FAIL: Filter by mythology '${firstMyth}' returned no results`);
    process.exit(1);
  }
  console.log(`PASS: Mythology filter works (${firstMyth}: ${filteredDeities.length} results)`);

  // ── Myth Motifs ──────────────────────────────────────────────────────────

  console.log("\n--- Myth Motifs ---");
  const motifs = await storage.getMythMotifs();
  console.log(`Total motifs loaded: ${motifs.length}`);

  if (motifs.length === 0) {
    console.error("FAIL: No motifs loaded");
    process.exit(1);
  }
  console.log(`PASS: ${motifs.length} motifs loaded`);

  // Verify unique IDs
  const motifIds = motifs.map((m) => m.id);
  const uniqueMotifIds = new Set(motifIds);
  if (uniqueMotifIds.size !== motifIds.length) {
    console.error("FAIL: Duplicate motif IDs found");
    process.exit(1);
  }
  console.log("PASS: All motif IDs are unique");

  // Verify required fields
  for (const motif of motifs) {
    if (!motif.name) {
      console.error(`FAIL: Motif '${motif.id}' missing name`);
      process.exit(1);
    }
    if (!motif.description) {
      console.error(`FAIL: Motif '${motif.id}' missing description`);
      process.exit(1);
    }
  }
  console.log("PASS: All motifs have required fields (name, description)");

  // Verify motif type filter
  const motifTypes = new Set(motifs.map((m) => m.motifType).filter(Boolean));
  if (motifTypes.size > 0) {
    const firstMotifType = Array.from(motifTypes)[0];
    const filteredMotifs = await storage.getMythMotifs({ motifType: firstMotifType });
    if (filteredMotifs.length === 0) {
      console.error(`FAIL: Filter by motif type '${firstMotifType}' returned no results`);
      process.exit(1);
    }
    console.log(`PASS: Motif type filter works (${firstMotifType}: ${filteredMotifs.length} results)`);
  }

  // ── Cross-references ─────────────────────────────────────────────────────

  console.log("\n--- Cross-references ---");

  // Verify deity-religion linkage
  const deitiesWithEquivalents = deities.filter((d) => d.equivalentDeityIds.length > 0);
  console.log(`Deities with equivalents: ${deitiesWithEquivalents.length}`);
  if (deitiesWithEquivalents.length === 0) {
    console.error("FAIL: No deities have equivalents (syncretism links)");
    process.exit(1);
  }
  console.log("PASS: Cross-cultural deity equivalents exist");

  // Verify motif cross-references (deity or mythology links)
  const motifsWithLinks = motifs.filter((m) => m.mythologyIds.length > 0 || m.associatedDeityIds.length > 0);
  console.log(`Motifs with cross-references: ${motifsWithLinks.length}`);
  if (motifsWithLinks.length === 0) {
    console.error("FAIL: No motifs have any cross-references (deity or mythology links)");
    process.exit(1);
  }
  console.log("PASS: Motif cross-references exist");

  // ── Timeline data integrity ──────────────────────────────────────────────

  console.log("\n--- Timeline Data Integrity ---");

  // Check that religions with timeOrigin have sensible values
  const religionsWithDates = religions.filter((r) => r.timeOrigin !== null);
  console.log(`Religions with dates: ${religionsWithDates.length}/${religions.length}`);
  for (const r of religionsWithDates) {
    if (r.timeOrigin! < -100000 || r.timeOrigin! > 2100) {
      console.error(`FAIL: Religion '${r.id}' has out-of-range timeOrigin: ${r.timeOrigin}`);
      process.exit(1);
    }
    if (r.timeEnd !== null && r.timeEnd < r.timeOrigin!) {
      console.error(`FAIL: Religion '${r.id}' has timeEnd (${r.timeEnd}) before timeOrigin (${r.timeOrigin})`);
      process.exit(1);
    }
  }
  console.log("PASS: All religion dates are sensible");

  const deitiesWithDates = deities.filter((d) => d.timeOrigin !== null);
  console.log(`Deities with dates: ${deitiesWithDates.length}/${deities.length}`);
  for (const d of deitiesWithDates) {
    if (d.timeOrigin! < -100000 || d.timeOrigin! > 2100) {
      console.error(`FAIL: Deity '${d.id}' has out-of-range timeOrigin: ${d.timeOrigin}`);
      process.exit(1);
    }
  }
  console.log("PASS: All deity dates are sensible");

  console.log("\n=== All Religion & Mythology Panel Tests Passed! ===");
}

testReligionMythologyPanel().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
