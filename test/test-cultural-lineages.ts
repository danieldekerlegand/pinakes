/**
 * Test script for cultural lineages TSV loader and storage methods
 * Run with: npx tsx test/test-cultural-lineages.ts
 */

import { TsvStorage } from "../server/tsv-storage";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

async function testCulturalLineages() {
  console.log("=== Testing Cultural Lineages TSV Loader ===\n");

  const storage = new TsvStorage();

  // --- Basic loading ---
  console.log("1. Basic loading:");
  const all = await storage.getCulturalLineages();
  assert(all.length === 80, `Loaded 80 lineages (got ${all.length})`);
  assert(all[0].id === "cl-001", `First lineage id is cl-001`);
  assert(all[0].sourceId === "civ-proto-indo-europeans", `First lineage sourceId correct`);
  assert(all[0].targetId === "civ-proto-indo-iranians", `First lineage targetId correct`);
  assert(all[0].relationshipType === "descended-from", `First lineage relationship type correct`);
  assert(all[0].timeStart === -4500, `First lineage timeStart is -4500`);
  assert(all[0].timeEnd === -2500, `First lineage timeEnd is -2500`);
  assert(all[0].confidence === 0.9, `First lineage confidence is 0.9`);
  assert(all[0].evidenceTypes.length === 3, `First lineage has 3 evidence types`);
  assert(all[0].sources.length === 2, `First lineage has 2 sources`);

  // --- Get by ID ---
  console.log("\n2. Get by ID:");
  const single = await storage.getCulturalLineageById("cl-044");
  assert(single !== null, `Found lineage cl-044`);
  assert(single!.relationshipType === "conquered-by", `cl-044 is conquered-by`);
  assert(single!.sourceId === "civ-chimu", `cl-044 source is civ-chimu`);

  const missing = await storage.getCulturalLineageById("cl-999");
  assert(missing === null, `Non-existent lineage returns null`);

  // --- Filter by relationship type ---
  console.log("\n3. Filter by relationship type:");
  const descended = await storage.getCulturalLineages({ relationshipType: "descended-from" });
  assert(descended.length > 0, `Found descended-from lineages (${descended.length})`);
  assert(descended.every(l => l.relationshipType === "descended-from"), `All are descended-from`);

  const influenced = await storage.getCulturalLineages({ relationshipType: "influenced-by" });
  assert(influenced.length > 0, `Found influenced-by lineages (${influenced.length})`);

  const conquered = await storage.getCulturalLineages({ relationshipType: "conquered-by" });
  assert(conquered.length === 1, `Found 1 conquered-by lineage`);

  const absorbed = await storage.getCulturalLineages({ relationshipType: "absorbed-into" });
  assert(absorbed.length === 1, `Found 1 absorbed-into lineage`);

  // --- Filter by sourceId ---
  console.log("\n4. Filter by sourceId:");
  const pieSrc = await storage.getCulturalLineages({ sourceId: "civ-proto-indo-europeans" });
  assert(pieSrc.length === 8, `PIE has 8 outgoing lineages (got ${pieSrc.length})`);

  // --- Filter by targetId ---
  console.log("\n5. Filter by targetId:");
  const romanTgt = await storage.getCulturalLineages({ targetId: "civ-roman" });
  assert(romanTgt.length > 0, `Found lineages targeting Roman (${romanTgt.length})`);

  // --- Filter by minConfidence ---
  console.log("\n6. Filter by minConfidence:");
  const highConf = await storage.getCulturalLineages({ minConfidence: 0.9 });
  assert(highConf.length > 0, `Found high-confidence lineages (${highConf.length})`);
  assert(highConf.every(l => l.confidence >= 0.9), `All have confidence >= 0.9`);

  // --- Filter by time range ---
  console.log("\n7. Filter by time range:");
  const medieval = await storage.getCulturalLineages({ timeStart: 500, timeEnd: 1500 });
  assert(medieval.length > 0, `Found lineages in medieval period (${medieval.length})`);

  // --- Ancestor traversal ---
  console.log("\n8. Ancestor traversal:");
  const farsiAncestors = await storage.getCulturalLineageAncestors("civ-modern-farsi");
  assert(farsiAncestors.length >= 3, `Farsi has at least 3 ancestor edges (got ${farsiAncestors.length})`);
  const ancestorSources = farsiAncestors.map(l => l.sourceId);
  assert(ancestorSources.includes("civ-middle-persian"), `Includes Middle Persian ancestor`);

  // --- Descendant traversal ---
  console.log("\n9. Descendant traversal:");
  const pieDescendants = await storage.getCulturalLineageDescendants("civ-proto-indo-europeans");
  assert(pieDescendants.length >= 8, `PIE has at least 8 descendant edges (got ${pieDescendants.length})`);

  const bantuDescendants = await storage.getCulturalLineageDescendants("civ-proto-bantu");
  assert(bantuDescendants.length >= 4, `Proto-Bantu has at least 4 descendant edges (got ${bantuDescendants.length})`);

  // --- Depth-limited traversal ---
  console.log("\n10. Depth-limited traversal:");
  const shallow = await storage.getCulturalLineageDescendants("civ-proto-indo-europeans", 1);
  assert(shallow.length === 8, `Depth-1 from PIE yields 8 edges (got ${shallow.length})`);

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

testCulturalLineages().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(1);
});
