import fs from "node:fs";
import path from "node:path";
import {
  exportDataset,
  getDatasetProfiles,
  getDatasetProfile,
  validateExportOptions,
  type ExportFormat,
} from "../server/services/export-pipeline";

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

// --- Unit tests ---

function testGetDatasetProfiles() {
  console.log("\ngetDatasetProfiles:");

  const profiles = getDatasetProfiles();
  assert(profiles.length > 0, "returns at least one profile");
  assert(
    profiles.some((p) => p.id === "languages"),
    "includes languages profile"
  );
  assert(
    profiles.some((p) => p.id === "phonology"),
    "includes phonology profile"
  );
  assert(
    profiles.some((p) => p.id === "grammar"),
    "includes grammar profile"
  );
  assert(
    profiles.some((p) => p.id === "etymology"),
    "includes etymology profile"
  );

  for (const p of profiles) {
    assert(p.id.length > 0, `profile ${p.id} has id`);
    assert(p.name.length > 0, `profile ${p.id} has name`);
    assert(p.description.length > 0, `profile ${p.id} has description`);
    assert(p.files.length > 0, `profile ${p.id} has files`);
  }
}

function testGetDatasetProfile() {
  console.log("\ngetDatasetProfile:");

  const profile = getDatasetProfile("languages");
  assert(profile !== undefined, "finds languages profile");
  assertEqual(profile!.id, "languages", "correct id");
  assert(
    profile!.files.includes("languages.tsv"),
    "includes languages.tsv"
  );

  const missing = getDatasetProfile("nonexistent");
  assertEqual(missing, undefined, "returns undefined for unknown profile");
}

function testValidateExportOptions() {
  console.log("\nvalidateExportOptions:");

  // Valid options
  let errors = validateExportOptions({ dataset: "languages", format: "csv" });
  assertEqual(errors.length, 0, "valid options produce no errors");

  // Missing dataset
  errors = validateExportOptions({ dataset: "", format: "csv" });
  assert(errors.length > 0, "rejects empty dataset");

  // Unknown dataset
  errors = validateExportOptions({ dataset: "fake", format: "csv" });
  assert(
    errors.some((e) => e.includes("Unknown dataset")),
    "rejects unknown dataset"
  );

  // Invalid format
  errors = validateExportOptions({
    dataset: "languages",
    format: "xml" as ExportFormat,
  });
  assert(
    errors.some((e) => e.includes("Invalid format")),
    "rejects invalid format"
  );

  // Invalid includeFiles
  errors = validateExportOptions({
    dataset: "languages",
    format: "csv",
    includeFiles: ["nonexistent.tsv"],
  });
  assert(
    errors.some((e) => e.includes("not part of dataset")),
    "rejects files not in dataset"
  );

  // Valid includeFiles
  errors = validateExportOptions({
    dataset: "languages",
    format: "csv",
    includeFiles: ["languages.tsv"],
  });
  assertEqual(errors.length, 0, "accepts valid includeFiles");

  // All formats accepted
  for (const fmt of ["csv", "tsv", "json", "cldf"] as ExportFormat[]) {
    errors = validateExportOptions({ dataset: "languages", format: fmt });
    assertEqual(errors.length, 0, `accepts format: ${fmt}`);
  }
}

// --- Integration tests (read actual TSV files) ---

async function testExportLanguagesTsv() {
  console.log("\nexportDataset (languages, tsv):");

  const result = await exportDataset({
    dataset: "languages",
    format: "tsv",
  });

  assertEqual(result.dataset, "languages", "correct dataset");
  assertEqual(result.format, "tsv", "correct format");
  assert(result.files.length > 0, "produces files");
  assert(result.metadata.totalRows > 0, "has data rows");
  assertEqual(result.metadata.license, "CC-BY-4.0", "includes license");
  assert(
    result.metadata.exportDate.length > 0,
    "includes export date"
  );

  // Check that languages file was exported
  const langFile = result.files.find((f) => f.filename === "languages.tsv");
  assert(langFile !== undefined, "includes languages.tsv");
  if (langFile) {
    assert(langFile.rowCount > 0, "languages file has rows");
    // Headers should be remapped
    const firstLine = langFile.content.split("\n")[0];
    assert(firstLine.includes("ID"), "headers remapped to standard names");
    assert(firstLine.includes("Name"), "has Name column");
  }
}

async function testExportLanguagesCsv() {
  console.log("\nexportDataset (languages, csv):");

  const result = await exportDataset({
    dataset: "languages",
    format: "csv",
  });

  const langFile = result.files.find((f) => f.filename === "languages.csv");
  assert(langFile !== undefined, "produces .csv file");
  if (langFile) {
    const firstLine = langFile.content.split("\n")[0];
    assert(firstLine.includes(","), "CSV uses commas");
  }
}

async function testExportLanguagesJson() {
  console.log("\nexportDataset (languages, json):");

  const result = await exportDataset({
    dataset: "languages",
    format: "json",
  });

  const langFile = result.files.find((f) => f.filename === "languages.json");
  assert(langFile !== undefined, "produces .json file");
  if (langFile) {
    const parsed = JSON.parse(langFile.content);
    assert(Array.isArray(parsed), "JSON is an array");
    assert(parsed.length > 0, "JSON has entries");
    assert("ID" in parsed[0], "JSON objects use remapped keys");
  }
}

async function testExportWithFilter() {
  console.log("\nexportDataset (with filter):");

  // Export only languages from a specific region
  const result = await exportDataset({
    dataset: "languages",
    format: "tsv",
    filters: { region: "Europe" },
  });

  const langFile = result.files.find((f) => f.filename === "languages.tsv");
  assert(langFile !== undefined, "produces filtered file");
  if (langFile) {
    // All rows should contain "Europe" in some form
    const lines = langFile.content.split("\n").filter((l) => l.trim());
    // First line is header
    if (lines.length > 1) {
      assert(langFile.rowCount <= 200, "filter reduces row count");
    }
  }
}

async function testExportWithIncludeFiles() {
  console.log("\nexportDataset (includeFiles):");

  const result = await exportDataset({
    dataset: "languages",
    format: "csv",
    includeFiles: ["families.tsv"],
  });

  assertEqual(result.files.length, 1, "only exports requested files");
  assertEqual(
    result.files[0].filename,
    "families.csv",
    "exports families with .csv extension"
  );
}

async function testExportCldfFormat() {
  console.log("\nexportDataset (cldf format):");

  const result = await exportDataset({
    dataset: "languages",
    format: "cldf",
  });

  const langFile = result.files.find((f) => f.filename === "languages.csv");
  assert(langFile !== undefined, "CLDF produces .csv files");
  if (langFile) {
    const firstLine = langFile.content.split("\n")[0];
    assert(firstLine.includes("ID"), "CLDF has ID column");
    assert(firstLine.includes(","), "CLDF uses comma separator");
  }
}

async function testExportUnknownDataset() {
  console.log("\nexportDataset (unknown dataset):");

  let threw = false;
  try {
    await exportDataset({ dataset: "nonexistent", format: "csv" });
  } catch (e) {
    threw = true;
    assert(
      (e as Error).message.includes("Unknown dataset"),
      "error mentions unknown dataset"
    );
  }
  assert(threw, "throws for unknown dataset");
}

async function testExportMetadata() {
  console.log("\nexportDataset (metadata):");

  const result = await exportDataset({
    dataset: "grammar",
    format: "tsv",
  });

  const meta = result.metadata;
  assert(meta.title.includes("Grammatical"), "metadata title includes dataset name");
  assert(meta.description.length > 0, "metadata has description");
  assertEqual(meta.license, "CC-BY-4.0", "metadata has license");
  assert(meta.fileCount > 0, "metadata counts files");
  assert(meta.totalRows >= 0, "metadata counts total rows");
  assert(meta.exportDate.length > 0, "metadata has export date");
  assert(meta.source.includes("LinguaScrape"), "metadata cites source");
}

async function main() {
  console.log("=== Export Pipeline Tests ===\n");

  try {
    // Unit tests
    testGetDatasetProfiles();
    testGetDatasetProfile();
    testValidateExportOptions();

    // Integration tests
    await testExportLanguagesTsv();
    await testExportLanguagesCsv();
    await testExportLanguagesJson();
    await testExportWithFilter();
    await testExportWithIncludeFiles();
    await testExportCldfFormat();
    await testExportUnknownDataset();
    await testExportMetadata();
  } catch (error) {
    console.error("\nUnexpected error:", error);
    failed++;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
