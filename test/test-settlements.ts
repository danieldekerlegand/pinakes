/**
 * Test script for settlements data
 * Run with: npx tsx test/test-settlements.ts
 */

import * as fs from "fs";
import * as path from "path";

const TSV_PATH = path.join(import.meta.dirname!, "..", "lexicons", "settlements.tsv");

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
  assert(fs.existsSync(TSV_PATH), "settlements.tsv exists");
}

function testMinimumEntries() {
  console.log("\n=== Minimum Entry Count ===");
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const { rows } = parseTsv(content);
  assert(rows.length >= 500, `Has 500+ entries (actual: ${rows.length})`);
}

function testHeaderColumns() {
  console.log("\n=== Header Structure ===");
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const { header } = parseTsv(content);
  const expectedCols = [
    "id", "name", "alternate_names", "latitude", "longitude",
    "type", "culture_id", "civilization_id", "founded_year",
    "abandoned_year", "peak_population", "notable_features",
    "associated_languages", "modern_name", "region",
  ];
  assert(header.length === expectedCols.length, `Header has ${expectedCols.length} columns (actual: ${header.length})`);
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
  assert(allMatch, `All rows have ${header.length} columns${mismatches.length ? ` (failures: ${mismatches.slice(0, 5).join(", ")})` : ""}`);
}

function testUniqueIds() {
  console.log("\n=== Unique IDs ===");
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const { rows } = parseTsv(content);
  const ids = rows.map((r) => r[0]);
  const uniqueIds = new Set(ids);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert(uniqueIds.size === ids.length, `All IDs are unique${dupes.length ? ` (duplicates: ${dupes.slice(0, 5).join(", ")})` : ""}`);
}

function testValidCoordinates() {
  console.log("\n=== Valid Coordinates ===");
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const { header, rows } = parseTsv(content);
  const latIdx = header.indexOf("latitude");
  const lngIdx = header.indexOf("longitude");
  let allValid = true;
  const invalids: string[] = [];
  for (const row of rows) {
    const lat = parseFloat(row[latIdx]);
    const lng = parseFloat(row[lngIdx]);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      allValid = false;
      invalids.push(`${row[0]}: lat=${row[latIdx]}, lng=${row[lngIdx]}`);
    }
  }
  assert(allValid, `All coordinates are valid${invalids.length ? ` (failures: ${invalids.slice(0, 5).join(", ")})` : ""}`);
}

function testValidTypes() {
  console.log("\n=== Valid Settlement Types ===");
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const { header, rows } = parseTsv(content);
  const typeIdx = header.indexOf("type");
  const validTypes = new Set(["city-state", "capital", "trading-post", "religious-center", "fortress", "port", "colony"]);
  let allValid = true;
  const invalids: string[] = [];
  for (const row of rows) {
    if (!validTypes.has(row[typeIdx])) {
      allValid = false;
      invalids.push(`${row[0]}: "${row[typeIdx]}"`);
    }
  }
  assert(allValid, `All settlement types are valid${invalids.length ? ` (invalid: ${invalids.slice(0, 5).join(", ")})` : ""}`);
}

function testValidJsonArrays() {
  console.log("\n=== Valid JSON Arrays ===");
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const { header, rows } = parseTsv(content);
  const arrayCols = ["alternate_names", "notable_features", "associated_languages"];
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
  assert(allValid, `All JSON array fields parse correctly${invalids.length ? ` (failures: ${invalids.slice(0, 5).join(", ")})` : ""}`);
}

function testFoundedYears() {
  console.log("\n=== Founded Year Validity ===");
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const { header, rows } = parseTsv(content);
  const foundedIdx = header.indexOf("founded_year");
  let allValid = true;
  let hasAncient = false;
  let hasMedieval = false;
  let hasModern = false;
  const invalids: string[] = [];
  for (const row of rows) {
    const val = row[foundedIdx];
    if (val && val.trim()) {
      const year = parseInt(val, 10);
      if (isNaN(year)) {
        allValid = false;
        invalids.push(`${row[0]}: "${val}"`);
      } else {
        if (year < -500) hasAncient = true;
        if (year >= -500 && year < 1000) hasMedieval = true;
        if (year >= 1000) hasModern = true;
      }
    }
  }
  assert(allValid, `All founded_year values are valid integers${invalids.length ? ` (failures: ${invalids.slice(0, 5).join(", ")})` : ""}`);
  assert(hasAncient, "Has ancient settlements (before 500 BCE)");
  assert(hasMedieval, "Has classical/medieval settlements (500 BCE - 1000 CE)");
  assert(hasModern, "Has later settlements (after 1000 CE)");
}

function testGeographicDiversity() {
  console.log("\n=== Geographic Diversity ===");
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const { header, rows } = parseTsv(content);
  const regionIdx = header.indexOf("region");
  const regions = new Set<string>();
  for (const row of rows) {
    if (row[regionIdx]) regions.add(row[regionIdx]);
  }
  assert(regions.size >= 8, `Has 8+ distinct regions (actual: ${regions.size})`);

  const latIdx = header.indexOf("latitude");
  const lngIdx = header.indexOf("longitude");
  let hasAfrica = false, hasAsia = false, hasEurope = false, hasAmericas = false;
  for (const row of rows) {
    const lat = parseFloat(row[latIdx]);
    const lng = parseFloat(row[lngIdx]);
    if (lat < 37 && lat > -35 && lng > -20 && lng < 55) hasAfrica = true;
    if (lat > 0 && lat < 70 && lng > 55 && lng < 150) hasAsia = true;
    if (lat > 35 && lat < 72 && lng > -25 && lng < 45) hasEurope = true;
    if (lng > -170 && lng < -30) hasAmericas = true;
  }
  assert(hasAfrica, "Contains settlements in Africa/Near East");
  assert(hasAsia, "Contains settlements in Asia");
  assert(hasEurope, "Contains settlements in Europe");
  assert(hasAmericas, "Contains settlements in the Americas");
}

function testTypeDiversity() {
  console.log("\n=== Type Diversity ===");
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const { header, rows } = parseTsv(content);
  const typeIdx = header.indexOf("type");
  const types = new Set<string>();
  for (const row of rows) {
    types.add(row[typeIdx]);
  }
  assert(types.size >= 5, `Has 5+ settlement types (actual: ${types.size}: ${[...types].join(", ")})`);
}

function testNonEmptyNames() {
  console.log("\n=== Non-Empty Names ===");
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const { header, rows } = parseTsv(content);
  const nameIdx = header.indexOf("name");
  let allHaveName = true;
  for (const row of rows) {
    if (!row[nameIdx] || row[nameIdx].trim().length < 2) {
      allHaveName = false;
    }
  }
  assert(allHaveName, "All entries have non-empty names (2+ chars)");
}

function testPopulationValues() {
  console.log("\n=== Population Values ===");
  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const { header, rows } = parseTsv(content);
  const popIdx = header.indexOf("peak_population");
  let hasPopulation = 0;
  let allValid = true;
  for (const row of rows) {
    const val = row[popIdx];
    if (val && val.trim()) {
      const pop = parseInt(val, 10);
      if (isNaN(pop) || pop < 0) {
        allValid = false;
      } else {
        hasPopulation++;
      }
    }
  }
  assert(allValid, "All population values are valid non-negative integers");
  assert(hasPopulation >= rows.length * 0.5, `At least 50% of entries have population data (${hasPopulation}/${rows.length})`);
}

function testScraperModule() {
  console.log("\n=== Scraper Module ===");
  try {
    // Verify the scraper module can be imported and has expected exports
    const scraperPath = path.join(import.meta.dirname!, "..", "server", "services", "settlements-scraper.ts");
    assert(fs.existsSync(scraperPath), "settlements-scraper.ts exists");

    const content = fs.readFileSync(scraperPath, "utf-8");
    assert(content.includes("class SettlementsScraper"), "Contains SettlementsScraper class");
    assert(content.includes("scrapeSettlements"), "Has scrapeSettlements method");
    assert(content.includes("scrapeRegion"), "Has scrapeRegion method");
    assert(content.includes("getExistingIds"), "Has getExistingIds method");
    assert(content.includes("appendSettlements"), "Has appendSettlements method");
    assert(content.includes("GoogleGenerativeAI"), "Uses Gemini AI for scraping");
    assert(content.includes("export const settlementsScraper"), "Exports singleton instance");
  } catch (e: any) {
    assert(false, `Scraper module check failed: ${e.message}`);
  }
}

// Run all tests
console.log("=== Settlements Data Tests ===");
testFileExists();
testMinimumEntries();
testHeaderColumns();
testColumnConsistency();
testUniqueIds();
testValidCoordinates();
testValidTypes();
testValidJsonArrays();
testFoundedYears();
testGeographicDiversity();
testTypeDiversity();
testNonEmptyNames();
testPopulationValues();
testScraperModule();

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
