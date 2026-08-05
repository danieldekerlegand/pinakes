/**
 * Drawn-geometry authoring route (US-001) — **ported to Python** (pinakes:65 US-2).
 *
 * `POST /api/map/drawn-geometry` and `GET /api/map/drawn-geometry/targets` are
 * served by `services/api/src/pinakes/routers/drawn_geometry.py` over
 * `pinakes.authoring.drawn_geometry`, against the same contribution queue. Both
 * handlers here answer **501** naming their replacement.
 *
 * Neither route carries a recorded parity fixture, so unlike
 * `POST /api/timeline/event` this group handed over cleanly — there is nothing
 * left driving it on this origin.
 *
 * `services/drawn-geometry.ts` is **not** retired: it is the graded spec, and
 * `services/drawn-geometry.test.ts` is what says the two validators agree about
 * closed rings, world bounds and target/geometry disagreement.
 */

import type { Express, Request, Response } from "express";

/** The Python module that owns these routes now. */
export const PORTED_TO = "services/api/src/pinakes/routers/drawn_geometry.py";

/** Machine-readable discriminator in a retired route's body. */
export const PORTED_ERROR = "ported";

/** The routes this file no longer serves. */
export const PORTED_ROUTES = {
  submit: "/api/map/drawn-geometry",
  targets: "/api/map/drawn-geometry/targets",
} as const;

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

export function registerDrawnGeometryRoutes(app: Express): void {
  app.post(PORTED_ROUTES.submit, portedToPython(`POST ${PORTED_ROUTES.submit}`));
  app.get(PORTED_ROUTES.targets, portedToPython(`GET ${PORTED_ROUTES.targets}`));
}
