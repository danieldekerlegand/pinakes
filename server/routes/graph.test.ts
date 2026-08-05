import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Integration tests for the first-party `/api/graph/*` routes (US-004), after
 * pinakes:50 US-2 moved most of them to the Python service.
 *
 * Two things are covered: the one route this backend still serves (`/status`)
 * behaves as it always did, and the nine it handed over answer the 501 hand-off
 * **without touching a backend**. The behavioural coverage those nine used to
 * have here moved with the code — it lives in
 * `services/api/tests/test_graph_routes.py`, driven against the same fakes.
 * `/api/graph/resolve` joined them in pinakes:65 US-1.
 *
 * The graph-store (Neo4j) and engine-client (sidecar) are still module-mocked —
 * no live Neo4j, no live network — because `/status` aggregates both through
 * `graph-health`, and because a spy that is never called is what proves a retired
 * handler is really retired. The routes are mounted on a real Express app and
 * driven over real HTTP.
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
    ...actual, // keep the real Engine*Error classes
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

import {
  PORTED_ERROR,
  PORTED_ROUTES,
  PORTED_TO,
  registerGraphRoutes,
} from "./graph";
import { resetGraphHealthCache } from "../services/graph-health";

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

// ── The ported routes ───────────────────────────────────────────────────────

/**
 * Every route this backend has handed to the Python service (pinakes:50 US-2,
 * plus `/resolve` in pinakes:65 US-1), with the concrete URL to drive it. What is under test is the hand-off itself: the path is still
 * registered (the parity baseline and the §10b catalog guard both read the
 * registration set), it answers 501 naming its replacement, and — the part worth
 * a test — it reaches **no** backend on the way. A retired handler that still
 * talked to the sidecar or the Neo4j driver would be a second implementation
 * drifting quietly behind a 501.
 */
const PORTED: [method: "GET" | "POST", url: string][] = [
  ["GET", "/api/graph/search?q=paella"],
  ["GET", "/api/graph/node/cs:dish:paella"],
  ["GET", "/api/graph/neighborhood/cs:dish:paella?depth=2"],
  ["GET", "/api/graph/overview?limit=10"],
  ["GET", "/api/graph/retrieve?q=paella"],
  ["GET", "/api/graph/metrics"],
  ["GET", "/api/graph/resolve?type=language&id=lat"],
  ["POST", "/api/graph/datalog"],
  ["POST", "/api/graph/cypher"],
];

describe("routes ported to the Python service", () => {
  it.each(PORTED)("%s %s answers 501 naming its replacement", async (method, url) => {
    const { status, body } =
      method === "GET" ? await get(url) : await post(url, { goal: "main.", query: "MATCH (n) RETURN n" });

    expect(status).toBe(501);
    expect(body.error).toBe(PORTED_ERROR);
    expect(body.servedBy).toBe(PORTED_TO);
    expect(body.message).toContain("ported to the Python service");
  });

  it("reaches no backend on the way", async () => {
    for (const [method, url] of PORTED) {
      if (method === "GET") await get(url);
      else await post(url, { goal: "main.", query: "MATCH (n) RETURN n" });
    }

    for (const [name, spy] of Object.entries(mocks)) {
      expect(spy, `${name} was called by a retired handler`).not.toHaveBeenCalled();
    }
  });

  it("still registers every ported path", () => {
    // Deleting a registration would shrink `contracts/parity/openapi.json` on its
    // next harvest — i.e. rewrite the baseline the port is graded against.
    const registered = new Set<string>();
    const record = (m: string) => (routePath: string) => {
      registered.add(`${m} ${routePath}`);
    };
    registerGraphRoutes({ get: record("GET"), post: record("POST") } as unknown as Express);

    for (const route of PORTED_ROUTES.get) expect(registered.has(`GET ${route}`)).toBe(true);
    for (const route of PORTED_ROUTES.post) expect(registered.has(`POST ${route}`)).toBe(true);
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
