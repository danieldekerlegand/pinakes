/**
 * Test script for verifying architectural-styles.tsv data integrity
 * Run with: npx tsx test/test-architectural-styles.ts
 */

import fs from "node:fs";
import path from "node:path";

const TSV_PATH = path.join(import.meta.dirname, "../lexicons/architectural-styles.tsv");

const EXPECTED_HEADERS = [
  "id", "name", "region", "time_start", "time_end",
  "characteristics", "materials", "structural_innovations",
  "associated_civilizations", "influences", "notable_examples", "sources"
];

const REQUIRED_STYLES = [
  "Megalithic", "Egyptian", "Mesopotamian", "Classical Greek",
  "Roman", "Byzantine", "Gothic", "Islamic", "Hindu Temple",
  "Chinese Imperial", "Mesoamerican", "Khmer", "Japanese",
  "Art Deco", "Brutalist"
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
  console.log("=== Testing architectural-styles.tsv ===\n");

  // 1. File exists
  const exists = fs.existsSync(TSV_PATH);
  assert(exists, "File exists at lexicons/architectural-styles.tsv");
  if (!exists) {
    console.log("\nCannot continue without file.");
    process.exit(1);
  }

  const content = fs.readFileSync(TSV_PATH, "utf-8");
  const lines = content.trim().split("\n");
  const headers = lines[0].split("\t");
  const dataRows = lines.slice(1);

  // 2. Headers match spec
  console.log("\n--- Header Validation ---");
  assert(
    JSON.stringify(headers) === JSON.stringify(EXPECTED_HEADERS),
    `Headers match specification (${headers.length} columns)`
  );

  // 3. Row count
  console.log("\n--- Row Count ---");
  assert(dataRows.length >= 20, `Has at least 20 styles (found ${dataRows.length})`);

  // 4. Parse all rows
  console.log("\n--- Data Integrity ---");
  const rows = dataRows.map((line, idx) => {
    const cols = line.split("\t");
    return {
      lineNum: idx + 2,
      id: cols[0],
      name: cols[1],
      region: cols[2],
      time_start: cols[3],
      time_end: cols[4],
      characteristics: cols[5],
      materials: cols[6],
      structural_innovations: cols[7],
      associated_civilizations: cols[8],
      influences: cols[9],
      notable_examples: cols[10],
      sources: cols[11],
    };
  });

  // 5. All rows have correct column count
  const correctColCount = dataRows.every(line => line.split("\t").length === EXPECTED_HEADERS.length);
  assert(correctColCount, "All rows have correct number of columns");

  // 6. Unique IDs
  const ids = rows.map(r => r.id);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === ids.length, `All IDs are unique (${uniqueIds.size}/${ids.length})`);

  // 7. ID format (kebab-case with prefix)
  const validIdFormat = rows.every(r => /^arch-\d{3}$/.test(r.id));
  assert(validIdFormat, "All IDs follow arch-NNN format");

  // 8. All names are non-empty
  const allNamed = rows.every(r => r.name && r.name.length > 0);
  assert(allNamed, "All styles have names");

  // 9. time_start is numeric
  const validStarts = rows.every(r => !isNaN(Number(r.time_start)));
  assert(validStarts, "All time_start values are numeric");

  // 10. time_end is numeric or null
  const validEnds = rows.every(r => r.time_end === "null" || !isNaN(Number(r.time_end)));
  assert(validEnds, "All time_end values are numeric or null");

  // 11. time_start < time_end where both are numeric
  const validTimeRanges = rows.every(r => {
    if (r.time_end === "null") return true;
    return Number(r.time_start) < Number(r.time_end);
  });
  assert(validTimeRanges, "time_start < time_end for all rows with both dates");

  // 12. JSON array fields parse correctly
  console.log("\n--- JSON Field Validation ---");
  const jsonFields = ["characteristics", "materials", "structural_innovations", "notable_examples", "sources"] as const;
  for (const field of jsonFields) {
    const allValid = rows.every(r => {
      try {
        const parsed = JSON.parse(r[field]);
        return Array.isArray(parsed) && parsed.length > 0;
      } catch {
        console.log(`    Parse error in ${field} at line ${r.lineNum}: ${r[field]}`);
        return false;
      }
    });
    assert(allValid, `${field} contains valid non-empty JSON arrays`);
  }

  // 13. Associated civilizations and influences are valid JSON arrays or strings
  const civFieldValid = rows.every(r => {
    try {
      const parsed = JSON.parse(r.associated_civilizations);
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      // Could be a plain string list
      return r.associated_civilizations && r.associated_civilizations.length > 0;
    }
  });
  assert(civFieldValid, "associated_civilizations is non-empty for all rows");

  const inflFieldValid = rows.every(r => {
    try {
      const parsed = JSON.parse(r.influences);
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return r.influences && r.influences.length > 0;
    }
  });
  assert(inflFieldValid, "influences is non-empty for all rows");

  // 14. Required styles coverage
  console.log("\n--- Required Styles Coverage ---");
  const nameList = rows.map(r => r.name.toLowerCase());
  for (const style of REQUIRED_STYLES) {
    const found = nameList.some(n => n.includes(style.toLowerCase()));
    assert(found, `Required style "${style}" is present`);
  }

  // 15. No duplicate names
  const names = rows.map(r => r.name);
  const uniqueNames = new Set(names);
  assert(uniqueNames.size === names.length, `All style names are unique (${uniqueNames.size}/${names.length})`);

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
