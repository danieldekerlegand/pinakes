/**
 * Test script for verifying culture-profiles.tsv data and TsvStorage culture profiles loader
 * Run with: npx tsx test/test-culture-profiles.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ParsedTsv {
  header: string[];
  rows: string[][];
}

function parseTsv(text: string): ParsedTsv {
  const lines = text.trim().split("\n");
  const header = lines[0].split("\t");
  const rows = lines.slice(1).filter((l) => l.trim()).map((line) => line.split("\t"));
  return { header, rows };
}

function getIdx(header: string[], col: string): number {
  return header.indexOf(col);
}

function tryParseJson(val: string): unknown {
  if (!val || val === "null") return null;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function testCultureProfilesTsv() {
  console.log("=== Testing culture-profiles.tsv ===\n");

  const filePath = path.resolve(__dirname, "../lexicons/culture-profiles.tsv");
  assert(fs.existsSync(filePath), "culture-profiles.tsv exists");

  const text = fs.readFileSync(filePath, "utf-8");
  const { header, rows } = parseTsv(text);

  // Check required columns
  const requiredColumns = [
    "id", "name", "alternate_names", "civilization_id",
    "archaeological_culture_id", "time_period_start", "time_period_end",
    "region", "summary_description", "social_organization", "subsistence_type",
    "urbanism_level", "population_estimate", "technology_level",
    "associated_language_ids", "associated_religion_ids",
    "associated_writing_system_ids", "associated_art_tradition_ids",
    "associated_music_tradition_ids", "associated_cuisine_id",
    "associated_architectural_style_ids", "associated_literary_tradition_ids",
    "notable_settlements", "image_gallery_tags", "sources",
  ];
  for (const col of requiredColumns) {
    assert(header.includes(col), `has column '${col}'`);
  }

  // Check row count
  assert(rows.length >= 100, `has 100+ culture profiles (found ${rows.length})`);

  // Check all rows have correct number of columns
  const badRows = rows.filter((r) => r.length !== header.length);
  assert(badRows.length === 0, `all rows have ${header.length} columns (${badRows.length} bad rows)`);

  // Check unique IDs
  const idIdx = getIdx(header, "id");
  const ids = rows.map((r) => r[idIdx]);
  const uniqueIds = new Set(ids);
  assert(uniqueIds.size === rows.length, `all IDs are unique (${uniqueIds.size}/${rows.length})`);

  // Check no empty IDs
  const emptyIds = ids.filter((id) => !id || id.trim() === "");
  assert(emptyIds.length === 0, `no empty IDs (found ${emptyIds.length})`);

  // Check no empty names
  const nameIdx = getIdx(header, "name");
  const emptyNames = rows.filter((r) => !r[nameIdx] || r[nameIdx].trim() === "");
  assert(emptyNames.length === 0, `no empty names (found ${emptyNames.length})`);

  // Check social organization values
  const socialIdx = getIdx(header, "social_organization");
  const validSocialOrgs = new Set(["egalitarian", "chiefdom", "state", "empire"]);
  const invalidSocial = rows.filter((r) => r[socialIdx] && !validSocialOrgs.has(r[socialIdx]));
  assert(invalidSocial.length === 0, `valid social_organization values (${invalidSocial.length} invalid)`);

  // Check subsistence type values
  const subsIdx = getIdx(header, "subsistence_type");
  const validSubsistence = new Set(["hunter-gatherer", "pastoral", "agricultural", "maritime", "mixed"]);
  const invalidSubs = rows.filter((r) => r[subsIdx] && !validSubsistence.has(r[subsIdx]));
  assert(invalidSubs.length === 0, `valid subsistence_type values (${invalidSubs.length} invalid)`);

  // Check urbanism level values
  const urbanIdx = getIdx(header, "urbanism_level");
  const validUrbanism = new Set(["nomadic", "village", "town", "city-state", "metropolis"]);
  const invalidUrban = rows.filter((r) => r[urbanIdx] && !validUrbanism.has(r[urbanIdx]));
  assert(invalidUrban.length === 0, `valid urbanism_level values (${invalidUrban.length} invalid)`);

  // Check technology level values
  const techIdx = getIdx(header, "technology_level");
  const validTech = new Set(["stone", "copper", "bronze", "iron", "steel", "industrial"]);
  const invalidTech = rows.filter((r) => r[techIdx] && !validTech.has(r[techIdx]));
  assert(invalidTech.length === 0, `valid technology_level values (${invalidTech.length} invalid)`);

  // Check JSON array fields parse correctly
  const altIdx = getIdx(header, "alternate_names");
  const langIdx = getIdx(header, "associated_language_ids");
  const relIdx = getIdx(header, "associated_religion_ids");
  const settlementsIdx = getIdx(header, "notable_settlements");
  const srcIdx = getIdx(header, "sources");
  const tagsIdx = getIdx(header, "image_gallery_tags");

  let jsonErrors = 0;
  for (const row of rows) {
    for (const idx of [altIdx, langIdx, relIdx, settlementsIdx, srcIdx, tagsIdx]) {
      if (idx >= 0 && row[idx] && row[idx].trim() !== "") {
        const parsed = tryParseJson(row[idx]);
        if (parsed === null && row[idx] !== "null" && row[idx] !== "") {
          jsonErrors++;
          console.log(`    JSON parse error in row ${row[idIdx]}, column index ${idx}: ${row[idx].substring(0, 60)}`);
        }
      }
    }
  }
  assert(jsonErrors === 0, `all JSON array fields parse correctly (${jsonErrors} errors)`);

  // Check regions are not empty
  const regionIdx = getIdx(header, "region");
  const emptyRegions = rows.filter((r) => !r[regionIdx] || r[regionIdx].trim() === "");
  assert(emptyRegions.length === 0, `all profiles have a region (${emptyRegions.length} empty)`);

  // Check descriptions are not empty
  const descIdx = getIdx(header, "summary_description");
  const emptyDescs = rows.filter((r) => !r[descIdx] || r[descIdx].trim() === "");
  assert(emptyDescs.length === 0, `all profiles have a description (${emptyDescs.length} empty)`);

  // Check time periods are valid numbers where present
  const startIdx = getIdx(header, "time_period_start");
  const endIdx = getIdx(header, "time_period_end");
  let invalidDates = 0;
  for (const row of rows) {
    if (row[startIdx] && row[startIdx] !== "null") {
      const v = parseInt(row[startIdx], 10);
      if (isNaN(v)) invalidDates++;
    }
    if (row[endIdx] && row[endIdx] !== "null") {
      const v = parseInt(row[endIdx], 10);
      if (isNaN(v)) invalidDates++;
    }
  }
  assert(invalidDates === 0, `all time periods are valid numbers (${invalidDates} invalid)`);

  // Check time_period_start <= time_period_end where both exist
  let invalidRanges = 0;
  for (const row of rows) {
    const start = row[startIdx] && row[startIdx] !== "null" ? parseInt(row[startIdx], 10) : null;
    const end = row[endIdx] && row[endIdx] !== "null" ? parseInt(row[endIdx], 10) : null;
    if (start !== null && end !== null && !isNaN(start) && !isNaN(end) && start > end) {
      invalidRanges++;
      console.log(`    Invalid range: ${row[idIdx]} start=${start} end=${end}`);
    }
  }
  assert(invalidRanges === 0, `all time ranges are valid (start <= end) (${invalidRanges} invalid)`);

  // Check region diversity (at least 5 distinct regions)
  const regions = new Set(rows.map((r) => r[regionIdx]).filter(Boolean));
  assert(regions.size >= 5, `has geographic diversity (${regions.size} distinct regions)`);
  console.log(`    Regions: ${[...regions].join(", ")}`);

  // Check social organization diversity
  const socialOrgs = new Set(rows.map((r) => r[socialIdx]).filter(Boolean));
  assert(socialOrgs.size >= 3, `has social organization diversity (${socialOrgs.size} types)`);

  // Check subsistence diversity
  const subsTypes = new Set(rows.map((r) => r[subsIdx]).filter(Boolean));
  assert(subsTypes.size >= 3, `has subsistence type diversity (${subsTypes.size} types)`);
}

async function testTsvStorageLoader() {
  console.log("\n=== Testing TsvStorage Culture Profiles Loader ===\n");

  // Dynamically import TsvStorage
  const { TsvStorage } = await import("../server/tsv-storage");
  const storage = new TsvStorage();

  // Test basic loading
  const allProfiles = await storage.getCultureProfiles();
  assert(allProfiles.length >= 100, `loaded 100+ culture profiles (found ${allProfiles.length})`);

  // Test structure of a loaded profile
  const firstProfile = allProfiles[0];
  assert(typeof firstProfile.id === "string" && firstProfile.id.length > 0, "profile has non-empty id");
  assert(typeof firstProfile.name === "string" && firstProfile.name.length > 0, "profile has non-empty name");
  assert(Array.isArray(firstProfile.alternateNames), "alternateNames is an array");
  assert(typeof firstProfile.region === "string", "region is a string");
  assert(typeof firstProfile.socialOrganization === "string", "socialOrganization is a string");
  assert(typeof firstProfile.subsistenceType === "string", "subsistenceType is a string");
  assert(Array.isArray(firstProfile.associatedLanguageIds), "associatedLanguageIds is an array");
  assert(Array.isArray(firstProfile.sources), "sources is an array");
  assert(Array.isArray(firstProfile.notableSettlements), "notableSettlements is an array");

  // Test filtering by region
  const mesopotamia = await storage.getCultureProfiles({ region: "Mesopotamia" });
  assert(mesopotamia.length >= 2, `found Mesopotamia profiles (${mesopotamia.length})`);
  assert(mesopotamia.every((p) => p.region.toLowerCase().includes("mesopotamia")), "all results match region filter");

  // Test filtering by subsistence type
  const pastoral = await storage.getCultureProfiles({ subsistenceType: "pastoral" });
  assert(pastoral.length >= 1, `found pastoral profiles (${pastoral.length})`);
  assert(pastoral.every((p) => p.subsistenceType === "pastoral"), "all results match subsistence filter");

  // Test filtering by social organization
  const empires = await storage.getCultureProfiles({ socialOrganization: "empire" });
  assert(empires.length >= 5, `found empire profiles (${empires.length})`);
  assert(empires.every((p) => p.socialOrganization === "empire"), "all results match social org filter");

  // Test filtering by time range
  const ancient = await storage.getCultureProfiles({ timeEnd: -500 });
  assert(ancient.length >= 5, `found ancient profiles (timeEnd <= -500) (${ancient.length})`);

  // Test getById
  const sumerian = await storage.getCultureProfileById("cp-sumerian");
  assert(sumerian !== null, "found Sumerian profile by ID");
  assert(sumerian!.name === "Sumerian", "Sumerian profile has correct name");
  assert(sumerian!.civilizationId === "sumerian", "Sumerian profile has correct civilization_id");

  // Test getById with non-existent ID
  const missing = await storage.getCultureProfileById("nonexistent-id");
  assert(missing === null, "returns null for non-existent ID");

  // Test getByCivilization
  const romanProfiles = await storage.getCultureProfilesByCivilization("roman-empire");
  assert(romanProfiles.length >= 1, `found Roman profiles (${romanProfiles.length})`);
  assert(romanProfiles.every((p) => p.civilizationId === "roman-empire"), "all match civilization");

  // Test combined filters
  const ironEmpires = await storage.getCultureProfiles({
    socialOrganization: "empire",
    technologyLevel: "iron",
  });
  assert(ironEmpires.length >= 3, `found iron-age empires (${ironEmpires.length})`);
  assert(ironEmpires.every((p) => p.socialOrganization === "empire" && p.technologyLevel === "iron"),
    "all match combined filters");

  // Test socio-cultural resolution
  const socioCultural = await storage.getCultureProfileSocioCultural("cp-sumerian");
  assert(socioCultural !== null, "got socio-cultural data for Sumerian");
  assert(socioCultural!.profile.id === "cp-sumerian", "socio-cultural contains correct profile");
  assert(Array.isArray(socioCultural!.languages), "socio-cultural has languages array");
  assert(Array.isArray(socioCultural!.religions), "socio-cultural has religions array");
  assert(Array.isArray(socioCultural!.writingSystems), "socio-cultural has writingSystems array");
  assert(Array.isArray(socioCultural!.settlements), "socio-cultural has settlements array");

  // Test socio-cultural with non-existent ID
  const missingSocio = await storage.getCultureProfileSocioCultural("nonexistent-id");
  assert(missingSocio === null, "returns null for non-existent socio-cultural ID");
}

async function main() {
  try {
    await testCultureProfilesTsv();
    await testTsvStorageLoader();
  } catch (error) {
    console.error("Test error:", error);
    failed++;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
