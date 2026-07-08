# Security & Hardening

Tracks the hardening work in the roadmap's [§16 "Hardening & production readiness"](./prd-linguascrape-deep-history-roadmap.md#16-hardening--production-readiness). This document grows as the `ralph/security-hardening` stories land (US-001…US-008).

## API keys are server-side only

**Principle:** third-party API keys are read only by the Express server (`process.env.*`); they are never exposed to the browser bundle. Vite inlines any `import.meta.env.VITE_*` value into client JavaScript at build time, so a `VITE_`-prefixed secret is a shipped secret. The client therefore never holds a provider key — it calls an Express **proxy endpoint**, and the server makes the authenticated upstream call.

### Gemini (US-001)

All Gemini / `@google/generative-ai` usage lives under `server/services/*` and reads the server-side **`GEMINI_API_KEY`** (model id from `GEMINI_MODEL`). The client triggers model work exclusively through Express routes; the key stays on the server.

Representative client-facing proxy endpoints (the client posts content, the server calls Gemini):

- `POST /api/extract/text` — paste-a-paragraph → structured entity drafts (Gemini). LLM boundary is injectable (`TextExtractorDeps`) so it is tested against recorded fixtures with **no live model call and no key** — see `server/routes/text-extractor.ts` and `server/routes/text-extractor.test.ts`.
- `POST /api/scraping/*` and the enrichment routes — the client sends `dataSources: ["gemini"]`; the server-side scrapers (`server/services/*-scraper.ts`, `*-enrichment.ts`, `map-image-analyzer.ts`) each build their own Gemini client from `GEMINI_API_KEY`.

**Config:** `.env.example` declares `GEMINI_API_KEY` (server) and deliberately **does not** declare `VITE_GEMINI_API_KEY`. Never reintroduce a `VITE_`-prefixed Gemini var.

**Regression guard:** `server/security/gemini-proxy.test.ts` asserts (1) `.env.example` has no `VITE_GEMINI*`, (2) no `client/` source references a Gemini key / the `@google/generative-ai` SDK / the raw `generativelanguage.googleapis.com` endpoint, and (3) the `/api/extract/text` proxy serves a keyless client request (LLM mocked) without echoing any key.

### Google Translate (US-002)

Translation is proxied server-side. The client calls **`POST /api/translate`** with `{ text, to, from? }`; the server (`server/services/translate.ts` + `server/routes/translate.ts`) makes the upstream Google Translation v2 call using the server-side **`GOOGLE_TRANSLATE_API_KEY`**. The key never reaches the browser.

- **Client:** `client/src/lib/scraping.ts`'s `GoogleTranslateAPI` posts to `/api/translate` and no longer reads any `process.env` / `VITE_` key. A `503` (no key configured) or `502` (upstream failure) degrades gracefully to the next translation source.
- **Server contract:** `200 { translation, source, from, to }`; `400` invalid body (missing `text`/`to`); `502` upstream failure; `503` when no server-side key is configured (translation is optional — the app runs without it, mirroring `GEONAMES_USERNAME`).
- **Injectable boundary:** the network call is behind `TranslateDeps` and the key is injectable, so `server/routes/translate.test.ts` exercises the proxy with a fake upstream and **no real key** (asserts the server-side key is used and never echoed back).

**Config:** `.env.example` declares `GOOGLE_TRANSLATE_API_KEY` (server) and the old `VITE_GOOGLE_TRANSLATE_API_KEY` was **removed**. Never reintroduce a `VITE_`-prefixed translate var.

**Regression guard:** `server/security/translate-proxy.test.ts` asserts (1) `.env.example` has no `VITE_GOOGLE_TRANSLATE*`, and (2) no `client/` source references a translate key or the raw `translation.googleapis.com` endpoint.

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
   + culture-scrape sidecar) is optional**: the smoke asserts graceful degradation
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

<!-- US-007 (deferred graph-UI browser verification) section lands as that story completes. -->
