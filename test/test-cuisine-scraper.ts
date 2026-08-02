import fs from "node:fs";
import path from "node:path";
import { CuisineScraper } from "../server/services/cuisine-scraper";

const TEST_DIR = path.resolve("data/source/lexicons/.test-cuisine");
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

function testSlugify() {
  console.log("\nslugify:");
  const scraper = new CuisineScraper();

  assertEqual(scraper.slugify("Chinese"), "chinese", "lowercases simple name");
  assertEqual(scraper.slugify("Tex-Mex"), "tex-mex", "preserves hyphens");
  assertEqual(scraper.slugify("São Tomé"), "sao-tome", "strips diacritics");
  assertEqual(scraper.slugify("New Zealand"), "new-zealand", "replaces spaces with hyphens");
  assertEqual(scraper.slugify("  Thai  "), "thai", "trims whitespace");
  assertEqual(scraper.slugify("North African / Maghreb"), "north-african-maghreb", "handles slashes");
  assertEqual(scraper.slugify(""), "", "handles empty string");
}

function testLoadExistingCuisineIds() {
  console.log("\nloadExistingCuisineIds:");
  // Uses private method via scraper - test indirectly through the class behavior
  // We test that the scraper correctly reads existing TSV data
  const scraper = new CuisineScraper();

  // The main data/source/lexicons/cuisines.tsv should have entries
  const ids = (scraper as any).loadExistingCuisineIds();
  assert(ids instanceof Set, "returns a Set");
  assert(ids.size > 0, "finds existing cuisine IDs from data/source/lexicons/cuisines.tsv");
  assert(ids.has("chinese"), "includes 'chinese' cuisine");
  assert(ids.has("french"), "includes 'french' cuisine");
  assert(ids.has("japanese"), "includes 'japanese' cuisine");
}

async function testAppendToNewTsv() {
  console.log("\nappendToTsv (new file):");
  const scraper = new CuisineScraper();
  const testFile = path.join(TEST_DIR, "new-cuisines.tsv");

  const headers = ["id", "name", "region"];
  const rows = [
    ["test-1", "Test Cuisine 1", "Test Region"],
    ["test-2", "Test Cuisine 2", "Another Region"],
  ];

  await (scraper as any).appendToTsv(testFile, headers, rows);

  const content = await fs.promises.readFile(testFile, "utf8");
  const lines = content.trim().split("\n");

  assertEqual(lines.length, 3, "new file has header + 2 data rows");
  assertEqual(lines[0], "id\tname\tregion", "header line is correct");
  assertEqual(lines[1], "test-1\tTest Cuisine 1\tTest Region", "first data row is correct");
  assertEqual(lines[2], "test-2\tTest Cuisine 2\tAnother Region", "second data row is correct");
}

async function testAppendToExistingTsv() {
  console.log("\nappendToTsv (existing file):");
  const scraper = new CuisineScraper();
  const testFile = path.join(TEST_DIR, "existing-cuisines.tsv");

  // Create initial file
  const initialContent = "id\tname\tregion\nexisting-1\tExisting\tSome Region\n";
  await fs.promises.writeFile(testFile, initialContent, "utf8");

  const headers = ["id", "name", "region"];
  const rows = [["appended-1", "Appended Cuisine", "New Region"]];

  await (scraper as any).appendToTsv(testFile, headers, rows);

  const content = await fs.promises.readFile(testFile, "utf8");
  const lines = content.trim().split("\n");

  assertEqual(lines.length, 3, "file has header + 1 existing + 1 appended row");
  assertEqual(lines[0], "id\tname\tregion", "header preserved");
  assertEqual(lines[1], "existing-1\tExisting\tSome Region", "existing row preserved");
  assertEqual(lines[2], "appended-1\tAppended Cuisine\tNew Region", "appended row added");
}

async function testAppendEmptyRows() {
  console.log("\nappendToTsv (empty rows):");
  const scraper = new CuisineScraper();
  const testFile = path.join(TEST_DIR, "no-change.tsv");

  const initialContent = "id\tname\nfoo\tBar\n";
  await fs.promises.writeFile(testFile, initialContent, "utf8");

  await (scraper as any).appendToTsv(testFile, ["id", "name"], []);

  const content = await fs.promises.readFile(testFile, "utf8");
  assertEqual(content, initialContent, "file unchanged when no rows to append");
}

function testScrapeCuisinesRequiresApiKey() {
  console.log("\nscrapeCuisines validation:");
  const scraper = new CuisineScraper();

  // Save and clear the API key
  const savedKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  scraper.scrapeCuisines().then(() => {
    assert(false, "should throw without API key");
    process.env.GEMINI_API_KEY = savedKey;
  }).catch((err) => {
    assert(
      err.message.includes("GEMINI_API_KEY"),
      "throws error about missing GEMINI_API_KEY"
    );
    // Restore key
    if (savedKey) process.env.GEMINI_API_KEY = savedKey;
  });
}

async function testAtomicWriteCleanup() {
  console.log("\natomic write (no leftover tmp files):");
  const scraper = new CuisineScraper();
  const testFile = path.join(TEST_DIR, "atomic-test.tsv");

  await (scraper as any).appendToTsv(testFile, ["id"], [["row1"]]);

  // Check no .tmp file left behind
  const tmpExists = fs.existsSync(`${testFile}.tmp`);
  assert(!tmpExists, "no .tmp file left after successful write");
}

// --- Run all tests ---

async function runTests() {
  console.log("=== Cuisine Scraper Tests ===");

  await setup();

  try {
    // Unit tests (sync)
    testSlugify();
    testLoadExistingCuisineIds();

    // Async tests
    await testAppendToNewTsv();
    await testAppendToExistingTsv();
    await testAppendEmptyRows();
    await testAtomicWriteCleanup();

    // Validation tests
    testScrapeCuisinesRequiresApiKey();

    // Wait a tick for the async validation test
    await new Promise(resolve => setTimeout(resolve, 100));
  } finally {
    await cleanup();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
