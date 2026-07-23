import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Integration tests for the MCP server surface (41-US-1). A real Express server is
 * started with the MCP routes registered, and a real MCP client (the official SDK's
 * Streamable HTTP client) drives `list_tools` / `CallTool` over the wire — so the
 * KCB §4 describe→invoke path is exercised end to end, with injected handlers
 * standing in for Neo4j / the sidecar (no live backend).
 */

import {
  registerMcpRoutes,
  liveMcpToolHandlers,
  MCP_ROUTE_PATH,
  type McpToolHandlers,
} from "./mcp";
import { createGraphResolver, type EntityRef } from "../services/graph-resolver";
import { GraphUnavailableError } from "../services/graph-store";
import { getGraphResolver } from "../services/graph-resolver";

/** A resolver-backed `resolve` over fixture aliases (proves the tool reaches the resolver). */
const FIXTURE_RESOLVER = createGraphResolver([
  { csid: "cs:language:latin", pinakesId: "latin", nodeType: "language", name: "Latin" },
]);

const RECORDED_RECONCILE: { calls: unknown[] } = { calls: [] };

/** Handlers that stand in for the live surfaces so tests need no Neo4j/sidecar/Python. */
const fakeHandlers: McpToolHandlers = {
  resolve: (ref: EntityRef) => ({ resolved: FIXTURE_RESOLVER.resolve(ref) }),
  reconcile: (input) => {
    RECORDED_RECONCILE.calls.push(input);
    return { jobId: "job-1", domain: "civilizations", message: "started" };
  },
  // Simulate Neo4j / sidecar being down — must surface as an MCP tool error.
  query: () => {
    throw new GraphUnavailableError("neo4j down");
  },
};

async function startServer(handlers: McpToolHandlers) {
  const app: Express = express();
  app.use(express.json());
  registerMcpRoutes(app, { handlers });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function connect(baseUrl: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}${MCP_ROUTE_PATH}`));
  const client = new Client({ name: "pinakes-mcp-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

/** Decode a tool result's first text-content block as JSON. */
function decode(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const text = result.content.find((c) => c.type === "text")?.text ?? "null";
  return JSON.parse(text);
}

describe("MCP server surface (/mcp)", () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const started = await startServer(fakeHandlers);
    baseUrl = started.baseUrl;
    close = started.close;
  });
  afterAll(() => close());

  it("list_tools returns the three KCB §6 capabilities with input schemas", async () => {
    const client = await connect(baseUrl);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(["query", "reconcile", "resolve"]);
      for (const tool of tools) {
        expect(tool.inputSchema, tool.name).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
      }
      const resolve = tools.find((t) => t.name === "resolve");
      expect(resolve?.inputSchema.properties).toHaveProperty("type");
    } finally {
      await client.close();
    }
  });

  it("CallTool resolve round-trips to the resolver and returns its result", async () => {
    const client = await connect(baseUrl);
    try {
      const result = await client.callTool({
        name: "resolve",
        arguments: { type: "language", id: "latin" },
      });
      expect(result.isError).toBeFalsy();
      expect(decode(result as never)).toEqual({
        resolved: { csid: "cs:language:latin", confidence: 1, method: "alias" },
      });
    } finally {
      await client.close();
    }
  });

  it("CallTool reconcile forwards its input to the acquisition surface", async () => {
    RECORDED_RECONCILE.calls.length = 0;
    const client = await connect(baseUrl);
    try {
      const result = await client.callTool({
        name: "reconcile",
        arguments: { domain: "civilizations", limit: 5 },
      });
      expect(result.isError).toBeFalsy();
      expect(decode(result as never)).toMatchObject({ jobId: "job-1", domain: "civilizations" });
      expect(RECORDED_RECONCILE.calls).toEqual([{ domain: "civilizations", limit: 5 }]);
    } finally {
      await client.close();
    }
  });

  it("surfaces a Neo4j-unavailable path as an MCP tool error, never a crash", async () => {
    const client = await connect(baseUrl);
    try {
      const result = await client.callTool({
        name: "query",
        arguments: { goal: "main :- true." },
      });
      expect(result.isError).toBe(true);
      const body = decode(result as never) as { error: string };
      expect(body.error).toMatch(/unavailable/i);
    } finally {
      await client.close();
    }
  });
});

describe("MCP live default handlers", () => {
  it("resolve default reaches the lexicon-backed getGraphResolver()", async () => {
    // The default resolve is the live one; it wraps getGraphResolver().resolve(),
    // which is lexicon-backed and does NOT require Neo4j.
    const started = await startServer(liveMcpToolHandlers);
    const client = await connect(started.baseUrl);
    try {
      const result = await client.callTool({
        name: "resolve",
        arguments: { type: "language", id: "__no_such_id__" },
      });
      expect(result.isError).toBeFalsy();
      // An unknown id resolves to null (the resolver refuses to guess) — proving the
      // tool round-tripped to the real resolver rather than fabricating a result.
      expect(decode(result as never)).toEqual({ resolved: null });
      // Sanity: the same call goes through the shared singleton.
      expect(getGraphResolver().resolve({ type: "language", id: "__no_such_id__" })).toBeNull();
    } finally {
      await client.close();
      await started.close();
    }
  });
});
