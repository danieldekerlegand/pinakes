/**
 * Test script for culture-profiles data integrity
 * Run with: npx tsx test/test-culture-profiles.ts
 */

import * as fs from "fs";
import * as path from "path";

const LEXICONS_DIR = path.join(import.meta.dirname, "..", "data", "source", "lexicons");

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

function testCultureProfiles() {
  console.log("=== Testing Culture Profiles Data ===\n");

  const text = fs.readFileSync(path.join(LEXICONS_DIR, "culture-profiles.tsv"), "utf-8");
  const { header, rows } = parseTsv(text);

  // Test 1: Header has all required columns
  console.log("Header validation:");
  const requiredColumns = [
    "id", "name", "alternate_names", "civilization_id",
    "archaeological_culture_id", "time_period_start", "time_period_end",
    "region", "summary_description", "social_organization", "subsistence_type",
    "urbanism_level", "population_estimate", "technology_level",
    "associated_language_ids", "associated_religion_ids",
    "associated_writing_system_ids", "associated_art_tradition_ids",
    "associated_music_tradition_ids", "associated_cuisine_id",
    "associated_architectural_style_ids", "associated_literary_tradition_ids",
    "notable_settlements", "image_gallery_tags", "sources",
  ];
  for (const col of requiredColumns) {
    assert(header.includes(col), `Header includes '${col}'`);
  }

  // Test 2: Has 100+ entries
  console.log("\nEntry count:");
  assert(rows.length >= 100, `Has 100+ culture profile entries (found ${rows.length})`);

  // Test 3: All IDs are unique
  console.log("\nID uniqueness:");
  const idIdx = header.indexOf("id");
  const ids = rows.map((r) => r[idIdx]);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === ids.length, `All ${ids.length} IDs are unique`);

  // Test 4: No empty IDs or names
  console.log("\nRequired field validation:");
  const nameIdx = header.indexOf("name");
  const emptyIds = rows.filter((r) => !r[idIdx] || r[idIdx].trim() === "");
  assert(emptyIds.length === 0, `No empty IDs`);
  const emptyNames = rows.filter((r) => !r[nameIdx] || r[nameIdx].trim() === "");
  assert(emptyNames.length === 0, `No empty names`);

  // Test 5: Time periods are valid numbers
  console.log("\nTime period validation:");
  const startIdx = header.indexOf("time_period_start");
  const endIdx = header.indexOf("time_period_end");
  let invalidTimePeriods = 0;
  for (const row of rows) {
    const start = parseInt(row[startIdx], 10);
    const end = row[endIdx] && row[endIdx] !== "null" && row[endIdx].trim() !== ""
      ? parseInt(row[endIdx], 10) : null;
    if (isNaN(start)) invalidTimePeriods++;
    if (end !== null && isNaN(end)) invalidTimePeriods++;
    if (end !== null && end < start) invalidTimePeriods++;
  }
  assert(invalidTimePeriods === 0, `All time periods are valid (${invalidTimePeriods} invalid)`);

  // Test 6: Social organization values are valid
  console.log("\nEnum field validation:");
  const soIdx = header.indexOf("social_organization");
  const validSocialOrg = new Set(["egalitarian", "chiefdom", "state", "empire"]);
  const invalidSO = rows.filter((r) => r[soIdx] && !validSocialOrg.has(r[soIdx]));
  assert(invalidSO.length === 0, `All social_organization values are valid (${invalidSO.length} invalid)`);

  // Test 7: Subsistence type values are valid
  const stIdx = header.indexOf("subsistence_type");
  const validSubsistence = new Set(["hunter-gatherer", "pastoral", "agricultural", "maritime", "mixed"]);
  const invalidST = rows.filter((r) => r[stIdx] && !validSubsistence.has(r[stIdx]));
  assert(invalidST.length === 0, `All subsistence_type values are valid (${invalidST.length} invalid)`);

  // Test 8: Urbanism level values are valid
  const ulIdx = header.indexOf("urbanism_level");
  const validUrbanism = new Set(["nomadic", "village", "town", "city-state", "metropolis"]);
  const invalidUL = rows.filter((r) => r[ulIdx] && !validUrbanism.has(r[ulIdx]));
  assert(invalidUL.length === 0, `All urbanism_level values are valid (${invalidUL.length} invalid)`);

  // Test 9: Technology level values are valid
  const tlIdx = header.indexOf("technology_level");
  const validTech = new Set(["stone", "copper", "bronze", "iron", "steel", "industrial"]);
  const invalidTL = rows.filter((r) => r[tlIdx] && !validTech.has(r[tlIdx]));
  assert(invalidTL.length === 0, `All technology_level values are valid (${invalidTL.length} invalid)`);

  // Test 10: JSON array fields parse correctly
  console.log("\nJSON field validation:");
  const jsonFields = [
    "alternate_names", "associated_language_ids", "associated_religion_ids",
    "associated_writing_system_ids", "associated_art_tradition_ids",
    "associated_music_tradition_ids", "associated_architectural_style_ids",
    "associated_literary_tradition_ids", "notable_settlements",
    "image_gallery_tags", "sources",
  ];
  let jsonErrors = 0;
  for (const row of rows) {
    for (const field of jsonFields) {
      const idx = header.indexOf(field);
      if (idx >= 0 && row[idx] && row[idx].trim()) {
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

  // Test 11: Population estimates are positive numbers when present
  console.log("\nPopulation validation:");
  const popIdx = header.indexOf("population_estimate");
  let popErrors = 0;
  for (const row of rows) {
    if (row[popIdx] && row[popIdx].trim() !== "" && row[popIdx] !== "null") {
      const pop = parseInt(row[popIdx], 10);
      if (isNaN(pop) || pop <= 0) popErrors++;
    }
  }
  assert(popErrors === 0, `All population estimates are positive numbers (${popErrors} errors)`);

  // Test 12: Regional diversity - profiles from multiple regions
  console.log("\nRegional diversity:");
  const regionIdx = header.indexOf("region");
  const regions = new Set(rows.map((r) => r[regionIdx]));
  assert(regions.size >= 8, `Covers 8+ distinct regions (found ${regions.size}: ${[...regions].join(", ")})`);

  // Test 13: Civilization ID references valid civilizations
  console.log("\nReferential integrity:");
  const civIdIdx = header.indexOf("civilization_id");
  const civText = fs.readFileSync(path.join(LEXICONS_DIR, "civilizations.tsv"), "utf-8");
  const civData = parseTsv(civText);
  const civIds = new Set(civData.rows.map((r) => r[civData.header.indexOf("id")]));
  const invalidCivRefs = rows.filter(
    (r) => r[civIdIdx] && r[civIdIdx].trim() !== "" && !civIds.has(r[civIdIdx]),
  );
  assert(
    invalidCivRefs.length === 0,
    `All civilization_id refs are valid (${invalidCivRefs.length} invalid${
      invalidCivRefs.length > 0
        ? ": " + invalidCivRefs.map((r) => `${r[idIdx]}->${r[civIdIdx]}`).join(", ")
        : ""
    })`,
  );

  // Test 14: Summary descriptions are non-empty
  console.log("\nDescription validation:");
  const descIdx = header.indexOf("summary_description");
  const emptyDescs = rows.filter((r) => !r[descIdx] || r[descIdx].trim().length < 20);
  assert(emptyDescs.length === 0, `All profiles have meaningful descriptions (${emptyDescs.length} too short)`);

  // Test 15: Row column count matches header
  console.log("\nStructural validation:");
  const mismatchedRows = rows.filter((r) => r.length !== header.length);
  assert(
    mismatchedRows.length === 0,
    `All rows have ${header.length} columns (${mismatchedRows.length} mismatched)`,
  );
}

// Run tests
testCultureProfiles();

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
