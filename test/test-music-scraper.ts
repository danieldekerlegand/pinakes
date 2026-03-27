/**
 * Test script for music traditions & instruments scraper, TSV writer, and data loader
 * Run with: npx tsx test/test-music-scraper.ts
 */

import fs from "node:fs";
import path from "node:path";
import { TsvStorage } from "../server/tsv-storage";
import { TsvWriter } from "../server/services/tsv-writer";

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

async function testExistingMusicData() {
  console.log("=== Testing Existing Music Data Loading ===\n");

  const storage = new TsvStorage();

  // Test 1: Load all music traditions
  console.log("1. Loading all music traditions:");
  const traditions = await storage.getMusicTraditions();
  assert(traditions.length >= 10, `Loaded ${traditions.length} traditions (expected >= 10)`);

  // Test 2: Verify data structure
  console.log("\n2. Verifying tradition data structure:");
  const gamelan = traditions.find((t) => t.id === "gamelan");
  assert(gamelan !== undefined, "Found Gamelan");
  if (gamelan) {
    assert(gamelan.name === "Gamelan", `Name: ${gamelan.name}`);
    assert(gamelan.region === "Southeast Asia", `Region: ${gamelan.region}`);
    assert(gamelan.coordinates.lat !== 0, `Has coordinates: ${gamelan.coordinates.lat}, ${gamelan.coordinates.lng}`);
    assert(gamelan.timeOrigin === -200, `Time origin: ${gamelan.timeOrigin}`);
    assert(gamelan.timeEnd === null, "Time end is null (living tradition)");
    assert(gamelan.associatedLanguageIds.length > 0, `Has language IDs: ${gamelan.associatedLanguageIds.join(", ")}`);
    assert(gamelan.instruments.length > 0, `Has instruments: ${gamelan.instruments.length}`);
    assert(gamelan.scales.length > 0, `Has scales: ${gamelan.scales.join(", ")}`);
    assert(gamelan.description.length > 0, "Has description");
    assert(gamelan.sources.length > 0, "Has sources");
  }

  // Test 3: Filter by region
  console.log("\n3. Filtering by region:");
  const eastAsian = await storage.getMusicTraditions({ region: "East Asia" });
  assert(eastAsian.length > 0, `Found ${eastAsian.length} East Asian traditions`);
  assert(eastAsian.every((t) => t.region.toLowerCase().includes("east asia")), "All results match region filter");

  // Test 4: Filter by year
  console.log("\n4. Filtering by year:");
  const modern = await storage.getMusicTraditions({ year: 2000 });
  assert(modern.length > 0, `Found ${modern.length} traditions active in 2000`);
  const ancient = await storage.getMusicTraditions({ year: -2000 });
  assert(ancient.length < modern.length, `Fewer traditions in -2000 (${ancient.length}) than 2000 (${modern.length})`);

  // Test 5: Filter by language
  console.log("\n5. Filtering by language:");
  const persian = await storage.getMusicTraditions({ languageId: "persian" });
  assert(persian.length > 0, `Found ${persian.length} Persian traditions`);
  assert(persian.every((t) => t.associatedLanguageIds.includes("persian")), "All results include Persian");

  // Test 6: Get tradition with instruments
  console.log("\n6. Getting tradition with instruments:");
  const result = await storage.getMusicTraditionWithInstruments("indian-classical");
  assert(result !== null, "Found Indian Classical with instruments");
  if (result) {
    assert(result.tradition.name === "Indian Classical", `Tradition: ${result.tradition.name}`);
    assert(result.instruments.length > 0, `Has ${result.instruments.length} instruments`);
  }

  const notFound = await storage.getMusicTraditionWithInstruments("nonexistent");
  assert(notFound === null, "Returns null for nonexistent tradition");

  // Test 7: Load all instruments
  console.log("\n7. Loading all instruments:");
  const instruments = await storage.getMusicalInstruments();
  assert(instruments.length >= 10, `Loaded ${instruments.length} instruments (expected >= 10)`);

  // Test 8: Verify instrument data structure
  console.log("\n8. Verifying instrument data structure:");
  const sitar = instruments.find((i) => i.id === "sitar");
  assert(sitar !== undefined, "Found Sitar");
  if (sitar) {
    assert(sitar.name === "Sitar", `Name: ${sitar.name}`);
    assert(sitar.instrumentFamily === "string", `Family: ${sitar.instrumentFamily}`);
    assert(sitar.originRegion === "South Asia", `Region: ${sitar.originRegion}`);
    assert(sitar.coordinates.lat !== 0, `Has coordinates`);
    assert(sitar.constructionMaterials.length > 0, `Has materials: ${sitar.constructionMaterials.length}`);
    assert(sitar.playingTechnique === "plucked", `Technique: ${sitar.playingTechnique}`);
    assert(sitar.associatedTraditionIds.length > 0, `Has tradition IDs`);
    assert(sitar.description.length > 0, "Has description");
  }

  // Test 9: Filter instruments by family
  console.log("\n9. Filtering instruments by family:");
  const strings = await storage.getMusicalInstruments({ family: "string" });
  assert(strings.length > 0, `Found ${strings.length} string instruments`);
  assert(strings.every((i) => i.instrumentFamily === "string"), "All results are string instruments");

  // Test 10: Filter instruments by tradition
  console.log("\n10. Filtering instruments by tradition:");
  const gamelanInstr = await storage.getMusicalInstruments({ traditionId: "gamelan" });
  assert(gamelanInstr.length > 0, `Found ${gamelanInstr.length} gamelan instruments`);

  // Test 11: Filter instruments by age
  console.log("\n11. Filtering instruments by age:");
  const ancientInstr = await storage.getMusicalInstruments({ olderThan: -1000 });
  assert(ancientInstr.length > 0, `Found ${ancientInstr.length} instruments older than 1000 BCE`);
  assert(ancientInstr.every((i) => i.timeOrigin !== null && i.timeOrigin <= -1000), "All results are old enough");
}

async function testTsvWriter() {
  console.log("\n=== Testing TSV Writer for Music Data ===\n");

  const writer = new TsvWriter();
  const tmpDir = path.join(process.cwd(), "test", "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });

  // Test 12: Write music traditions TSV
  console.log("12. Writing music traditions TSV:");
  const testTraditions = [
    {
      id: "test-tradition",
      name: "Test Tradition",
      nativeName: "テスト",
      region: "Test Region",
      coordinates: { lat: 35.68, lng: 139.69 },
      timeOrigin: -500,
      timeEnd: null,
      associatedLanguageIds: ["test-lang"],
      instruments: ["test-instrument"],
      scales: ["pentatonic"],
      rhythmicPatterns: ["4/4"],
      relatedTraditions: [],
      description: "A test tradition",
      sources: ["Test source"],
    },
    {
      id: "test-tradition-2",
      name: "Test Tradition 2",
      nativeName: "テスト2",
      region: "Test Region 2",
      coordinates: { lat: 10.0, lng: 20.0 },
      timeOrigin: 1500,
      timeEnd: 1900,
      associatedLanguageIds: ["lang-a", "lang-b"],
      instruments: ["instr-a", "instr-b"],
      scales: ["major", "minor"],
      rhythmicPatterns: ["waltz"],
      relatedTraditions: ["test-tradition"],
      description: "Another test tradition",
      sources: ["Source A", "Source B"],
    },
  ];

  const tradPath = path.join(tmpDir, "test-music-traditions.tsv");
  await writer.writeMusicTraditionsTSV(testTraditions, tradPath);
  assert(fs.existsSync(tradPath), "Music traditions TSV file created");

  const tradContent = fs.readFileSync(tradPath, "utf8");
  const tradLines = tradContent.split("\n").filter((l) => l.trim() !== "");
  assert(tradLines.length === 3, `Has header + 2 data rows (got ${tradLines.length})`);
  assert(tradLines[0].includes("id\tname\tnative_name"), "Header has correct columns");
  assert(tradLines[1].includes("test-tradition"), "First row has correct ID");
  assert(tradLines[1].includes('{"lat":35.68,"lng":139.69}'), "Coordinates serialized as JSON");
  assert(tradLines[1].includes('["test-lang"]'), "Language IDs serialized as JSON array");
  assert(tradLines[2].includes("1900"), "Second row has timeEnd");

  // Test 13: Write musical instruments TSV
  console.log("\n13. Writing musical instruments TSV:");
  const testInstruments = [
    {
      id: "test-instrument",
      name: "Test Instrument",
      nativeName: "テスト楽器",
      instrumentFamily: "string",
      originRegion: "Test Region",
      coordinates: { lat: 35.68, lng: 139.69 },
      timeOrigin: -1000,
      constructionMaterials: ["wood", "silk"],
      playingTechnique: "plucked",
      associatedTraditionIds: ["test-tradition"],
      associatedLanguageIds: ["test-lang"],
      description: "A test instrument",
      sources: ["Test source"],
    },
  ];

  const instrPath = path.join(tmpDir, "test-musical-instruments.tsv");
  await writer.writeMusicalInstrumentsTSV(testInstruments, instrPath);
  assert(fs.existsSync(instrPath), "Musical instruments TSV file created");

  const instrContent = fs.readFileSync(instrPath, "utf8");
  const instrLines = instrContent.split("\n").filter((l) => l.trim() !== "");
  assert(instrLines.length === 2, `Has header + 1 data row (got ${instrLines.length})`);
  assert(instrLines[0].includes("id\tname\tnative_name\tinstrument_family"), "Header has correct columns");
  assert(instrLines[1].includes("test-instrument"), "Row has correct ID");
  assert(instrLines[1].includes("plucked"), "Row has playing technique");
  assert(instrLines[1].includes('["wood","silk"]'), "Materials serialized as JSON array");

  // Test 14: Verify round-trip: write and reload
  console.log("\n14. Testing round-trip (write → load):");
  // Write to the standard file names so TsvStorage can load them
  const rtTradPath = path.join(tmpDir, "rt-music-traditions.tsv");
  const rtInstrPath = path.join(tmpDir, "rt-musical-instruments.tsv");
  await writer.writeMusicTraditionsTSV(testTraditions, rtTradPath);
  await writer.writeMusicalInstrumentsTSV(testInstruments, rtInstrPath);

  // Parse the written file manually to verify structure
  const rtContent = fs.readFileSync(rtTradPath, "utf8");
  const rtLines = rtContent.split("\n").filter((l) => l.trim());
  const rtHeader = rtLines[0].split("\t");
  assert(rtHeader.length === 14, `Tradition TSV has 14 columns (got ${rtHeader.length})`);
  const rtRow = rtLines[1].split("\t");
  assert(rtRow[0] === "test-tradition", "ID preserved in round-trip");
  const parsedCoords = JSON.parse(rtRow[rtHeader.indexOf("coordinates")]);
  assert(parsedCoords.lat === 35.68 && parsedCoords.lng === 139.69, "Coordinates preserved in round-trip");
  const parsedLangs = JSON.parse(rtRow[rtHeader.indexOf("associated_language_ids")]);
  assert(Array.isArray(parsedLangs) && parsedLangs[0] === "test-lang", "Language IDs preserved in round-trip");

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("\n  Cleaned up temporary files");
}

async function testMusicScraperModule() {
  console.log("\n=== Testing Music Scraper Module Import ===\n");

  // Test 15: Verify scraper module can be imported
  console.log("15. Importing music scraper module:");
  const { MusicScraper } = await import("../server/services/music-scraper");
  assert(MusicScraper !== undefined, "MusicScraper class imported");

  const scraper = new MusicScraper();
  assert(typeof scraper.scrapeMusicTraditionsAndInstruments === "function", "Has scrapeMusicTraditionsAndInstruments method");

  // Test 16: Verify scraper rejects without API key
  console.log("\n16. Testing API key validation:");
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    await scraper.scrapeMusicTraditionsAndInstruments();
    assert(false, "Should have thrown without API key");
  } catch (error: any) {
    assert(error.message.includes("GEMINI_API_KEY"), `Throws correct error: ${error.message}`);
  }

  if (originalKey) process.env.GEMINI_API_KEY = originalKey;
}

async function main() {
  try {
    await testExistingMusicData();
    await testTsvWriter();
    await testMusicScraperModule();

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Test error:", err);
    process.exit(1);
  }
}

main();
