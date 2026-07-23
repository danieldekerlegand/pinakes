/**
 * MCP server surface for the KCB capabilities (US-1, `/mcp`).
 *
 * KCB §4 names an MCP tool call as one of the two ways to *invoke* a capability
 * (the other is an A2A message, US-2). This mounts a real Model Context Protocol
 * server — built on the official `@modelcontextprotocol/sdk` (`McpServer` + the
 * Streamable HTTP transport) — at `/mcp`, exposing exactly the three KCB §6
 * capabilities as tools named `resolve`/`reconcile`/`query`.
 *
 * **Surface wrapper only** (server/CLAUDE.md + shared/CLAUDE.md): every tool
 * forwards to the already-built surface the manifest points at —
 *   - `resolve`   → `server/services/graph-resolver.ts` (`GET /api/graph/resolve`)
 *   - `reconcile` → the culture-scrape acquisition job (`POST /api/scraping/culturescrape`)
 *   - `query`     → the sidecar Datalog console (`POST /api/graph/datalog`)
 * — nothing here reimplements a resolver or reconciler. The tool handlers are
 * injectable so tests drive `list_tools`/`CallTool` with no Neo4j/sidecar/Python.
 *
 * Graceful degradation mirrors `/api/graph/*`: a `GraphUnavailableError` /
 * `CultureScrapeUnavailableError` becomes an MCP tool *error result*
 * (`isError: true`), never a thrown crash — the same 503-shaped degradation the
 * HTTP routes give (`GraphUnavailableError` → `{ available: false }`).
 *
 * The transport runs **stateless** (`sessionIdGenerator: undefined`,
 * `enableJsonResponse: true`): a fresh `McpServer` + transport is built per
 * request, so there is no cross-request session state to leak or clean up beyond
 * closing the pair when the response ends. This is the SDK's recommended
 * stateless-JSON pattern.
 */
import express, { type Express, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { capability, CAPABILITY_MANIFEST } from "@shared/capability-manifest";
import { getGraphResolver, type EntityRef } from "../services/graph-resolver";
import { GraphUnavailableError } from "../services/graph-store";
import * as culturescrape from "../services/culturescrape-client";
import {
  CultureScrapeError,
  CultureScrapeUnavailableError,
} from "../services/culturescrape-client";
import { jobStore } from "../services/job-store";
import { ContributionService } from "../services/contribution-service";
import {
  ACQUISITION_CATALOG,
  liveJobRunner,
  resolveAcquisitionCategory,
  runAcquisitionJob,
} from "../services/culturescrape-acquisition";

/** Where the MCP server is mounted (mirrors `endpoints.mcp` in the manifest). */
export const MCP_ROUTE_PATH = "/mcp";

/** Input to the `reconcile` tool (mirrors the `POST /api/scraping/culturescrape` body). */
export interface ReconcileToolInput {
  readonly domain?: string;
  readonly limit?: number;
}

/** Input to the `query` tool (mirrors the `POST /api/graph/datalog` body). */
export interface QueryToolInput {
  readonly goal?: string;
  readonly example?: string;
}

/**
 * The three capability handlers a tool call forwards to. Injectable so tests run
 * the whole MCP path with in-memory fakes; the defaults hit the live surfaces.
 */
export interface McpToolHandlers {
  resolve(ref: EntityRef): Promise<unknown> | unknown;
  reconcile(input: ReconcileToolInput): Promise<unknown> | unknown;
  query(input: QueryToolInput): Promise<unknown> | unknown;
}

/** An MCP tool result: JSON-encoded text content, optionally flagged an error. */
type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function okResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function errorResult(error: string, detail?: string): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error, detail }) }],
  };
}

/**
 * Run a tool handler, mapping the graph/sidecar failure modes onto an MCP error
 * result rather than letting them throw: an "unavailable" backend degrades like
 * the HTTP 503 path, an unusable upstream response like the 502 path, and any
 * other throw is contained too — a tool call never crashes the server.
 */
async function runTool(
  fn: () => Promise<unknown> | unknown,
  context: string,
): Promise<ToolResult> {
  try {
    return okResult(await fn());
  } catch (error) {
    if (
      error instanceof GraphUnavailableError ||
      error instanceof CultureScrapeUnavailableError
    ) {
      return errorResult(`${context} is unavailable`, message(error));
    }
    if (error instanceof CultureScrapeError) {
      return errorResult(`${context} returned an unusable response`, message(error));
    }
    return errorResult(`${context} failed`, message(error));
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ── Default (live) handlers — each forwards to the built surface ─────────────

/** `resolve` → the lexicon-backed csid resolver (does not depend on Neo4j). */
function liveResolve(ref: EntityRef): { resolved: unknown } {
  return { resolved: getGraphResolver().resolve(ref) };
}

/** `query` → the sidecar Datalog console; at least one of goal/example required. */
async function liveQuery(input: QueryToolInput): Promise<unknown> {
  const goal = input.goal?.trim() || undefined;
  const example = input.example?.trim() || undefined;
  if (!goal && !example) {
    throw new CultureScrapeError("a datalog goal or example is required");
  }
  return culturescrape.datalog({ goal, example });
}

// The reconcile default queues a real culture-scrape acquisition, exactly like
// `POST /api/scraping/culturescrape`. The contribution queue is lazily created so
// the module has no fs side effect until a live reconcile is actually invoked.
let reconcileContributions: ContributionService | null = null;
function contributionQueue(): ContributionService {
  if (reconcileContributions === null) {
    reconcileContributions = new ContributionService();
  }
  return reconcileContributions;
}

/** `reconcile` → start a Wikidata acquisition job (returns its `jobId`). */
function liveReconcile(input: ReconcileToolInput): {
  jobId: string;
  domain: string;
  message: string;
} {
  const category = resolveAcquisitionCategory(input.domain);
  if (!category) {
    throw new CultureScrapeError(
      `Unknown culture-scrape domain: ${input.domain ?? "(none)"} — valid: ${Object.keys(
        ACQUISITION_CATALOG,
      ).join(", ")}`,
    );
  }
  let limit: number | undefined;
  if (input.limit !== undefined && input.limit !== null) {
    const parsed = Number(input.limit);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new CultureScrapeError("limit must be a positive number");
    }
    limit = Math.floor(parsed);
  }

  const job = jobStore.createJob(`culturescrape:${category.domain}`, limit ?? 0, "other");
  jobStore.updateJob(job.id, {
    status: "running",
    startedAt: new Date().toISOString(),
    statusMessage: `Starting Wikidata acquisition for ${category.label}`,
  });

  // Fire-and-forget: progress streams through jobStore (GET /api/scraping-jobs).
  void runAcquisitionJob({
    category,
    runner: liveJobRunner,
    contributions: contributionQueue(),
    limit,
    onProgress: (progress) => {
      jobStore.updateJob(job.id, {
        statusMessage: progress.message,
        completedWords: progress.queued,
        failedWords: progress.skipped,
        totalWords: progress.total ?? limit ?? progress.acquired,
      });
    },
  })
    .then((result) => {
      jobStore.updateJob(job.id, {
        status: "completed",
        completedAt: new Date().toISOString(),
        completedWords: result.queued,
        failedWords: result.skipped,
        totalWords: result.acquired,
        wordCount: result.queued,
        statusMessage: `Queued ${result.queued} ${category.label} contribution(s) for review (${result.skipped} skipped, ${result.acquired} fetched).`,
      });
    })
    .catch((err: unknown) => {
      jobStore.updateJob(job.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage: message(err),
        statusMessage: `Acquisition failed: ${message(err)}`,
      });
    });

  return {
    jobId: job.id,
    domain: category.domain,
    message: `Culture-scrape Wikidata acquisition started for ${category.label}`,
  };
}

/** The live handlers, used when the caller does not inject its own. */
export const liveMcpToolHandlers: McpToolHandlers = {
  resolve: liveResolve,
  reconcile: liveReconcile,
  query: liveQuery,
};

// ── MCP server assembly ──────────────────────────────────────────────────────

/** Reuse the manifest's capability descriptions so the MCP tools never drift from it. */
function toolDescription(name: string, fallback: string): string {
  return capability(name)?.description ?? fallback;
}

/**
 * Register one tool with a concrete `ZodRawShape` input. Pinning the shape here
 * (rather than at each `registerTool` call site) keeps the SDK's overloaded
 * generics from instantiating excessively deep (TS2589); the callback is adapted
 * to the SDK's parsed-args signature.
 */
type RegisterTool = (
  name: string,
  config: { description: string; inputSchema: z.ZodRawShape },
  cb: (args: Record<string, unknown>) => Promise<ToolResult>,
) => unknown;

function addTool(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: z.ZodRawShape,
  handler: (args: Record<string, unknown>) => Promise<ToolResult>,
): void {
  // Call through a plain function signature: the SDK's overloaded `registerTool`
  // generics otherwise instantiate excessively deep (TS2589) with zod inputs.
  (server.registerTool as unknown as RegisterTool)(
    name,
    { description, inputSchema },
    (args) => handler(args),
  );
}

/**
 * Build a stateless {@link McpServer} advertising the three KCB §6 capabilities as
 * tools. Called per request (the transport is stateless), so state never leaks
 * between callers.
 */
export function buildMcpServer(handlers: McpToolHandlers): McpServer {
  const server = new McpServer(
    {
      name: CAPABILITY_MANIFEST.identity,
      version: CAPABILITY_MANIFEST.x_pinakes.manifestVersion,
    },
    { capabilities: { tools: {} } },
  );

  addTool(
    server,
    "resolve",
    toolDescription("resolve", "Resolve an entity reference to its canonical csid."),
    {
      type: z.string().describe('Canonical node type, e.g. "language" or "culture".'),
      id: z.string().optional().describe("pinakes local id (the strong signal)."),
      name: z.string().optional().describe("Display name, for the fuzzy fallback."),
      region: z.string().optional().describe("Region to disambiguate fuzzy candidates."),
    },
    (args) => runTool(() => handlers.resolve(args as unknown as EntityRef), "graph entity resolution"),
  );

  addTool(
    server,
    "reconcile",
    toolDescription(
      "reconcile",
      "Reconcile a name-anchored row against Wikidata and re-mint its csid.",
    ),
    {
      domain: z
        .string()
        .describe("Acquisition domain, e.g. one of the culture-scrape categories."),
      limit: z.number().optional().describe("Max records to acquire."),
    },
    (args) => runTool(() => handlers.reconcile(args as unknown as ReconcileToolInput), "reconcile"),
  );

  addTool(
    server,
    "query",
    toolDescription("query", "Query the canonical graph corpus via read-only Datalog."),
    {
      goal: z.string().optional().describe("An ad-hoc Datalog `main/0` goal."),
      example: z.string().optional().describe("A shipped example slug to run."),
    },
    (args) => runTool(() => handlers.query(args as unknown as QueryToolInput), "datalog query"),
  );

  return server;
}

/** Options for {@link registerMcpRoutes}; handlers default to the live surfaces. */
export interface McpRouteOptions {
  readonly handlers?: McpToolHandlers;
}

// Scoped JSON parser so the MCP POST works whether or not a global body parser is
// installed (it is, in server/index.ts) — matching the /api/graph/* console routes.
const jsonBody = express.json();

/**
 * Mount the MCP server at {@link MCP_ROUTE_PATH}. Wired into `registerRoutes`
 * right after `registerGraphRoutes` (server/CLAUDE.md route-registration order),
 * so the tools sit next to the `/api/graph/*` surfaces they wrap.
 */
export function registerMcpRoutes(app: Express, options: McpRouteOptions = {}): void {
  const handlers = options.handlers ?? liveMcpToolHandlers;

  app.post(MCP_ROUTE_PATH, jsonBody, async (req: Request, res: Response) => {
    // Stateless: a fresh server + transport per request, closed when the response
    // ends. No session id, JSON responses enabled (no long-lived SSE stream).
    const server = buildMcpServer(handlers);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[mcp] request handling failed:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // The stateless transport serves everything over POST; GET/DELETE (session SSE
  // + teardown) are not supported here — answer the JSON-RPC "method not allowed".
  const methodNotAllowed = (_req: Request, res: Response): void => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed — POST JSON-RPC to /mcp." },
      id: null,
    });
  };
  app.get(MCP_ROUTE_PATH, methodNotAllowed);
  app.delete(MCP_ROUTE_PATH, methodNotAllowed);
}
