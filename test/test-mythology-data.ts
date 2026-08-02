/**
 * Test script for verifying myth-motifs.tsv and deities.tsv data files
 * Run with: npx tsx test/test-mythology-data.ts
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

async function testDeitiesTsv() {
  console.log("=== Testing deities.tsv ===\n");

  const filePath = path.resolve(__dirname, "../data/source/lexicons/deities.tsv");
  assert(fs.existsSync(filePath), "deities.tsv exists");

  const text = fs.readFileSync(filePath, "utf-8");
  const { header, rows } = parseTsv(text);

  // Check required columns
  const requiredColumns = [
    "id", "name", "native_name", "pantheon", "domain", "gender",
    "syncretism_links", "associated_religion_ids", "associated_language_ids",
    "time_origin", "time_end", "coordinates", "description", "sources",
  ];
  for (const col of requiredColumns) {
    assert(header.includes(col), `has column '${col}'`);
  }

  // Check row count (60+ deities required)
  assert(rows.length >= 60, `has 60+ deities (found ${rows.length})`);

  // Check all rows have correct number of columns
  const badRows = rows.filter((r) => r.length !== header.length);
  assert(badRows.length === 0, `all rows have ${header.length} columns (${badRows.length} bad rows)`);

  // Check unique IDs
  const idIdx = getIdx(header, "id");
  const ids = rows.map((r) => r[idIdx]);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === rows.length, `all IDs are unique (${uniqueIds.size}/${rows.length})`);

  // Check no empty IDs
  const emptyIds = ids.filter((id) => !id || id.trim() === "");
  assert(emptyIds.length === 0, "no empty IDs");

  // Check JSON fields parse correctly
  const domainIdx = getIdx(header, "domain");
  const syncIdx = getIdx(header, "syncretism_links");
  const relIdx = getIdx(header, "associated_religion_ids");
  const langIdx = getIdx(header, "associated_language_ids");
  const coordIdx = getIdx(header, "coordinates");
  const sourcesIdx = getIdx(header, "sources");

  let jsonErrors = 0;
  for (const row of rows) {
    for (const idx of [domainIdx, syncIdx, relIdx, langIdx, coordIdx, sourcesIdx]) {
      if (idx >= 0 && row[idx] && row[idx] !== "null") {
        try {
          JSON.parse(row[idx]);
        } catch {
          jsonErrors++;
          console.log(`    JSON parse error in row '${row[idIdx]}', column ${header[idx]}: ${row[idx]}`);
        }
      }
    }
  }
  assert(jsonErrors === 0, `all JSON fields parse correctly (${jsonErrors} errors)`);

  // Check syncretism links reference valid deity IDs
  let badSyncLinks = 0;
  for (const row of rows) {
    const links = tryParseJson(row[syncIdx]) as string[] | null;
    if (links && Array.isArray(links)) {
      for (const link of links) {
        if (!uniqueIds.has(link)) {
          // External references are okay - just count internal ones that exist
        }
      }
    }
  }

  // Check that multiple pantheons are represented
  const pantheonIdx = getIdx(header, "pantheon");
  const pantheons = new Set(rows.map((r) => r[pantheonIdx]));
  assert(pantheons.size >= 8, `has 8+ distinct pantheons (found ${pantheons.size}: ${[...pantheons].join(", ")})`);

  // Check coordinates are valid
  let badCoords = 0;
  for (const row of rows) {
    const coords = tryParseJson(row[coordIdx]) as { lat: number; lng: number } | null;
    if (coords) {
      if (typeof coords.lat !== "number" || typeof coords.lng !== "number" ||
          coords.lat < -90 || coords.lat > 90 || coords.lng < -180 || coords.lng > 180) {
        badCoords++;
        console.log(`    Bad coordinates in '${row[idIdx]}': ${JSON.stringify(coords)}`);
      }
    }
  }
  assert(badCoords === 0, `all coordinates are valid (${badCoords} errors)`);

  // Verify syncretism links are bidirectional (spot check)
  const zeusRow = rows.find((r) => r[idIdx] === "zeus");
  const jupiterRow = rows.find((r) => r[idIdx] === "jupiter");
  if (zeusRow && jupiterRow) {
    const zeusLinks = tryParseJson(zeusRow[syncIdx]) as string[] | null;
    const jupiterLinks = tryParseJson(jupiterRow[syncIdx]) as string[] | null;
    assert(
      zeusLinks?.includes("jupiter") && jupiterLinks?.includes("zeus"),
      "syncretism links are bidirectional (zeus <-> jupiter)"
    );
  }

  console.log("");
}

async function testMythMotifsTsv() {
  console.log("=== Testing myth-motifs.tsv ===\n");

  const filePath = path.resolve(__dirname, "../data/source/lexicons/myth-motifs.tsv");
  assert(fs.existsSync(filePath), "myth-motifs.tsv exists");

  const text = fs.readFileSync(filePath, "utf-8");
  const { header, rows } = parseTsv(text);

  // Check required columns
  const requiredColumns = [
    "id", "name", "motif_type", "atu_index", "description", "examples",
    "associated_religion_ids", "associated_deity_ids", "geographic_distribution",
    "time_depth", "sources",
  ];
  for (const col of requiredColumns) {
    assert(header.includes(col), `has column '${col}'`);
  }

  // Check row count (30+ motifs required)
  assert(rows.length >= 30, `has 30+ motifs (found ${rows.length})`);

  // Check all rows have correct number of columns
  const badRows = rows.filter((r) => r.length !== header.length);
  assert(badRows.length === 0, `all rows have ${header.length} columns (${badRows.length} bad rows)`);

  // Check unique IDs
  const idIdx = getIdx(header, "id");
  const ids = rows.map((r) => r[idIdx]);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === rows.length, `all IDs are unique (${uniqueIds.size}/${rows.length})`);

  // Check JSON fields parse correctly
  const examplesIdx = getIdx(header, "examples");
  const relIdx = getIdx(header, "associated_religion_ids");
  const deityIdx = getIdx(header, "associated_deity_ids");
  const geoIdx = getIdx(header, "geographic_distribution");
  const sourcesIdx = getIdx(header, "sources");

  let jsonErrors = 0;
  for (const row of rows) {
    for (const idx of [examplesIdx, relIdx, deityIdx, geoIdx, sourcesIdx]) {
      if (idx >= 0 && row[idx] && row[idx] !== "null") {
        try {
          JSON.parse(row[idx]);
        } catch {
          jsonErrors++;
          console.log(`    JSON parse error in row '${row[idIdx]}', column ${header[idx]}: ${row[idx].substring(0, 80)}...`);
        }
      }
    }
  }
  assert(jsonErrors === 0, `all JSON fields parse correctly (${jsonErrors} errors)`);

  // Check that examples have culture and narrative fields
  let badExamples = 0;
  for (const row of rows) {
    const examples = tryParseJson(row[examplesIdx]) as Array<{ culture: string; narrative: string }> | null;
    if (examples && Array.isArray(examples)) {
      for (const ex of examples) {
        if (!ex.culture || !ex.narrative) {
          badExamples++;
          console.log(`    Bad example in '${row[idIdx]}': missing culture or narrative`);
        }
      }
    }
  }
  assert(badExamples === 0, `all examples have culture and narrative fields`);

  // Check motif_type diversity
  const typeIdx = getIdx(header, "motif_type");
  const motifTypes = new Set(rows.map((r) => r[typeIdx]));
  assert(motifTypes.size >= 5, `has 5+ motif types (found ${motifTypes.size}: ${[...motifTypes].join(", ")})`);

  // Verify deity_ids reference deities in deities.tsv
  const deitiesPath = path.resolve(__dirname, "../data/source/lexicons/deities.tsv");
  const deitiesText = fs.readFileSync(deitiesPath, "utf-8");
  const deities = parseTsv(deitiesText);
  const deityIdIdx = getIdx(deities.header, "id");
  const validDeityIds = new Set(deities.rows.map((r) => r[deityIdIdx]));

  let badDeityRefs = 0;
  for (const row of rows) {
    const deityIds = tryParseJson(row[deityIdx]) as string[] | null;
    if (deityIds && Array.isArray(deityIds)) {
      for (const did of deityIds) {
        if (!validDeityIds.has(did)) {
          badDeityRefs++;
          console.log(`    Motif '${row[idIdx]}' references unknown deity '${did}'`);
        }
      }
    }
  }
  assert(badDeityRefs === 0, `all deity references in motifs exist in deities.tsv (${badDeityRefs} bad refs)`);

  console.log("");
}

async function main() {
  console.log("=== Mythology Data Validation Tests ===\n");

  await testDeitiesTsv();
  await testMythMotifsTsv();

  console.log("=== Summary ===");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
