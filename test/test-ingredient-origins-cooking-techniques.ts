/**
 * Test script for ingredient origins and cooking techniques TSV loaders
 * Run with: npx tsx test/test-ingredient-origins-cooking-techniques.ts
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

async function testIngredientOrigins() {
  console.log("=== Testing Ingredient Origins ===\n");

  const storage = new TsvStorage();

  // Test loading all ingredient origins
  const allIngredients = await storage.getIngredientOrigins();
  assert(allIngredients.length > 0, `Loaded ${allIngredients.length} ingredient origins`);

  // Test structure of first ingredient
  const first = allIngredients[0];
  assert(typeof first.id === "string" && first.id.length > 0, "Ingredient has valid id");
  assert(typeof first.name === "string" && first.name.length > 0, "Ingredient has valid name");
  assert(typeof first.cuisineId === "string" && first.cuisineId.length > 0, "Ingredient has valid cuisineId");
  assert(typeof first.originRegion === "string", "Ingredient has originRegion");
  assert(typeof first.coordinates.lat === "number", "Ingredient has valid lat coordinate");
  assert(typeof first.coordinates.lng === "number", "Ingredient has valid lng coordinate");
  assert(first.timeOrigin === null || typeof first.timeOrigin === "number", "Ingredient has valid timeOrigin");

  // Test filtering by cuisineId
  const chineseIngredients = await storage.getIngredientOrigins({ cuisineId: "chinese" });
  assert(chineseIngredients.length > 0, `Found ${chineseIngredients.length} Chinese ingredients`);
  assert(
    chineseIngredients.every((i) => i.cuisineId === "chinese"),
    "All filtered ingredients belong to Chinese cuisine"
  );

  // Test filtering by region
  const eastAsiaIngredients = await storage.getIngredientOrigins({ region: "East Asia" });
  assert(eastAsiaIngredients.length > 0, `Found ${eastAsiaIngredients.length} East Asian ingredients`);
  assert(
    eastAsiaIngredients.every((i) => i.originRegion.toLowerCase().includes("east asia")),
    "All filtered ingredients from East Asia"
  );

  // Test filtering by year
  const ancientIngredients = await storage.getIngredientOrigins({ year: -5000 });
  assert(ancientIngredients.length > 0, `Found ${ancientIngredients.length} ingredients available by 5000 BCE`);
  assert(
    ancientIngredients.every((i) => {
      const start = i.timeOrigin ?? -Infinity;
      const end = i.timeEnd ?? Infinity;
      return -5000 >= start && -5000 <= end;
    }),
    "All filtered ingredients valid for 5000 BCE"
  );

  // Test known ingredient
  const rice = allIngredients.find((i) => i.id === "rice-chinese");
  assert(rice !== undefined, "Found rice ingredient");
  if (rice) {
    assert(rice.name === "Rice", "Rice has correct name");
    assert(rice.cuisineId === "chinese", "Rice belongs to Chinese cuisine");
    assert(rice.nativeName === "稻", "Rice has correct native name");
  }
}

async function testCookingTechniques() {
  console.log("\n=== Testing Cooking Techniques ===\n");

  const storage = new TsvStorage();

  // Test loading all cooking techniques
  const allTechniques = await storage.getCookingTechniques();
  assert(allTechniques.length > 0, `Loaded ${allTechniques.length} cooking techniques`);

  // Test structure of first technique
  const first = allTechniques[0];
  assert(typeof first.id === "string" && first.id.length > 0, "Technique has valid id");
  assert(typeof first.name === "string" && first.name.length > 0, "Technique has valid name");
  assert(typeof first.cuisineId === "string" && first.cuisineId.length > 0, "Technique has valid cuisineId");
  assert(typeof first.category === "string", "Technique has category");
  assert(typeof first.coordinates.lat === "number", "Technique has valid lat coordinate");
  assert(typeof first.coordinates.lng === "number", "Technique has valid lng coordinate");

  // Test filtering by cuisineId
  const frenchTechniques = await storage.getCookingTechniques({ cuisineId: "french" });
  assert(frenchTechniques.length > 0, `Found ${frenchTechniques.length} French techniques`);
  assert(
    frenchTechniques.every((t) => t.cuisineId === "french"),
    "All filtered techniques belong to French cuisine"
  );

  // Test filtering by category
  const heatTechniques = await storage.getCookingTechniques({ category: "heat" });
  assert(heatTechniques.length > 0, `Found ${heatTechniques.length} heat-based techniques`);
  assert(
    heatTechniques.every((t) => t.category.toLowerCase().includes("heat")),
    "All filtered techniques are heat-based"
  );

  // Test filtering by year
  const modernTechniques = await storage.getCookingTechniques({ year: 2000 });
  assert(modernTechniques.length > 0, `Found ${modernTechniques.length} techniques available in year 2000`);

  // Test known technique
  const wok = allTechniques.find((t) => t.id === "wok-frying");
  assert(wok !== undefined, "Found wok stir-frying technique");
  if (wok) {
    assert(wok.name === "Wok Stir-Frying", "Wok has correct name");
    assert(wok.cuisineId === "chinese", "Wok belongs to Chinese cuisine");
    assert(wok.category === "heat", "Wok is categorized as heat technique");
  }

  // Test fermentation techniques
  const fermentTechniques = await storage.getCookingTechniques({ category: "fermentation" });
  assert(fermentTechniques.length > 0, `Found ${fermentTechniques.length} fermentation techniques`);
  const kimchi = fermentTechniques.find((t) => t.id === "kimchi-ferment");
  assert(kimchi !== undefined, "Found kimchi fermentation");
}

async function main() {
  try {
    await testIngredientOrigins();
    await testCookingTechniques();

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error("Test error:", error);
    process.exit(1);
  }
}

main();
