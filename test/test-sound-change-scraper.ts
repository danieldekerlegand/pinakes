/**
 * Test script for sound change rules scraper
 * Run with: npx tsx test/test-sound-change-scraper.ts
 */

import fs from "node:fs";
import path from "node:path";
import { TsvStorage } from "../server/tsv-storage";
import { SoundChangeScraper } from "../server/services/sound-change-scraper";

async function testSoundChangeScraper() {
  console.log("=== Sound Change Rules Scraper Tests ===\n");

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

  // Test 1: Load existing sound changes from TSV
  console.log("Test 1: Load existing sound changes from TSV");
  const allChanges = await storage.getSoundChanges();
  assert(allChanges.length > 0, `Loaded ${allChanges.length} sound changes (expected > 0)`);
  assert(allChanges.length >= 20, `Has at least 20 sound changes (got ${allChanges.length})`);
  console.log();

  // Test 2: Verify sound change structure
  console.log("Test 2: Verify sound change structure");
  const grimm = allChanges.find((c) => c.id === "sc001");
  assert(grimm !== undefined, "Found Grimm's Law (sc001)");
  if (grimm) {
    assert(grimm.name.includes("Grimm"), `Name contains 'Grimm' (got '${grimm.name}')`);
    assert(grimm.familyId === "indo_european__germanic", `Family is indo_european__germanic`);
    assert(grimm.changeRule.includes("→"), `Change rule contains '→' (got '${grimm.changeRule}')`);
    assert(grimm.examples.length > 0, `Has examples (got ${grimm.examples.length})`);
    assert(grimm.examples[0].before !== undefined, "Example has 'before' field");
    assert(grimm.examples[0].after !== undefined, "Example has 'after' field");
    assert(grimm.examples[0].meaning !== undefined, "Example has 'meaning' field");
    assert(grimm.relatedChanges.length > 0, `Has related changes (got ${grimm.relatedChanges.length})`);
    assert(grimm.dateRange !== "", `Has date range (got '${grimm.dateRange}')`);
    assert(grimm.environment !== "", `Has environment (got '${grimm.environment}')`);
  }
  console.log();

  // Test 3: Filter by family
  console.log("Test 3: Filter by family");
  const germanicChanges = await storage.getSoundChanges("indo_european__germanic");
  assert(germanicChanges.length > 0, `Found Germanic changes (got ${germanicChanges.length})`);
  assert(
    germanicChanges.every((c) => c.familyId === "indo_european__germanic"),
    "All filtered changes belong to indo_european__germanic",
  );
  console.log();

  // Test 4: Filter by source language
  console.log("Test 4: Filter by source language");
  const latinSourceChanges = await storage.getSoundChanges(undefined, "lat");
  assert(latinSourceChanges.length > 0, `Found changes from Latin (got ${latinSourceChanges.length})`);
  assert(
    latinSourceChanges.every((c) => c.sourceLanguageId === "lat"),
    "All filtered changes have Latin as source",
  );
  console.log();

  // Test 5: Filter by target language
  console.log("Test 5: Filter by target language");
  const englishTargetChanges = await storage.getSoundChanges(undefined, undefined, "eng");
  assert(englishTargetChanges.length > 0, `Found changes targeting English (got ${englishTargetChanges.length})`);
  assert(
    englishTargetChanges.every((c) => c.targetLanguageId === "eng"),
    "All filtered changes have English as target",
  );
  console.log();

  // Test 6: Get sound change by ID
  console.log("Test 6: Get sound change by ID");
  const sc005 = await storage.getSoundChangeById("sc005");
  assert(sc005 !== null, "Found sound change sc005");
  if (sc005) {
    assert(sc005.name.includes("Great Vowel Shift"), `sc005 is Great Vowel Shift (got '${sc005.name}')`);
  }
  const notFound = await storage.getSoundChangeById("sc999");
  assert(notFound === null, "Returns null for non-existent ID");
  console.log();

  // Test 7: Scraper class instantiation and existing data loading
  console.log("Test 7: Scraper class instantiation");
  const scraper = new SoundChangeScraper();
  assert(scraper !== undefined, "Scraper instantiated successfully");
  console.log();

  // Test 8: Verify TSV file format
  console.log("Test 8: Verify TSV file format");
  const tsvPath = "data/source/lexicons/sound-changes.tsv";
  assert(fs.existsSync(tsvPath), "sound-changes.tsv file exists");
  const content = fs.readFileSync(tsvPath, "utf8");
  const lines = content.split("\n").filter((l) => l.trim() !== "");
  assert(lines.length > 1, `TSV has header + data rows (got ${lines.length} lines)`);
  const headers = lines[0].split("\t");
  const expectedHeaders = [
    "id", "name", "family_id", "source_language_id", "target_language_id",
    "change_rule", "environment", "date_range", "examples", "related_changes",
  ];
  assert(
    expectedHeaders.every((h) => headers.includes(h)),
    `TSV has all expected headers`,
  );
  console.log();

  // Test 9: Verify data integrity - examples are valid JSON
  console.log("Test 9: Verify data integrity - JSON fields");
  let jsonValid = true;
  const exIdx = headers.indexOf("examples");
  const relIdx = headers.indexOf("related_changes");
  for (let i = 1; i < Math.min(lines.length, 20); i++) {
    const cols = lines[i].split("\t");
    try {
      const examples = JSON.parse(cols[exIdx]);
      if (!Array.isArray(examples)) jsonValid = false;
    } catch {
      jsonValid = false;
    }
    try {
      const related = JSON.parse(cols[relIdx]);
      if (!Array.isArray(related)) jsonValid = false;
    } catch {
      jsonValid = false;
    }
  }
  assert(jsonValid, "All examples and related_changes fields are valid JSON arrays");
  console.log();

  // Test 10: Verify diverse language families covered
  console.log("Test 10: Verify diverse language families covered");
  const families = new Set(allChanges.map((c) => c.familyId.split("__")[0]));
  assert(families.size >= 3, `Covers at least 3 top-level families (got ${families.size}: ${[...families].join(", ")})`);
  console.log();

  // Summary
  console.log(`\n${"=".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${"=".repeat(40)}`);

  if (failed > 0) {
    process.exit(1);
  }
}

testSoundChangeScraper().catch((error) => {
  console.error("Test error:", error);
  process.exit(1);
});
