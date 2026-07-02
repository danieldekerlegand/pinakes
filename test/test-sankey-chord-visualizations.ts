/**
 * Test script for Sankey and Chord diagram visualization data
 * Run with: npx tsx test/test-sankey-chord-visualizations.ts
 */

import { TsvStorage } from "../server/tsv-storage";

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

async function testSankeyDataGeneration() {
  console.log("=== Sankey Diagram Data Generation Test ===\n");

  const storage = new TsvStorage();
  const contacts = await storage.getLanguageContacts();
  const languages = await storage.getLanguages();
  const langMap = new Map(languages.map((l) => [l.id, l]));

  console.log(`Loaded ${contacts.length} language contacts`);
  console.log(`Loaded ${languages.length} languages\n`);

  assert(contacts.length > 0, "Language contacts data is available");

  // Build sankey nodes and links (mirrors server logic)
  const nodeIds = new Set<string>();
  const links = contacts.map((c) => {
    nodeIds.add(c.sourceLanguageId);
    nodeIds.add(c.targetLanguageId);
    const intensityValue = c.intensity === "heavy" ? 3 : c.intensity === "moderate" ? 2 : 1;
    return {
      source: c.sourceLanguageId,
      target: c.targetLanguageId,
      value: intensityValue,
      contactType: c.contactType,
      timePeriod: c.timePeriod,
    };
  });

  const nodes = Array.from(nodeIds).map((id) => {
    const lang = langMap.get(id);
    return {
      id,
      name: lang?.name || id,
      group: lang?.familyId || "unknown",
    };
  });

  console.log(`Generated ${nodes.length} sankey nodes`);
  console.log(`Generated ${links.length} sankey links\n`);

  assert(nodes.length > 0, "Sankey nodes are generated");
  assert(links.length > 0, "Sankey links are generated");
  assert(
    nodes.every((n) => n.id && n.name && n.group),
    "All nodes have id, name, and group"
  );
  assert(
    links.every((l) => l.source && l.target && l.value > 0),
    "All links have source, target, and positive value"
  );

  // Check intensity mapping
  const heavyLinks = links.filter((l) => l.value === 3);
  const moderateLinks = links.filter((l) => l.value === 2);
  const lightLinks = links.filter((l) => l.value === 1);
  console.log(`  Heavy: ${heavyLinks.length}, Moderate: ${moderateLinks.length}, Light: ${lightLinks.length}`);
  assert(heavyLinks.length + moderateLinks.length + lightLinks.length === links.length, "All links have valid intensity values");

  // Verify no self-loops in links
  const selfLoops = links.filter((l) => l.source === l.target);
  assert(selfLoops.length === 0, "No self-loop links exist");
}

async function testChordDataGeneration() {
  console.log("\n=== Chord Diagram Data Generation Test ===\n");

  const storage = new TsvStorage();
  const contacts = await storage.getLanguageContacts();
  const languages = await storage.getLanguages();
  const langMap = new Map(languages.map((l) => [l.id, l]));
  const families = await storage.getLanguageFamilies();
  const familyMap = new Map(families.map((f) => [f.id, f.name]));

  // Aggregate contacts by language family pairs (mirrors server logic)
  const familyPairs = new Map<string, number>();
  const familyIds = new Set<string>();

  for (const c of contacts) {
    const srcLang = langMap.get(c.sourceLanguageId);
    const tgtLang = langMap.get(c.targetLanguageId);
    const srcFamily = srcLang?.familyId || "unknown";
    const tgtFamily = tgtLang?.familyId || "unknown";
    if (srcFamily === tgtFamily) continue;

    familyIds.add(srcFamily);
    familyIds.add(tgtFamily);

    const intensityValue = c.intensity === "heavy" ? 3 : c.intensity === "moderate" ? 2 : 1;
    const key = `${srcFamily}|${tgtFamily}`;
    familyPairs.set(key, (familyPairs.get(key) || 0) + intensityValue);
  }

  const names = Array.from(familyIds).map((id) => familyMap.get(id) || id);
  const idList = Array.from(familyIds);
  const n = idList.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (const [key, value] of familyPairs) {
    const [src, tgt] = key.split("|");
    const i = idList.indexOf(src);
    const j = idList.indexOf(tgt);
    if (i >= 0 && j >= 0) {
      matrix[i][j] += value;
      matrix[j][i] += value;
    }
  }

  console.log(`Generated chord data with ${names.length} language families`);
  console.log(`Families: ${names.join(", ")}\n`);

  assert(names.length > 0, "Chord diagram has language family names");
  assert(matrix.length === names.length, "Matrix dimensions match number of families");
  assert(
    matrix.every((row) => row.length === names.length),
    "Matrix is square"
  );

  // Check symmetry
  let isSymmetric = true;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (matrix[i][j] !== matrix[j][i]) {
        isSymmetric = false;
        break;
      }
    }
  }
  assert(isSymmetric, "Chord matrix is symmetric");

  // Check diagonal is zero (no self-influences)
  const diagonalZero = matrix.every((row, i) => row[i] === 0);
  assert(diagonalZero, "Diagonal values are zero (no intra-family influences)");

  // Check at least some non-zero values
  const hasNonZero = matrix.some((row) => row.some((v) => v > 0));
  assert(hasNonZero, "Matrix has non-zero influence values");
}

async function testTemporalFiltering() {
  console.log("\n=== Temporal Filtering Test ===\n");

  const storage = new TsvStorage();
  const allContacts = await storage.getLanguageContacts();

  // Filter for contacts in medieval period (500-1500)
  const medieval = allContacts.filter((c) => {
    const match = c.timePeriod.match(/(-?\d+)/);
    if (!match) return false;
    const year = parseInt(match[1], 10);
    return year >= 500 && year <= 1500;
  });

  // Filter for ancient period (before 0)
  const ancient = allContacts.filter((c) => {
    const match = c.timePeriod.match(/(-?\d+)/);
    if (!match) return false;
    const year = parseInt(match[1], 10);
    return year < 0;
  });

  console.log(`Total contacts: ${allContacts.length}`);
  console.log(`Medieval period (500-1500): ${medieval.length}`);
  console.log(`Ancient period (before 0): ${ancient.length}\n`);

  assert(medieval.length <= allContacts.length, "Medieval filter reduces or maintains count");
  assert(ancient.length <= allContacts.length, "Ancient filter reduces or maintains count");
  assert(
    medieval.length + ancient.length <= allContacts.length,
    "Filtered sets don't exceed total"
  );
}

async function main() {
  try {
    await testSankeyDataGeneration();
    await testChordDataGeneration();
    await testTemporalFiltering();

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) process.exit(1);
  } catch (error) {
    console.error("Test error:", error);
    process.exit(1);
  }
}

main();
