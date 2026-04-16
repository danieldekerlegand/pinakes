/**
 * Test script for culture profiles data layer and CultureProfilePanel
 * Run with: npx tsx test/test-culture-profiles.ts
 */

import { TsvStorage } from "../server/tsv-storage";

async function testCultureProfiles() {
  console.log("=== Culture Profiles Tests ===\n");

  const storage = new TsvStorage();
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

  // Test 1: Load all culture profiles
  console.log("Test 1: Load all culture profiles");
  const allProfiles = await storage.getCultureProfiles();
  assert(allProfiles.length > 0, `Loaded ${allProfiles.length} profiles (expected > 0)`);
  assert(allProfiles.length >= 10, `Has at least 10 profiles (got ${allProfiles.length})`);
  console.log();

  // Test 2: Verify profile structure
  console.log("Test 2: Verify Roman culture profile structure");
  const roman = allProfiles.find((p) => p.id === "roman-culture");
  assert(roman !== undefined, "Found Roman culture profile");
  if (roman) {
    assert(roman.name === "Roman", `Name is 'Roman' (got '${roman.name}')`);
    assert(roman.timePeriodStart === -753, `Time period start is -753 (got ${roman.timePeriodStart})`);
    assert(roman.timePeriodEnd === 476, `Time period end is 476 (got ${roman.timePeriodEnd})`);
    assert(roman.region === "Mediterranean", `Region is 'Mediterranean' (got '${roman.region}')`);
    assert(roman.socialOrganization === "empire", `Social org is 'empire' (got '${roman.socialOrganization}')`);
    assert(roman.subsistenceType === "agricultural", `Subsistence is 'agricultural' (got '${roman.subsistenceType}')`);
    assert(roman.urbanismLevel === "metropolis", `Urbanism is 'metropolis' (got '${roman.urbanismLevel}')`);
    assert(roman.populationEstimate === 60000000, `Population is 60M (got ${roman.populationEstimate})`);
    assert(roman.technologyLevel === "iron", `Tech level is 'iron' (got '${roman.technologyLevel}')`);
    assert(roman.associatedLanguageIds.includes("latin"), `Has 'latin' language (got ${JSON.stringify(roman.associatedLanguageIds)})`);
    assert(roman.notableSettlements.length > 0, `Has notable settlements (got ${roman.notableSettlements.length})`);
    assert(roman.sources.length > 0, `Has sources (got ${roman.sources.length})`);
    assert(roman.summaryDescription.length > 50, `Has description (${roman.summaryDescription.length} chars)`);
  }
  console.log();

  // Test 3: Verify all required fields exist
  console.log("Test 3: Verify all profiles have required fields");
  for (const profile of allProfiles) {
    assert(!!profile.id, `Profile '${profile.id || "unknown"}' has id`);
    assert(!!profile.name, `Profile '${profile.id}' has name`);
    assert(!!profile.region, `Profile '${profile.id}' has region`);
    assert(typeof profile.timePeriodStart === "number", `Profile '${profile.id}' has numeric start`);
    assert(typeof profile.timePeriodEnd === "number", `Profile '${profile.id}' has numeric end`);
    assert(profile.timePeriodStart < profile.timePeriodEnd, `Profile '${profile.id}' start < end`);
    assert(!!profile.summaryDescription, `Profile '${profile.id}' has description`);
    assert(!!profile.socialOrganization, `Profile '${profile.id}' has social organization`);
    assert(!!profile.subsistenceType, `Profile '${profile.id}' has subsistence type`);
    assert(!!profile.urbanismLevel, `Profile '${profile.id}' has urbanism level`);
    assert(!!profile.technologyLevel, `Profile '${profile.id}' has technology level`);
    assert(Array.isArray(profile.associatedLanguageIds), `Profile '${profile.id}' has language IDs array`);
    assert(Array.isArray(profile.notableSettlements), `Profile '${profile.id}' has settlements array`);
    assert(Array.isArray(profile.sources), `Profile '${profile.id}' has sources array`);
  }
  console.log();

  // Test 4: Get profile by ID
  console.log("Test 4: Get profile by ID");
  const greek = await storage.getCultureProfileById("greek-culture");
  assert(greek !== null, "Found Greek culture by ID");
  if (greek) {
    assert(greek.name === "Ancient Greek", `Name is 'Ancient Greek' (got '${greek.name}')`);
    assert(greek.urbanismLevel === "city-state", `Urbanism is 'city-state' (got '${greek.urbanismLevel}')`);
  }
  const notFound = await storage.getCultureProfileById("nonexistent");
  assert(notFound === null, "Returns null for nonexistent ID");
  console.log();

  // Test 5: Region filtering
  console.log("Test 5: Region filtering");
  const mesoamerican = await storage.getCultureProfiles({ region: "Mesoamerica" });
  assert(mesoamerican.length >= 2, `Found ${mesoamerican.length} Mesoamerican profiles (expected >= 2)`);
  assert(mesoamerican.every((p) => p.region.toLowerCase().includes("mesoamerica")),
    "All results match Mesoamerica region");
  console.log();

  // Test 6: Time range filtering
  console.log("Test 6: Time range filtering");
  const ancient = await storage.getCultureProfiles({ timeStart: -5000, timeEnd: -100 });
  assert(ancient.length > 0, `Found ${ancient.length} ancient profiles`);
  const modern = await storage.getCultureProfiles({ timeStart: 1500, timeEnd: 2000 });
  assert(modern.length > 0, `Found ${modern.length} post-1500 profiles`);
  console.log();

  // Test 7: Subsistence type filtering
  console.log("Test 7: Subsistence type filtering");
  const maritime = await storage.getCultureProfiles({ subsistenceType: "maritime" });
  assert(maritime.length > 0, `Found ${maritime.length} maritime profiles`);
  assert(maritime.every((p) => p.subsistenceType === "maritime"),
    "All results have maritime subsistence");
  console.log();

  // Test 8: Urbanism level filtering
  console.log("Test 8: Urbanism level filtering");
  const metropolisProfiles = await storage.getCultureProfiles({ urbanismLevel: "metropolis" });
  assert(metropolisProfiles.length > 0, `Found ${metropolisProfiles.length} metropolis profiles`);
  assert(metropolisProfiles.every((p) => p.urbanismLevel === "metropolis"),
    "All results have metropolis urbanism");
  console.log();

  // Test 9: Verify enum values are valid
  console.log("Test 9: Verify enum values");
  const validSocialOrgs = ["egalitarian", "chiefdom", "state", "empire"];
  const validSubsistence = ["hunter-gatherer", "pastoral", "agricultural", "maritime", "mixed"];
  const validUrbanism = ["nomadic", "village", "town", "city-state", "metropolis"];
  const validTech = ["stone", "copper", "bronze", "iron", "steel", "industrial"];

  for (const profile of allProfiles) {
    assert(validSocialOrgs.includes(profile.socialOrganization),
      `Profile '${profile.id}' social org '${profile.socialOrganization}' is valid`);
    assert(validSubsistence.includes(profile.subsistenceType),
      `Profile '${profile.id}' subsistence '${profile.subsistenceType}' is valid`);
    assert(validUrbanism.includes(profile.urbanismLevel),
      `Profile '${profile.id}' urbanism '${profile.urbanismLevel}' is valid`);
    assert(validTech.includes(profile.technologyLevel),
      `Profile '${profile.id}' tech '${profile.technologyLevel}' is valid`);
  }
  console.log();

  // Test 10: Alternate names parsing
  console.log("Test 10: Alternate names parsing");
  const aztec = allProfiles.find((p) => p.id === "aztec-culture");
  assert(aztec !== undefined, "Found Aztec culture");
  if (aztec) {
    assert(aztec.alternateNames.length >= 2, `Aztec has ${aztec.alternateNames.length} alternate names (expected >= 2)`);
    assert(aztec.alternateNames.includes("Mexica"), `Aztec has 'Mexica' as alternate name`);
  }
  console.log();

  // Summary
  console.log("=== Results ===");
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

testCultureProfiles().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
