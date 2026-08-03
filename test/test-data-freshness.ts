/**
 * Test script for data freshness tracking service
 * Run with: npx tsx test/test-data-freshness.ts
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getDatasetFreshness, getFreshnessSummary } from "../server/services/data-freshness";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "freshness-test-"));
}

function writeTsv(dir: string, name: string, rows: string[][]): string {
  const filePath = path.join(dir, name);
  const content = rows.map((r) => r.join("\t")).join("\n") + "\n";
  fs.writeFileSync(filePath, content);
  return filePath;
}

function setFileAge(filePath: string, daysAgo: number) {
  const mtime = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  fs.utimesSync(filePath, mtime, mtime);
}

function cleanup(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testEmptyDirectory() {
  console.log("\n=== Empty Directory Tests ===\n");

  const dir = createTempDir();
  try {
    const datasets = getDatasetFreshness(dir);
    assert(datasets.length === 0, "Empty directory returns no datasets");

    const summary = getFreshnessSummary(dir);
    assert(summary.totalDatasets === 0, "Summary has 0 total datasets");
    assert(summary.totalRecords === 0, "Summary has 0 total records");
    assert(summary.oldestDataset === null, "Oldest dataset is null");
    assert(summary.newestDataset === null, "Newest dataset is null");
  } finally {
    cleanup(dir);
  }
}

async function testNonexistentDirectory() {
  console.log("\n=== Nonexistent Directory Tests ===\n");

  const datasets = getDatasetFreshness("/nonexistent/path");
  assert(datasets.length === 0, "Nonexistent directory returns no datasets");
}

async function testBasicFreshness() {
  console.log("\n=== Basic Freshness Tests ===\n");

  const dir = createTempDir();
  try {
    const fp = writeTsv(dir, "languages.tsv", [
      ["id", "name", "family"],
      ["en", "English", "germanic"],
      ["fr", "French", "romance"],
      ["de", "German", "germanic"],
    ]);

    const datasets = getDatasetFreshness(dir);
    assert(datasets.length === 1, "Found 1 dataset");
    assert(datasets[0].name === "Languages", "Name is 'Languages'");
    assert(datasets[0].file === "languages.tsv", "File is 'languages.tsv'");
    assert(datasets[0].recordCount === 3, "Record count is 3 (excludes header)");
    assert(datasets[0].sizeBytes > 0, "Size is positive");
    assert(datasets[0].staleness === "fresh", "Newly created file is fresh");
    assert(typeof datasets[0].lastModified === "string", "lastModified is a string");
    assert(datasets[0].ageDays >= 0, "ageDays is non-negative");
  } finally {
    cleanup(dir);
  }
}

async function testStalenessClassification() {
  console.log("\n=== Staleness Classification Tests ===\n");

  const dir = createTempDir();
  try {
    const freshFile = writeTsv(dir, "fresh-data.tsv", [
      ["id", "value"],
      ["1", "a"],
    ]);
    setFileAge(freshFile, 2); // 2 days old

    const agingFile = writeTsv(dir, "aging-data.tsv", [
      ["id", "value"],
      ["1", "b"],
    ]);
    setFileAge(agingFile, 15); // 15 days old

    const staleFile = writeTsv(dir, "stale-data.tsv", [
      ["id", "value"],
      ["1", "c"],
    ]);
    setFileAge(staleFile, 45); // 45 days old

    const datasets = getDatasetFreshness(dir);
    const byName = Object.fromEntries(datasets.map((d) => [d.file, d]));

    assert(byName["fresh-data.tsv"].staleness === "fresh", "2-day-old file is fresh");
    assert(byName["aging-data.tsv"].staleness === "aging", "15-day-old file is aging");
    assert(byName["stale-data.tsv"].staleness === "stale", "45-day-old file is stale");
  } finally {
    cleanup(dir);
  }
}

async function testCustomThresholds() {
  console.log("\n=== Custom Thresholds Tests ===\n");

  const dir = createTempDir();
  try {
    const fp = writeTsv(dir, "data.tsv", [
      ["id", "value"],
      ["1", "a"],
    ]);
    setFileAge(fp, 5); // 5 days old

    // With default thresholds (7/30), should be fresh
    const defaultResult = getDatasetFreshness(dir);
    assert(defaultResult[0].staleness === "fresh", "5-day file is fresh with default thresholds");

    // With tight thresholds (3/10), should be aging
    const tightResult = getDatasetFreshness(dir, new Date(), { freshDays: 3, agingDays: 10 });
    assert(tightResult[0].staleness === "aging", "5-day file is aging with tight thresholds");

    // With very tight thresholds (1/3), should be stale
    const veryTightResult = getDatasetFreshness(dir, new Date(), { freshDays: 1, agingDays: 3 });
    assert(veryTightResult[0].staleness === "stale", "5-day file is stale with very tight thresholds");
  } finally {
    cleanup(dir);
  }
}

async function testSummaryAggregation() {
  console.log("\n=== Summary Aggregation Tests ===\n");

  const dir = createTempDir();
  try {
    const f1 = writeTsv(dir, "alpha.tsv", [
      ["id", "name"],
      ["1", "one"],
      ["2", "two"],
    ]);
    setFileAge(f1, 1);

    const f2 = writeTsv(dir, "beta.tsv", [
      ["id", "name"],
      ["1", "a"],
      ["2", "b"],
      ["3", "c"],
    ]);
    setFileAge(f2, 20);

    const f3 = writeTsv(dir, "gamma.tsv", [
      ["id", "name"],
      ["1", "x"],
    ]);
    setFileAge(f3, 60);

    const summary = getFreshnessSummary(dir);

    assert(summary.totalDatasets === 3, "Total datasets is 3");
    assert(summary.totalRecords === 6, "Total records is 6 (2+3+1)");
    assert(summary.totalSizeBytes > 0, "Total size is positive");
    assert(summary.freshCount === 1, "1 fresh dataset");
    assert(summary.agingCount === 1, "1 aging dataset");
    assert(summary.staleCount === 1, "1 stale dataset");
    assert(summary.newestDataset === "Alpha", "Newest is Alpha (1 day old)");
    assert(summary.oldestDataset === "Gamma", "Oldest is Gamma (60 days old)");
    assert(typeof summary.generatedAt === "string", "generatedAt is set");
  } finally {
    cleanup(dir);
  }
}

async function testIgnoresNonTsvFiles() {
  console.log("\n=== Non-TSV Files Tests ===\n");

  const dir = createTempDir();
  try {
    writeTsv(dir, "data.tsv", [
      ["id", "name"],
      ["1", "a"],
    ]);
    fs.writeFileSync(path.join(dir, "readme.txt"), "not a tsv");
    fs.writeFileSync(path.join(dir, "data.json"), '{"key": "value"}');

    const datasets = getDatasetFreshness(dir);
    assert(datasets.length === 1, "Only TSV files are included");
    assert(datasets[0].file === "data.tsv", "The TSV file is data.tsv");
  } finally {
    cleanup(dir);
  }
}

async function testRealLexiconsDir() {
  console.log("\n=== Real Lexicons Directory Tests ===\n");

  const lexiconsDir = path.resolve(process.cwd(), "data", "source", "lexicons");
  if (!fs.existsSync(lexiconsDir)) {
    console.log("  (skipping - no lexicons directory found)");
    return;
  }

  const summary = getFreshnessSummary(lexiconsDir);
  assert(summary.totalDatasets > 0, `Found ${summary.totalDatasets} datasets in data/source/lexicons/`);
  assert(summary.totalRecords > 0, `Found ${summary.totalRecords} total records`);
  assert(summary.oldestDataset !== null, `Oldest dataset: ${summary.oldestDataset}`);
  assert(summary.newestDataset !== null, `Newest dataset: ${summary.newestDataset}`);
  console.log(`  Info: ${summary.freshCount} fresh, ${summary.agingCount} aging, ${summary.staleCount} stale`);
}

async function main() {
  console.log("=== Data Freshness Tracking Tests ===");

  await testEmptyDirectory();
  await testNonexistentDirectory();
  await testBasicFreshness();
  await testStalenessClassification();
  await testCustomThresholds();
  await testSummaryAggregation();
  await testIgnoresNonTsvFiles();
  await testRealLexiconsDir();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
