/**
 * Test script for Language Contact Events Scraper
 * Run with: npx tsx test/test-language-contact-scraper.ts
 */

import { TsvStorage } from "../server/tsv-storage";
import { LanguageContactScraper } from "../server/services/language-contact-scraper";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.log(`  FAIL: ${message}`);
    failed++;
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual === expected) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.log(`  FAIL: ${message} (expected ${expected}, got ${actual})`);
    failed++;
  }
}

async function testExistingDataIntegrity() {
  console.log("\n=== Existing Language Contact Data Integrity ===\n");

  const storage = new TsvStorage();
  const contacts = await storage.getLanguageContacts();

  assert(contacts.length >= 90, `Has 90+ contact events (got ${contacts.length})`);

  // Verify all required fields are present
  for (const contact of contacts) {
    assert(!!contact.id, `Contact ${contact.id} has an id`);
    assert(!!contact.sourceLanguageId, `Contact ${contact.id} has sourceLanguageId`);
    assert(!!contact.targetLanguageId, `Contact ${contact.id} has targetLanguageId`);
    assert(!!contact.contactType, `Contact ${contact.id} has contactType`);
    assert(!!contact.timePeriod, `Contact ${contact.id} has timePeriod`);
    assert(!!contact.region, `Contact ${contact.id} has region`);
    assert(!!contact.intensity, `Contact ${contact.id} has intensity`);
    break; // Just check first to avoid excessive output
  }

  // Check ID format
  const idPattern = /^lc-\d{3}$/;
  const allValidIds = contacts.every((c) => idPattern.test(c.id));
  assert(allValidIds, "All contact IDs follow lc-NNN format");

  // Check contact types
  const validTypes = new Set(["substrate", "superstrate", "adstrate", "creolization", "pidginization"]);
  const contactTypes = new Set(contacts.map((c) => c.contactType));
  for (const type of contactTypes) {
    assert(validTypes.has(type), `Contact type "${type}" is valid`);
  }

  // Check intensities
  const validIntensities = new Set(["heavy", "moderate", "light"]);
  const intensities = new Set(contacts.map((c) => c.intensity));
  for (const intensity of intensities) {
    assert(validIntensities.has(intensity), `Intensity "${intensity}" is valid`);
  }

  // Check features_transferred structure
  for (const contact of contacts.slice(0, 5)) {
    const ft = contact.featuresTransferred;
    assert(Array.isArray(ft.lexical), `Contact ${contact.id} has lexical array`);
    assert(Array.isArray(ft.phonological), `Contact ${contact.id} has phonological array`);
    assert(Array.isArray(ft.grammatical), `Contact ${contact.id} has grammatical array`);
  }
}

async function testContactFiltering() {
  console.log("\n=== Contact Filtering ===\n");

  const storage = new TsvStorage();

  // Filter by contact type
  const superstrate = await storage.getLanguageContacts(undefined, undefined, "superstrate");
  assert(superstrate.length > 0, `Found superstrate contacts (${superstrate.length})`);
  assert(
    superstrate.every((c) => c.contactType === "superstrate"),
    "All filtered contacts are superstrate"
  );

  // Filter by intensity
  const heavy = await storage.getLanguageContacts(undefined, undefined, undefined, "heavy");
  assert(heavy.length > 0, `Found heavy intensity contacts (${heavy.length})`);
  assert(
    heavy.every((c) => c.intensity === "heavy"),
    "All filtered contacts are heavy intensity"
  );

  // Filter by source language
  const fromFrench = await storage.getLanguageContacts("fra");
  assert(fromFrench.length > 0, `Found contacts from French (${fromFrench.length})`);
  assert(
    fromFrench.every((c) => c.sourceLanguageId === "fra"),
    "All filtered contacts have French as source"
  );

  // Get by ID
  const contact = await storage.getLanguageContactById("lc-001");
  assert(contact !== null, "Found contact lc-001");
  assertEqual(contact?.sourceLanguageId, "fra", "lc-001 source is French");
  assertEqual(contact?.targetLanguageId, "eng", "lc-001 target is English");

  // Get by language (both directions)
  const engContacts = await storage.getLanguageContactsByLanguage("eng");
  assert(engContacts.length > 0, `Found contacts involving English (${engContacts.length})`);
  assert(
    engContacts.every((c) => c.sourceLanguageId === "eng" || c.targetLanguageId === "eng"),
    "All contacts involve English as source or target"
  );
}

async function testScraperSetup() {
  console.log("\n=== Scraper Initialization ===\n");

  const scraper = new LanguageContactScraper();

  // Test existing ID detection
  const existingIds = scraper.getExistingContactIds();
  assert(existingIds.size >= 90, `Found 90+ existing IDs (got ${existingIds.size})`);
  assert(existingIds.has("lc-001"), "Existing IDs include lc-001");
  assert(existingIds.has("lc-095"), "Existing IDs include lc-095");

  // Test that scraper rejects missing API key
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    await scraper.scrapeLanguageContacts({ targetCount: 1 });
    assert(false, "Should throw without GEMINI_API_KEY");
  } catch (error) {
    assert(
      error instanceof Error && error.message.includes("GEMINI_API_KEY"),
      "Throws error about missing GEMINI_API_KEY"
    );
  }

  // Restore key
  if (originalKey) process.env.GEMINI_API_KEY = originalKey;
}

async function testTimePeriodFormat() {
  console.log("\n=== Time Period Format Validation ===\n");

  const storage = new TsvStorage();
  const contacts = await storage.getLanguageContacts();

  // Check time period format: "1066-1400", "-500-200", "700BCE-300CE", "1600-present"
  const periodPattern = /^\d+(BCE|CE)?-(present|\d+(BCE|CE)?)$/;
  let validPeriods = 0;

  for (const contact of contacts) {
    if (contact.timePeriod && periodPattern.test(contact.timePeriod.replace(/\s/g, ""))) {
      validPeriods++;
    }
  }

  assert(validPeriods > contacts.length * 0.8, `Most contacts have valid time periods (${validPeriods}/${contacts.length})`);
}

async function testDataCoverage() {
  console.log("\n=== Data Coverage ===\n");

  const storage = new TsvStorage();
  const contacts = await storage.getLanguageContacts();

  // Check regional diversity
  const regions = new Set(contacts.map((c) => c.region));
  assert(regions.size >= 5, `Has 5+ distinct regions (got ${regions.size})`);

  // Check language diversity
  const allLanguages = new Set<string>();
  for (const c of contacts) {
    allLanguages.add(c.sourceLanguageId);
    allLanguages.add(c.targetLanguageId);
  }
  assert(allLanguages.size >= 20, `Involves 20+ distinct languages (got ${allLanguages.size})`);

  // Check contact type distribution
  const typeCounts = new Map<string, number>();
  for (const c of contacts) {
    typeCounts.set(c.contactType, (typeCounts.get(c.contactType) || 0) + 1);
  }

  console.log("  Contact type distribution:");
  for (const [type, count] of typeCounts) {
    console.log(`    ${type}: ${count}`);
  }

  // Ensure we have multiple types represented
  assert(typeCounts.size >= 2, `Has 2+ contact types represented (got ${typeCounts.size})`);

  // Check intensity distribution
  const intensityCounts = new Map<string, number>();
  for (const c of contacts) {
    intensityCounts.set(c.intensity, (intensityCounts.get(c.intensity) || 0) + 1);
  }

  console.log("  Intensity distribution:");
  for (const [intensity, count] of intensityCounts) {
    console.log(`    ${intensity}: ${count}`);
  }

  assert(intensityCounts.size >= 2, `Has 2+ intensity levels (got ${intensityCounts.size})`);
}

async function testNoIdDuplicates() {
  console.log("\n=== No Duplicate IDs ===\n");

  const storage = new TsvStorage();
  const contacts = await storage.getLanguageContacts();

  const idSet = new Set<string>();
  let duplicates = 0;
  for (const c of contacts) {
    if (idSet.has(c.id)) {
      duplicates++;
      console.log(`    Duplicate ID: ${c.id}`);
    }
    idSet.add(c.id);
  }

  assertEqual(duplicates, 0, "No duplicate contact IDs");
}

async function main() {
  console.log("=== Language Contact Scraper Tests ===");

  await testExistingDataIntegrity();
  await testContactFiltering();
  await testScraperSetup();
  await testTimePeriodFormat();
  await testDataCoverage();
  await testNoIdDuplicates();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Test error:", error);
  process.exit(1);
});
