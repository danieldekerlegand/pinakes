/**
 * First-party `/api/annotations/*` routes (US-008) — **ported away**
 * (pinakes:61 US-1, docs/UNIFIED-PROJECT-PLAN.md §7).
 *
 * User notes on entities are served by the Python service now
 * (`services/api/src/pinakes/routers/annotations.py` over
 * `pinakes.collab.annotations`), against the same `data/runtime/annotations`
 * directory this file's `AnnotationStore` wrote. Every handler here is retired
 * and answers **501** naming its replacement.
 *
 * Retiring these matters a little more than the collections beside them: the
 * privacy of this surface rests on *every* response going through `toView`, and
 * two implementations of that projection is two chances to leak an owner id.
 * One server owns it now.
 *
 * The paths stay registered rather than deleted — the path set is what
 * `contracts/parity/openapi.json` was harvested from. `server/services/
 * annotations.ts` is kept as the specification the port was read off; its unit
 * tests are the statement that the two agree.
 */
import { type Express, type Request, type Response } from "express";

/** The Python module that now serves these routes. */
export const PORTED_TO = "services/api/src/pinakes/routers/annotations.py";

/** The routes this backend handed over, by method. */
export const PORTED_ROUTES = {
  get: ["/api/annotations", "/api/annotations/:id"],
  post: ["/api/annotations"],
  patch: ["/api/annotations/:id"],
  delete: ["/api/annotations/:id"],
} as const;

/** Machine-readable discriminator in a retired route's body. */
export const PORTED_ERROR = "ported";

/**
 * A handler for a route this backend no longer owns. 501, not 404 or 503: the
 * route still exists in the API contract and something does serve it — just not
 * this process.
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

export function registerAnnotationRoutes(app: Express): void {
  for (const route of PORTED_ROUTES.get) {
    app.get(route, portedToPython(`GET ${route}`));
  }
  for (const route of PORTED_ROUTES.post) {
    app.post(route, portedToPython(`POST ${route}`));
  }
  for (const route of PORTED_ROUTES.patch) {
    app.patch(route, portedToPython(`PATCH ${route}`));
  }
  for (const route of PORTED_ROUTES.delete) {
    app.delete(route, portedToPython(`DELETE ${route}`));
  }
}
