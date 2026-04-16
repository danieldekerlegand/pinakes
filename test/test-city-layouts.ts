/**
 * Test script for city layouts TSV data
 * Run with: npx tsx test/test-city-layouts.ts
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

async function testCityLayouts() {
  console.log("=== Testing City Layouts TSV ===\n");

  const storage = new TsvStorage();

  // Test: Load all city layouts
  console.log("1. Loading all city layouts");
  const all = await storage.getCityLayouts();
  assert(all.length >= 10, `Expected at least 10 city layouts, got ${all.length}`);

  // Test: Each layout has required fields
  console.log("\n2. Validating required fields");
  for (const layout of all) {
    assert(!!layout.id, `Layout has id: ${layout.id}`);
    assert(!!layout.layoutType, `Layout ${layout.id} has layoutType: ${layout.layoutType}`);
    assert(!!layout.description, `Layout ${layout.id} has description`);
    assert(Array.isArray(layout.keyFeatures), `Layout ${layout.id} has keyFeatures array`);
    assert(Array.isArray(layout.waterManagement), `Layout ${layout.id} has waterManagement array`);
  }

  // Test: Valid layout types
  console.log("\n3. Validating layout types");
  const validTypes = ["grid", "organic", "radial", "linear", "citadel", "terraced", "canal-based", "fortified"];
  for (const layout of all) {
    assert(validTypes.includes(layout.layoutType), `Layout ${layout.id} has valid type: ${layout.layoutType}`);
  }

  // Test: Unique IDs
  console.log("\n4. Checking unique IDs");
  const ids = all.map((l) => l.id);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === ids.length, `All ${ids.length} IDs are unique`);

  // Test: Filter by layout type
  console.log("\n5. Filtering by layout type");
  const gridLayouts = await storage.getCityLayouts({ layoutType: "grid" });
  assert(gridLayouts.length > 0, `Found ${gridLayouts.length} grid layouts`);
  for (const layout of gridLayouts) {
    assert(layout.layoutType === "grid", `Filtered layout ${layout.id} is grid type`);
  }

  // Test: Filter by culture profile
  console.log("\n6. Filtering by culture profile");
  const romanLayouts = await storage.getCityLayouts({ cultureProfileId: "cp-roman" });
  assert(romanLayouts.length > 0, `Found ${romanLayouts.length} Roman city layouts`);
  for (const layout of romanLayouts) {
    assert(layout.cultureProfileId === "cp-roman", `Filtered layout ${layout.id} belongs to Roman culture`);
  }

  // Test: Filter by settlement
  console.log("\n7. Filtering by settlement");
  const urLayouts = await storage.getCityLayouts({ settlementId: "settle-ur" });
  assert(urLayouts.length > 0, `Found ${urLayouts.length} layouts for Ur`);

  // Test: Get by ID
  console.log("\n8. Get city layout by ID");
  const first = all[0];
  const byId = await storage.getCityLayoutById(first.id);
  assert(byId !== null, `Found layout by ID: ${first.id}`);
  assert(byId?.layoutType === first.layoutType, `Layout type matches`);

  // Test: Non-existent layout returns null
  console.log("\n9. Non-existent layout");
  const notFound = await storage.getCityLayoutById("cl-999");
  assert(notFound === null, "Non-existent layout returns null");

  // Test: Key features are pipe-separated correctly
  console.log("\n10. Key features parsing");
  for (const layout of all) {
    if (layout.keyFeatures.length > 0) {
      assert(
        layout.keyFeatures.every((f) => !f.includes("|")),
        `Layout ${layout.id} key features are properly split`
      );
    }
  }

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

testCityLayouts().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
