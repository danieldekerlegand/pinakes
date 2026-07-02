/**
 * Test script for civilizations data integrity
 * Run with: npx tsx test/test-civilizations.ts
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

function testCivilizations() {
  console.log("=== Testing Civilizations Data ===\n");

  const civText = fs.readFileSync(path.join(LEXICONS_DIR, "civilizations.tsv"), "utf-8");
  const { header, rows } = parseTsv(civText);

  // Test 1: Header has all required columns
  console.log("Header validation:");
  const requiredColumns = [
    "id", "name", "time_period_start", "time_period_end",
    "time_period_label", "associated_language_ids", "writing_systems",
    "political_structure", "sources", "description",
  ];
  for (const col of requiredColumns) {
    assert(header.includes(col), `Header includes '${col}'`);
  }

  // Test 2: Has 80+ entries
  console.log("\nEntry count:");
  assert(rows.length >= 80, `Has 80+ civilization entries (found ${rows.length})`);

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
  assert(emptyIds.length === 0, `No empty IDs`);
  const emptyNames = rows.filter((r) => !r[nameIdx] || r[nameIdx].trim() === "");
  assert(emptyNames.length === 0, `No empty names`);

  // Test 5: Time periods are valid numbers
  console.log("\nTime period validation:");
  const startIdx = header.indexOf("time_period_start");
  const endIdx = header.indexOf("time_period_end");
  let invalidTimePeriods = 0;
  for (const row of rows) {
    const start = parseInt(row[startIdx], 10);
    const end = row[endIdx] && row[endIdx] !== "null" ? parseInt(row[endIdx], 10) : null;
    if (isNaN(start)) invalidTimePeriods++;
    if (end !== null && isNaN(end)) invalidTimePeriods++;
    if (end !== null && end < start) invalidTimePeriods++;
  }
  assert(invalidTimePeriods === 0, `All time periods are valid (${invalidTimePeriods} invalid)`);

  // Test 6: JSON arrays parse correctly
  console.log("\nJSON field validation:");
  const langIdx = header.indexOf("associated_language_ids");
  const writIdx = header.indexOf("writing_systems");
  const srcIdx = header.indexOf("sources");
  let jsonErrors = 0;
  for (const row of rows) {
    for (const idx of [langIdx, writIdx, srcIdx]) {
      if (idx >= 0 && row[idx] && row[idx].trim()) {
        try {
          const parsed = JSON.parse(row[idx]);
          if (!Array.isArray(parsed)) jsonErrors++;
        } catch {
          jsonErrors++;
        }
      }
    }
  }
  assert(jsonErrors === 0, `All JSON array fields parse correctly (${jsonErrors} errors)`);

  // Test 7: Regional diversity - check for civilizations from multiple regions
  console.log("\nRegional diversity:");
  const allNames = rows.map((r) => r[nameIdx]);
  const regions = {
    "East Asia": ["Han Dynasty", "Tang Dynasty", "Song Dynasty", "Ming Dynasty", "Qing Dynasty", "Shang Dynasty", "Zhou Dynasty"],
    "Southeast Asia": ["Srivijaya", "Majapahit", "Khmer Empire", "Ayutthaya Kingdom", "Pagan Kingdom"],
    "South Asia": ["Maurya Empire", "Gupta Empire", "Chola Dynasty", "Vijayanagara Empire", "Delhi Sultanate"],
    "Middle East": ["Persian Empire (Achaemenid)", "Sasanian Empire", "Safavid Empire", "Seljuk Empire"],
    "Africa": ["Kingdom of Kush", "Kingdom of Axum", "Mali Empire", "Songhai Empire", "Great Zimbabwe"],
    "Americas": ["Aztec Empire", "Inca Empire", "Maya Civilization", "Olmec Civilization", "Mississippian Culture"],
    "Europe": ["Roman Empire", "Byzantine Empire", "Carolingian Empire", "Kievan Rus"],
  };
  for (const [region, expected] of Object.entries(regions)) {
    const found = expected.filter((name) => allNames.includes(name));
    assert(found.length >= 3, `${region}: has ${found.length}/${expected.length} expected civilizations`);
  }

  return { ids, header };
}

function testBoundaries(civIds: Set<string>) {
  console.log("\n=== Testing Civilization Boundaries Data ===\n");

  const boundText = fs.readFileSync(path.join(LEXICONS_DIR, "civilization-boundaries.tsv"), "utf-8");
  const { header, rows } = parseTsv(boundText);

  // Test 1: Header has all required columns
  console.log("Header validation:");
  const requiredColumns = [
    "id", "civilization_id", "geometry", "time_period_start",
    "time_period_end", "time_period_label", "boundary_type", "confidence",
  ];
  for (const col of requiredColumns) {
    assert(header.includes(col), `Header includes '${col}'`);
  }

  // Test 2: Has 150+ boundary snapshots
  console.log("\nEntry count:");
  assert(rows.length >= 150, `Has 150+ boundary snapshots (found ${rows.length})`);

  // Test 3: All boundary IDs are unique
  console.log("\nID uniqueness:");
  const idIdx = header.indexOf("id");
  const ids = rows.map((r) => r[idIdx]);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === ids.length, `All ${ids.length} boundary IDs are unique`);

  // Test 4: All civilization_ids reference existing civilizations
  console.log("\nReferential integrity:");
  const civIdIdx = header.indexOf("civilization_id");
  const orphanBoundaries = rows.filter((r) => !civIds.has(r[civIdIdx]));
  assert(
    orphanBoundaries.length === 0,
    `All boundaries reference existing civilizations (${orphanBoundaries.length} orphans${
      orphanBoundaries.length > 0 ? ": " + orphanBoundaries.map((r) => `${r[idIdx]}->${r[civIdIdx]}`).join(", ") : ""
    })`,
  );

  // Test 5: All geometries are valid GeoJSON
  console.log("\nGeometry validation:");
  const geoIdx = header.indexOf("geometry");
  let geoErrors = 0;
  for (const row of rows) {
    if (!row[geoIdx]) { geoErrors++; continue; }
    try {
      const geo = JSON.parse(row[geoIdx]);
      if (!geo.type || !geo.coordinates) geoErrors++;
      if (!["Polygon", "MultiPolygon"].includes(geo.type)) geoErrors++;
    } catch {
      geoErrors++;
    }
  }
  assert(geoErrors === 0, `All geometries are valid GeoJSON Polygon/MultiPolygon (${geoErrors} errors)`);

  // Test 6: Boundary types are valid
  console.log("\nBoundary type validation:");
  const btIdx = header.indexOf("boundary_type");
  const validTypes = new Set(["political", "cultural", "linguistic", "military", "economic"]);
  const invalidTypes = rows.filter((r) => !validTypes.has(r[btIdx]));
  assert(invalidTypes.length === 0, `All boundary types are valid (${invalidTypes.length} invalid)`);

  // Test 7: Confidence values are 1-100
  console.log("\nConfidence validation:");
  const confIdx = header.indexOf("confidence");
  let confErrors = 0;
  for (const row of rows) {
    const conf = parseInt(row[confIdx], 10);
    if (isNaN(conf) || conf < 1 || conf > 100) confErrors++;
  }
  assert(confErrors === 0, `All confidence values are 1-100 (${confErrors} errors)`);

  // Test 8: Multiple civilizations have time-varying boundaries (>1 snapshot)
  console.log("\nTime-varying boundaries:");
  const civBoundaryCount = new Map<string, number>();
  for (const row of rows) {
    const civId = row[civIdIdx];
    civBoundaryCount.set(civId, (civBoundaryCount.get(civId) || 0) + 1);
  }
  const multiSnapshotCivs = [...civBoundaryCount.entries()].filter(([, count]) => count >= 2);
  assert(
    multiSnapshotCivs.length >= 20,
    `At least 20 civilizations have multiple boundary snapshots (found ${multiSnapshotCivs.length})`,
  );
}

// Run tests
const { ids } = testCivilizations();
testBoundaries(new Set(ids));

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
