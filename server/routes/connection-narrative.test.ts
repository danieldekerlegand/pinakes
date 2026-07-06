import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { registerConnectionNarrativeRoutes } from "./connection-narrative";
import { GraphUnavailableError, type GraphPath } from "../services/graph-store";
import type { GraphResolver } from "../services/graph-resolver";

/**
 * Integration tests for POST /api/graph/explain (US-005). The resolver, graph
 * traversal, LLM, and Datalog inference are all injected — no live Neo4j, no live
 * model, no live sidecar — while the route is mounted on a real Express app and
 * driven over real HTTP.
 */

function node(csid: string, name: string) {
  return { csid, labels: ["Entity"], name, properties: {} };
}

const PATH: GraphPath = {
  from: node("cs:language:spa", "Spanish"),
  to: node("cs:language:pie", "Proto-Indo-European"),
  nodes: [node("cs:language:spa", "Spanish"), node("cs:language:pie", "Proto-Indo-European")],
  edges: [
    {
      id: "e1",
      type: "DESCENDS_FROM",
      startCsid: "cs:language:spa",
      endCsid: "cs:language:pie",
      weight: 0.8,
      properties: { source: "Ethnologue" },
    },
  ],
  length: 1,
};

// A resolver that maps `{type:'language', id:'spa'}` → a csid and refuses Klingon.
const resolver: GraphResolver = {
  resolve: (ref) => {
    if (ref.type === "language" && ref.id === "spa") {
      return { csid: "cs:language:spa", confidence: 1, method: "alias" };
    }
    return null;
  },
  reverse: () => null,
  size: 0,
};

// Per-test injectable behaviors; reset in each test via mockReset.
const findPath = vi.fn<[string, string], Promise<GraphPath | null>>();
const generate = vi.fn<[string], Promise<string>>();
const inferFacts = vi.fn<[string, string], Promise<any[]>>();

let app: Express;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  app = express();
  registerConnectionNarrativeRoutes(app, {
    resolver,
    findPath: (a, b) => findPath(a, b),
    llm: { generate: (p) => generate(p) },
    inferFacts: (a, b) => inferFacts(a, b),
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(json: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/api/graph/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(json),
  });
  return { status: res.status, body: await res.json() };
}

function reset() {
  findPath.mockReset();
  generate.mockReset();
  inferFacts.mockReset();
  inferFacts.mockResolvedValue([]);
}

describe("POST /api/graph/explain", () => {
  it("explains a connection between two csids (200, AI-labelled + cited)", async () => {
    reset();
    findPath.mockResolvedValue(PATH);
    generate.mockResolvedValue("Spanish descends from Proto-Indo-European.");
    const { status, body } = await post({
      from: { csid: "cs:language:spa", name: "Spanish" },
      to: { csid: "cs:language:pie", name: "Proto-Indo-European" },
    });
    expect(status).toBe(200);
    expect(body.connected).toBe(true);
    expect(body.aiGenerated).toBe(true);
    expect(body.evidence[0].source).toBe("Ethnologue");
    expect(body.confidence).toBeCloseTo(0.8, 3);
    expect(findPath).toHaveBeenCalledWith("cs:language:spa", "cs:language:pie");
  });

  it("resolves an entity ref to a csid before traversing", async () => {
    reset();
    findPath.mockResolvedValue(PATH);
    generate.mockResolvedValue("ok");
    const { status } = await post({
      from: { type: "language", id: "spa" },
      to: { csid: "cs:language:pie" },
    });
    expect(status).toBe(200);
    expect(findPath).toHaveBeenCalledWith("cs:language:spa", "cs:language:pie");
  });

  it("returns an honest no-path answer (200) without calling the LLM", async () => {
    reset();
    findPath.mockResolvedValue(null);
    const { status, body } = await post({
      from: { csid: "cs:language:spa" },
      to: { csid: "cs:language:pie" },
    });
    expect(status).toBe(200);
    expect(body.connected).toBe(false);
    expect(body.aiGenerated).toBe(false);
    expect(body.explanation).toMatch(/no connection/i);
    expect(generate).not.toHaveBeenCalled();
  });

  it("400s when an entity ref cannot be resolved", async () => {
    reset();
    const { status, body } = await post({
      from: { type: "language", name: "Klingon" },
      to: { csid: "cs:language:pie" },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/from:.*resolve/i);
    expect(findPath).not.toHaveBeenCalled();
  });

  it("400s when from and to resolve to the same entity", async () => {
    reset();
    const { status, body } = await post({
      from: { csid: "cs:language:spa" },
      to: { csid: "cs:language:spa" },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/same entity/i);
  });

  it("400s when an endpoint has neither csid nor type", async () => {
    reset();
    const { status } = await post({ from: {}, to: { csid: "cs:language:pie" } });
    expect(status).toBe(400);
  });

  it("returns 503 { available:false } when the graph is unavailable", async () => {
    reset();
    findPath.mockRejectedValue(new GraphUnavailableError());
    const { status, body } = await post({
      from: { csid: "cs:language:spa" },
      to: { csid: "cs:language:pie" },
    });
    expect(status).toBe(503);
    expect(body.available).toBe(false);
  });

  it("returns 502 when the model fails after a path was found", async () => {
    reset();
    findPath.mockResolvedValue(PATH);
    generate.mockRejectedValue(new Error("model timeout"));
    const { status, body } = await post({
      from: { csid: "cs:language:spa" },
      to: { csid: "cs:language:pie" },
    });
    expect(status).toBe(502);
    expect(body.error).toMatch(/narrative generation failed/i);
  });
});
