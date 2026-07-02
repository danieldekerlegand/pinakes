/**
 * Test script for battle scraper and battles data integrity
 * Run with: npx tsx test/test-battle-scraper.ts
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

function testBattlesData() {
  console.log("=== Testing Battles Data ===\n");

  const filePath = path.join(LEXICONS_DIR, "battles.tsv");
  assert(fs.existsSync(filePath), "battles.tsv file exists");

  const text = fs.readFileSync(filePath, "utf-8");
  const { header, rows } = parseTsv(text);

  // Test 1: Header has all required columns
  console.log("Header validation:");
  const requiredColumns = [
    "id",
    "name",
    "date",
    "coordinates",
    "belligerents",
    "outcome",
    "casualties_estimate",
    "significance",
    "associated_language_changes",
    "war_name",
  ];
  for (const col of requiredColumns) {
    assert(header.includes(col), `Header includes '${col}'`);
  }

  // Test 2: Has entries
  console.log("\nEntry count:");
  assert(rows.length >= 40, `Has 40+ battle entries (found ${rows.length})`);

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
  assert(emptyIds.length === 0, "No empty IDs");
  const emptyNames = rows.filter((r) => !r[nameIdx] || r[nameIdx].trim() === "");
  assert(emptyNames.length === 0, "No empty names");

  // Test 5: Dates are valid numbers
  console.log("\nDate validation:");
  const dateIdx = header.indexOf("date");
  let invalidDates = 0;
  for (const row of rows) {
    const date = parseInt(row[dateIdx], 10);
    if (isNaN(date)) invalidDates++;
  }
  assert(invalidDates === 0, `All dates are valid numbers (${invalidDates} invalid)`);

  // Test 6: Coordinates are valid JSON arrays
  console.log("\nCoordinates validation:");
  const coordIdx = header.indexOf("coordinates");
  let coordErrors = 0;
  for (const row of rows) {
    try {
      const coords = JSON.parse(row[coordIdx]);
      if (
        !Array.isArray(coords) ||
        coords.length !== 2 ||
        typeof coords[0] !== "number" ||
        typeof coords[1] !== "number"
      ) {
        coordErrors++;
      }
      // Validate lat/lng ranges
      if (coords[0] < -90 || coords[0] > 90 || coords[1] < -180 || coords[1] > 180) {
        coordErrors++;
      }
    } catch {
      coordErrors++;
    }
  }
  assert(coordErrors === 0, `All coordinates are valid [lat,lng] arrays (${coordErrors} errors)`);

  // Test 7: Belligerents are valid JSON arrays
  console.log("\nBelligerents validation:");
  const bellIdx = header.indexOf("belligerents");
  let bellErrors = 0;
  for (const row of rows) {
    try {
      const belligerents = JSON.parse(row[bellIdx]);
      if (!Array.isArray(belligerents) || belligerents.length < 2) {
        bellErrors++;
        continue;
      }
      for (const b of belligerents) {
        if (!b.name || typeof b.name !== "string") bellErrors++;
      }
    } catch {
      bellErrors++;
    }
  }
  assert(
    bellErrors === 0,
    `All belligerents are valid JSON arrays with 2+ sides (${bellErrors} errors)`
  );

  // Test 8: War names are present
  console.log("\nWar name validation:");
  const warIdx = header.indexOf("war_name");
  const emptyWars = rows.filter((r) => !r[warIdx] || r[warIdx].trim() === "");
  assert(emptyWars.length === 0, `All battles have war names (${emptyWars.length} missing)`);

  // Test 9: Historical era coverage
  console.log("\nHistorical era coverage:");
  const dates = rows.map((r) => parseInt(r[dateIdx], 10)).filter((d) => !isNaN(d));
  const ancient = dates.filter((d) => d < 500);
  const medieval = dates.filter((d) => d >= 500 && d < 1500);
  const earlyModern = dates.filter((d) => d >= 1500 && d < 1800);
  const modern = dates.filter((d) => d >= 1800);
  assert(ancient.length >= 5, `Has 5+ ancient battles (found ${ancient.length})`);
  assert(medieval.length >= 5, `Has 5+ medieval battles (found ${medieval.length})`);
  assert(earlyModern.length >= 3, `Has 3+ early modern battles (found ${earlyModern.length})`);
  assert(modern.length >= 3, `Has 3+ modern battles (found ${modern.length})`);

  // Test 10: Dates are sorted
  console.log("\nSort order:");
  let sortErrors = 0;
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] < dates[i - 1]) sortErrors++;
  }
  assert(sortErrors === 0, `Battles are sorted by date (${sortErrors} out-of-order)`);

  return { ids };
}

function testBattleScraperModule() {
  console.log("\n=== Testing Battle Scraper Module ===\n");

  // Test that the module exports exist and have correct shape
  const scraperPath = path.join(import.meta.dirname, "..", "server", "services", "battle-scraper.ts");
  assert(fs.existsSync(scraperPath), "battle-scraper.ts file exists");

  const content = fs.readFileSync(scraperPath, "utf-8");

  // Check key exports
  assert(content.includes("export class BattleScraper"), "Exports BattleScraper class");
  assert(content.includes("export const battleScraper"), "Exports battleScraper instance");
  assert(content.includes("async scrapeBattles"), "Has scrapeBattles method");
  assert(content.includes("export interface BattleEntry"), "Exports BattleEntry interface");

  // Check concurrency guard
  assert(content.includes("isScraping"), "Has concurrency guard");

  // Check Gemini integration
  assert(content.includes("GoogleGenerativeAI"), "Uses Gemini AI");
  assert(content.includes("GEMINI_API_KEY"), "Checks for API key");

  // Check era coverage
  assert(content.includes("Ancient"), "Covers ancient era");
  assert(content.includes("Medieval"), "Covers medieval era");
  assert(content.includes("Early Modern"), "Covers early modern era");
  assert(content.includes("Modern"), "Covers modern era");

  // Check TSV writing
  assert(content.includes("battles.tsv"), "Writes to battles.tsv");
  assert(content.includes(".tmp"), "Uses atomic writes via temp file");

  // Check resumability (skip existing IDs)
  assert(content.includes("getExistingBattleIds"), "Supports resumable scraping");
}

function testRouteRegistration() {
  console.log("\n=== Testing Route Registration ===\n");

  const routesPath = path.join(import.meta.dirname, "..", "server", "routes.ts");
  const content = fs.readFileSync(routesPath, "utf-8");

  assert(
    content.includes('import { battleScraper }'),
    "Routes imports battleScraper"
  );
  assert(
    content.includes('"/api/scraping/battles"'),
    "Routes registers POST /api/scraping/battles endpoint"
  );
  assert(
    content.includes("battleScraper"),
    "Routes uses battleScraper"
  );
}

// Run tests
testBattlesData();
testBattleScraperModule();
testRouteRegistration();

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
