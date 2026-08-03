/**
 * Test script for archaeological sites data
 * Run with: npx tsx test/test-archaeological-sites.ts
 */

import * as fs from "fs";
import * as path from "path";

const TSV_PATH = path.join(import.meta.dirname!, "..", "data", "source", "lexicons", "archaeological-sites.tsv");

function parseTsv(content: string): { header: string[]; rows: string[][] } {
  const lines = content.trim().split("\n");
  const header = lines[0].split("\t");
  const rows = lines.slice(1).filter((l) => l.trim()).map((l) => l.split("\t"));
  return { header, rows };
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function testFileExists() {
  console.log("\n=== File Existence ===");
  assert(fs.existsSync(TSV_PATH), "archaeological-sites.tsv exists");
}

function testMinimumEntries() {
  console.log("\n=== Minimum Entry Count ===");
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const { rows } = parseTsv(content);
  assert(rows.length >= 150, `Has 150+ entries (actual: ${rows.length})`);
}

function testHeaderColumns() {
  console.log("\n=== Header Structure ===");
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const { header } = parseTsv(content);
  const expectedCols = [
    "id", "name", "coordinates", "site_type", "time_period_start",
    "time_period_end", "time_period_label", "associated_language_ids",
    "associated_culture_ids", "associated_civilization_ids",
    "excavation_status", "findings", "importance", "confidence",
    "sources", "description",
  ];
  assert(header.length === expectedCols.length, `Header has ${expectedCols.length} columns`);
  for (const col of expectedCols) {
    assert(header.includes(col), `Header contains '${col}'`);
  }
}

function testColumnConsistency() {
  console.log("\n=== Column Consistency ===");
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const { header, rows } = parseTsv(content);
  let allMatch = true;
  const mismatches: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length !== header.length) {
      allMatch = false;
      mismatches.push(`Row ${i + 2}: ${rows[i].length} cols (expected ${header.length}), id=${rows[i][0]}`);
    }
  }
  assert(allMatch, `All rows have ${header.length} columns${mismatches.length ? ` (failures: ${mismatches.join(", ")})` : ""}`);
}

function testUniqueIds() {
  console.log("\n=== Unique IDs ===");
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const { rows } = parseTsv(content);
  const ids = rows.map((r) => r[0]);
  const uniqueIds = new Set(ids);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert(uniqueIds.size === ids.length, `All IDs are unique${dupes.length ? ` (duplicates: ${dupes.join(", ")})` : ""}`);
}

function testValidCoordinates() {
  console.log("\n=== Valid Coordinates ===");
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const { rows } = parseTsv(content);
  let allValid = true;
  const invalids: string[] = [];
  for (const row of rows) {
    try {
      const coords = JSON.parse(row[2]);
      if (typeof coords.lat !== "number" || typeof coords.lng !== "number") throw new Error("missing lat/lng");
      if (coords.lat < -90 || coords.lat > 90) throw new Error(`lat ${coords.lat} out of range`);
      if (coords.lng < -180 || coords.lng > 180) throw new Error(`lng ${coords.lng} out of range`);
    } catch (e: any) {
      allValid = false;
      invalids.push(`${row[0]}: ${e.message}`);
    }
  }
  assert(allValid, `All coordinates are valid JSON with lat/lng in range${invalids.length ? ` (failures: ${invalids.join(", ")})` : ""}`);
}

function testValidSiteTypes() {
  console.log("\n=== Valid Site Types ===");
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const { header, rows } = parseTsv(content);
  const typeIdx = header.indexOf("site_type");
  const validTypes = new Set(["settlement", "burial", "temple", "city", "fortress", "ceremonial", "cave_art", "workshop", "unknown"]);
  let allValid = true;
  const invalids: string[] = [];
  for (const row of rows) {
    if (!validTypes.has(row[typeIdx])) {
      allValid = false;
      invalids.push(`${row[0]}: "${row[typeIdx]}"`);
    }
  }
  assert(allValid, `All site types are valid${invalids.length ? ` (invalid: ${invalids.join(", ")})` : ""}`);
}

function testValidJsonArrays() {
  console.log("\n=== Valid JSON Arrays ===");
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const { header, rows } = parseTsv(content);
  const arrayCols = ["associated_language_ids", "associated_culture_ids", "associated_civilization_ids", "findings", "sources"];
  let allValid = true;
  const invalids: string[] = [];
  for (const col of arrayCols) {
    const idx = header.indexOf(col);
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row[idx]);
        if (!Array.isArray(parsed)) throw new Error("not an array");
      } catch {
        allValid = false;
        invalids.push(`${row[0]}.${col}`);
      }
    }
  }
  assert(allValid, `All JSON array fields parse correctly${invalids.length ? ` (failures: ${invalids.join(", ")})` : ""}`);
}

function testImportanceRange() {
  console.log("\n=== Importance/Confidence Range ===");
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const { header, rows } = parseTsv(content);
  const impIdx = header.indexOf("importance");
  const confIdx = header.indexOf("confidence");
  let allValid = true;
  for (const row of rows) {
    const imp = parseInt(row[impIdx], 10);
    const conf = parseInt(row[confIdx], 10);
    if (isNaN(imp) || imp < 1 || imp > 100 || isNaN(conf) || conf < 1 || conf > 100) {
      allValid = false;
    }
  }
  assert(allValid, "All importance/confidence values are 1-100");
}

function testGeographicDiversity() {
  console.log("\n=== Geographic Diversity ===");
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const { rows } = parseTsv(content);
  let hasAfrica = false, hasAsia = false, hasEurope = false, hasAmericas = false, hasOceania = false;
  for (const row of rows) {
    const coords = JSON.parse(row[2]);
    if (coords.lat < 37 && coords.lat > -35 && coords.lng > -20 && coords.lng < 55) hasAfrica = true;
    if (coords.lat > 0 && coords.lat < 70 && coords.lng > 55 && coords.lng < 150) hasAsia = true;
    if (coords.lat > 35 && coords.lat < 72 && coords.lng > -25 && coords.lng < 45) hasEurope = true;
    if (coords.lng > -170 && coords.lng < -30) hasAmericas = true;
    if (coords.lat < -10 && coords.lng > 100 && coords.lng < 180) hasOceania = true;
  }
  assert(hasAfrica, "Contains sites in Africa");
  assert(hasAsia, "Contains sites in Asia");
  assert(hasEurope, "Contains sites in Europe");
  assert(hasAmericas, "Contains sites in the Americas");
  assert(hasOceania, "Contains sites in Oceania");
}

function testDescriptionsNotEmpty() {
  console.log("\n=== Non-Empty Descriptions ===");
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const { header, rows } = parseTsv(content);
  const descIdx = header.indexOf("description");
  let allHaveDesc = true;
  for (const row of rows) {
    if (!row[descIdx] || row[descIdx].trim().length < 10) {
      allHaveDesc = false;
    }
  }
  assert(allHaveDesc, "All entries have meaningful descriptions (10+ chars)");
}

// Run all tests
console.log("=== Archaeological Sites Data Tests ===");
testFileExists();
testMinimumEntries();
testHeaderColumns();
testColumnConsistency();
testUniqueIds();
testValidCoordinates();
testValidSiteTypes();
testValidJsonArrays();
testImportanceRange();
testGeographicDiversity();
testDescriptionsNotEmpty();

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
