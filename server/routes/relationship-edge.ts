/**
 * Relationship-builder authoring route (US-003) — **ported to Python**
 * (pinakes:65 US-2).
 *
 * `POST /api/relationships/edge` and `GET /api/relationships/edge/options` are
 * served by `services/api/src/pinakes/routers/relationships.py` over
 * `pinakes.authoring.relationship_edge`, against the same contribution queue
 * and the same corpus edges — `pinakes.lexicons.canonical_edges` extracts the
 * identical 5,836 edges (and reports the identical 1,531 skips) from the live
 * lexicons that `services/canonical-edges.ts` does. Both handlers here answer
 * **501** naming their replacement.
 *
 * Neither route carries a recorded parity fixture, so this group handed over
 * cleanly.
 *
 * `services/relationship-edge.ts` and `services/canonical-edges.ts` are **not**
 * retired. Both are the graded spec, and `canonical-edges.ts` additionally still
 * has a live TypeScript consumer: `scripts/export-for-engine.ts` reads it to
 * write the canonical `build/corpus/` TSVs. The Python twin is the *dedup*
 * reader only — do not merge them without moving the exporter too.
 */

import type { Express, Request, Response } from "express";

/** The Python module that owns these routes now. */
export const PORTED_TO = "services/api/src/pinakes/routers/relationships.py";

/** Machine-readable discriminator in a retired route's body. */
export const PORTED_ERROR = "ported";

/** The routes this file no longer serves. */
export const PORTED_ROUTES = {
  edge: "/api/relationships/edge",
  options: "/api/relationships/edge/options",
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

export function registerRelationshipEdgeRoutes(app: Express): void {
  app.post(PORTED_ROUTES.edge, portedToPython(`POST ${PORTED_ROUTES.edge}`));
  app.get(PORTED_ROUTES.options, portedToPython(`GET ${PORTED_ROUTES.options}`));
}
