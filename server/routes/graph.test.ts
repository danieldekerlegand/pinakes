import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Integration tests for the first-party `/api/graph/*` routes (US-004). The
 * graph-store (Neo4j) and engine-client (sidecar) are module-mocked — no
 * live Neo4j, no live network — while the real error classes are preserved so the
 * routes' `instanceof` degradation logic runs exactly as in production. The routes
 * are mounted on a real Express app and driven over real HTTP.
 */

// Shared spies, hoisted so they exist before the vi.mock factories run.
const mocks = vi.hoisted(() => ({
  getNode: vi.fn(),
  getNeighborhood: vi.fn(),
  getGraphOverview: vi.fn(),
  graphIsAvailable: vi.fn(),
  search: vi.fn(),
  metrics: vi.fn(),
  datalog: vi.fn(),
  cypher: vi.fn(),
  retrieve: vi.fn(),
  clientIsAvailable: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("../services/graph-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/graph-store")>();
  return {
    ...actual, // keep the real GraphUnavailableError + clampDepth
    getNode: mocks.getNode,
    getNeighborhood: mocks.getNeighborhood,
    getGraphOverview: mocks.getGraphOverview,
    isAvailable: mocks.graphIsAvailable,
  };
});

vi.mock("../services/engine-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/engine-client")>();
  return {
    ...actual, // keep the real CultureScrape*Error classes
    search: mocks.search,
    metrics: mocks.metrics,
    datalog: mocks.datalog,
    cypher: mocks.cypher,
    retrieve: mocks.retrieve,
    isAvailable: mocks.clientIsAvailable,
  };
});

vi.mock("../services/graph-resolver", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/graph-resolver")>();
  return {
    ...actual,
    // Resolver is lexicon-backed; stub it so the route test doesn't read disk.
    getGraphResolver: () => ({ resolve: mocks.resolve, reverse: vi.fn(), size: 0 }),
  };
});

import { registerGraphRoutes } from "./graph";
import { resetGraphHealthCache } from "../services/graph-health";
import { GraphUnavailableError } from "../services/graph-store";
import {
  CultureScrapeError,
  CultureScrapeUnavailableError,
} from "../services/engine-client";

// ── Test server ───────────────────────────────────────────────────────────────

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  app = express();
  registerGraphRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  for (const spy of Object.values(mocks)) spy.mockReset();
  // /status delegates to the short-cached graph-health service; clear it so each
  // test's mocked availability is re-probed rather than served from cache.
  resetGraphHealthCache();
});

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
}

async function post(
  path: string,
  json: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(json),
  });
  return { status: res.status, body: await res.json() };
}

const NODE = {
  csid: "cs:dish:paella",
  labels: ["Dish"],
  name: "Paella",
  properties: {},
};

// ── GET /api/graph/search ───────────────────────────────────────────────────

describe("GET /api/graph/search", () => {
  it("returns sidecar search results on success", async () => {
    mocks.search.mockResolvedValue({
      query: "paella",
      results: [{ csid: "cs:dish:paella", name: "Paella", label: "Dish" }],
    });
    const { status, body } = await get("/api/graph/search?q=paella");
    expect(status).toBe(200);
    expect(body.results).toHaveLength(1);
    expect(mocks.search).toHaveBeenCalledWith("paella", undefined);
  });

  it("passes a numeric limit through", async () => {
    mocks.search.mockResolvedValue({ query: "x", results: [] });
    await get("/api/graph/search?q=x&limit=5");
    expect(mocks.search).toHaveBeenCalledWith("x", 5);
  });

  it("short-circuits an empty query without calling the sidecar", async () => {
    const { status, body } = await get("/api/graph/search?q=%20%20");
    expect(status).toBe(200);
    expect(body).toEqual({ query: "", results: [] });
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("returns 503 { available:false } when the sidecar is unavailable", async () => {
    mocks.search.mockRejectedValue(new CultureScrapeUnavailableError("down"));
    const { status, body } = await get("/api/graph/search?q=paella");
    expect(status).toBe(503);
    expect(body.available).toBe(false);
  });

  it("returns 502 when the sidecar sends an unusable response", async () => {
    mocks.search.mockRejectedValue(new CultureScrapeError("bad body", 200));
    const { status, body } = await get("/api/graph/search?q=paella");
    expect(status).toBe(502);
    expect(body.available).toBe(true);
  });
});

// ── GET /api/graph/retrieve ──────────────────────────────────────────────────

describe("GET /api/graph/retrieve", () => {
  const RETRIEVAL = {
    query: "iron-age hillforts",
    available: true,
    backend: "neo4j",
    index: "entity_embedding",
    k: 5,
    depth: 1,
    seeds: [
      {
        csid: "cs:site:maiden-castle",
        name: "Maiden Castle",
        label: "Site",
        labels: ["Site"],
        score: 0.88,
      },
    ],
    nodes: [
      {
        csid: "cs:site:maiden-castle",
        name: "Maiden Castle",
        label: "Site",
        labels: ["Site"],
      },
    ],
    edges: [],
  };

  it("returns the hybrid-retrieval subgraph on success", async () => {
    mocks.retrieve.mockResolvedValue(RETRIEVAL);
    const { status, body } = await get("/api/graph/retrieve?q=iron-age%20hillforts");
    expect(status).toBe(200);
    expect(body.seeds[0].csid).toBe("cs:site:maiden-castle");
    expect(mocks.retrieve).toHaveBeenCalledWith("iron-age hillforts", {
      k: undefined,
      depth: undefined,
    });
  });

  it("passes numeric k and depth through", async () => {
    mocks.retrieve.mockResolvedValue({ ...RETRIEVAL, k: 3, depth: 2 });
    await get("/api/graph/retrieve?q=x&k=3&depth=2");
    expect(mocks.retrieve).toHaveBeenCalledWith("x", { k: 3, depth: 2 });
  });

  it("short-circuits an empty query without calling the sidecar", async () => {
    const { status, body } = await get("/api/graph/retrieve?q=%20%20");
    expect(status).toBe(200);
    expect(body).toEqual({ query: "", seeds: [], nodes: [], edges: [] });
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it("returns 503 { available:false } when GraphRAG is unavailable", async () => {
    mocks.retrieve.mockRejectedValue(
      new CultureScrapeUnavailableError("no embedder"),
    );
    const { status, body } = await get("/api/graph/retrieve?q=x");
    expect(status).toBe(503);
    expect(body.available).toBe(false);
  });

  it("returns 502 when the sidecar sends an unusable response", async () => {
    mocks.retrieve.mockRejectedValue(new CultureScrapeError("bad body", 200));
    const { status, body } = await get("/api/graph/retrieve?q=x");
    expect(status).toBe(502);
    expect(body.available).toBe(true);
  });
});

// ── GET /api/graph/node/:id ─────────────────────────────────────────────────

describe("GET /api/graph/node/:id", () => {
  it("returns the node on success", async () => {
    mocks.getNode.mockResolvedValue(NODE);
    const { status, body } = await get("/api/graph/node/cs:dish:paella");
    expect(status).toBe(200);
    expect(body.node.csid).toBe("cs:dish:paella");
    expect(mocks.getNode).toHaveBeenCalledWith("cs:dish:paella");
  });

  it("returns 404 when the node does not exist", async () => {
    mocks.getNode.mockResolvedValue(null);
    const { status, body } = await get("/api/graph/node/cs:dish:missing");
    expect(status).toBe(404);
    expect(body.error).toMatch(/not found/);
  });

  it("returns 503 { available:false } when Neo4j is unavailable", async () => {
    mocks.getNode.mockRejectedValue(new GraphUnavailableError());
    const { status, body } = await get("/api/graph/node/cs:dish:paella");
    expect(status).toBe(503);
    expect(body.available).toBe(false);
  });
});

// ── GET /api/graph/neighborhood/:id ─────────────────────────────────────────

describe("GET /api/graph/neighborhood/:id", () => {
  const HOOD = { root: NODE, nodes: [NODE], edges: [], depth: 2 };

  it("returns the neighborhood on success", async () => {
    mocks.getNeighborhood.mockResolvedValue(HOOD);
    const { status, body } = await get(
      "/api/graph/neighborhood/cs:dish:paella?depth=2",
    );
    expect(status).toBe(200);
    expect(body.depth).toBe(2);
    expect(mocks.getNeighborhood).toHaveBeenCalledWith("cs:dish:paella", 2);
  });

  it("clamps an out-of-range depth to 3", async () => {
    mocks.getNeighborhood.mockResolvedValue({ ...HOOD, depth: 3 });
    await get("/api/graph/neighborhood/cs:dish:paella?depth=9");
    expect(mocks.getNeighborhood).toHaveBeenCalledWith("cs:dish:paella", 3);
  });

  it("defaults to depth 1 when the param is missing or non-numeric", async () => {
    mocks.getNeighborhood.mockResolvedValue({ ...HOOD, depth: 1 });
    await get("/api/graph/neighborhood/cs:dish:paella?depth=abc");
    expect(mocks.getNeighborhood).toHaveBeenCalledWith("cs:dish:paella", 1);
  });

  it("returns 404 when the focus node does not exist", async () => {
    mocks.getNeighborhood.mockResolvedValue(null);
    const { status } = await get("/api/graph/neighborhood/cs:dish:missing");
    expect(status).toBe(404);
  });

  it("returns 503 { available:false } when Neo4j is unavailable", async () => {
    mocks.getNeighborhood.mockRejectedValue(new GraphUnavailableError());
    const { status, body } = await get(
      "/api/graph/neighborhood/cs:dish:paella",
    );
    expect(status).toBe(503);
    expect(body.available).toBe(false);
  });
});

// ── GET /api/graph/overview ─────────────────────────────────────────────────

describe("GET /api/graph/overview", () => {
  const SNAPSHOT = {
    nodes: [NODE, { csid: "cs:region:iberia", labels: ["Region"], name: "Iberia", properties: {} }],
    edges: [
      { id: "e1", type: "ORIGINATES_IN", startCsid: "cs:dish:paella", endCsid: "cs:region:iberia", properties: {} },
    ],
  };

  it("returns the graph snapshot on success", async () => {
    mocks.getGraphOverview.mockResolvedValue(SNAPSHOT);
    const { status, body } = await get("/api/graph/overview");
    expect(status).toBe(200);
    expect(body.nodes).toHaveLength(2);
    expect(body.edges).toHaveLength(1);
    expect(mocks.getGraphOverview).toHaveBeenCalledWith(undefined);
  });

  it("passes a numeric limit through", async () => {
    mocks.getGraphOverview.mockResolvedValue({ nodes: [], edges: [] });
    await get("/api/graph/overview?limit=50");
    expect(mocks.getGraphOverview).toHaveBeenCalledWith(50);
  });

  it("ignores a non-positive limit (uses the default)", async () => {
    mocks.getGraphOverview.mockResolvedValue({ nodes: [], edges: [] });
    await get("/api/graph/overview?limit=0");
    expect(mocks.getGraphOverview).toHaveBeenCalledWith(undefined);
  });

  it("returns 503 { available:false } when Neo4j is unavailable", async () => {
    mocks.getGraphOverview.mockRejectedValue(new GraphUnavailableError());
    const { status, body } = await get("/api/graph/overview");
    expect(status).toBe(503);
    expect(body.available).toBe(false);
  });
});

// ── GET /api/graph/metrics ──────────────────────────────────────────────────

describe("GET /api/graph/metrics", () => {
  const METRICS = {
    node_count: 10,
    edge_count: 20,
    edges_per_node: 2,
    component_count: 1,
    largest_component_size: 10,
    largest_component_fraction: 1,
    edges_by_dimension: {},
    edges_by_type: {},
  };

  it("returns sidecar metrics on success", async () => {
    mocks.metrics.mockResolvedValue(METRICS);
    const { status, body } = await get("/api/graph/metrics");
    expect(status).toBe(200);
    expect(body.node_count).toBe(10);
  });

  it("returns 503 { available:false } when the sidecar is unavailable", async () => {
    mocks.metrics.mockRejectedValue(new CultureScrapeUnavailableError());
    const { status, body } = await get("/api/graph/metrics");
    expect(status).toBe(503);
    expect(body.available).toBe(false);
  });
});

// ── GET /api/graph/resolve ──────────────────────────────────────────────────

describe("GET /api/graph/resolve", () => {
  it("resolves an entity ref to a csid", async () => {
    mocks.resolve.mockReturnValue({
      csid: "cs:language:lat",
      confidence: 1,
      method: "alias",
    });
    const { status, body } = await get(
      "/api/graph/resolve?type=language&id=lat&name=Latin",
    );
    expect(status).toBe(200);
    expect(body.resolved.csid).toBe("cs:language:lat");
    expect(mocks.resolve).toHaveBeenCalledWith({
      type: "language",
      id: "lat",
      name: "Latin",
      region: undefined,
    });
  });

  it("returns resolved:null for a no-match/ambiguous ref", async () => {
    mocks.resolve.mockReturnValue(null);
    const { status, body } = await get("/api/graph/resolve?type=language&name=Klingon");
    expect(status).toBe(200);
    expect(body.resolved).toBeNull();
  });

  it("400s when type is missing", async () => {
    const { status } = await get("/api/graph/resolve?id=lat");
    expect(status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});

// ── POST /api/graph/datalog ─────────────────────────────────────────────────

describe("POST /api/graph/datalog", () => {
  const OUTCOME = {
    ran: true,
    rows: [["cs:language:pie"], ["cs:language:proto-celtic"]],
    problems: [],
    error: null,
    reason: null,
  };

  it("runs an ad-hoc goal and returns the outcome", async () => {
    mocks.datalog.mockResolvedValue(OUTCOME);
    const { status, body } = await post("/api/graph/datalog", {
      goal: "main :- ancestor('cs:language:gaulish', A), format(\"~w~n\",[A]).",
    });
    expect(status).toBe(200);
    expect(body.rows).toHaveLength(2);
    expect(mocks.datalog).toHaveBeenCalledWith({
      goal: expect.stringContaining("ancestor"),
      example: undefined,
    });
  });

  it("runs a named example slug", async () => {
    mocks.datalog.mockResolvedValue(OUTCOME);
    await post("/api/graph/datalog", { example: "language-descent" });
    expect(mocks.datalog).toHaveBeenCalledWith({
      goal: undefined,
      example: "language-descent",
    });
  });

  it("surfaces a sidecar lint error/reason instead of swallowing it", async () => {
    mocks.datalog.mockResolvedValue({
      ran: false,
      rows: [],
      problems: ["undefined predicate foo/1"],
      error: null,
      reason: "swipl not found, so the query was linted offline but not run.",
    });
    const { status, body } = await post("/api/graph/datalog", { goal: "main :- foo." });
    expect(status).toBe(200);
    expect(body.ran).toBe(false);
    expect(body.reason).toMatch(/swipl/);
  });

  it("400s when neither goal nor example is provided", async () => {
    const { status } = await post("/api/graph/datalog", {});
    expect(status).toBe(400);
    expect(mocks.datalog).not.toHaveBeenCalled();
  });

  it("returns 503 { available:false } when the sidecar is unavailable", async () => {
    mocks.datalog.mockRejectedValue(new CultureScrapeUnavailableError("down"));
    const { status, body } = await post("/api/graph/datalog", { example: "x" });
    expect(status).toBe(503);
    expect(body.available).toBe(false);
  });
});

// ── POST /api/graph/cypher ──────────────────────────────────────────────────

describe("POST /api/graph/cypher", () => {
  const RESULT = {
    columns: ["n.name"],
    rows: [["Paella"], ["Ceviche"]],
  };

  it("runs a read-only query and returns columns + rows", async () => {
    mocks.cypher.mockResolvedValue(RESULT);
    const { status, body } = await post("/api/graph/cypher", {
      query: "MATCH (n:Dish) RETURN n.name LIMIT 25",
    });
    expect(status).toBe(200);
    expect(body.columns).toEqual(["n.name"]);
    expect(body.rows).toHaveLength(2);
    expect(mocks.cypher).toHaveBeenCalledWith("MATCH (n:Dish) RETURN n.name LIMIT 25");
  });

  it("400s a write query without hitting the sidecar", async () => {
    const { status, body } = await post("/api/graph/cypher", {
      query: "MATCH (n) DETACH DELETE n",
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/read-only/i);
    expect(mocks.cypher).not.toHaveBeenCalled();
  });

  it("400s an empty query", async () => {
    const { status } = await post("/api/graph/cypher", { query: "   " });
    expect(status).toBe(400);
    expect(mocks.cypher).not.toHaveBeenCalled();
  });

  it("surfaces a sidecar syntax error as 502 (not swallowed)", async () => {
    mocks.cypher.mockRejectedValue(new CultureScrapeError("invalid syntax", 400));
    const { status, body } = await post("/api/graph/cypher", {
      query: "MATCH (n) RETURN nope(",
    });
    expect(status).toBe(502);
    expect(body.detail).toMatch(/invalid syntax/);
  });

  it("returns 503 { available:false } when the sidecar is unavailable", async () => {
    mocks.cypher.mockRejectedValue(new CultureScrapeUnavailableError());
    const { status, body } = await post("/api/graph/cypher", {
      query: "MATCH (n) RETURN n LIMIT 1",
    });
    expect(status).toBe(503);
    expect(body.available).toBe(false);
  });
});

// ── GET /api/graph/status ───────────────────────────────────────────────────

describe("GET /api/graph/status", () => {
  it("reports both backends up", async () => {
    mocks.graphIsAvailable.mockResolvedValue(true);
    mocks.clientIsAvailable.mockResolvedValue(true);
    const { status, body } = await get("/api/graph/status");
    expect(status).toBe(200);
    expect(body).toMatchObject({ available: true, neo4j: true, sidecar: true });
    expect(typeof body.checkedAt).toBe("number");
  });

  it("reports available when only one backend is up", async () => {
    mocks.graphIsAvailable.mockResolvedValue(false);
    mocks.clientIsAvailable.mockResolvedValue(true);
    const { body } = await get("/api/graph/status");
    expect(body).toMatchObject({ available: true, neo4j: false, sidecar: true });
  });

  it("reports unavailable when both backends are down (still 200)", async () => {
    mocks.graphIsAvailable.mockResolvedValue(false);
    mocks.clientIsAvailable.mockResolvedValue(false);
    const { status, body } = await get("/api/graph/status");
    expect(status).toBe(200);
    expect(body).toMatchObject({ available: false, neo4j: false, sidecar: false });
  });

  it("never crashes when an availability probe rejects", async () => {
    mocks.graphIsAvailable.mockRejectedValue(new Error("boom"));
    mocks.clientIsAvailable.mockResolvedValue(true);
    const { status, body } = await get("/api/graph/status");
    expect(status).toBe(200);
    expect(body).toMatchObject({ available: true, neo4j: false, sidecar: true });
  });
});
