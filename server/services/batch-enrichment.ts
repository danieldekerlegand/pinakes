import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import fs from "node:fs";
import path from "node:path";

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 2000;
/**
 * The live corpus. Injectable on both entry points below (`lexiconsDir`) — enrichment
 * *writes* TSVs, and a test that writes into the real directory is visible to every other
 * test file reading it concurrently (`scripts/convergence-qa.ts` reads exactly this dir and
 * flags an unmapped `*.tsv` as drift). Keep the seam; point tests at a temp dir.
 */
const LEXICONS_DIR = "data/source/lexicons";

export interface TsvFileInfo {
  filename: string;
  path: string;
  headers: string[];
  rowCount: number;
  emptyFieldCounts: Record<string, number>;
  populationScore: number;
}

export interface EnrichmentTarget {
  filename: string;
  headers: string[];
  existingRows: string[][];
  rowCount: number;
  populationScore: number;
}

export interface EnrichmentJobStatus {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  targets: string[];
  totalNewRows: number;
  completedFiles: number;
  totalFiles: number;
  errors: string[];
  startedAt: string | null;
  completedAt: string | null;
}

function parseTsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = (lines.shift() ?? "").split("\t");
  const rows = lines.map((l) => l.split("\t"));
  return { header, rows };
}

function calculatePopulationScore(headers: string[], rows: string[][]): number {
  if (rows.length === 0) return 0;
  let filledCells = 0;
  const totalCells = rows.length * headers.length;
  for (const row of rows) {
    for (let i = 0; i < headers.length; i++) {
      const val = row[i]?.trim();
      if (val && val !== "null" && val !== "" && val !== "[]") {
        filledCells++;
      }
    }
  }
  return Math.round((filledCells / totalCells) * 100);
}

function countEmptyFields(headers: string[], rows: string[][]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const h of headers) counts[h] = 0;
  for (const row of rows) {
    for (let i = 0; i < headers.length; i++) {
      const val = row[i]?.trim();
      if (!val || val === "null" || val === "" || val === "[]") {
        counts[headers[i]]++;
      }
    }
  }
  return counts;
}

export function analyzeTsvFiles(
  minRowThreshold = 100,
  lexiconsDir: string = LEXICONS_DIR
): TsvFileInfo[] {
  const results: TsvFileInfo[] = [];

  if (!fs.existsSync(lexiconsDir)) return results;

  const files = fs.readdirSync(lexiconsDir).filter((f) => f.endsWith(".tsv"));

  for (const filename of files) {
    const filePath = path.join(lexiconsDir, filename);
    const text = fs.readFileSync(filePath, "utf8");
    const { header, rows } = parseTsv(text);

    if (rows.length < minRowThreshold) {
      results.push({
        filename,
        path: filePath,
        headers: header,
        rowCount: rows.length,
        emptyFieldCounts: countEmptyFields(header, rows),
        populationScore: calculatePopulationScore(header, rows),
      });
    }
  }

  return results.sort((a, b) => a.rowCount - b.rowCount);
}

function buildEnrichmentPrompt(
  filename: string,
  headers: string[],
  existingRows: string[][],
  batchNumber: number
): string {
  const domain = filename.replace(".tsv", "").replace(/-/g, " ");
  const existingNames = existingRows
    .map((r) => r[headers.indexOf("name") >= 0 ? headers.indexOf("name") : 1])
    .filter(Boolean)
    .slice(0, 30);

  const existingIds = existingRows
    .map((r) => r[0])
    .filter(Boolean);

  return `You are a historical and cultural research assistant. Generate ${BATCH_SIZE} NEW entries for a dataset about "${domain}".

TSV COLUMN FORMAT (tab-separated):
${headers.join("\t")}

EXISTING ENTRIES (do NOT duplicate these):
${existingNames.join(", ")}

EXISTING IDS (do NOT reuse):
${existingIds.join(", ")}

RULES:
- Generate exactly ${BATCH_SIZE} new, unique entries that DO NOT overlap with existing ones
- Each entry must be historically/culturally accurate
- Use kebab-case IDs (e.g., "greek-classical", "persian-miniature")
- For JSON array fields, use proper JSON arrays like ["item1","item2"]
- For coordinate fields, use JSON objects like {"lat":35.0,"lng":139.0}
- For null values, use the string "null"
- For date fields (time_origin, origin_date, etc.), use integer years (negative for BCE)
- Focus on diverse global coverage - include entries from Africa, Asia, Americas, Oceania, not just Europe
- This is batch ${batchNumber}, so pick entries that would make the dataset more comprehensive
- For language ID references, use ISO 639-2/3 codes or slugified names matching our languages.tsv format`;
}

function buildResponseSchema(headers: string[]) {
  const properties: Record<string, any> = {};

  for (const h of headers) {
    properties[h] = { type: SchemaType.STRING };
  }

  return {
    type: SchemaType.OBJECT as const,
    properties: {
      entries: {
        type: SchemaType.ARRAY as const,
        items: {
          type: SchemaType.OBJECT as const,
          properties,
          required: headers,
        },
      },
    },
    required: ["entries"],
  };
}

async function enrichSingleFile(
  filename: string,
  headers: string[],
  existingRows: string[][],
  batchCount: number,
  onProgress?: (msg: string) => void
): Promise<{ newRows: string[][]; errors: string[] }> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable is required");
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

  const allNewRows: string[][] = [];
  const errors: string[] = [];
  let currentRows = [...existingRows];

  for (let batch = 0; batch < batchCount; batch++) {
    const prompt = buildEnrichmentPrompt(filename, headers, currentRows, batch + 1);

    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: buildResponseSchema(headers),
        },
      });

      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = JSON.parse(text);

      if (!parsed?.entries || !Array.isArray(parsed.entries)) {
        errors.push(`Batch ${batch + 1}: Invalid response structure`);
        continue;
      }

      const existingIds = new Set(currentRows.map((r) => r[0]));

      for (const entry of parsed.entries) {
        const row = headers.map((h) => {
          const val = entry[h];
          if (val === null || val === undefined) return "";
          if (typeof val === "object") return JSON.stringify(val);
          return String(val);
        });

        if (!existingIds.has(row[0])) {
          allNewRows.push(row);
          currentRows.push(row);
          existingIds.add(row[0]);
        }
      }

      onProgress?.(
        `${filename}: batch ${batch + 1}/${batchCount} complete, ${allNewRows.length} new rows`
      );

      if (batch < batchCount - 1) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      errors.push(`Batch ${batch + 1}: ${msg}`);
      onProgress?.(`${filename}: batch ${batch + 1} failed: ${msg}`);
    }
  }

  return { newRows: allNewRows, errors };
}

function appendRowsToTsv(filePath: string, headers: string[], newRows: string[][]): void {
  if (newRows.length === 0) return;

  const lines = newRows.map((row) =>
    headers.map((_, i) => row[i] ?? "").join("\t")
  );
  const content = "\n" + lines.join("\n");

  fs.appendFileSync(filePath, content, "utf8");
}

// In-memory job tracking
const enrichmentJobs = new Map<string, EnrichmentJobStatus>();

export function getEnrichmentJob(jobId: string): EnrichmentJobStatus | undefined {
  return enrichmentJobs.get(jobId);
}

export function getAllEnrichmentJobs(): EnrichmentJobStatus[] {
  return Array.from(enrichmentJobs.values()).sort(
    (a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")
  );
}

export async function runBatchEnrichment(options: {
  targetFiles?: string[];
  maxRowThreshold?: number;
  batchesPerFile?: number;
  onProgress?: (msg: string) => void;
  lexiconsDir?: string;
}): Promise<EnrichmentJobStatus> {
  const {
    targetFiles,
    maxRowThreshold = 50,
    batchesPerFile = 4,
    onProgress,
    lexiconsDir = LEXICONS_DIR,
  } = options;

  const jobId = `enrich_${Date.now()}`;
  const job: EnrichmentJobStatus = {
    id: jobId,
    status: "pending",
    targets: [],
    totalNewRows: 0,
    completedFiles: 0,
    totalFiles: 0,
    errors: [],
    startedAt: null,
    completedAt: null,
  };
  enrichmentJobs.set(jobId, job);

  // Determine which files to enrich
  let filesToEnrich: EnrichmentTarget[] = [];

  if (targetFiles && targetFiles.length > 0) {
    for (const filename of targetFiles) {
      const filePath = path.join(lexiconsDir, filename);
      if (!fs.existsSync(filePath)) {
        job.errors.push(`File not found: ${filename}`);
        continue;
      }
      const text = fs.readFileSync(filePath, "utf8");
      const { header, rows } = parseTsv(text);
      filesToEnrich.push({
        filename,
        headers: header,
        existingRows: rows,
        rowCount: rows.length,
        populationScore: calculatePopulationScore(header, rows),
      });
    }
  } else {
    const analysis = analyzeTsvFiles(maxRowThreshold, lexiconsDir);
    filesToEnrich = analysis.map((info) => {
      const text = fs.readFileSync(info.path, "utf8");
      const { header, rows } = parseTsv(text);
      return {
        filename: info.filename,
        headers: header,
        existingRows: rows,
        rowCount: info.rowCount,
        populationScore: info.populationScore,
      };
    });
  }

  job.targets = filesToEnrich.map((f) => f.filename);
  job.totalFiles = filesToEnrich.length;
  job.status = "running";
  job.startedAt = new Date().toISOString();
  enrichmentJobs.set(jobId, { ...job });

  onProgress?.(`Starting enrichment for ${filesToEnrich.length} files`);

  for (const target of filesToEnrich) {
    try {
      onProgress?.(`Enriching ${target.filename} (${target.rowCount} existing rows)...`);

      const { newRows, errors } = await enrichSingleFile(
        target.filename,
        target.headers,
        target.existingRows,
        batchesPerFile,
        onProgress
      );

      if (newRows.length > 0) {
        const filePath = path.join(lexiconsDir, target.filename);
        appendRowsToTsv(filePath, target.headers, newRows);
        onProgress?.(`Wrote ${newRows.length} new rows to ${target.filename}`);
      }

      job.totalNewRows += newRows.length;
      job.errors.push(...errors);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      job.errors.push(`${target.filename}: ${msg}`);
      onProgress?.(`Failed to enrich ${target.filename}: ${msg}`);
    }

    job.completedFiles++;
    enrichmentJobs.set(jobId, { ...job });
  }

  job.status = job.errors.length > 0 && job.totalNewRows === 0 ? "failed" : "completed";
  job.completedAt = new Date().toISOString();
  enrichmentJobs.set(jobId, { ...job });

  onProgress?.(
    `Enrichment complete: ${job.totalNewRows} new rows across ${job.completedFiles} files`
  );

  return job;
}
