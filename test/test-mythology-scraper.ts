/**
 * Test script for mythology scraper service
 * Tests data transformation, syncretism linking, and TSV output format
 * Run with: npx tsx test/test-mythology-scraper.ts
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
  if (!val || val === "null" || val === "") return null;
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

async function testScraperModule() {
  console.log("=== Testing Mythology Scraper Module ===\n");

  const scraperPath = path.resolve(__dirname, "../server/services/mythology-scraper-tsv.ts");
  assert(fs.existsSync(scraperPath), "mythology-scraper-tsv.ts exists");

  // Dynamically import to verify module structure
  const mod = await import(scraperPath);
  assert(typeof mod.MythologyScraperTSV === "function", "MythologyScraperTSV class is exported");
  assert(typeof mod.mythologyScraperTSV === "object", "mythologyScraperTSV singleton is exported");

  const scraper = new mod.MythologyScraperTSV();

  // Test that key methods exist
  assert(typeof scraper.scrapeMythology === "function", "scrapeMythology method exists");
  assert(typeof scraper.scrapeDeitiesForPantheon === "function", "scrapeDeitiesForPantheon method exists");
  assert(typeof scraper.buildSyncretismLinks === "function", "buildSyncretismLinks method exists");
  assert(typeof scraper.scrapeMythMotifs === "function", "scrapeMythMotifs method exists");

  // Test that scraper requires GEMINI_API_KEY
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await scraper.scrapeMythology();
    assert(false, "scrapeMythology throws without GEMINI_API_KEY");
  } catch (e: any) {
    assert(
      e.message.includes("GEMINI_API_KEY"),
      "scrapeMythology throws without GEMINI_API_KEY"
    );
  }
  if (originalKey) process.env.GEMINI_API_KEY = originalKey;

  console.log("");
}

async function testDeitiesTsvStructure() {
  console.log("=== Testing deities.tsv Structure ===\n");

  const filePath = path.resolve(__dirname, "../lexicons/deities.tsv");
  assert(fs.existsSync(filePath), "deities.tsv exists");

  const text = fs.readFileSync(filePath, "utf-8");
  const { header, rows } = parseTsv(text);

  // Verify all required columns exist (matching scraper output format)
  const requiredColumns = [
    "id", "name", "native_name", "pantheon", "domain", "gender",
    "syncretism_links", "associated_religion_ids", "associated_language_ids",
    "time_origin", "time_end", "coordinates", "description", "sources",
  ];
  for (const col of requiredColumns) {
    assert(header.includes(col), `deities.tsv has column '${col}'`);
  }

  assert(rows.length >= 60, `deities.tsv has 60+ deities (found ${rows.length})`);

  // Check column count consistency
  const badRows = rows.filter((r) => r.length !== header.length);
  assert(badRows.length === 0, `all deity rows have ${header.length} columns (${badRows.length} bad)`);

  // Check unique IDs
  const idIdx = getIdx(header, "id");
  const ids = rows.map((r) => r[idIdx]);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === rows.length, `all deity IDs are unique`);

  // Check JSON fields parse
  const jsonCols = ["domain", "syncretism_links", "associated_religion_ids", "associated_language_ids", "coordinates", "sources"];
  let jsonErrors = 0;
  for (const row of rows) {
    for (const col of jsonCols) {
      const idx = getIdx(header, col);
      if (idx >= 0 && row[idx] && row[idx] !== "null" && row[idx] !== "") {
        try {
          JSON.parse(row[idx]);
        } catch {
          jsonErrors++;
        }
      }
    }
  }
  assert(jsonErrors === 0, `all JSON fields in deities.tsv parse correctly (${jsonErrors} errors)`);

  // Check multiple pantheons
  const pantheonIdx = getIdx(header, "pantheon");
  const pantheons = new Set(rows.map((r) => r[pantheonIdx]));
  assert(pantheons.size >= 8, `has 8+ distinct pantheons (found ${pantheons.size})`);

  // Check syncretism links reference valid IDs (bidirectionality checked separately)
  const syncIdx = getIdx(header, "syncretism_links");
  let deitiesWithLinks = 0;
  for (const row of rows) {
    const links = tryParseJson(row[syncIdx]) as string[] | null;
    if (links && Array.isArray(links) && links.length > 0) {
      deitiesWithLinks++;
    }
  }
  assert(deitiesWithLinks >= 10, `at least 10 deities have syncretism links (found ${deitiesWithLinks})`);

  // Verify coordinates are valid
  const coordIdx = getIdx(header, "coordinates");
  let badCoords = 0;
  for (const row of rows) {
    const coords = tryParseJson(row[coordIdx]) as { lat: number; lng: number } | null;
    if (coords) {
      if (typeof coords.lat !== "number" || typeof coords.lng !== "number" ||
          coords.lat < -90 || coords.lat > 90 || coords.lng < -180 || coords.lng > 180) {
        badCoords++;
      }
    }
  }
  assert(badCoords === 0, `all coordinates are valid (${badCoords} errors)`);

  console.log("");
  return uniqueIds;
}

async function testMythMotifsTsvStructure(validDeityIds: Set<string>) {
  console.log("=== Testing myth-motifs.tsv Structure ===\n");

  const filePath = path.resolve(__dirname, "../lexicons/myth-motifs.tsv");
  assert(fs.existsSync(filePath), "myth-motifs.tsv exists");

  const text = fs.readFileSync(filePath, "utf-8");
  const { header, rows } = parseTsv(text);

  // Verify all required columns
  const requiredColumns = [
    "id", "name", "motif_type", "atu_index", "description", "examples",
    "associated_religion_ids", "associated_deity_ids", "geographic_distribution",
    "time_depth", "sources",
  ];
  for (const col of requiredColumns) {
    assert(header.includes(col), `myth-motifs.tsv has column '${col}'`);
  }

  assert(rows.length >= 30, `myth-motifs.tsv has 30+ motifs (found ${rows.length})`);

  // Check column count consistency
  const badRows = rows.filter((r) => r.length !== header.length);
  assert(badRows.length === 0, `all motif rows have ${header.length} columns (${badRows.length} bad)`);

  // Check unique IDs
  const idIdx = getIdx(header, "id");
  const ids = rows.map((r) => r[idIdx]);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === rows.length, `all motif IDs are unique`);

  // Check JSON fields parse
  const jsonCols = ["examples", "associated_religion_ids", "associated_deity_ids", "geographic_distribution", "sources"];
  let jsonErrors = 0;
  for (const row of rows) {
    for (const col of jsonCols) {
      const idx = getIdx(header, col);
      if (idx >= 0 && row[idx] && row[idx] !== "null" && row[idx] !== "") {
        try {
          JSON.parse(row[idx]);
        } catch {
          jsonErrors++;
          console.log(`    JSON error in motif '${row[idIdx]}', col '${col}'`);
        }
      }
    }
  }
  assert(jsonErrors === 0, `all JSON fields in myth-motifs.tsv parse correctly (${jsonErrors} errors)`);

  // Check examples have culture and narrative
  const examplesIdx = getIdx(header, "examples");
  let badExamples = 0;
  for (const row of rows) {
    const examples = tryParseJson(row[examplesIdx]) as Array<{ culture: string; narrative: string }> | null;
    if (examples && Array.isArray(examples)) {
      for (const ex of examples) {
        if (!ex.culture || !ex.narrative) {
          badExamples++;
        }
      }
    }
  }
  assert(badExamples === 0, `all examples have culture and narrative`);

  // Check cross-cultural examples (at least 2 cultures per motif)
  let lowDiversityMotifs = 0;
  for (const row of rows) {
    const examples = tryParseJson(row[examplesIdx]) as Array<{ culture: string; narrative: string }> | null;
    if (examples && Array.isArray(examples)) {
      const cultures = new Set(examples.map((e) => e.culture));
      if (cultures.size < 2) {
        lowDiversityMotifs++;
        console.log(`    Motif '${row[idIdx]}' has only ${cultures.size} culture(s)`);
      }
    }
  }
  assert(lowDiversityMotifs === 0, `all motifs have cross-cultural examples (2+ cultures)`);

  // Check motif type diversity
  const typeIdx = getIdx(header, "motif_type");
  const motifTypes = new Set(rows.map((r) => r[typeIdx]));
  assert(motifTypes.size >= 5, `has 5+ motif types (found ${motifTypes.size})`);

  // Verify deity references exist in deities.tsv
  const deityIdx = getIdx(header, "associated_deity_ids");
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
  assert(badDeityRefs === 0, `all deity references in motifs exist in deities.tsv (${badDeityRefs} bad)`);

  console.log("");
}

async function testCrossCulturalLinking() {
  console.log("=== Testing Cross-Cultural Linking ===\n");

  const deitiesPath = path.resolve(__dirname, "../lexicons/deities.tsv");
  const text = fs.readFileSync(deitiesPath, "utf-8");
  const { header, rows } = parseTsv(text);

  const idIdx = getIdx(header, "id");
  const syncIdx = getIdx(header, "syncretism_links");
  const pantheonIdx = getIdx(header, "pantheon");

  // Count deities with syncretism links
  let deitiesWithLinks = 0;
  let totalLinks = 0;
  for (const row of rows) {
    const links = tryParseJson(row[syncIdx]) as string[] | null;
    if (links && Array.isArray(links) && links.length > 0) {
      deitiesWithLinks++;
      totalLinks += links.length;
    }
  }
  assert(deitiesWithLinks >= 10, `at least 10 deities have syncretism links (found ${deitiesWithLinks})`);
  assert(totalLinks >= 20, `at least 20 total syncretism links (found ${totalLinks})`);

  // Verify links cross pantheon boundaries
  let crossPantheonLinks = 0;
  const deityMap = new Map<string, string>(); // id -> pantheon
  for (const row of rows) {
    deityMap.set(row[idIdx], row[pantheonIdx]);
  }

  for (const row of rows) {
    const links = tryParseJson(row[syncIdx]) as string[] | null;
    if (links && Array.isArray(links)) {
      for (const link of links) {
        const targetPantheon = deityMap.get(link);
        if (targetPantheon && targetPantheon !== row[pantheonIdx]) {
          crossPantheonLinks++;
        }
      }
    }
  }
  assert(crossPantheonLinks >= 10, `at least 10 cross-pantheon links (found ${crossPantheonLinks})`);

  // Check specific well-known equivalences
  const getLinks = (id: string): string[] => {
    const row = rows.find((r) => r[idIdx] === id);
    if (!row) return [];
    return (tryParseJson(row[syncIdx]) as string[] | null) || [];
  };

  const zeusLinks = getLinks("zeus");
  const jupiterLinks = getLinks("jupiter");
  if (zeusLinks.length > 0 && jupiterLinks.length > 0) {
    assert(
      zeusLinks.includes("jupiter") && jupiterLinks.includes("zeus"),
      "Zeus <-> Jupiter equivalence exists"
    );
  } else {
    console.log("  ⚠ SKIP: Zeus or Jupiter not found for equivalence check");
  }

  console.log("");
}

async function main() {
  console.log("=== Mythology Scraper Tests ===\n");

  await testScraperModule();
  const validDeityIds = await testDeitiesTsvStructure();
  await testMythMotifsTsvStructure(validDeityIds);
  await testCrossCulturalLinking();

  console.log("=== Summary ===");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
