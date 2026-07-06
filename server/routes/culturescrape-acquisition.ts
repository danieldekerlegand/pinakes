/**
 * culture-scrape Wikidata bulk-acquisition routes (US-005).
 *
 * `GET  /api/scraping/culturescrape/categories` — the four acquirable domains
 *   (civilizations, sites, figures, trade goods) for the dashboard.
 * `POST /api/scraping/culturescrape` — start a Wikidata acquisition job for one
 *   domain. The heavy lifting runs in the background via
 *   {@link runAcquisitionJob}; progress is streamed through the existing
 *   `jobStore` (the scraper dashboard already polls `GET /api/scraping-jobs`),
 *   and acquired records land in the contribution review queue with provenance —
 *   never a live write.
 *
 * The `runner`/`contributions` are injectable so tests exercise the whole path
 * with a fake runner + a temp-dir queue (no Python subprocess, no network).
 */

import type { Express } from "express";

import { ContributionService } from "../services/contribution-service";
import { jobStore } from "../services/job-store";
import {
  ACQUISITION_CATALOG,
  liveJobRunner,
  listAcquisitionCategories,
  resolveAcquisitionCategory,
  runAcquisitionJob,
  type AcquisitionJobResult,
  type CultureScrapeJobRunner,
} from "../services/culturescrape-acquisition";

export interface CultureScrapeAcquisitionRouteOptions {
  /** Job runner (default: the live culture-scrape CLI runner). */
  runner?: CultureScrapeJobRunner;
  /** Contribution queue (default: real `data/contributions`). */
  contributions?: ContributionService;
  /**
   * Test hook fired after a background job settles — lets a test await
   * completion deterministically instead of polling the job store.
   */
  onJobSettled?: (
    jobId: string,
    result: AcquisitionJobResult | null,
    error?: Error,
  ) => void;
}

export function registerCultureScrapeAcquisitionRoutes(
  app: Express,
  options: CultureScrapeAcquisitionRouteOptions = {},
): void {
  const runner = options.runner ?? liveJobRunner;
  const contributions = options.contributions ?? new ContributionService();

  /** GET /api/scraping/culturescrape/categories — the acquirable domains. */
  app.get("/api/scraping/culturescrape/categories", (_req, res) => {
    res.json({
      categories: listAcquisitionCategories().map((c) => ({
        domain: c.domain,
        id: c.id,
        label: c.label,
        description: c.description,
        entityType: c.entityType,
        wikidataClass: c.wikidataClass,
      })),
    });
  });

  /**
   * POST /api/scraping/culturescrape
   * Body: `{ domain, limit? }`. 202 with `{ jobId, domain }`; 400 on an unknown
   * domain or a bad limit. Progress + results surface via `GET /api/scraping-jobs`.
   */
  app.post("/api/scraping/culturescrape", (req, res) => {
    const body = (req.body ?? {}) as { domain?: string; limit?: number };
    const category = resolveAcquisitionCategory(body.domain);
    if (!category) {
      return res.status(400).json({
        message: `Unknown culture-scrape domain: ${body.domain ?? "(none)"}`,
        validDomains: Object.keys(ACQUISITION_CATALOG),
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

    const job = jobStore.createJob(
      `culturescrape:${category.domain}`,
      limit ?? 0,
      "other",
    );
    jobStore.updateJob(job.id, {
      status: "running",
      startedAt: new Date().toISOString(),
      statusMessage: `Starting Wikidata acquisition for ${category.label}`,
    });

    // Fire-and-forget: progress streams through jobStore (dashboard polls it).
    runAcquisitionJob({
      category,
      runner,
      contributions,
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
          statusMessage: `Queued ${result.queued} ${category.label} contribution(s) for review (${result.skipped} skipped, ${result.acquired} fetched).`,
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
      domain: category.domain,
      message: `Culture-scrape Wikidata acquisition started for ${category.label}`,
    });
  });
}
