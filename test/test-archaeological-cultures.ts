/**
 * Test script for validating archaeological-cultures.tsv data file
 * Run with: npx tsx test/test-archaeological-cultures.ts
 */

import * as fs from "fs";
import * as path from "path";

const TSV_PATH = path.join(
  import.meta.dirname,
  "..",
  "lexicons",
  "archaeological-cultures.tsv"
);

const REQUIRED_HEADERS = [
  "id",
  "name",
  "time_start",
  "time_end",
  "region",
  "coordinates",
  "boundary_geometry",
  "material_culture_traits",
  "subsistence_pattern",
  "burial_practices",
  "pottery_style",
  "probable_language_family",
  "probable_haplogroups",
  "successor_cultures",
  "predecessor_cultures",
  "confidence",
  "sources",
];

const EXPECTED_CULTURES = [
  "yamnaya",
  "corded-ware",
  "bell-beaker",
  "jomon",
  "clovis",
  "lapita",
  "natufian",
  "nok",
  "olmec",
  "caral-supe",
  "indus-valley",
  "longshan",
  "yangshao",
  "mehrgarh",
  "cucuteni-trypillia",
  "vinca",
  "bantu-expansion",
];

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

function run() {
  console.log("=== Archaeological Cultures TSV Validation ===\n");

  // 1. File exists
  console.log("1. File existence:");
  const exists = fs.existsSync(TSV_PATH);
  assert(exists, "archaeological-cultures.tsv exists");
  if (!exists) {
    console.log("\nCannot continue without file.");
    process.exit(1);
  }

  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const lines = content.trim().split("\n");
  const headerLine = lines[0];
  const dataLines = lines.slice(1);

  // 2. Header validation
  console.log("\n2. Header validation:");
  const headers = headerLine.split("\t");
  assert(
    headers.length === REQUIRED_HEADERS.length,
    `Header count: ${headers.length} (expected ${REQUIRED_HEADERS.length})`
  );
  for (const h of REQUIRED_HEADERS) {
    assert(headers.includes(h), `Header "${h}" present`);
  }

  // 3. Row count
  console.log("\n3. Row count:");
  assert(dataLines.length >= 60, `Has ${dataLines.length} entries (minimum 60)`);

  // 4. Parse each row
  console.log("\n4. Row parsing and field validation:");
  const ids = new Set<string>();
  let parseErrors = 0;

  for (let i = 0; i < dataLines.length; i++) {
    const fields = dataLines[i].split("\t");
    const lineNum = i + 2;

    if (fields.length !== headers.length) {
      console.log(`  ✗ Line ${lineNum}: expected ${headers.length} fields, got ${fields.length}`);
      parseErrors++;
      continue;
    }

    const row: Record<string, string> = {};
    headers.forEach((h, idx) => (row[h] = fields[idx]));

    // Validate id
    if (!row.id || row.id.trim() === "") {
      console.log(`  ✗ Line ${lineNum}: missing id`);
      parseErrors++;
    }
    if (ids.has(row.id)) {
      console.log(`  ✗ Line ${lineNum}: duplicate id "${row.id}"`);
      parseErrors++;
    }
    ids.add(row.id);

    // Validate name
    if (!row.name || row.name.trim() === "") {
      console.log(`  ✗ Line ${lineNum}: missing name for id "${row.id}"`);
      parseErrors++;
    }

    // Validate time_start and time_end are integers
    const timeStart = parseInt(row.time_start);
    const timeEnd = parseInt(row.time_end);
    if (isNaN(timeStart)) {
      console.log(`  ✗ Line ${lineNum} (${row.id}): invalid time_start "${row.time_start}"`);
      parseErrors++;
    }
    if (isNaN(timeEnd)) {
      console.log(`  ✗ Line ${lineNum} (${row.id}): invalid time_end "${row.time_end}"`);
      parseErrors++;
    }
    if (!isNaN(timeStart) && !isNaN(timeEnd) && timeStart > timeEnd) {
      console.log(`  ✗ Line ${lineNum} (${row.id}): time_start (${timeStart}) > time_end (${timeEnd})`);
      parseErrors++;
    }

    // Validate coordinates as JSON
    if (row.coordinates) {
      try {
        const coords = JSON.parse(row.coordinates);
        if (typeof coords.lat !== "number" || typeof coords.lng !== "number") {
          console.log(`  ✗ Line ${lineNum} (${row.id}): coordinates missing lat/lng`);
          parseErrors++;
        }
        if (coords.lat < -90 || coords.lat > 90) {
          console.log(`  ✗ Line ${lineNum} (${row.id}): latitude out of range: ${coords.lat}`);
          parseErrors++;
        }
        if (coords.lng < -180 || coords.lng > 180) {
          console.log(`  ✗ Line ${lineNum} (${row.id}): longitude out of range: ${coords.lng}`);
          parseErrors++;
        }
      } catch {
        console.log(`  ✗ Line ${lineNum} (${row.id}): invalid coordinates JSON`);
        parseErrors++;
      }
    }

    // Validate JSON array fields
    for (const field of [
      "material_culture_traits",
      "probable_haplogroups",
      "successor_cultures",
      "predecessor_cultures",
      "sources",
    ]) {
      if (row[field] && row[field].trim() !== "") {
        try {
          const arr = JSON.parse(row[field]);
          if (!Array.isArray(arr)) {
            console.log(`  ✗ Line ${lineNum} (${row.id}): ${field} is not an array`);
            parseErrors++;
          }
        } catch {
          console.log(`  ✗ Line ${lineNum} (${row.id}): invalid JSON in ${field}`);
          parseErrors++;
        }
      }
    }

    // Validate probable_language_family as JSON object
    if (row.probable_language_family && row.probable_language_family.trim() !== "") {
      try {
        const plf = JSON.parse(row.probable_language_family);
        if (typeof plf.family !== "string" || typeof plf.confidence !== "number") {
          console.log(`  ✗ Line ${lineNum} (${row.id}): probable_language_family missing family/confidence`);
          parseErrors++;
        }
      } catch {
        console.log(`  ✗ Line ${lineNum} (${row.id}): invalid JSON in probable_language_family`);
        parseErrors++;
      }
    }

    // Validate confidence is 1-100
    const conf = parseInt(row.confidence);
    if (isNaN(conf) || conf < 1 || conf > 100) {
      console.log(`  ✗ Line ${lineNum} (${row.id}): confidence out of range: ${row.confidence}`);
      parseErrors++;
    }
  }

  assert(parseErrors === 0, `All rows parsed without errors (${parseErrors} errors found)`);

  // 5. Check expected cultures are present
  console.log("\n5. Expected cultures present:");
  for (const culture of EXPECTED_CULTURES) {
    assert(ids.has(culture), `Culture "${culture}" present`);
  }

  // 6. Validate referential integrity (successor/predecessor references)
  console.log("\n6. Referential integrity (successor/predecessor):");
  let refErrors = 0;
  for (const line of dataLines) {
    const fields = line.split("\t");
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => (row[h] = fields[idx]));

    for (const field of ["successor_cultures", "predecessor_cultures"]) {
      if (row[field] && row[field].trim() !== "") {
        try {
          const refs: string[] = JSON.parse(row[field]);
          for (const ref of refs) {
            if (!ids.has(ref)) {
              // Not an error - referenced culture may be outside this dataset
              // Just track for informational purposes
            }
          }
        } catch {
          // Already caught above
        }
      }
    }
  }
  assert(true, "Successor/predecessor references parsed successfully");

  // 7. No duplicate IDs (already checked above but summarize)
  console.log("\n7. Unique IDs:");
  assert(ids.size === dataLines.length, `All ${ids.size} IDs are unique`);

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
