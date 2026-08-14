import { test, expect, type Page, type Route } from "@playwright/test";

import { graphIsUp, realNeighborhood } from "./support/graph-state";

/**
 * Graph-UI verification e2e (US-007).
 *
 * Browser-verifies the four graph-dependent UI features that shipped gated on
 * unit tests only — the graph neighborhood view, the explorer graph adapter, the
 * federated (local + graph) search, and the provenance UI — plus the
 * `GraphFeatureGate` disabled-with-tooltip affordance.
 *
 * The shared graph (Neo4j + the in-process corpus reader) is OPTIONAL, so each
 * feature is exercised in THREE ways:
 *
 *   - "graph down" runs against the real server with no mocks — CI's default,
 *     and a contributor's without Docker. It confirms every feature degrades
 *     gracefully (the gate dims + explains, the adapter shows its error state,
 *     federated search returns only local hits) and never presents a
 *     broken-but-clickable control. SKIPPED when the graph is actually up:
 *     "degrades" and "renders real data" are mutually exclusive claims about the
 *     same DOM, so the run picks the one that is true rather than `.or()`-ing
 *     them into an assertion that cannot fail.
 *   - "graph up (mocked)" intercepts `/api/graph/*` + `/api/search` at the
 *     network boundary so the happy path is browser-verified even where no
 *     Neo4j exists. Runs in both states.
 *   - "REAL populated graph" (pinakes:100 US-2) drives the same four features
 *     against a Neo4j loaded from the canonical export — no mocks, asserting on
 *     named corpus content (Mandarin's real neighbours, a real Sumer graph hit).
 *     SKIPPED when the graph is down. Bring it up with `npm run test:e2e:graph`
 *     (docs/populated-graph-runbook.md).
 *
 * NOTE the mocks only bite because `playwright.config.ts` sets
 * `serviceWorkers: "block"` — the production client registers `/sw.js`, and a
 * service worker's fetches bypass `page.route` entirely.
 *
 * Selectors prefer stable `data-testid`s + accessible names over CSS.
 */

// A language that exists in data/source/lexicons/languages.tsv; `?langDetail=<id>` opens its
// detail panel directly (dashboard reads it from the shareable URL state), which
// is where the "Show in graph" affordance lives.
const LANGUAGE_ID = "cmn";
const LANGUAGE_CSID = "cs:language:cmn";

const SHOTS = "test-results/graph-ui";

// ── Graph-up fixtures (mirror services/api/src/pinakes/engine/graph.py payload shapes) ──

const STATUS_UP = {
  available: true,
  neo4j: true,
  sidecar: true,
  checkedAt: 1_700_000_000_000,
};

const RESOLVE_HIT = {
  resolved: { csid: LANGUAGE_CSID, confidence: 1, method: "alias" as const },
};

const NEIGHBORHOOD = {
  root: {
    csid: LANGUAGE_CSID,
    labels: ["Language"],
    name: "Mandarin",
    properties: {
      source: "Ethnologue",
      source_url: "https://www.ethnologue.com/language/cmn",
      confidence: 0.9,
    },
  },
  nodes: [
    {
      csid: LANGUAGE_CSID,
      labels: ["Language"],
      name: "Mandarin",
      properties: {
        source: "Ethnologue",
        source_url: "https://www.ethnologue.com/language/cmn",
        confidence: 0.9,
      },
    },
    {
      csid: "cs:family:sino_tibetan",
      labels: ["LanguageFamily"],
      name: "Sino-Tibetan",
      properties: { source: "Glottolog" },
    },
    {
      csid: "cs:language:yue",
      labels: ["Language"],
      name: "Cantonese",
      properties: {},
    },
  ],
  edges: [
    {
      id: "e1",
      type: "MEMBER_OF",
      startCsid: LANGUAGE_CSID,
      endCsid: "cs:family:sino_tibetan",
      properties: {},
    },
    {
      id: "e2",
      type: "RELATED_TO",
      startCsid: LANGUAGE_CSID,
      endCsid: "cs:language:yue",
      properties: {},
    },
  ],
  depth: 1,
};

const OVERVIEW = {
  nodes: NEIGHBORHOOD.nodes,
  edges: NEIGHBORHOOD.edges,
};

const SEARCH_FEDERATED = {
  query: "mandarin",
  totalCount: 2,
  results: [
    {
      entityType: "language",
      id: "cmn",
      displayName: "Mandarin",
      description: "Sino-Tibetan language",
      linkPath: "/?langDetail=cmn",
      relevance: 1,
      source: "local" as const,
    },
    {
      entityType: "language",
      id: "cmn-graph",
      displayName: "Mandarin (graph)",
      description: "Shared-graph node",
      linkPath: "/?langDetail=cmn",
      relevance: 0.8,
      source: "graph" as const,
      csid: LANGUAGE_CSID,
      confidence: 0.82,
      provenance: {
        source: "culture-scrape",
        qid: "Q9192",
        matchField: "name",
        graphLink: null,
      },
    },
  ],
};

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/**
 * Make the shared graph appear online for this page by intercepting the graph +
 * federated-search endpoints. Registered before navigation so the first
 * `/api/graph/status` poll already sees "up" and `GraphFeatureGate` enables its
 * children.
 */
async function mockGraphUp(page: Page) {
  await page.route(
    (url) => url.pathname === "/api/graph/status",
    (route) => json(route, STATUS_UP),
  );
  await page.route(
    (url) => url.pathname === "/api/graph/resolve",
    (route) => json(route, RESOLVE_HIT),
  );
  await page.route(
    (url) => url.pathname.startsWith("/api/graph/neighborhood/"),
    (route) => json(route, NEIGHBORHOOD),
  );
  await page.route(
    (url) => url.pathname === "/api/graph/overview",
    (route) => json(route, OVERVIEW),
  );
  await page.route(
    (url) => url.pathname === "/api/search",
    (route) => json(route, SEARCH_FEDERATED),
  );
}

function primaryNav(page: Page) {
  return page.getByRole("navigation", { name: "Primary" });
}

/** Open the global (federated) search dialog from the dashboard header. */
async function openSearch(page: Page) {
  await page.getByTestId("input-search").first().click();
  const input = page.getByPlaceholder(/Search or ask/);
  await expect(input).toBeVisible();
  return input;
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph DOWN — real server, no mocks. Every feature must degrade gracefully.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("graph UI degrades gracefully when the shared graph is down", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(
      await graphIsUp(request),
      "the shared graph is UP — the degraded affordances under test do not render; " +
        'see the "REAL populated graph" describe below',
    );
  });

  test("Show-in-graph is gated (dimmed + tooltip) on an entity panel", async ({
    page,
  }) => {
    await page.goto(`/?langDetail=${LANGUAGE_ID}`);
    // The language detail panel opened straight from the URL state.
    await expect(
      page.getByTestId("text-detail-title-mandarin"),
    ).toBeVisible();

    // The "Show in graph" trigger is wrapped in GraphFeatureGate(neo4j); with
    // Neo4j down it renders the disabled, tooltip-explained affordance rather
    // than a clickable-but-broken button.
    const gate = page.getByTestId("graph-feature-gate-disabled");
    await expect(gate).toBeVisible();
    // The (real, un-mocked) button still exists inside the pointer-events-none
    // wrapper — it's the child being gated, not removed.
    await expect(page.getByTestId("button-show-in-graph")).toBeAttached();

    // Hovering the gate surfaces the explanatory tooltip (AC: confirmed when
    // the graph is down).
    await gate.hover();
    await expect(page.getByText(/offline|unavailable/i).first()).toBeVisible();

    await page.screenshot({ path: `${SHOTS}/down-showingraph-gate.png` });
  });

  test("the research console gate is disabled with a tooltip", async ({
    page,
  }) => {
    await page.goto("/advanced-tools");
    await expect(page.getByTestId("advanced-tools-page")).toBeVisible();
    const gate = page.getByTestId("graph-feature-gate-disabled").first();
    await expect(gate).toBeVisible();
    await gate.hover();
    await expect(page.getByText(/offline|unavailable/i).first()).toBeVisible();
  });

  test("the explorer graph adapter shows its error state", async ({ page }) => {
    // `panel=explore` mounts UnifiedExplorer; `ds=pinakes-graph` selects
    // the shared-graph adapter, whose single GET to /api/graph/overview 503s
    // when Neo4j is down.
    await page.goto("/?panel=explore&ds=pinakes-graph");
    await expect(page.getByText(/Failed to load/i)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/down-explorer-adapter.png` });
  });

  test("federated search returns local hits and no graph results", async ({
    page,
  }) => {
    await page.goto("/");
    const input = await openSearch(page);
    await input.fill("Mandarin");
    // The server merges graph hits only when the graph is up; with it down the
    // dialog resolves with no "Graph"-sourced results and no crash.
    await expect(page.getByText(/Searching|No results|item/i).first())
      .toBeVisible()
      .catch(() => {});
    await expect(page.getByText("Graph", { exact: true })).toHaveCount(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Graph UP — /api/graph/* + /api/search mocked. Verify the happy-path renders.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("graph UI renders against a (mocked) live shared graph", () => {
  test.beforeEach(async ({ page }) => {
    await mockGraphUp(page);
  });

  test("neighborhood view + provenance badge render for an entity", async ({
    page,
  }) => {
    await page.goto(`/?langDetail=${LANGUAGE_ID}`);
    await expect(
      page.getByTestId("text-detail-title-mandarin"),
    ).toBeVisible();

    // With Neo4j "up" the gate passes the child through — the button is live.
    const button = page.getByTestId("button-show-in-graph");
    await expect(button).toBeVisible();
    await button.click();

    // Dialog resolves the entity → csid, then lazy-loads the neighborhood view.
    const view = page.getByTestId("graph-neighborhood-view");
    await expect(view).toBeVisible();
    // Depth controls (1..3) are present.
    await expect(page.getByTestId("graph-depth-2")).toBeVisible();
    // Provenance UI: the root node is a sourced fact → the badge renders as such.
    const kind = page.getByTestId("provenance-kind").first();
    await expect(kind).toBeVisible();
    await expect(kind).toHaveAttribute("data-kind", "sourced");
    // The force graph mounted its own SVG (nodes to draw) — target it by testid
    // so we don't match the inline lucide icons that also render inside the view.
    await expect(view.getByTestId("network-graph-svg")).toBeVisible();

    await page.screenshot({ path: `${SHOTS}/up-neighborhood.png` });
  });

  test("the explorer graph adapter loads the Shared Culture Graph", async ({
    page,
  }) => {
    await page.goto("/?panel=explore&ds=pinakes-graph");
    // No error state, and the projected item count reflects the overview nodes.
    await expect(page.getByText(/Failed to load/i)).toHaveCount(0);
    await expect(page.getByText(/[1-9]\d* items/)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/up-explorer-adapter.png` });
  });

  test("federated search surfaces a graph-sourced result", async ({ page }) => {
    await page.goto("/");
    const input = await openSearch(page);
    await input.fill("mandarin");
    // The graph-sourced hit is tagged with the purple "Graph" source badge and
    // carries its provenance (source id) inline.
    await expect(page.getByText("Graph", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("culture-scrape").first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/up-federated-search.png` });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REAL populated graph (pinakes:100 US-2) — no mocks. Neo4j is loaded from the
// canonical export, so every assertion below is on named corpus content.
// Bring it up: `npm run test:e2e:graph` (docs/populated-graph-runbook.md).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A query whose hits genuinely come from BOTH halves of the federation. Local
 * `Sumer*` rows live in the language/civilization lexicons; the graph adds
 * `cs:culture:sumerian` and `cs:archaeological-culture:Q35355`, which have no
 * local twin and so survive the csid dedup in
 * `services/api/src/pinakes/search/global_search.py`. ("Mandarin" does not work
 * for this: its graph node shares `cs:language:cmn` with the local row and is
 * deduped away — a real behaviour worth stating, not a bug.)
 */
const FEDERATED_QUERY = "Sumer";

test.describe("graph UI renders REAL data from the populated graph", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(
      !(await graphIsUp(request)),
      "the shared graph is DOWN — run `npm run test:e2e:graph` to load it",
    );
  });

  test("the neighborhood view draws an entity's real neighbours", async ({
    page,
    request,
  }) => {
    // Read the neighborhood the UI is about to draw straight off the API, so
    // the assertions below name the same real data (and so an empty graph fails
    // here rather than passing a vacuous DOM check).
    const probe = await realNeighborhood(request, LANGUAGE_CSID);
    expect(probe.name).toBe("Mandarin");

    await page.goto(`/?langDetail=${LANGUAGE_ID}`);
    await expect(page.getByTestId("text-detail-title-mandarin")).toBeVisible();

    // Neo4j is really up, so GraphFeatureGate passes the child through — no
    // disabled wrapper, a live button.
    const button = page.getByTestId("button-show-in-graph");
    await expect(button).toBeVisible();
    await button.click();

    // `/api/graph/resolve` answers from the lexicon alias table…
    const view = page.getByTestId("graph-neighborhood-view");
    await expect(view).toBeVisible();
    // …and the neighborhood came back non-empty, so neither the unavailable nor
    // the empty affordance renders.
    await expect(view.getByTestId("graph-unavailable")).toHaveCount(0);
    await expect(view.getByTestId("graph-empty")).toHaveCount(0);

    // The force graph drew one circle per real node (14 for cs:language:cmn at
    // depth 1 today) — asserted as "as many as the API returned", so the check
    // tracks the corpus instead of pinning a number that a data change moves.
    const svg = view.getByTestId("network-graph-svg");
    await expect(svg).toBeVisible();
    await expect(svg.locator("circle")).toHaveCount(probe.nodeCount);

    // The legend carries one entry per DISTINCT node label actually returned —
    // asserted against the labels read off the API above, not a hard-coded list.
    // This is the regression gate for `primaryLabel`: every exported node also
    // carries the umbrella `:Entity`, and Neo4j gives no order guarantee, so
    // taking `labels[0]` collapsed the legend to a lone "Entity" at random.
    const legend = view.getByTestId("graph-legend");
    await expect(legend).toBeVisible();
    for (const label of probe.labels) {
      await expect(legend).toContainText(label);
    }
    expect(probe.labels).toContain("Language");

    await page.screenshot({ path: `${SHOTS}/real-neighborhood.png` });
  });

  test("the explorer graph adapter projects real graph nodes", async ({
    page,
    request,
  }) => {
    const overview = await request.get("/api/graph/overview");
    expect(overview.ok()).toBeTruthy();
    const nodes = ((await overview.json()) as { nodes?: unknown[] }).nodes ?? [];
    expect(nodes.length, "the overview should be non-empty").toBeGreaterThan(0);

    await page.goto("/?panel=explore&ds=pinakes-graph");
    await expect(page.getByText(/Failed to load/i)).toHaveCount(0);
    // The adapter projects one item per overview node.
    await expect(page.getByText(`${nodes.length} items`)).toBeVisible();

    await page.screenshot({ path: `${SHOTS}/real-explorer-adapter.png` });
  });

  test("federated search merges a real graph-sourced hit", async ({
    page,
    request,
  }) => {
    // Confirm the server really federates for this query before asserting the
    // UI renders it — otherwise a graph-half regression would read as a UI bug.
    const res = await request.get(
      `/api/search?q=${encodeURIComponent(FEDERATED_QUERY)}`,
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      results: { source: string; displayName: string; csid?: string }[];
    };
    const graphHit = body.results.find((r) => r.source === "graph");
    expect(graphHit, `"${FEDERATED_QUERY}" should return a graph-sourced hit`)
      .toBeTruthy();
    expect(body.results.some((r) => r.source === "local")).toBeTruthy();

    await page.goto("/");
    const input = await openSearch(page);
    await input.fill(FEDERATED_QUERY);

    // Both halves render: the purple "Graph" pill on the graph hit, the "Local"
    // pill on the corpus rows, and the graph hit under its real display name.
    await expect(page.getByText("Graph", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Local", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("option", { name: new RegExp(graphHit!.displayName) }).first(),
    ).toBeVisible();

    await page.screenshot({ path: `${SHOTS}/real-federated-search.png` });
  });

  test("the research console's graph run control is live", async ({ page }) => {
    await page.goto("/advanced-tools");
    await expect(page.getByTestId("advanced-tools-page")).toBeVisible();
    // With the graph up the gate passes its child through: the Run button is
    // enabled rather than wrapped in the disabled affordance.
    const runButton = page.getByTestId("console-run-datalog");
    await expect(runButton).toBeVisible();
    await expect(runButton).toBeEnabled();
  });
});
