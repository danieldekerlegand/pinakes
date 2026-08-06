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
 * One route is still genuinely served here:
 *
 * - **`GET /api/contributions/stats`** — the Python service serves its own
 *   (`pinakes.routers.contributions`), but this one keeps answering because its
 *   recorded fixture (`contracts/parity/fixtures/get-contributions-stats.json`)
 *   is replayed against *this* app: a baseline that stops reproducing its own
 *   recording is no longer a baseline.
 *
 * **`GET /api/openapi.json` was the last route of the whole cutover** and is
 * retired here (pinakes:80 US-1). It is its own port unit — it publishes the
 * spec for the *whole* public surface, so it could not move until that surface
 * did — and it is now `services/api/src/pinakes/routers/openapi.py` over
 * `pinakes.openapi_spec`. `services/openapi-spec.ts` is **not** retired: it is
 * the graded spec, and `openapi-spec.test.ts` asserts it byte-equal against
 * `docs/openapi.json` — the same assertion the Python port's test makes against
 * the same snapshot, which is what says the two documents are one document.
 *
 * `ContributionService` stays injectable for the same reason it always was —
 * `changelog.test.ts` and the authoring routes still construct one against a
 * temp dir.
 */

import type { Express, Request, Response } from "express";
import { ContributionService } from "../services/contribution-service";

export interface ContributionRoutesOptions {
  contributions?: ContributionService;
}

/** The Python module that now serves the ported contribution routes. */
export const PORTED_TO = "services/api/src/pinakes/routers/contributions.py";

/**
 * The Python module that now serves `GET /api/openapi.json`.
 *
 * A different file because it is a different port unit: the document describes
 * the published API, not the queue.
 */
export const PORTED_TO_OPENAPI = "services/api/src/pinakes/routers/openapi.py";

/**
 * The routes this backend handed over, by method.
 *
 * `/api/contributions/stats` is absent because it is still served below. The
 * one `get` entry split out as `getAfterStats` is `/:id`, which would otherwise
 * swallow `/stats` — Express matches in registration order, and that ordering
 * outlived the handlers it used to protect.
 */
export const PORTED_ROUTES = {
  get: [
    "/api/openapi.json",
    "/api/contributions",
    "/api/contributions/export",
    "/api/contributions/entity/:entityType/:entityId",
  ],
  getAfterStats: ["/api/contributions/:id"],
  post: ["/api/contributions"],
  patch: ["/api/contributions/:id/review"],
} as const;

/** Which replacement a retired path names. Everything but the spec is the queue. */
function servedBy(route: string): string {
  return route === "/api/openapi.json" ? PORTED_TO_OPENAPI : PORTED_TO;
}

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
function portedToPython(route: string, target: string) {
  return (_req: Request, res: Response): void => {
    res.status(501).json({
      error: PORTED_ERROR,
      message:
        `${route} has been ported to the Python service and is served there ` +
        `(${target}). The Express handler is retired.`,
      route,
      servedBy: target,
      coverage: "/api/_parity/coverage",
    });
  };
}

export function registerContributionRoutes(
  app: Express,
  options: ContributionRoutesOptions = {},
): void {
  const contributions = options.contributions ?? new ContributionService();

  // ── Ported to the Python service (pinakes:60 US-1, and `/api/openapi.json`
  // in pinakes:80 US-1) ─────────────────────────────────────────────────────
  //
  // Registered, not deleted: the path set is the parity baseline's own harvest
  // source. Each answers 501 naming its replacement — see the module docstring.
  // Declared before `/api/contributions/:id` for the same reason the real
  // handlers were: Express matches in registration order.
  for (const route of PORTED_ROUTES.post) {
    app.post(route, portedToPython(`POST ${route}`, servedBy(route)));
  }
  for (const route of PORTED_ROUTES.get) {
    app.get(route, portedToPython(`GET ${route}`, servedBy(route)));
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
    app.get(route, portedToPython(`GET ${route}`, servedBy(route)));
  }
  for (const route of PORTED_ROUTES.patch) {
    app.patch(route, portedToPython(`PATCH ${route}`, servedBy(route)));
  }
}
