import fs from "node:fs";
import path from "node:path";
import {
  detectDelimiter,
  parseDelimited,
  bulkImport,
  getImportTargets,
} from "../server/services/bulk-import";

const TEST_DIR = path.resolve("data/source/lexicons/.test-import");
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

async function setup() {
  await fs.promises.mkdir(TEST_DIR, { recursive: true });
}

async function cleanup() {
  await fs.promises.rm(TEST_DIR, { recursive: true, force: true });
}

// --- Unit tests ---

function testDetectDelimiter() {
  console.log("\ndetectDelimiter:");
  assertEqual(detectDelimiter("id\tname\tregion"), "\t", "detects TSV tabs");
  assertEqual(detectDelimiter("id,name,region"), ",", "detects CSV commas");
  assertEqual(detectDelimiter("id\tname,region\tother"), "\t", "tabs win when more tabs");
  assertEqual(detectDelimiter("id,name\tregion,other"), ",", "commas win when more commas");
  assertEqual(detectDelimiter("single_column"), "\t", "defaults to tab for no delimiters");
}

function testParseDelimited() {
  console.log("\nparseDelimited:");

  const tsvContent = "id\tname\tregion\nfam1\tIndo-European\tEurasia\nfam2\tSino-Tibetan\tAsia";
  const tsv = parseDelimited(tsvContent, "\t");
  assertEqual(tsv.headers, ["id", "name", "region"], "parses TSV headers");
  assertEqual(tsv.rows.length, 2, "parses TSV rows");
  assertEqual(tsv.rows[0], ["fam1", "Indo-European", "Eurasia"], "first row correct");

  const csvContent = "id,name,region\nfam1,Indo-European,Eurasia";
  const csv = parseDelimited(csvContent, ",");
  assertEqual(csv.headers, ["id", "name", "region"], "parses CSV headers");
  assertEqual(csv.rows.length, 1, "parses CSV rows");

  const empty = parseDelimited("", "\t");
  assertEqual(empty.headers.length, 0, "handles empty content");
  assertEqual(empty.rows.length, 0, "no rows for empty content");

  const headerOnly = parseDelimited("id\tname\n", "\t");
  assertEqual(headerOnly.headers, ["id", "name"], "parses header-only");
  assertEqual(headerOnly.rows.length, 0, "no data rows for header-only");
}

async function testBulkImportAppend() {
  console.log("\nbulkImport (append mode):");

  // Create a test TSV file in the actual lexicons dir
  const testFile = "test-import-append.tsv";
  const testPath = path.resolve("data", "source", "lexicons", testFile);
  try {
    await fs.promises.writeFile(
      testPath,
      "id\tname\tregion\nex1\tExisting\tAfrica\n",
      "utf8"
    );

    // Append TSV data
    const result = await bulkImport({
      target: testFile,
      content: "id\tname\tregion\nnew1\tNewLang\tEurope\nnew2\tOtherLang\tAsia",
      mode: "append",
    });

    assertEqual(result.rowsImported, 2, "imported 2 rows");
    assertEqual(result.rowsSkipped, 0, "skipped 0 rows");
    assert(result.backupPath !== undefined, "backup was created");

    // Verify file contents
    const content = await fs.promises.readFile(testPath, "utf8");
    const lines = content.split("\n").filter((l) => l.trim());
    assertEqual(lines.length, 4, "file has header + 3 data rows");
    assert(content.includes("ex1"), "original data preserved");
    assert(content.includes("new1"), "new data appended");
  } finally {
    await fs.promises.unlink(testPath).catch(() => {});
  }
}

async function testBulkImportDuplicateSkip() {
  console.log("\nbulkImport (duplicate skip):");

  const testFile = "test-import-dup.tsv";
  const testPath = path.resolve("data", "source", "lexicons", testFile);
  try {
    await fs.promises.writeFile(
      testPath,
      "id\tname\tregion\nex1\tExisting\tAfrica\n",
      "utf8"
    );

    const result = await bulkImport({
      target: testFile,
      content: "id\tname\tregion\nex1\tDuplicate\tEurope\nnew1\tNewLang\tAsia",
      mode: "append",
      skipDuplicates: true,
    });

    assertEqual(result.rowsImported, 1, "imported 1 new row");
    assertEqual(result.rowsSkipped, 1, "skipped 1 duplicate");

    const content = await fs.promises.readFile(testPath, "utf8");
    assert(!content.includes("Duplicate"), "duplicate row not added");
    assert(content.includes("new1"), "new row added");
  } finally {
    await fs.promises.unlink(testPath).catch(() => {});
  }
}

async function testBulkImportReplace() {
  console.log("\nbulkImport (replace mode):");

  const testFile = "test-import-replace.tsv";
  const testPath = path.resolve("data", "source", "lexicons", testFile);
  try {
    await fs.promises.writeFile(
      testPath,
      "id\tname\tregion\nold1\tOldData\tNowhere\n",
      "utf8"
    );

    const result = await bulkImport({
      target: testFile,
      content: "id\tname\tregion\nrep1\tReplaced\tEurope\nrep2\tAnother\tAsia",
      mode: "replace",
    });

    assertEqual(result.rowsImported, 2, "imported 2 rows");
    assert(result.backupPath !== undefined, "backup was created");

    const content = await fs.promises.readFile(testPath, "utf8");
    assert(!content.includes("old1"), "old data replaced");
    assert(content.includes("rep1"), "new data written");
    const lines = content.split("\n").filter((l) => l.trim());
    assertEqual(lines.length, 3, "header + 2 data rows");
  } finally {
    await fs.promises.unlink(testPath).catch(() => {});
  }
}

async function testBulkImportCSV() {
  console.log("\nbulkImport (CSV input):");

  const testFile = "test-import-csv.tsv";
  const testPath = path.resolve("data", "source", "lexicons", testFile);
  try {
    await fs.promises.writeFile(testPath, "id\tname\tregion\n", "utf8");

    const result = await bulkImport({
      target: testFile,
      content: "id,name,region\ncsv1,FromCSV,Europe",
      mode: "append",
    });

    assertEqual(result.rowsImported, 1, "imported 1 CSV row");

    const content = await fs.promises.readFile(testPath, "utf8");
    assert(content.includes("csv1"), "CSV data converted to TSV");
    assert(content.includes("\t"), "output uses tabs");
  } finally {
    await fs.promises.unlink(testPath).catch(() => {});
  }
}

async function testBulkImportColumnMapping() {
  console.log("\nbulkImport (column reordering):");

  const testFile = "test-import-reorder.tsv";
  const testPath = path.resolve("data", "source", "lexicons", testFile);
  try {
    await fs.promises.writeFile(testPath, "id\tname\tregion\n", "utf8");

    // Send columns in different order
    const result = await bulkImport({
      target: testFile,
      content: "region\tid\tname\nEurope\treord1\tReordered",
      mode: "append",
    });

    assertEqual(result.rowsImported, 1, "imported 1 reordered row");

    const content = await fs.promises.readFile(testPath, "utf8");
    const dataLine = content.split("\n").filter((l) => l.trim())[1];
    assertEqual(dataLine, "reord1\tReordered\tEurope", "columns mapped correctly");
  } finally {
    await fs.promises.unlink(testPath).catch(() => {});
  }
}

async function testBulkImportPartialColumns() {
  console.log("\nbulkImport (partial columns):");

  const testFile = "test-import-partial.tsv";
  const testPath = path.resolve("data", "source", "lexicons", testFile);
  try {
    await fs.promises.writeFile(testPath, "id\tname\tregion\n", "utf8");

    // Only send id and name, missing region
    const result = await bulkImport({
      target: testFile,
      content: "id\tname\npart1\tPartial",
      mode: "append",
    });

    assertEqual(result.rowsImported, 1, "imported partial row");
    // No unmapped warning because all incoming columns (id, name) match target
    assertEqual(result.errors.length, 0, "no errors for subset of target columns");

    const content = await fs.promises.readFile(testPath, "utf8");
    const dataLine = content.split("\n").filter((l) => l.trim())[1];
    assertEqual(dataLine, "part1\tPartial\t", "missing columns filled with empty");
  } finally {
    await fs.promises.unlink(testPath).catch(() => {});
  }
}

async function testBulkImportValidation() {
  console.log("\nbulkImport (validation):");

  // Invalid target
  let result = await bulkImport({
    target: "../etc/passwd",
    content: "id\tname\ntest\ttest",
    mode: "append",
  });
  assert(result.errors.length > 0, "rejects path traversal");

  // Non-existent file
  result = await bulkImport({
    target: "nonexistent.tsv",
    content: "id\tname\ntest\ttest",
    mode: "append",
  });
  assert(result.errors.length > 0, "rejects non-existent target");

  // No matching columns
  const testFile = "test-import-nomatch.tsv";
  const testPath = path.resolve("data", "source", "lexicons", testFile);
  try {
    await fs.promises.writeFile(testPath, "id\tname\tregion\n", "utf8");

    result = await bulkImport({
      target: testFile,
      content: "foo\tbar\tbaz\nval1\tval2\tval3",
      mode: "append",
    });
    assert(
      result.errors.some((e) => e.includes("No matching columns")),
      "rejects when no columns match"
    );
    assertEqual(result.rowsImported, 0, "no rows imported on column mismatch");
  } finally {
    await fs.promises.unlink(testPath).catch(() => {});
  }

  // Empty content
  result = await bulkImport({
    target: "families.tsv",
    content: "",
    mode: "append",
  });
  assert(result.errors.length > 0, "rejects empty content");
}

async function testGetImportTargets() {
  console.log("\ngetImportTargets:");

  const targets = await getImportTargets();
  assert(targets.length > 0, "returns at least one target");
  assert(
    targets.some((t) => t.file === "languages.tsv"),
    "includes languages.tsv"
  );
  assert(
    targets.some((t) => t.file === "families.tsv"),
    "includes families.tsv"
  );

  const langTarget = targets.find((t) => t.file === "languages.tsv");
  assert(langTarget !== undefined, "languages.tsv found");
  assert(
    langTarget!.headers.includes("id"),
    "languages.tsv has id header"
  );
  assert(
    langTarget!.headers.includes("name"),
    "languages.tsv has name header"
  );
}

async function main() {
  console.log("=== Bulk Import Tests ===\n");

  try {
    await setup();

    // Unit tests (no file I/O)
    testDetectDelimiter();
    testParseDelimited();

    // Integration tests (file I/O)
    await testBulkImportAppend();
    await testBulkImportDuplicateSkip();
    await testBulkImportReplace();
    await testBulkImportCSV();
    await testBulkImportColumnMapping();
    await testBulkImportPartialColumns();
    await testBulkImportValidation();
    await testGetImportTargets();

    await cleanup();

    // Clean up any backup dirs created during tests
    const backupDir = path.resolve("data/source/lexicons/.backups");
    await fs.promises.rm(backupDir, { recursive: true, force: true }).catch(() => {});
  } catch (error) {
    console.error("\nUnexpected error:", error);
    failed++;
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
