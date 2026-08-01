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
import {
  FinetuneJobStore,
  FinetuneUnavailableError,
  startFinetune,
  subscribeFinetune,
  type FinetuneConfig,
  type FinetuneRunner,
  type TelemetryEvent,
} from "../services/finetune-provider";

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
  // The finetune pair runs against an in-memory store + a fake ml/ runner, so the
  // KFT invoke→subscribe path is exercised over the wire with no uv/Python/GPU.
  finetune: (input) =>
    startFinetune(input, { config: FINETUNE_CONFIG, runner: FAKE_RUNNER, store: FINETUNE_STORE }),
  finetuneSubscribe: (input) => subscribeFinetune(input, { store: FINETUNE_STORE }),
};

const FINETUNE_CONFIG: FinetuneConfig = {
  enabled: true,
  mlRoot: "/repo/ml",
  uv: "uv",
  artifactsRoot: "/repo/ml/artifacts/kcb",
  stub: true,
  timeoutMs: 1000,
};

const FINETUNE_STORE = new FinetuneJobStore();

const FINETUNE_JOB = {
  kft_version: "0.3.0",
  job: "pinakes:activity:ft-run/mcp-1",
  base_model: "pinakes:model:qwen2.5-3b-instruct",
  modality: "text-generation",
  method: "qlora",
};

const FINETUNE_TELEMETRY: TelemetryEvent[] = [
  {
    job: FINETUNE_JOB.job,
    step: 1,
    metrics: { train_loss: 0.9 },
    ts: "2026-07-23T00:00:00.000Z",
    kind: "train",
    state: "running",
    eventId: `${FINETUNE_JOB.job}#train:1`,
  },
  {
    job: FINETUNE_JOB.job,
    step: 1,
    metrics: {},
    ts: "2026-07-23T00:00:01.000Z",
    kind: "terminal",
    state: "succeeded",
    eventId: `${FINETUNE_JOB.job}#terminal:1`,
    result: {
      model: "pinakes:model:qwen2.5-3b-instruct-ft-run-mcp-1",
      weights: ["pinakes:asset:sha256-deadbeef"],
      egress: "local-only",
    },
  },
];

/** Stands in for `uv run --project ml pinakes-train-slm --kft-job …`. */
const FAKE_RUNNER: FinetuneRunner = {
  run: async () => ({ code: 0, telemetry: FINETUNE_TELEMETRY }),
};

async function startServer(handlers: McpToolHandlers) {
  const app: Express = express();
  app.use(express.json());
  registerMcpRoutes(app, { handlers });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
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

  it("list_tools returns the KCB §6 capabilities plus the KFT finetune pair", async () => {
    const client = await connect(baseUrl);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        "finetune",
        "finetune_subscribe",
        "query",
        "reconcile",
        "resolve",
      ]);
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

  it("CallTool finetune starts an async run and finetune_subscribe streams its telemetry", async () => {
    const client = await connect(baseUrl);
    try {
      // invoke — returns a handle immediately (KFT §6: `invoke` begins an async run).
      const started = await client.callTool({
        name: "finetune",
        arguments: { job: FINETUNE_JOB, stub: true },
      });
      expect(started.isError).toBeFalsy();
      const handle = decode(started as never) as { runId: string; job: string; state: string };
      expect(handle.job).toBe(FINETUNE_JOB.job);
      expect(handle.state).toBe("pending");

      // subscribe — drains the KFT §6 stream to the terminal event, which carries the
      // minted model entity id and its KMI weight asset ids (§5.1/§5.3).
      const streamed = await client.callTool({
        name: "finetune_subscribe",
        arguments: { runId: handle.runId },
      });
      expect(streamed.isError).toBeFalsy();
      const stream = decode(streamed as never) as {
        state: string;
        events: Array<{ eventId: string; kind: string }>;
        terminal?: { model: string; weights: string[] };
      };
      expect(stream.state).toBe("succeeded");
      expect(stream.events.map((e) => e.kind)).toEqual(["train", "terminal"]);
      expect(stream.terminal?.model).toBe("pinakes:model:qwen2.5-3b-instruct-ft-run-mcp-1");
      expect(stream.terminal?.weights).toEqual(["pinakes:asset:sha256-deadbeef"]);
    } finally {
      await client.close();
    }
  });

  it("reports an unknown run handle as a tool error rather than hanging", async () => {
    const client = await connect(baseUrl);
    try {
      const result = await client.callTool({
        name: "finetune_subscribe",
        arguments: { runId: "no-such-run" },
      });
      expect(result.isError).toBe(true);
      expect((decode(result as never) as { error: string }).error).toMatch(/no such run/i);
    } finally {
      await client.close();
    }
  });
});

/**
 * AC3 — the optional-env degrade. With the `ml/` runner unreachable (or the surface
 * switched off) the capability is STILL advertised by `list_tools`; only an invoke
 * answers with an actionable error. That is the `GEONAMES_USERNAME` shape: a missing
 * optional dependency never removes a surface, it degrades one.
 */
describe("MCP finetune degrade (ml/ runner absent)", () => {
  const degraded: McpToolHandlers = {
    ...fakeHandlers,
    finetune: () => {
      throw new FinetuneUnavailableError(
        "the ml/ training stack is not installed — `uv pip install trl peft accelerate`",
      );
    },
  };

  it("still advertises the capability, and an invoke says how to make it invocable", async () => {
    const started = await startServer(degraded);
    const client = await connect(started.baseUrl);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("finetune");

      const result = await client.callTool({
        name: "finetune",
        arguments: { job: FINETUNE_JOB },
      });
      expect(result.isError).toBe(true);
      const body = decode(result as never) as { error: string; detail: string };
      expect(body.error).toMatch(/unavailable/i);
      expect(body.detail).toMatch(/uv pip install trl peft accelerate/);
    } finally {
      await client.close();
      await started.close();
    }
  });

  it("returns the KFT refusal report when the job is not even addressable", async () => {
    const started = await startServer(fakeHandlers);
    const client = await connect(started.baseUrl);
    try {
      const result = await client.callTool({ name: "finetune", arguments: { job: {} } });
      expect(result.isError).toBe(true);
      const body = decode(result as never) as { report?: { code: string } };
      expect(body.report?.code).toBe("malformed-job");
    } finally {
      await client.close();
      await started.close();
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
