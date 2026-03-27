/**
 * Test script for writing system scraper (Unicode CLDR + Gemini)
 * Run with: npx tsx test/test-writing-system-scraper.ts
 */

import { WritingSystemScraper } from "../server/services/writing-system-scraper";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.log(`  FAIL: ${message}`);
    failed++;
  }
}

async function testCldrFetching() {
  console.log("=== Writing System Scraper Tests ===\n");

  const scraper = new WritingSystemScraper();

  // Test 1: Fetch CLDR script metadata
  console.log("Test 1: Fetch CLDR script metadata");
  const metadata = await scraper.fetchCldrScriptMetadata();
  assert(metadata.size > 0, `Fetched metadata for ${metadata.size} scripts (expected > 0)`);
  assert(metadata.size >= 100, `Has at least 100 scripts (got ${metadata.size})`);

  // Verify known scripts exist
  assert(metadata.has("Latn"), "Has Latin script (Latn)");
  assert(metadata.has("Arab"), "Has Arabic script (Arab)");
  assert(metadata.has("Cyrl"), "Has Cyrillic script (Cyrl)");
  assert(metadata.has("Deva"), "Has Devanagari script (Deva)");
  assert(metadata.has("Hans"), "Has Simplified Chinese script (Hans)");

  // Verify metadata structure
  const latin = metadata.get("Latn")!;
  assert(latin.sampleChar !== undefined, "Latin has sampleChar field");
  assert(latin.idUsage === "RECOMMENDED", `Latin idUsage is RECOMMENDED (got ${latin.idUsage})`);
  assert(latin.rtl === "NO", `Latin is not RTL (got ${latin.rtl})`);
  assert(latin.originCountry !== undefined, "Latin has originCountry field");

  const arabic = metadata.get("Arab")!;
  assert(arabic.rtl === "YES", `Arabic is RTL (got ${arabic.rtl})`);
  console.log();

  // Test 2: Fetch CLDR script names
  console.log("Test 2: Fetch CLDR script names");
  const names = await scraper.fetchCldrScriptNames();
  assert(names.size > 0, `Fetched names for ${names.size} scripts (expected > 0)`);
  assert(names.size >= 100, `Has at least 100 script names (got ${names.size})`);
  assert(names.get("Latn") === "Latin", `Latin name is 'Latin' (got '${names.get("Latn")}')`);
  assert(names.get("Arab") === "Arabic", `Arabic name is 'Arabic' (got '${names.get("Arab")}')`);
  assert(names.get("Cyrl") === "Cyrillic", `Cyrillic name is 'Cyrillic' (got '${names.get("Cyrl")}')`);
  console.log();

  // Test 3: Fetch script-language mapping
  console.log("Test 3: Fetch script-language mapping");
  const langMap = await scraper.fetchScriptLanguageMap();
  assert(langMap.size > 0, `Built mapping for ${langMap.size} scripts (expected > 0)`);
  assert(langMap.size >= 30, `Has at least 30 script-language mappings (got ${langMap.size})`);

  const latnLangs = langMap.get("Latn") ?? [];
  assert(latnLangs.length > 10, `Latin has many languages (got ${latnLangs.length})`);

  const arabLangs = langMap.get("Arab") ?? [];
  assert(arabLangs.length > 5, `Arabic has multiple languages (got ${arabLangs.length})`);
  console.log();

  // Test 4: TSV write/read round-trip
  console.log("Test 4: TSV write/read round-trip");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-scraper-test-"));
  const tmpFile = path.join(tmpDir, "test-writing-systems.tsv");

  // Create a test TSV with known content
  const testContent = [
    "id\tname\ttype\tdirection\tparent_system_id\tlanguage_ids\torigin_date\torigin_region\tcharacter_count\tsample_characters\tunicode_block\tis_active",
    'ws_001\tLatin\talphabet\tLTR\tnull\t["eng","fra"]\t-700\tItaly\t26\tA B C D E\tBasic Latin\ttrue',
    'ws_002\tArabic\tabjad\tRTL\tnull\t["arb"]\t400\tArabian Peninsula\t28\tا ب ت\tArabic\ttrue',
  ].join("\n") + "\n";

  fs.writeFileSync(tmpFile, testContent);

  // Test that the scraper can load existing data
  const scraper2 = new WritingSystemScraper();
  // Access private method via any cast for testing
  const existing = (scraper2 as any).loadExistingWritingSystems(tmpFile);
  assert(existing.length === 2, `Loaded 2 existing systems (got ${existing.length})`);
  assert(existing[0].name === "Latin", `First system is Latin (got ${existing[0].name})`);
  assert(existing[0].type === "alphabet", `Latin type is alphabet (got ${existing[0].type})`);
  assert(existing[0].direction === "LTR", `Latin direction is LTR (got ${existing[0].direction})`);
  assert(existing[0].isActive === true, `Latin is active (got ${existing[0].isActive})`);
  assert(
    JSON.stringify(existing[0].languageIds) === '["eng","fra"]',
    `Latin language IDs parsed correctly (got ${JSON.stringify(existing[0].languageIds)})`
  );
  assert(existing[1].name === "Arabic", `Second system is Arabic (got ${existing[1].name})`);
  assert(existing[1].direction === "RTL", `Arabic direction is RTL (got ${existing[1].direction})`);

  // Test write round-trip
  await (scraper2 as any).writeWritingSystemsTsv(existing, tmpFile);
  const reloaded = (scraper2 as any).loadExistingWritingSystems(tmpFile);
  assert(reloaded.length === 2, `Round-trip preserved 2 systems (got ${reloaded.length})`);
  assert(reloaded[0].name === "Latin", `Round-trip preserved Latin name`);
  assert(reloaded[1].name === "Arabic", `Round-trip preserved Arabic name`);
  assert(reloaded[0].characterCount === 26, `Round-trip preserved character count (got ${reloaded[0].characterCount})`);

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true });
  console.log();

  // Test 5: ID generation
  console.log("Test 5: ID generation");
  const existingIds = new Set(["ws_001", "ws_002", "ws_003"]);
  const nextNum = { value: 1 };
  const id1 = (scraper as any).makeId(existingIds, nextNum);
  assert(id1 === "ws_004", `First new ID skips existing (got ${id1})`);
  const id2 = (scraper as any).makeId(existingIds, nextNum);
  assert(id2 === "ws_005", `Second new ID is sequential (got ${id2})`);
  assert(existingIds.has("ws_004"), "New ID was added to existing set");
  assert(existingIds.has("ws_005"), "Second new ID was added to existing set");
  console.log();

  // Test 6: Verify existing writing-systems.tsv loads properly
  console.log("Test 6: Verify existing writing-systems.tsv integrity");
  const existingWs = (scraper as any).loadExistingWritingSystems("lexicons/writing-systems.tsv");
  assert(existingWs.length >= 50, `Has at least 50 writing systems (got ${existingWs.length})`);

  const latin2 = existingWs.find((ws: any) => ws.name === "Latin");
  assert(latin2 !== undefined, "Found Latin in existing data");
  if (latin2) {
    assert(latin2.type === "alphabet", `Latin type is alphabet (got ${latin2.type})`);
    assert(latin2.direction === "LTR", `Latin direction is LTR (got ${latin2.direction})`);
    assert(latin2.isActive === true, `Latin is active`);
    assert(latin2.languageIds.length > 0, `Latin has language IDs (got ${latin2.languageIds.length})`);
  }

  const hangul = existingWs.find((ws: any) => ws.name === "Hangul");
  assert(hangul !== undefined, "Found Hangul in existing data");
  if (hangul) {
    assert(hangul.type === "featural", `Hangul type is featural (got ${hangul.type})`);
  }

  const arabicWs = existingWs.find((ws: any) => ws.name === "Arabic");
  assert(arabicWs !== undefined, "Found Arabic in existing data");
  if (arabicWs) {
    assert(arabicWs.direction === "RTL", `Arabic direction is RTL`);
    assert(arabicWs.type === "abjad", `Arabic type is abjad (got ${arabicWs.type})`);
  }
  console.log();

  // Summary
  console.log("=== Results ===");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

testCldrFetching().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
