/**
 * AI-extraction review-queue routes (US-009) — **ported away** (pinakes:60 US-1,
 * docs/UNIFIED-PROJECT-PLAN.md §7).
 *
 * All three routes are now served by the Python service
 * (`pinakes.routers.ai_review`), over the same contribution queue and the same
 * `data/source/lexicons/*.tsv` corpus. Their Express handlers are retired: they
 * answer **501** naming the module that replaced them.
 *
 * Retiring *these* handlers matters more than most. This is the one review path
 * that **writes to the live corpus** — an approved draft is appended to a
 * lexicon TSV with provenance. Two implementations of that, each minting ids by
 * de-duping against what it last read, is exactly the race worth not having: the
 * promotion lives in one process now.
 *
 * The paths stay registered rather than deleted because the path set is what
 * `contracts/parity/openapi.json` was harvested from — the baseline the port is
 * graded against. `services/ai-review.ts` itself is untouched and still exports
 * the promotion primitives its own unit tests cover.
 */

import type { Express, Request, Response } from "express";
import { ContributionService } from "../services/contribution-service";
import { ChangelogStore } from "../services/changelog";

export interface AiReviewRouteOptions {
  contributions?: ContributionService;
  /** Directory holding `data/source/lexicons/*.tsv`. Accepted for compatibility;
   * the promotion that read it now happens in the Python service. */
  lexiconsDir?: string;
  /** Changelog store. Accepted for compatibility; see `lexiconsDir`. */
  changelog?: ChangelogStore;
}

/** The Python module that now serves these routes. */
export const PORTED_TO = "services/api/src/pinakes/routers/ai_review.py";

/** The routes this backend handed over, by method. */
export const PORTED_ROUTES = {
  get: ["/api/ai-review", "/api/ai-review/:id"],
  patch: ["/api/ai-review/:id"],
} as const;

/** Machine-readable discriminator in a retired route's body. */
export const PORTED_ERROR = "ported";

/**
 * A handler for a route this backend no longer owns. 501, not 404 or 503 — the
 * route exists in the contract and is served, just not by this process.
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

export function registerAiReviewRoutes(app: Express, _options: AiReviewRouteOptions = {}): void {
  for (const route of PORTED_ROUTES.get) {
    app.get(route, portedToPython(`GET ${route}`));
  }
  for (const route of PORTED_ROUTES.patch) {
    app.patch(route, portedToPython(`PATCH ${route}`));
  }
}
