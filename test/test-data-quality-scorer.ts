import fs from "node:fs";
import path from "node:path";
import { generateDataQualityReport } from "../server/services/data-quality-scorer";
import type { DataQualityReport, FileQualityScore } from "../server/services/data-quality-scorer";

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

function assertEqual(actual: unknown, expected: unknown, message: string) {
  const match = JSON.stringify(actual) === JSON.stringify(expected);
  if (match) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// --- Tests ---

function testReportStructure() {
  console.log("\nReport structure:");
  const report = generateDataQualityReport();

  assert(typeof report.timestamp === "string", "has timestamp");
  assert(typeof report.overallScore === "number", "has overallScore");
  assert(report.overallScore >= 0 && report.overallScore <= 1, "overallScore is between 0 and 1");
  assert(typeof report.fileCount === "number", "has fileCount");
  assert(report.fileCount > 0, "fileCount > 0");
  assert(typeof report.totalRows === "number", "has totalRows");
  assert(report.totalRows > 0, "totalRows > 0");
  assert(Array.isArray(report.files), "files is an array");
  assert(Array.isArray(report.referentialIntegrity), "referentialIntegrity is an array");
}

function testFileScores() {
  console.log("\nFile scores:");
  const report = generateDataQualityReport();

  for (const fileScore of report.files) {
    assert(typeof fileScore.file === "string", `${fileScore.file}: has file name`);
    assert(typeof fileScore.rowCount === "number", `${fileScore.file}: has rowCount`);
    assert(typeof fileScore.columnCount === "number", `${fileScore.file}: has columnCount`);
    assert(fileScore.completeness >= 0 && fileScore.completeness <= 1, `${fileScore.file}: completeness in [0,1]`);
    assert(fileScore.uniqueIdRate >= 0 && fileScore.uniqueIdRate <= 1, `${fileScore.file}: uniqueIdRate in [0,1]`);
    assert(fileScore.overallScore >= 0 && fileScore.overallScore <= 1, `${fileScore.file}: overallScore in [0,1]`);
    assert(Array.isArray(fileScore.fields), `${fileScore.file}: has fields array`);
    assert(Array.isArray(fileScore.duplicateIds), `${fileScore.file}: has duplicateIds array`);
    break; // Just test the first file in detail
  }
}

function testKnownFiles() {
  console.log("\nKnown files present:");
  const report = generateDataQualityReport();
  const fileNames = report.files.map((f) => f.file);

  assert(fileNames.includes("languages.tsv"), "includes languages.tsv");
  assert(fileNames.includes("families.tsv"), "includes families.tsv");
  assert(fileNames.includes("words.tsv"), "includes words.tsv");
  assert(fileNames.includes("civilizations.tsv"), "includes civilizations.tsv");
}

function testLanguagesFileQuality() {
  console.log("\nLanguages file quality:");
  const report = generateDataQualityReport();
  const langScore = report.files.find((f) => f.file === "languages.tsv");

  assert(langScore !== undefined, "languages.tsv found in report");
  if (!langScore) return;

  assert(langScore.rowCount > 100, "languages has > 100 rows");
  assert(langScore.columnCount > 10, "languages has > 10 columns");
  assert(langScore.uniqueIdRate > 0.9, `languages has > 90% unique IDs (got ${(langScore.uniqueIdRate * 100).toFixed(1)}%)`);

  const idField = langScore.fields.find((f) => f.column === "id");
  assert(idField !== undefined, "has id field");
  if (idField) {
    assert(idField.completeness === 1, "id field is 100% complete");
  }

  const nameField = langScore.fields.find((f) => f.column === "name");
  assert(nameField !== undefined, "has name field");
  if (nameField) {
    assert(nameField.completeness > 0.9, "name field is > 90% complete");
  }
}

function testFieldQuality() {
  console.log("\nField quality details:");
  const report = generateDataQualityReport();
  const familiesScore = report.files.find((f) => f.file === "families.tsv");

  assert(familiesScore !== undefined, "families.tsv found");
  if (!familiesScore) return;

  for (const field of familiesScore.fields) {
    assert(typeof field.column === "string", `field ${field.column}: has column name`);
    assert(typeof field.filledCount === "number", `field ${field.column}: has filledCount`);
    assert(typeof field.totalCount === "number", `field ${field.column}: has totalCount`);
    assert(typeof field.completeness === "number", `field ${field.column}: has completeness`);
    assert(typeof field.distinctValues === "number", `field ${field.column}: has distinctValues`);
    assert(field.filledCount <= field.totalCount, `field ${field.column}: filledCount <= totalCount`);
  }
}

function testReferentialIntegrity() {
  console.log("\nReferential integrity:");
  const report = generateDataQualityReport();

  assert(report.referentialIntegrity.length > 0, "has referential integrity checks");

  for (const check of report.referentialIntegrity) {
    assert(typeof check.sourceFile === "string", `${check.sourceFile}->${check.targetFile}: has sourceFile`);
    assert(typeof check.targetFile === "string", `${check.sourceFile}->${check.targetFile}: has targetFile`);
    assert(typeof check.totalRefs === "number", `${check.sourceFile}->${check.targetFile}: has totalRefs`);
    assert(typeof check.validRefs === "number", `${check.sourceFile}->${check.targetFile}: has validRefs`);
    assert(check.validRefs <= check.totalRefs, `${check.sourceFile}->${check.targetFile}: validRefs <= totalRefs`);
    assert(Array.isArray(check.missingRefs), `${check.sourceFile}->${check.targetFile}: has missingRefs array`);
  }

  // languages.tsv -> families.tsv should exist
  const langToFam = report.referentialIntegrity.find(
    (r) => r.sourceFile === "languages.tsv" && r.sourceColumn === "family_id",
  );
  assert(langToFam !== undefined, "languages->families FK check exists");
  if (langToFam) {
    assert(langToFam.totalRefs > 0, "languages->families has references");
    const integrity = langToFam.validRefs / langToFam.totalRefs;
    assert(integrity > 0.5, `languages->families integrity > 50% (got ${(integrity * 100).toFixed(1)}%)`);
  }
}

function testScoreConsistency() {
  console.log("\nScore consistency:");
  const report = generateDataQualityReport();

  // Overall score should be a weighted average
  assert(report.overallScore > 0, "overall score > 0");
  assert(report.overallScore <= 1, "overall score <= 1");

  // File count matches
  const tsvFiles = fs.readdirSync(path.resolve(import.meta.dirname, "../lexicons"))
    .filter((f) => f.endsWith(".tsv"));
  assertEqual(report.fileCount, tsvFiles.length, `fileCount matches actual TSV file count (${tsvFiles.length})`);
}

// --- Run ---

console.log("=== Data Quality Scorer Tests ===");
testReportStructure();
testFileScores();
testKnownFiles();
testLanguagesFileQuality();
testFieldQuality();
testReferentialIntegrity();
testScoreConsistency();

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
