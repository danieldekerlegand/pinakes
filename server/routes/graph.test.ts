import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Integration tests for the first-party `/api/graph/*` routes (US-004). The
 * graph-store (Neo4j) and culturescrape-client (sidecar) are module-mocked — no
 * live Neo4j, no live network — while the real error classes are preserved so the
 * routes' `instanceof` degradation logic runs exactly as in production. The routes
 * are mounted on a real Express app and driven over real HTTP.
 */

// Shared spies, hoisted so they exist before the vi.mock factories run.
const mocks = vi.hoisted(() => ({
  getNode: vi.fn(),
  getNeighborhood: vi.fn(),
  graphIsAvailable: vi.fn(),
  search: vi.fn(),
  metrics: vi.fn(),
  clientIsAvailable: vi.fn(),
}));

vi.mock("../services/graph-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/graph-store")>();
  return {
    ...actual, // keep the real GraphUnavailableError + clampDepth
    getNode: mocks.getNode,
    getNeighborhood: mocks.getNeighborhood,
    isAvailable: mocks.graphIsAvailable,
  };
});

vi.mock("../services/culturescrape-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/culturescrape-client")>();
  return {
    ...actual, // keep the real CultureScrape*Error classes
    search: mocks.search,
    metrics: mocks.metrics,
    isAvailable: mocks.clientIsAvailable,
  };
});

import { registerGraphRoutes } from "./graph";
import { GraphUnavailableError } from "../services/graph-store";
import {
  CultureScrapeError,
  CultureScrapeUnavailableError,
} from "../services/culturescrape-client";

// ── Test server ───────────────────────────────────────────────────────────────

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  app = express();
  registerGraphRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  for (const spy of Object.values(mocks)) spy.mockReset();
});

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`);
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

// ── GET /api/graph/status ───────────────────────────────────────────────────

describe("GET /api/graph/status", () => {
  it("reports both backends up", async () => {
    mocks.graphIsAvailable.mockResolvedValue(true);
    mocks.clientIsAvailable.mockResolvedValue(true);
    const { status, body } = await get("/api/graph/status");
    expect(status).toBe(200);
    expect(body).toEqual({ available: true, neo4j: true, sidecar: true });
  });

  it("reports available when only one backend is up", async () => {
    mocks.graphIsAvailable.mockResolvedValue(false);
    mocks.clientIsAvailable.mockResolvedValue(true);
    const { body } = await get("/api/graph/status");
    expect(body).toEqual({ available: true, neo4j: false, sidecar: true });
  });

  it("reports unavailable when both backends are down (still 200)", async () => {
    mocks.graphIsAvailable.mockResolvedValue(false);
    mocks.clientIsAvailable.mockResolvedValue(false);
    const { status, body } = await get("/api/graph/status");
    expect(status).toBe(200);
    expect(body).toEqual({ available: false, neo4j: false, sidecar: false });
  });

  it("never crashes when an availability probe rejects", async () => {
    mocks.graphIsAvailable.mockRejectedValue(new Error("boom"));
    mocks.clientIsAvailable.mockResolvedValue(true);
    const { status, body } = await get("/api/graph/status");
    expect(status).toBe(200);
    expect(body).toEqual({ available: true, neo4j: false, sidecar: true });
  });
});
