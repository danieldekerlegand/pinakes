/**
 * First-party `/api/graph/*` routes (US-004) — **mostly ported away** (pinakes:50
 * US-2, docs/UNIFIED-PROJECT-PLAN.md §5 Phase 1).
 *
 * Eight of these routes are now served by the Python service, in-process over
 * `pinakes_engine`, and their Express handlers have been retired: they answer
 * **501** naming the module that replaced them, so a caller still on this origin
 * gets told where the route went instead of being served a second, drifting
 * implementation. This file keeps registering the paths rather than deleting
 * them, and that is deliberate — the path set is what
 * `contracts/parity/openapi.json` was harvested from and what the §10b catalog
 * guard reads, so removing a registration would rewrite the very baseline the
 * port is graded against.
 *
 * Two routes are still genuinely served here, because neither is engine-backed:
 *
 * - **`/api/graph/resolve`** — the convergence alias table, loaded from the local
 *   lexicons, which answers even while the graph is offline;
 * - **`/api/graph/status`** — the availability probe. The Python service serves
 *   its own (`pinakes.routers.graph`), but this one keeps answering because its
 *   recorded fixture (`contracts/parity/fixtures/get-graph-status.json`) is
 *   replayed against *this* app: a baseline that stops reproducing its own
 *   recording is no longer a baseline.
 *
 * Both still degrade gracefully (docs/engine-integration.md §10b): an unreachable
 * backend answers HTTP 503 with a structured `{ available: false }` body and
 * never crashes the process; an unusable upstream response maps to 502.
 */
import { type Express, type Request, type Response } from "express";
import { GraphUnavailableError } from "../services/graph-store";
import {
  EngineError,
  EngineUnavailableError,
} from "../services/engine-client";
import { getGraphHealth } from "../services/graph-health";
import { getGraphResolver, type EntityRef } from "../services/graph-resolver";

/**
 * Map a caught error to an Express response, preserving the graceful-degradation
 * contract: an "unavailable" error becomes 503 `{ available: false }`; an upstream
 * "bad response" becomes 502; anything else becomes 500. Never throws.
 */
function handleError(res: Response, context: string, error: unknown): void {
  if (
    error instanceof GraphUnavailableError ||
    error instanceof EngineUnavailableError
  ) {
    res.status(503).json({
      available: false,
      error: `${context} is unavailable`,
      detail: error.message,
    });
    return;
  }
  if (error instanceof EngineError) {
    res.status(502).json({
      available: true,
      error: `${context} returned an unusable response`,
      detail: error.message,
    });
    return;
  }
  console.error(`Unexpected error in ${context}:`, error);
  res.status(500).json({
    error: `${context} failed`,
    detail: error instanceof Error ? error.message : "Unknown error",
  });
}

/** The Python module that now serves the ported routes. */
export const PORTED_TO = "services/api/src/pinakes/routers/graph.py";

/**
 * The routes this backend handed over, by method.
 *
 * Everything engine-backed: the three corpus/console surfaces that used to take
 * an HTTP hop to the sidecar and the three Neo4j reads that used to take a second
 * driver written in TypeScript. `/api/graph/resolve` and `/api/graph/status` are
 * absent because they are still served below.
 */
export const PORTED_ROUTES = {
  get: [
    "/api/graph/search",
    "/api/graph/node/:id",
    "/api/graph/neighborhood/:id",
    "/api/graph/overview",
    "/api/graph/retrieve",
    "/api/graph/metrics",
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
   * GET /api/graph/resolve?type=&id=&name=&region= — resolve a pinakes
   * entity ref to its shared-graph csid (US-006) so "Show in graph" affordances
   * can jump into the neighborhood view. Backed by the convergence alias table,
   * which is loaded from the local lexicons and so does NOT depend on Neo4j —
   * resolution succeeds even while the graph itself is offline. Always 200 with
   * `{ resolved: { csid, confidence, method } | null }`; `null` covers both a
   * no-match and an ambiguous match (which the resolver refuses to guess at).
   */
  app.get("/api/graph/resolve", (req: Request, res: Response) => {
    const type = typeof req.query.type === "string" ? req.query.type.trim() : "";
    if (!type) {
      res.status(400).json({ error: "type is required" });
      return;
    }
    const str = (v: unknown): string | undefined =>
      typeof v === "string" && v.trim() ? v.trim() : undefined;
    const ref: EntityRef = {
      type,
      id: str(req.query.id),
      name: str(req.query.name),
      region: str(req.query.region),
    };
    try {
      const resolved = getGraphResolver().resolve(ref);
      res.json({ resolved });
    } catch (error) {
      handleError(res, "graph entity resolution", error);
    }
  });

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