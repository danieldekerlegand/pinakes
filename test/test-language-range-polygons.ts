/**
 * Test script for validating language-range-polygons.tsv data integrity
 * Run with: npx tsx test/test-language-range-polygons.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TSV_PATH = path.join(__dirname, "..", "lexicons", "language-range-polygons.tsv");
const LANGUAGES_TSV = path.join(__dirname, "..", "lexicons", "languages.tsv");
const FAMILIES_TSV = path.join(__dirname, "..", "lexicons", "families.tsv");

const REQUIRED_COLUMNS = [
  "id", "language_id", "family_id", "geometry", "range_type",
  "time_period_start", "time_period_end", "time_period_label",
  "confidence", "sources", "notes",
];

const VALID_RANGE_TYPES = new Set(["current", "historical", "reconstructed"]);

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function parseTsv(filePath: string): { header: string[]; rows: string[][] } {
  const text = fs.readFileSync(filePath, "utf-8").trim();
  const lines = text.split("\n");
  const header = lines[0].split("\t");
  const rows = lines.slice(1).filter((l) => l.trim()).map((l) => l.split("\t"));
  return { header, rows };
}

function run(): void {
  console.log("=== Testing language-range-polygons.tsv ===\n");

  // Test 1: File exists
  const exists = fs.existsSync(TSV_PATH);
  assert(exists, "TSV file should exist");
  if (!exists) {
    console.error("File not found, cannot continue tests.");
    process.exit(1);
  }

  const { header, rows } = parseTsv(TSV_PATH);

  // Test 2: Required columns
  console.log("Checking required columns...");
  for (const col of REQUIRED_COLUMNS) {
    assert(header.includes(col), `Missing required column: ${col}`);
  }

  // Test 3: Minimum 100 entries
  console.log(`Row count: ${rows.length}`);
  assert(rows.length >= 100, `Should have at least 100 entries, got ${rows.length}`);

  // Build column index
  const idx: Record<string, number> = {};
  for (const col of REQUIRED_COLUMNS) {
    idx[col] = header.indexOf(col);
  }

  // Load valid language IDs and family IDs for referential integrity
  const languageIds = new Set<string>();
  const familyIds = new Set<string>();
  if (fs.existsSync(LANGUAGES_TSV)) {
    const { rows: langRows } = parseTsv(LANGUAGES_TSV);
    for (const row of langRows) languageIds.add(row[0]);
  }
  if (fs.existsSync(FAMILIES_TSV)) {
    const { rows: famRows } = parseTsv(FAMILIES_TSV);
    for (const row of famRows) familyIds.add(row[0]);
  }

  // Test each row
  const seenIds = new Set<string>();
  let validGeometryCount = 0;
  let validRangeTypeCount = 0;
  let validConfidenceCount = 0;
  let validSourcesCount = 0;
  let validLanguageRefCount = 0;
  let validFamilyRefCount = 0;

  console.log("\nValidating individual rows...");

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const id = row[idx["id"]];
    const languageId = row[idx["language_id"]];
    const familyId = row[idx["family_id"]];
    const geometry = row[idx["geometry"]];
    const rangeType = row[idx["range_type"]];
    const timeStart = row[idx["time_period_start"]];
    const timeEnd = row[idx["time_period_end"]];
    const confidence = row[idx["confidence"]];
    const sources = row[idx["sources"]];

    // Unique IDs
    if (seenIds.has(id)) {
      assert(false, `Duplicate ID at row ${i + 1}: ${id}`);
    }
    seenIds.add(id);

    // Valid geometry (must be parseable JSON with type Polygon or MultiPolygon)
    try {
      const geo = JSON.parse(geometry);
      if (geo.type === "Polygon" || geo.type === "MultiPolygon") {
        // Validate polygon coordinates are closed (first == last point)
        const rings = geo.type === "Polygon" ? geo.coordinates : geo.coordinates.flat();
        for (const ring of rings) {
          const first = ring[0];
          const last = ring[ring.length - 1];
          if (first[0] === last[0] && first[1] === last[1]) {
            validGeometryCount++;
          } else {
            assert(false, `Row ${i + 1} (${id}): Polygon ring not closed`);
          }
        }
      } else {
        assert(false, `Row ${i + 1} (${id}): Invalid geometry type: ${geo.type}`);
      }
    } catch {
      assert(false, `Row ${i + 1} (${id}): Invalid JSON geometry`);
    }

    // Valid range_type
    if (VALID_RANGE_TYPES.has(rangeType)) {
      validRangeTypeCount++;
    } else {
      assert(false, `Row ${i + 1} (${id}): Invalid range_type: ${rangeType}`);
    }

    // Valid confidence (1-100)
    const confNum = parseInt(confidence, 10);
    if (!isNaN(confNum) && confNum >= 1 && confNum <= 100) {
      validConfidenceCount++;
    } else {
      assert(false, `Row ${i + 1} (${id}): Invalid confidence: ${confidence}`);
    }

    // Valid sources (parseable JSON array)
    try {
      const srcArr = JSON.parse(sources);
      if (Array.isArray(srcArr) && srcArr.length > 0) {
        validSourcesCount++;
      } else {
        assert(false, `Row ${i + 1} (${id}): Sources should be non-empty array`);
      }
    } catch {
      assert(false, `Row ${i + 1} (${id}): Invalid JSON sources`);
    }

    // Valid time periods
    if (timeStart && timeStart !== "null") {
      const startNum = parseInt(timeStart, 10);
      assert(!isNaN(startNum), `Row ${i + 1} (${id}): Invalid time_period_start: ${timeStart}`);
    }
    if (timeEnd && timeEnd !== "null") {
      const endNum = parseInt(timeEnd, 10);
      assert(!isNaN(endNum), `Row ${i + 1} (${id}): Invalid time_period_end: ${timeEnd}`);
    }

    // Referential integrity: language_id exists in languages.tsv
    if (languageIds.size > 0 && languageIds.has(languageId)) {
      validLanguageRefCount++;
    }

    // Referential integrity: family_id exists in families.tsv
    if (familyIds.size > 0 && familyIds.has(familyId)) {
      validFamilyRefCount++;
    }
  }

  // Aggregate assertions
  assert(validGeometryCount === rows.length, `All geometries should be valid closed polygons (${validGeometryCount}/${rows.length})`);
  assert(validRangeTypeCount === rows.length, `All range_types should be valid (${validRangeTypeCount}/${rows.length})`);
  assert(validConfidenceCount === rows.length, `All confidence values should be 1-100 (${validConfidenceCount}/${rows.length})`);
  assert(validSourcesCount === rows.length, `All sources should be valid JSON arrays (${validSourcesCount}/${rows.length})`);

  // Referential integrity (warn rather than fail if reference data unavailable)
  if (languageIds.size > 0) {
    const refRate = ((validLanguageRefCount / rows.length) * 100).toFixed(1);
    console.log(`\nLanguage ID referential integrity: ${validLanguageRefCount}/${rows.length} (${refRate}%)`);
    assert(validLanguageRefCount > rows.length * 0.9, `At least 90% of language_ids should exist in languages.tsv`);
  }
  if (familyIds.size > 0) {
    const refRate = ((validFamilyRefCount / rows.length) * 100).toFixed(1);
    console.log(`Family ID referential integrity: ${validFamilyRefCount}/${rows.length} (${refRate}%)`);
    assert(validFamilyRefCount > rows.length * 0.9, `At least 90% of family_ids should exist in families.tsv`);
  }

  // Test: Mix of range types
  const rangeTypes = new Set(rows.map((r) => r[idx["range_type"]]));
  assert(rangeTypes.has("current"), "Should include 'current' range type entries");
  assert(rangeTypes.has("historical"), "Should include 'historical' range type entries");
  console.log(`\nRange types present: ${[...rangeTypes].join(", ")}`);

  // Test: Geographic diversity (check multiple language families)
  const families = new Set(rows.map((r) => r[idx["family_id"]].split("__")[0]));
  console.log(`Language family top-level groups: ${families.size} (${[...families].join(", ")})`);
  assert(families.size >= 5, `Should cover at least 5 language family groups, got ${families.size}`);

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
