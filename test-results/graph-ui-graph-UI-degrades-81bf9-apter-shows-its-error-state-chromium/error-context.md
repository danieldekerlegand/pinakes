# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: graph-ui.spec.ts >> graph UI degrades gracefully when the shared graph is down >> the explorer graph adapter shows its error state
- Location: e2e/graph-ui.spec.ts:231:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/Failed to load/i)
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for getByText(/Failed to load/i)

```

```yaml
- region "Notifications (F8)":
  - list
- link "Skip to main content":
  - /url: "#main-content"
- banner:
  - button "Hide sidebar":
    - img
  - heading "Linguistic Family Tree" [level=1]
  - button "Search everything (Cmd+K)": Search... ⌘ K
  - button "Choose language": en
  - button "Switch to dark mode"
- button "Discover Cultures"
- text: Data
- combobox: Language Families
- button "Status":
  - text: Status
  - img
- combobox: All Regions
- navigation "Primary":
  - text: Visualizations
  - button "Family Tree"
  - button "Network"
  - button "Timeline"
  - button "Map"
  - button "3D Map"
  - button "Explorer"
  - button "Lineage"
  - button "Contribute"
  - text: Data
  - button "Explore" [pressed]
  - button "Data Overview"
  - text: Tools
  - button "Text Analyzer"
  - button "Word Etymology"
  - button "Word Comparison"
  - button "Linguistic Distance"
  - button "Correlation Explorer"
  - text: Specialist Views
  - button "Phonology (IPA)"
  - button "Grammar Features"
  - button "Writing Systems"
  - button "Verb Paradigms"
  - button "Mesopotamia"
  - text: Pages
  - button "Stories"
  - button "Quiz"
  - button "Civilizations"
  - button "Scraper"
  - button "AI Review"
  - button "Ancestry (DNA)"
  - button "Hypotheses"
  - button "Immersive (3D)"
  - button "Endangered Langs"
  - button "Living Dataset"
- main:
  - text: Dataset Linguistics
  - button "Language Families Hierarchy Network Time Place Facets"
  - button "Sound Changes Time Network Facets"
  - button "Language Contacts Time Network Facets"
  - text: Culture
  - button "Cultural Lineages Time Network Hierarchy Facets"
  - button "Archaeological Cultures Time Place Network Hierarchy Facets"
  - button "Art Traditions Time Place Facets"
  - button "Literary Traditions Time Place Network Facets"
  - text: Religion
  - button "Religions Time Place Facets"
  - button "Deities Time Place Network Facets"
  - button "Myth Motifs Time Network Facets"
  - text: Military
  - button "Battles Time Place Network Facets"
  - text: Trade
  - button "Trade Goods Time Place Network Facets"
  - text: Shared Graph
  - button "Shared Culture Graph Network Time Place Hierarchy Facets" [pressed]
  - text: Visualization
  - button "Tree"
  - button "Timeline"
  - button "Map"
  - button "3D Map"
  - button "Network"
  - button "Lineage"
  - button "Table"
  - textbox "Search shared culture graph…"
  - text: Loading Shared Culture Graph…
- button "Scrape New Data"
```

# Test source

```ts
  136 |     },
  137 |   ],
  138 | };
  139 | 
  140 | function json(route: Route, body: unknown) {
  141 |   return route.fulfill({
  142 |     status: 200,
  143 |     contentType: "application/json",
  144 |     body: JSON.stringify(body),
  145 |   });
  146 | }
  147 | 
  148 | /**
  149 |  * Make the shared graph appear online for this page by intercepting the graph +
  150 |  * federated-search endpoints. Registered before navigation so the first
  151 |  * `/api/graph/status` poll already sees "up" and `GraphFeatureGate` enables its
  152 |  * children.
  153 |  */
  154 | async function mockGraphUp(page: Page) {
  155 |   await page.route(
  156 |     (url) => url.pathname === "/api/graph/status",
  157 |     (route) => json(route, STATUS_UP),
  158 |   );
  159 |   await page.route(
  160 |     (url) => url.pathname === "/api/graph/resolve",
  161 |     (route) => json(route, RESOLVE_HIT),
  162 |   );
  163 |   await page.route(
  164 |     (url) => url.pathname.startsWith("/api/graph/neighborhood/"),
  165 |     (route) => json(route, NEIGHBORHOOD),
  166 |   );
  167 |   await page.route(
  168 |     (url) => url.pathname === "/api/graph/overview",
  169 |     (route) => json(route, OVERVIEW),
  170 |   );
  171 |   await page.route(
  172 |     (url) => url.pathname === "/api/search",
  173 |     (route) => json(route, SEARCH_FEDERATED),
  174 |   );
  175 | }
  176 | 
  177 | function primaryNav(page: Page) {
  178 |   return page.getByRole("navigation", { name: "Primary" });
  179 | }
  180 | 
  181 | /** Open the global (federated) search dialog from the dashboard header. */
  182 | async function openSearch(page: Page) {
  183 |   await page.getByTestId("input-search").first().click();
  184 |   const input = page.getByPlaceholder(/Search or ask/);
  185 |   await expect(input).toBeVisible();
  186 |   return input;
  187 | }
  188 | 
  189 | // ─────────────────────────────────────────────────────────────────────────────
  190 | // Graph DOWN — real server, no mocks. Every feature must degrade gracefully.
  191 | // ─────────────────────────────────────────────────────────────────────────────
  192 | 
  193 | test.describe("graph UI degrades gracefully when the shared graph is down", () => {
  194 |   test("Show-in-graph is gated (dimmed + tooltip) on an entity panel", async ({
  195 |     page,
  196 |   }) => {
  197 |     await page.goto(`/?langDetail=${LANGUAGE_ID}`);
  198 |     // The language detail panel opened straight from the URL state.
  199 |     await expect(
  200 |       page.getByTestId("text-detail-title-mandarin"),
  201 |     ).toBeVisible();
  202 | 
  203 |     // The "Show in graph" trigger is wrapped in GraphFeatureGate(neo4j); with
  204 |     // Neo4j down it renders the disabled, tooltip-explained affordance rather
  205 |     // than a clickable-but-broken button.
  206 |     const gate = page.getByTestId("graph-feature-gate-disabled");
  207 |     await expect(gate).toBeVisible();
  208 |     // The (real, un-mocked) button still exists inside the pointer-events-none
  209 |     // wrapper — it's the child being gated, not removed.
  210 |     await expect(page.getByTestId("button-show-in-graph")).toBeAttached();
  211 | 
  212 |     // Hovering the gate surfaces the explanatory tooltip (AC: confirmed when
  213 |     // the graph is down).
  214 |     await gate.hover();
  215 |     await expect(page.getByText(/offline|unavailable/i).first()).toBeVisible();
  216 | 
  217 |     await page.screenshot({ path: `${SHOTS}/down-showingraph-gate.png` });
  218 |   });
  219 | 
  220 |   test("the research console gate is disabled with a tooltip", async ({
  221 |     page,
  222 |   }) => {
  223 |     await page.goto("/advanced-tools");
  224 |     await expect(page.getByTestId("advanced-tools-page")).toBeVisible();
  225 |     const gate = page.getByTestId("graph-feature-gate-disabled").first();
  226 |     await expect(gate).toBeVisible();
  227 |     await gate.hover();
  228 |     await expect(page.getByText(/offline|unavailable/i).first()).toBeVisible();
  229 |   });
  230 | 
  231 |   test("the explorer graph adapter shows its error state", async ({ page }) => {
  232 |     // `panel=explore` mounts UnifiedExplorer; `ds=pinakes_engine-graph` selects
  233 |     // the shared-graph adapter, whose single GET to /api/graph/overview 503s
  234 |     // when Neo4j is down.
  235 |     await page.goto("/?panel=explore&ds=pinakes_engine-graph");
> 236 |     await expect(page.getByText(/Failed to load/i)).toBeVisible();
      |                                                     ^ Error: expect(locator).toBeVisible() failed
  237 |     await page.screenshot({ path: `${SHOTS}/down-explorer-adapter.png` });
  238 |   });
  239 | 
  240 |   test("federated search returns local hits and no graph results", async ({
  241 |     page,
  242 |   }) => {
  243 |     await page.goto("/");
  244 |     const input = await openSearch(page);
  245 |     await input.fill("Mandarin");
  246 |     // The server merges graph hits only when the graph is up; with it down the
  247 |     // dialog resolves with no "Graph"-sourced results and no crash.
  248 |     await expect(page.getByText(/Searching|No results|item/i).first())
  249 |       .toBeVisible()
  250 |       .catch(() => {});
  251 |     await expect(page.getByText("Graph", { exact: true })).toHaveCount(0);
  252 |   });
  253 | });
  254 | 
  255 | // ─────────────────────────────────────────────────────────────────────────────
  256 | // Graph UP — /api/graph/* + /api/search mocked. Verify the happy-path renders.
  257 | // ─────────────────────────────────────────────────────────────────────────────
  258 | 
  259 | test.describe("graph UI renders against a (mocked) live shared graph", () => {
  260 |   test.beforeEach(async ({ page }) => {
  261 |     await mockGraphUp(page);
  262 |   });
  263 | 
  264 |   test("neighborhood view + provenance badge render for an entity", async ({
  265 |     page,
  266 |   }) => {
  267 |     await page.goto(`/?langDetail=${LANGUAGE_ID}`);
  268 |     await expect(
  269 |       page.getByTestId("text-detail-title-mandarin"),
  270 |     ).toBeVisible();
  271 | 
  272 |     // With Neo4j "up" the gate passes the child through — the button is live.
  273 |     const button = page.getByTestId("button-show-in-graph");
  274 |     await expect(button).toBeVisible();
  275 |     await button.click();
  276 | 
  277 |     // Dialog resolves the entity → csid, then lazy-loads the neighborhood view.
  278 |     const view = page.getByTestId("graph-neighborhood-view");
  279 |     await expect(view).toBeVisible();
  280 |     // Depth controls (1..3) are present.
  281 |     await expect(page.getByTestId("graph-depth-2")).toBeVisible();
  282 |     // Provenance UI: the root node is a sourced fact → the badge renders as such.
  283 |     const kind = page.getByTestId("provenance-kind").first();
  284 |     await expect(kind).toBeVisible();
  285 |     await expect(kind).toHaveAttribute("data-kind", "sourced");
  286 |     // The force graph mounted its SVG (nodes to draw).
  287 |     await expect(view.locator("svg")).toBeVisible();
  288 | 
  289 |     await page.screenshot({ path: `${SHOTS}/up-neighborhood.png` });
  290 |   });
  291 | 
  292 |   test("the explorer graph adapter loads the Shared Culture Graph", async ({
  293 |     page,
  294 |   }) => {
  295 |     await page.goto("/?panel=explore&ds=pinakes_engine-graph");
  296 |     // No error state, and the projected item count reflects the overview nodes.
  297 |     await expect(page.getByText(/Failed to load/i)).toHaveCount(0);
  298 |     await expect(page.getByText(/[1-9]\d* items/)).toBeVisible();
  299 |     await page.screenshot({ path: `${SHOTS}/up-explorer-adapter.png` });
  300 |   });
  301 | 
  302 |   test("federated search surfaces a graph-sourced result", async ({ page }) => {
  303 |     await page.goto("/");
  304 |     const input = await openSearch(page);
  305 |     await input.fill("mandarin");
  306 |     // The graph-sourced hit is tagged with the purple "Graph" source badge and
  307 |     // carries its provenance (source id) inline.
  308 |     await expect(page.getByText("Graph", { exact: true }).first()).toBeVisible();
  309 |     await expect(page.getByText("pinakes-engine").first()).toBeVisible();
  310 |     await page.screenshot({ path: `${SHOTS}/up-federated-search.png` });
  311 |   });
  312 | });
  313 | 
```