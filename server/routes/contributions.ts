/**
 * Contribution API routes (Phase 5; hardened in US-011) — **mostly ported away**
 * (pinakes:60 US-1, docs/UNIFIED-PROJECT-PLAN.md §7).
 *
 * The public contribution surface is now served by the Python service, over the
 * same `data/runtime/contributions` queue this file's `ContributionService`
 * writes. The Express handlers for those routes are retired: they answer **501**
 * naming the module that replaced them, so a caller still on this origin is told
 * where the route went instead of being served a second, drifting queue.
 *
 * This file keeps *registering* the paths rather than deleting them, and that is
 * deliberate — the path set is what `contracts/parity/openapi.json` was
 * harvested from, so removing a registration would rewrite the very baseline the
 * port is graded against.
 *
 * Two routes are still genuinely served here:
 *
 * - **`GET /api/openapi.json`** — its own port unit. It publishes the spec for
 *   the *whole* Express surface, most of which is still Express's, so it cannot
 *   move until the surface does.
 * - **`GET /api/contributions/stats`** — the Python service serves its own
 *   (`pinakes.routers.contributions`), but this one keeps answering because its
 *   recorded fixture (`contracts/parity/fixtures/get-contributions-stats.json`)
 *   is replayed against *this* app: a baseline that stops reproducing its own
 *   recording is no longer a baseline.
 *
 * `ContributionService` stays injectable for the same reason it always was —
 * `changelog.test.ts` and the authoring routes still construct one against a
 * temp dir.
 */

import type { Express, Request, Response } from "express";
import { ContributionService } from "../services/contribution-service";
import { buildOpenApiSpec } from "../services/openapi-spec";

export interface ContributionRoutesOptions {
  contributions?: ContributionService;
}

/** The Python module that now serves the ported routes. */
export const PORTED_TO = "services/api/src/pinakes/routers/contributions.py";

/**
 * The routes this backend handed over, by method.
 *
 * `/api/contributions/stats` is absent because it is still served below, and
 * `/api/openapi.json` because it was never part of this port unit. The one `get`
 * entry split out as `getAfterStats` is `/:id`, which would otherwise swallow
 * `/stats` — Express matches in registration order, and that ordering outlived
 * the handlers it used to protect.
 */
export const PORTED_ROUTES = {
  get: [
    "/api/contributions",
    "/api/contributions/export",
    "/api/contributions/entity/:entityType/:entityId",
  ],
  getAfterStats: ["/api/contributions/:id"],
  post: ["/api/contributions"],
  patch: ["/api/contributions/:id/review"],
} as const;

/** Machine-readable discriminator in a retired route's body. */
export const PORTED_ERROR = "ported";

/**
 * A handler for a route this backend no longer owns.
 *
 * 501, not 404 or 503: the route still exists in the API contract and something
 * does serve it — just not this process. A 404 would say "gone", and a 503 would
 * invite a retry that can never succeed. The body names the replacement so the
 * hand-off is discoverable from the response rather than from a changelog.
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

export function registerContributionRoutes(
  app: Express,
  options: ContributionRoutesOptions = {},
): void {
  const contributions = options.contributions ?? new ContributionService();

  /**
   * GET /api/openapi.json - Published OpenAPI spec for the contribution + read API.
   */
  app.get("/api/openapi.json", (_req, res) => {
    res.json(buildOpenApiSpec());
  });

  // ── Ported to the Python service (pinakes:60 US-1) ────────────────────────
  //
  // Registered, not deleted: the path set is the parity baseline's own harvest
  // source. Each answers 501 naming its replacement — see the module docstring.
  // Declared before `/api/contributions/:id` for the same reason the real
  // handlers were: Express matches in registration order.
  for (const route of PORTED_ROUTES.post) {
    app.post(route, portedToPython(`POST ${route}`));
  }
  for (const route of PORTED_ROUTES.get) {
    app.get(route, portedToPython(`GET ${route}`));
  }

  /**
   * GET /api/contributions/stats - Contribution statistics.
   *
   * The last read still served here — see the module docstring. Registered
   * before `/api/contributions/:id` so "stats" is not read as a contribution id.
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

  for (const route of PORTED_ROUTES.getAfterStats) {
    app.get(route, portedToPython(`GET ${route}`));
  }
  for (const route of PORTED_ROUTES.patch) {
    app.patch(route, portedToPython(`PATCH ${route}`));
  }
}
