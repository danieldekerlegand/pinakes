/**
 * Typed HTTP client for the culture-scrape FastAPI sidecar.
 *
 * pinakes talks to the shared culture-scrape graph two ways (see
 * docs/culturescrape-integration.md): the Neo4j TypeScript driver
 * (server/services/graph-store.ts) for relational/graph traversal, and this
 * module — the sidecar's FastAPI — for the endpoints that are better served over
 * HTTP than Cypher: full-text `/search`, the `/datalog` and `/neo4j` inference
 * consoles, graph `/metrics`, and scraping `/completeness`.
 *
 * The sidecar renders those views as HTML for its own explorer UI; this client
 * requests them with `Accept: application/json` and validates the JSON payload
 * with zod so the shapes are guaranteed at the boundary and can be reused by the
 * first-party `/api/graph/*` routes (US-004).
 *
 * Everything degrades gracefully: transport failures, timeouts and 5xx map to a
 * typed {@link CultureScrapeUnavailableError} (routes answer 503), a bad request
 * or malformed body maps to {@link CultureScrapeError}, and {@link isAvailable}
 * returns `false` rather than throwing when the sidecar is down or disabled.
 */
import { z } from "zod";

// ── Response schemas (validated at the HTTP boundary) ────────────────────────

/** One ranked global-search hit, mirroring the sidecar's `/search` result row. */
export const SearchHitSchema = z.object({
  csid: z.string(),
  name: z.string(),
  /** primary `:LABEL` of the matched node. */
  label: z.string(),
  /** Wikidata QID when the node carries one, else empty. */
  qid: z.string().default(""),
  /** which field matched (`csid` / `wikidata_qid` / `name`). */
  field: z.string().default(""),
  /** relative link to the node's canonical TSV view. */
  tsv: z.string().default(""),
  /** relative link to the node's graph view, when resolvable. */
  graph: z.string().nullable().default(null),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SearchResponseSchema = z.object({
  query: z.string().default(""),
  results: z.array(SearchHitSchema),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

/** Graph-level metrics, mirroring `culturescrape.ontology.metrics.to_json`. */
export const MetricsResponseSchema = z.object({
  node_count: z.number(),
  edge_count: z.number(),
  edges_per_node: z.number(),
  component_count: z.number(),
  largest_component_size: z.number(),
  largest_component_fraction: z.number(),
  edges_by_dimension: z.record(z.string(), z.number()),
  edges_by_type: z.record(z.string(), z.number()),
});
export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;

/** A digest of the corpus `qa.json` report. */
export const QaSummarySchema = z.object({
  ok: z.boolean(),
  node_count: z.number(),
  edge_count: z.number(),
  violations: z.array(z.string()),
  failed_keys: z.array(z.string()).default([]),
});

/** One category's row in the scraping-completeness dashboard. */
export const CompletenessRowSchema = z.object({
  category_id: z.string(),
  label: z.string(),
  status: z.string(),
  node_count: z.number(),
  edge_count: z.number(),
  violations: z.array(z.string()),
  last_run: z.string().default(""),
  errors: z.number().default(0),
  provenance_complete: z.boolean().default(false),
  reasons: z.array(z.string()).default([]),
});

export const CompletenessResponseSchema = z.object({
  qa: QaSummarySchema.nullable().default(null),
  rows: z.array(CompletenessRowSchema),
});
export type CompletenessResponse = z.infer<typeof CompletenessResponseSchema>;

/**
 * Answer of a Datalog inference query, mirroring
 * `culturescrape.explorer.datalog.DatalogOutcome`. `rows` holds the answer rows,
 * each a tuple of stringified columns; `error`/`reason` explain a non-run.
 */
export const DatalogResponseSchema = z.object({
  ran: z.boolean(),
  rows: z.array(z.array(z.string())),
  problems: z.array(z.string()).default([]),
  error: z.string().nullable().default(null),
  reason: z.string().nullable().default(null),
});
export type DatalogResponse = z.infer<typeof DatalogResponseSchema>;

/**
 * Columns + stringified rows a Cypher query returned, mirroring
 * `culturescrape.explorer.live.QueryResult`.
 */
export const CypherResponseSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string())),
});
export type CypherResponse = z.infer<typeof CypherResponseSchema>;

// ── Typed errors ─────────────────────────────────────────────────────────────

/**
 * The sidecar could not be reached (transport failure, timeout, 5xx, or it is
 * disabled via `CULTURESCRAPE_ENABLED=false`). Routes map this to HTTP 503.
 */
export class CultureScrapeUnavailableError extends Error {
  constructor(message = "culture-scrape sidecar is unavailable") {
    super(message);
    this.name = "CultureScrapeUnavailableError";
  }
}

/**
 * The sidecar answered but the response was unusable: a non-2xx client error, a
 * non-JSON body, or a payload that failed schema validation.
 */
export class CultureScrapeError extends Error {
  /** HTTP status when the failure came from a response, else `undefined`. */
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "CultureScrapeError";
    this.status = status;
  }
}

// ── Configuration (from env) ──────────────────────────────────────────────────

/** How long a positive/negative availability probe is trusted, in ms. */
const AVAILABILITY_TTL_MS = 5_000;

interface ClientConfig {
  baseUrl: string;
  timeoutMs: number;
  enabled: boolean;
}

function readConfig(): ClientConfig {
  const raw = process.env.CULTURESCRAPE_ENABLED;
  // Enabled by default; only an explicit false/0/no opts out.
  const enabled = !(raw && /^(false|0|no|off)$/i.test(raw.trim()));
  return {
    baseUrl: (process.env.CULTURESCRAPE_API_URL || "http://localhost:8800").replace(
      /\/+$/,
      "",
    ),
    timeoutMs: Number(process.env.CULTURESCRAPE_TIMEOUT_MS) || 10_000,
    enabled,
  };
}

// ── Availability probe (short-lived cache) ────────────────────────────────────

interface AvailabilityCache {
  available: boolean;
  checkedAt: number;
}

let availabilityCache: AvailabilityCache | null = null;

/** Reset the cached availability verdict (test hook / after a failed request). */
export function resetAvailabilityCache(): void {
  availabilityCache = null;
}

/**
 * Report whether the sidecar is reachable, caching the result for a short window
 * so a burst of requests issues a single probe. Never throws. Returns `false`
 * immediately when the sidecar is disabled via env.
 */
export async function isAvailable(): Promise<boolean> {
  const cfg = readConfig();
  if (!cfg.enabled) return false;
  const now = Date.now();
  if (availabilityCache && now - availabilityCache.checkedAt < AVAILABILITY_TTL_MS) {
    return availabilityCache.available;
  }
  let available = false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}/`, {
      method: "GET",
      signal: controller.signal,
    });
    available = res.ok;
  } catch {
    available = false;
  } finally {
    clearTimeout(timer);
  }
  availabilityCache = { available, checkedAt: now };
  return available;
}

// ── Core request helper ───────────────────────────────────────────────────────

/** Build a `path?query` URL against the configured base, dropping empty params. */
function buildUrl(baseUrl: string, path: string, params: QueryParams): string {
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

type QueryParams = Record<string, string | number | boolean | undefined | null>;

/**
 * Issue a GET, enforce a timeout, and validate the JSON body against `schema`.
 *
 * @throws {CultureScrapeUnavailableError} transport error, timeout, or 5xx.
 * @throws {CultureScrapeError} non-2xx client error, non-JSON body, or a payload
 *   that fails schema validation.
 */
async function requestJson<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  params: QueryParams = {},
): Promise<z.infer<S>> {
  const cfg = readConfig();
  if (!cfg.enabled) {
    throw new CultureScrapeUnavailableError(
      "culture-scrape sidecar is disabled (CULTURESCRAPE_ENABLED=false)",
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  let res: Response;
  try {
    res = await fetch(buildUrl(cfg.baseUrl, path, params), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (err) {
    // Transport failure or timeout (AbortError). The sidecar is unreachable.
    availabilityCache = null;
    const reason =
      err instanceof Error && err.name === "AbortError"
        ? `request to ${path} timed out after ${cfg.timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : "network error";
    throw new CultureScrapeUnavailableError(reason);
  } finally {
    clearTimeout(timer);
  }

  if (res.status >= 500) {
    // Server-side failure: treat as unavailable so callers can degrade / retry.
    availabilityCache = null;
    throw new CultureScrapeUnavailableError(
      `culture-scrape ${path} returned ${res.status}`,
    );
  }
  if (!res.ok) {
    throw new CultureScrapeError(
      `culture-scrape ${path} returned ${res.status}`,
      res.status,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new CultureScrapeError(
      `culture-scrape ${path} returned a non-JSON response`,
      res.status,
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new CultureScrapeError(
      `culture-scrape ${path} returned a malformed response: ${parsed.error.message}`,
      res.status,
    );
  }
  return parsed.data;
}

// ── Public endpoint wrappers ──────────────────────────────────────────────────

/** Full-text search over the shared graph (`GET /search`). */
export function search(query: string, limit?: number): Promise<SearchResponse> {
  return requestJson("/search", SearchResponseSchema, { q: query, limit });
}

/** Graph-level metrics (`GET /metrics`). */
export function metrics(threshold?: number): Promise<MetricsResponse> {
  return requestJson("/metrics", MetricsResponseSchema, { threshold });
}

/** Scraping-completeness dashboard (`GET /completeness`). */
export function completeness(
  opts: { status?: string; sort?: string } = {},
): Promise<CompletenessResponse> {
  return requestJson("/completeness", CompletenessResponseSchema, {
    status: opts.status,
    sort: opts.sort,
  });
}

/**
 * Run a Datalog inference query (`GET /datalog`). Provide `goal` for an ad-hoc
 * goal, or `example` to run one of the sidecar's named example queries. Queries
 * are read-only.
 */
export function datalog(
  opts: { goal?: string; example?: string } = {},
): Promise<DatalogResponse> {
  return requestJson("/datalog", DatalogResponseSchema, {
    goal: opts.goal,
    query: opts.example,
    run: opts.goal || opts.example ? "1" : undefined,
  });
}

/**
 * Run a read-only Cypher query through the sidecar's console (`GET /neo4j`),
 * returning the columns and stringified rows.
 */
export function cypher(query: string): Promise<CypherResponse> {
  return requestJson("/neo4j", CypherResponseSchema, { query, run: "1" });
}
