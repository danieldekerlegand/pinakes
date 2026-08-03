/**
 * Tests for incremental scraping with diff detection
 * Run with: npx tsx test/test-incremental-scraper.ts
 */

import fs from "node:fs";
import path from "node:path";
import {
  diffTsv,
  ScrapeManifestManager,
  incrementalScrape,
  listDiffs,
  type TsvDiffResult,
} from "../server/services/incremental-scraper";

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

// --- Helpers ---

const TMP_DIR = path.join("test", ".tmp-incremental");

function tmpFile(name: string): string {
  return path.join(TMP_DIR, name);
}

async function cleanup() {
  try {
    await fs.promises.rm(TMP_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
  await fs.promises.mkdir(TMP_DIR, { recursive: true });
}

// --- diffTsv tests ---

async function testDiffDetectsAddedRows() {
  console.log("\n1. diffTsv detects added rows");
  const old = "id\tname\n1\talpha\n2\tbeta\n";
  const new_ = "id\tname\n1\talpha\n2\tbeta\n3\tgamma\n";
  const diff = diffTsv(old, new_, "id");

  assert(diff.added === 1, `Added count is 1 (got ${diff.added})`);
  assert(diff.removed === 0, `Removed count is 0 (got ${diff.removed})`);
  assert(diff.modified === 0, `Modified count is 0 (got ${diff.modified})`);
  assert(diff.unchanged === 2, `Unchanged count is 2 (got ${diff.unchanged})`);
  assert(diff.rows[0].type === "added", "Row type is added");
  assert(diff.rows[0].key === "3", "Added row key is 3");
}

async function testDiffDetectsRemovedRows() {
  console.log("\n2. diffTsv detects removed rows");
  const old = "id\tname\n1\talpha\n2\tbeta\n3\tgamma\n";
  const new_ = "id\tname\n1\talpha\n3\tgamma\n";
  const diff = diffTsv(old, new_, "id");

  assert(diff.added === 0, `Added count is 0 (got ${diff.added})`);
  assert(diff.removed === 1, `Removed count is 1 (got ${diff.removed})`);
  assert(diff.unchanged === 2, `Unchanged count is 2 (got ${diff.unchanged})`);

  const removedRow = diff.rows.find((r) => r.type === "removed");
  assert(removedRow !== undefined, "Found removed row");
  assert(removedRow?.key === "2", "Removed row key is 2");
}

async function testDiffDetectsModifiedRows() {
  console.log("\n3. diffTsv detects modified rows");
  const old = "id\tname\tregion\n1\talpha\tEurope\n2\tbeta\tAsia\n";
  const new_ = "id\tname\tregion\n1\talpha\tEurope\n2\tbeta-updated\tAfrica\n";
  const diff = diffTsv(old, new_, "id");

  assert(diff.modified === 1, `Modified count is 1 (got ${diff.modified})`);
  assert(diff.unchanged === 1, `Unchanged count is 1 (got ${diff.unchanged})`);

  const modRow = diff.rows.find((r) => r.type === "modified");
  assert(modRow !== undefined, "Found modified row");
  assert(modRow?.changedFields?.includes("name") === true, "name field changed");
  assert(modRow?.changedFields?.includes("region") === true, "region field changed");
  assert(modRow?.changedFields?.length === 2, "Exactly 2 fields changed");
}

async function testDiffHandlesEmptyOld() {
  console.log("\n4. diffTsv handles empty old content (all rows are new)");
  const new_ = "id\tname\n1\talpha\n2\tbeta\n";
  const diff = diffTsv("", new_, "id");

  assert(diff.added === 2, `Added count is 2 (got ${diff.added})`);
  assert(diff.removed === 0, `Removed count is 0`);
}

async function testDiffHandlesEmptyNew() {
  console.log("\n5. diffTsv handles empty new content (all rows removed)");
  const old = "id\tname\n1\talpha\n2\tbeta\n";
  const diff = diffTsv(old, "", "id");

  assert(diff.removed === 2, `Removed count is 2 (got ${diff.removed})`);
  assert(diff.added === 0, `Added count is 0`);
}

async function testDiffIdentical() {
  console.log("\n6. diffTsv with identical content");
  const data = "id\tname\n1\talpha\n2\tbeta\n";
  const diff = diffTsv(data, data, "id");

  assert(diff.added === 0, "No additions");
  assert(diff.removed === 0, "No removals");
  assert(diff.modified === 0, "No modifications");
  assert(diff.unchanged === 2, "All unchanged");
  assert(diff.rows.length === 0, "No diff rows");
}

// --- ScrapeManifestManager tests ---

async function testManifestSaveAndLoad() {
  console.log("\n7. Manifest save and load");
  const manifestPath = tmpFile("manifest.json");
  const mgr = new ScrapeManifestManager(manifestPath);

  await mgr.updateEntry("data/source/lexicons/test.tsv", "id\tname\n1\talpha\n", 1);

  const entry = await mgr.getEntry("data/source/lexicons/test.tsv");
  assert(entry !== undefined, "Entry exists");
  assert(entry!.file === "data/source/lexicons/test.tsv", "File matches");
  assert(entry!.rowCount === 1, "Row count matches");
  assert(entry!.contentHash.length === 64, "Content hash is SHA-256");
}

async function testManifestHasChanged() {
  console.log("\n8. Manifest detects file changes");
  const manifestPath = tmpFile("manifest2.json");
  const tsvPath = tmpFile("changed.tsv");
  const mgr = new ScrapeManifestManager(manifestPath);

  const content = "id\tname\n1\talpha\n";
  await fs.promises.writeFile(tsvPath, content, "utf8");
  await mgr.updateEntry(tsvPath, content, 1);

  // No change
  const unchanged = await mgr.hasChanged(tsvPath);
  assert(unchanged === false, "File not changed");

  // Modify file
  const newContent = "id\tname\n1\talpha\n2\tbeta\n";
  await fs.promises.writeFile(tsvPath, newContent, "utf8");

  const changed = await mgr.hasChanged(tsvPath);
  assert(changed === true, "File changed detected");
}

async function testManifestMissingFile() {
  console.log("\n9. Manifest returns changed for missing file");
  const manifestPath = tmpFile("manifest3.json");
  const mgr = new ScrapeManifestManager(manifestPath);

  const changed = await mgr.hasChanged("nonexistent.tsv");
  assert(changed === true, "Missing file reports as changed");
}

// --- incrementalScrape tests ---

async function testIncrementalScrapeNewFile() {
  console.log("\n10. Incremental scrape on new file");
  const tsvPath = tmpFile("new-data.tsv");
  const manifestPath = tmpFile("manifest4.json");
  const diffDir = tmpFile("diffs1");

  const result = await incrementalScrape({
    filePath: tsvPath,
    keyColumn: "id",
    scrapeFn: async () => {
      await fs.promises.writeFile(tsvPath, "id\tname\n1\talpha\n2\tbeta\n", "utf8");
    },
    manifestPath,
    diffDir,
  });

  assert(result.skipped === false, "Scrape was not skipped");
  assert(result.diff !== undefined, "Diff was produced");
  assert(result.diff!.added === 2, `2 rows added (got ${result.diff!.added})`);
}

async function testIncrementalScrapeSkipsUnchanged() {
  console.log("\n11. Incremental scrape skips when unchanged");
  const tsvPath = tmpFile("skip-data.tsv");
  const manifestPath = tmpFile("manifest5.json");
  const diffDir = tmpFile("diffs2");

  const content = "id\tname\n1\talpha\n";
  await fs.promises.writeFile(tsvPath, content, "utf8");

  const mgr = new ScrapeManifestManager(manifestPath);
  await mgr.updateEntry(tsvPath, content, 1);

  let scrapeCalled = false;
  const result = await incrementalScrape({
    filePath: tsvPath,
    keyColumn: "id",
    scrapeFn: async () => {
      scrapeCalled = true;
    },
    manifestPath,
    diffDir,
  });

  assert(result.skipped === true, "Scrape was skipped");
  assert(scrapeCalled === false, "Scrape function was not called");
}

async function testIncrementalScrapeForceOverridesSkip() {
  console.log("\n12. Incremental scrape with force ignores manifest");
  const tsvPath = tmpFile("force-data.tsv");
  const manifestPath = tmpFile("manifest6.json");
  const diffDir = tmpFile("diffs3");

  const content = "id\tname\n1\talpha\n";
  await fs.promises.writeFile(tsvPath, content, "utf8");

  const mgr = new ScrapeManifestManager(manifestPath);
  await mgr.updateEntry(tsvPath, content, 1);

  let scrapeCalled = false;
  const result = await incrementalScrape({
    filePath: tsvPath,
    keyColumn: "id",
    scrapeFn: async () => {
      scrapeCalled = true;
      // Write same content — no actual change
      await fs.promises.writeFile(tsvPath, content, "utf8");
    },
    force: true,
    manifestPath,
    diffDir,
  });

  assert(result.skipped === false, "Scrape was not skipped with force");
  assert(scrapeCalled === true, "Scrape function was called");
}

async function testIncrementalScrapeDetectsDiff() {
  console.log("\n13. Incremental scrape detects diff between old and new");
  const tsvPath = tmpFile("diff-data.tsv");
  const manifestPath = tmpFile("manifest7.json");
  const diffDir = tmpFile("diffs4");

  // Write initial data
  await fs.promises.writeFile(tsvPath, "id\tname\n1\talpha\n2\tbeta\n", "utf8");

  const result = await incrementalScrape({
    filePath: tsvPath,
    keyColumn: "id",
    scrapeFn: async () => {
      // Replace with updated data
      await fs.promises.writeFile(
        tsvPath,
        "id\tname\n1\talpha\n2\tbeta-updated\n3\tgamma\n",
        "utf8"
      );
    },
    force: true,
    manifestPath,
    diffDir,
  });

  assert(result.diff!.added === 1, "1 row added");
  assert(result.diff!.modified === 1, "1 row modified");
  assert(result.diff!.unchanged === 1, "1 row unchanged");
}

// --- listDiffs tests ---

async function testListDiffs() {
  console.log("\n14. listDiffs returns saved diffs");
  const tsvPath = tmpFile("list-data.tsv");
  const manifestPath = tmpFile("manifest8.json");
  const diffDir = tmpFile("diffs5");

  // First scrape
  const result = await incrementalScrape({
    filePath: tsvPath,
    keyColumn: "id",
    scrapeFn: async () => {
      await fs.promises.writeFile(tsvPath, "id\tname\n1\talpha\n", "utf8");
    },
    force: true,
    manifestPath,
    diffDir,
  });

  assert(result.diff!.added === 1, "First scrape added 1 row");

  const diffs = await listDiffs(tsvPath, diffDir);
  assert(diffs.length === 1, `Found 1 diff file (got ${diffs.length})`);
  assert(diffs[0].added === 1, "Diff file has correct added count");
}

// --- Run all tests ---

async function main() {
  console.log("=== Testing Incremental Scraper with Diff Detection ===");

  await cleanup();

  try {
    await testDiffDetectsAddedRows();
    await testDiffDetectsRemovedRows();
    await testDiffDetectsModifiedRows();
    await testDiffHandlesEmptyOld();
    await testDiffHandlesEmptyNew();
    await testDiffIdentical();
    await testManifestSaveAndLoad();
    await testManifestHasChanged();
    await testManifestMissingFile();
    await testIncrementalScrapeNewFile();
    await testIncrementalScrapeSkipsUnchanged();
    await testIncrementalScrapeForceOverridesSkip();
    await testIncrementalScrapeDetectsDiff();
    await testListDiffs();
  } finally {
    // Cleanup temp files
    await fs.promises.rm(TMP_DIR, { recursive: true, force: true });
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
