/**
 * Test script for cultural lineages TSV loading and API
 * Run with: npx tsx test/test-cultural-lineages.ts
 */

import { TsvStorage } from "../server/tsv-storage";

async function testCulturalLineages() {
  console.log("=== Cultural Lineages Test Suite ===\n");

  const storage = new TsvStorage();
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  ✓ ${message}`);
      passed++;
    } else {
      console.log(`  ✗ ${message}`);
      failed++;
    }
  }

  // Test 1: Load all cultural lineages
  console.log("Test 1: Load all cultural lineages");
  const allLineages = await storage.getCulturalLineages();
  assert(allLineages.length > 0, `Loaded ${allLineages.length} cultural lineages (expected > 0)`);
  assert(allLineages.length >= 90, `Has at least 90 lineages (got ${allLineages.length})`);

  // Test 2: Verify lineage structure
  console.log("\nTest 2: Verify lineage structure");
  const first = allLineages[0];
  assert(typeof first.id === "string" && first.id.length > 0, "Has id");
  assert(typeof first.sourceId === "string" && first.sourceId.length > 0, "Has sourceId");
  assert(typeof first.sourceName === "string" && first.sourceName.length > 0, "Has sourceName");
  assert(typeof first.targetId === "string" && first.targetId.length > 0, "Has targetId");
  assert(typeof first.targetName === "string" && first.targetName.length > 0, "Has targetName");
  assert(typeof first.relationshipType === "string" && first.relationshipType.length > 0, "Has relationshipType");
  assert(typeof first.timeStart === "number", "Has numeric timeStart");
  assert(typeof first.timeEnd === "number", "Has numeric timeEnd");
  assert(typeof first.confidence === "number" && first.confidence > 0 && first.confidence <= 100, "Has valid confidence (1-100)");
  assert(Array.isArray(first.evidenceTypes) && first.evidenceTypes.length > 0, "Has evidenceTypes array");
  assert(typeof first.description === "string" && first.description.length > 0, "Has description");
  assert(Array.isArray(first.sources), "Has sources array");

  // Test 3: Filter by relationship type
  console.log("\nTest 3: Filter by relationship type");
  const splitFrom = await storage.getCulturalLineages("split-from");
  assert(splitFrom.length > 0, `Found ${splitFrom.length} 'split-from' relationships`);
  assert(splitFrom.every((l) => l.relationshipType === "split-from"), "All filtered results are 'split-from'");

  const evolvedInto = await storage.getCulturalLineages("evolved-into");
  assert(evolvedInto.length > 0, `Found ${evolvedInto.length} 'evolved-into' relationships`);
  assert(evolvedInto.every((l) => l.relationshipType === "evolved-into"), "All filtered results are 'evolved-into'");

  const influenced = await storage.getCulturalLineages("influenced");
  assert(influenced.length > 0, `Found ${influenced.length} 'influenced' relationships`);

  // Test 4: Filter by source ID
  console.log("\nTest 4: Filter by source ID");
  const pieChildren = await storage.getCulturalLineages(undefined, "proto_indo_european");
  assert(pieChildren.length > 0, `Found ${pieChildren.length} lineages from PIE`);
  assert(pieChildren.every((l) => l.sourceId === "proto_indo_european"), "All results have PIE as source");

  // Test 5: Filter by target ID
  console.log("\nTest 5: Filter by target ID");
  const toProtoSlavic = await storage.getCulturalLineages(undefined, undefined, "proto_slavic");
  assert(toProtoSlavic.length > 0, `Found ${toProtoSlavic.length} lineages to Proto-Slavic`);
  assert(toProtoSlavic.every((l) => l.targetId === "proto_slavic"), "All results have Proto-Slavic as target");

  // Test 6: Get by ID
  console.log("\nTest 6: Get by ID");
  const lineage = await storage.getCulturalLineageById("cl-001");
  assert(lineage !== null, "Found lineage cl-001");
  assert(lineage?.sourceId === "proto_indo_european", "cl-001 source is PIE");

  const missing = await storage.getCulturalLineageById("nonexistent");
  assert(missing === null, "Returns null for nonexistent ID");

  // Test 7: Ancestor traversal
  console.log("\nTest 7: Ancestor traversal");
  const ancestors = await storage.getCulturalLineageAncestors("old_english");
  assert(ancestors.length > 0, `Found ${ancestors.length} ancestors for Old English`);
  const ancestorSourceIds = ancestors.map((a) => a.sourceId);
  assert(ancestorSourceIds.includes("proto_west_germanic"), "Ancestors include Proto-West Germanic");
  assert(ancestorSourceIds.includes("proto_germanic"), "Ancestors include Proto-Germanic");
  assert(ancestorSourceIds.includes("proto_indo_european"), "Ancestors include PIE");

  // Test 8: Descendant traversal
  console.log("\nTest 8: Descendant traversal");
  const descendants = await storage.getCulturalLineageDescendants("proto_indo_european");
  assert(descendants.length > 0, `Found ${descendants.length} descendants from PIE`);
  assert(descendants.length >= 10, `PIE has at least 10 descendants (got ${descendants.length})`);
  const descendantTargetIds = descendants.map((d) => d.targetId);
  assert(descendantTargetIds.includes("proto_germanic"), "Descendants include Proto-Germanic");
  assert(descendantTargetIds.includes("proto_slavic") || descendantTargetIds.includes("proto_balto_slavic"), "Descendants include Balto-Slavic or Slavic");

  // Test 9: Non-IE lineages present
  console.log("\nTest 9: Non-IE lineages present");
  const bantuLineages = await storage.getCulturalLineages(undefined, "proto_bantu");
  assert(bantuLineages.length > 0, `Found ${bantuLineages.length} Bantu lineages`);

  const austronesianLineages = await storage.getCulturalLineages(undefined, "proto_austronesian");
  assert(austronesianLineages.length > 0, `Found ${austronesianLineages.length} Austronesian lineages`);

  // Test 10: Evidence types are valid
  console.log("\nTest 10: Evidence types are valid");
  const validEvidenceTypes = new Set(["linguistic", "archaeological", "genetic"]);
  const allEvidenceTypesValid = allLineages.every((l) =>
    l.evidenceTypes.every((e) => validEvidenceTypes.has(e))
  );
  assert(allEvidenceTypesValid, "All evidence types are valid (linguistic/archaeological/genetic)");

  // Test 11: Relationship types are valid
  console.log("\nTest 11: Relationship types are valid");
  const validRelTypes = new Set(["split-from", "evolved-into", "gave-rise-to", "influenced", "associated-with", "possibly-associated", "preceded-by"]);
  const allRelTypesValid = allLineages.every((l) => validRelTypes.has(l.relationshipType));
  assert(allRelTypesValid, "All relationship types are valid");

  // Test 12: No circular references in ancestor/descendant traversal
  console.log("\nTest 12: No circular references");
  const mesoamericanAncestors = await storage.getCulturalLineageAncestors("aztec");
  const mesoamericanIds = mesoamericanAncestors.map((a) => a.sourceId);
  assert(!mesoamericanIds.includes("aztec"), "No circular reference in Aztec ancestors");

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

testCulturalLineages().catch((error) => {
  console.error("Test failed with error:", error);
  process.exit(1);
});
