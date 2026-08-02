/**
 * Open Context / tDAR archaeological acquisition routes (US-007).
 *
 * `GET  /api/scraping/archaeology/sources` — the external archaeological
 *   authorities (Open Context, tDAR) available for the dashboard.
 * `POST /api/scraping/archaeology` — start an acquisition job for one source.
 *   The heavy lifting runs in the background via
 *   {@link runArchaeologicalAcquisition}; progress streams through the existing
 *   `jobStore` (the scraper dashboard already polls `GET /api/scraping-jobs`),
 *   and acquired sites land in the contribution review queue with provenance —
 *   never a live TSV write.
 *
 * `deps`/`contributions` are injectable so tests exercise the whole path with
 * fixture-backed deps + a temp-dir queue (no network).
 */

import type { Express } from "express";

import { ContributionService } from "../services/contribution-service";
import { jobStore } from "../services/job-store";
import {
  ARCHAEOLOGY_SOURCES,
  liveArchaeologyDeps,
  listArchaeologySources,
  resolveArchaeologySource,
  runArchaeologicalAcquisition,
  type ArchaeologyAcquisitionResult,
  type ArchaeologyDeps,
} from "../services/archaeological-site-scraper";

export interface ArchaeologyAcquisitionRouteOptions {
  /** Network boundary (default: the live Open Context / tDAR fetchers). */
  deps?: ArchaeologyDeps;
  /** Contribution queue (default: real `data/runtime/contributions`). */
  contributions?: ContributionService;
  /**
   * Test hook fired after a background job settles — lets a test await
   * completion deterministically instead of polling the job store.
   */
  onJobSettled?: (
    jobId: string,
    result: ArchaeologyAcquisitionResult | null,
    error?: Error,
  ) => void;
}

export function registerArchaeologyAcquisitionRoutes(
  app: Express,
  options: ArchaeologyAcquisitionRouteOptions = {},
): void {
  const deps = options.deps ?? liveArchaeologyDeps;
  const contributions = options.contributions ?? new ContributionService();

  /** GET /api/scraping/archaeology/sources — the available authorities. */
  app.get("/api/scraping/archaeology/sources", (_req, res) => {
    res.json({
      sources: listArchaeologySources().map((s) => ({
        id: s.id,
        label: s.label,
        description: s.description,
        homepage: s.homepage,
      })),
    });
  });

  /**
   * POST /api/scraping/archaeology
   * Body: `{ source, query?, limit? }`. 202 with `{ jobId, source }`; 400 on an
   * unknown source or a bad limit. Progress + results surface via
   * `GET /api/scraping-jobs`.
   */
  app.post("/api/scraping/archaeology", (req, res) => {
    const body = (req.body ?? {}) as {
      source?: string;
      query?: string;
      limit?: number;
    };
    const source = resolveArchaeologySource(body.source);
    if (!source) {
      return res.status(400).json({
        message: `Unknown archaeological source: ${body.source ?? "(none)"}`,
        validSources: Object.keys(ARCHAEOLOGY_SOURCES),
      });
    }

    let limit: number | undefined;
    if (body.limit !== undefined && body.limit !== null) {
      const parsed = Number(body.limit);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return res.status(400).json({ message: "limit must be a positive number" });
      }
      limit = Math.floor(parsed);
    }

    const query = typeof body.query === "string" ? body.query : undefined;

    const job = jobStore.createJob(
      `archaeology:${source.id}`,
      limit ?? 0,
      "other",
    );
    jobStore.updateJob(job.id, {
      status: "running",
      startedAt: new Date().toISOString(),
      statusMessage: `Starting acquisition from ${source.label}`,
    });

    // Fire-and-forget: progress streams through jobStore (dashboard polls it).
    runArchaeologicalAcquisition({
      source: source.id,
      contributions,
      deps,
      query,
      limit,
      onProgress: (progress) => {
        jobStore.updateJob(job.id, {
          statusMessage: progress.message,
          completedWords: progress.queued,
          failedWords: progress.skipped,
          totalWords: progress.total ?? limit ?? progress.acquired,
        });
      },
    })
      .then((result) => {
        jobStore.updateJob(job.id, {
          status: "completed",
          completedAt: new Date().toISOString(),
          completedWords: result.queued,
          failedWords: result.skipped,
          totalWords: result.acquired,
          wordCount: result.queued,
          statusMessage: `Queued ${result.queued} archaeological site(s) for review (${result.skipped} skipped, ${result.acquired} fetched).`,
        });
        options.onJobSettled?.(job.id, result);
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        jobStore.updateJob(job.id, {
          status: "failed",
          completedAt: new Date().toISOString(),
          errorMessage: error.message,
          statusMessage: `Acquisition failed: ${error.message}`,
        });
        options.onJobSettled?.(job.id, null, error);
      });

    res.status(202).json({
      jobId: job.id,
      source: source.id,
      message: `Archaeological acquisition started for ${source.label}`,
    });
  });
}
