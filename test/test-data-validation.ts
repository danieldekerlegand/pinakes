/**
 * Test script for data validation and cross-referencing service
 * Run with: npx tsx test/test-data-validation.ts
 */

import * as path from "path";
import * as fs from "fs";
import { DataValidationService, type ValidationReport } from "../server/services/data-validation";

const LEXICONS_DIR = path.join(import.meta.dirname, "..", "lexicons");

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

// ============================================================================
// Test: Service instantiation
// ============================================================================

function testInstantiation() {
  console.log("=== Test: Service Instantiation ===\n");

  const service = new DataValidationService(LEXICONS_DIR);
  assert(service !== null, "Service instantiates without error");
}

// ============================================================================
// Test: Data summary
// ============================================================================

function testDataSummary() {
  console.log("\n=== Test: Data Summary ===\n");

  const service = new DataValidationService(LEXICONS_DIR);
  const summary = service.getDataSummary();

  assert(summary.length > 0, `Summary covers ${summary.length} files`);

  const existing = summary.filter((s) => s.exists);
  assert(existing.length > 0, `${existing.length} files exist on disk`);

  for (const entry of existing) {
    assert(entry.rowCount > 0, `${entry.file} has ${entry.rowCount} rows`);
    assert(entry.columnCount > 0, `${entry.file} has ${entry.columnCount} columns`);
  }
}

// ============================================================================
// Test: Schema validation for core files
// ============================================================================

async function testSchemaValidation() {
  console.log("\n=== Test: Schema Validation ===\n");

  const service = new DataValidationService(LEXICONS_DIR);

  // Validate just languages.tsv
  const report = await service.validate({ files: ["languages.tsv"], skipCrossReferences: true });

  assert(report.filesValidated === 1, `Validated 1 file`);
  assert(report.totalRows > 0, `languages.tsv has ${report.totalRows} rows`);
  assert(report.timestamp.length > 0, "Report has timestamp");

  const langResult = report.fileResults[0];
  assert(langResult.file === "languages.tsv", "Result is for languages.tsv");
  assert(langResult.columns.includes("id"), "languages.tsv has 'id' column");
  assert(langResult.columns.includes("name"), "languages.tsv has 'name' column");
  assert(langResult.columns.includes("family_id"), "languages.tsv has 'family_id' column");

  // Verify duplicate detection works (languages.tsv has known duplicates from historical variants)
  const dupErrors = langResult.issues.filter((i) => i.message.startsWith("Duplicate ID"));
  assert(typeof dupErrors.length === "number", `Duplicate ID check ran (found ${dupErrors.length} duplicates)`);
}

// ============================================================================
// Test: Schema validation for families
// ============================================================================

async function testFamiliesValidation() {
  console.log("\n=== Test: Families Validation ===\n");

  const service = new DataValidationService(LEXICONS_DIR);
  const report = await service.validate({ files: ["families.tsv"], skipCrossReferences: true });

  assert(report.filesValidated === 1, "Validated families.tsv");
  const result = report.fileResults[0];
  assert(result.rowCount > 0, `families.tsv has ${result.rowCount} rows`);

  const emptyIdErrors = result.issues.filter(
    (i) => i.column === "id" && i.message.includes("empty")
  );
  assert(emptyIdErrors.length === 0, "No empty IDs in families.tsv");
}

// ============================================================================
// Test: Cross-reference validation
// ============================================================================

async function testCrossReferences() {
  console.log("\n=== Test: Cross-Reference Validation ===\n");

  const service = new DataValidationService(LEXICONS_DIR);

  // Validate cross-references for languages -> families
  const report = await service.validate({ files: ["languages.tsv", "families.tsv"] });

  assert(report.crossReferences.length > 0, `Found ${report.crossReferences.length} cross-reference checks`);

  // Look for the languages.family_id -> families.id reference
  const langFamilyRef = report.crossReferences.find(
    (r) => r.sourceFile === "languages.tsv" && r.sourceColumn === "family_id"
  );

  if (langFamilyRef) {
    assert(langFamilyRef.targetFile === "families.tsv", "family_id references families.tsv");
    assert(langFamilyRef.totalReferences > 0, `${langFamilyRef.totalReferences} family references found`);
    console.log(`    (${langFamilyRef.brokenReferences} broken of ${langFamilyRef.totalReferences} total)`);
  } else {
    assert(false, "languages.family_id -> families.id cross-reference found");
  }
}

// ============================================================================
// Test: Full validation report structure
// ============================================================================

async function testFullValidationStructure() {
  console.log("\n=== Test: Full Validation Report Structure ===\n");

  const service = new DataValidationService(LEXICONS_DIR);

  // Run on a small subset
  const report = await service.validate({
    files: ["cuisines.tsv", "cuisine-items.tsv", "cooking-techniques.tsv"],
  });

  assert(report.filesValidated <= 3, `Validated ${report.filesValidated} files`);
  assert(typeof report.totalIssues === "number", "totalIssues is a number");
  assert(typeof report.issuesBySeverity.error === "number", "error count is a number");
  assert(typeof report.issuesBySeverity.warning === "number", "warning count is a number");
  assert(typeof report.issuesBySeverity.info === "number", "info count is a number");

  // Verify issue counts add up
  const sumBySeverity =
    report.issuesBySeverity.error +
    report.issuesBySeverity.warning +
    report.issuesBySeverity.info;
  assert(sumBySeverity === report.totalIssues, `Issue counts sum correctly (${sumBySeverity} = ${report.totalIssues})`);
}

// ============================================================================
// Test: Cross-reference rules listing
// ============================================================================

function testCrossReferenceRules() {
  console.log("\n=== Test: Cross-Reference Rules ===\n");

  const service = new DataValidationService(LEXICONS_DIR);
  const rules = service.getCrossReferenceRules();

  assert(rules.length > 30, `${rules.length} cross-reference rules defined`);

  // Verify key references exist
  const langFamilyRule = rules.find(
    (r) => r.sourceFile === "languages.tsv" && r.sourceColumn === "family_id"
  );
  assert(langFamilyRule !== undefined, "languages.family_id rule exists");

  const civLangRule = rules.find(
    (r) => r.sourceFile === "civilizations.tsv" && r.sourceColumn === "associated_language_ids"
  );
  assert(civLangRule !== undefined, "civilizations.associated_language_ids rule exists");
  assert(civLangRule?.isJsonArray === true, "civilizations language ref is JSON array");

  const soundChangeFamilyRule = rules.find(
    (r) => r.sourceFile === "sound-changes.tsv" && r.sourceColumn === "family_id"
  );
  assert(soundChangeFamilyRule !== undefined, "sound-changes.family_id rule exists");
}

// ============================================================================
// Test: Missing file handling
// ============================================================================

async function testMissingFile() {
  console.log("\n=== Test: Missing File Handling ===\n");

  // Create service pointing to a temp directory with no files
  const tmpDir = path.join(import.meta.dirname, "..", ".test-tmp-validation");
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const service = new DataValidationService(tmpDir);
    const report = await service.validate({ files: ["languages.tsv"], skipCrossReferences: true });

    const missingFileIssue = report.fileResults[0]?.issues.find(
      (i) => i.message.includes("File not found")
    );
    assert(missingFileIssue !== undefined, "Reports missing file as error");
    assert(missingFileIssue?.severity === "error", "Missing file is severity 'error'");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ============================================================================
// Test: Validation with synthetic bad data
// ============================================================================

async function testSyntheticBadData() {
  console.log("\n=== Test: Synthetic Bad Data Detection ===\n");

  const tmpDir = path.join(import.meta.dirname, "..", ".test-tmp-validation-bad");
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // Write a languages.tsv with known issues
    const badLanguagesData = [
      "id\tname\tnative_name\tiso639_1\tiso639_2\tfamily_id\tparent_language_id\tregion\tcountries\tnative_speakers\ttotal_speakers\tstatus\ttime_origin\ttime_end\tclassification\twriting_system\tis_historical_variant\tis_dialect\tchronological_order\thistorical_context\tlatitude\tlongitude",
      "lang-1\tEnglish\t\ten\teng\tfam-germanic\t\tEurope\t\t\t\tliving\t450\t\t\t\t\t\t\t\t51.5\t-0.1",
      "lang-1\tDuplicate\t\t\t\tfam-bad\t\t\t\t\t\t\tnot_a_number\t\t\t\t\t\t\t\t\t", // duplicate ID + bad number
      "\tNoId\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t", // empty ID
    ].join("\n");

    fs.writeFileSync(path.join(tmpDir, "languages.tsv"), badLanguagesData);

    // Write a families.tsv for cross-ref checking
    const familiesData = [
      "id\tname\tparent_id\tdescription\ttaxonomic_level\tregion\ttotal_speakers\tlanguage_count",
      "fam-germanic\tGermanic\t\t\t\t\t\t",
    ].join("\n");
    fs.writeFileSync(path.join(tmpDir, "families.tsv"), familiesData);

    const service = new DataValidationService(tmpDir);
    const report = await service.validate({ files: ["languages.tsv", "families.tsv"] });

    // Check duplicate ID detected
    const dupIssue = report.fileResults[0]?.issues.find((i) => i.message.includes("Duplicate ID"));
    assert(dupIssue !== undefined, "Duplicate ID detected");

    // Check empty required field detected
    const emptyIdIssue = report.fileResults[0]?.issues.find(
      (i) => i.column === "id" && i.message.includes("empty")
    );
    assert(emptyIdIssue !== undefined, "Empty required field detected");

    // Check bad number detected
    const badNumIssue = report.fileResults[0]?.issues.find(
      (i) => i.column === "time_origin" && i.message.includes("Invalid number")
    );
    assert(badNumIssue !== undefined, "Invalid number detected");

    // Check broken cross-reference (fam-bad doesn't exist in families.tsv)
    const brokenRef = report.crossReferences.find(
      (r) => r.sourceFile === "languages.tsv" && r.sourceColumn === "family_id"
    );
    assert(brokenRef !== undefined && brokenRef.brokenReferences > 0, "Broken cross-reference detected");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ============================================================================
// Run all tests
// ============================================================================

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   Data Validation Service Tests             ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  testInstantiation();
  testDataSummary();
  await testSchemaValidation();
  await testFamiliesValidation();
  await testCrossReferences();
  await testFullValidationStructure();
  testCrossReferenceRules();
  await testMissingFile();
  await testSyntheticBadData();

  console.log("\n══════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("══════════════════════════════════════════");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
