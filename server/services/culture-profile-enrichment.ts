import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import fs from "node:fs";
import path from "node:path";

const BATCH_DELAY_MS = 1500;
const DEFAULT_ENTRIES_PER_DOMAIN = 8;

/**
 * Where the enrichment run reads and **appends** its lexicon rows.
 *
 * Resolved lazily (not a module-scope const) so a test can point the whole service at a
 * throwaway directory via `PINAKES_LEXICONS_DIR`. This service is the only one that writes
 * into `lexicons/` in place, and its spec used to snapshot + restore the REAL corpus around
 * every case — one interrupted run was enough to leave generated "Test Law" rows committed
 * in `lexicons/daily-life.tsv`. Never point this at the live corpus from a test.
 */
function lexiconsDir(): string {
  return process.env.PINAKES_LEXICONS_DIR || "lexicons";
}

export type EnrichmentDomain = "daily-life" | "social-structures" | "city-layouts";

const DOMAIN_CONFIG: Record<
  EnrichmentDomain,
  { filename: string; idPrefix: string; focus: string }
> = {
  "daily-life": {
    filename: "daily-life.tsv",
    idPrefix: "dl",
    focus:
      "quotidian cultural details spanning categories such as housing, clothing, diet, occupation, social customs, education, commerce, law, recreation, hygiene, transportation, and timekeeping",
  },
  "social-structures": {
    filename: "social-structures.tsv",
    idPrefix: "ss",
    focus:
      "governance, class hierarchy, family structure, gender roles, age grades, guilds and associations, military organization, religious hierarchy, legal systems, and education systems",
  },
  "city-layouts": {
    filename: "city-layouts.tsv",
    idPrefix: "cl",
    focus:
      "urban planning and spatial organization of notable settlements (layout type, key features, street patterns, water management, fortifications)",
  },
};

export interface CultureEnrichmentJobStatus {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  profileIds: string[];
  domains: EnrichmentDomain[];
  entriesPerDomain: number;
  totalNewRows: number;
  completedProfiles: number;
  totalProfiles: number;
  errors: string[];
  startedAt: string | null;
  completedAt: string | null;
  progressMessages: string[];
}

function parseTsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = (lines.shift() ?? "").split("\t");
  const rows = lines.map((l) => l.split("\t"));
  return { header, rows };
}

function readLexiconFile(filename: string): { header: string[]; rows: string[][]; path: string } {
  const filePath = path.join(lexiconsDir(), filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Lexicon file not found: ${filePath}`);
  }
  const text = fs.readFileSync(filePath, "utf8");
  const parsed = parseTsv(text);
  return { header: parsed.header, rows: parsed.rows, path: filePath };
}

function readCultureProfile(
  profileId: string
): { id: string; name: string; region: string; summary: string; timeStart: string; timeEnd: string } | null {
  const { header, rows } = readLexiconFile("culture-profiles.tsv");
  const idIdx = header.indexOf("id");
  const nameIdx = header.indexOf("name");
  const regionIdx = header.indexOf("region");
  const summaryIdx = header.indexOf("summary_description");
  const startIdx = header.indexOf("time_period_start");
  const endIdx = header.indexOf("time_period_end");

  const row = rows.find((r) => r[idIdx] === profileId);
  if (!row) return null;
  return {
    id: row[idIdx] ?? "",
    name: row[nameIdx] ?? "",
    region: regionIdx >= 0 ? row[regionIdx] ?? "" : "",
    summary: summaryIdx >= 0 ? row[summaryIdx] ?? "" : "",
    timeStart: startIdx >= 0 ? row[startIdx] ?? "" : "",
    timeEnd: endIdx >= 0 ? row[endIdx] ?? "" : "",
  };
}

function nextIdNumber(existingIds: string[], prefix: string): number {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const id of existingIds) {
    const m = id.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  return max + 1;
}

function formatSequentialId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, "0")}`;
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

function buildPrompt(
  domain: EnrichmentDomain,
  profile: { id: string; name: string; region: string; summary: string; timeStart: string; timeEnd: string },
  headers: string[],
  existingTitles: string[],
  entriesToGenerate: number
): string {
  const config = DOMAIN_CONFIG[domain];
  const existingList = existingTitles.slice(0, 40).join(", ") || "(none yet)";

  return `You are a rigorous historian generating data for the "${domain}" dataset about a specific culture. Each entry must be historically accurate and cite academic or primary sources.

CULTURE PROFILE:
- id: ${profile.id}
- name: ${profile.name}
- region: ${profile.region}
- time period: ${profile.timeStart} to ${profile.timeEnd}
- summary: ${profile.summary}

DOMAIN FOCUS:
${config.focus}

TSV COLUMNS (tab-separated, exact order):
${headers.join("\t")}

EXISTING ENTRIES FOR THIS CULTURE (do NOT duplicate titles or topics):
${existingList}

RULES:
- Generate exactly ${entriesToGenerate} NEW entries specific to "${profile.name}"
- The culture_profile_id column MUST equal "${profile.id}" for every entry
- Leave the "id" column BLANK (empty string) — IDs will be assigned automatically
- Sources column must contain a real academic citation (e.g., "Kramer 1963" or "Crawford, Harriet. Sumer and the Sumerians")
- For pipe-separated list columns (like key_roles, key_features) use "|" as the separator
- Use enum values exactly as they appear in controlled-vocabulary columns
- Integer year columns use negative numbers for BCE (e.g., -500)
- Ensure each entry covers a DIFFERENT topic from the existing ones and from each other
- Cross-reference the culture's time period, region, and summary to stay historically consistent`;
}

interface GeneratedEntry {
  [column: string]: string;
}

async function callGemini(prompt: string, headers: string[]): Promise<GeneratedEntry[]> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable is required");
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const modelName = process.env.GEMINI_MODEL || "gemini-3-pro-preview";

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
    throw new Error("Gemini response missing 'entries' array");
  }
  return parsed.entries;
}

function entriesToRows(
  entries: GeneratedEntry[],
  headers: string[],
  idPrefix: string,
  startingIdNumber: number,
  cultureProfileId: string,
  existingIds: Set<string>
): string[][] {
  const rows: string[][] = [];
  const cultureIdx = headers.indexOf("culture_profile_id");
  const idIdx = headers.indexOf("id");
  let next = startingIdNumber;

  for (const entry of entries) {
    const row = headers.map((h) => {
      const val = entry[h];
      if (val === null || val === undefined) return "";
      if (typeof val === "object") return JSON.stringify(val);
      return String(val);
    });

    if (cultureIdx >= 0) row[cultureIdx] = cultureProfileId;

    if (idIdx >= 0) {
      let candidate = formatSequentialId(idPrefix, next);
      while (existingIds.has(candidate)) {
        next++;
        candidate = formatSequentialId(idPrefix, next);
      }
      row[idIdx] = candidate;
      existingIds.add(candidate);
      next++;
    }

    rows.push(row);
  }

  return rows;
}

function appendRowsToTsv(filePath: string, headers: string[], newRows: string[][]): void {
  if (newRows.length === 0) return;
  const lines = newRows.map((row) => headers.map((_, i) => row[i] ?? "").join("\t"));
  const existing = fs.readFileSync(filePath, "utf8");
  const prefix = existing.endsWith("\n") ? "" : "\n";
  fs.appendFileSync(filePath, prefix + lines.join("\n") + "\n", "utf8");
}

const cultureEnrichmentJobs = new Map<string, CultureEnrichmentJobStatus>();

export function getCultureEnrichmentJob(jobId: string): CultureEnrichmentJobStatus | undefined {
  return cultureEnrichmentJobs.get(jobId);
}

export function getAllCultureEnrichmentJobs(): CultureEnrichmentJobStatus[] {
  return Array.from(cultureEnrichmentJobs.values()).sort((a, b) =>
    (b.startedAt ?? "").localeCompare(a.startedAt ?? "")
  );
}

export function listCultureProfileIds(): string[] {
  try {
    const { header, rows } = readLexiconFile("culture-profiles.tsv");
    const idIdx = header.indexOf("id");
    if (idIdx < 0) return [];
    return rows.map((r) => r[idIdx]).filter(Boolean);
  } catch {
    return [];
  }
}

export async function runCultureProfileEnrichment(options: {
  profileIds?: string[];
  domains?: EnrichmentDomain[];
  entriesPerDomain?: number;
  onProgress?: (msg: string) => void;
}): Promise<CultureEnrichmentJobStatus> {
  const domains: EnrichmentDomain[] =
    options.domains && options.domains.length > 0
      ? options.domains
      : (["daily-life", "social-structures", "city-layouts"] as EnrichmentDomain[]);
  const entriesPerDomain = options.entriesPerDomain ?? DEFAULT_ENTRIES_PER_DOMAIN;
  const onProgress = options.onProgress;

  const profileIds =
    options.profileIds && options.profileIds.length > 0
      ? options.profileIds
      : listCultureProfileIds();

  const jobId = `culture_enrich_${Date.now()}`;
  const job: CultureEnrichmentJobStatus = {
    id: jobId,
    status: "pending",
    profileIds,
    domains,
    entriesPerDomain,
    totalNewRows: 0,
    completedProfiles: 0,
    totalProfiles: profileIds.length,
    errors: [],
    startedAt: null,
    completedAt: null,
    progressMessages: [],
  };
  cultureEnrichmentJobs.set(jobId, job);

  const recordProgress = (msg: string) => {
    job.progressMessages.push(msg);
    onProgress?.(msg);
  };

  if (!process.env.GEMINI_API_KEY) {
    job.errors.push("GEMINI_API_KEY environment variable is required");
    job.status = "failed";
    job.completedAt = new Date().toISOString();
    cultureEnrichmentJobs.set(jobId, { ...job });
    return job;
  }

  if (profileIds.length === 0) {
    job.errors.push("No culture profiles to enrich");
    job.status = "failed";
    job.completedAt = new Date().toISOString();
    cultureEnrichmentJobs.set(jobId, { ...job });
    return job;
  }

  job.status = "running";
  job.startedAt = new Date().toISOString();
  cultureEnrichmentJobs.set(jobId, { ...job });

  recordProgress(
    `Starting culture profile enrichment for ${profileIds.length} profile(s) across ${domains.length} domain(s)`
  );

  const domainState = new Map<
    EnrichmentDomain,
    { header: string[]; existingRows: string[][]; path: string; existingIds: Set<string>; nextIdNum: number }
  >();

  for (const domain of domains) {
    try {
      const config = DOMAIN_CONFIG[domain];
      const { header, rows, path: filePath } = readLexiconFile(config.filename);
      const existingIds = new Set(rows.map((r) => r[header.indexOf("id")]).filter(Boolean));
      const startNum = nextIdNumber(Array.from(existingIds), config.idPrefix);
      domainState.set(domain, {
        header,
        existingRows: rows,
        path: filePath,
        existingIds,
        nextIdNum: startNum,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      job.errors.push(`Failed to load ${domain}: ${msg}`);
      recordProgress(`Failed to load ${domain}: ${msg}`);
    }
  }

  for (const profileId of profileIds) {
    const profile = readCultureProfile(profileId);
    if (!profile) {
      job.errors.push(`Culture profile not found: ${profileId}`);
      recordProgress(`Culture profile not found: ${profileId}`);
      job.completedProfiles++;
      cultureEnrichmentJobs.set(jobId, { ...job });
      continue;
    }

    recordProgress(`Enriching ${profile.name} (${profile.id})...`);

    for (const domain of domains) {
      const state = domainState.get(domain);
      if (!state) continue;

      const config = DOMAIN_CONFIG[domain];
      const cultureIdx = state.header.indexOf("culture_profile_id");
      const titleIdx = state.header.indexOf("title") >= 0
        ? state.header.indexOf("title")
        : state.header.indexOf("name") >= 0
          ? state.header.indexOf("name")
          : state.header.indexOf("description");

      const existingForCulture = state.existingRows
        .filter((r) => cultureIdx >= 0 && r[cultureIdx] === profileId)
        .map((r) => (titleIdx >= 0 ? r[titleIdx] ?? "" : ""))
        .filter(Boolean);

      try {
        const prompt = buildPrompt(
          domain,
          profile,
          state.header,
          existingForCulture,
          entriesPerDomain
        );

        const entries = await callGemini(prompt, state.header);
        const newRows = entriesToRows(
          entries,
          state.header,
          config.idPrefix,
          state.nextIdNum,
          profileId,
          state.existingIds
        );

        if (newRows.length > 0) {
          appendRowsToTsv(state.path, state.header, newRows);
          state.existingRows.push(...newRows);
          state.nextIdNum += newRows.length;
          job.totalNewRows += newRows.length;
          recordProgress(
            `${profile.name}: added ${newRows.length} ${domain} entries`
          );
        } else {
          recordProgress(`${profile.name}: no new ${domain} entries generated`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        job.errors.push(`${profileId}/${domain}: ${msg}`);
        recordProgress(`${profile.name}/${domain} failed: ${msg}`);
      }

      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }

    job.completedProfiles++;
    cultureEnrichmentJobs.set(jobId, { ...job });
  }

  job.status = job.totalNewRows === 0 && job.errors.length > 0 ? "failed" : "completed";
  job.completedAt = new Date().toISOString();
  cultureEnrichmentJobs.set(jobId, { ...job });

  recordProgress(
    `Culture enrichment complete: ${job.totalNewRows} new rows across ${job.completedProfiles}/${job.totalProfiles} profiles`
  );

  return job;
}
