/**
 * Automated hypothesis & site-location route (`GET /api/hypotheses`, US-007) —
 * **ported away** (pinakes:62 US-2, docs/UNIFIED-PROJECT-PLAN.md §7).
 *
 * The generation is served by the Python service now
 * (`services/api/src/pinakes/routers/hypotheses.py` over
 * `pinakes.analytics.hypothesis`), which carries the n-way ancestor clustering,
 * the corridor-gap heuristic, the GeoJSON overlay *and* the storage → input
 * projection this file used to own, against the same `data/source/lexicons/`
 * corpus. The handler here is retired: it answers **501** naming the module that
 * replaced it.
 *
 * **`server/services/hypothesis-generation.ts` is NOT retired.** It is the graded
 * spec — its unit tests are the statement that the two engines agree on the
 * clustering, the two structural exclusions and the uncertainty radius — exactly
 * as `services/anomaly-detection.ts` (whose primitives it still imports) is for
 * `/api/anomalies`. What stopped is only this file's *use* of it, which is why
 * `registerHypothesisRoutes` no longer takes loaders.
 *
 * The three default loaders went with it. The node projection in particular now
 * exists once, in `pinakes.analytics.anomaly.load_nodes`, instead of twice with a
 * "keep in sync" note between the copies.
 *
 * The path stays registered rather than being deleted, and that is deliberate —
 * the path set is what `contracts/parity/openapi.json` was harvested from.
 */
import { type Express, type Request, type Response } from "express";

/** The Python module that now serves this route. */
export const PORTED_TO = "services/api/src/pinakes/routers/hypotheses.py";

/** The route this backend handed over. */
export const PORTED_ROUTE = "/api/hypotheses";

/** Machine-readable discriminator in a retired route's body. */
export const PORTED_ERROR = "ported";

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

export function registerHypothesisRoutes(app: Express): void {
  app.get(PORTED_ROUTE, portedToPython(`GET ${PORTED_ROUTE}`));
}
