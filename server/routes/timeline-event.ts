/**
 * Timeline-event authoring route (US-002) — **ported to Python** (pinakes:65
 * US-2), except that the POST keeps answering here too.
 *
 * `services/api/src/pinakes/routers/timeline.py` serves both routes over
 * `pinakes.authoring.timeline_event`, against the same contribution queue.
 * `GET /api/timeline/event/options` is retired to **501**;
 * `POST /api/timeline/event` is **not**, because
 * `contracts/parity/parity.test.ts` replays its recorded
 * `post-timeline-event-invalid` fixture against *this* app — retiring it would
 * break the baseline the port is graded against. Same standing as
 * `GET /api/citations` and `GET /api/search`.
 *
 * Serving the POST on both origins is safe for a stronger reason than usual:
 * the recorded case is a **validation rejection**, refused before either
 * backend touches the queue, and `services/api/tests/test_timeline_event.py`
 * asserts the two 400 bodies are equal error for error.
 *
 * The `ContributionService` is injectable so tests can point it at a temp dir
 * (see `server/routes/drawn-geometry.test.ts` for the pattern).
 */

import type { Express, Request, Response } from "express";
import { ContributionService } from "../services/contribution-service";
import {
  validateTimelineEvent,
  timelineEventToContribution,
  type TimelineEventInput,
} from "../services/timeline-event";

/** The Python module that owns this group now. */
export const PORTED_TO = "services/api/src/pinakes/routers/timeline.py";

/** Machine-readable discriminator in a retired route's body. */
export const PORTED_ERROR = "ported";

/** The one route in this group that no longer answers here. */
export const PORTED_ROUTE = "/api/timeline/event/options";

/**
 * A handler for a route this backend no longer owns.
 *
 * 501, not 404 or 503: the route still exists in the API contract and something
 * does serve it — just not this process.
 */
function portedToPython(route: string) {
  return (_req: Request, res: Response): void => {
    res.status(501).json({
      error: PORTED_ERROR,
      message:
        `${route} has been ported to the Python service and is served there ` +
        `(${PORTED_TO}). The Express handler is retired.`,
      route,
      servedBy: PORTED_TO,
      coverage: "/api/_parity/coverage",
    });
  };
}

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

  app.get(PORTED_ROUTE, portedToPython(`GET ${PORTED_ROUTE}`));
}
