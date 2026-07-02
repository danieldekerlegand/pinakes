import fs from "node:fs";
import path from "node:path";

export interface DatasetFreshness {
  name: string;
  file: string;
  recordCount: number;
  sizeBytes: number;
  lastModified: string;
  ageMs: number;
  ageDays: number;
  staleness: "fresh" | "aging" | "stale";
}

export interface FreshnessSummary {
  datasets: DatasetFreshness[];
  totalDatasets: number;
  totalRecords: number;
  totalSizeBytes: number;
  freshCount: number;
  agingCount: number;
  staleCount: number;
  oldestDataset: string | null;
  newestDataset: string | null;
  generatedAt: string;
}

export interface FreshnessThresholds {
  freshDays: number;
  agingDays: number;
}

const DEFAULT_THRESHOLDS: FreshnessThresholds = {
  freshDays: 7,
  agingDays: 30,
};

function classifyStaleness(
  ageDays: number,
  thresholds: FreshnessThresholds,
): "fresh" | "aging" | "stale" {
  if (ageDays <= thresholds.freshDays) return "fresh";
  if (ageDays <= thresholds.agingDays) return "aging";
  return "stale";
}

function countRecords(filePath: string): number {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim().length > 0);
    // Subtract 1 for the header row
    return Math.max(0, lines.length - 1);
  } catch {
    return 0;
  }
}

function humanName(filename: string): string {
  return filename
    .replace(/\.tsv$/, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function getDatasetFreshness(
  lexiconsDir: string,
  now: Date = new Date(),
  thresholds: FreshnessThresholds = DEFAULT_THRESHOLDS,
): DatasetFreshness[] {
  if (!fs.existsSync(lexiconsDir)) {
    return [];
  }

  const files = fs
    .readdirSync(lexiconsDir)
    .filter((f) => f.endsWith(".tsv"))
    .sort();

  return files.map((file) => {
    const filePath = path.join(lexiconsDir, file);
    const stat = fs.statSync(filePath);
    const ageMs = now.getTime() - stat.mtimeMs;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    return {
      name: humanName(file),
      file,
      recordCount: countRecords(filePath),
      sizeBytes: stat.size,
      lastModified: stat.mtime.toISOString(),
      ageMs,
      ageDays: Math.round(ageDays * 100) / 100,
      staleness: classifyStaleness(ageDays, thresholds),
    };
  });
}

export function getFreshnessSummary(
  lexiconsDir: string,
  now: Date = new Date(),
  thresholds: FreshnessThresholds = DEFAULT_THRESHOLDS,
): FreshnessSummary {
  const datasets = getDatasetFreshness(lexiconsDir, now, thresholds);

  const freshCount = datasets.filter((d) => d.staleness === "fresh").length;
  const agingCount = datasets.filter((d) => d.staleness === "aging").length;
  const staleCount = datasets.filter((d) => d.staleness === "stale").length;

  let oldestDataset: string | null = null;
  let newestDataset: string | null = null;

  if (datasets.length > 0) {
    const sorted = [...datasets].sort((a, b) => a.ageMs - b.ageMs);
    newestDataset = sorted[0].name;
    oldestDataset = sorted[sorted.length - 1].name;
  }

  return {
    datasets,
    totalDatasets: datasets.length,
    totalRecords: datasets.reduce((sum, d) => sum + d.recordCount, 0),
    totalSizeBytes: datasets.reduce((sum, d) => sum + d.sizeBytes, 0),
    freshCount,
    agingCount,
    staleCount,
    oldestDataset,
    newestDataset,
    generatedAt: now.toISOString(),
  };
}
