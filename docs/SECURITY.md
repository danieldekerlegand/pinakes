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

<!-- US-003 (secret scanning), US-006/US-007 (e2e/browser verification) sections land as those stories complete. -->
