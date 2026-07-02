/**
 * Test script for verifying settlements.tsv data and TsvStorage settlements loader
 * Run with: npx tsx test/test-settlements.ts
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
  const rows = lines.slice(1).filter((l) => l.trim()).map((line) => line.split("\t"));
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

async function testSettlementsTsv() {
  console.log("=== Testing settlements.tsv ===\n");

  const filePath = path.resolve(__dirname, "../lexicons/settlements.tsv");
  assert(fs.existsSync(filePath), "settlements.tsv exists");

  const text = fs.readFileSync(filePath, "utf-8");
  const { header, rows } = parseTsv(text);

  // Check required columns
  const requiredColumns = [
    "id", "name", "alternate_names", "latitude", "longitude", "type",
    "culture_id", "civilization_id", "founded_year", "abandoned_year",
    "peak_population", "notable_features", "associated_languages",
    "modern_name", "region",
  ];
  for (const col of requiredColumns) {
    assert(header.includes(col), `has column '${col}'`);
  }

  // Check row count
  assert(rows.length >= 50, `has 50+ settlements (found ${rows.length})`);

  // Check all rows have correct number of columns
  const badRows = rows.filter((r) => r.length !== header.length);
  assert(badRows.length === 0, `all rows have ${header.length} columns (${badRows.length} bad rows)`);

  // Check unique IDs
  const idIdx = getIdx(header, "id");
  const ids = rows.map((r) => r[idIdx]);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === ids.length, `all IDs are unique (${uniqueIds.size}/${ids.length})`);

  // Check valid settlement types
  const typeIdx = getIdx(header, "type");
  const validTypes = ["city-state", "capital", "trading-post", "religious-center", "fortress", "port", "colony"];
  const types = rows.map((r) => r[typeIdx]);
  const invalidTypes = types.filter((t) => !validTypes.includes(t));
  assert(invalidTypes.length === 0, `all settlement types are valid (invalid: ${invalidTypes.join(", ")})`);

  // Check coordinates are valid
  const latIdx = getIdx(header, "latitude");
  const lngIdx = getIdx(header, "longitude");
  let coordsValid = true;
  for (const row of rows) {
    const lat = parseFloat(row[latIdx]);
    const lng = parseFloat(row[lngIdx]);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      coordsValid = false;
      console.log(`    Invalid coords for ${row[idIdx]}: lat=${row[latIdx]}, lng=${row[lngIdx]}`);
    }
  }
  assert(coordsValid, "all coordinates are valid (-90≤lat≤90, -180≤lng≤180)");

  // Check JSON array fields parse correctly
  const altIdx = getIdx(header, "alternate_names");
  const featIdx = getIdx(header, "notable_features");
  const langIdx = getIdx(header, "associated_languages");

  let jsonValid = true;
  for (const row of rows) {
    for (const idx of [altIdx, featIdx, langIdx]) {
      if (idx >= 0 && row[idx] && row[idx] !== "[]") {
        const parsed = tryParseJson(row[idx]);
        if (!Array.isArray(parsed)) {
          jsonValid = false;
          console.log(`    Invalid JSON in row ${row[idIdx]}, col ${header[idx]}: ${row[idx]}`);
        }
      }
    }
  }
  assert(jsonValid, "all JSON array fields parse correctly");

  // Check founded_year values are numbers or null
  const foundedIdx = getIdx(header, "founded_year");
  let yearsValid = true;
  for (const row of rows) {
    const val = row[foundedIdx];
    if (val && val !== "null") {
      const year = parseInt(val, 10);
      if (isNaN(year)) {
        yearsValid = false;
        console.log(`    Invalid founded_year for ${row[idIdx]}: ${val}`);
      }
    }
  }
  assert(yearsValid, "all founded_year values are valid numbers or null");

  // Check that every settlement has a name
  const nameIdx = getIdx(header, "name");
  const emptyNames = rows.filter((r) => !r[nameIdx]?.trim());
  assert(emptyNames.length === 0, `all settlements have names (${emptyNames.length} empty)`);

  // Check region diversity
  const regionIdx = getIdx(header, "region");
  const regions = new Set(rows.map((r) => r[regionIdx]));
  assert(regions.size >= 5, `has 5+ distinct regions (found ${regions.size})`);

  // Check type diversity
  const typeSet = new Set(types);
  assert(typeSet.size >= 4, `has 4+ distinct settlement types (found ${typeSet.size})`);
}

async function testSettlementsLoader() {
  console.log("\n=== Testing TsvStorage settlements loader ===\n");

  // Dynamic import to handle the module
  const { TsvStorage } = await import("../server/tsv-storage.js");
  const storage = new TsvStorage();

  // Test getSettlements (no filters)
  const all = await storage.getSettlements();
  assert(all.length >= 50, `loader returns 50+ settlements (found ${all.length})`);

  // Test settlement structure
  const first = all[0];
  assert(typeof first.id === "string" && first.id.length > 0, "settlement has id");
  assert(typeof first.name === "string" && first.name.length > 0, "settlement has name");
  assert(typeof first.latitude === "number", "settlement has numeric latitude");
  assert(typeof first.longitude === "number", "settlement has numeric longitude");
  assert(typeof first.type === "string", "settlement has type");
  assert(Array.isArray(first.notableFeatures), "settlement has notableFeatures array");
  assert(Array.isArray(first.associatedLanguages), "settlement has associatedLanguages array");

  // Test filter by type
  const capitals = await storage.getSettlements({ type: "capital" });
  assert(capitals.length > 0, `filter by type=capital returns results (${capitals.length})`);
  assert(capitals.every((s: any) => s.type === "capital"), "all filtered results have type=capital");

  // Test filter by region
  const mesopotamia = await storage.getSettlements({ region: "Mesopotamia" });
  assert(mesopotamia.length > 0, `filter by region=Mesopotamia returns results (${mesopotamia.length})`);
  assert(
    mesopotamia.every((s: any) => s.region.toLowerCase().includes("mesopotamia")),
    "all filtered results are in Mesopotamia"
  );

  // Test filter by civilization_id
  const roman = await storage.getSettlements({ civilizationId: "roman-empire" });
  assert(roman.length > 0, `filter by civilizationId=roman-empire returns results (${roman.length})`);

  // Test time range filter
  const ancient = await storage.getSettlements({ timeStart: -3000, timeEnd: -1000 });
  assert(ancient.length > 0, `time range filter returns results (${ancient.length})`);

  // Test bounding box filter
  const europeBox = await storage.getSettlements({
    boundingBox: { minLat: 35, maxLat: 60, minLng: -10, maxLng: 40 },
  });
  assert(europeBox.length > 0, `bounding box filter returns results (${europeBox.length})`);
  assert(
    europeBox.every((s: any) => s.latitude >= 35 && s.latitude <= 60 && s.longitude >= -10 && s.longitude <= 40),
    "all bounding box results are within bounds"
  );

  // Test getSettlementById
  const ur = await storage.getSettlementById("ur-settlement");
  assert(ur !== null, "getSettlementById returns Ur");
  assert(ur!.name === "Ur", "Ur settlement has correct name");

  const missing = await storage.getSettlementById("nonexistent-settlement");
  assert(missing === null, "getSettlementById returns null for missing id");

  // Test getSettlementsByCivilization
  const romanCiv = await storage.getSettlementsByCivilization("roman-empire");
  assert(romanCiv.length > 0, `getSettlementsByCivilization returns results (${romanCiv.length})`);
  assert(
    romanCiv.every((s: any) => s.civilizationId.toLowerCase() === "roman-empire"),
    "all civilization results match"
  );

  // Test getSettlementsNearby
  const nearRome = await storage.getSettlementsNearby(41.9, 12.5, 500);
  assert(nearRome.length > 0, `getSettlementsNearby returns results (${nearRome.length})`);
  // Rome should be in the results
  assert(
    nearRome.some((s: any) => s.id === "rome-settlement"),
    "nearby search near Rome includes Rome"
  );
  // Results should be sorted by distance (closest first)
  if (nearRome.length >= 2) {
    const dist = (s: typeof nearRome[0]) => Math.hypot(s.latitude - 41.9, s.longitude - 12.5);
    assert(dist(nearRome[0]) <= dist(nearRome[1]), "nearby results are sorted by distance");
  }
}

async function main() {
  await testSettlementsTsv();
  await testSettlementsLoader();

  console.log("\n=== Summary ===");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
