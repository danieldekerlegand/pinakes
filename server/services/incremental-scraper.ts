import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** A single row difference between old and new TSV data */
export type RowDiff = {
  type: "added" | "removed" | "modified";
  key: string;
  oldRow?: Record<string, string>;
  newRow?: Record<string, string>;
  changedFields?: string[];
};

/** Summary of differences between two versions of a TSV file */
export type TsvDiffResult = {
  file: string;
  timestamp: string;
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
  rows: RowDiff[];
};

/** Manifest entry tracking the last scrape state of a TSV file */
export type ScrapeManifestEntry = {
  file: string;
  lastScrapedAt: string;
  contentHash: string;
  rowCount: number;
};

/** Full scrape manifest */
export type ScrapeManifest = {
  version: 1;
  entries: Record<string, ScrapeManifestEntry>;
};

// --- TSV Parsing ---

function parseTsvRows(content: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = content.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = lines[0].split("\t");
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cols[j] ?? "";
    }
    rows.push(row);
  }

  return { headers, rows };
}

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

// --- Diff Detection ---

/**
 * Compare two TSV data sets, keyed by a primary column.
 * Returns a diff describing added, removed, and modified rows.
 */
export function diffTsv(
  oldContent: string,
  newContent: string,
  keyColumn: string,
  filePath: string = ""
): TsvDiffResult {
  const oldParsed = parseTsvRows(oldContent);
  const newParsed = parseTsvRows(newContent);

  const oldMap = new Map<string, Record<string, string>>();
  for (const row of oldParsed.rows) {
    const key = row[keyColumn];
    if (key) oldMap.set(key, row);
  }

  const newMap = new Map<string, Record<string, string>>();
  for (const row of newParsed.rows) {
    const key = row[keyColumn];
    if (key) newMap.set(key, row);
  }

  const diffs: RowDiff[] = [];
  let added = 0;
  let removed = 0;
  let modified = 0;
  let unchanged = 0;

  // Check for added and modified rows
  for (const [key, newRow] of newMap) {
    const oldRow = oldMap.get(key);
    if (!oldRow) {
      diffs.push({ type: "added", key, newRow });
      added++;
    } else {
      const changedFields: string[] = [];
      for (const field of new Set([...Object.keys(oldRow), ...Object.keys(newRow)])) {
        if ((oldRow[field] ?? "") !== (newRow[field] ?? "")) {
          changedFields.push(field);
        }
      }
      if (changedFields.length > 0) {
        diffs.push({ type: "modified", key, oldRow, newRow, changedFields });
        modified++;
      } else {
        unchanged++;
      }
    }
  }

  // Check for removed rows
  for (const [key, oldRow] of oldMap) {
    if (!newMap.has(key)) {
      diffs.push({ type: "removed", key, oldRow });
      removed++;
    }
  }

  return {
    file: filePath,
    timestamp: new Date().toISOString(),
    added,
    removed,
    modified,
    unchanged,
    rows: diffs,
  };
}

// --- Scrape Manifest ---

const DEFAULT_MANIFEST_PATH = "data/source/lexicons/.scrape-manifest.json";

export class ScrapeManifestManager {
  private manifestPath: string;

  constructor(manifestPath: string = DEFAULT_MANIFEST_PATH) {
    this.manifestPath = manifestPath;
  }

  async load(): Promise<ScrapeManifest> {
    try {
      const content = await fs.promises.readFile(this.manifestPath, "utf8");
      return JSON.parse(content) as ScrapeManifest;
    } catch {
      return { version: 1, entries: {} };
    }
  }

  async save(manifest: ScrapeManifest): Promise<void> {
    const dir = path.dirname(this.manifestPath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      this.manifestPath,
      JSON.stringify(manifest, null, 2),
      "utf8"
    );
  }

  async updateEntry(file: string, content: string, rowCount: number): Promise<void> {
    const manifest = await this.load();
    manifest.entries[file] = {
      file,
      lastScrapedAt: new Date().toISOString(),
      contentHash: hashContent(content),
      rowCount,
    };
    await this.save(manifest);
  }

  async getEntry(file: string): Promise<ScrapeManifestEntry | undefined> {
    const manifest = await this.load();
    return manifest.entries[file];
  }

  /**
   * Check if a file has changed since last scrape by comparing content hashes.
   * Returns true if the file is new or has changed.
   */
  async hasChanged(filePath: string): Promise<boolean> {
    const entry = await this.getEntry(filePath);
    if (!entry) return true;

    try {
      const content = await fs.promises.readFile(filePath, "utf8");
      return hashContent(content) !== entry.contentHash;
    } catch {
      return true;
    }
  }
}

// --- Incremental Scraper ---

const DEFAULT_DIFF_DIR = "data/source/lexicons/.diffs";

export type IncrementalScrapeResult = {
  file: string;
  skipped: boolean;
  reason?: string;
  diff?: TsvDiffResult;
};

/**
 * Performs an incremental scrape of a TSV file:
 * 1. Snapshots the existing file
 * 2. Runs the provided scrape function (which writes new data)
 * 3. Diffs old vs new
 * 4. Saves the diff and updates the manifest
 *
 * If the file hasn't changed since last manifest entry and `force` is false, the scrape is skipped.
 */
export async function incrementalScrape(options: {
  filePath: string;
  keyColumn: string;
  scrapeFn: () => Promise<void>;
  force?: boolean;
  manifestPath?: string;
  diffDir?: string;
}): Promise<IncrementalScrapeResult> {
  const {
    filePath,
    keyColumn,
    scrapeFn,
    force = false,
    manifestPath,
    diffDir = DEFAULT_DIFF_DIR,
  } = options;

  const manifest = new ScrapeManifestManager(manifestPath);

  // Check if scrape is needed
  if (!force) {
    const entry = await manifest.getEntry(filePath);
    if (entry) {
      try {
        const currentContent = await fs.promises.readFile(filePath, "utf8");
        if (hashContent(currentContent) === entry.contentHash) {
          return {
            file: filePath,
            skipped: true,
            reason: `No external changes since last scrape at ${entry.lastScrapedAt}`,
          };
        }
      } catch {
        // File doesn't exist yet — proceed with scrape
      }
    }
  }

  // Snapshot existing content
  let oldContent = "";
  try {
    oldContent = await fs.promises.readFile(filePath, "utf8");
  } catch {
    // File doesn't exist yet
  }

  // Run the scrape
  await scrapeFn();

  // Read new content
  let newContent = "";
  try {
    newContent = await fs.promises.readFile(filePath, "utf8");
  } catch {
    return {
      file: filePath,
      skipped: false,
      reason: "Scrape completed but file was not created",
    };
  }

  // Compute diff
  const diff = diffTsv(oldContent, newContent, keyColumn, filePath);

  // Save diff to file if there were changes
  if (diff.added > 0 || diff.removed > 0 || diff.modified > 0) {
    await saveDiff(diff, diffDir);
  }

  // Update manifest
  const parsed = parseTsvRows(newContent);
  await manifest.updateEntry(filePath, newContent, parsed.rows.length);

  return { file: filePath, skipped: false, diff };
}

async function saveDiff(diff: TsvDiffResult, diffDir: string): Promise<string> {
  await fs.promises.mkdir(diffDir, { recursive: true });

  const basename = path.basename(diff.file, ".tsv");
  const ts = diff.timestamp.replace(/[:.]/g, "-");
  const diffFile = path.join(diffDir, `${basename}_${ts}.json`);

  await fs.promises.writeFile(diffFile, JSON.stringify(diff, null, 2), "utf8");
  return diffFile;
}

/**
 * List recent diffs for a TSV file.
 */
export async function listDiffs(
  tsvFile: string,
  diffDir: string = DEFAULT_DIFF_DIR,
  limit: number = 10
): Promise<TsvDiffResult[]> {
  const basename = path.basename(tsvFile, ".tsv");

  try {
    const files = await fs.promises.readdir(diffDir);
    const matching = files
      .filter((f) => f.startsWith(`${basename}_`) && f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, limit);

    const results: TsvDiffResult[] = [];
    for (const f of matching) {
      const content = await fs.promises.readFile(path.join(diffDir, f), "utf8");
      results.push(JSON.parse(content));
    }
    return results;
  } catch {
    return [];
  }
}
