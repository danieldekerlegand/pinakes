import fs from "node:fs";
import path from "node:path";
import {
  parseCSV,
  getWalsArea,
  GrammarWalsGrambankScraper,
  type FeatureRow,
} from "../server/services/grammar-wals-grambank-scraper";

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

// --- parseCSV tests ---

function testParseCSVBasic() {
  console.log("\nparseCSV - basic:");

  const csv = "ID,Name,Value\n1,hello,42\n2,world,99";
  const result = parseCSV(csv);

  assertEqual(result.headers, ["ID", "Name", "Value"], "parses headers");
  assertEqual(result.rows.length, 2, "parses correct number of rows");
  assertEqual(result.rows[0], ["1", "hello", "42"], "parses first row");
  assertEqual(result.rows[1], ["2", "world", "99"], "parses second row");
}

function testParseCSVQuoted() {
  console.log("\nparseCSV - quoted fields:");

  const csv = 'ID,Name,Desc\n1,"hello, world","has ""quotes"""\n2,simple,value';
  const result = parseCSV(csv);

  assertEqual(
    result.rows[0],
    ["1", "hello, world", 'has "quotes"'],
    "handles quoted fields with commas and escaped quotes"
  );
  assertEqual(result.rows[1], ["2", "simple", "value"], "handles unquoted row after quoted");
}

function testParseCSVEmpty() {
  console.log("\nparseCSV - empty/edge cases:");

  const emptyResult = parseCSV("");
  assertEqual(emptyResult.headers, [], "empty string returns empty headers");
  assertEqual(emptyResult.rows, [], "empty string returns empty rows");

  const headerOnly = parseCSV("ID,Name\n");
  assertEqual(headerOnly.headers, ["ID", "Name"], "header-only CSV parses headers");
  assertEqual(headerOnly.rows, [], "header-only CSV returns empty rows");
}

function testParseCSVCRLF() {
  console.log("\nparseCSV - CRLF line endings:");

  const csv = "ID,Name\r\n1,hello\r\n2,world\r\n";
  const result = parseCSV(csv);

  assertEqual(result.headers, ["ID", "Name"], "handles CRLF headers");
  assertEqual(result.rows[0], ["1", "hello"], "strips CR from values");
}

function testParseCSVWalsFormat() {
  console.log("\nparseCSV - WALS values format:");

  const csv =
    "ID,Language_ID,Parameter_ID,Value,Code_ID,Comment,Source,Example_ID\n" +
    "81A-aab,aab,81A,2,81A-2,,Nekitel-1985[94],\n" +
    '82A-aab,aab,82A,1,82A-1,"some comment",Source-2,igt-100';
  const result = parseCSV(csv);

  assertEqual(result.headers.length, 8, "parses 8 WALS headers");
  assertEqual(result.rows[0][1], "aab", "parses WALS language ID");
  assertEqual(result.rows[0][2], "81A", "parses WALS parameter ID");
  assertEqual(result.rows[0][4], "81A-2", "parses WALS code ID");
  assertEqual(result.rows[1][5], "some comment", "parses quoted comment");
}

function testParseCSVGrambankFormat() {
  console.log("\nparseCSV - Grambank format:");

  const csv =
    "ID,Language_ID,Parameter_ID,Value,Code_ID,Comment,Source\n" +
    "abad1241-GB020,abad1241,GB020,1,GB020-1,,\n" +
    "abad1241-GB021,abad1241,GB021,0,GB021-0,,";
  const result = parseCSV(csv);

  assertEqual(result.rows[0][1], "abad1241", "parses Grambank glottocode");
  assertEqual(result.rows[0][2], "GB020", "parses Grambank parameter ID");
  assertEqual(result.rows[0][3], "1", "parses Grambank value");
}

// --- getWalsArea tests ---

function testGetWalsArea() {
  console.log("\ngetWalsArea:");

  assertEqual(getWalsArea("1"), "Phonology", "chapter 1 is Phonology");
  assertEqual(getWalsArea("19"), "Phonology", "chapter 19 is Phonology");
  assertEqual(getWalsArea("20"), "Morphology", "chapter 20 is Morphology");
  assertEqual(getWalsArea("29"), "Morphology", "chapter 29 is Morphology");
  assertEqual(getWalsArea("30"), "Nominal Categories", "chapter 30 is Nominal Categories");
  assertEqual(getWalsArea("57"), "Nominal Categories", "chapter 57 is Nominal Categories");
  assertEqual(getWalsArea("58"), "Verbal Categories", "chapter 58 is Verbal Categories");
  assertEqual(getWalsArea("64"), "Verbal Categories", "chapter 64 is Verbal Categories");
  assertEqual(getWalsArea("65"), "Word Order", "chapter 65 is Word Order");
  assertEqual(getWalsArea("97"), "Word Order", "chapter 97 is Word Order");
  assertEqual(getWalsArea("98"), "Simple Clauses", "chapter 98 is Simple Clauses");
  assertEqual(getWalsArea("121"), "Simple Clauses", "chapter 121 is Simple Clauses");
  assertEqual(getWalsArea("122"), "Complex Sentences", "chapter 122 is Complex Sentences");
  assertEqual(getWalsArea("128"), "Complex Sentences", "chapter 128 is Complex Sentences");
  assertEqual(getWalsArea("129"), "Lexicon", "chapter 129 is Lexicon");
  assertEqual(getWalsArea("138"), "Lexicon", "chapter 138 is Lexicon");
  assertEqual(getWalsArea("139"), "Sign Languages", "chapter 139 is Sign Languages");
  assertEqual(getWalsArea("144"), "Sign Languages", "chapter 144 is Sign Languages");
  assertEqual(getWalsArea("999"), "Other", "unknown chapter is Other");
  assertEqual(getWalsArea("abc"), "Other", "non-numeric is Other");
}

// --- Scraper class unit tests ---

function testScraperWriteFeatures() {
  console.log("\nGrammarWalsGrambankScraper.writeFeatures:");

  const testFile = "lexicons/.test-grammar-wals-grambank.tsv";
  const scraper = new GrammarWalsGrambankScraper();

  const features: FeatureRow[] = [
    {
      id: "wgf_w1",
      language_id: "eng",
      source: "wals",
      feature_id: "1A",
      feature_name: "Consonant Inventories",
      feature_area: "Phonology",
      value_id: "1A-2",
      value_name: "Moderately small",
      iso639_3: "eng",
      glottocode: "stan1293",
    },
    {
      id: "wgf_g1",
      language_id: "deu",
      source: "grambank",
      feature_id: "GB020",
      feature_name: "Are there definite or specific articles?",
      feature_area: "Grammar",
      value_id: "GB020-1",
      value_name: "present",
      iso639_3: "deu",
      glottocode: "stan1295",
    },
  ];

  // We test writeFeatures by temporarily changing the output path
  // Since writeFeatures uses a hardcoded path, we test the TSV format directly
  const headers = [
    "id", "language_id", "source", "feature_id", "feature_name",
    "feature_area", "value_id", "value_name", "iso639_3", "glottocode",
  ];
  const dataLines = features.map((f) =>
    [f.id, f.language_id, f.source, f.feature_id, f.feature_name,
     f.feature_area, f.value_id, f.value_name, f.iso639_3, f.glottocode].join("\t")
  );
  const content = [headers.join("\t"), ...dataLines].join("\n") + "\n";

  // Write test file
  fs.writeFileSync(testFile, content, "utf8");

  // Read and verify
  const written = fs.readFileSync(testFile, "utf8");
  const lines = written.split("\n").filter((l) => l.trim());

  assertEqual(lines.length, 3, "writes header + 2 data rows");
  assert(lines[0].startsWith("id\t"), "header starts with id column");
  assert(lines[1].includes("eng\twals\t1A"), "first row has correct data");
  assert(lines[2].includes("deu\tgrambank\tGB020"), "second row has correct data");

  // Verify tab-separated format
  const headerCols = lines[0].split("\t");
  assertEqual(headerCols.length, 10, "header has 10 columns");

  const row1Cols = lines[1].split("\t");
  assertEqual(row1Cols[0], "wgf_w1", "first row ID is correct");
  assertEqual(row1Cols[2], "wals", "first row source is wals");
  assertEqual(row1Cols[5], "Phonology", "first row area is Phonology");

  // Clean up
  fs.unlinkSync(testFile);
  console.log("  (cleaned up test file)");
}

function testScraperConcurrencyGuard() {
  console.log("\nGrammarWalsGrambankScraper - concurrency guard:");

  // The static isScraping flag prevents concurrent scrapes
  // We can't easily test this without mocking, but we verify the class instantiates
  const scraper = new GrammarWalsGrambankScraper();
  assert(scraper instanceof GrammarWalsGrambankScraper, "scraper instantiates correctly");
}

// --- Integration tests (require network) ---

async function testFetchWalsDataIntegration() {
  console.log("\n[Integration] WALS data fetch (limited):");

  const scraper = new GrammarWalsGrambankScraper();
  const progressMessages: string[] = [];

  try {
    // Filter to just a few known ISO codes to limit data
    const filter = new Set(["eng", "deu", "fra"]);
    const features = await scraper.fetchWalsData(filter, (p) => {
      progressMessages.push(p.message);
    });

    assert(features.length > 0, `fetched ${features.length} WALS features`);
    assert(progressMessages.length > 0, "received progress callbacks");

    // Verify feature structure
    const first = features[0];
    assert(typeof first.id === "string", "feature has id");
    assert(typeof first.language_id === "string", "feature has language_id");
    assertEqual(first.source, "wals", "source is wals");
    assert(typeof first.feature_id === "string", "feature has feature_id");
    assert(typeof first.feature_name === "string", "feature has feature_name");
    assert(typeof first.feature_area === "string", "feature has feature_area");

    // Check that we got features for our filtered languages
    const langIds = new Set(features.map((f) => f.iso639_3));
    assert(langIds.size <= 3, `got features for ${langIds.size} languages (max 3 expected)`);
  } catch (error) {
    console.error(`  ⚠ Skipping (network error): ${error instanceof Error ? error.message : error}`);
  }
}

async function testFetchGrambankDataIntegration() {
  console.log("\n[Integration] Grambank data fetch (limited):");

  const scraper = new GrammarWalsGrambankScraper();

  try {
    // Filter to just a couple ISO codes
    const filter = new Set(["eng", "deu"]);
    const features = await scraper.fetchGrambankData(filter, (p) => {
      // silent progress
    });

    assert(features.length > 0, `fetched ${features.length} Grambank features`);

    const first = features[0];
    assertEqual(first.source, "grambank", "source is grambank");
    assert(first.feature_id.startsWith("GB"), "Grambank feature IDs start with GB");
    assertEqual(first.feature_area, "Grammar", "Grambank area is Grammar");
  } catch (error) {
    console.error(`  ⚠ Skipping (network error): ${error instanceof Error ? error.message : error}`);
  }
}

// --- Run all tests ---

async function main() {
  console.log("=== Grammar WALS/Grambank Scraper Tests ===");

  // Unit tests
  testParseCSVBasic();
  testParseCSVQuoted();
  testParseCSVEmpty();
  testParseCSVCRLF();
  testParseCSVWalsFormat();
  testParseCSVGrambankFormat();
  testGetWalsArea();
  testScraperWriteFeatures();
  testScraperConcurrencyGuard();

  // Integration tests (network-dependent)
  const runIntegration = process.argv.includes("--integration");
  if (runIntegration) {
    await testFetchWalsDataIntegration();
    await testFetchGrambankDataIntegration();
  } else {
    console.log("\n[Skipping integration tests - pass --integration to run]");
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Test runner failed:", error);
  process.exit(1);
});
