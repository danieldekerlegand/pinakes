# e2e/ — Playwright browser smoke (US-006)

Headless-Chromium coverage of the core UI flows. Runner is `@playwright/test`
(separate from vitest): `npm run test:e2e`. Config: `../playwright.config.ts`.

## Conventions & gotchas

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
