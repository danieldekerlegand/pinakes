import { expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Which state the shared graph is in for this run — the one fact the specs
 * cannot assume (pinakes:100 US-2).
 *
 * The suite has to be green **both** ways:
 *
 *   - **down** — CI (and a contributor with no Docker) runs the app alone, so
 *     every graph feature must render its `GraphFeatureGate` disabled affordance.
 *   - **up** — the populated-graph bring-up (`npm run test:e2e:graph`, see
 *     `docs/populated-graph-runbook.md`) loads the canonical export into Neo4j,
 *     so the same features must render REAL corpus data.
 *
 * Those two are mutually exclusive assertions on the same DOM, which is why a
 * spec branches on this probe instead of `.or()`-ing them together: an `.or()`
 * passes for the wrong reason the moment one side regresses.
 *
 * Probed once per worker off the same `/api/graph/status` the client polls.
 */
let probed: Promise<boolean> | null = null;

async function probe(request: APIRequestContext): Promise<boolean> {
  try {
    const res = await request.get("/api/graph/status");
    if (!res.ok()) return false;
    const body = (await res.json()) as { neo4j?: boolean };
    return body.neo4j === true;
  } catch {
    // The server is always up here (Playwright's webServer boots it); a
    // transport failure means the graph is not answering, i.e. "down".
    return false;
  }
}

/** `true` when Neo4j is reachable from the service — i.e. the graph is live. */
export function graphIsUp(request: APIRequestContext): Promise<boolean> {
  probed ??= probe(request);
  return probed;
}

/**
 * The neighborhood of a real, populated csid — used by the graph-up specs so
 * they assert on named corpus content rather than "something rendered".
 */
export interface GraphProbeNode {
  csid: string;
  name: string;
  nodeCount: number;
  edgeCount: number;
  /**
   * The distinct labels the UI should type the neighborhood's nodes by — i.e.
   * exactly what `labelLegend` in `web/src/lib/graph/neighborhood-graph.ts`
   * derives, umbrella `:Entity` skipped. Computed here from the API payload so
   * the legend assertion tracks the corpus rather than a hard-coded list.
   */
  labels: string[];
}

/**
 * The label the canonical export puts on EVERY node. Mirrors `UMBRELLA_LABEL`
 * in `web/src/lib/graph/neighborhood-graph.ts` — the constant whose absence made
 * the legend collapse to one entry against real data (pinakes:100 US-2).
 */
const UMBRELLA_LABEL = "Entity";

/**
 * Read a real neighborhood straight off the API so a spec can assert the *same*
 * node the UI is about to draw. Fails the test if the graph answers empty —
 * a populated-graph spec asserting against an empty graph is no assertion.
 */
export async function realNeighborhood(
  request: APIRequestContext,
  csid: string,
): Promise<GraphProbeNode> {
  const res = await request.get(
    `/api/graph/neighborhood/${encodeURIComponent(csid)}?depth=1`,
  );
  expect(res.ok(), `neighborhood/${csid} should answer 200`).toBeTruthy();
  const body = (await res.json()) as {
    root?: { name?: string };
    nodes?: { labels?: string[] }[];
    edges?: unknown[];
  };
  const nodes = body.nodes ?? [];
  const nodeCount = nodes.length;
  const edgeCount = body.edges?.length ?? 0;
  expect(nodeCount, `${csid} should have neighbors in a populated graph`)
    .toBeGreaterThan(1);
  expect(edgeCount, `${csid} should have edges in a populated graph`)
    .toBeGreaterThan(0);
  const labels = [
    ...new Set(
      nodes.map((node) => {
        const own = node.labels ?? [];
        return own.find((label) => label !== UMBRELLA_LABEL) ?? own[0] ?? "Node";
      }),
    ),
  ].sort();
  expect(labels, `${csid} should type its nodes by more than the umbrella label`)
    .not.toEqual([UMBRELLA_LABEL]);
  return {
    csid,
    name: String(body.root?.name ?? ""),
    nodeCount,
    edgeCount,
    labels,
  };
}

/** The primary sidebar nav ("Visualizations"/"Data"/… buttons live here). */
export function primaryNav(page: Page) {
  return page.getByRole("navigation", { name: "Primary" });
}
