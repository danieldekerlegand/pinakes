/**
 * Test script for validating literary-traditions.tsv and literary-works.tsv
 * Run with: npx tsx test/test-literary-data.ts
 */

import { readFileSync } from "fs";
import { join } from "path";

const LEXICONS_DIR = join(import.meta.dirname, "..", "data", "source", "lexicons");

function parseTsv(filename: string): Record<string, string>[] {
  const content = readFileSync(join(LEXICONS_DIR, filename), "utf-8");
  const lines = content.trim().split("\n");
  const headers = lines[0].split("\t");
  return lines.slice(1).map(line => {
    const values = line.split("\t");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return row;
  });
}

function parseJsonArray(value: string): string[] {
  if (!value || value === "null") return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${message}`);
  }
}

// Load data
const traditions = parseTsv("literary-traditions.tsv");
const works = parseTsv("literary-works.tsv");

console.log("=== Literary Traditions TSV Validation ===\n");

// Check required columns
const tradColumns = ["id", "name", "language_id", "region", "time_origin", "tradition_type", "key_works", "writing_system_id", "themes", "influences", "influenced_by", "sources"];
const tradHeaders = Object.keys(traditions[0]);
assert(
  tradColumns.every(c => tradHeaders.includes(c)),
  `literary-traditions.tsv has all required columns (${tradColumns.length})`
);

// Check minimum count
assert(traditions.length >= 25, `Has 25+ traditions (found ${traditions.length})`);

// Check unique IDs
const tradIds = traditions.map(t => t.id);
const uniqueTradIds = new Set(tradIds);
assert(uniqueTradIds.size === tradIds.length, "All tradition IDs are unique");

// Check tradition types are valid
const validTypes = ["epic", "poetry", "drama", "prose", "oral_epic", "mythology"];
const allValidTypes = traditions.every(t => validTypes.includes(t.tradition_type));
assert(allValidTypes, `All tradition_type values are valid (${validTypes.join(", ")})`);

// Check time_origin is numeric
const allNumericOrigins = traditions.every(t => !isNaN(parseInt(t.time_origin)));
assert(allNumericOrigins, "All time_origin values are numeric");

// Check JSON arrays parse correctly
const allThemesValid = traditions.every(t => {
  try { JSON.parse(t.themes); return true; } catch { return false; }
});
assert(allThemesValid, "All themes fields are valid JSON arrays");

const allKeyWorksValid = traditions.every(t => {
  try { JSON.parse(t.key_works); return true; } catch { return false; }
});
assert(allKeyWorksValid, "All key_works fields are valid JSON arrays");

const allInfluencesValid = traditions.every(t => {
  try { JSON.parse(t.influences); return true; } catch { return false; }
});
assert(allInfluencesValid, "All influences fields are valid JSON arrays");

const allInfluencedByValid = traditions.every(t => {
  try { JSON.parse(t.influenced_by); return true; } catch { return false; }
});
assert(allInfluencedByValid, "All influenced_by fields are valid JSON arrays");

console.log("\n=== Literary Works TSV Validation ===\n");

// Check required columns
const workColumns = ["id", "title", "tradition_id", "author", "language_id", "date_composed", "genre", "significance", "translations_count", "sources"];
const workHeaders = Object.keys(works[0]);
assert(
  workColumns.every(c => workHeaders.includes(c)),
  `literary-works.tsv has all required columns (${workColumns.length})`
);

// Check minimum count
assert(works.length >= 40, `Has 40+ works (found ${works.length})`);

// Check unique IDs
const workIds = works.map(w => w.id);
const uniqueWorkIds = new Set(workIds);
assert(uniqueWorkIds.size === workIds.length, "All work IDs are unique");

// Check date_composed is numeric
const allDatesNumeric = works.every(w => !isNaN(parseInt(w.date_composed)));
assert(allDatesNumeric, "All date_composed values are numeric");

// Check translations_count is numeric
const allTransNumeric = works.every(w => !isNaN(parseInt(w.translations_count)));
assert(allTransNumeric, "All translations_count values are numeric");

// Check sources are valid JSON
const allSourcesValid = works.every(w => {
  try { JSON.parse(w.sources); return true; } catch { return false; }
});
assert(allSourcesValid, "All sources fields are valid JSON arrays");

console.log("\n=== Cross-Reference Validation ===\n");

// Check all work tradition_ids reference valid traditions
const allTradRefsValid = works.every(w => tradIds.includes(w.tradition_id));
assert(allTradRefsValid, "All work tradition_ids reference existing traditions");

// Check all key_works in traditions reference valid work IDs
const allKeyWorkRefsValid = traditions.every(t => {
  const refs = parseJsonArray(t.key_works);
  return refs.every(ref => workIds.includes(ref));
});
assert(allKeyWorkRefsValid, "All key_works references point to existing works");

// Check influence chains reference valid tradition IDs
const allInfluenceRefsValid = traditions.every(t => {
  const influences = parseJsonArray(t.influences);
  const influencedBy = parseJsonArray(t.influenced_by);
  return [...influences, ...influencedBy].every(ref => tradIds.includes(ref));
});
assert(allInfluenceRefsValid, "All influence chain references point to existing traditions");

// Check specific required works from the PRD
const requiredTitles = ["Epic of Gilgamesh", "Iliad", "Odyssey", "Mahabharata", "Beowulf", "Tale of Genji", "One Thousand and One Nights", "Popol Vuh", "Kalevala", "Sundiata", "Shahnameh"];
const workTitles = works.map(w => w.title);
requiredTitles.forEach(title => {
  assert(workTitles.includes(title), `Required work "${title}" is present`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
