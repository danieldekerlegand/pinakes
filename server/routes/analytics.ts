/**
 * First-party `/api/analytics/*` routes — **ported away** (pinakes:62 US-1,
 * docs/UNIFIED-PROJECT-PLAN.md §7).
 *
 * The DuckDB analytical index is served by the Python service now
 * (`services/api/src/pinakes/routers/analytics.py` over
 * `pinakes.analytics.index`), against the same `data/source/lexicons/*.tsv`
 * this backend mirrored. Both handlers here are retired: they answer **501**
 * naming the module that replaced them.
 *
 * **`server/services/analytical-index.ts` is NOT retired.** It is still built at
 * startup (`server/index.ts`) and closed on shutdown, because it is the graded
 * spec for the port — its unit tests are what say the two indexes agree on
 * `read_csv`'s TSV dialect and on the facet ordering. Nothing in `server/`
 * *queries* it any more.
 *
 * The paths stay registered rather than being deleted, and that is deliberate —
 * the path set is what `contracts/parity/openapi.json` was harvested from, so
 * removing a registration would rewrite the very baseline the port is graded
 * against.
 */
import { type Express, type Request, type Response } from "express";

/** The Python module that now serves these routes. */
export const PORTED_TO = "services/api/src/pinakes/routers/analytics.py";

/** The routes this backend handed over. Both are reads. */
export const PORTED_ROUTES = {
  get: ["/api/analytics/tables", "/api/analytics/facets/:table/:column"],
} as const;

/** Machine-readable discriminator in a retired route's body. */
export const PORTED_ERROR = "ported";

/**
 * A handler for a route this backend no longer owns.
 *
 * 501, not 404 or 503: the route still exists in the API contract and something
 * does serve it — just not this process. A 404 would say "gone", and a 503 would
 * invite a retry that can never succeed.
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

export function registerAnalyticsRoutes(app: Express): void {
  for (const route of PORTED_ROUTES.get) {
    app.get(route, portedToPython(`GET ${route}`));
  }
}
