/**
 * AI-extraction review-queue routes (US-009).
 *
 * A dedicated review workflow so nothing AI-generated (URL extractor US-004,
 * text extractor US-008) enters the live dataset unverified:
 *
 * - `GET  /api/ai-review`            — list AI drafts as field-level review views
 *                                      (per-field confidence, low-confidence flag).
 * - `GET  /api/ai-review/:id`        — a single draft's review view.
 * - `PATCH /api/ai-review/:id`       — submit per-field accept/edit/reject
 *                                      decisions + approve|reject. On approve the
 *                                      accepted draft is **promoted** into the
 *                                      appropriate `lexicons/*.tsv` with
 *                                      provenance (AI source + human reviewer).
 *
 * `ContributionService` and `lexiconsDir` are injectable so tests use a temp
 * queue + temp lexicons dir. See `server/routes/ai-review.test.ts`.
 */

import type { Express } from "express";
import path from "path";
import { ContributionService } from "../services/contribution-service";
import { ChangelogStore } from "../services/changelog";
import {
  applyFieldReviews,
  AiReviewError,
  isAiDraft,
  projectDraft,
  promoteContribution,
  validateAcceptedDraft,
  type FieldDecision,
} from "../services/ai-review";

export interface AiReviewRouteOptions {
  contributions?: ContributionService;
  /** Directory holding `lexicons/*.tsv` (default: repo `lexicons`). */
  lexiconsDir?: string;
  /** Changelog store — an approved promotion is logged here (US-010). */
  changelog?: ChangelogStore;
}

export function registerAiReviewRoutes(app: Express, options: AiReviewRouteOptions = {}): void {
  const contributions = options.contributions ?? new ContributionService();
  const lexiconsDir = options.lexiconsDir ?? path.resolve("lexicons");
  const changelog = options.changelog ?? new ChangelogStore();

  /**
   * GET /api/ai-review?status=pending
   * Lists AI-generated drafts projected as field-level review views.
   */
  app.get("/api/ai-review", (req, res) => {
    const status = req.query.status as string | undefined;
    const { contributions: all } = contributions.list({
      status: status as never,
      limit: 1000,
    });
    const drafts = all.filter(isAiDraft).map(projectDraft);
    res.json({ drafts, total: drafts.length });
  });

  /**
   * GET /api/ai-review/:id — one draft's review view.
   */
  app.get("/api/ai-review/:id", (req, res) => {
    const contribution = contributions.get(req.params.id);
    if (!contribution || !isAiDraft(contribution)) {
      return res.status(404).json({ message: `AI draft '${req.params.id}' not found` });
    }
    res.json(projectDraft(contribution));
  });

  /**
   * PATCH /api/ai-review/:id
   * Body: `{ decision: 'approved'|'rejected', reviewer, fields?, note? }`
   *   fields: Record<fieldName, { decision: 'accept'|'edit'|'reject', value? }>
   *
   * 200 with the updated draft view; on approve, `promotion` is populated.
   * 400 on a bad decision / rejected-required field / non-promotable type;
   * 404 when the draft doesn't exist.
   */
  app.patch("/api/ai-review/:id", (req, res) => {
    const body = (req.body ?? {}) as {
      decision?: "approved" | "rejected";
      reviewer?: string;
      fields?: Record<string, FieldDecision>;
      note?: string;
    };

    if (!body.decision || !["approved", "rejected"].includes(body.decision)) {
      return res.status(400).json({ message: "decision must be 'approved' or 'rejected'" });
    }
    if (!body.reviewer || typeof body.reviewer !== "string" || !body.reviewer.trim()) {
      return res.status(400).json({ message: "reviewer is required" });
    }

    const contribution = contributions.get(req.params.id);
    if (!contribution || !isAiDraft(contribution)) {
      return res.status(404).json({ message: `AI draft '${req.params.id}' not found` });
    }

    let applied;
    try {
      applied = applyFieldReviews(contribution, body.fields ?? {});
    } catch (error) {
      if (error instanceof AiReviewError) {
        return res.status(400).json({ message: error.message });
      }
      throw error;
    }

    if (body.decision === "rejected") {
      const updated = contributions.recordAiReview(req.params.id, {
        status: "rejected",
        reviewer: body.reviewer,
        fieldReviews: applied.fieldReviews,
        note: body.note,
      });
      return res.json(updated ? projectDraft(updated) : null);
    }

    // Approve → validate accepted content, then promote to TSV.
    const errors = validateAcceptedDraft(contribution.entityType, applied.acceptedData);
    if (errors.length > 0) {
      return res.status(400).json({ message: "Cannot approve draft", errors });
    }

    let promotion;
    try {
      promotion = promoteContribution({
        contributionId: contribution.id,
        entityType: contribution.entityType,
        acceptedData: applied.acceptedData,
        reviewer: body.reviewer,
        aiSource: contribution.aiSource ?? "unknown",
        overallConfidence: contribution.confidence,
        lexiconsDir,
        now: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof AiReviewError) {
        return res.status(400).json({ message: error.message });
      }
      throw error;
    }

    // Log the approved edit into the changelog (US-010). A promotion always
    // appends a new row, so the change type is "added". Never fail the review
    // if changelog recording throws.
    try {
      changelog.record({
        domain: contribution.entityType,
        changeType: "added",
        targetFile: promotion.file,
        targetId: promotion.targetId,
        entityName: typeof applied.acceptedData.name === "string" ? applied.acceptedData.name : undefined,
        source: "ai-review",
        sourceUrl: contribution.aiSource ?? undefined,
        contributionId: contribution.id,
        reviewer: body.reviewer,
        confidence: contribution.confidence,
        summary: `Promoted AI draft (${contribution.aiSource ?? "unknown"}) into ${promotion.file}`,
      });
    } catch (error) {
      console.error("Failed to record changelog entry for promotion:", error);
    }

    const updated = contributions.recordAiReview(req.params.id, {
      status: "approved",
      reviewer: body.reviewer,
      fieldReviews: applied.fieldReviews,
      promotion,
      note: body.note,
    });
    return res.json(updated ? projectDraft(updated) : null);
  });
}
