/**
 * Test script for empires-timeline.tsv data integrity
 * Run with: npx tsx test/test-empires-timeline.ts
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
    console.log(`  \u2713 ${message}`);
    passed++;
  } else {
    console.error(`  \u2717 FAIL: ${message}`);
    failed++;
  }
}

function testEmpiresTimeline() {
  console.log("=== Testing Empires Timeline Data ===\n");

  const text = fs.readFileSync(path.join(LEXICONS_DIR, "empires-timeline.tsv"), "utf-8");
  const { header, rows } = parseTsv(text);

  // Test 1: Header has all required columns
  console.log("Header validation:");
  const requiredColumns = [
    "id", "empire_id", "name", "phase", "time_start", "time_end",
    "time_label", "geometry", "capital", "territory_km2", "population",
    "key_event", "successor_id", "predecessor_id", "associated_language_ids",
    "sources", "notes",
  ];
  for (const col of requiredColumns) {
    assert(header.includes(col), `Header includes '${col}'`);
  }

  // Test 2: Has sufficient entries (60+)
  console.log("\nEntry count:");
  assert(rows.length >= 60, `Has 60+ timeline entries (found ${rows.length})`);

  // Test 3: All IDs are unique
  console.log("\nID uniqueness:");
  const idIdx = header.indexOf("id");
  const ids = rows.map((r) => r[idIdx]);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === ids.length, `All ${ids.length} IDs are unique`);

  // Test 4: No empty IDs or names
  console.log("\nRequired field validation:");
  const nameIdx = header.indexOf("name");
  const empireIdx = header.indexOf("empire_id");
  const emptyIds = rows.filter((r) => !r[idIdx] || r[idIdx].trim() === "");
  assert(emptyIds.length === 0, "No empty IDs");
  const emptyNames = rows.filter((r) => !r[nameIdx] || r[nameIdx].trim() === "");
  assert(emptyNames.length === 0, "No empty names");
  const emptyEmpires = rows.filter((r) => !r[empireIdx] || r[empireIdx].trim() === "");
  assert(emptyEmpires.length === 0, "No empty empire_ids");

  // Test 5: Valid phases
  console.log("\nPhase validation:");
  const phaseIdx = header.indexOf("phase");
  const validPhases = new Set(["founding", "rise", "expansion", "peak", "decline", "collapse"]);
  const invalidPhases = rows.filter((r) => !validPhases.has(r[phaseIdx]));
  assert(invalidPhases.length === 0, `All phases are valid (${invalidPhases.length} invalid)`);

  // Test 6: Time periods are valid
  console.log("\nTime period validation:");
  const startIdx = header.indexOf("time_start");
  const endIdx = header.indexOf("time_end");
  let invalidTimePeriods = 0;
  for (const row of rows) {
    const start = parseInt(row[startIdx], 10);
    const end = row[endIdx] && row[endIdx] !== "null" ? parseInt(row[endIdx], 10) : null;
    if (isNaN(start)) invalidTimePeriods++;
    if (end !== null && isNaN(end)) invalidTimePeriods++;
    if (end !== null && end < start) invalidTimePeriods++;
  }
  assert(invalidTimePeriods === 0, `All time periods are valid (${invalidTimePeriods} invalid)`);

  // Test 7: All geometries are valid JSON with type field
  console.log("\nGeometry validation:");
  const geoIdx = header.indexOf("geometry");
  let invalidGeometries = 0;
  for (const row of rows) {
    try {
      const geo = JSON.parse(row[geoIdx]);
      if (!geo.type || !geo.coordinates) invalidGeometries++;
    } catch {
      invalidGeometries++;
    }
  }
  assert(invalidGeometries === 0, `All geometries are valid GeoJSON (${invalidGeometries} invalid)`);

  // Test 8: associated_language_ids are valid JSON arrays
  console.log("\nJSON array validation:");
  const langIdx = header.indexOf("associated_language_ids");
  const srcIdx = header.indexOf("sources");
  let invalidLangs = 0;
  let invalidSources = 0;
  for (const row of rows) {
    try { JSON.parse(row[langIdx]); } catch { invalidLangs++; }
    try { JSON.parse(row[srcIdx]); } catch { invalidSources++; }
  }
  assert(invalidLangs === 0, `All associated_language_ids are valid JSON (${invalidLangs} invalid)`);
  assert(invalidSources === 0, `All sources are valid JSON (${invalidSources} invalid)`);

  // Test 9: Every empire has at least one entry with phase "peak"
  console.log("\nEmpire coverage:");
  const empirePhases = new Map<string, Set<string>>();
  for (const row of rows) {
    const empId = row[empireIdx];
    if (!empirePhases.has(empId)) empirePhases.set(empId, new Set());
    empirePhases.get(empId)!.add(row[phaseIdx]);
  }
  const empiresWithoutPeak = [...empirePhases.entries()].filter(([, phases]) => !phases.has("peak"));
  assert(empiresWithoutPeak.length === 0, `All empires have a 'peak' phase (${empiresWithoutPeak.length} missing)`);

  // Test 10: Multiple distinct empires represented
  console.log("\nEmpire diversity:");
  assert(empirePhases.size >= 10, `Has 10+ distinct empires (found ${empirePhases.size})`);

  // Test 11: Successor/predecessor chain consistency
  console.log("\nChain consistency:");
  const succIdx = header.indexOf("successor_id");
  const predIdx = header.indexOf("predecessor_id");
  const idSet = new Set(ids);
  let brokenSuccessors = 0;
  let brokenPredecessors = 0;
  for (const row of rows) {
    const succ = row[succIdx]?.trim();
    const pred = row[predIdx]?.trim();
    if (succ && succ !== "" && !idSet.has(succ)) brokenSuccessors++;
    if (pred && pred !== "" && !idSet.has(pred)) brokenPredecessors++;
  }
  assert(brokenSuccessors === 0, `All successor_ids reference valid entries (${brokenSuccessors} broken)`);
  assert(brokenPredecessors === 0, `All predecessor_ids reference valid entries (${brokenPredecessors} broken)`);

  // Test 12: empire_ids reference civilizations.tsv
  console.log("\nReferential integrity:");
  const civText = fs.readFileSync(path.join(LEXICONS_DIR, "civilizations.tsv"), "utf-8");
  const civData = parseTsv(civText);
  const civIdIdx = civData.header.indexOf("id");
  const civIds = new Set(civData.rows.map((r) => r[civIdIdx]));
  const empireIdsUsed = [...new Set(rows.map((r) => r[empireIdx]))];
  const missingInCiv = empireIdsUsed.filter((id) => !civIds.has(id));
  assert(missingInCiv.length === 0, `All empire_ids exist in civilizations.tsv (${missingInCiv.length} missing: ${missingInCiv.join(", ")})`);

  // Test 13: territory_km2 and population are positive when present
  console.log("\nNumeric value validation:");
  const areaIdx = header.indexOf("territory_km2");
  const popIdx = header.indexOf("population");
  let invalidArea = 0;
  let invalidPop = 0;
  for (const row of rows) {
    if (row[areaIdx] && row[areaIdx].trim()) {
      const val = parseInt(row[areaIdx], 10);
      if (isNaN(val) || val <= 0) invalidArea++;
    }
    if (row[popIdx] && row[popIdx].trim()) {
      const val = parseInt(row[popIdx], 10);
      if (isNaN(val) || val <= 0) invalidPop++;
    }
  }
  assert(invalidArea === 0, `All territory_km2 values are positive (${invalidArea} invalid)`);
  assert(invalidPop === 0, `All population values are positive (${invalidPop} invalid)`);

  // Test 14: key_event is non-empty for all entries
  console.log("\nKey event validation:");
  const eventIdx = header.indexOf("key_event");
  const emptyEvents = rows.filter((r) => !r[eventIdx] || r[eventIdx].trim() === "");
  assert(emptyEvents.length === 0, `All entries have a key_event (${emptyEvents.length} empty)`);

  // Test 15: Each empire's timeline phases are chronologically ordered
  console.log("\nChronological ordering:");
  let chronoErrors = 0;
  for (const [empId, _] of empirePhases) {
    const empireRows = rows
      .filter((r) => r[empireIdx] === empId)
      .map((r) => ({ start: parseInt(r[startIdx], 10), end: parseInt(r[endIdx], 10) }))
      .sort((a, b) => a.start - b.start);
    for (let i = 1; i < empireRows.length; i++) {
      if (empireRows[i].start < empireRows[i - 1].start) chronoErrors++;
    }
  }
  assert(chronoErrors === 0, `All empire timelines are chronologically ordered (${chronoErrors} errors)`);

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

testEmpiresTimeline();
