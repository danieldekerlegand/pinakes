/**
 * MCP server surface for the KCB capabilities (US-1, `/mcp`).
 *
 * KCB §4 names an MCP tool call as one of the two ways to *invoke* a capability
 * (the other is an A2A message, US-2). This mounts a real Model Context Protocol
 * server — built on the official `@modelcontextprotocol/sdk` (`McpServer` + the
 * Streamable HTTP transport) — at `/mcp`, exposing exactly the three KCB §6
 * capabilities as tools named `resolve`/`reconcile`/`query`.
 *
 * **Surface wrapper only** (server/CLAUDE.md + contracts/CLAUDE.md): every tool
 * forwards to the already-built surface the manifest points at —
 *   - `resolve`   → `server/services/graph-resolver.ts` (`GET /api/graph/resolve`)
 *   - `reconcile` → the pinakes-engine acquisition job (`POST /api/scraping/culturescrape`)
 *   - `query`     → the sidecar Datalog console (`POST /api/graph/datalog`)
 *   - `finetune` / `finetune_subscribe` → the `ml/` QLoRA pipeline via
 *     `server/services/finetune-provider.ts` (90-US-3), which shells out to the
 *     already-built `pinakes-train-slm --kft-job` console script
 * — nothing here reimplements a resolver, a reconciler or a trainer. The tool
 * handlers are injectable so tests drive `list_tools`/`CallTool` with no
 * Neo4j/sidecar/Python/GPU.
 *
 * `finetune` is KFT's async pair (`koine/specs/fine-tuning.md` §6): `finetune`
 * *invokes* (returns a run handle immediately) and `finetune_subscribe` *streams* the
 * training-telemetry to the terminal event. It is advertised whether or not the `ml/`
 * runner is reachable — an unreachable runner degrades to an actionable tool error,
 * the same optional-env shape as `GEONAMES_USERNAME` / `KCB_REGISTRY_URL`.
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

import { capability, CAPABILITY_MANIFEST } from "@contracts/capability-manifest";
import { getGraphResolver, type EntityRef } from "../services/graph-resolver";
import { GraphUnavailableError } from "../services/graph-store";
import * as pinakes_engine from "../services/engine-client";
import {
  CultureScrapeError,
  CultureScrapeUnavailableError,
} from "../services/engine-client";
import { jobStore } from "../services/job-store";
import { ContributionService } from "../services/contribution-service";
import {
  ACQUISITION_CATALOG,
  liveJobRunner,
  resolveAcquisitionCategory,
  runAcquisitionJob,
} from "../services/culturescrape-acquisition";
import {
  FinetuneRefusedError,
  FinetuneRunNotFoundError,
  FinetuneUnavailableError,
  startFinetune,
  subscribeFinetune,
  type FinetuneInvokeInput,
  type FinetuneSubscribeInput,
} from "../services/finetune-provider";

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
 * The capability handlers a tool call forwards to. Injectable so tests run the whole
 * MCP path with in-memory fakes; the defaults hit the live surfaces.
 */
export interface McpToolHandlers {
  resolve(ref: EntityRef): Promise<unknown> | unknown;
  reconcile(input: ReconcileToolInput): Promise<unknown> | unknown;
  query(input: QueryToolInput): Promise<unknown> | unknown;
  /** KFT `invoke` — start an async run on the `ml/` pipeline (KFT §6). */
  finetune(input: FinetuneInvokeInput): Promise<unknown> | unknown;
  /** KFT `subscribe` — stream one run's training-telemetry (KFT §6). */
  finetuneSubscribe(input: FinetuneSubscribeInput): Promise<unknown> | unknown;
}

/** An MCP tool result: JSON-encoded text content, optionally flagged an error. */
type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function okResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function errorResult(error: string, detail?: string, extra?: Record<string, unknown>): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error, detail, ...extra }) }],
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
      error instanceof CultureScrapeUnavailableError ||
      // The finetune surface degrades the same way: advertised, not dispatchable,
      // with a message that says how to make it dispatchable (90-US-3 AC3).
      error instanceof FinetuneUnavailableError
    ) {
      return errorResult(`${context} is unavailable`, message(error));
    }
    // A KFT admission refusal is a *reported* outcome, not a crash — the report
    // travels with the error result so a router can read the code (KFT §3.1/§4.2).
    if (error instanceof FinetuneRefusedError) {
      return errorResult(`${context} refused the job`, message(error), {
        report: error.report,
      });
    }
    if (error instanceof FinetuneRunNotFoundError) {
      return errorResult(`${context} has no such run`, message(error));
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
  return pinakes_engine.datalog({ goal, example });
}

// The reconcile default queues a real pinakes-engine acquisition, exactly like
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
      `Unknown pinakes-engine domain: ${input.domain ?? "(none)"} — valid: ${Object.keys(
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

  const job = jobStore.createJob(`pinakes_engine:${category.domain}`, limit ?? 0, "other");
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
  // `finetune`/`finetune_subscribe` dispatch to the ml/ workspace. Both are thin
  // pass-throughs on purpose: the provider service owns the subprocess boundary and
  // the run store, and `ml/` owns admission and training.
  finetune: (input) => startFinetune(input),
  finetuneSubscribe: (input) => subscribeFinetune(input),
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
        .describe("Acquisition domain, e.g. one of the pinakes-engine categories."),
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

  // KFT §6's async pair. `finetune` returns a run handle immediately — it never
  // blocks on training — and `finetune_subscribe` is the stream verb over that handle.
  addTool(
    server,
    "finetune",
    toolDescription(
      "finetune",
      "Fine-tune a small language model on Pinakes's neurosymbolic corpora (KFT specialized provider).",
    ),
    {
      job: z
        .record(z.string(), z.unknown())
        .describe(
          "The KFT finetune-job manifest (koine/schemas/finetune-job.schema.json). " +
            "Admitted by ml/src/pinakes_ml/kft.py; a job outside this provider's " +
            "specialization, or one naming cross-boundary compute, is refused with a report.",
        ),
      stub: z
        .boolean()
        .optional()
        .describe(
          "Run against the injectable stub model — the whole pipeline, no training " +
            "stack, no GPU. Scores from a stub run describe wiring, not a model.",
        ),
    },
    (args) => runTool(() => handlers.finetune(args as unknown as FinetuneInvokeInput), "finetune"),
  );

  addTool(
    server,
    "finetune_subscribe",
    "Stream one finetune run's KFT §6 training-telemetry (loss/adherence curve) to its " +
      "terminal event, which carries the minted model entity id and its KMI weight asset ids.",
    {
      runId: z.string().describe("The handle `finetune` returned."),
      fromIndex: z
        .number()
        .optional()
        .describe("Resume point in the stream; events are replayable (dedup on `eventId`)."),
      wait: z
        .boolean()
        .optional()
        .describe("Await the terminal event (default true); false returns what is buffered now."),
    },
    (args) =>
      runTool(
        () => handlers.finetuneSubscribe(args as unknown as FinetuneSubscribeInput),
        "finetune subscribe",
      ),
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
