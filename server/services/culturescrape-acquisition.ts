/**
 * culture-scrape Wikidata bulk-acquisition orchestration (US-005).
 *
 * pinakes triggers large-scale Wikidata ingestion from the scraper
 * dashboard, but the actual SPARQL set-acquisition is **culture-scrape's** job —
 * we never grow a second TS SPARQL client (single-entity URL extraction in
 * `url-extractor.ts` uses the REST `Special:EntityData` endpoint; bulk queries go
 * to the vendored Python engine, see `docs/culturescrape-integration.md`).
 *
 * The flow:
 *   1. A domain (civilizations / sites / figures / trade goods) maps to an
 *      {@link AcquisitionCategory} — a Wikidata class + the contribution bucket
 *      acquired records are filed under.
 *   2. A {@link CultureScrapeJobRunner} runs the culture-scrape `fetch` command
 *      for that category and returns the raw records + run report. The live
 *      runner (`liveJobRunner`) writes a culture-scrape category spec to a temp
 *      file and spawns `python -m culturescrape.cli fetch <spec> --out <dir>`;
 *      tests inject a fake runner with recorded records (no Python, no network).
 *   3. {@link runAcquisitionJob} maps each record → a `Partial<Contribution>`
 *      (carrying Wikidata provenance) and enqueues it in the **contribution
 *      review queue** — nothing enters the live dataset unverified (US-009
 *      promotes them). Progress is streamed to the caller via `onProgress`.
 *
 * Everything except the live runner is pure/injectable so the whole pipeline is
 * unit-testable without a subprocess.
 */

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import type {
  Contribution,
  ContributionEntityType,
  ContributionService,
} from "./contribution-service";

// ── Domains & catalog ────────────────────────────────────────────────────────

export type AcquisitionDomain =
  | "civilizations"
  | "sites"
  | "figures"
  | "trade-goods";

export interface AcquisitionCategory {
  /** Stable domain key used by the API + dashboard. */
  domain: AcquisitionDomain;
  /** culture-scrape category id (== the on-disk spec filename stem). */
  id: string;
  /** Human label shown in the dashboard. */
  label: string;
  description: string;
  /** Wikidata class QID selected by `wdt:P31`. */
  wikidataClass: string;
  /** culture-scrape node label for the generated category spec. */
  nodeLabel: string;
  /** Whether the SPARQL binds coordinates (`wdt:P625`) — sites require them. */
  requireCoordinates: boolean;
  /** pinakes contribution bucket acquired records are filed under. */
  entityType: ContributionEntityType;
}

export const ACQUISITION_CATALOG: Record<AcquisitionDomain, AcquisitionCategory> = {
  civilizations: {
    domain: "civilizations",
    id: "wikidata-civilizations",
    label: "Civilizations",
    description: "Ancient civilizations and cultures (Wikidata P31 → Q11772).",
    wikidataClass: "Q11772",
    nodeLabel: "Concept;CulturalArtifact",
    requireCoordinates: false,
    entityType: "civilization",
  },
  sites: {
    domain: "sites",
    id: "wikidata-archaeological-sites",
    label: "Archaeological sites",
    description: "Archaeological sites with coordinates (Wikidata P31 → Q839954).",
    wikidataClass: "Q839954",
    nodeLabel: "Building;CulturalArtifact",
    requireCoordinates: true,
    entityType: "archaeological-site",
  },
  figures: {
    domain: "figures",
    id: "wikidata-historical-figures",
    label: "Historical & legendary figures",
    description: "Legendary and historical figures (Wikidata P31 → Q13002315).",
    wikidataClass: "Q13002315",
    nodeLabel: "Concept;CulturalArtifact",
    requireCoordinates: false,
    entityType: "historical-figure",
  },
  "trade-goods": {
    domain: "trade-goods",
    id: "wikidata-trade-goods",
    label: "Trade goods",
    description: "Trade goods and commodities (Wikidata P31 → Q28877).",
    wikidataClass: "Q28877",
    nodeLabel: "CulturalArtifact",
    requireCoordinates: false,
    entityType: "trade-good",
  },
};

export function listAcquisitionCategories(): AcquisitionCategory[] {
  return Object.values(ACQUISITION_CATALOG);
}

export function resolveAcquisitionCategory(
  domain: string | undefined,
): AcquisitionCategory | undefined {
  if (!domain) return undefined;
  return (ACQUISITION_CATALOG as Record<string, AcquisitionCategory>)[domain];
}

// ── Category-spec generation (handed to culture-scrape, not executed here) ─────

/**
 * Build the SPARQL query for a category. Coordinates are a bound triple for
 * coordinate-required domains (so every returned row has them) and OPTIONAL
 * otherwise. An optional `LIMIT` bounds a dashboard-triggered run.
 */
export function buildAcquisitionQuery(
  category: AcquisitionCategory,
  limit?: number,
): string {
  const coordLine = category.requireCoordinates
    ? "  ?item wdt:P625 ?coord ."
    : "  OPTIONAL { ?item wdt:P625 ?coord . }";
  const lines = [
    "SELECT ?item ?itemLabel ?image ?coord WHERE {",
    `  ?item wdt:P31 wd:${category.wikidataClass} .`,
    coordLine,
    "  OPTIONAL { ?item wdt:P18 ?image . }",
    '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }',
    "}",
  ];
  if (limit !== undefined && Number.isFinite(limit) && limit > 0) {
    lines.push(`LIMIT ${Math.floor(limit)}`);
  }
  return lines.join("\n");
}

/**
 * Serialize a culture-scrape category spec (matching the shipped
 * `core/inputs/categories/*.yml` shape) for `culturescrape fetch`.
 */
export function buildCategorySpecYaml(
  category: AcquisitionCategory,
  limit?: number,
): string {
  const query = buildAcquisitionQuery(category, limit);
  const indentedQuery = query
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  return (
    [
      `id: ${category.id}`,
      `label: ${category.nodeLabel}`,
      `description: ${category.description}`,
      "source:",
      "  type: wikidata-sparql",
      "  query: |",
      indentedQuery,
      "dimensions:",
      "- temporal",
      "- geographic",
    ].join("\n") + "\n"
  );
}

// ── Raw record parsing (the culture-scrape `.jsonl` acquisition output) ────────

export interface RawRecordProvenance {
  source: string;
  source_url: string;
  source_query: string;
  retrieved_at: string;
  confidence: number;
  license?: string | null;
}

export interface RawRecord {
  fields: Record<string, string>;
  provenance: RawRecordProvenance;
}

function isRawRecord(value: unknown): value is RawRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { fields?: unknown; provenance?: unknown };
  return (
    typeof record.fields === "object" &&
    record.fields !== null &&
    typeof record.provenance === "object" &&
    record.provenance !== null
  );
}

/** Parse a culture-scrape `.jsonl` payload into records, skipping blank/garbage lines. */
export function parseRawRecords(jsonl: string): RawRecord[] {
  const out: RawRecord[] = [];
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (isRawRecord(parsed)) out.push(parsed);
  }
  return out;
}

/** Parse a Wikidata WKT point (`Point(lng lat)`) into `{lat,lng}`, or null. */
export function parseWktPoint(
  value: string | undefined,
): { lat: number; lng: number } | null {
  if (!value) return null;
  const match = /^\s*Point\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)\s*$/i.exec(
    value,
  );
  if (!match) return null;
  const lng = Number(match[1]);
  const lat = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Clamp a 0..1 provenance confidence to a 1..99 contribution score (< 100 ⇒ needs review). */
function toContributionConfidence(confidence01: number): number {
  const value = Number.isFinite(confidence01) ? confidence01 : 1;
  return Math.max(1, Math.min(99, Math.round(value * 100)));
}

/**
 * Map one acquired Wikidata record → a `Partial<Contribution>` carrying its
 * provenance, or `null` when the row is unusable (no label — Wikidata's label
 * service echoes the QID for unlabeled items — or a required coordinate is
 * missing). Filed as `action: "add"`, flagged `autoDerived` so a reviewer
 * (US-009) promotes it; never a live write.
 */
export function recordToContribution(
  record: RawRecord,
  category: AcquisitionCategory,
): Partial<Contribution> | null {
  const name = (record.fields.itemLabel ?? record.fields.label ?? "").trim();
  if (!name) return null;

  const qid = (record.fields.qid ?? "").trim();
  // The label service echoes the QID as the label for items with no English label.
  if (qid && name === qid) return null;

  const coords = parseWktPoint(record.fields.coord);
  if (category.requireCoordinates && !coords) return null;

  const provenance = record.provenance;
  const image = (record.fields.image ?? "").trim();
  const entityData: Record<string, unknown> = {
    name,
    domain: category.domain,
    wikidataClass: category.wikidataClass,
    // Provenance + review flags (mirrors US-004 auto-derived drafts).
    source: "culturescrape-wikidata",
    autoDerived: true,
    aiGenerated: false,
    sourceQuery: provenance.source_query,
    retrievedAt: provenance.retrieved_at,
  };
  if (qid) entityData.wikidataQid = qid;
  if (image) entityData.imageUrl = image;
  if (coords) entityData.coordinates = coords;

  const sourceUrl =
    (provenance.source_url ?? "").trim() ||
    (qid ? `https://www.wikidata.org/wiki/${qid}` : undefined);

  return {
    entityType: category.entityType,
    action: "add",
    entityData,
    sources: [
      {
        title: `Wikidata${qid ? ` ${qid}` : ""} via culture-scrape`,
        url: sourceUrl,
        license: provenance.license ?? "CC0",
      },
    ],
    confidence: toContributionConfidence(provenance.confidence),
    notes: `Bulk-acquired from Wikidata (${category.label}) via culture-scrape; awaiting review.`,
  };
}

// ── Job runner boundary ───────────────────────────────────────────────────────

export interface AcquisitionReport {
  category_id: string;
  adapter: string;
  row_count: number;
  error_count: number;
  distinct_sources: string[];
}

export interface FetchOutcome {
  records: RawRecord[];
  report: AcquisitionReport;
}

export interface JobRunnerContext {
  limit?: number;
  signal?: AbortSignal;
}

/**
 * The network/subprocess boundary. `liveJobRunner` shells out to culture-scrape;
 * tests inject a fake returning recorded records so no Python/network is needed.
 */
export interface CultureScrapeJobRunner {
  runFetch(
    category: AcquisitionCategory,
    context: JobRunnerContext,
  ): Promise<FetchOutcome>;
}

export class CultureScrapeAcquisitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CultureScrapeAcquisitionError";
  }
}

// ── Orchestration (pure over an injected runner + contribution queue) ──────────

export interface AcquisitionProgress {
  phase: "starting" | "fetching" | "queueing" | "done";
  message: string;
  /** Records returned by the fetch so far. */
  acquired: number;
  /** Contributions enqueued so far. */
  queued: number;
  /** Records skipped (no label / missing required coordinate / invalid). */
  skipped: number;
  /** Total records to process, once known. */
  total?: number;
}

export interface AcquisitionJobResult {
  domain: AcquisitionDomain;
  categoryId: string;
  acquired: number;
  queued: number;
  skipped: number;
  contributionIds: string[];
  report: AcquisitionReport;
}

export interface RunAcquisitionOptions {
  category: AcquisitionCategory;
  runner: CultureScrapeJobRunner;
  contributions: ContributionService;
  limit?: number;
  signal?: AbortSignal;
  onProgress?: (progress: AcquisitionProgress) => void;
}

/**
 * Run one acquisition end to end: fetch via the runner, then map + enqueue each
 * record into the contribution review queue. Returns per-run counts + the
 * culture-scrape run report.
 */
export async function runAcquisitionJob(
  options: RunAcquisitionOptions,
): Promise<AcquisitionJobResult> {
  const { category, runner, contributions, limit, signal, onProgress } = options;

  onProgress?.({
    phase: "starting",
    message: `Starting Wikidata acquisition for ${category.label}`,
    acquired: 0,
    queued: 0,
    skipped: 0,
  });

  const outcome = await runner.runFetch(category, { limit, signal });
  const records = outcome.records;

  onProgress?.({
    phase: "fetching",
    message: `Fetched ${records.length} record(s) from Wikidata`,
    acquired: records.length,
    queued: 0,
    skipped: 0,
    total: records.length,
  });

  let queued = 0;
  let skipped = 0;
  const contributionIds: string[] = [];

  for (let i = 0; i < records.length; i++) {
    if (signal?.aborted) break;
    const draft = recordToContribution(records[i], category);
    if (!draft) {
      skipped++;
      continue;
    }
    const { contribution } = contributions.submit(draft);
    if (contribution) {
      queued++;
      contributionIds.push(contribution.id);
    } else {
      skipped++;
    }
    if ((i + 1) % 25 === 0 || i === records.length - 1) {
      onProgress?.({
        phase: "queueing",
        message: `Queued ${queued} / ${records.length} for review (${skipped} skipped)`,
        acquired: records.length,
        queued,
        skipped,
        total: records.length,
      });
    }
  }

  onProgress?.({
    phase: "done",
    message: `Acquisition complete: ${queued} queued for review, ${skipped} skipped`,
    acquired: records.length,
    queued,
    skipped,
    total: records.length,
  });

  return {
    domain: category.domain,
    categoryId: category.id,
    acquired: records.length,
    queued,
    skipped,
    contributionIds,
    report: outcome.report,
  };
}

// ── Live runner (spawns the vendored culture-scrape CLI) ───────────────────────

export interface LiveRunnerOptions {
  /** Python interpreter (default `CULTURESCRAPE_PYTHON` env or `python3`). */
  python?: string;
  /** culture-scrape package dir (default `CULTURESCRAPE_DIR` env or `<cwd>/core`). */
  packageDir?: string;
  /** Per-fetch timeout (default `CULTURESCRAPE_FETCH_TIMEOUT_MS` env or 5 min). */
  timeoutMs?: number;
}

function runCli(
  python: string,
  packageDir: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-m", "culturescrape.cli", ...args], {
      cwd: packageDir,
      env: {
        ...process.env,
        PYTHONPATH: [
          path.join(packageDir, "src"),
          process.env.PYTHONPATH,
        ]
          .filter(Boolean)
          .join(path.delimiter),
      },
    });

    let stderr = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => child.kill("SIGKILL");
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() =>
        reject(
          new CultureScrapeAcquisitionError(
            `culturescrape fetch timed out after ${timeoutMs}ms`,
          ),
        ),
      );
    }, timeoutMs);

    if (signal) {
      if (signal.aborted) child.kill("SIGKILL");
      else signal.addEventListener("abort", onAbort);
    }

    child.stderr?.on("data", (data) => {
      stderr += String(data);
    });
    child.on("error", (err) => {
      finish(() =>
        reject(
          new CultureScrapeAcquisitionError(
            `failed to launch culturescrape (${python}): ${err.message}`,
          ),
        ),
      );
    });
    child.on("close", (code) => {
      // Exit 2 = zero rows with errors (empty but readable); anything else non-zero is a failure.
      if (code === 0 || code === 2) finish(resolve);
      else
        finish(() =>
          reject(
            new CultureScrapeAcquisitionError(
              `culturescrape fetch exited ${code}: ${stderr.trim().slice(0, 500)}`,
            ),
          ),
        );
    });
  });
}

function readReport(
  reportPath: string,
  category: AcquisitionCategory,
  rowCount: number,
): AcquisitionReport {
  try {
    const raw = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as Partial<AcquisitionReport>;
    return {
      category_id: raw.category_id ?? category.id,
      adapter: raw.adapter ?? "wikidata-sparql",
      row_count: typeof raw.row_count === "number" ? raw.row_count : rowCount,
      error_count: typeof raw.error_count === "number" ? raw.error_count : 0,
      distinct_sources: Array.isArray(raw.distinct_sources)
        ? raw.distinct_sources
        : ["wikidata"],
    };
  } catch {
    return {
      category_id: category.id,
      adapter: "wikidata-sparql",
      row_count: rowCount,
      error_count: 0,
      distinct_sources: ["wikidata"],
    };
  }
}

export function createLiveJobRunner(
  options: LiveRunnerOptions = {},
): CultureScrapeJobRunner {
  const python =
    options.python ?? process.env.CULTURESCRAPE_PYTHON ?? "python3";
  const packageDir =
    options.packageDir ??
    process.env.CULTURESCRAPE_DIR ??
    path.resolve(process.cwd(), "core");
  const timeoutMs =
    options.timeoutMs ??
    (Number(process.env.CULTURESCRAPE_FETCH_TIMEOUT_MS) || 300_000);

  return {
    async runFetch(category, context) {
      const outDir = fs.mkdtempSync(
        path.join(os.tmpdir(), `culturescrape-${category.id}-`),
      );
      const specPath = path.join(outDir, `${category.id}.yml`);
      fs.writeFileSync(
        specPath,
        buildCategorySpecYaml(category, context.limit),
        "utf-8",
      );
      try {
        await runCli(
          python,
          packageDir,
          ["fetch", specPath, "--out", outDir],
          timeoutMs,
          context.signal,
        );
        const jsonlPath = path.join(outDir, `${category.id}.jsonl`);
        const reportPath = path.join(outDir, `${category.id}.report.json`);
        const records = fs.existsSync(jsonlPath)
          ? parseRawRecords(fs.readFileSync(jsonlPath, "utf-8"))
          : [];
        return { records, report: readReport(reportPath, category, records.length) };
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    },
  };
}

/** Default live runner — spawns the vendored culture-scrape CLI. */
export const liveJobRunner: CultureScrapeJobRunner = createLiveJobRunner();
