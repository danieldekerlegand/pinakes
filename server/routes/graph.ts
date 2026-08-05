/**
 * First-party `/api/graph/*` routes (US-004) — **mostly ported away** (pinakes:50
 * US-2, docs/UNIFIED-PROJECT-PLAN.md §5 Phase 1).
 *
 * Nine of these routes are now served by the Python service, in-process over
 * `pinakes_engine`, and their Express handlers have been retired: they answer
 * **501** naming the module that replaced them, so a caller still on this origin
 * gets told where the route went instead of being served a second, drifting
 * implementation. This file keeps registering the paths rather than deleting
 * them, and that is deliberate — the path set is what
 * `contracts/parity/openapi.json` was harvested from and what the §10b catalog
 * guard reads, so removing a registration would rewrite the very baseline the
 * port is graded against.
 *
 * One route is still genuinely served here:
 *
 * - **`/api/graph/status`** — the availability probe. The Python service serves
 *   its own (`pinakes.routers.graph`), but this one keeps answering because its
 *   recorded fixture (`contracts/parity/fixtures/get-graph-status.json`) is
 *   replayed against *this* app: a baseline that stops reproducing its own
 *   recording is no longer a baseline.
 *
 * `/api/graph/resolve` was the last non-engine-backed holdout — it reads the
 * convergence alias table off the local lexicons, so it answers while the graph
 * is offline — and pinakes:65 US-1 handed it over once
 * `pinakes.search.graph_resolver` was there to read the same table.
 */
import { type Express, type Request, type Response } from "express";
import { getGraphHealth } from "../services/graph-health";

/** The Python module that now serves the ported routes. */
export const PORTED_TO = "services/api/src/pinakes/routers/graph.py";

/**
 * The routes this backend handed over, by method.
 *
 * Everything engine-backed: the three corpus/console surfaces that used to take
 * an HTTP hop to the sidecar and the three Neo4j reads that used to take a second
 * driver written in TypeScript — plus the lexicon-backed `/api/graph/resolve`
 * (pinakes:65 US-1). Only `/api/graph/status` is absent, because it is still
 * served below.
 */
export const PORTED_ROUTES = {
  get: [
    "/api/graph/search",
    "/api/graph/node/:id",
    "/api/graph/neighborhood/:id",
    "/api/graph/overview",
    "/api/graph/retrieve",
    "/api/graph/metrics",
    "/api/graph/resolve",
  ],
  post: ["/api/graph/datalog", "/api/graph/cypher"],
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

/**
 * Register the `/api/graph/*` routes on the given Express app. Kept as a
 * standalone function (rather than inline in routes.ts) so the routes can be
 * mounted and exercised in isolation by the integration tests.
 */
export function registerGraphRoutes(app: Express): void {

  // ── Ported to the Python service (pinakes:50 US-2) ────────────────────────
  //
  // Registered, not deleted: the path set is the parity baseline's own harvest
  // source and the §10b catalog guard's input. Each answers 501 naming its
  // replacement — see the module docstring.
  for (const route of PORTED_ROUTES.get) {
    app.get(route, portedToPython(`GET ${route}`));
  }
  for (const route of PORTED_ROUTES.post) {
    app.post(route, portedToPython(`POST ${route}`));
  }

  /**
   * GET /api/graph/status — availability of both backends, via the aggregated
   * graph-health service (short-cached). Always 200 (it is a health probe, not
   * itself graph-dependent); `available` is true when either backend is
   * reachable, with the per-backend flags for finer-grained UI gating and a
   * `checkedAt` timestamp so clients can reason about staleness.
   */
  app.get("/api/graph/status", async (_req: Request, res: Response) => {
    const health = await getGraphHealth();
    res.json(health);
  });
}