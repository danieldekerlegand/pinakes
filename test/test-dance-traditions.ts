/**
 * Test script for dance-traditions.tsv data integrity
 * Run with: npx tsx test/test-dance-traditions.ts
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TSV_PATH = path.join(__dirname, "..", "lexicons", "dance-traditions.tsv");

const REQUIRED_COLUMNS = [
  "id",
  "name",
  "native_name",
  "region",
  "coordinates",
  "time_origin",
  "time_end",
  "dance_type",
  "origin_culture",
  "associated_music_traditions",
  "movement_characteristics",
  "costume_requirements",
  "cultural_significance",
  "related_dances",
  "sources",
];

const VALID_DANCE_TYPES = ["ceremonial", "social", "performative", "martial"];

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function testFileExists(): void {
  console.log("\n=== File Existence ===");
  assert(fs.existsSync(TSV_PATH), "dance-traditions.tsv exists");
}

function parseTsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = (lines.shift() ?? "").split("\t");
  const rows = lines.map((l) => l.split("\t"));
  return { header, rows };
}

function testStructure(): void {
  console.log("\n=== TSV Structure ===");
  const text = fs.readFileSync(TSV_PATH, "utf8");
  const { header, rows } = parseTsv(text);

  // Check all required columns exist
  for (const col of REQUIRED_COLUMNS) {
    assert(header.includes(col), `Header contains '${col}' column`);
  }

  // Check minimum row count (30+ required by PRD)
  assert(rows.length >= 30, `Has 30+ entries (found ${rows.length})`);

  // Check all rows have same number of columns as header
  for (const row of rows) {
    assert(
      row.length === header.length,
      `Row '${row[0]}' has correct column count (${row.length}/${header.length})`
    );
  }
}

function testDataIntegrity(): void {
  console.log("\n=== Data Integrity ===");
  const text = fs.readFileSync(TSV_PATH, "utf8");
  const { header, rows } = parseTsv(text);

  const idIdx = header.indexOf("id");
  const nameIdx = header.indexOf("name");
  const coordIdx = header.indexOf("coordinates");
  const timeOriginIdx = header.indexOf("time_origin");
  const timeEndIdx = header.indexOf("time_end");
  const danceTypeIdx = header.indexOf("dance_type");
  const musicIdx = header.indexOf("associated_music_traditions");
  const movementIdx = header.indexOf("movement_characteristics");
  const costumeIdx = header.indexOf("costume_requirements");
  const relatedIdx = header.indexOf("related_dances");
  const sourcesIdx = header.indexOf("sources");

  // Check unique IDs
  const ids = rows.map((r) => r[idIdx]);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === ids.length, "All IDs are unique");

  // Check ID format (kebab-case)
  for (const id of ids) {
    assert(
      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id),
      `ID '${id}' is valid kebab-case`
    );
  }

  // Check each row's data
  for (const row of rows) {
    const id = row[idIdx];
    const name = row[nameIdx];

    // Non-empty name
    assert(name.length > 0, `'${id}' has a name`);

    // Valid coordinates JSON
    try {
      const coords = JSON.parse(row[coordIdx]);
      assert(
        typeof coords.lat === "number" && typeof coords.lng === "number",
        `'${id}' has valid coordinates`
      );
      assert(
        coords.lat >= -90 && coords.lat <= 90,
        `'${id}' latitude in range`
      );
      assert(
        coords.lng >= -180 && coords.lng <= 180,
        `'${id}' longitude in range`
      );
    } catch {
      assert(false, `'${id}' has parseable coordinates JSON`);
    }

    // Valid time_origin (number)
    const timeOrigin = row[timeOriginIdx];
    assert(
      timeOrigin === "null" || !isNaN(Number(timeOrigin)),
      `'${id}' has valid time_origin`
    );

    // Valid time_end (number or null)
    const timeEnd = row[timeEndIdx];
    assert(
      timeEnd === "null" || !isNaN(Number(timeEnd)),
      `'${id}' has valid time_end`
    );

    // Valid dance_type
    const danceType = row[danceTypeIdx];
    assert(
      VALID_DANCE_TYPES.includes(danceType),
      `'${id}' has valid dance_type '${danceType}'`
    );

    // Valid JSON arrays
    for (const [idx, field] of [
      [musicIdx, "associated_music_traditions"],
      [movementIdx, "movement_characteristics"],
      [costumeIdx, "costume_requirements"],
      [relatedIdx, "related_dances"],
      [sourcesIdx, "sources"],
    ] as [number, string][]) {
      try {
        const arr = JSON.parse(row[idx]);
        assert(Array.isArray(arr), `'${id}' ${field} is a JSON array`);
      } catch {
        assert(false, `'${id}' ${field} is valid JSON`);
      }
    }
  }
}

function testCrossReferences(): void {
  console.log("\n=== Cross-References ===");
  const text = fs.readFileSync(TSV_PATH, "utf8");
  const { header, rows } = parseTsv(text);

  const idIdx = header.indexOf("id");
  const relatedIdx = header.indexOf("related_dances");

  const allIds = new Set(rows.map((r) => r[idIdx]));

  // Check that related_dances references are internally consistent where possible
  let internalRefs = 0;
  let totalRefs = 0;
  for (const row of rows) {
    const related = JSON.parse(row[relatedIdx]) as string[];
    for (const ref of related) {
      totalRefs++;
      if (allIds.has(ref)) internalRefs++;
    }
  }

  console.log(
    `  Info: ${internalRefs}/${totalRefs} related_dances references are internal`
  );
  assert(internalRefs > 0, "At least some related_dances cross-reference internally");
}

// Run all tests
console.log("=== Dance Traditions TSV Test Suite ===");
testFileExists();
testStructure();
testDataIntegrity();
testCrossReferences();

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
