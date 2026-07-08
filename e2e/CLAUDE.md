# e2e/ — Playwright browser smoke (US-006) + graph-UI verification (US-007)

Headless-Chromium coverage of the core UI flows. Runner is `@playwright/test`
(separate from vitest): `npm run test:e2e`. Config: `../playwright.config.ts`.

`smoke.spec.ts` = the core-flow smoke (US-006). `graph-ui.spec.ts` = browser
verification of the four graph-dependent features (US-007): the neighborhood
view, the explorer graph adapter, federated search, and the provenance UI — each
exercised **both** graph-down (real server, no mocks → graceful degradation) and
graph-up (`/api/graph/*` + `/api/search` intercepted at the network boundary, the
same fixture approach the vitest suites use).

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
- **Not type-checked by `npm run check`.** The root `tsconfig.json` `include` is
  only `client/src`/`shared`/`server`, so `e2e/` is outside it. Playwright
  transpiles specs itself. (Keep them clean anyway.)
- **The dev server is booted by Playwright** via `webServer` (`npm run dev` on
  `E2E_PORT`, default `3055` — distinct from the usual `3050`). Locally it reuses
  an already-running server; in CI (`process.env.CI`) it starts its own. No
  external services required.
- **The shared graph is OPTIONAL.** Neo4j + the culture-scrape sidecar are down in
  CI, so graph features render the `GraphFeatureGate` disabled affordance
  (`data-testid="graph-feature-gate-disabled"`). Assert *that*, or `.or()` it with
  the live control — never require a live graph.
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
- **`UnifiedExplorer` status messages have a `min-h-[240px]` floor.** The
  loading/error/suspense divs use `h-full`; on a cold deep-link mount
  (`?panel=explore&ds=…`) the flex content pane can resolve to 0 height, hiding the
  message (Playwright `toBeVisible` → "hidden"). The floor keeps the graph-down
  error legible to users and the test.
