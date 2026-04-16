/**
 * Test script for social structures TSV data
 * Run with: npx tsx test/test-social-structures.ts
 */

import { TsvStorage } from "../server/tsv-storage";

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

async function testSocialStructures() {
  console.log("=== Testing Social Structures TSV ===\n");

  const storage = new TsvStorage();

  // Test: Load all social structures
  console.log("1. Loading all social structures");
  const all = await storage.getSocialStructures();
  assert(all.length >= 20, `Expected at least 20 social structures, got ${all.length}`);

  // Test: Each structure has required fields
  console.log("\n2. Validating required fields");
  for (const structure of all) {
    assert(!!structure.id, `Structure has id: ${structure.id}`);
    assert(!!structure.name, `Structure ${structure.id} has name: ${structure.name}`);
    assert(!!structure.structureType, `Structure ${structure.id} has structureType: ${structure.structureType}`);
    assert(!!structure.description, `Structure ${structure.id} has description`);
    assert(Array.isArray(structure.keyRoles), `Structure ${structure.id} has keyRoles array`);
  }

  // Test: Valid structure types
  console.log("\n3. Validating structure types");
  const validTypes = [
    "government", "class_hierarchy", "family_structure", "gender_roles",
    "age_grades", "guilds_associations", "military_organization",
    "religious_hierarchy", "legal_system", "education_system",
  ];
  for (const structure of all) {
    assert(
      validTypes.includes(structure.structureType),
      `Structure ${structure.id} has valid type: ${structure.structureType}`
    );
  }

  // Test: Unique IDs
  console.log("\n4. Checking unique IDs");
  const ids = all.map((s) => s.id);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === ids.length, `All ${ids.length} IDs are unique`);

  // Test: Filter by structure type
  console.log("\n5. Filtering by structure type");
  const govStructures = await storage.getSocialStructures({ structureType: "government" });
  assert(govStructures.length > 0, `Found ${govStructures.length} government structures`);
  for (const s of govStructures) {
    assert(s.structureType === "government", `Filtered structure ${s.id} is government type`);
  }

  // Test: Filter by culture profile
  console.log("\n6. Filtering by culture profile");
  const romanStructures = await storage.getSocialStructures({ cultureProfileId: "cp-roman" });
  assert(romanStructures.length > 0, `Found ${romanStructures.length} Roman social structures`);
  for (const s of romanStructures) {
    assert(s.cultureProfileId === "cp-roman", `Filtered structure ${s.id} belongs to Roman culture`);
  }

  // Test: Get by ID
  console.log("\n7. Get social structure by ID");
  const first = all[0];
  const byId = await storage.getSocialStructureById(first.id);
  assert(byId !== null, `Found structure by ID: ${first.id}`);
  assert(byId?.name === first.name, `Structure name matches`);

  // Test: Non-existent structure returns null
  console.log("\n8. Non-existent structure");
  const notFound = await storage.getSocialStructureById("ss-999");
  assert(notFound === null, "Non-existent structure returns null");

  // Test: Key roles are pipe-separated correctly
  console.log("\n9. Key roles parsing");
  for (const structure of all) {
    if (structure.keyRoles.length > 0) {
      assert(
        structure.keyRoles.every((r) => !r.includes("|")),
        `Structure ${structure.id} key roles are properly split`
      );
    }
  }

  // Test: Time periods are valid numbers or null
  console.log("\n10. Time period validation");
  for (const structure of all) {
    if (structure.timePeriodStart !== null) {
      assert(typeof structure.timePeriodStart === "number", `Structure ${structure.id} start is number: ${structure.timePeriodStart}`);
    }
    if (structure.timePeriodEnd !== null) {
      assert(typeof structure.timePeriodEnd === "number", `Structure ${structure.id} end is number: ${structure.timePeriodEnd}`);
    }
  }

  // Test: Multiple structure types per culture
  console.log("\n11. Culture diversity");
  const cultureIds = new Set(all.map((s) => s.cultureProfileId));
  assert(cultureIds.size >= 5, `Found structures for ${cultureIds.size} different cultures`);

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

testSocialStructures().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
