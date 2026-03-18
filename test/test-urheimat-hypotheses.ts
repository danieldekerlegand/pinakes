/**
 * Validation tests for urheimat-hypotheses.tsv
 * Run with: npx tsx test/test-urheimat-hypotheses.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TSV_PATH = path.join(__dirname, "..", "lexicons", "urheimat-hypotheses.tsv");
const FAMILIES_PATH = path.join(__dirname, "..", "lexicons", "families.tsv");

const REQUIRED_COLUMNS = [
  "id",
  "language_family_id",
  "hypothesis_name",
  "proposed_region",
  "proposed_coordinates",
  "proposed_boundary",
  "time_range_start",
  "time_range_end",
  "supporting_evidence",
  "competing_hypotheses",
  "scholarly_consensus_level",
  "key_proponents",
  "sources",
];

const VALID_CONSENSUS_LEVELS = ["high", "medium", "low"];

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function parseRows(content: string): string[][] {
  return content
    .trim()
    .split("\n")
    .map((line) => line.split("\t"));
}

function loadFamilyIds(): Set<string> {
  const content = fs.readFileSync(FAMILIES_PATH, "utf-8");
  const rows = parseRows(content);
  const ids = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    ids.add(rows[i][0]);
  }
  return ids;
}

async function runTests() {
  console.log("=== Urheimat Hypotheses TSV Validation ===\n");

  // Test 1: File exists
  console.log("1. File existence:");
  const fileExists = fs.existsSync(TSV_PATH);
  assert(fileExists, "urheimat-hypotheses.tsv exists");
  if (!fileExists) {
    console.log("\nCannot continue without the file.");
    process.exit(1);
  }

  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const rows = parseRows(content);
  const header = rows[0];
  const dataRows = rows.slice(1);

  // Test 2: Column structure
  console.log("\n2. Column structure:");
  assert(header.length === REQUIRED_COLUMNS.length, `Header has ${REQUIRED_COLUMNS.length} columns (got ${header.length})`);
  for (const col of REQUIRED_COLUMNS) {
    assert(header.includes(col), `Column "${col}" present in header`);
  }

  // Test 3: Data volume (20+ hypotheses required)
  console.log("\n3. Data volume:");
  assert(dataRows.length >= 20, `At least 20 hypotheses present (got ${dataRows.length})`);

  // Test 4: All rows have correct number of columns
  console.log("\n4. Row integrity:");
  let allRowsValid = true;
  for (let i = 0; i < dataRows.length; i++) {
    if (dataRows[i].length !== REQUIRED_COLUMNS.length) {
      console.log(`  ✗ Row ${i + 2} has ${dataRows[i].length} columns instead of ${REQUIRED_COLUMNS.length}`);
      allRowsValid = false;
      failed++;
    }
  }
  if (allRowsValid) {
    assert(true, `All ${dataRows.length} rows have ${REQUIRED_COLUMNS.length} columns`);
  }

  // Test 5: Unique IDs
  console.log("\n5. Unique IDs:");
  const ids = dataRows.map((r) => r[header.indexOf("id")]);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === ids.length, `All IDs are unique (${uniqueIds.size}/${ids.length})`);

  // Test 6: ID format (kebab-case)
  console.log("\n6. ID format:");
  const kebabRegex = /^[a-z][a-z0-9-]+$/;
  const badIds = ids.filter((id) => !kebabRegex.test(id));
  assert(badIds.length === 0, `All IDs are kebab-case${badIds.length > 0 ? ` (bad: ${badIds.join(", ")})` : ""}`);

  // Test 7: Valid language_family_ids (foreign key check)
  console.log("\n7. Language family foreign keys:");
  const familyIds = loadFamilyIds();
  const familyColIdx = header.indexOf("language_family_id");
  const usedFamilyIds = dataRows.map((r) => r[familyColIdx]);
  const invalidFamilyIds = usedFamilyIds.filter((id) => !familyIds.has(id));
  assert(
    invalidFamilyIds.length === 0,
    `All language_family_ids exist in families.tsv${invalidFamilyIds.length > 0 ? ` (invalid: ${[...new Set(invalidFamilyIds)].join(", ")})` : ""}`
  );

  // Test 8: Coordinates are valid JSON with lat/lng
  console.log("\n8. Proposed coordinates:");
  const coordIdx = header.indexOf("proposed_coordinates");
  let coordsValid = true;
  for (let i = 0; i < dataRows.length; i++) {
    try {
      const coord = JSON.parse(dataRows[i][coordIdx]);
      if (typeof coord.lat !== "number" || typeof coord.lng !== "number") {
        console.log(`  ✗ Row ${i + 2} (${ids[i]}): coordinates missing lat/lng`);
        coordsValid = false;
        failed++;
      }
      if (coord.lat < -90 || coord.lat > 90 || coord.lng < -180 || coord.lng > 180) {
        console.log(`  ✗ Row ${i + 2} (${ids[i]}): coordinates out of range`);
        coordsValid = false;
        failed++;
      }
    } catch {
      console.log(`  ✗ Row ${i + 2} (${ids[i]}): invalid JSON coordinates`);
      coordsValid = false;
      failed++;
    }
  }
  if (coordsValid) assert(true, "All coordinates are valid JSON with lat/lng in range");

  // Test 9: Boundaries are valid GeoJSON Polygons
  console.log("\n9. Proposed boundaries:");
  const boundaryIdx = header.indexOf("proposed_boundary");
  let boundariesValid = true;
  for (let i = 0; i < dataRows.length; i++) {
    try {
      const boundary = JSON.parse(dataRows[i][boundaryIdx]);
      if (boundary.type !== "Polygon") {
        console.log(`  ✗ Row ${i + 2} (${ids[i]}): boundary type is "${boundary.type}", expected "Polygon"`);
        boundariesValid = false;
        failed++;
      }
      if (!Array.isArray(boundary.coordinates) || !Array.isArray(boundary.coordinates[0])) {
        console.log(`  ✗ Row ${i + 2} (${ids[i]}): boundary missing coordinates array`);
        boundariesValid = false;
        failed++;
      }
      // First and last point should be the same (closed polygon)
      const ring = boundary.coordinates[0];
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        console.log(`  ✗ Row ${i + 2} (${ids[i]}): polygon not closed`);
        boundariesValid = false;
        failed++;
      }
    } catch {
      console.log(`  ✗ Row ${i + 2} (${ids[i]}): invalid JSON boundary`);
      boundariesValid = false;
      failed++;
    }
  }
  if (boundariesValid) assert(true, "All boundaries are valid closed GeoJSON Polygons");

  // Test 10: Time ranges are valid
  console.log("\n10. Time ranges:");
  const startIdx = header.indexOf("time_range_start");
  const endIdx = header.indexOf("time_range_end");
  let timesValid = true;
  for (let i = 0; i < dataRows.length; i++) {
    const start = parseInt(dataRows[i][startIdx], 10);
    const end = parseInt(dataRows[i][endIdx], 10);
    if (isNaN(start) || isNaN(end)) {
      console.log(`  ✗ Row ${i + 2} (${ids[i]}): non-numeric time range`);
      timesValid = false;
      failed++;
    } else if (start > end) {
      console.log(`  ✗ Row ${i + 2} (${ids[i]}): start (${start}) > end (${end})`);
      timesValid = false;
      failed++;
    }
  }
  if (timesValid) assert(true, "All time ranges are valid integers with start <= end");

  // Test 11: Supporting evidence is valid JSON with expected keys
  console.log("\n11. Supporting evidence:");
  const evidenceIdx = header.indexOf("supporting_evidence");
  let evidenceValid = true;
  for (let i = 0; i < dataRows.length; i++) {
    try {
      const evidence = JSON.parse(dataRows[i][evidenceIdx]);
      const hasAtLeastOne = evidence.linguistic || evidence.archaeological || evidence.genetic;
      if (!hasAtLeastOne) {
        console.log(`  ✗ Row ${i + 2} (${ids[i]}): evidence missing linguistic/archaeological/genetic`);
        evidenceValid = false;
        failed++;
      }
    } catch {
      console.log(`  ✗ Row ${i + 2} (${ids[i]}): invalid JSON evidence`);
      evidenceValid = false;
      failed++;
    }
  }
  if (evidenceValid) assert(true, "All supporting evidence is valid JSON with expected keys");

  // Test 12: Competing hypotheses are valid JSON arrays referencing existing IDs
  console.log("\n12. Competing hypotheses:");
  const compIdx = header.indexOf("competing_hypotheses");
  let compValid = true;
  for (let i = 0; i < dataRows.length; i++) {
    try {
      const comp = JSON.parse(dataRows[i][compIdx]);
      if (!Array.isArray(comp)) {
        console.log(`  ✗ Row ${i + 2} (${ids[i]}): competing_hypotheses is not an array`);
        compValid = false;
        failed++;
      } else {
        for (const ref of comp) {
          if (!uniqueIds.has(ref)) {
            console.log(`  ✗ Row ${i + 2} (${ids[i]}): references unknown hypothesis "${ref}"`);
            compValid = false;
            failed++;
          }
        }
      }
    } catch {
      console.log(`  ✗ Row ${i + 2} (${ids[i]}): invalid JSON competing_hypotheses`);
      compValid = false;
      failed++;
    }
  }
  if (compValid) assert(true, "All competing_hypotheses are valid JSON arrays with valid references");

  // Test 13: Scholarly consensus level
  console.log("\n13. Scholarly consensus level:");
  const consensusIdx = header.indexOf("scholarly_consensus_level");
  const invalidConsensus = dataRows.filter((r) => !VALID_CONSENSUS_LEVELS.includes(r[consensusIdx]));
  assert(
    invalidConsensus.length === 0,
    `All consensus levels are valid (high/medium/low)${invalidConsensus.length > 0 ? ` (invalid in rows: ${invalidConsensus.map((r) => r[0]).join(", ")})` : ""}`
  );

  // Test 14: Key proponents and sources are valid JSON arrays
  console.log("\n14. Key proponents and sources:");
  const propIdx = header.indexOf("key_proponents");
  const srcIdx = header.indexOf("sources");
  let arraysValid = true;
  for (let i = 0; i < dataRows.length; i++) {
    try {
      const proponents = JSON.parse(dataRows[i][propIdx]);
      if (!Array.isArray(proponents) || proponents.length === 0) {
        console.log(`  ✗ Row ${i + 2} (${ids[i]}): key_proponents is not a non-empty array`);
        arraysValid = false;
        failed++;
      }
    } catch {
      console.log(`  ✗ Row ${i + 2} (${ids[i]}): invalid JSON key_proponents`);
      arraysValid = false;
      failed++;
    }
    try {
      const sources = JSON.parse(dataRows[i][srcIdx]);
      if (!Array.isArray(sources) || sources.length === 0) {
        console.log(`  ✗ Row ${i + 2} (${ids[i]}): sources is not a non-empty array`);
        arraysValid = false;
        failed++;
      }
    } catch {
      console.log(`  ✗ Row ${i + 2} (${ids[i]}): invalid JSON sources`);
      arraysValid = false;
      failed++;
    }
  }
  if (arraysValid) assert(true, "All key_proponents and sources are valid non-empty JSON arrays");

  // Test 15: Coverage of major language family debates
  console.log("\n15. Coverage of major language family debates:");
  const requiredFamilies = [
    "indo_european",
    "afro_asiatic",
    "austronesian__austronesian",
    "niger_congo__bantu",
    "uralic",
    "sino_tibetan__sino_tibetan",
    "dravidian",
    "turkic__turkic",
    "kartvelian",
  ];
  const coveredFamilies = new Set(usedFamilyIds);
  for (const fam of requiredFamilies) {
    assert(coveredFamilies.has(fam), `Covers ${fam}`);
  }

  // Test 16: Competing hypotheses are bidirectional
  console.log("\n16. Competing hypotheses bidirectionality:");
  let bidirectionalValid = true;
  for (let i = 0; i < dataRows.length; i++) {
    const id = ids[i];
    const comp = JSON.parse(dataRows[i][compIdx]) as string[];
    for (const ref of comp) {
      const refRow = dataRows.find((r) => r[header.indexOf("id")] === ref);
      if (refRow) {
        const refComp = JSON.parse(refRow[compIdx]) as string[];
        if (!refComp.includes(id)) {
          console.log(`  ✗ ${id} references ${ref} but ${ref} doesn't reference ${id}`);
          bidirectionalValid = false;
          failed++;
        }
      }
    }
  }
  if (bidirectionalValid) assert(true, "All competing hypothesis references are bidirectional");

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
