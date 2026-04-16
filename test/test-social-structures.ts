/**
 * Test script for social-structures TSV loader and API
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
  console.log("=== Testing Social Structures ===\n");

  const storage = new TsvStorage();

  // Test 1: Load all social structures
  console.log("1. Loading all social structures:");
  const all = await storage.getSocialStructures();
  assert(all.length >= 300, `Loaded ${all.length} structures (expected >= 300)`);

  // Test 2: Verify data structure of first entry
  console.log("\n2. Verifying data structure:");
  const first = all.find((s) => s.id === "ss-001");
  assert(first !== undefined, "Found ss-001");
  if (first) {
    assert(first.cultureProfileId === "cp-roman", `Culture profile: ${first.cultureProfileId}`);
    assert(first.structureType === "government", `Structure type: ${first.structureType}`);
    assert(first.name.length > 0, `Has name: ${first.name}`);
    assert(first.description.length > 0, "Has description");
    assert(first.keyRoles.length > 0, `Has key roles: ${first.keyRoles.length} roles`);
    assert(first.inheritancePattern.length > 0, `Inheritance: ${first.inheritancePattern}`);
    assert(first.decisionMaking.length > 0, `Decision making: ${first.decisionMaking}`);
    assert(first.timePeriodStart.length > 0, `Time start: ${first.timePeriodStart}`);
    assert(first.timePeriodEnd.length > 0, `Time end: ${first.timePeriodEnd}`);
    assert(first.sources.length > 0, "Has sources");
  }

  // Test 3: Filter by culture_profile_id
  console.log("\n3. Filtering by culture_profile_id:");
  const roman = await storage.getSocialStructures({ cultureProfileId: "cp-roman" });
  assert(roman.length > 0, `Found ${roman.length} Roman structures`);
  assert(roman.every((s) => s.cultureProfileId === "cp-roman"), "All results match culture filter");

  // Test 4: Filter by structure_type
  console.log("\n4. Filtering by structure_type:");
  const governments = await storage.getSocialStructures({ structureType: "government" });
  assert(governments.length > 0, `Found ${governments.length} government structures`);
  assert(governments.every((s) => s.structureType === "government"), "All results are government type");

  // Test 5: Combined filters
  console.log("\n5. Combined filters:");
  const romanGov = await storage.getSocialStructures({
    cultureProfileId: "cp-roman",
    structureType: "government",
  });
  assert(romanGov.length > 0, `Found ${romanGov.length} Roman government structures`);
  assert(
    romanGov.every((s) => s.cultureProfileId === "cp-roman" && s.structureType === "government"),
    "All results match both filters"
  );

  // Test 6: Get by ID
  console.log("\n6. Getting by ID:");
  const byId = await storage.getSocialStructureById("ss-001");
  assert(byId !== null, "Found structure by ID");
  assert(byId?.id === "ss-001", `ID matches: ${byId?.id}`);

  const notFound = await storage.getSocialStructureById("nonexistent");
  assert(notFound === null, "Returns null for nonexistent ID");

  // Test 7: All structure types are present
  console.log("\n7. Checking all structure types:");
  const expectedTypes = [
    "government", "class_hierarchy", "family_structure", "gender_roles",
    "age_grades", "guilds_associations", "military_organization",
    "religious_hierarchy", "legal_system", "education_system",
  ];
  for (const t of expectedTypes) {
    const ofType = await storage.getSocialStructures({ structureType: t });
    assert(ofType.length > 0, `Found ${ofType.length} entries of type '${t}'`);
  }

  // Test 8: Validate inheritance_pattern values
  console.log("\n8. Validating inheritance_pattern values:");
  const validInheritance = ["patrilineal", "matrilineal", "bilateral", "primogeniture", "elective"];
  const invalidInheritance = all.filter((s) => s.inheritancePattern && !validInheritance.includes(s.inheritancePattern));
  assert(invalidInheritance.length === 0, `All inheritance patterns valid (${invalidInheritance.length} invalid)`);

  // Test 9: Validate decision_making values
  console.log("\n9. Validating decision_making values:");
  const validDecision = ["autocratic", "oligarchic", "democratic", "consensus", "theocratic"];
  const invalidDecision = all.filter((s) => s.decisionMaking && !validDecision.includes(s.decisionMaking));
  assert(invalidDecision.length === 0, `All decision_making values valid (${invalidDecision.length} invalid)`);

  // Test 10: No duplicate IDs
  console.log("\n10. Checking for duplicate IDs:");
  const ids = all.map((s) => s.id);
  const uniqueIds = new Set(ids);
  assert(ids.length === uniqueIds.size, `No duplicate IDs (${ids.length} total, ${uniqueIds.size} unique)`);

  // Test 11: Key roles parsed correctly (pipe-separated)
  console.log("\n11. Checking key_roles parsing:");
  const withRoles = all.filter((s) => s.keyRoles.length > 0);
  assert(withRoles.length > 200, `${withRoles.length} entries have key roles`);
  const multiRoleEntry = withRoles.find((s) => s.keyRoles.length >= 3);
  assert(multiRoleEntry !== undefined, `Found entry with 3+ roles: ${multiRoleEntry?.keyRoles.join(", ")}`);

  // Test 12: Coverage of 40+ cultures
  console.log("\n12. Checking culture coverage:");
  const cultures = new Set(all.map((s) => s.cultureProfileId));
  assert(cultures.size >= 40, `${cultures.size} distinct cultures (expected >= 40)`);

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

testSocialStructures().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
