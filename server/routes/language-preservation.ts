/**
 * Endangered-language dashboard + field-research workflow routes (US-010).
 *
 *   - `GET  /api/languages/preservation` — the dashboard payload: preservation-status
 *     aggregation over the corpus (per-category + per-vitality counts, endangerment
 *     rate, speakers-at-risk, per-region breakdown, most-endangered watchlist).
 *   - `POST /api/languages/field-update` — a structured, attributed, sourced field
 *     observation for one language. It rides the existing **contribution review
 *     pipeline** (queued as a `language` edit — never a live TSV write) and, because a
 *     status change is a first-class provenance event, is **also recorded in the shared
 *     changelog** (`source: 'field-research'`) so status changes are versioned/browsable.
 *
 * The aggregation + contribution shaping live in the pure
 * `services/language-preservation.ts`; this module owns only the storage load + HTTP
 * wiring. The language loader, `ContributionService`, and `ChangelogStore` are all
 * injectable so route tests run with in-memory fakes (no storage / fs).
 */
import type { Express, Request, Response } from "express";

import { storage } from "../storage";
import { ContributionService } from "../services/contribution-service";
import { ChangelogStore } from "../services/changelog";
import {
  buildFieldUpdateContribution,
  changedFields,
  computePreservationMetrics,
  fieldUpdateSummary,
  validateFieldUpdate,
  type FieldUpdateInput,
  type PreservationLanguage,
} from "../services/language-preservation";

export type PreservationLanguageLoader = () => Promise<PreservationLanguage[]>;

/** Default loader: project the preservation fields from live TSV storage. */
async function loadPreservationLanguages(): Promise<PreservationLanguage[]> {
  const languages = await storage.getLanguages();
  return languages.map((l) => ({
    id: l.id,
    name: l.name,
    region: l.region ?? null,
    status: l.status ?? null,
    familyId: l.familyId ?? null,
    nativeSpeakers: l.nativeSpeakers ?? null,
    totalSpeakers: l.totalSpeakers ?? null,
  }));
}

export interface PreservationRouteOptions {
  /** Override the language loader (tests pass an in-memory fake). */
  loadLanguages?: PreservationLanguageLoader;
  /** Contribution service the field update is queued into. */
  contributions?: ContributionService;
  /** Shared changelog store — a field update is logged here (US-010). */
  changelog?: ChangelogStore;
}

export function registerLanguagePreservationRoutes(
  app: Express,
  options: PreservationRouteOptions = {},
): void {
  const loadLanguages = options.loadLanguages ?? loadPreservationLanguages;
  const contributions = options.contributions ?? new ContributionService();
  const changelog = options.changelog ?? new ChangelogStore();

  /**
   * GET /api/languages/preservation — endangered-language dashboard aggregation.
   * `?watchlistLimit=` bounds the watchlist (default 25).
   */
  app.get("/api/languages/preservation", async (req: Request, res: Response) => {
    try {
      const languages = await loadLanguages();
      const rawLimit = req.query.watchlistLimit;
      const watchlistLimit =
        typeof rawLimit === "string" && Number.isFinite(Number(rawLimit))
          ? Math.max(0, Math.floor(Number(rawLimit)))
          : undefined;
      res.json(computePreservationMetrics(languages, { watchlistLimit }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error in /api/languages/preservation:", error);
      res.status(500).json({ error: "failed to compute preservation metrics", detail: message });
    }
  });

  /**
   * POST /api/languages/field-update — queue an attributed field-research update for
   * one language and log the status change to the shared changelog.
   * Body: `FieldUpdateInput`. 400 on validation failure, 404 for an unknown language.
   */
  app.post("/api/languages/field-update", async (req: Request, res: Response) => {
    const input = (req.body ?? {}) as Partial<FieldUpdateInput>;

    const validation = validateFieldUpdate(input);
    if (!validation.valid) {
      res.status(400).json({ message: "Validation failed", errors: validation.errors, warnings: validation.warnings });
      return;
    }

    try {
      // Enrich name + current status from storage for provenance (and 404 unknown ids).
      const languages = await loadLanguages();
      const target = languages.find((l) => l.id === input.languageId);
      if (!target) {
        res.status(404).json({ message: `Language '${input.languageId}' not found` });
        return;
      }

      const enriched: FieldUpdateInput = {
        ...(input as FieldUpdateInput),
        languageName: input.languageName ?? target.name,
        currentStatus: input.currentStatus ?? target.status ?? undefined,
      };

      const draft = buildFieldUpdateContribution(enriched);
      const result = contributions.submit(draft);
      if (!result.validation.valid || !result.contribution) {
        res.status(400).json({
          message: "Contribution validation failed",
          errors: result.validation.errors,
          warnings: result.validation.warnings,
        });
        return;
      }

      // A status change is a versioned provenance event (AC3): record it in the shared
      // changelog immediately, attributed to the researcher. Never fail the submission
      // if logging throws.
      let changelogEntryId: string | undefined;
      try {
        const entry = changelog.record({
          domain: "language",
          changeType: "modified",
          targetId: enriched.languageId,
          entityName: enriched.languageName,
          source: "field-research",
          sourceUrl: enriched.sources?.[0]?.url,
          contributionId: result.contribution.id,
          reviewer: enriched.researcherName,
          confidence: enriched.confidence ?? 60,
          fields: changedFields(enriched),
          summary: fieldUpdateSummary(enriched),
        });
        changelogEntryId = entry.id;
      } catch (error) {
        console.error("Failed to record changelog entry for field update:", error);
      }

      res.status(201).json({
        contribution: result.contribution,
        changelogEntryId,
        changedFields: changedFields(enriched),
        warnings: result.validation.warnings,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Error in /api/languages/field-update:", error);
      res.status(500).json({ error: "failed to submit field update", detail: message });
    }
  });
}
