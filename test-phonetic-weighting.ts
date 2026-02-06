/**
 * Test script to compare IPA vs IPA-Weighted phonetic feature-based distance
 * Run with: npx tsx test-phonetic-weighting.ts
 */

import { calculatePairwiseDistance } from "./server/services/linguistic-distance-calculator";
import { TsvStorage } from "./server/tsv-storage";

async function testPhoneticWeighting() {
  console.log("=== Phonetic Feature-Based Weighting Test ===\n");

  const storage = new TsvStorage();
  const languages = await storage.getLanguages();

  // Test pairs of closely related languages where phonetic details matter
  const testPairs = [
    { lang1Id: "swe", lang2Id: "dan", name: "Swedish ↔ Danish" },
    { lang1Id: "spa", lang2Id: "por", name: "Spanish ↔ Portuguese" },
    { lang1Id: "rus", lang2Id: "ukr", name: "Russian ↔ Ukrainian" },
    { lang1Id: "nld", lang2Id: "deu", name: "Dutch ↔ German" },
  ];

  for (const pair of testPairs) {
    const lang1 = languages.find(l => l.id === pair.lang1Id);
    const lang2 = languages.find(l => l.id === pair.lang2Id);

    if (!lang1 || !lang2) {
      console.log(`⚠️  Skipping ${pair.name} - one or both languages not found\n`);
      continue;
    }

    console.log(`\n${pair.name}`);
    console.log("─".repeat(60));

    // Standard IPA (unweighted)
    const ipaResult = await calculatePairwiseDistance(lang1, lang2, 'ipa');

    // IPA with phonetic feature weighting
    const ipaWeightedResult = await calculatePairwiseDistance(lang1, lang2, 'ipa-weighted');

    if (ipaResult.lexical.ldnd === -1 || ipaWeightedResult.lexical.ldnd === -1) {
      console.log("⚠️  Insufficient data for comparison\n");
      continue;
    }

    console.log(`IPA (Unweighted):  LDND = ${ipaResult.lexical.ldnd.toFixed(4)}`);
    console.log(`                   Cognates = ${ipaResult.lexical.sharedCognates}`);
    console.log(`                   Avg Levenshtein = ${ipaResult.lexical.avgLevenshtein.toFixed(4)}`);

    console.log();

    console.log(`IPA+ (Weighted):   LDND = ${ipaWeightedResult.lexical.ldnd.toFixed(4)}`);
    console.log(`                   Cognates = ${ipaWeightedResult.lexical.sharedCognates}`);
    console.log(`                   Avg Levenshtein = ${ipaWeightedResult.lexical.avgLevenshtein.toFixed(4)}`);

    const difference = ipaResult.lexical.ldnd - ipaWeightedResult.lexical.ldnd;
    const percentChange = (difference / ipaResult.lexical.ldnd) * 100;

    console.log();
    console.log(`Impact: ${difference > 0 ? 'CLOSER' : 'MORE DISTANT'} by ${Math.abs(difference).toFixed(4)}`);
    console.log(`        (${Math.abs(percentChange).toFixed(1)}% ${difference > 0 ? 'decrease' : 'increase'})`);
    console.log(`        Detected ${ipaWeightedResult.lexical.sharedCognates - ipaResult.lexical.sharedCognates} additional cognates`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("Explanation:");
  console.log("IPA+ (Weighted) uses phonetic feature-based distance weighting.");
  console.log("Substitutions with similar articulatory features (e.g., p→b)");
  console.log("cost less than dissimilar ones (e.g., p→s), making it more");
  console.log("accurate for closely related languages with systematic sound changes.");
  console.log("=".repeat(60) + "\n");
}

testPhoneticWeighting().catch(console.error);
