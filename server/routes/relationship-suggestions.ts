/**
 * Authoring-time suggested relationships route (US-010) — **ported to Python**
 * (pinakes:65 US-2).
 *
 * `GET` and `POST /api/relationships/suggestions` are served by
 * `services/api/src/pinakes/routers/relationships.py` over
 * `pinakes.authoring.suggestions`, ranked over the same candidate pool
 * (`pinakes.authoring.candidates`, the port of `defaultLoadEntities`) and
 * excluded against the same corpus edges. Both handlers here answer **501**
 * naming their replacement.
 *
 * These endpoints never created an edge on either backend — they rank and
 * return; the contributor confirms through `POST /api/relationships/edge`. That
 * is why porting them changes nothing about what may be written.
 *
 * `services/relationship-suggestions.ts` is **not** retired: it is the graded
 * spec, and its unit tests are what say the two rankers agree — in particular
 * that a dimension neither entity can supply is *unmeasured* rather than zero.
 */

import type { Express, Request, Response } from "express";

/** The Python module that owns these routes now. */
export const PORTED_TO = "services/api/src/pinakes/routers/relationships.py";

/** Machine-readable discriminator in a retired route's body. */
export const PORTED_ERROR = "ported";

/** The route this file no longer serves (both methods). */
export const PORTED_ROUTE = "/api/relationships/suggestions";

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

export function registerRelationshipSuggestionRoutes(app: Express): void {
  app.get(PORTED_ROUTE, portedToPython(`GET ${PORTED_ROUTE}`));
  app.post(PORTED_ROUTE, portedToPython(`POST ${PORTED_ROUTE}`));
}
