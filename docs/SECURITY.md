# Security & Hardening

Tracks the `ralph/security-hardening` work (US-001…US-008), cross-linked from the roadmap's [Phase-15 status → Hardening](./prd-pinakes-deep-history-roadmap.md#phase-15-status-so-far) bullet.

## API keys are server-side only

**Principle:** third-party API keys are read only by the server (`process.env.*` on Express, `os.environ` on the Python service — both proxies below are Python's since pinakes:64 US-1); they are never exposed to the browser bundle. Vite inlines any `import.meta.env.VITE_*` value into client JavaScript at build time, so a `VITE_`-prefixed secret is a shipped secret. The client therefore never holds a provider key — it calls a **proxy endpoint**, and the server makes the authenticated upstream call. Which *backend* answers the proxy is an implementation detail the guards below deliberately do not depend on.

### Gemini (US-001)

All Gemini / `@google/generative-ai` usage lives under `server/services/*` and reads the server-side **`GEMINI_API_KEY`** (model id from `GEMINI_MODEL`). The client triggers model work exclusively through Express routes; the key stays on the server.

Representative client-facing proxy endpoints (the client posts content, the server calls Gemini):

- `POST /api/extract/text` — paste-a-paragraph → structured entity drafts (Gemini). **Served by the Python service** (`services/api/src/pinakes/routers/extract.py` over `pinakes.ingest.text_extractor`; the Express handler answers 501). The model is called over REST with the key in an `x-goog-api-key` **header** — never a query parameter, which every hop in between would log. The boundary is injectable (`TextExtractorDeps`) so it is tested against recorded fixtures with **no live model call and no key** — see `services/api/tests/test_text_extractor.py`.
- `POST /api/scraping/*` and the enrichment routes — the client sends `dataSources: ["gemini"]`; the server-side scrapers (`server/services/*-scraper.ts`, `*-enrichment.ts`, `map-image-analyzer.ts`) each build their own Gemini client from `GEMINI_API_KEY`.

**Config:** `.env.example` declares `GEMINI_API_KEY` (server) and deliberately **does not** declare `VITE_GEMINI_API_KEY`. Never reintroduce a `VITE_`-prefixed Gemini var.

**Regression guard:** `server/security/gemini-proxy.test.ts` asserts (1) `.env.example` has no `VITE_GEMINI*`, (2) no `web/` source references a Gemini key / the `@google/generative-ai` SDK / the raw `generativelanguage.googleapis.com` endpoint, and (3) this backend's retired `/api/extract/text` handler cannot echo key material either. That the *Python* proxy serves a keyless client request and returns no key is `services/api/tests/test_ingest_routes.py`. Guards (1) and (2) are the load-bearing ones and are backend-agnostic by construction.

### Google Translate (US-002)

Translation is proxied server-side. The client calls **`POST /api/translate`** with `{ text, to, from? }`; the server (`services/api/src/pinakes/routers/translate.py` over `pinakes.ingest.translate` since pinakes:64 US-1 — `server/services/translate.ts` remains its graded spec) makes the upstream Google Translation v2 call using the server-side **`GOOGLE_TRANSLATE_API_KEY`**. The key never reaches the browser.

- **Client:** `web/src/lib/scraping.ts`'s `GoogleTranslateAPI` posts to `/api/translate` and no longer reads any `process.env` / `VITE_` key. A `503` (no key configured) or `502` (upstream failure) degrades gracefully to the next translation source.
- **Server contract:** `200 { translation, source, from, to }`; `400` invalid body (missing `text`/`to`); `502` upstream failure; `503` when no server-side key is configured (translation is optional — the app runs without it, mirroring `GEONAMES_USERNAME`).
- **Injectable boundary:** the network call is behind `TranslateDeps` and the key is a parameter, so `services/api/tests/{test_translate,test_ingest_routes}.py` exercise the proxy with a fake upstream and **no real key** (asserting the server-side key is used and never echoed back). The live call is a POST through the engine's rate-limited client, and is **not cached** — a cached response carries the URL it was fetched from.

**Config:** `.env.example` declares `GOOGLE_TRANSLATE_API_KEY` (server) and the old `VITE_GOOGLE_TRANSLATE_API_KEY` was **removed**. Never reintroduce a `VITE_`-prefixed translate var.

**Regression guard:** `server/security/translate-proxy.test.ts` asserts (1) `.env.example` has no `VITE_GOOGLE_TRANSLATE*`, and (2) no `web/` source references a translate key or the raw `translation.googleapis.com` endpoint.

## Secret scanning (US-003)

A guard blocks committing `.env` files or key-like / high-entropy secrets — so a
credential can never re-enter the tree the way the original `.env` did. It is a
self-contained TypeScript scanner (no external binary to install), run two ways:

- **Pre-commit hook** — `.githooks/pre-commit` runs `npm run secret-scan:staged`,
  which scans only the **staged** content (the exact blobs about to be committed).
  A hit aborts the commit.
- **CI** — `.github/workflows/secret-scan.yml` runs `npm run secret-scan` on every
  push / pull request, scanning the **entire tracked tree** and failing the build
  on any finding.

### Setup

Installing the hook is a one-liner, and the `prepare` npm script runs it
automatically after `npm install`:

```sh
git config core.hooksPath .githooks     # done for you by `npm install` (prepare script)
```

### Running it locally

```sh
npm run secret-scan          # scan the whole tracked tree (what CI runs)
npm run secret-scan:staged   # scan only staged changes (what the hook runs)
```

Exit `0` = clean, `1` = secrets found (each finding is printed with the file,
line, rule, and a **masked** excerpt so the report itself never re-leaks the
secret).

### What it detects

- Any real `.env` file by path (`.env`, `.env.production`, …) — templates
  (`.env.example`, `*.sample`, `*.template`) are intentionally allowed.
- Provider-prefixed keys: AWS access-key ids (`AKIA…`), Google API keys
  (`AIza…`), OpenAI/Anthropic `sk-…`, GitHub `ghp_…`, Slack `xox…`, Google OAuth
  `GOCSPX-…`.
- `-----BEGIN … PRIVATE KEY-----` blocks.
- A secret-named variable (`api_key`, `secret`, `token`, `password`, …) assigned a
  **high-entropy** value (≥ 3.5 bits/char, ≥ 20 chars, mixed character classes).
  Placeholders (`process.env.*`, `${…}`, `changeme`, `your-key-here`, empty
  strings) and low-entropy dictionary words are deliberately not flagged, which is
  what keeps the whole current tree passing.

### False positives

Two escape hatches (mirroring gitleaks): append an inline `secret-scan:allow`
comment to a known-safe sample line, or add the path to the allowlist in
`scripts/secret-scan.ts`. In a genuine emergency a commit can bypass the hook with
`git commit --no-verify` (CI still scans the full tree).

The pure core `scanForSecrets(files)` is filesystem/network-free and covered by
`scripts/secret-scan.test.ts` — including a **planted-secret** case that proves the
scanner trips on a real leak while passing on ordinary source.

## End-to-end verification (US-006)

Automated browser coverage guards the core UI flows against regressions (the kind
that unit tests miss because they never mount the real page). The smoke lives in
[`e2e/smoke.spec.ts`](../e2e/smoke.spec.ts) and runs under Playwright.

### What it covers

Four core flows in headless Chromium against a real dev build:

1. **Dashboard shell** — the app boots and the primary navigation mounts (proves
   the React tree renders without a fatal error).
2. **Map** — switching to the "Map" view mounts the Leaflet canvas
   (`.leaflet-container`); tiles are not required, so it passes with no network.
3. **UnifiedExplorer** — the "Explore" section loads a dataset over the real
   client → Express → TSV path and renders its item count.
4. **Graph feature** — `/advanced-tools` (the graph research console) opens, and
   the graph-dependent "Run" trigger is present either live or as the
   `GraphFeatureGate` disabled-with-tooltip affordance. **The shared graph (Neo4j
   + pinakes-engine sidecar) is optional**: the smoke asserts graceful degradation
   rather than requiring a live graph, so it runs the same locally and in CI.

### Running it

```bash
npm install                       # once — installs @playwright/test
npx playwright install chromium   # once — downloads the browser
npm run test:e2e                  # boots `npm run dev` and runs the smoke
```

Add `--headed` or `--ui` to watch it locally. Config is
[`playwright.config.ts`](../playwright.config.ts): it starts the dev server on
`E2E_PORT` (default `3055`, separate from the usual `3050` so it won't collide
with a running dev server), reuses an already-running server locally, and spins up
its own in CI.

### In CI

[`.github/workflows/e2e.yml`](../.github/workflows/e2e.yml) runs on every push/PR:
`npm ci` → `npx playwright install --with-deps chromium` → `npm run test:e2e`
(headless, with retries; the HTML report is uploaded as an artifact on failure).
No external services are provisioned — the graph stays down and the smoke asserts
the degraded affordance.

### Regression found & fixed

Writing the smoke surfaced a pre-existing infinite render loop in
`global-search-dialog.tsx`: an effect listed `typeFilters` in its dependency array
and reset it to a fresh `[]` on the empty-query path, so the new array reference
re-triggered the effect on every run. It fired on mount (the query starts empty),
pegging the main thread and starving the lazy map view's Suspense commit so the
map never rendered. Fixed by bailing out via the functional updater when the value
is already empty (stable reference). This is exactly the class of bug e2e coverage
exists to catch.

## Graph-UI browser verification (US-007)

Four graph-dependent UI features were merged gated only on unit tests. US-007
confirms them in a real browser via [`e2e/graph-ui.spec.ts`](../e2e/graph-ui.spec.ts),
which exercises each feature in **both** graph-up and graph-down states so the
degraded affordances are proven, not assumed. As with the smoke, **no live Neo4j
or sidecar is required**: the graph-up path is produced by intercepting
`/api/graph/*` and `/api/search` at the Playwright network boundary, and the
graph-down path just lets the real server return its unavailable responses.

### What it verifies

1. **Graph neighborhood view** — the force-directed graph renders
   (`data-testid="network-graph-svg"` on [`shared/NetworkGraph.tsx`](../web/src/components/visualizations/shared/NetworkGraph.tsx)),
   with the Depth 1/2/3 controls and the provenance (`SOURCED`) badge.
2. **Explorer graph adapter** — the "Shared Culture Graph" dataset loads its item
   count when the graph is up, and shows a prompt "Failed to load" when it is down
   (rather than hanging).
3. **Federated search** — a purple **Graph** source badge + pinakes-engine
   provenance appears when up; local-only hits when down.
4. **`GraphFeatureGate`** — the "Show in graph" button and the research-console
   trigger render **disabled with an offline/unavailable tooltip** when the graph
   is down (the affordance called out in the acceptance criteria).

Result: **11/11 passing** (7 graph-ui + 4 smoke), screenshots under
`test-results/graph-ui/`.

### Fixes surfaced by the verification

- **`/api/graph/overview` slow-fail (~15s):** graph reads waited out the Neo4j
  driver's retry window when the graph was down, so the explorer adapter hung past
  the test timeout. Fixed by fast-failing in
  [`server/services/graph-store.ts`](../server/services/graph-store.ts) `runRead`
  via the cached `isAvailable()` probe (now <1ms). Any graph-backed UI now
  degrades promptly.
- **Invisible explorer error on cold deep-link:** on a `?panel=explore&ds=…` mount
  the flex content pane resolved to 0 height, hiding the loading/error states.
  Fixed with a `min-h` floor in
  [`UnifiedExplorer.tsx`](../web/src/components/explorer/UnifiedExplorer.tsx).

### Running it

```bash
npx playwright test e2e/graph-ui.spec.ts   # both graph-up and graph-down states
```

## Typecheck as a verification gate (US-004 / US-005)

The global `tsc` check is part of the hardening posture: a green typecheck is what
makes "types pass" a literal, enforceable gate rather than a baseline of noise.
US-004 cleared the largest offender (`server/tsv-storage.ts`) and US-005 cleared
the remainder, so **`npm run check` now reports 0 errors** (down from ~145
pre-existing). Treat it as **strict** going forward — a new type error is a
regression to fix, not a baseline to grow. The `verify` gate can rely on it
literally.

> **Branch note:** these fixes live on `ralph/security-hardening`. On `main` the
> ~145 errors still exist until this branch merges; run `npm run check` on the
> feature branch to see the green state.

## Story → posture map

Where each hardening story lands against the roadmap's
[Phase-15 → Hardening](./prd-pinakes-deep-history-roadmap.md#phase-15-status-so-far) bullet:

| Story | Hardening outcome | Addresses |
| --- | --- | --- |
| US-001 | Gemini key server-side only (proxy) | key exposure / rotation |
| US-002 | Google Translate key server-side only (proxy) | key exposure / rotation |
| US-003 | Secret scanning (pre-commit + CI) blocks re-committing secrets | key exposure |
| US-004 / US-005 | `npm run check` green — strict typecheck gate | clear the 145 `tsc` errors |
| US-006 | Playwright e2e smoke for core flows | browser/e2e verification |
| US-007 | Graph-UI browser verification (up + down states) | browser/e2e verification |
| US-008 | This document | — |

**Out of scope / human-only:** rotating the previously-exposed `.env` secrets and
purging the file from git history are manual operations (the untrack + `.gitignore`
are already done). Sourcing real fallback assets (audio clips, glTF models) and
building/loading the full pinakes-engine corpus are roadmap §15 (data population)
and §16 (production-verification) work, not security hardening.
