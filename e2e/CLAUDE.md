# e2e/ — Playwright browser smoke (US-006) + graph-UI verification (US-007)

Headless-Chromium coverage of the core UI flows. Runner is `@playwright/test`
(separate from vitest): `npm run test:e2e`. Config: `../web/playwright.config.ts`
(it moved off the root with the other TS build configs — 20-repo-restructure US-2 —
so `testDir`, the dev server's `cwd` and the artifact dirs there are all `../`-relative).

`smoke.spec.ts` = the core-flow smoke (US-006). `graph-ui.spec.ts` = browser
verification of the four graph-dependent features (US-007): the neighborhood
view, the explorer graph adapter, federated search, and the provenance UI — each
exercised in **three** ways (pinakes:100 US-2): graph-**down** (real server, no
mocks → graceful degradation), graph-**up-mocked** (`/api/graph/*` + `/api/search`
intercepted at the network boundary, the same fixture approach the vitest suites
use), and against the **REAL populated graph** (Neo4j loaded from the canonical
export, no mocks, asserting on named corpus content).

`support/graph-state.ts` is not a spec — it holds the shared `/api/graph/status`
probe the graph-state-aware describes branch on. Helpers live under `support/`;
`testMatch` is `*.spec.ts`, so nothing there is collected as a test.

`civilizations.spec.ts` = the data-population pilot verification (US-005): the
expanded civilizations corpus renders on the **map** (via the `layers=` URL
preset), in the **UnifiedExplorer** (the `ds=civilizations` adapter), and in the
**detail panel with provenance** (`provenance-list` + `provenance-source-link`).
All TSV-backed, so it needs no graph.

## Conventions & gotchas

- **Preset a map layer via the URL, don't drive the LayerPanel.** Map layers are
  off-by-default and toggling one means opening the panel + expanding a collapsed
  category. Instead `goto("/?view=map&layers=<layerId>")` — `useMapLayers` reads
  the `layers=` param and marks those visible on load, firing the layer's data
  query. `view=map` (a top-level `ViewMode`) opens the map, NOT `panel=map`.
- **Clicking a UnifiedExplorer Table row: use `dispatchEvent("click")`, not
  `.click()`.** The `GenericExplorer` rows live in a scroll container under a
  sticky filter toolbar; a coordinate click either lands on the toolbar overlay
  ("intercepts pointer events") or the row resolves "outside of the viewport".
  `page.getByRole("row", {name}).dispatchEvent("click")` fires the row's
  `onSelect` handler directly, bypassing actionability. (Deep-linking with `ds=`
  also leaves the dataset picker expanded over the content — fine for DOM
  assertions, but full-page screenshots capture the picker, not the detail aside.)

- **`*.spec.ts` here, `*.test.ts` everywhere else.** vitest's `include` is
  `**/*.test.ts` and Playwright's `testMatch` is `*.spec.ts`, so the two runners
  never pick up each other's files. Never name an e2e file `*.test.ts`.
- **Not type-checked by `npm run check`.** The project `web/tsconfig.json`
  `include` is only `web/src`/`contracts`/`server`, so `e2e/` is outside it.
  Playwright transpiles specs itself. (Keep them clean anyway.)
- **The dev server is booted by Playwright** via `webServer` (`npm run build &&
  npm start` on `E2E_PORT`, default `3055` — distinct from the usual `3050`).
  Locally it **reuses** an already-running server; in CI (`process.env.CI`) it
  starts its own. No external services required.
- **`npm install` does NOT install the browser.** Only the `@playwright/test`
  package is a dependency; a fresh checkout fails every spec with *"Executable
  doesn't exist … npx playwright install"*, which reads like 19 spec failures and
  is not one. `npm run test:e2e:graph` runs `npx playwright install chromium`
  (idempotent) for you; `npm run test:e2e` does not.
- **Service workers are BLOCKED** (`use.serviceWorkers: "block"`). The suite
  drives the PRODUCTION client, which registers `/sw.js`, and a service worker's
  fetches **bypass `page.route` entirely** — so before this was set, every
  `/api/*` interception a spec registered silently did nothing and the "graph up"
  mocks asserted against whatever the real server (or the SW cache) answered.
  If a `page.route` handler you are sure about never fires, check this first.
- **The shared graph is OPTIONAL, so a graph spec BRANCHES on its state** —
  it does not `.or()` the two outcomes together. `support/graph-state.ts`'s
  `graphIsUp(request)` probes `/api/graph/status` once per worker, and a describe
  calls `test.skip(...)` in a `beforeEach` for the state it does not apply to.
  Why not `.or()`: "the gate is dimmed" and "the live control rendered real data"
  are mutually exclusive claims about the same DOM, and an `.or()` of them passes
  whichever one regresses. The suite is green **both** ways — 15 passed / 4
  skipped with the graph down, and the complementary 15/4 with it up.
- **Run it against real data with `npm run test:e2e:graph`** (`scripts/e2e-graph.sh`):
  `graph-up.sh` → export the `graph-env.sh` variables → `playwright test`.
  `webServer.env` merges with `process.env`, which is how the service Playwright
  boots reaches the populated corpus. The script **refuses to run** when a server
  already listening on the port reports anything less than `neo4j` + `sidecar`
  true — a reused server keeps the environment it was started with, so without
  that guard the run would quietly verify the graph-down branch and call it a
  populated-graph pass. Runbook: `docs/populated-graph-runbook.md`.
- **Artifacts are NOT committed.** `test-results/` and `playwright-report/` are
  gitignored, so the screenshots specs write (`test-results/<spec>/…png`) are
  local evidence, never repo content. Eight of them had been force-added anyway —
  including `test-failed-1.png` + `error-context.md` from a *red* run — which made
  every e2e run dirty the working tree; untracked in pinakes:100 US-2. If you
  want a screenshot to be durable evidence, assert the DOM instead: the assertion
  is the record, the image is a supporting snapshot.
- **Assert on data read from the API, not on hard-coded counts.** The
  populated-graph specs probe the endpoint first (`realNeighborhood()`), then
  assert the DOM matches *that* — so the check tracks the corpus instead of
  pinning a number a data change moves, and an empty graph fails the probe
  instead of passing a vacuous DOM assertion.
- **Selector priority:** `getByTestId` / accessible names (`getByRole`,
  `getByPlaceholder`) over CSS, so the smoke tracks behavior not styling. Scope
  sidebar clicks to `getByRole("navigation", { name: "Primary" })` and use
  `{ exact: true }` for `"Map"` (else it also matches `"3D Map"`).
- **Heavy lazy views need a healthy main thread.** The Leaflet map
  (`EnhancedLanguageMapView`) is `React.lazy`; if any always-mounted component is
  stuck in a render loop, React never commits the Suspense resolution and the map
  hangs on its "Loading map…" fallback forever (not a timeout you can wait out).
  If a lazy view won't mount, check the browser console for "Maximum update depth
  exceeded" first — a runaway effect elsewhere is the usual culprit, not the view.
- **Effect-dep loop pattern to watch for** (the bug this smoke caught): an effect
  that both **depends on** a state value and **writes a fresh reference** to it
  (`setX([])`/`setX({})`) on some branch loops forever, because the new reference
  re-satisfies the dep. Fix with a functional updater that returns `prev`
  unchanged when there's nothing to do: `setX(prev => prev.length ? [] : prev)`.
- **The force graph's SVG has `data-testid="network-graph-svg"`** (both
  `visualizations/shared/NetworkGraph.tsx` — used by the graph neighborhood view —
  and the neighborhood also renders lucide icon `<svg>`s). Target the graph by
  that testid, never `locator("svg")`, or you hit a strict-mode multi-match.
- **Graph reads fast-fail (US-007 fix).** `graph-store.runRead` now pre-checks the
  cached `isAvailable()` probe, so a read against a down graph 503s in <1ms instead
  of waiting out the driver's ~15s retry window. That is what lets the explorer
  graph adapter show its "Failed to load" state promptly when the graph is down —
  before, it hung on "Loading…" past the test timeout.
- **Neo4j does not order a node's labels, and every exported node carries the
  umbrella `:Entity`.** `primaryLabel()` therefore skips `:Entity` when the node
  has a specific label (`web/src/lib/graph/neighborhood-graph.ts`). Taking
  `labels[0]` typed whole neighborhoods as "Entity" — one legend entry, one
  colour — nondeterministically, and only ever against the real graph: the
  fixtures list the specific label first, so no unit test could see it. This is
  the class of bug the populated-graph run exists to catch.
- **`UnifiedExplorer` status messages have a `min-h-[240px]` floor.** The
  loading/error/suspense divs use `h-full`; on a cold deep-link mount
  (`?panel=explore&ds=…`) the flex content pane can resolve to 0 height, hiding the
  message (Playwright `toBeVisible` → "hidden"). The floor keeps the graph-down
  error legible to users and the test.
