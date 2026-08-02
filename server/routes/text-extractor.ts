/**
 * LLM text-extraction route (US-008).
 *
 * `POST /api/extract/text` accepts a pasted paragraph and returns a structured
 * draft — entities (name, description, coordinates, dates) and relationships,
 * each with per-field confidence — **and** queues one contribution per entity in
 * the review queue flagged `aiGenerated`/`autoDerived` (provenance
 * `source='ai-extracted'`). It never writes the live dataset — a reviewer (US-009)
 * promotes it later.
 *
 * Both the LLM boundary (`TextExtractorDeps`) and the `ContributionService` are
 * injectable so tests use recorded fixtures + a temp-dir queue (no live model
 * call, no API key). See `server/routes/text-extractor.test.ts`.
 */

import type { Express } from "express";
import { ContributionService } from "../services/contribution-service";
import {
  extractDraftFromText,
  extractionToContributions,
  liveDeps,
  TextExtractionError,
  type TextExtractorDeps,
} from "../services/text-extractor";

export interface TextExtractorRouteOptions {
  /** Contribution queue (default: real `data/runtime/contributions`). */
  contributions?: ContributionService;
  /** LLM boundary (default: live Gemini). */
  deps?: TextExtractorDeps;
}

export function registerTextExtractorRoutes(
  app: Express,
  options: TextExtractorRouteOptions = {},
): void {
  const contributions = options.contributions ?? new ContributionService();
  const deps = options.deps ?? liveDeps;

  /**
   * POST /api/extract/text
   * Body: `{ text, contributorName?, contributorEmail? }`.
   * 201 with `{ result, contributions, warnings }`; 400 on empty text;
   * 502 on an LLM/model failure.
   */
  app.post("/api/extract/text", async (req, res) => {
    const body = (req.body ?? {}) as {
      text?: string;
      contributorName?: string;
      contributorEmail?: string;
    };

    if (!body.text || typeof body.text !== "string" || !body.text.trim()) {
      return res.status(400).json({ message: "text is required" });
    }

    let result;
    try {
      result = await extractDraftFromText(body.text, deps);
    } catch (error) {
      if (error instanceof TextExtractionError) {
        return res.status(400).json({ message: error.message });
      }
      console.error("Text extraction failed:", error);
      return res.status(502).json({ message: "Failed to extract entities from the text" });
    }

    const drafts = extractionToContributions(result, {
      sourceText: body.text,
      contributorName: body.contributorName,
      contributorEmail: body.contributorEmail,
    });

    const queued = [];
    const warnings: string[] = [];
    for (const draft of drafts) {
      const { contribution, validation } = contributions.submit(draft);
      if (contribution) {
        queued.push(contribution);
      } else {
        warnings.push(
          `Skipped "${String(draft.entityData?.name ?? "?")}": ${validation.errors.join("; ")}`,
        );
      }
    }

    return res.status(201).json({ result, contributions: queued, warnings });
  });
}
