/**
 * Community verification & culture stewardship routes (US-012) — **fully ported
 * away** (pinakes:61 US-2 took the stewardship third, pinakes:80 US-1 the rest;
 * docs/UNIFIED-PROJECT-PLAN.md §7).
 *
 * Nothing here is served any more. The five paths stay *registered* rather than
 * deleted, because the path set is what `contracts/parity/openapi.json` was
 * harvested from — removing a registration would rewrite the very baseline the
 * port is graded against — and each answers **501** naming the Python module
 * that replaced it:
 *
 * - `GET  /api/stewardship` (optional `?domain=`), `POST /api/stewardship/adopt`
 *   and `POST /api/stewardship/release` →
 *   `services/api/src/pinakes/routers/stewardship.py` over
 *   `pinakes.collab.stewardship`.
 * - `POST /api/contributions/:id/confirm` and
 *   `GET  /api/contributions/:id/verification` →
 *   `services/api/src/pinakes/routers/community_verification.py` over
 *   `pinakes.collab.verification` + `pinakes.contributions.store.confirm`.
 *
 * **The split between those two hand-offs is over, and with it the thing that
 * made it safe.** The confirm handler used to ask `stewards.isSteward(...)` from
 * this process, reading the roster the Python service had already taken over
 * writing — one shared `data/runtime/stewardship/stewards.json` is what let the
 * two halves of one file be ported a band apart. Both sides of that question are
 * now in the same process.
 *
 * `services/community-verification.ts` and `services/stewardship.ts` are **not**
 * retired: they are the graded spec, and their unit tests are what say the two
 * implementations agree about thresholds, dedup and domain resolution.
 */

import type { Express, Request, Response } from "express";

/** The Python modules that now serve these routes, by path. */
export const PORTED_TO = {
  stewardship: "services/api/src/pinakes/routers/stewardship.py",
  verification: "services/api/src/pinakes/routers/community_verification.py",
} as const;

/**
 * The routes this backend handed over, by method, each with the module that
 * serves it now.
 *
 * All five this file registers. Confirm and verification are a *different* port
 * unit from the three `/api/stewardship*` paths — they are about the
 * contribution queue, not about who has claimed what — which is why they moved
 * in a different band and why they name a different replacement.
 */
export const PORTED_ROUTES = {
  get: [
    ["/api/stewardship", PORTED_TO.stewardship],
    ["/api/contributions/:id/verification", PORTED_TO.verification],
  ],
  post: [
    ["/api/stewardship/adopt", PORTED_TO.stewardship],
    ["/api/stewardship/release", PORTED_TO.stewardship],
    ["/api/contributions/:id/confirm", PORTED_TO.verification],
  ],
} as const satisfies Record<string, ReadonlyArray<readonly [string, string]>>;

/** Machine-readable discriminator in a retired route's body. */
export const PORTED_ERROR = "ported";

/**
 * A handler for a route this backend no longer owns.
 *
 * 501, not 404 or 503: the route still exists in the API contract and something
 * does serve it — just not this process.
 */
function portedToPython(route: string, servedBy: string) {
  return (_req: Request, res: Response): void => {
    res.status(501).json({
      error: PORTED_ERROR,
      message:
        `${route} has been ported to the Python service and is served there ` +
        `(${servedBy}). The Express handler is retired.`,
      route,
      servedBy,
      coverage: "/api/_parity/coverage",
    });
  };
}

export function registerCommunityVerificationRoutes(app: Express): void {
  for (const [route, servedBy] of PORTED_ROUTES.get) {
    app.get(route, portedToPython(`GET ${route}`, servedBy));
  }
  for (const [route, servedBy] of PORTED_ROUTES.post) {
    app.post(route, portedToPython(`POST ${route}`, servedBy));
  }
}
