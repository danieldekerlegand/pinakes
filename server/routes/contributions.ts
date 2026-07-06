/**
 * Contribution API routes (Phase 5; hardened in US-011).
 *
 * The public contribution surface. Write endpoints (`POST /api/contributions`,
 * `PATCH /api/contributions/:id/review`) are guarded by
 * `createContributionWriteGuard` — API-key auth + per-key rate limiting — so
 * programmatic contributions are safe and supported. Read endpoints
 * (`GET /api/contributions*`) are open. A submitted contribution enters the
 * review queue; it is never written to the live dataset unreviewed.
 *
 * `GET /api/openapi.json` publishes the OpenAPI spec for this surface.
 *
 * Both the `ContributionService` and the write guard are injectable so tests can
 * point them at a temp dir / a deterministic clock (see `contributions.test.ts`).
 */

import type { Express, RequestHandler } from "express";
import { ContributionService, type ContributionStatus } from "../services/contribution-service";
import { createContributionWriteGuard } from "../services/api-auth";
import { buildOpenApiSpec } from "../services/openapi-spec";
import { ChangelogStore, type ChangeType } from "../services/changelog";

export interface ContributionRoutesOptions {
  contributions?: ContributionService;
  /** Guard applied to write endpoints. Defaults to env-configured auth + rate limit. */
  writeGuard?: RequestHandler;
  /** Changelog store — an approved add/edit is logged here (US-010). */
  changelog?: ChangelogStore;
}

export function registerContributionRoutes(
  app: Express,
  options: ContributionRoutesOptions = {},
): void {
  const contributions = options.contributions ?? new ContributionService();
  const writeGuard = options.writeGuard ?? createContributionWriteGuard();
  const changelog = options.changelog ?? new ChangelogStore();

  /**
   * GET /api/openapi.json - Published OpenAPI spec for the contribution + read API.
   */
  app.get("/api/openapi.json", (_req, res) => {
    res.json(buildOpenApiSpec());
  });

  /**
   * POST /api/contributions - Submit a new contribution (auth + rate limited).
   */
  app.post("/api/contributions", writeGuard, (req, res) => {
    try {
      const result = contributions.submit(req.body);

      if (!result.validation.valid) {
        res.status(400).json({
          message: "Validation failed",
          errors: result.validation.errors,
          warnings: result.validation.warnings,
        });
        return;
      }

      res.status(201).json({
        contribution: result.contribution,
        warnings: result.validation.warnings,
      });
    } catch (error) {
      console.error("Error submitting contribution:", error);
      res.status(500).json({
        message: "Failed to submit contribution",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/contributions - List contributions with filtering.
   */
  app.get("/api/contributions", (req, res) => {
    try {
      const status = req.query.status as ContributionStatus | undefined;
      const entityType = req.query.entityType as string | undefined;
      const action = req.query.action as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

      const result = contributions.list({
        status,
        entityType: entityType as never,
        action: action as never,
        limit,
        offset,
      });

      res.json(result);
    } catch (error) {
      console.error("Error listing contributions:", error);
      res.status(500).json({
        message: "Failed to list contributions",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/contributions/export - Export contributions as CSV.
   */
  app.get("/api/contributions/export", (_req, res) => {
    try {
      const csv = contributions.exportCsv();
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=contributions.csv");
      res.send(csv);
    } catch (error) {
      console.error("Error exporting contributions:", error);
      res.status(500).json({
        message: "Failed to export contributions",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/contributions/entity/:entityType/:entityId - Approved contributions for an entity.
   */
  app.get("/api/contributions/entity/:entityType/:entityId", (req, res) => {
    try {
      const contribs = contributions.getByEntity(req.params.entityType, req.params.entityId);
      res.json({ contributions: contribs });
    } catch (error) {
      console.error("Error getting entity contributions:", error);
      res.status(500).json({
        message: "Failed to get entity contributions",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/contributions/stats - Contribution statistics.
   */
  app.get("/api/contributions/stats", (_req, res) => {
    try {
      const stats = contributions.stats();
      res.json(stats);
    } catch (error) {
      console.error("Error getting contribution stats:", error);
      res.status(500).json({
        message: "Failed to get contribution stats",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * GET /api/contributions/:id - Get a single contribution.
   */
  app.get("/api/contributions/:id", (req, res) => {
    try {
      const contribution = contributions.get(req.params.id);
      if (!contribution) {
        res.status(404).json({ message: `Contribution '${req.params.id}' not found` });
        return;
      }
      res.json(contribution);
    } catch (error) {
      console.error("Error getting contribution:", error);
      res.status(500).json({
        message: "Failed to get contribution",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  /**
   * PATCH /api/contributions/:id/review - Review (approve/reject) a contribution
   * (auth + rate limited — moderation is a privileged write).
   */
  app.patch("/api/contributions/:id/review", writeGuard, (req, res) => {
    try {
      const { decision, note } = req.body;
      if (!decision || !["approved", "rejected"].includes(decision)) {
        res.status(400).json({ message: "decision must be 'approved' or 'rejected'" });
        return;
      }

      const contribution = contributions.review(req.params.id, decision, note);
      if (!contribution) {
        res.status(404).json({ message: `Contribution '${req.params.id}' not found` });
        return;
      }

      // Log an approved add/edit into the changelog (US-010). Flags aren't data
      // edits, so they're not logged. Never fail the review if logging throws.
      if (decision === "approved" && (contribution.action === "add" || contribution.action === "edit")) {
        try {
          const nameField = (contribution.entityData as Record<string, unknown>)?.name;
          changelog.record({
            domain: contribution.entityType,
            changeType: (contribution.action === "add" ? "added" : "modified") as ChangeType,
            targetId: contribution.entityId,
            entityName: typeof nameField === "string" ? nameField : undefined,
            source: "contribution",
            sourceUrl: contribution.sources?.[0]?.url,
            contributionId: contribution.id,
            reviewer: contribution.reviewer,
            confidence: contribution.confidence,
            fields: contribution.fieldName ? [contribution.fieldName] : undefined,
            summary: note,
          });
        } catch (error) {
          console.error("Failed to record changelog entry for approved contribution:", error);
        }
      }

      res.json(contribution);
    } catch (error) {
      console.error("Error reviewing contribution:", error);
      res.status(500).json({
        message: "Failed to review contribution",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
}
