/**
 * Living-dataset workflow routes (US-011 — speculative PRD).
 *
 *   GET  /api/living-dataset/status  — freshness + versioning dashboard payload:
 *        per-file freshness (data-freshness.ts), the discovery-ingestion schedule
 *        (which domains are stale), the current release + annual release cadence
 *        (when the next citable snapshot is due), and the release history.
 *   POST /api/living-dataset/ingest  — run a scheduled discovery-ingestion pass:
 *        for each due (or requested) acquisition domain, run pinakes-engine bulk
 *        acquisition (→ contribution review queue, never a live write) and stamp
 *        the domain's last-ingestion timestamp.
 *   POST /api/living-dataset/release — mint a versioned, DOI-bearing snapshot of
 *        the whole corpus (reuses `buildDatasetSnapshot`) and record it so the
 *        annual cadence advances.
 *
 * The store / acquisition runner / contribution queue / DOI minter are all
 * injectable, so route tests exercise the whole path with a fake runner + temp-dir
 * stores (no Python subprocess, no live Zenodo call, no network). Reads are open.
 */

import type { Express } from "express";
import path from "node:path";

import { getFreshnessSummary } from "../services/data-freshness";
import {
  ACQUISITION_CATALOG,
  liveJobRunner,
  runAcquisitionJob,
  type AcquisitionDomain,
  type CultureScrapeJobRunner,
} from "../services/culturescrape-acquisition";
import { ContributionService } from "../services/contribution-service";
import {
  buildDatasetSnapshot,
  createZenodoDoiMinter,
  type ChangeCounts,
  type DoiMinter,
  type ExportFormat,
} from "../services/export-pipeline";
import type { ChangelogStore } from "../services/changelog";
import {
  LivingDatasetStore,
  computeIngestionSchedule,
  computeReleaseCadence,
  currentReleaseFrom,
  selectDueDomains,
  INGESTION_INTERVAL_DAYS,
  type ReleaseRecord,
} from "../services/living-dataset";

export interface LivingDatasetRouteOptions {
  /** State store (default the real gitignored `data/living-dataset/`). */
  store?: LivingDatasetStore;
  /** Contribution review queue acquired records land in (default `data/runtime/contributions`). */
  contributions?: ContributionService;
  /** pinakes-engine acquisition runner (default: the live CLI runner). */
  runner?: CultureScrapeJobRunner;
  /** DOI minter for `POST /release` (default Zenodo, disabled without a token). */
  doiMinter?: DoiMinter;
  /** Shared changelog store used to derive the next semver on release. */
  changelog?: ChangelogStore;
  /** Lexicons dir the freshness summary reads (default `./data/source/lexicons`). */
  lexiconsDir?: string;
  /** Per-domain acquisition limit for a scheduled ingestion run (default 50). */
  defaultIngestLimit?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

const VALID_FORMATS: ExportFormat[] = ["cldf", "csv", "tsv", "json"];

function parseFormat(raw: unknown): ExportFormat {
  const f = typeof raw === "string" ? raw : "";
  return (VALID_FORMATS as string[]).includes(f) ? (f as ExportFormat) : "json";
}

function parseDatasets(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    const arr = raw
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter(Boolean);
    return arr.length ? arr : undefined;
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function registerLivingDatasetRoutes(
  app: Express,
  options: LivingDatasetRouteOptions = {},
): void {
  const store = options.store ?? new LivingDatasetStore();
  const contributions = options.contributions ?? new ContributionService();
  const runner = options.runner ?? liveJobRunner;
  const doiMinter = options.doiMinter ?? createZenodoDoiMinter();
  const changelog = options.changelog;
  const lexiconsDir = options.lexiconsDir ?? path.resolve("data", "source", "lexicons");
  const defaultIngestLimit = options.defaultIngestLimit ?? 50;
  const now = options.now ?? (() => new Date());

  /** GET /api/living-dataset/status — the freshness + versioning dashboard payload. */
  app.get("/api/living-dataset/status", (_req, res) => {
    try {
      const nowDate = now();
      const freshness = getFreshnessSummary(lexiconsDir, nowDate);
      const releases = store.getReleases();
      const currentRelease = currentReleaseFrom(releases);
      const releaseCadence = computeReleaseCadence(
        currentRelease.releaseDate,
        nowDate,
      );
      const schedule = computeIngestionSchedule(store.getIngestions(), nowDate);
      const dueDomains = selectDueDomains(schedule);

      res.json({
        generatedAt: nowDate.toISOString(),
        freshness,
        currentRelease,
        releaseCadence,
        ingestion: {
          intervalDays: INGESTION_INTERVAL_DAYS,
          entries: schedule,
          dueDomains,
          dueCount: dueDomains.length,
        },
        releaseHistory: releases,
      });
    } catch (error) {
      res
        .status(500)
        .json({ message: errorMessage(error, "Failed to load living-dataset status") });
    }
  });

  /**
   * POST /api/living-dataset/ingest — run a scheduled discovery-ingestion pass.
   * Body: { domains?: string[], force?: boolean, limit?: number }. Without a
   * `domains` list it runs the stale domains (all when `force`). Each domain runs
   * pinakes-engine acquisition into the review queue; a per-domain failure is
   * collected (never aborts the whole run) so a partial pass still records what
   * succeeded.
   */
  app.post("/api/living-dataset/ingest", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const nowDate = now();
    const schedule = computeIngestionSchedule(store.getIngestions(), nowDate);

    let targets: AcquisitionDomain[];
    if (Array.isArray(body.domains) && body.domains.length > 0) {
      const requested = body.domains.filter(
        (d): d is string => typeof d === "string",
      );
      const invalid = requested.filter((d) => !(d in ACQUISITION_CATALOG));
      if (invalid.length > 0) {
        res.status(400).json({ message: `Unknown domain(s): ${invalid.join(", ")}` });
        return;
      }
      targets = requested as AcquisitionDomain[];
    } else if (body.force === true) {
      targets = Object.keys(ACQUISITION_CATALOG) as AcquisitionDomain[];
    } else {
      targets = selectDueDomains(schedule);
    }

    const limit =
      typeof body.limit === "number" && body.limit > 0
        ? Math.floor(body.limit)
        : defaultIngestLimit;

    const ran: Array<{
      domain: AcquisitionDomain;
      categoryId: string;
      acquired: number;
      queued: number;
      skipped: number;
      contributionIds: string[];
    }> = [];
    const errors: Array<{ domain: AcquisitionDomain; error: string }> = [];

    for (const domain of targets) {
      const category = ACQUISITION_CATALOG[domain];
      try {
        const result = await runAcquisitionJob({
          category,
          runner,
          contributions,
          limit,
        });
        store.recordIngestion(domain, now().toISOString());
        ran.push({
          domain,
          categoryId: result.categoryId,
          acquired: result.acquired,
          queued: result.queued,
          skipped: result.skipped,
          contributionIds: result.contributionIds,
        });
      } catch (error) {
        errors.push({ domain, error: errorMessage(error, "acquisition failed") });
      }
    }

    res.status(200).json({
      ranAt: nowDate.toISOString(),
      requested: targets,
      ran,
      errors,
      totalQueued: ran.reduce((sum, r) => sum + r.queued, 0),
    });
  });

  /**
   * POST /api/living-dataset/release — mint a versioned, DOI-bearing corpus snapshot
   * and record it so the annual cadence advances. Body: { version?, previousVersion?,
   * format?, datasets? }. Version precedence: explicit `version` › changelog-derived
   * bump over the previous version › the seed default.
   */
  app.post("/api/living-dataset/release", async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const nowDate = now();
      const current = currentReleaseFrom(store.getReleases());

      const explicit = typeof body.version === "string" ? body.version : undefined;
      const previousVersion =
        typeof body.previousVersion === "string"
          ? body.previousVersion
          : current.version;

      let changeCounts: ChangeCounts | undefined;
      if (!explicit && changelog) {
        const stats = changelog.stats();
        changeCounts = {
          added: stats.byChangeType.added,
          modified: stats.byChangeType.modified,
          removed: stats.byChangeType.removed,
        };
      }

      const snapshot = await buildDatasetSnapshot({
        format: parseFormat(body.format),
        datasets: parseDatasets(body.datasets),
        version: explicit,
        previousVersion,
        changeCounts,
        releaseDate: nowDate.toISOString(),
        doiMinter,
      });

      const record: ReleaseRecord = {
        version: snapshot.metadata.version,
        doi: snapshot.metadata.doi,
        doiUrl: snapshot.metadata.doiUrl,
        releaseDate: snapshot.metadata.releaseDate,
        totalRows: snapshot.metadata.totalRows,
        license: snapshot.metadata.license,
      };
      store.recordRelease(record);

      res.status(201).json({
        release: snapshot.metadata,
        cadence: computeReleaseCadence(record.releaseDate, nowDate),
      });
    } catch (error) {
      res
        .status(400)
        .json({ message: errorMessage(error, "Failed to mint dataset release") });
    }
  });
}
