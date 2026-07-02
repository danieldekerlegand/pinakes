/**
 * Test script for verifying only languages with data are shown
 * Run with: npx tsx test-available-languages.ts
 */

import { getAvailableLanguageIds, calculatePairwiseDistance } from "../server/services/linguistic-distance-calculator";
import { TsvStorage } from "../server/tsv-storage";

async function testAvailableLanguages() {
  console.log("=== Testing Available Languages Filter ===\n");

  // Get all languages
  const storage = new TsvStorage();
  const allLanguages = await storage.getLanguages();
  console.log(`Total languages in database: ${allLanguages.length}`);

  // Get available languages (with word data)
  const availableIds = getAvailableLanguageIds();
  console.log(`Languages with word data: ${availableIds.length}\n`);

  // Test a language WITH data (English)
  const english = allLanguages.find(l => l.id === "eng");
  if (english) {
    const hasData = availableIds.includes("eng");
    console.log(`✓ English (eng): ${hasData ? "HAS word data" : "NO word data"} - ${hasData ? "✓ PASS" : "✗ FAIL"}`);
  }

  // Test a language WITH data (Spanish)
  const spanish = allLanguages.find(l => l.id === "spa");
  if (spanish) {
    const hasData = availableIds.includes("spa");
    console.log(`✓ Spanish (spa): ${hasData ? "HAS word data" : "NO word data"} - ${hasData ? "✓ PASS" : "✗ FAIL"}`);
  }

  // Test a language WITHOUT data (Azerbaijani)
  const azerbaijani = allLanguages.find(l => l.id === "aze");
  if (azerbaijani) {
    const hasData = availableIds.includes("aze");
    console.log(`✓ Azerbaijani (aze): ${hasData ? "HAS word data" : "NO word data"} - ${!hasData ? "✓ PASS" : "✗ FAIL"}`);
  }

  // Test distance calculation with languages that HAVE data
  console.log("\n=== Testing Distance Calculation ===\n");

  const german = allLanguages.find(l => l.id === "deu");
  if (english && german) {
    console.log("Calculating distance: English ↔ German (both have data)");
    const result = await calculatePairwiseDistance(english, german);

    if (result.lexical.ldnd === -1) {
      console.log("  ✗ FAIL: Got -1 (insufficient data) but both languages have data!");
    } else {
      console.log(`  ✓ PASS: LDND = ${result.lexical.ldnd.toFixed(4)}`);
      console.log(`  Compared ${result.lexical.comparedWords} words`);
      console.log(`  Coverage: ${(result.lexical.coverage * 100).toFixed(1)}%`);
    }
  }

  // Test distance calculation with language that has NO data
  if (azerbaijani && english) {
    console.log("\nCalculating distance: English ↔ Azerbaijani (Azerbaijani has NO data)");
    const result = await calculatePairwiseDistance(english, azerbaijani);

    if (result.lexical.ldnd === -1) {
      console.log("  ✓ PASS: Correctly returned -1 (insufficient data)");
      console.log(`  Compared ${result.lexical.comparedWords} words (expected 0)`);
    } else {
      console.log(`  ✗ FAIL: Got LDND = ${result.lexical.ldnd.toFixed(4)}, expected -1`);
    }
  }

  console.log("\n=== Sample of Available Languages ===\n");
  const availableLanguages = allLanguages.filter(l => availableIds.includes(l.id));
  const sample = availableLanguages.slice(0, 15);

  sample.forEach(lang => {
    const display = `${lang.name} (${lang.id})`.padEnd(30);
    const family = lang.familyId.split('__')[0];
    console.log(`  ${display} - ${family}`);
  });

  console.log(`\n  ... and ${availableLanguages.length - sample.length} more`);

  console.log("\n=== Test Complete ===");
}

testAvailableLanguages().catch(console.error);
