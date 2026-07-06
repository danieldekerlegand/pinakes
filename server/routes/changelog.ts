/**
 * Data changelog routes (/api/changelog, US-010).
 *
 * A browsable, filterable audit log of dataset changes recorded by the
 * contribution pipeline (approved edits) — see the `changelog` option on
 * `registerAiReviewRoutes` / `registerContributionRoutes`, which log an entry
 * whenever an approved change lands.
 *
 * - `GET /api/changelog`        — filtered + paginated entries (+ total).
 * - `GET /api/changelog/stats`  — aggregate counts + date bounds over the filter.
 *
 * The `ChangelogStore` is injectable so tests point it at a temp dir; in
 * production the same store instance is shared with the contribution/ai-review
 * routes so their writes are visible here.
 */

import type { Express } from "express";
import {
  ChangelogStore,
  CHANGE_TYPES,
  type ChangeType,
  type ChangelogFilters,
} from "../services/changelog";

export interface ChangelogRoutesOptions {
  changelog?: ChangelogStore;
}

/** Parse shared query params into `ChangelogFilters`. */
function parseFilters(query: Record<string, unknown>): ChangelogFilters {
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const num = (v: unknown): number | undefined => {
    const s = str(v);
    if (s === undefined) return undefined;
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? undefined : n;
  };
  const changeTypeRaw = str(query.changeType);
  const changeType =
    changeTypeRaw && (CHANGE_TYPES as readonly string[]).includes(changeTypeRaw)
      ? (changeTypeRaw as ChangeType)
      : undefined;
  return {
    domain: str(query.domain),
    changeType,
    source: str(query.source),
    contributionId: str(query.contributionId),
    from: str(query.from),
    to: str(query.to),
    limit: num(query.limit),
    offset: num(query.offset),
  };
}

export function registerChangelogRoutes(app: Express, options: ChangelogRoutesOptions = {}): void {
  const changelog = options.changelog ?? new ChangelogStore();

  /**
   * GET /api/changelog?domain=&changeType=&source=&from=&to=&limit=&offset=
   * Filtered + paginated changelog entries (newest first).
   */
  app.get("/api/changelog", (req, res) => {
    try {
      const filters = parseFilters(req.query as Record<string, unknown>);
      const { entries, total } = changelog.list(filters);
      res.json({
        entries,
        total,
        offset: filters.offset ?? 0,
        limit: filters.limit ?? 50,
        changeTypes: CHANGE_TYPES,
      });
    } catch (error) {
      console.error("Error listing changelog:", error);
      res.status(500).json({
        message: "Failed to list changelog",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/changelog/stats?domain=&from=&to=... — aggregate counts + date bounds
   * over the filtered set (pagination ignored).
   */
  app.get("/api/changelog/stats", (req, res) => {
    try {
      const filters = parseFilters(req.query as Record<string, unknown>);
      res.json(changelog.stats(filters));
    } catch (error) {
      console.error("Error computing changelog stats:", error);
      res.status(500).json({
        message: "Failed to compute changelog stats",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
}
