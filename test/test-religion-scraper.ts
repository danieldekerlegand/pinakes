/**
 * Test script for verifying religions.tsv data file and religion scraper output
 * Run with: npx tsx test/test-religion-scraper.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ParsedTsv {
  header: string[];
  rows: string[][];
}

function parseTsv(text: string): ParsedTsv {
  const lines = text.trim().split("\n");
  const header = lines[0].split("\t");
  const rows = lines.slice(1).map((line) => line.split("\t"));
  return { header, rows };
}

function getIdx(header: string[], col: string): number {
  return header.indexOf(col);
}

function tryParseJson(val: string): unknown {
  if (!val || val === "null") return null;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

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

async function testReligionsTsv() {
  console.log("=== Testing religions.tsv ===\n");

  const filePath = path.resolve(__dirname, "../lexicons/religions.tsv");
  assert(fs.existsSync(filePath), "religions.tsv exists");

  const text = fs.readFileSync(filePath, "utf-8");
  const { header, rows } = parseTsv(text);

  // Check required columns
  const requiredColumns = [
    "id", "name", "native_name", "religion_type", "origin_region",
    "coordinates", "time_origin", "time_end", "sacred_texts",
    "associated_language_ids", "deity_pantheon", "ritual_practices",
    "description", "sources",
  ];
  for (const col of requiredColumns) {
    assert(header.includes(col), `has column '${col}'`);
  }

  // Check row count (should have at least the 21 base religions)
  assert(rows.length >= 15, `has 15+ religions (found ${rows.length})`);

  // Check all rows have correct number of columns
  const badRows = rows.filter((r) => r.length !== header.length);
  assert(
    badRows.length === 0,
    `all rows have ${header.length} columns (${badRows.length} bad rows)`
  );

  // Check unique IDs
  const idIdx = getIdx(header, "id");
  const ids = rows.map((r) => r[idIdx]);
  const uniqueIds = new Set(ids);
  assert(
    uniqueIds.size === rows.length,
    `all IDs are unique (${uniqueIds.size}/${rows.length})`
  );

  // Check no empty IDs
  const emptyIds = ids.filter((id) => !id || id.trim() === "");
  assert(emptyIds.length === 0, "no empty IDs");

  // Check JSON fields parse correctly
  const coordIdx = getIdx(header, "coordinates");
  const sacredIdx = getIdx(header, "sacred_texts");
  const langIdx = getIdx(header, "associated_language_ids");
  const deityIdx = getIdx(header, "deity_pantheon");
  const ritualIdx = getIdx(header, "ritual_practices");
  const sourcesIdx = getIdx(header, "sources");

  let jsonErrors = 0;
  for (const row of rows) {
    for (const idx of [coordIdx, sacredIdx, langIdx, deityIdx, ritualIdx, sourcesIdx]) {
      if (idx >= 0 && row[idx] && row[idx] !== "null") {
        try {
          JSON.parse(row[idx]);
        } catch {
          jsonErrors++;
          console.log(
            `    JSON parse error in row '${row[idIdx]}', column ${header[idx]}: ${row[idx].substring(0, 80)}`
          );
        }
      }
    }
  }
  assert(jsonErrors === 0, `all JSON fields parse correctly (${jsonErrors} errors)`);

  // Check coordinates are valid
  let badCoords = 0;
  for (const row of rows) {
    const coords = tryParseJson(row[coordIdx]) as { lat: number; lng: number } | null;
    if (coords) {
      if (
        typeof coords.lat !== "number" || typeof coords.lng !== "number" ||
        coords.lat < -90 || coords.lat > 90 ||
        coords.lng < -180 || coords.lng > 180
      ) {
        badCoords++;
        console.log(`    Bad coordinates in '${row[idIdx]}': ${JSON.stringify(coords)}`);
      }
    }
  }
  assert(badCoords === 0, `all coordinates are valid (${badCoords} errors)`);

  // Check religion_type diversity
  const typeIdx = getIdx(header, "religion_type");
  const types = new Set(rows.map((r) => r[typeIdx]));
  assert(
    types.size >= 4,
    `has 4+ religion types (found ${types.size}: ${[...types].join(", ")})`
  );

  // Check that well-known religions are present
  const wellKnown = ["hinduism", "buddhism", "christianity", "islam", "judaism"];
  for (const id of wellKnown) {
    assert(uniqueIds.has(id), `contains well-known religion '${id}'`);
  }

  // Check origin_region diversity
  const regionIdx = getIdx(header, "origin_region");
  const regions = new Set(rows.map((r) => r[regionIdx]));
  assert(
    regions.size >= 4,
    `has 4+ origin regions (found ${regions.size}: ${[...regions].join(", ")})`
  );

  // Check descriptions are non-empty
  const descIdx = getIdx(header, "description");
  const emptyDescs = rows.filter((r) => !r[descIdx] || r[descIdx].trim() === "");
  assert(emptyDescs.length === 0, `all religions have descriptions (${emptyDescs.length} missing)`);

  // Check names are non-empty
  const nameIdx = getIdx(header, "name");
  const emptyNames = rows.filter((r) => !r[nameIdx] || r[nameIdx].trim() === "");
  assert(emptyNames.length === 0, `all religions have names (${emptyNames.length} missing)`);

  console.log("");
}

async function testReligionScraperModule() {
  console.log("=== Testing religion scraper module ===\n");

  // Test that the scraper module can be imported
  try {
    const { ReligionScraper } = await import("../server/services/religion-scraper");
    assert(typeof ReligionScraper === "function", "ReligionScraper class can be imported");

    const scraper = new ReligionScraper();
    assert(typeof scraper.scrapeReligions === "function", "scrapeReligions method exists");
  } catch (error) {
    assert(false, `religion scraper module imports correctly: ${error}`);
  }

  console.log("");
}

async function main() {
  console.log("=== Religion Scraper & Data Validation Tests ===\n");

  await testReligionsTsv();
  await testReligionScraperModule();

  console.log("=== Summary ===");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
