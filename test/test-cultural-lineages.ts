/**
 * Test script for verifying cultural-lineages.tsv data file
 * Run with: npx tsx test/test-cultural-lineages.ts
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_RELATIONSHIP_TYPES = [
  "descended-from",
  "split-from",
  "merged-with",
  "influenced-by",
  "conquered-by",
  "absorbed-into",
];

const VALID_EVIDENCE_TYPES = [
  "archaeological",
  "linguistic",
  "genetic",
  "historical",
];

const REQUIRED_COLUMNS = [
  "id",
  "source_id",
  "target_id",
  "relationship_type",
  "time_start",
  "time_end",
  "confidence",
  "evidence_types",
  "sources",
];

interface CulturalLineage {
  id: string;
  source_id: string;
  target_id: string;
  relationship_type: string;
  time_start: number;
  time_end: number;
  confidence: number;
  evidence_types: string[];
  sources: string[];
}

function parseTsv(filePath: string): CulturalLineage[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");
  const headers = lines[0].split("\t");
  return lines.slice(1).filter(line => line.trim()).map((line) => {
    const values = line.split("\t");
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = values[i] || "";
    });
    return {
      id: row.id,
      source_id: row.source_id,
      target_id: row.target_id,
      relationship_type: row.relationship_type,
      time_start: parseInt(row.time_start, 10),
      time_end: parseInt(row.time_end, 10),
      confidence: parseInt(row.confidence, 10),
      evidence_types: JSON.parse(row.evidence_types || "[]"),
      sources: JSON.parse(row.sources || "[]"),
    };
  });
}

function loadEntityIds(filename: string, idColumn = "id"): Set<string> {
  const filePath = path.join(__dirname, "..", "lexicons", filename);
  if (!fs.existsSync(filePath)) return new Set();
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");
  const headers = lines[0].split("\t");
  const idIdx = headers.indexOf(idColumn);
  if (idIdx === -1) return new Set();
  return new Set(lines.slice(1).filter(l => l.trim()).map((line) => line.split("\t")[idIdx]));
}

async function testCulturalLineages() {
  console.log("=== Testing Cultural Lineages TSV ===\n");

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

  // Test 1: File exists
  const filePath = path.join(__dirname, "..", "lexicons", "cultural-lineages.tsv");
  const fileExists = fs.existsSync(filePath);
  assert(fileExists, "cultural-lineages.tsv exists");
  if (!fileExists) {
    console.log("\n=== Cannot continue without file ===");
    process.exit(1);
  }

  // Test 2: Headers match schema
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");
  const headers = lines[0].split("\t");
  assert(
    REQUIRED_COLUMNS.every((col) => headers.includes(col)),
    `All required columns present: ${REQUIRED_COLUMNS.join(", ")}`
  );

  // Test 3: Parse all rows
  const lineages = parseTsv(filePath);
  assert(lineages.length >= 80, `Has 80+ lineage relationships (found ${lineages.length})`);

  // Test 4: Unique IDs
  const ids = lineages.map((l) => l.id);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === ids.length, `All IDs are unique (${uniqueIds.size}/${ids.length})`);

  // Test 5: ID format
  const validIdFormat = lineages.every((l) => /^cl-\d{3}$/.test(l.id));
  assert(validIdFormat, "All IDs follow cl-NNN format");

  // Test 6: Valid relationship types
  const invalidRelTypes = lineages.filter(
    (l) => !VALID_RELATIONSHIP_TYPES.includes(l.relationship_type)
  );
  assert(
    invalidRelTypes.length === 0,
    `All relationship_type values are valid (${invalidRelTypes.length} invalid)`
  );

  // Test 7: Confidence range
  const invalidConfidence = lineages.filter(
    (l) => l.confidence < 0 || l.confidence > 100 || isNaN(l.confidence)
  );
  assert(
    invalidConfidence.length === 0,
    `All confidence values are 0-100 (${invalidConfidence.length} invalid)`
  );

  // Test 8: Time ranges
  const invalidTimeRanges = lineages.filter(
    (l) => !isNaN(l.time_start) && !isNaN(l.time_end) && l.time_start > l.time_end
  );
  assert(
    invalidTimeRanges.length === 0,
    `All time_start <= time_end (${invalidTimeRanges.length} invalid)`
  );

  // Test 9: Valid evidence types
  const invalidEvidence = lineages.filter((l) =>
    l.evidence_types.some((e) => !VALID_EVIDENCE_TYPES.includes(e))
  );
  assert(
    invalidEvidence.length === 0,
    `All evidence_types values are valid (${invalidEvidence.length} invalid)`
  );

  // Test 10: Sources present
  const missingSources = lineages.filter((l) => l.sources.length === 0);
  assert(
    missingSources.length === 0,
    `All entries have at least one source (${missingSources.length} missing)`
  );

  // Test 11: No empty source/target IDs
  const emptyIds = lineages.filter((l) => !l.source_id || !l.target_id);
  assert(emptyIds.length === 0, `No empty source_id or target_id (${emptyIds.length} empty)`);

  // Test 12: Source/target IDs reference known entities
  const familyIds = loadEntityIds("families.tsv");
  const civilizationIds = loadEntityIds("civilizations.tsv");
  const allKnownIds = new Set([...familyIds, ...civilizationIds]);

  const unknownSourceIds = lineages.filter((l) => !allKnownIds.has(l.source_id));
  const unknownTargetIds = lineages.filter((l) => !allKnownIds.has(l.target_id));
  assert(
    unknownSourceIds.length === 0,
    `All source_ids reference known entities (${unknownSourceIds.length} unknown${unknownSourceIds.length > 0 ? ": " + unknownSourceIds.map(l => l.source_id).join(", ") : ""})`
  );
  assert(
    unknownTargetIds.length === 0,
    `All target_ids reference known entities (${unknownTargetIds.length} unknown${unknownTargetIds.length > 0 ? ": " + unknownTargetIds.map(l => l.target_id).join(", ") : ""})`
  );

  // Test 13: Coverage of major lineage chains
  const relTypes = new Set(lineages.map((l) => l.relationship_type));
  assert(relTypes.size >= 4, `At least 4 distinct relationship types used (found ${relTypes.size})`);

  // Test 14: Has Indo-European lineages
  const ieLineages = lineages.filter(
    (l) => l.source_id.includes("indo_european") || l.target_id.includes("indo_european")
  );
  assert(ieLineages.length >= 5, `Has Indo-European lineages (found ${ieLineages.length})`);

  // Test 15: Has Bantu/Niger-Congo lineages
  const bantuLineages = lineages.filter(
    (l) => l.source_id.includes("niger_congo") || l.target_id.includes("niger_congo") || l.source_id.includes("bantu") || l.target_id.includes("bantu")
  );
  assert(bantuLineages.length >= 2, `Has Bantu/Niger-Congo lineages (found ${bantuLineages.length})`);

  // Test 16: Has Austronesian lineages
  const anLineages = lineages.filter(
    (l) => l.source_id.includes("austronesian") || l.target_id.includes("austronesian")
  );
  assert(anLineages.length >= 3, `Has Austronesian lineages (found ${anLineages.length})`);

  // Test 17: Has Mesopotamian chain
  const mesoLineages = lineages.filter(
    (l) =>
      ["sumerian", "akkadian-empire", "babylonian-empire", "assyrian-empire"].includes(l.source_id) ||
      ["sumerian", "akkadian-empire", "babylonian-empire", "assyrian-empire"].includes(l.target_id)
  );
  assert(mesoLineages.length >= 3, `Has Mesopotamian civilization chain (found ${mesoLineages.length})`);

  // Test 18: JSON fields parse correctly
  const jsonParseErrors: string[] = [];
  const rawLines = lines.slice(1).filter(l => l.trim());
  for (const line of rawLines) {
    const cols = line.split("\t");
    try {
      JSON.parse(cols[7]); // evidence_types
      JSON.parse(cols[8]); // sources
    } catch {
      jsonParseErrors.push(cols[0]);
    }
  }
  assert(jsonParseErrors.length === 0, `All JSON fields parse correctly (${jsonParseErrors.length} errors)`);

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

testCulturalLineages().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
