/**
 * Test script comparing IPA vs ASJP phonetic encodings
 * Run with: npx tsx test-ipa-vs-asjp.ts
 */

import { calculatePairwiseDistance } from "../server/services/linguistic-distance-calculator";
import { TsvStorage } from "../server/tsv-storage";

async function testIPAvsASJP() {
  console.log("=== IPA vs ASJP Phonetic Encoding Comparison ===\n");

  const storage = new TsvStorage();
  const languages = await storage.getLanguages();

  // Test Swedish vs Danish (very closely related North Germanic languages)
  const swedish = languages.find(l => l.id === "swe");
  const danish = languages.find(l => l.id === "dan");

  if (swedish && danish) {
    console.log("Swedish ↔ Danish (North Germanic, very closely related)\n");

    // Calculate with IPA (most accurate)
    const ipaResult = await calculatePairwiseDistance(swedish, danish, 'ipa');
    console.log("Using IPA (International Phonetic Alphabet):");
    console.log(`  LDND Score: ${ipaResult.lexical.ldnd.toFixed(4)}`);
    console.log(`  Avg Levenshtein: ${ipaResult.lexical.avgLevenshtein.toFixed(4)}`);
    console.log(`  Compared Words: ${ipaResult.lexical.comparedWords}`);
    console.log(`  Estimated Cognates: ${ipaResult.lexical.sharedCognates}\n`);

    // Calculate with ASJP (simplified)
    const asjpResult = await calculatePairwiseDistance(swedish, danish, 'asjp');
    console.log("Using ASJP (Automated Similarity Judgment Program):");
    console.log(`  LDND Score: ${asjpResult.lexical.ldnd.toFixed(4)}`);
    console.log(`  Avg Levenshtein: ${asjpResult.lexical.avgLevenshtein.toFixed(4)}`);
    console.log(`  Compared Words: ${asjpResult.lexical.comparedWords}`);
    console.log(`  Estimated Cognates: ${asjpResult.lexical.sharedCognates}\n`);

    // Calculate with orthography (written form)
    const wordformResult = await calculatePairwiseDistance(swedish, danish, 'wordform');
    console.log("Using Orthography (written word forms):");
    console.log(`  LDND Score: ${wordformResult.lexical.ldnd.toFixed(4)}`);
    console.log(`  Avg Levenshtein: ${wordformResult.lexical.avgLevenshtein.toFixed(4)}`);
    console.log(`  Compared Words: ${wordformResult.lexical.comparedWords}`);
    console.log(`  Estimated Cognates: ${wordformResult.lexical.sharedCognates}\n`);

    // Analysis
    const ipaDiff = Math.abs(ipaResult.lexical.ldnd - asjpResult.lexical.ldnd);
    console.log("Analysis:");
    console.log(`  IPA shows ${ipaResult.lexical.ldnd < asjpResult.lexical.ldnd ? 'CLOSER' : 'MORE DISTANT'} relationship`);
    console.log(`  Difference: ${ipaDiff.toFixed(4)} (${((ipaDiff / asjpResult.lexical.ldnd) * 100).toFixed(1)}% change)`);
    console.log(`  IPA detected ${ipaResult.lexical.sharedCognates - asjpResult.lexical.sharedCognates} more cognates\n`);
  }

  // Test English vs German (Germanic but more distantly related)
  const english = languages.find(l => l.id === "eng");
  const german = languages.find(l => l.id === "deu");

  if (english && german) {
    console.log("English ↔ German (Germanic, moderately related)\n");

    const ipaResult = await calculatePairwiseDistance(english, german, 'ipa');
    console.log(`IPA:        LDND = ${ipaResult.lexical.ldnd.toFixed(4)}, Cognates = ${ipaResult.lexical.sharedCognates}`);

    const asjpResult = await calculatePairwiseDistance(english, german, 'asjp');
    console.log(`ASJP:       LDND = ${asjpResult.lexical.ldnd.toFixed(4)}, Cognates = ${asjpResult.lexical.sharedCognates}`);

    const wordformResult = await calculatePairwiseDistance(english, german, 'wordform');
    console.log(`Wordform:   LDND = ${wordformResult.lexical.ldnd.toFixed(4)}, Cognates = ${wordformResult.lexical.sharedCognates}\n`);
  }

  // Test Spanish vs Portuguese (Romance, very closely related)
  const spanish = languages.find(l => l.id === "spa");
  const portuguese = languages.find(l => l.id === "por");

  if (spanish && portuguese) {
    console.log("Spanish ↔ Portuguese (Romance, very closely related)\n");

    const ipaResult = await calculatePairwiseDistance(spanish, portuguese, 'ipa');
    console.log(`IPA:        LDND = ${ipaResult.lexical.ldnd.toFixed(4)}, Cognates = ${ipaResult.lexical.sharedCognates}`);

    const asjpResult = await calculatePairwiseDistance(spanish, portuguese, 'asjp');
    console.log(`ASJP:       LDND = ${asjpResult.lexical.ldnd.toFixed(4)}, Cognates = ${asjpResult.lexical.sharedCognates}`);

    const wordformResult = await calculatePairwiseDistance(spanish, portuguese, 'wordform');
    console.log(`Wordform:   LDND = ${wordformResult.lexical.ldnd.toFixed(4)}, Cognates = ${wordformResult.lexical.sharedCognates}\n`);
  }

  console.log("=== Conclusion ===");
  console.log("IPA encoding provides more accurate phonetic representation,");
  console.log("especially for closely related languages with subtle phonetic differences.");
  console.log("ASJP is faster but loses fine-grained phonetic detail.");
  console.log("Orthography is useful for languages with consistent spelling-sound correspondence.\n");
}

testIPAvsASJP().catch(console.error);
