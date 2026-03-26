/**
 * Test script for ethnographic data scraper (kinship systems & social organization)
 * Run with: npx tsx test/test-ethnographic-scraper.ts
 */

import { TsvStorage } from "../server/tsv-storage";
import { EthnographicScraper } from "../server/services/ethnographic-scraper";

async function testEthnographicData() {
  console.log("=== Ethnographic Data Scraper Tests ===\n");

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

  // ========================
  // KINSHIP SYSTEMS TESTS
  // ========================

  console.log("Test 1: Load all kinship systems");
  const allKinship = await storage.getKinshipSystems();
  assert(allKinship.length > 0, `Loaded ${allKinship.length} kinship systems (expected > 0)`);
  assert(allKinship.length >= 10, `Has at least 10 kinship systems (got ${allKinship.length})`);
  console.log();

  console.log("Test 2: Verify kinship system structure");
  const firstKinship = allKinship[0];
  assert(firstKinship.id !== undefined && firstKinship.id !== "", "Has non-empty id");
  assert(firstKinship.systemType !== undefined && firstKinship.systemType !== "", "Has non-empty systemType");
  assert(Array.isArray(firstKinship.languageIds), "languageIds is an array");
  assert(typeof firstKinship.terminology === "object", "terminology is an object");
  assert(firstKinship.descentRule !== undefined, "Has descentRule");
  assert(firstKinship.residenceRule !== undefined, "Has residenceRule");
  console.log();

  console.log("Test 3: Filter kinship by system type");
  const eskimoSystems = await storage.getKinshipSystems({ systemType: "Eskimo" });
  assert(eskimoSystems.length > 0, `Found ${eskimoSystems.length} Eskimo-type systems`);
  assert(eskimoSystems.every((s) => s.systemType === "Eskimo"), "All filtered results are Eskimo type");
  console.log();

  console.log("Test 4: Filter kinship by descent rule");
  const patrilineal = await storage.getKinshipSystems({ descentRule: "patrilineal" });
  assert(patrilineal.length > 0, `Found ${patrilineal.length} patrilineal systems`);
  assert(patrilineal.every((s) => s.descentRule === "patrilineal"), "All filtered results are patrilineal");
  console.log();

  console.log("Test 5: Get kinship system by ID");
  const kin001 = await storage.getKinshipSystemById("kin-001");
  assert(kin001 !== null, "Found kinship system kin-001");
  if (kin001) {
    assert(kin001.systemType === "Eskimo", `kin-001 is Eskimo type (got ${kin001.systemType})`);
  }
  console.log();

  console.log("Test 6: Non-existent kinship system returns null");
  const nonExistent = await storage.getKinshipSystemById("kin-nonexistent");
  assert(nonExistent === null, "Returns null for non-existent ID");
  console.log();

  console.log("Test 7: Kinship terminology contains expected fields");
  const sudanese = allKinship.find((s) => s.systemType === "Sudanese");
  assert(sudanese !== undefined, "Found a Sudanese-type kinship system");
  if (sudanese) {
    const terms = sudanese.terminology;
    assert("mother" in terms || "father" in terms, "Terminology has parent terms");
  }
  console.log();

  // Verify system types are valid
  console.log("Test 8: All system types are valid anthropological types");
  const validTypes = new Set(["Eskimo", "Hawaiian", "Sudanese", "Omaha", "Crow", "Iroquois", "Dravidian"]);
  const invalidTypes = allKinship.filter((s) => !validTypes.has(s.systemType));
  assert(invalidTypes.length === 0, `All systems have valid types (${invalidTypes.length} invalid)`);
  if (invalidTypes.length > 0) {
    console.log(`    Invalid types found: ${invalidTypes.map((s) => `${s.id}: ${s.systemType}`).join(", ")}`);
  }
  console.log();

  // ========================
  // SOCIAL ORGANIZATION TESTS
  // ========================

  console.log("Test 9: Load all social organization entries");
  const allOrgs = await storage.getSocialOrganization();
  assert(allOrgs.length > 0, `Loaded ${allOrgs.length} social organization entries (expected > 0)`);
  console.log();

  console.log("Test 10: Verify social organization structure");
  const firstOrg = allOrgs[0];
  assert(firstOrg.id !== undefined && firstOrg.id !== "", "Has non-empty id");
  assert(firstOrg.name !== undefined && firstOrg.name !== "", "Has non-empty name");
  assert(firstOrg.region !== undefined && firstOrg.region !== "", "Has non-empty region");
  assert(firstOrg.politicalStructure !== undefined, "Has politicalStructure");
  assert(firstOrg.subsistencePattern !== undefined, "Has subsistencePattern");
  assert(firstOrg.marriageSystem !== undefined, "Has marriageSystem");
  assert(firstOrg.descentSystem !== undefined, "Has descentSystem");
  assert(firstOrg.residencePattern !== undefined, "Has residencePattern");
  console.log();

  console.log("Test 11: Filter social organization by descent system");
  const matrilinealOrgs = await storage.getSocialOrganization({ descentSystem: "matrilineal" });
  assert(matrilinealOrgs.length > 0, `Found ${matrilinealOrgs.length} matrilineal societies`);
  assert(matrilinealOrgs.every((o) => o.descentSystem === "matrilineal"), "All results are matrilineal");
  console.log();

  console.log("Test 12: Filter social organization by region");
  const africaOrgs = await storage.getSocialOrganization({ region: "Africa" });
  assert(africaOrgs.length > 0, `Found ${africaOrgs.length} African societies`);
  assert(africaOrgs.every((o) => o.region.toLowerCase().includes("africa")), "All results are from Africa");
  console.log();

  console.log("Test 13: Filter social organization by subsistence pattern");
  const pastoralOrgs = await storage.getSocialOrganization({ subsistencePattern: "pastoral" });
  assert(pastoralOrgs.length > 0, `Found ${pastoralOrgs.length} pastoral societies`);
  console.log();

  console.log("Test 14: Get social organization by ID");
  const nuer = await storage.getSocialOrganizationById("soc-nuer");
  assert(nuer !== null, "Found Nuer social organization");
  if (nuer) {
    assert(nuer.name === "Nuer", `Name is 'Nuer' (got '${nuer.name}')`);
    assert(nuer.politicalStructure === "segmentary lineage", `Political structure is segmentary lineage`);
    assert(nuer.descentSystem === "patrilineal", `Descent is patrilineal`);
  }
  console.log();

  console.log("Test 15: Non-existent social organization returns null");
  const noOrg = await storage.getSocialOrganizationById("soc-nonexistent");
  assert(noOrg === null, "Returns null for non-existent ID");
  console.log();

  // ========================
  // SCRAPER UNIT TESTS
  // ========================

  console.log("Test 16: EthnographicScraper class instantiates");
  const scraper = new EthnographicScraper();
  assert(scraper !== null, "Scraper instantiated successfully");
  console.log();

  console.log("Test 17: Scraper rejects without API key");
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await scraper.scrapeKinshipSystems();
    assert(false, "Should have thrown error without API key");
  } catch (error: any) {
    assert(error.message.includes("GEMINI_API_KEY"), `Throws correct error: ${error.message}`);
  }
  if (originalKey) process.env.GEMINI_API_KEY = originalKey;
  console.log();

  console.log("Test 18: Scraper rejects social org without API key");
  delete process.env.GEMINI_API_KEY;
  try {
    await scraper.scrapeSocialOrganization();
    assert(false, "Should have thrown error without API key");
  } catch (error: any) {
    assert(error.message.includes("GEMINI_API_KEY"), `Throws correct error: ${error.message}`);
  }
  if (originalKey) process.env.GEMINI_API_KEY = originalKey;
  console.log();

  // ========================
  // CROSS-DOMAIN TESTS
  // ========================

  console.log("Test 19: Kinship and social org data are cross-referenceable");
  const iroqKinship = allKinship.find((s) => s.systemType === "Iroquois");
  const iroqOrg = allOrgs.find((o) => o.kinshipTerminology === "Iroquois");
  assert(iroqKinship !== undefined, "Found Iroquois kinship system");
  assert(iroqOrg !== undefined, "Found society with Iroquois kinship terminology");
  console.log();

  console.log("Test 20: Filter social organization by political structure");
  const chiefdoms = await storage.getSocialOrganization({ politicalStructure: "chiefdom" });
  assert(chiefdoms.length > 0, `Found ${chiefdoms.length} chiefdom societies`);
  console.log();

  // Summary
  console.log("=================================");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("=================================");

  if (failed > 0) {
    process.exit(1);
  }
}

testEthnographicData().catch((error) => {
  console.error("Test suite error:", error);
  process.exit(1);
});
