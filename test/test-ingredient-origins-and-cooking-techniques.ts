/**
 * Test script for ingredient origins and cooking techniques data
 * Run with: npx tsx test/test-ingredient-origins-and-cooking-techniques.ts
 */

import { TsvStorage } from "../server/tsv-storage";
import type { IngredientOrigin, CookingTechnique } from "../server/tsv-storage";

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

async function testIngredientOrigins() {
  console.log("=== Testing Ingredient Origins ===\n");

  const storage = new TsvStorage();

  // Test loading all ingredients
  const allIngredients = await storage.getIngredientOrigins();
  assert(allIngredients.length >= 50, `Should have at least 50 ingredients (got ${allIngredients.length})`);

  // Test basic fields on first ingredient (Rice)
  const rice = allIngredients.find((i) => i.id === "ig-001");
  assert(rice !== undefined, "Rice (ig-001) should exist");
  if (rice) {
    assert(rice.name === "Rice", `Rice name should be "Rice" (got "${rice.name}")`);
    assert(rice.category === "grain", `Rice category should be "grain" (got "${rice.category}")`);
    assert(rice.originCoordinates.lat !== 0, "Rice should have non-zero lat coordinate");
    assert(rice.originCoordinates.lng !== 0, "Rice should have non-zero lng coordinate");
    assert(rice.domesticationDate !== null, "Rice should have a domestication date");
    assert(rice.spreadRoutes.length > 0, "Rice should have spread routes");
    assert(rice.cuisinesAdopted.length > 0, "Rice should have cuisines adopted");
    assert(rice.associatedLanguages.length > 0, "Rice should have associated languages");
    assert(rice.description.length > 0, "Rice should have a description");
  }

  // Test filtering by category
  const grains = await storage.getIngredientOrigins({ category: "grain" });
  assert(grains.length >= 5, `Should have at least 5 grains (got ${grains.length})`);
  assert(grains.every((g) => g.category === "grain"), "All filtered items should be grains");

  const spices = await storage.getIngredientOrigins({ category: "spice" });
  assert(spices.length >= 8, `Should have at least 8 spices (got ${spices.length})`);

  // Test filtering by cuisine
  const chineseIngredients = await storage.getIngredientOrigins({ cuisineId: "chinese" });
  assert(chineseIngredients.length >= 5, `Chinese cuisine should use at least 5 ingredients (got ${chineseIngredients.length})`);

  const mexicanIngredients = await storage.getIngredientOrigins({ cuisineId: "mexican" });
  assert(mexicanIngredients.length >= 3, `Mexican cuisine should use at least 3 ingredients (got ${mexicanIngredients.length})`);

  // Test get by ID
  const tomato = await storage.getIngredientOriginById("ig-005");
  assert(tomato !== null, "Tomato (ig-005) should be found by ID");
  assert(tomato?.name === "Tomato", `Should be Tomato (got "${tomato?.name}")`);

  const notFound = await storage.getIngredientOriginById("ig-999");
  assert(notFound === null, "Non-existent ID should return null");

  // Test that all ingredients have valid coordinates
  const allHaveCoords = allIngredients.every(
    (i) => typeof i.originCoordinates.lat === "number" && typeof i.originCoordinates.lng === "number"
  );
  assert(allHaveCoords, "All ingredients should have valid coordinates");

  // Test unique IDs
  const ids = allIngredients.map((i) => i.id);
  const uniqueIds = new Set(ids);
  assert(ids.length === uniqueIds.size, `All ingredient IDs should be unique (${ids.length} total, ${uniqueIds.size} unique)`);

  console.log("");
}

async function testCookingTechniques() {
  console.log("=== Testing Cooking Techniques ===\n");

  const storage = new TsvStorage();

  // Test loading all techniques
  const allTechniques = await storage.getCookingTechniques();
  assert(allTechniques.length >= 25, `Should have at least 25 techniques (got ${allTechniques.length})`);

  // Test basic fields on first technique (Stir-Frying)
  const stirFry = allTechniques.find((t) => t.id === "ct-001");
  assert(stirFry !== undefined, "Stir-Frying (ct-001) should exist");
  if (stirFry) {
    assert(stirFry.name === "Stir-Frying", `Name should be "Stir-Frying" (got "${stirFry.name}")`);
    assert(stirFry.category === "heat", `Category should be "heat" (got "${stirFry.category}")`);
    assert(stirFry.originRegion === "China", `Origin should be "China" (got "${stirFry.originRegion}")`);
    assert(stirFry.originCoordinates.lat !== 0, "Should have non-zero lat coordinate");
    assert(stirFry.timeOrigin !== null, "Should have a time origin");
    assert(stirFry.originCulture.length > 0, "Should have an origin culture");
    assert(stirFry.spreadPattern.length > 0, "Should have spread patterns");
    assert(stirFry.cuisinesUsing.length > 0, "Should have cuisines using it");
    assert(stirFry.relatedTechniques.length > 0, "Should have related techniques");
    assert(stirFry.associatedLanguages.length > 0, "Should have associated languages");
    assert(stirFry.description.length > 0, "Should have a description");
  }

  // Test filtering by category
  const heatTechniques = await storage.getCookingTechniques({ category: "heat" });
  assert(heatTechniques.length >= 10, `Should have at least 10 heat techniques (got ${heatTechniques.length})`);
  assert(heatTechniques.every((t) => t.category === "heat"), "All filtered items should be heat techniques");

  const preservationTechniques = await storage.getCookingTechniques({ category: "preservation" });
  assert(preservationTechniques.length >= 4, `Should have at least 4 preservation techniques (got ${preservationTechniques.length})`);

  // Test filtering by cuisine
  const chineseTechniques = await storage.getCookingTechniques({ cuisineId: "chinese" });
  assert(chineseTechniques.length >= 5, `Chinese cuisine should use at least 5 techniques (got ${chineseTechniques.length})`);

  const frenchTechniques = await storage.getCookingTechniques({ cuisineId: "french" });
  assert(frenchTechniques.length >= 5, `French cuisine should use at least 5 techniques (got ${frenchTechniques.length})`);

  // Test get by ID
  const fermentation = await storage.getCookingTechniqueById("ct-004");
  assert(fermentation !== null, "Fermentation (ct-004) should be found by ID");
  assert(fermentation?.name === "Fermentation", `Should be Fermentation (got "${fermentation?.name}")`);

  const notFound = await storage.getCookingTechniqueById("ct-999");
  assert(notFound === null, "Non-existent ID should return null");

  // Test unique IDs
  const ids = allTechniques.map((t) => t.id);
  const uniqueIds = new Set(ids);
  assert(ids.length === uniqueIds.size, `All technique IDs should be unique (${ids.length} total, ${uniqueIds.size} unique)`);

  // Test that related techniques reference valid IDs
  const allIds = new Set(allTechniques.map((t) => t.id));
  for (const technique of allTechniques) {
    for (const relatedId of technique.relatedTechniques) {
      if (!allIds.has(relatedId)) {
        assert(false, `Technique ${technique.id} references unknown related technique ${relatedId}`);
      }
    }
  }
  assert(true, "All related technique references are valid");

  console.log("");
}

async function main() {
  try {
    await testIngredientOrigins();
    await testCookingTechniques();

    console.log("=== Results ===");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total: ${passed + failed}`);

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error("Test error:", error);
    process.exit(1);
  }
}

main();
