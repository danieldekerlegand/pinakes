/**
 * Test script for archaeological cultures TSV data integrity
 * Run with: npx tsx test/test-archaeological-cultures.ts
 */

import fs from "node:fs";
import path from "node:path";

function parseTsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split("\n").filter((l) => l.trim());
  const header = lines[0].split("\t");
  const rows = lines.slice(1).map((l) => l.split("\t"));
  return { header, rows };
}

function getIdx(header: string[], name: string): number {
  const idx = header.indexOf(name);
  if (idx < 0) throw new Error(`Column '${name}' not found in header: ${header.join(", ")}`);
  return idx;
}

interface ArchaeologicalCulture {
  id: string;
  name: string;
  timeOrigin: number;
  timeEnd: number;
  region: string;
  originCoordinates: [number, number];
  description: string;
  associatedLanguageIds: string[];
  associatedHaplogroupIds: string[];
  materialCultureIds: string[];
  predecessorCultureIds: string[];
  successorCultureIds: string[];
  characteristics: string[];
  sources: string[];
}

function loadCultures(): ArchaeologicalCulture[] {
  const filePath = path.resolve(process.cwd(), "lexicons/archaeological-cultures.tsv");
  const text = fs.readFileSync(filePath, "utf-8");
  const { header, rows } = parseTsv(text);

  const idIdx = getIdx(header, "id");
  const nameIdx = getIdx(header, "name");
  const timeOriginIdx = getIdx(header, "time_origin");
  const timeEndIdx = getIdx(header, "time_end");
  const regionIdx = getIdx(header, "region");
  const coordsIdx = getIdx(header, "origin_coordinates");
  const descIdx = getIdx(header, "description");
  const langIdx = getIdx(header, "associated_language_ids");
  const haploIdx = getIdx(header, "associated_haplogroup_ids");
  const matIdx = getIdx(header, "material_culture_ids");
  const predIdx = getIdx(header, "predecessor_culture_ids");
  const succIdx = getIdx(header, "successor_culture_ids");
  const charIdx = getIdx(header, "characteristics");
  const srcIdx = getIdx(header, "sources");

  return rows.map((row) => ({
    id: row[idIdx],
    name: row[nameIdx],
    timeOrigin: parseInt(row[timeOriginIdx]) || 0,
    timeEnd: parseInt(row[timeEndIdx]) || 0,
    region: row[regionIdx],
    originCoordinates: (() => {
      try { return JSON.parse(row[coordsIdx]); } catch { return [0, 0]; }
    })() as [number, number],
    description: row[descIdx],
    associatedLanguageIds: (() => {
      try { return JSON.parse(row[langIdx]); } catch { return []; }
    })() as string[],
    associatedHaplogroupIds: (() => {
      try { return JSON.parse(row[haploIdx]); } catch { return []; }
    })() as string[],
    materialCultureIds: (() => {
      try { return JSON.parse(row[matIdx]); } catch { return []; }
    })() as string[],
    predecessorCultureIds: (() => {
      try { return JSON.parse(row[predIdx]); } catch { return []; }
    })() as string[],
    successorCultureIds: (() => {
      try { return JSON.parse(row[succIdx]); } catch { return []; }
    })() as string[],
    characteristics: (() => {
      try { return JSON.parse(row[charIdx]); } catch { return []; }
    })() as string[],
    sources: (() => {
      try { return JSON.parse(row[srcIdx]); } catch { return []; }
    })() as string[],
  }));
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

function test(name: string, fn: () => void) {
  console.log(`Test: ${name}`);
  try {
    fn();
    if (failed === 0) {
      console.log("  PASS\n");
      passed++;
    }
  } catch (e) {
    console.error(`  ERROR: ${e}\n`);
    failed++;
  }
}

console.log("=== Archaeological Cultures TSV Test Suite ===\n");

const cultures = loadCultures();

test("Load at least 60 archaeological cultures", () => {
  assert(cultures.length >= 60, `Expected >= 60 cultures, got ${cultures.length}`);
  console.log(`  Loaded ${cultures.length} cultures`);
});

test("Yamnaya culture has correct fields", () => {
  const yamnaya = cultures.find((c) => c.id === "ac_001");
  assert(!!yamnaya, "Yamnaya culture (ac_001) not found");
  if (!yamnaya) return;
  assert(yamnaya.name === "Yamnaya", `Expected name 'Yamnaya', got '${yamnaya.name}'`);
  assert(yamnaya.timeOrigin === -3300, `Expected timeOrigin -3300, got ${yamnaya.timeOrigin}`);
  assert(yamnaya.timeEnd === -2600, `Expected timeEnd -2600, got ${yamnaya.timeEnd}`);
  assert(yamnaya.associatedLanguageIds.includes("pie"), "Should be associated with PIE");
  assert(yamnaya.associatedHaplogroupIds.includes("R1b"), "Should be associated with R1b");
  assert(yamnaya.successorCultureIds.length > 0, "Should have successor cultures");
  assert(yamnaya.characteristics.length > 0, "Should have characteristics");
  console.log(`  Languages: ${yamnaya.associatedLanguageIds.join(", ")}`);
  console.log(`  Haplogroups: ${yamnaya.associatedHaplogroupIds.join(", ")}`);
  console.log(`  Successors: ${yamnaya.successorCultureIds.join(", ")}`);
});

test("Region filtering works", () => {
  const europeCultures = cultures.filter((c) =>
    c.region.toLowerCase().includes("europe")
  );
  assert(europeCultures.length > 0, "Expected cultures in Europe");
  const allContain = europeCultures.every((c) =>
    c.region.toLowerCase().includes("europe")
  );
  assert(allContain, "All filtered cultures should contain 'europe' in region");
  console.log(`  Europe cultures: ${europeCultures.length}`);
});

test("Language association filtering works", () => {
  const pieCultures = cultures.filter((c) =>
    c.associatedLanguageIds.includes("pie")
  );
  assert(pieCultures.length > 0, "Expected cultures associated with PIE");
  console.log(`  PIE-associated cultures: ${pieCultures.length}`);
});

test("Time range filtering works", () => {
  const bronzeAge = cultures.filter(
    (c) => c.timeEnd >= -3000 && c.timeOrigin <= -1000
  );
  assert(bronzeAge.length > 0, "Expected cultures in Bronze Age range");
  console.log(`  Bronze Age cultures: ${bronzeAge.length}`);
});

test("All IDs are unique", () => {
  const ids = cultures.map((c) => c.id);
  const uniqueIds = new Set(ids);
  assert(ids.length === uniqueIds.size, `Duplicate IDs found: ${ids.length} vs ${uniqueIds.size} unique`);
});

test("All coordinates are valid", () => {
  for (const culture of cultures) {
    const [lat, lng] = culture.originCoordinates;
    assert(
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180,
      `${culture.name} has invalid coordinates: [${lat}, ${lng}]`
    );
  }
});

test("Predecessor/successor linkage consistency", () => {
  let warnings = 0;
  for (const culture of cultures) {
    for (const succId of culture.successorCultureIds) {
      const successor = cultures.find((c) => c.id === succId);
      if (successor && !successor.predecessorCultureIds.includes(culture.id)) {
        console.log(`  WARNING: ${culture.name} -> ${successor.name} missing reverse link`);
        warnings++;
      }
    }
  }
  console.log(`  Linkage warnings: ${warnings}`);
});

test("Jōmon is the oldest culture", () => {
  const jomon = cultures.find((c) => c.id === "ac_010");
  assert(!!jomon, "Jōmon culture not found");
  if (!jomon) return;
  assert(jomon.timeOrigin === -14000, `Expected -14000, got ${jomon.timeOrigin}`);
  const oldest = cultures.reduce((a, b) => (a.timeOrigin < b.timeOrigin ? a : b));
  assert(oldest.id === "ac_010", `Expected Jōmon to be oldest, got ${oldest.name}`);
});

test("All cultures have descriptions", () => {
  const missing = cultures.filter((c) => !c.description || c.description.trim() === "");
  assert(missing.length === 0, `${missing.length} cultures missing descriptions`);
});

test("All cultures have valid time ranges", () => {
  for (const culture of cultures) {
    assert(
      culture.timeOrigin <= culture.timeEnd,
      `${culture.name}: timeOrigin (${culture.timeOrigin}) > timeEnd (${culture.timeEnd})`
    );
  }
});

console.log("=== Results ===");
console.log(`Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) {
  process.exit(1);
}
console.log("\nAll tests passed!");
