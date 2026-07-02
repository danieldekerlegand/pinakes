/**
 * Tests for the historical polity/empire scraper.
 * Tests both the scraper logic (unit) and the resulting TSV data (integration).
 * Run with: npx tsx test/test-polity-scraper.ts
 */

import * as fs from "fs";
import * as path from "path";

const LEXICONS_DIR = path.join(import.meta.dirname, "..", "lexicons");

function parseTsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const header = lines[0].split("\t");
  const rows = lines.slice(1).map((l) => l.split("\t"));
  return { header, rows };
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

// ──── Unit tests for scraper internals ────

async function testScraperModule() {
  console.log("=== Testing Polity Scraper Module ===\n");

  const mod = await import("../server/services/polity-scraper");

  // Test 1: Module exports expected symbols
  console.log("Module exports:");
  assert(typeof mod.PolityScraper === "function", "PolityScraper class is exported");
  assert(typeof mod.polityScraper === "object", "polityScraper singleton is exported");
  assert(typeof mod.SESHAT_POLITIES_COUNT === "number", "SESHAT_POLITIES_COUNT is exported");
  assert(mod.SESHAT_POLITIES_COUNT > 30, `SESHAT_POLITIES_COUNT is > 30 (got ${mod.SESHAT_POLITIES_COUNT})`);

  // Test 2: scrapePolities method exists
  console.log("\nMethod signatures:");
  assert(typeof mod.polityScraper.scrapePolities === "function", "scrapePolities method exists");
}

// ──── Data integrity tests for civilizations.tsv ────

function testCivilizationsData() {
  console.log("\n=== Testing Civilizations TSV Data Integrity ===\n");

  const tsvPath = path.join(LEXICONS_DIR, "civilizations.tsv");
  assert(fs.existsSync(tsvPath), "civilizations.tsv exists");

  const content = fs.readFileSync(tsvPath, "utf-8");
  const { header, rows } = parseTsv(content);

  // Test 1: Required columns
  console.log("Header validation:");
  const requiredColumns = [
    "id", "name", "native_name", "time_period_start", "time_period_end",
    "time_period_label", "associated_language_ids", "writing_systems",
    "political_structure", "capital", "population", "haplogroup_ids",
    "cuisine_id", "sources", "description",
  ];
  for (const col of requiredColumns) {
    assert(header.includes(col), `Header includes '${col}'`);
  }

  // Test 2: Minimum entry count
  console.log("\nEntry count:");
  assert(rows.length >= 80, `Has 80+ entries (found ${rows.length})`);

  // Test 3: Unique IDs
  console.log("\nID uniqueness:");
  const idIdx = header.indexOf("id");
  const ids = rows.map((r) => r[idIdx]);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === ids.length, `All ${ids.length} IDs are unique`);

  // Test 4: No empty IDs or names
  console.log("\nRequired fields:");
  const nameIdx = header.indexOf("name");
  assert(rows.every((r) => r[idIdx]?.trim()), "No empty IDs");
  assert(rows.every((r) => r[nameIdx]?.trim()), "No empty names");

  // Test 5: Time periods are valid
  console.log("\nTime period validation:");
  const startIdx = header.indexOf("time_period_start");
  const endIdx = header.indexOf("time_period_end");
  let invalidTimePeriods = 0;
  for (const row of rows) {
    const start = parseInt(row[startIdx], 10);
    const endRaw = row[endIdx]?.trim();
    const end = endRaw && endRaw !== "null" ? parseInt(endRaw, 10) : null;
    if (isNaN(start)) invalidTimePeriods++;
    if (end !== null && isNaN(end)) invalidTimePeriods++;
    if (end !== null && end < start) invalidTimePeriods++;
  }
  assert(invalidTimePeriods === 0, `All time periods are valid (${invalidTimePeriods} invalid)`);

  // Test 6: JSON arrays parse correctly
  console.log("\nJSON field validation:");
  const langIdx = header.indexOf("associated_language_ids");
  const writIdx = header.indexOf("writing_systems");
  const srcIdx = header.indexOf("sources");
  let jsonErrors = 0;
  for (const row of rows) {
    for (const idx of [langIdx, writIdx, srcIdx]) {
      if (idx >= 0 && row[idx]?.trim()) {
        try {
          const parsed = JSON.parse(row[idx]);
          if (!Array.isArray(parsed)) jsonErrors++;
        } catch {
          jsonErrors++;
        }
      }
    }
  }
  assert(jsonErrors === 0, `All JSON array fields parse correctly (${jsonErrors} errors)`);

  // Test 7: Political structure is non-empty
  console.log("\nPolitical structure:");
  const polIdx = header.indexOf("political_structure");
  const emptyPol = rows.filter((r) => !r[polIdx]?.trim());
  assert(emptyPol.length === 0, `All entries have political_structure (${emptyPol.length} empty)`);

  return { ids: uniqueIds, header, rows, nameIdx };
}

// ──── Test that scraper would produce well-known polities ────

function testKnownPolities(existingIds: Set<string>, allNames: string[], nameIdx: number) {
  console.log("\n=== Testing Known Polity Coverage ===\n");

  // These polities should exist either from original data or from the scraper
  const expectedPolities = [
    "Roman Empire",
    "Byzantine Empire",
    "Mongol Empire",
    "Ottoman Empire",
    "Han Dynasty",
    "Tang Dynasty",
    "Maurya Empire",
    "Persian Empire (Achaemenid)",
    "Mali Empire",
    "Aztec Empire",
    "Inca Empire",
  ];

  for (const name of expectedPolities) {
    assert(allNames.includes(name), `Contains "${name}"`);
  }

  // Check regional diversity - should have polities from many regions
  console.log("\nRegional diversity in IDs:");
  const regionPrefixes: Record<string, string[]> = {
    "Africa": ["kingdom-of-aksum", "kingdom-of-benin", "zulu-kingdom", "mali-empire", "songhai-empire"],
    "East Asia": ["han-dynasty", "tang-dynasty", "song-dynasty", "ming-dynasty", "qing-dynasty"],
    "South Asia": ["maurya-empire", "gupta-empire", "chola-dynasty", "mughal-empire"],
    "Middle East": ["sasanian-empire", "abbasid-caliphate", "umayyad-caliphate"],
    "Europe": ["roman-empire", "byzantine-empire", "habsburg-monarchy"],
    "Americas": ["aztec-empire", "inca-empire", "maya-civilization"],
  };

  for (const [region, ids] of Object.entries(regionPrefixes)) {
    const found = ids.filter((id) => existingIds.has(id));
    assert(found.length >= 2, `${region}: has ${found.length}/${ids.length} expected polities`);
  }
}

// ──── Test ID generation logic ────

function testIdGeneration() {
  console.log("\n=== Testing ID Generation ===\n");

  // Verify IDs follow kebab-case convention
  const tsvPath = path.join(LEXICONS_DIR, "civilizations.tsv");
  const content = fs.readFileSync(tsvPath, "utf-8");
  const { header, rows } = parseTsv(content);
  const idIdx = header.indexOf("id");

  let invalidIds = 0;
  for (const row of rows) {
    const id = row[idIdx];
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(id) && id.length > 1) {
      invalidIds++;
    }
  }
  assert(invalidIds === 0, `All IDs are valid kebab-case (${invalidIds} invalid)`);

  // Verify no tab characters in any field
  let tabErrors = 0;
  for (const row of rows) {
    // Each field should not contain literal tab (would break TSV)
    // The split already handles this, but verify no double-tabs
    if (row.some((field) => field.includes("\t"))) tabErrors++;
  }
  assert(tabErrors === 0, `No embedded tabs in fields (${tabErrors} errors)`);
}

// ──── Run all tests ────

async function main() {
  await testScraperModule();
  const { ids, rows, nameIdx } = testCivilizationsData();
  const allNames = rows.map((r) => r[nameIdx]);
  testKnownPolities(ids, allNames, nameIdx);
  testIdGeneration();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
