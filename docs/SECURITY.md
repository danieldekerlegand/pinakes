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

<!-- US-002 (Google Translate proxy), US-003 (secret scanning), US-006/US-007 (e2e/browser verification) sections land as those stories complete. -->
