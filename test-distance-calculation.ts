/**
 * Test script for linguistic distance calculation
 * Run with: npx tsx test-distance-calculation.ts
 */

import {
  calculatePairwiseDistance,
  calculateDistanceMatrix,
  calculateGeographicDistance,
} from "./server/services/linguistic-distance-calculator";
import { TsvStorage } from "./server/tsv-storage";
import type { Language } from "./shared/types";

async function testDistanceCalculation() {
  console.log("=== Linguistic Distance Calculation Test ===\n");

  // Initialize storage
  const storage = new TsvStorage();
  const languages = await storage.getLanguages();

  console.log(`Loaded ${languages.length} languages from database\n`);

  // Test 1: Finnish vs Estonian (should be very similar - both Uralic/Finnic)
  console.log("Test 1: Finnish vs Estonian (Expected: Very Similar)");
  const finnish = languages.find(l => l.id === "fin");
  const estonian = languages.find(l => l.id === "est");

  if (finnish && estonian) {
    const result1 = await calculatePairwiseDistance(finnish, estonian);
    console.log(`  LDND Score: ${result1.lexical.ldnd.toFixed(4)}`);
    console.log(`  Avg Levenshtein: ${result1.lexical.avgLevenshtein.toFixed(4)}`);
    console.log(`  Compared Words: ${result1.lexical.comparedWords}`);
    console.log(`  Coverage: ${(result1.lexical.coverage * 100).toFixed(1)}%`);
    console.log(`  Estimated Cognates: ${result1.lexical.sharedCognates}`);
    console.log(`  Confidence: ${(result1.confidence * 100).toFixed(1)}%`);

    const geoDist1 = calculateGeographicDistance(finnish, estonian);
    if (geoDist1) {
      console.log(`  Geographic Distance: ${geoDist1.toFixed(0)} km`);
    }
    console.log("");
  } else {
    console.log("  Could not find Finnish or Estonian in dataset\n");
  }

  // Test 2: English vs German (should be moderately similar - both Germanic)
  console.log("Test 2: English vs German (Expected: Moderately Similar)");
  const english = languages.find(l => l.id === "eng");
  const german = languages.find(l => l.id === "deu");

  if (english && german) {
    const result2 = await calculatePairwiseDistance(english, german);
    console.log(`  LDND Score: ${result2.lexical.ldnd.toFixed(4)}`);
    console.log(`  Avg Levenshtein: ${result2.lexical.avgLevenshtein.toFixed(4)}`);
    console.log(`  Compared Words: ${result2.lexical.comparedWords}`);
    console.log(`  Coverage: ${(result2.lexical.coverage * 100).toFixed(1)}%`);
    console.log(`  Estimated Cognates: ${result2.lexical.sharedCognates}`);
    console.log(`  Confidence: ${(result2.confidence * 100).toFixed(1)}%`);

    const geoDist2 = calculateGeographicDistance(english, german);
    if (geoDist2) {
      console.log(`  Geographic Distance: ${geoDist2.toFixed(0)} km`);
    }
    console.log("");
  } else {
    console.log("  Could not find English or German in dataset\n");
  }

  // Test 3: Spanish vs Portuguese (should be very similar - both Romance)
  console.log("Test 3: Spanish vs Portuguese (Expected: Very Similar)");
  const spanish = languages.find(l => l.id === "spa");
  const portuguese = languages.find(l => l.id === "por");

  if (spanish && portuguese) {
    const result3 = await calculatePairwiseDistance(spanish, portuguese);
    console.log(`  LDND Score: ${result3.lexical.ldnd.toFixed(4)}`);
    console.log(`  Avg Levenshtein: ${result3.lexical.avgLevenshtein.toFixed(4)}`);
    console.log(`  Compared Words: ${result3.lexical.comparedWords}`);
    console.log(`  Coverage: ${(result3.lexical.coverage * 100).toFixed(1)}%`);
    console.log(`  Estimated Cognates: ${result3.lexical.sharedCognates}`);
    console.log(`  Confidence: ${(result3.confidence * 100).toFixed(1)}%`);

    const geoDist3 = calculateGeographicDistance(spanish, portuguese);
    if (geoDist3) {
      console.log(`  Geographic Distance: ${geoDist3.toFixed(0)} km`);
    }
    console.log("");
  } else {
    console.log("  Could not find Spanish or Portuguese in dataset\n");
  }

  // Test 4: Japanese vs Finnish (should be very different - unrelated families)
  console.log("Test 4: Japanese vs Finnish (Expected: Very Different)");
  const japanese = languages.find(l => l.id === "jpn");
  const finnish2 = languages.find(l => l.id === "fin");

  if (japanese && finnish2) {
    const result4 = await calculatePairwiseDistance(japanese, finnish2);
    console.log(`  LDND Score: ${result4.lexical.ldnd.toFixed(4)}`);
    console.log(`  Avg Levenshtein: ${result4.lexical.avgLevenshtein.toFixed(4)}`);
    console.log(`  Compared Words: ${result4.lexical.comparedWords}`);
    console.log(`  Coverage: ${(result4.lexical.coverage * 100).toFixed(1)}%`);
    console.log(`  Estimated Cognates: ${result4.lexical.sharedCognates}`);
    console.log(`  Confidence: ${(result4.confidence * 100).toFixed(1)}%`);

    const geoDist4 = calculateGeographicDistance(japanese, finnish2);
    if (geoDist4) {
      console.log(`  Geographic Distance: ${geoDist4.toFixed(0)} km`);
    }
    console.log("");
  } else {
    console.log("  Could not find Japanese or Finnish in dataset\n");
  }

  // Test 5: Distance Matrix for Finnic Languages
  console.log("Test 5: Distance Matrix - Finnic Languages");
  const finnicLanguages = languages.filter(l =>
    ["fin", "est", "liv", "vot", "krl"].includes(l.id)
  );

  if (finnicLanguages.length >= 2) {
    console.log(`  Computing matrix for ${finnicLanguages.length} languages...`);
    const matrixResult = await calculateDistanceMatrix(finnicLanguages, "ldnd");

    console.log("\n  Distance Matrix (LDND):");
    console.log("  " + "".padEnd(12) + matrixResult.languages.map(l => l.id.padEnd(8)).join(""));

    matrixResult.matrix.forEach((row, i) => {
      const langName = matrixResult.languages[i].id.padEnd(12);
      const values = row.map(v => v.toFixed(3).padStart(8)).join("");
      console.log(`  ${langName}${values}`);
    });
    console.log("");
  } else {
    console.log("  Not enough Finnic languages found in dataset\n");
  }

  console.log("=== Test Complete ===");
  console.log("\nInterpretation Guide:");
  console.log("  LDND < 0.20: Very Similar");
  console.log("  LDND 0.20-0.40: Similar");
  console.log("  LDND 0.40-0.60: Moderately Different");
  console.log("  LDND 0.60-0.80: Different");
  console.log("  LDND > 0.80: Very Different");
}

// Run the test
testDistanceCalculation().catch(console.error);
