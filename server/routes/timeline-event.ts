/**
 * Timeline-event authoring route (US-002).
 *
 * `POST /api/timeline/event` accepts an event/period authored on the temporal
 * axis plus its entity/time association, and lands it in the *contribution
 * review queue* with provenance `source = 'user-authored'` — it never writes the
 * source-of-truth TSVs directly (a reviewer promotes it, US-009).
 *
 * The `ContributionService` is injectable so tests can point it at a temp dir
 * (see `server/routes/drawn-geometry.test.ts` for the pattern).
 */

import type { Express } from "express";
import { ContributionService } from "../services/contribution-service";
import {
  validateTimelineEvent,
  timelineEventToContribution,
  TIMELINE_LANES,
  TIMELINE_MAGNITUDES,
  TIMELINE_ENTRY_KINDS,
  TIMELINE_MIN_YEAR,
  TIMELINE_MAX_YEAR,
  type TimelineEventInput,
} from "../services/timeline-event";

export function registerTimelineEventRoutes(
  app: Express,
  contributions: ContributionService = new ContributionService(),
): void {
  /**
   * POST /api/timeline/event
   * Body: TimelineEventInput. Returns 201 with the queued contribution, or 400
   * with validation errors.
   */
  app.post("/api/timeline/event", (req, res) => {
    try {
      const input = req.body as Partial<TimelineEventInput>;

      const validation = validateTimelineEvent(input);
      if (!validation.valid) {
        return res.status(400).json({
          message: "Invalid timeline entry",
          errors: validation.errors,
          warnings: validation.warnings,
        });
      }

      const { contribution, validation: contribValidation } = contributions.submit(
        timelineEventToContribution(input as TimelineEventInput),
      );

      if (!contribution) {
        return res.status(400).json({
          message: "Invalid timeline entry",
          errors: contribValidation.errors,
          warnings: contribValidation.warnings,
        });
      }

      return res.status(201).json({
        contribution,
        warnings: [...validation.warnings, ...contribValidation.warnings],
      });
    } catch (error) {
      console.error("Error submitting timeline entry:", error);
      return res.status(500).json({ message: "Failed to submit timeline entry" });
    }
  });

  /**
   * GET /api/timeline/event/options — the vocabulary + year bounds the client's
   * authoring form needs (kinds, lanes, magnitudes, min/max year).
   */
  app.get("/api/timeline/event/options", (_req, res) => {
    res.json({
      kinds: TIMELINE_ENTRY_KINDS,
      lanes: TIMELINE_LANES,
      magnitudes: TIMELINE_MAGNITUDES,
      minYear: TIMELINE_MIN_YEAR,
      maxYear: TIMELINE_MAX_YEAR,
    });
  });
}
