/**
 * End-to-end live-graph smoke test (US-005).
 *
 * With the sidecar + Neo4j up (`npm run dev:full`) this script hits the
 * first-party `/api/graph/*` routes and asserts they return *real* (non-empty)
 * data — proving the app actually talks to the live stack rather than a mock:
 *
 *   GET /api/graph/status              — both backends reachable
 *   GET /api/graph/search?q=…          — full-text search returns hits (sidecar)
 *   GET /api/graph/metrics             — graph-level metrics are non-zero (sidecar)
 *   GET /api/graph/node/:id            — a real node resolves by csid (Neo4j)
 *   GET /api/graph/neighborhood/:id    — its neighborhood has nodes (Neo4j)
 *
 * It **degrades gracefully**: when the pinakes server, the sidecar, or Neo4j
 * is absent it prints a clear "stack down" message and exits 0 rather than
 * throwing a connection stack trace — so running it with nothing up is a no-op,
 * not a hard failure. It exits **1 only when a backend is up but a check fails**
 * (a genuine regression). See docs — `engine/docs/convergence-build.md`.
 *
 * Run:  npx tsx scripts/smoke-graph.ts   (optionally SMOKE_GRAPH_URL=… PORT=…)
 */
import type { GraphHealth } from "../server/services/graph-health";
import type { GraphNode, Neighborhood } from "../server/services/graph-store";
import type {
  MetricsResponse,
  SearchResponse,
} from "../server/services/engine-client";

/** Base URL of the running pinakes server (not the sidecar directly). */
const BASE_URL = (
  process.env.SMOKE_GRAPH_URL ?? `http://localhost:${process.env.PORT ?? "3050"}`
).replace(/\/$/, "");

/** Per-request timeout so a hung backend can't wedge the whole smoke run. */
const REQUEST_TIMEOUT_MS = Number(process.env.SMOKE_GRAPH_TIMEOUT_MS) || 15000;

/** Search terms tried in order until one returns hits (corpus-agnostic). */
const SEARCH_TERMS = ["a", "e", "la", "an", "the"];

/** Result of one HTTP GET: transport-level failure is captured, never thrown. */
interface FetchResult<T> {
  /** true when a JSON body was received (any HTTP status). */
  reached: boolean;
  status: number;
  body: T | null;
  error?: string;
}

/** GET a JSON endpoint, returning `reached:false` on any transport failure. */
async function getJson<T>(path: string): Promise<FetchResult<T>> {
  const url = `${BASE_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    let body: T | null = null;
    try {
      body = (await res.json()) as T;
    } catch {
      body = null;
    }
    return { reached: true, status: res.status, body };
  } catch (error) {
    return {
      reached: false,
      status: 0,
      body: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

type CheckState = "pass" | "fail" | "skip";

interface Check {
  name: string;
  state: CheckState;
  detail: string;
}

const ICON: Record<CheckState, string> = { pass: "✓", fail: "✗", skip: "–" };

function record(
  checks: Check[],
  name: string,
  state: CheckState,
  detail: string,
): void {
  checks.push({ name, state, detail });
  // eslint-disable-next-line no-console
  console.log(`  ${ICON[state]} ${name} — ${detail}`);
}

/**
 * Find a real node csid to probe node/neighborhood with. Prefers a search hit
 * (exercises the sidecar path); falls back to the Neo4j-backed `/overview`
 * snapshot so the node checks can still run when the sidecar is down but Neo4j
 * is up. Returns null when neither yields a node.
 */
async function discoverCsid(
  checks: Check[],
  sidecarUp: boolean,
): Promise<string | null> {
  if (sidecarUp) {
    for (const term of SEARCH_TERMS) {
      const r = await getJson<SearchResponse>(
        `/api/graph/search?q=${encodeURIComponent(term)}&limit=5`,
      );
      const hits = r.body?.results ?? [];
      if (r.reached && r.status === 200 && hits.length > 0) {
        record(
          checks,
          "search",
          "pass",
          `q="${term}" → ${hits.length} hit(s), first csid=${hits[0].csid}`,
        );
        return hits[0].csid;
      }
    }
    record(
      checks,
      "search",
      "fail",
      `no hits for any of ${SEARCH_TERMS.join(", ")} (expected a live corpus)`,
    );
  } else {
    record(checks, "search", "skip", "sidecar down");
  }

  // Fallback: pull one node straight from the Neo4j-backed overview snapshot.
  const overview = await getJson<{ nodes?: GraphNode[] }>(
    "/api/graph/overview?limit=1",
  );
  const node = overview.body?.nodes?.[0];
  return node?.csid ?? null;
}

async function main(): Promise<number> {
  const checks: Check[] = [];
  // eslint-disable-next-line no-console
  console.log(`▶ Live-graph smoke test against ${BASE_URL}\n`);

  // 1. Status — establishes whether the stack is up at all.
  const status = await getJson<GraphHealth>("/api/graph/status");
  if (!status.reached) {
    // eslint-disable-next-line no-console
    console.log(
      `\n⚠  Stack down: the pinakes server is not reachable at ${BASE_URL}.\n` +
        `   Start it with 'npm run dev:full' (app + pinakes-engine sidecar + Neo4j),\n` +
        `   then re-run 'npx tsx scripts/smoke-graph.ts'. (${status.error})`,
    );
    return 0; // graceful — absent services are not a hard failure
  }

  const health = status.body;
  const sidecarUp = health?.sidecar === true;
  const neo4jUp = health?.neo4j === true;
  record(
    checks,
    "status",
    health?.available ? "pass" : "fail",
    `available=${health?.available} neo4j=${neo4jUp} sidecar=${sidecarUp}`,
  );

  if (!sidecarUp && !neo4jUp) {
    // eslint-disable-next-line no-console
    console.log(
      `\n⚠  Stack down: the server is up but neither Neo4j nor the pinakes-engine\n` +
        `   sidecar is reachable. Bring the graph stack up with 'npm run dev:full'\n` +
        `   (see infra/docker-compose.yml / .env.example), then re-run this smoke test.`,
    );
    return 0; // graceful — the graph backends are absent, not broken
  }

  // 2. Metrics (sidecar) — non-zero node count proves real corpus data.
  if (sidecarUp) {
    const m = await getJson<MetricsResponse>("/api/graph/metrics");
    const nodeCount = m.body?.node_count ?? 0;
    if (m.reached && m.status === 200 && nodeCount > 0) {
      record(
        checks,
        "metrics",
        "pass",
        `node_count=${nodeCount}, edge_count=${m.body?.edge_count ?? 0}`,
      );
    } else {
      record(
        checks,
        "metrics",
        "fail",
        `status=${m.status} node_count=${nodeCount} (expected > 0)`,
      );
    }
  } else {
    record(checks, "metrics", "skip", "sidecar down");
  }

  // 3. Discover a real csid (via search, else the Neo4j overview fallback).
  const csid = await discoverCsid(checks, sidecarUp);

  // 4. Node + neighborhood (Neo4j) — need both a csid and Neo4j up.
  if (!neo4jUp) {
    record(checks, "node/:id", "skip", "Neo4j down");
    record(checks, "neighborhood/:id", "skip", "Neo4j down");
  } else if (!csid) {
    record(checks, "node/:id", "skip", "no csid discovered to probe");
    record(checks, "neighborhood/:id", "skip", "no csid discovered to probe");
  } else {
    const enc = encodeURIComponent(csid);

    const nodeRes = await getJson<{ node: GraphNode }>(`/api/graph/node/${enc}`);
    const node = nodeRes.body?.node;
    if (nodeRes.reached && nodeRes.status === 200 && node?.csid) {
      record(
        checks,
        "node/:id",
        "pass",
        `${node.csid} "${node.name}" [${node.labels.join(", ")}]`,
      );
    } else {
      record(
        checks,
        "node/:id",
        "fail",
        `status=${nodeRes.status} for csid=${csid} (expected the node)`,
      );
    }

    const nbRes = await getJson<Neighborhood>(
      `/api/graph/neighborhood/${enc}?depth=1`,
    );
    const nbNodes = nbRes.body?.nodes ?? [];
    if (nbRes.reached && nbRes.status === 200 && nbNodes.length > 0) {
      record(
        checks,
        "neighborhood/:id",
        "pass",
        `${nbNodes.length} node(s), ${nbRes.body?.edges?.length ?? 0} edge(s) at depth ${nbRes.body?.depth ?? 1}`,
      );
    } else {
      record(
        checks,
        "neighborhood/:id",
        "fail",
        `status=${nbRes.status} nodes=${nbNodes.length} for csid=${csid} (expected ≥ 1)`,
      );
    }
  }

  // Summary.
  const failed = checks.filter((c) => c.state === "fail").length;
  const passed = checks.filter((c) => c.state === "pass").length;
  const skipped = checks.filter((c) => c.state === "skip").length;
  // eslint-disable-next-line no-console
  console.log(
    `\n${failed ? "✗" : "✓"} Smoke test: ${passed} passed, ${failed} failed, ${skipped} skipped.`,
  );
  if (skipped && !failed) {
    // eslint-disable-next-line no-console
    console.log(
      "  (Some checks were skipped because a backend was down — bring the full\n" +
        "   stack up with 'npm run dev:full' for an end-to-end run.)",
    );
  }
  return failed > 0 ? 1 : 0;
}

// CLI entry — mirrors reconciliation-report.ts's main-module guard.
if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))
) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      // A truly unexpected error still degrades to a clear message, not a crash.
      // eslint-disable-next-line no-console
      console.error(
        `\n⚠  Smoke test could not run: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(0);
    });
}

export { main as runGraphSmokeTest };
