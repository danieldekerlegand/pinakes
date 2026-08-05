/**
 * DNA-to-culture ancestry mapping routes (US-001) — **ported to Python**
 * (pinakes:65 US-2).
 *
 * `GET /api/ancestry/haplogroups` and `POST /api/ancestry/map` are served by
 * `services/api/src/pinakes/routers/ancestry.py` over
 * `pinakes.analytics.genetic`, which now carries both halves of
 * `services/genetic-linguistic-correlation.ts` and so shares one
 * `NOTABLE_DIVERGENCES` table between the mapper and the correlation engine —
 * the thing pinakes:62 US-1 left a note asking for. Both handlers here answer
 * **501** naming their replacement.
 *
 * **The privacy guarantee is unaffected, because it was never here.** Raw-DNA
 * parsing and haplogroup inference happen in the browser (`web/src/lib/dna/*`);
 * only non-identifying haplogroup ids ever left it, and the port moved the
 * enrichment step alone.
 *
 * `services/genetic-linguistic-correlation.ts` is **not** retired — it is the
 * graded spec, and `services/ancestry-mapper.test.ts` is what says the two
 * mappers agree, including the bare-name → namespaced-id fallback without which
 * the map is empty against live data.
 */
import type { Express, Request, Response } from "express";

/** The Python module that owns these routes now. */
export const PORTED_TO = "services/api/src/pinakes/routers/ancestry.py";

/** Machine-readable discriminator in a retired route's body. */
export const PORTED_ERROR = "ported";

/** The routes this file no longer serves. */
export const PORTED_ROUTES = {
  haplogroups: "/api/ancestry/haplogroups",
  map: "/api/ancestry/map",
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

export function registerAncestryRoutes(app: Express): void {
  app.get(
    PORTED_ROUTES.haplogroups,
    portedToPython(`GET ${PORTED_ROUTES.haplogroups}`),
  );
  app.post(PORTED_ROUTES.map, portedToPython(`POST ${PORTED_ROUTES.map}`));
}
