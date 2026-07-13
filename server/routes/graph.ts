/**
 * First-party `/api/graph/*` routes (US-004).
 *
 * The browser talks only to the LinguaScrape origin; these routes proxy the
 * shared culture-scrape graph on the server's behalf. Node/neighborhood lookups
 * go through the Neo4j driver layer (server/services/graph-store.ts); search and
 * metrics go through the FastAPI sidecar client (culturescrape-client.ts).
 *
 * Everything degrades gracefully (docs/culturescrape-integration.md): when the
 * graph or sidecar is unreachable the handlers answer HTTP 503 with a structured
 * `{ available: false }` body and never crash the process. A malformed upstream
 * response (schema failure / non-JSON) maps to 502; a missing node maps to 404.
 */
import express, { type Express, type Request, type Response } from "express";
import * as graphStore from "../services/graph-store";
import { GraphUnavailableError } from "../services/graph-store";
import * as culturescrape from "../services/culturescrape-client";
import {
  CultureScrapeError,
  CultureScrapeUnavailableError,
} from "../services/culturescrape-client";
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
    error instanceof CultureScrapeUnavailableError
  ) {
    res.status(503).json({
      available: false,
      error: `${context} is unavailable`,
      detail: error.message,
    });
    return;
  }
  if (error instanceof CultureScrapeError) {
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

/** Parse a `depth` query param into the 1..3 range graph-store supports. */
function parseDepth(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? graphStore.clampDepth(n) : 1;
}

/**
 * Cypher write clauses. The research console (US-011) is read-only: the browser
 * states it and the server enforces it, so a mutating query is rejected before it
 * ever reaches the sidecar rather than relying on the sidecar's own guard.
 */
const CYPHER_WRITE_CLAUSES =
  /\b(CREATE|MERGE|DELETE|SET|REMOVE|DROP|FOREACH|LOAD\s+CSV)\b/i;

/** True when `query` contains no write clause and can be run read-only. */
function isReadOnlyCypher(query: string): boolean {
  return !CYPHER_WRITE_CLAUSES.test(query);
}

// JSON body parser scoped to the console POST routes, so they work whether or not
// a global body parser is installed (it is, in server/index.ts).
const jsonBody = express.json();

/**
 * Register the `/api/graph/*` routes on the given Express app. Kept as a
 * standalone function (rather than inline in routes.ts) so the routes can be
 * mounted and exercised in isolation by the integration tests.
 */
export function registerGraphRoutes(app: Express): void {
  /**
   * GET /api/graph/search?q=&limit= — full-text search over the shared graph via
   * the sidecar. 503 when the sidecar is unavailable.
   */
  app.get("/api/graph/search", async (req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) {
      res.json({ query: "", results: [] });
      return;
    }
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
    try {
      const result = await culturescrape.search(q, limit);
      res.json(result);
    } catch (error) {
      handleError(res, "graph search", error);
    }
  });

  /**
   * GET /api/graph/node/:id — look up a single node by csid. 404 when the node
   * does not exist; 503 when Neo4j is unavailable.
   */
  app.get("/api/graph/node/:id", async (req: Request, res: Response) => {
    try {
      const node = await graphStore.getNode(req.params.id);
      if (!node) {
        res.status(404).json({ error: "node not found", csid: req.params.id });
        return;
      }
      res.json({ node });
    } catch (error) {
      handleError(res, "graph node lookup", error);
    }
  });

  /**
   * GET /api/graph/neighborhood/:id?depth= — the sub-graph around a node out to
   * `depth` (1..3) hops. 404 when the focus node does not exist; 503 when Neo4j
   * is unavailable.
   */
  app.get("/api/graph/neighborhood/:id", async (req: Request, res: Response) => {
    const depth = parseDepth(req.query.depth);
    try {
      const neighborhood = await graphStore.getNeighborhood(req.params.id, depth);
      if (!neighborhood) {
        res.status(404).json({ error: "node not found", csid: req.params.id });
        return;
      }
      res.json(neighborhood);
    } catch (error) {
      handleError(res, "graph neighborhood", error);
    }
  });

  /**
   * GET /api/graph/overview?limit= — a bounded `{ nodes, edges }` snapshot of the
   * shared graph, powering the shared-graph dataset in the UnifiedExplorer
   * (US-008). Backed by Neo4j; 503 when the graph is unavailable.
   */
  app.get("/api/graph/overview", async (req: Request, res: Response) => {
    const limitRaw = Number(req.query.limit);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
    try {
      const snapshot = await graphStore.getGraphOverview(limit);
      res.json(snapshot);
    } catch (error) {
      handleError(res, "graph overview", error);
    }
  });

  /**
   * GET /api/graph/retrieve?q=&k=&depth= — hybrid GraphRAG retrieval over the
   * shared graph via the sidecar: the query is embedded, the top-`k` nearest nodes
   * come from the Neo4j native vector index, and each is expanded into a subgraph.
   * An empty query short-circuits to an empty result without calling the sidecar.
   * 503 `{ available:false }` when GraphRAG is unavailable (the sidecar's embedder
   * or Neo4j connection is absent, or the sidecar itself is down) — the same
   * graceful-degradation contract as the rest of `/api/graph/*`.
   */
  app.get("/api/graph/retrieve", async (req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) {
      res.json({ query: "", seeds: [], nodes: [], edges: [] });
      return;
    }
    const kRaw = Number(req.query.k);
    const k = Number.isFinite(kRaw) && kRaw > 0 ? kRaw : undefined;
    const depthRaw = Number(req.query.depth);
    const depth = Number.isFinite(depthRaw) && depthRaw >= 0 ? depthRaw : undefined;
    try {
      const result = await culturescrape.retrieve(q, { k, depth });
      res.json(result);
    } catch (error) {
      handleError(res, "graph retrieval", error);
    }
  });

  /**
   * GET /api/graph/metrics — graph-level metrics from the sidecar. 503 when the
   * sidecar is unavailable.
   */
  app.get("/api/graph/metrics", async (_req: Request, res: Response) => {
    try {
      const metrics = await culturescrape.metrics();
      res.json(metrics);
    } catch (error) {
      handleError(res, "graph metrics", error);
    }
  });

  /**
   * GET /api/graph/resolve?type=&id=&name=&region= — resolve a LinguaScrape
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
   * POST /api/graph/datalog — run a read-only Datalog inference query through the
   * sidecar's `/datalog` console (US-011). Body: `{ goal }` for an ad-hoc `main/0`
   * goal, or `{ example }` to run one of the sidecar's shipped example slugs; at
   * least one is required (400 otherwise). The sidecar's own outcome — including a
   * lint `error`/`reason` when SWI-Prolog is absent — is passed straight through so
   * problems are surfaced, not swallowed. 503 when the sidecar is unavailable.
   */
  app.post("/api/graph/datalog", jsonBody, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { goal?: unknown; example?: unknown };
    const goal = typeof body.goal === "string" ? body.goal.trim() : "";
    const example = typeof body.example === "string" ? body.example.trim() : "";
    if (!goal && !example) {
      res.status(400).json({ error: "a datalog goal or example is required" });
      return;
    }
    try {
      const result = await culturescrape.datalog({
        goal: goal || undefined,
        example: example || undefined,
      });
      res.json(result);
    } catch (error) {
      handleError(res, "datalog query", error);
    }
  });

  /**
   * POST /api/graph/cypher — run a read-only Cypher query through the sidecar's
   * `/neo4j` console (US-011). Body: `{ query }`. The query is rejected with 400
   * when it is empty or contains a write clause (CREATE/MERGE/DELETE/SET/…), so the
   * console cannot mutate the shared graph. A sidecar error (e.g. a syntax error)
   * comes back as 502 with its detail, not swallowed; 503 when it is unavailable.
   */
  app.post("/api/graph/cypher", jsonBody, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { query?: unknown };
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      res.status(400).json({ error: "a cypher query is required" });
      return;
    }
    if (!isReadOnlyCypher(query)) {
      res.status(400).json({
        error: "the research console is read-only",
        detail:
          "write clauses (CREATE, MERGE, DELETE, SET, REMOVE, DROP, FOREACH, LOAD CSV) are not permitted",
      });
      return;
    }
    try {
      const result = await culturescrape.cypher(query);
      res.json(result);
    } catch (error) {
      handleError(res, "cypher query", error);
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
