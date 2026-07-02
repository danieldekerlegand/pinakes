/**
 * Tests for the Wiktionary phonology scraper.
 * Run with: npx tsx test/test-wiktionary-phonology-scraper.ts
 */

import { wiktionaryPhonologyScraper } from "../server/services/wiktionary-phonology-scraper";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function section(name: string) {
  console.log(`\n=== ${name} ===`);
}

// --- Unit tests for IPA extraction and classification ---

section("IPA Symbol Extraction");

{
  const symbols = wiktionaryPhonologyScraper.extractIPASymbols(
    "The phonemes are /p/, /b/, /t/, /d/, /k/, /ɡ/"
  );
  assert(symbols.includes("p"), "Extracts /p/ from slash notation");
  assert(symbols.includes("b"), "Extracts /b/ from slash notation");
  assert(symbols.includes("k"), "Extracts /k/ from slash notation");
  assert(symbols.includes("ɡ"), "Extracts /ɡ/ from slash notation");
}

{
  const symbols = wiktionaryPhonologyScraper.extractIPASymbols(
    "Phonetic transcription: [pʰæt]"
  );
  assert(symbols.includes("p"), "Extracts from bracket notation");
  assert(symbols.includes("t"), "Extracts final consonant from brackets");
}

{
  const symbols = wiktionaryPhonologyScraper.extractIPASymbols(
    "{{IPA|en|/tʃ/}}"
  );
  assert(symbols.length > 0, "Extracts from IPA template");
}

{
  // Ensure wiki markup isn't mistakenly parsed as IPA
  const symbols = wiktionaryPhonologyScraper.extractIPASymbols(
    "[edit] [citation needed] [Category=Languages]"
  );
  assert(symbols.length === 0, "Ignores wiki markup in brackets");
}

section("Symbol Classification");

{
  const { consonants, vowels } = wiktionaryPhonologyScraper.classifySymbols([
    "p", "b", "t", "d", "k", "ɡ", "m", "n",
    "i", "e", "a", "o", "u",
  ]);

  assert(consonants.length === 8, `Correctly identifies 8 consonants (got ${consonants.length})`);
  assert(vowels.length === 5, `Correctly identifies 5 vowels (got ${vowels.length})`);
  assert(consonants.includes("p"), "p is classified as consonant");
  assert(vowels.includes("a"), "a is classified as vowel");
}

{
  const { consonants, vowels } = wiktionaryPhonologyScraper.classifySymbols([
    "tʃ", "dʒ", "iː", "aː",
  ]);

  assert(consonants.includes("tʃ"), "tʃ (affricate) is classified as consonant");
  assert(consonants.includes("dʒ"), "dʒ (affricate) is classified as consonant");
  assert(vowels.includes("iː"), "iː (long vowel) is classified as vowel");
  assert(vowels.includes("aː"), "aː (long vowel) is classified as vowel");
}

section("Tone Detection");

{
  const tones = wiktionaryPhonologyScraper.detectTones(
    "Mandarin has 4 tones: high level, rising, falling-rising, and falling"
  );
  assert(tones !== null, "Detects tonal language");
  assert(tones!.includes("high"), "Detects high tone");
  assert(tones!.includes("rising"), "Detects rising tone");
  assert(tones!.includes("falling"), "Detects falling tone");
}

{
  const tones = wiktionaryPhonologyScraper.detectTones(
    "English is a stress-timed language with no lexical tone."
  );
  assert(tones === null, "Returns null for non-tonal language");
}

{
  const tones = wiktionaryPhonologyScraper.detectTones(
    "The language has 6 tones that distinguish meaning."
  );
  assert(tones !== null, "Detects numbered tone system");
  assert(tones!.length === 6, `Parses 6 tones correctly (got ${tones?.length})`);
}

section("Syllable Structure Detection");

{
  const structure = wiktionaryPhonologyScraper.detectSyllableStructure(
    "The syllable structure is (C)(C)V(C)(C)."
  );
  assert(structure === "(C)(C)V(C)(C)", `Extracts syllable structure: ${structure}`);
}

{
  const structure = wiktionaryPhonologyScraper.detectSyllableStructure(
    "No syllable information here."
  );
  assert(structure === "", "Returns empty string when no structure found");
}

section("Stress System Detection");

{
  const stress = wiktionaryPhonologyScraper.detectStressSystem(
    "Finnish has fixed stress on the initial syllable."
  );
  assert(stress === "fixed, initial", `Detects fixed initial stress: ${stress}`);
}

{
  const stress = wiktionaryPhonologyScraper.detectStressSystem(
    "Russian has free or lexical stress that is unpredictable."
  );
  assert(stress === "variable, lexical", `Detects lexical stress: ${stress}`);
}

{
  const stress = wiktionaryPhonologyScraper.detectStressSystem(
    "Japanese uses a pitch accent system."
  );
  assert(stress === "pitch-accent", `Detects pitch-accent: ${stress}`);
}

{
  const stress = wiktionaryPhonologyScraper.detectStressSystem(
    "Polish has penultimate stress."
  );
  assert(stress === "penultimate", `Detects penultimate stress: ${stress}`);
}

// --- Integration test: fetch from Wiktionary ---

section("Wiktionary API Integration (live)");

async function testLiveFetch() {
  try {
    const content = await wiktionaryPhonologyScraper.fetchWiktionaryPage("English");
    assert(content !== null, "Fetches English Wiktionary page successfully");
    assert(content!.length > 100, `Page content has substantial length (${content?.length} chars)`);

    if (content) {
      const symbols = wiktionaryPhonologyScraper.extractIPASymbols(content);
      assert(symbols.length > 0, `Extracted ${symbols.length} IPA symbols from English page`);

      const { consonants, vowels } = wiktionaryPhonologyScraper.classifySymbols(symbols);
      assert(consonants.length > 0, `Found ${consonants.length} consonants`);
      assert(vowels.length > 0, `Found ${vowels.length} vowels`);
    }
  } catch (error) {
    console.log(`  ⚠ Skipping live test (network error): ${error instanceof Error ? error.message : error}`);
  }
}

async function testSingleLanguageScrape() {
  try {
    const result = await wiktionaryPhonologyScraper.scrapeLanguagePhonology({
      id: "eng",
      name: "English",
      familyId: "indo_european__germanic",
      status: "living",
    });

    if (result) {
      assert(result.languageId === "eng", "Result has correct language ID");
      assert(result.consonants.length > 5, `Found ${result.consonants.length} consonants for English`);
      assert(result.vowels.length > 3, `Found ${result.vowels.length} vowels for English`);
      assert(result.tones === null, "English correctly identified as non-tonal");
      console.log(`    Consonants: ${result.consonants.join(", ")}`);
      console.log(`    Vowels: ${result.vowels.join(", ")}`);
    } else {
      console.log("  ⚠ No result for English (may be a network issue)");
    }
  } catch (error) {
    console.log(`  ⚠ Skipping single language test (error): ${error instanceof Error ? error.message : error}`);
  }
}

await testLiveFetch();
await testSingleLanguageScrape();

// --- Summary ---

console.log(`\n${"═".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(50)}`);

process.exit(failed > 0 ? 1 : 0);
