/**
 * End-to-end live-graph smoke test (US-005).
 *
 * With the sidecar + Neo4j up (`npm run dev:full`) this script hits the
 * first-party `/api/graph/*` routes and asserts they return *real* (non-empty)
 * data — proving the app actually talks to the live stack rather than a mock:
 *
 *   GET  /api/graph/status             — both backends reachable
 *   GET  /api/graph/search?q=…         — full-text search returns hits (sidecar)
 *   GET  /api/graph/metrics            — graph-level metrics are non-zero (sidecar)
 *   POST /api/graph/cypher             — every CORE_DOMAIN label is non-empty (Neo4j)
 *   GET  /api/graph/node/:id           — a real node resolves by csid (Neo4j)
 *   GET  /api/graph/neighborhood/:id   — its neighborhood has nodes AND edges (Neo4j)
 *
 * The domain leg is what makes this a *populated*-graph gate rather than a
 * reachability one (pinakes:100 US-1): a graph that is up but empty — or holding
 * the 9-node `tests/fixtures/explorer-corpus` fixture the compose file defaults
 * to — passes status/metrics/search and fails here, which is the whole point.
 *
 * It **degrades gracefully**: when the pinakes server, the sidecar, or Neo4j
 * is absent it prints a clear "stack down" message and exits 0 rather than
 * throwing a connection stack trace — so running it with nothing up is a no-op,
 * not a hard failure. It exits **1 only when a backend is up but a check fails**
 * (a genuine regression). See docs — `engine/docs/convergence-build.md`.
 *
 * Run:  npx tsx scripts/smoke-graph.ts   (optionally SMOKE_GRAPH_URL=… PORT=…)
 */
// The `/api/graph/*` response shapes, stated locally and narrowed to the fields
// this smoke test reads. They came from `server/services/{graph-health,graph-store,
// engine-client}.ts` until the cutover (tasks/chief/80-cutover.json US-2) deleted
// the Express backend; the routes are served by the Python service now
// (`services/api/src/pinakes/routers/graph.py` over an in-process engine), so
// there is no TypeScript declaration left to import. A drift here shows up as a
// failed check against a live stack, which is what this script is for.

/** `GET /api/graph/status` — which backends the server can reach. */
interface GraphHealth {
  available: boolean;
  neo4j: boolean;
  sidecar: boolean;
}

/** A node projected out of the graph. */
interface GraphNode {
  csid: string;
  labels: string[];
  name: string;
}

/** `GET /api/graph/neighborhood/:id`. */
interface Neighborhood {
  nodes: GraphNode[];
  edges: unknown[];
  depth: number;
}

/** `GET /api/graph/search`. */
interface SearchResponse {
  results: { csid: string }[];
}

/** `GET /api/graph/metrics`. */
interface MetricsResponse {
  node_count: number;
  edge_count: number;
}

/**
 * `POST /api/graph/cypher` — the read-only research console. Rows are positional
 * and every cell arrives JSON-stringified (a Neo4j integer comes back as
 * `"341"`, not `341`), so callers coerce rather than trusting the type.
 */
interface CypherResponse {
  columns: string[];
  rows: unknown[][];
}

/** Base URL of the running pinakes server (not the sidecar directly). */
const BASE_URL = (
  process.env.SMOKE_GRAPH_URL ?? `http://localhost:${process.env.PORT ?? "3050"}`
).replace(/\/$/, "");

/** Per-request timeout so a hung backend can't wedge the whole smoke run. */
const REQUEST_TIMEOUT_MS = Number(process.env.SMOKE_GRAPH_TIMEOUT_MS) || 15000;

/** Search terms tried in order until one returns hits (corpus-agnostic). */
const SEARCH_TERMS = ["a", "e", "la", "an", "the"];

/**
 * The core corpus domains a *populated* graph must answer for, each named by the
 * Neo4j label the canonical export loads it under (`docs/canonical-schema.md`;
 * civilizations share the `:Culture` label with the other culture lexicons).
 * Zero nodes for any of these means the graph is reachable but not populated —
 * the failure mode the rest of the checks cannot see.
 */
const CORE_DOMAINS: readonly { readonly name: string; readonly label: string }[] =
  [
    { name: "civilizations", label: "Culture" },
    { name: "sites", label: "Place" },
    { name: "deities", label: "Deity" },
    { name: "writing systems", label: "WritingSystem" },
    { name: "languages", label: "Language" },
  ];

/** Result of one HTTP GET: transport-level failure is captured, never thrown. */
interface FetchResult<T> {
  /** true when a JSON body was received (any HTTP status). */
  reached: boolean;
  status: number;
  body: T | null;
  error?: string;
}

/** Request a JSON endpoint, returning `reached:false` on any transport failure. */
async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<FetchResult<T>> {
  const url = `${BASE_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...init.headers },
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

/** GET a JSON endpoint. */
function getJson<T>(path: string): Promise<FetchResult<T>> {
  return requestJson<T>(path);
}

/** Run a read-only Cypher query through `POST /api/graph/cypher`. */
function cypher(query: string): Promise<FetchResult<CypherResponse>> {
  return requestJson<CypherResponse>("/api/graph/cypher", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
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
 * Record one check per {@link CORE_DOMAINS} entry: is that label non-empty in
 * the live graph? One label-count query answers all of them, so an empty graph
 * fails every domain at once with the counts printed.
 */
async function checkCoreDomains(
  checks: Check[],
  neo4jUp: boolean,
): Promise<void> {
  if (!neo4jUp) {
    for (const domain of CORE_DOMAINS) {
      record(checks, `domain: ${domain.name}`, "skip", "Neo4j down");
    }
    return;
  }

  const labels = CORE_DOMAINS.map((d) => `"${d.label}"`).join(", ");
  const r = await cypher(
    `MATCH (n) UNWIND labels(n) AS label WITH label, count(*) AS total ` +
      `WHERE label IN [${labels}] RETURN label, total`,
  );

  if (!r.reached || r.status !== 200 || !r.body?.rows) {
    for (const domain of CORE_DOMAINS) {
      record(
        checks,
        `domain: ${domain.name}`,
        "fail",
        `label-count query failed (status=${r.status})`,
      );
    }
    return;
  }

  // Rows are positional and cells arrive stringified; index them by label.
  const labelIdx = r.body.columns.indexOf("label");
  const totalIdx = r.body.columns.indexOf("total");
  const counts = new Map<string, number>();
  for (const row of r.body.rows) {
    counts.set(String(row[labelIdx]), Number(row[totalIdx]) || 0);
  }

  for (const domain of CORE_DOMAINS) {
    const total = counts.get(domain.label) ?? 0;
    record(
      checks,
      `domain: ${domain.name}`,
      total > 0 ? "pass" : "fail",
      `:${domain.label} → ${total} node(s)` +
        (total > 0 ? "" : " (expected > 0 — the graph is up but not populated)"),
    );
  }
}

/**
 * Find a real node csid to probe node/neighborhood with, in preference order:
 *
 * 1. a {@link CORE_DOMAINS} node that **has at least one relationship**, so the
 *    neighborhood check proves real edges rather than an isolated node's empty
 *    hood (a corpus node with no edges would pass a nodes-only assertion);
 * 2. a search hit — the sidecar path, which is checked either way;
 * 3. the Neo4j-backed `/overview` snapshot, so the node checks still run when
 *    the sidecar is down but Neo4j is up.
 *
 * Returns `connected: true` only for case 1, so the caller knows whether an
 * empty neighborhood is a genuine failure. `csid` is null when none yields a node.
 */
interface Probe {
  csid: string | null;
  connected: boolean;
}

async function discoverCsid(
  checks: Check[],
  sidecarUp: boolean,
  neo4jUp: boolean,
): Promise<Probe> {
  let searchCsid: string | null = null;

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
        searchCsid = hits[0].csid;
        break;
      }
    }
    if (!searchCsid) {
      record(
        checks,
        "search",
        "fail",
        `no hits for any of ${SEARCH_TERMS.join(", ")} (expected a live corpus)`,
      );
    }
  } else {
    record(checks, "search", "skip", "sidecar down");
  }

  if (neo4jUp) {
    const alternation = CORE_DOMAINS.map((d) => d.label).join("|");
    const connected = await cypher(
      `MATCH (n:${alternation})-[]-() RETURN n.csid AS csid LIMIT 1`,
    );
    const csid = connected.body?.rows?.[0]?.[0];
    if (typeof csid === "string" && csid) return { csid, connected: true };
  }

  if (searchCsid) return { csid: searchCsid, connected: false };

  // Fallback: pull one node straight from the Neo4j-backed overview snapshot.
  const overview = await getJson<{ nodes?: GraphNode[] }>(
    "/api/graph/overview?limit=1",
  );
  const node = overview.body?.nodes?.[0];
  return { csid: node?.csid ?? null, connected: false };
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

  // 3. Core domains (Neo4j) — the graph is up AND holds the real corpus.
  await checkCoreDomains(checks, neo4jUp);

  // 4. Discover a real csid (an edge-bearing corpus node when one exists, else
  //    a search hit, else the Neo4j overview fallback).
  const { csid, connected } = await discoverCsid(checks, sidecarUp, neo4jUp);

  // 5. Node + neighborhood (Neo4j) — need both a csid and Neo4j up.
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
    const nbEdges = nbRes.body?.edges ?? [];
    // The probe was picked *because* it has a relationship, so an empty edge
    // list there means the traversal — not the corpus — is broken.
    const edgesOk = !connected || nbEdges.length > 0;
    if (
      nbRes.reached &&
      nbRes.status === 200 &&
      nbNodes.length > 0 &&
      edgesOk
    ) {
      record(
        checks,
        "neighborhood/:id",
        "pass",
        `${nbNodes.length} node(s), ${nbEdges.length} edge(s) at depth ${nbRes.body?.depth ?? 1}`,
      );
    } else {
      record(
        checks,
        "neighborhood/:id",
        "fail",
        `status=${nbRes.status} nodes=${nbNodes.length} edges=${nbEdges.length} ` +
          `for csid=${csid} (expected ≥ 1 node${connected ? " and ≥ 1 edge" : ""})`,
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
