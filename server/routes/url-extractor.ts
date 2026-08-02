/**
 * URL-paste extractor route (US-004).
 *
 * `POST /api/extract/url` accepts a pasted Wikipedia/Wikidata URL and returns a
 * structured entity *draft* (name, coordinates, dates, relationships) with
 * per-field confidence, **and** queues that draft in the contribution review
 * queue flagged `aiGenerated`/`autoDerived` (provenance `source='auto-derived'`).
 * It never writes the live dataset — a reviewer (US-009) promotes it later.
 *
 * Wikidata resolution goes through the single-entity REST endpoint via
 * `url-extractor`'s `liveDeps` (not a TS SPARQL client). Both the network deps
 * and the `ContributionService` are injectable so tests use recorded fixtures +
 * a temp-dir queue (see `server/routes/url-extractor.test.ts`).
 */

import type { Express } from "express";
import { ContributionService, type ContributionEntityType } from "../services/contribution-service";
import {
  extractDraftFromUrl,
  draftToContribution,
  liveDeps,
  UrlExtractionError,
  type UrlExtractorDeps,
} from "../services/url-extractor";

export interface UrlExtractorRouteOptions {
  /** Contribution queue (default: real `data/runtime/contributions`). */
  contributions?: ContributionService;
  /** Network boundary (default: live Wikidata/Wikipedia REST). */
  deps?: UrlExtractorDeps;
}

/** entityTypes a caller may request the draft be filed under (all name-only-safe). */
const ALLOWED_ENTITY_TYPES: ReadonlySet<string> = new Set<ContributionEntityType>([
  "civilization",
  "archaeological-site",
  "language",
  "religion",
  "cuisine",
  "music-tradition",
]);

export function registerUrlExtractorRoutes(
  app: Express,
  options: UrlExtractorRouteOptions = {},
): void {
  const contributions = options.contributions ?? new ContributionService();
  const deps = options.deps ?? liveDeps;

  /**
   * POST /api/extract/url
   * Body: `{ url, entityType?, contributorName?, contributorEmail? }`.
   * 201 with `{ draft, contribution }`; 400 on a bad URL; 502 on a source error.
   */
  app.post("/api/extract/url", async (req, res) => {
    const body = (req.body ?? {}) as {
      url?: string;
      entityType?: string;
      contributorName?: string;
      contributorEmail?: string;
    };

    if (!body.url || typeof body.url !== "string") {
      return res.status(400).json({ message: "url is required" });
    }
    if (body.entityType && !ALLOWED_ENTITY_TYPES.has(body.entityType)) {
      return res.status(400).json({
        message: `Unsupported entityType: ${body.entityType}`,
        allowed: Array.from(ALLOWED_ENTITY_TYPES),
      });
    }

    let draft;
    try {
      draft = await extractDraftFromUrl(body.url, deps);
    } catch (error) {
      if (error instanceof UrlExtractionError) {
        return res.status(400).json({ message: error.message });
      }
      console.error("URL extraction failed:", error);
      return res.status(502).json({ message: "Failed to resolve the source URL" });
    }

    const { contribution, validation } = contributions.submit(
      draftToContribution(draft, {
        entityType: body.entityType as ContributionEntityType | undefined,
        contributorName: body.contributorName,
        contributorEmail: body.contributorEmail,
      }),
    );

    if (!contribution) {
      return res.status(400).json({
        message: "Extracted draft failed validation",
        errors: validation.errors,
        warnings: validation.warnings,
      });
    }

    return res.status(201).json({ draft, contribution, warnings: validation.warnings });
  });
}
