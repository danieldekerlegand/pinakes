/**
 * Test script for architectural styles TSV loader and API
 * Run with: npx tsx test-architectural-styles.ts
 */

import { TsvStorage } from "../server/tsv-storage";

async function testArchitecturalStyles() {
  console.log("=== Testing Architectural Styles ===\n");

  const storage = new TsvStorage();

  // Test 1: Load all styles
  const allStyles = await storage.getArchitecturalStyles();
  console.log(`Total architectural styles loaded: ${allStyles.length}`);
  if (allStyles.length === 0) {
    console.error("✗ FAIL: No architectural styles loaded");
    process.exit(1);
  }
  console.log("✓ PASS: Styles loaded successfully\n");

  // Test 2: Verify structure of first style
  const first = allStyles[0];
  const requiredFields = [
    "id", "name", "stylePeriod", "originDate", "endDate",
    "originCoordinates", "region", "description", "associatedCivilizations",
    "associatedLanguages", "keyFeatures", "notableExamples", "buildingTypes",
  ];
  const missingFields = requiredFields.filter((f) => !(f in first));
  if (missingFields.length > 0) {
    console.error(`✗ FAIL: Missing fields: ${missingFields.join(", ")}`);
    process.exit(1);
  }
  console.log("✓ PASS: All required fields present\n");

  // Test 3: Verify coordinate parsing
  const hasValidCoords = allStyles.every(
    (s) =>
      typeof s.originCoordinates.lat === "number" &&
      typeof s.originCoordinates.lng === "number" &&
      s.originCoordinates.lat !== 0 &&
      s.originCoordinates.lng !== 0
  );
  if (!hasValidCoords) {
    console.error("✗ FAIL: Some styles have invalid coordinates");
    process.exit(1);
  }
  console.log("✓ PASS: All coordinates parsed correctly\n");

  // Test 4: Verify JSON array fields
  const hasValidArrays = allStyles.every(
    (s) =>
      Array.isArray(s.associatedLanguages) &&
      Array.isArray(s.keyFeatures) &&
      Array.isArray(s.notableExamples) &&
      Array.isArray(s.buildingTypes) &&
      s.keyFeatures.length > 0 &&
      s.notableExamples.length > 0
  );
  if (!hasValidArrays) {
    console.error("✗ FAIL: Some styles have invalid array fields");
    process.exit(1);
  }
  console.log("✓ PASS: All JSON array fields parsed correctly\n");

  // Test 5: Filter by style period
  const medievalStyles = await storage.getArchitecturalStyles({
    stylePeriod: "Medieval",
  });
  console.log(`Medieval styles: ${medievalStyles.length}`);
  if (medievalStyles.length === 0) {
    console.error("✗ FAIL: No Medieval styles found");
    process.exit(1);
  }
  const allMedieval = medievalStyles.every((s) => s.stylePeriod === "Medieval");
  if (!allMedieval) {
    console.error("✗ FAIL: Non-Medieval styles in filtered results");
    process.exit(1);
  }
  console.log("✓ PASS: Style period filter works\n");

  // Test 6: Filter by region
  const asiaStyles = await storage.getArchitecturalStyles({
    region: "East Asia",
  });
  console.log(`East Asia styles: ${asiaStyles.length}`);
  if (asiaStyles.length === 0) {
    console.error("✗ FAIL: No East Asia styles found");
    process.exit(1);
  }
  console.log("✓ PASS: Region filter works\n");

  // Test 7: Get by ID
  const gothic = await storage.getArchitecturalStyleById("arch-006");
  if (!gothic || gothic.name !== "Gothic") {
    console.error("✗ FAIL: getArchitecturalStyleById failed");
    process.exit(1);
  }
  console.log(`✓ PASS: getArchitecturalStyleById('arch-006') = ${gothic.name}\n`);

  // Test 8: Get by non-existent ID
  const notFound = await storage.getArchitecturalStyleById("arch-999");
  if (notFound !== null) {
    console.error("✗ FAIL: Non-existent ID should return null");
    process.exit(1);
  }
  console.log("✓ PASS: Non-existent ID returns null\n");

  // Print summary
  console.log("=== All Tests Passed ===");
  console.log(`\nLoaded ${allStyles.length} architectural styles:`);
  for (const s of allStyles) {
    console.log(
      `  ${s.id}: ${s.name} (${s.stylePeriod}, ${s.region}, ${s.originDate} to ${s.endDate})`
    );
  }
}

testArchitecturalStyles().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
