# pinakes — Roadmap

> The knowledge/data hub of the neuro-symbolic ecosystem: a Wikidata-anchored
> **canonical graph** and an interactive **world-cultures atlas** (languages × geography ×
> time × culture), served as a koine/agora fabric participant. North star: *the primary
> open reference for tracing any modern culture back through millennia.*

**Status:** Feature-complete & architecturally consolidated — the atlas *engine* is built and the
corpus is populated (14/15 domains at target); now in a **production-hardening + data-growth** tail
with a small, mined "second act" (Phases A–C below) · **Last updated:** 2026-08-10

This is the single canonical roadmap. It consolidates three superseded product-roadmap
documents (now under [`docs/roadmap/`](docs/roadmap/)) and the architecture-rewrite plan
([`docs/UNIFIED-PROJECT-PLAN.md`](docs/UNIFIED-PROJECT-PLAN.md)). Every phase both of those
described has shipped; what remains — the production-verification pass, source-adapter breadth, and
the last fabric verbs — is folded into the one **Milestones** list below rather than kept in a
separate "next" section. Where those docs describe work as "planned/next," this file records what
actually shipped and what is honestly still open.

---

## Vision & Scope

pinakes is two things that reinforce each other:

1. **A world-cultures atlas** — languages (living, historical, reconstructed) plus 15+ cultural
   domains (cuisine, music, religion, art, architecture, dance, literature, writing systems,
   deities, myth, trade, genetics/haplogroups, social organization, …), each temporally and
   geographically situated and cross-linked.
2. **The ecosystem's canonical knowledge authority** — a Wikidata-anchored graph that other
   fabric peers ground against, published as a koine **KCB provider** and (via `lugh`) a
   specialized **KFT** fine-tuning provider.

**In scope:** curated multi-domain corpus, the graph + analytical index, the atlas client,
acquisition/scraping, contribution + review, citation/versioned releases, fabric participation.
**Out of scope:** general format translation (moved to agora), model training (moved to `lugh`).

## Current State

- **One Python (FastAPI) service + one React/Vite client.** The former TS/Express backend and
  the Python `culturescrape` engine were unified into one in-process service (`services/api` +
  `engine/`); Node/Express/Drizzle/DVC are gone. `contracts/` holds the shared schema with
  generated Python + TS bindings and a drift gate.
- **Persistence:** Neo4j (graph) · TSV corpus under `data/source/lexicons/` · DuckDB analytical
  index · JSON runtime stores. No SQL app DB.
- **Corpus at scale:** **14 of 15** Phase-15 data-population targets met (170 civilizations, 550
  archaeological sites, 277 archaeological cultures, 206 deities, 115 writing systems, 101
  cuisines, …). The one exception is **`language-range-polygons`, landed at 133/200** — Wikidata
  carries no inline range polygons for the corpus, so closing the gap needs a non-Wikidata source
  (see Phase B). This is honestly flagged in the live `/api/data-quality` coverage report.
- **Fabric:** serves its KCB manifest / AgentCard, resolves KINP identity, advertises the KFT
  `finetune` capability (dispatched to the `lugh` checkout). *Caveat:* since the `80` Python-only
  cutover the `finetune` MCP tool is **advertised but its invoke degrades** — the Python service
  cannot spawn the `lugh` subprocess the way the retired Express front did (see Phase C).
- **Chief program:** all 16 tasklists (`10`–`91`) merged; **nothing pending**.

---

## Milestones

One list, everything: shipped, in-progress, and planned. The **architecture** track (the TS→Python
rewrite + fabric integration, driven by Chief) and the **product** track (atlas features + data,
driven by the PRDs / Ralph / ralphy) ran in parallel and are both complete; Phases **A**–**C** are
the mined-but-unbuilt "second act"; the **Ongoing** and **Loose wishlist** blocks at the end cover
steady-state and un-phased work. Status legend: **✅ shipped/merged · 🚧 partial / in-progress ·
⬜ not started**. The Tasklist column is the Chief tasklist that delivered a row (✅ merged) or the
*(proposed)* one that would (none of the `chief/100+` rows are authored yet).

### Architecture & platform track — ✅ complete

The TS→Python rewrite + fabric integration, driven by Chief (`10`–`91`).

| Status | Milestone | Tasklist |
|---|---|---|
| ✅ | Foundation & cleanup — drop DVC/Drizzle, new repo skeleton, `culturescrape`→`pinakes_engine`, FastAPI shell, parity spec | `chief/10`,`20`,`30` |
| ✅ | Contracts codegen — language-neutral schema → generated Py+TS bindings + drift gate | `chief/40` |
| ✅ | Engine in-process — fold sidecar/CLI seams into direct calls; port graph routes | `chief/50` |
| ✅ | Port the backend — contributions, collab stores, analytics, entity/search, ingest, catalog/bus — each parity-gated | `chief/60`–`65` |
| ✅ | Unify scrapers — one Python acquisition layer; retire the ~14k-LOC TS scraper stack | `chief/70` |
| ✅ | Cutover — delete `server/`, one process serves client + all `/api`; 306/306 parity | `chief/80` |
| ✅ | Extract `lugh` — training/ML workspace → private `lugh` repo as `lugh:agent:finetune` | `chief/90-extract-lugh` |
| ✅ | Repatriate koine config — self-describing participant config in-repo | `chief/90-repatriate-koine-config` |
| ✅ | Publish corpus artifact — versioned corpus release/DOI surface | `chief/91` |
| ⬜ | **Rust/Go hot path** — `pyo3` bulk-transform accel; **Deferred** — re-evaluate only if corpus profiling justifies (acquisition is 96–99% network-bound; see [`docs/acquisition-throughput.md`](docs/acquisition-throughput.md)) | — *(deferred, unscheduled)* |

### Product & feature track — ✅ complete (Phases 1–15, one data gap)

Atlas features + data, driven by the product PRDs (Ralph / ralphy). Phases 1–6 are the original
atlas PRD; 7–15 the deep-history PRD.

| Status | Milestone | Tasklist |
|---|---|---|
| ✅ | 1 — Sample texts & text-level etymology | ralphy (archived) |
| ✅ | 2 — Structural linguistic comparison (phonology, grammar, writing systems) | ralphy (archived) |
| ✅ | 3 — Animated temporal atlas (civilizations, sites, migrations, battles) | ralphy (archived) |
| ✅ | 4 — Cross-domain correlation & deep analysis | ralphy (archived) |
| ✅ | 5 — Expanded cultural domains (material culture, foodways, kinship, arts, economy) | ralphy (archived) |
| ✅ | 6 — Platform maturity (global search, narratives, deep-linking, perf, a11y) | ralphy (archived) |
| ✅ | 7 — Deep-history lineage engine ("Yamnaya → Persians" traversable) | `ralphy-deephistory-6` |
| ✅ | 8 — Massive data expansion (civilizations, sites, migrations, ranges, trade) | `ralphy-phase9-data-expansion` |
| ✅ | 9 — New cultural domains (dance, literature, architecture, writing systems, …) | `ralphy-phase12-culture-explorer` |
| ✅ | 10 — Advanced map & visualization (organic boundaries, 3D globe, Sankey/chord/treemap) | `ralphy-phase10/11` + UnifiedExplorer |
| ✅ | 11 — Data acquisition & scraping (GeoNames, Open Context/tDAR, AI-assisted, review queue) | Ralph `data-acquisition` @577a209 |
| ✅ | 12 — Narrative & education (what-if overlays, quizzes, BibTeX/DOI, stable URLs) | Ralph `narrative-education` @ce4ef9f |
| ✅ | 13 — Platform & infrastructure (DuckDB index, bbox tiling, faceted search, PWA/offline, i18n/RTL) | Ralph `platform-infra` @963c07b |
| ✅ | 14 — Speculative & long-term (DNA-to-culture, IPA/music audio, AI insights, AR/VR, living dataset) — *several features ship with fallbacks pending real assets (see Phase A)* | Ralph `speculative` @ed5a7f2 |
| ✅ | Convergence — data-layer schema + Python ingest/graph + app graph integration + operationalize | Ralph `data-layer-convergence`/`pinakes-convergence-python`/`graph-app-integration`/`operationalize-graph` |
| 🚧 | 15 — Data population at scale — **14/15 domains at target**; `language-range-polygons` at **133/200** (no Wikidata polygons — closed in Phase B) | Ralph `data-population` |

> The Feb-2026 [`COMPREHENSIVE_ROADMAP`](docs/roadmap/COMPREHENSIVE_ROADMAP.md) predates this
> work; its "2/6 domains / Phase-6 pending" status is **superseded** — those domains and polish
> shipped in Phases 7–15. It is retained as the original atlas vision.

### Phase A — Real-data production hardening — ⬜ planned (scale: M)

The atlas *engine* is complete and the corpus is populated; this phase turns a working, unit-gated
engine into a **browser-verified, asset-complete, citable** production atlas. Source:
[`prd-pinakes-deep-history-roadmap.md`](docs/roadmap/prd-pinakes-deep-history-roadmap.md) §16 /
§"Not yet hardened" / §15.

| Status | Milestone | Tasklist |
|---|---|---|
| ⬜ | Browser-verify the UI against the **populated** graph — `npm run dev:full` + `smoke:graph` + Playwright; confirm the unit-test-gated UI stories work with real data (§16, §"Not yet hardened") · M | `chief/100-browser-verify-populated-graph` *(proposed)* |
| ⬜ | Source **real assets** to replace the speculative fallbacks — IPA/music-pronunciation audio, glTF/3D artifact models (§14.2/§14.3, §16) · M/L | `chief/101-source-real-media-assets` *(proposed)* |
| ⬜ | Publish the **first** versioned **DOI** dataset snapshot off the populated corpus (§16, §12.4) · S | `chief/102-first-doi-dataset-snapshot` *(proposed)* |
| ⬜ | ⚠️ **Security tail (human-only)** — rotate the exposed Gemini/Google-Translate keys, purge `.env` from git history + force-push (`security-hardening` closed everything else; this is the one open, key-custody item) · S | `chief/103-rotate-keys-purge-env-history` *(proposed)* |
| ⬜ | Legacy `tsc` cleanup — the 145 pre-existing `npm run check` errors (§"Not yet hardened") · S | `chief/104-legacy-tsc-cleanup` *(proposed)* |
| ⬜ | `EXPORT_DIR` unify — the blanket rename left the engine export under tracked `export/pinakes_engine` instead of gitignored `build/corpus` ([`UNIFIED-PROJECT-PLAN.md` §4](docs/UNIFIED-PROJECT-PLAN.md)) · S | `chief/105-export-dir-unify` *(proposed)* |

*Depends on:* the §15 populated corpus (shipped). The security tail is **human-only** — key custody
and a history rewrite are not agent work — and does not block the other rows.

### Phase B — Source-adapter expansion — ⬜ planned (scale: M)

Widen acquisition breadth past the shipped Wikidata/kaikki/WALS/PHOIBLE surfaces, and close the one
data gap Wikidata cannot. Source: [`engine/docs/sources-linguistic.md`](engine/docs/sources-linguistic.md),
[`engine/docs/sources-genetic.md`](engine/docs/sources-genetic.md).

| Status | Milestone | Tasklist |
|---|---|---|
| ⬜ | A **reusable CLDF dump adapter** (`source.type: dump`), modelled on the Getty/Pleiades dump adapters — the shared plumbing every CLDF source below rides on · M | `chief/106-reusable-cldf-dump-adapter` *(proposed)* |
| ⬜ | **Glottolog** 5.x CLDF category spec — the authoritative open language-family tree (`DESCENDS_FROM` genealogy); the doc's **"best next target"**, still unbuilt (WALS/PHOIBLE + kaikki already shipped, US-002/US-004) · M | `chief/107-glottolog-cldf-adapter` *(proposed)* |
| ⬜ | **DBpedia `dbo:influencedBy`** adapter — broader (noisier) `INFLUENCED_BY`/derivation coverage; license-aware (CC-BY-SA) SPARQL/dump ingest (sources-genetic §"Next") · M | `chief/108-dbpedia-influencedby-adapter` *(proposed)* |
| ⬜ | A **non-Wikidata `language-range-polygons`** source to close **133/200** — historical/modern range GeoJSON (Glottolog/Ethnologue-style boundaries), the one Phase-15 target Wikidata cannot supply · M | `chief/109-language-range-polygon-source` *(proposed)* |

*Depends on:* none — all engine-side adapter work; `107`–`109` build on the reusable dump adapter
(`106`) and the existing Getty/Pleiades dump-adapter pattern. *(Doc note: sources-linguistic.md's
candidate table lists WALS/PHOIBLE as "not yet built," but its Decision §3 records them shipped as
US-002 — the Decision is authoritative, so only Glottolog remains from that trio.)*

### Phase C — Fabric completion — ⬜ planned (scale: M)

The last KCB/KGP verbs and the grant-enforcement seam the capability-bus doc lists as **"Not yet
built."** Source: [`docs/capability-bus.md`](docs/capability-bus.md) §"Not yet built".

| Status | Milestone | Tasklist |
|---|---|---|
| ⬜ | **KGP `subscribe`/`fetch`** verbs for the knowledge ports — today `subscribe` exists only for `finetune` telemetry; the knowledge ports surface only `describe` + `invoke` (KGP §6 delta subscriptions come with the grounding-pack work) · M | `chief/110-kgp-subscribe-fetch-verbs` *(proposed)* |
| ⬜ | **Grant enforcement** — issuance / rotation / spend ceilings, plus grant-gated `budget_units` admission for `finetune` (today `cost.meter`/`est_units` publish the figure but no ceiling is checked); **cross-repo: orchestrator** owns the grant issuer (KCB §5) · M | `chief/111-grant-enforcement-and-budget-ceilings` *(proposed)* |
| ⬜ | **Re-wire the KFT `finetune` MCP tool** — advertised-but-not-dispatchable since the `80` Python-only cutover (the Python service can't spawn the `lugh` subprocess the Express front did); resolve when `lugh:30-kft-provider-manifest` publishes `lugh:agent:finetune` and the fabric routes there directly · S | `chief/112-rewire-kft-finetune-mcp` *(proposed)* |

*Depends on:* **agora/orchestrator** (the grant issuer for `111`) and **lugh** (the
`lugh:agent:finetune` manifest that retires the transitional advertisement in `112`).

### Ongoing — steady-state, not a phase — 🚧 continuous

| Status | Milestone | Tasklist |
|---|---|---|
| 🚧 | **Living dataset** — scheduled acquisition ingestion + annual DOI snapshot cadence keep the corpus current and citable (`/api/living-dataset/*`) | — |
| 🚧 | **Data growth & freshness** — continue widening domains/coverage past the Phase-15 targets; refresh from upstream sources | — |

> **Long-term outcomes** (multi-year, from the Phase-14 vision; not tasklistable): academic
> citations of the corpus in published research; educational-institution adoption; recognition as
> a primary open reference for world-culture research.

### Loose wishlist — ⬜ not yet phased

Smaller open threads noted across the docs, none big enough to anchor a phase on its own:

- **Linguistic-distance algorithm depth** ([`docs/LINGUISTIC_DISTANCE_FEATURE.md`](docs/LINGUISTIC_DISTANCE_FEATURE.md) §"Future Enhancements") — LexStat sound-correspondence cognate detection; explicit cognate-set modelling; Needleman-Wunsch alignment; a borrowing filter; Swadesh-list weighting; permutation/bootstrapping significance tests; a composite metric adding temporal-depth + semantic-shift to lexical/genealogical/geographic distance; plus the two unbuilt performance items (distance **caching** + **parallel** matrix computation).
- **§17 "new horizons"** — public launch (performance/SEO, onboarding, **WCAG** audit); community & social (shared collections, discussion, contribution reputation); **native/mobile & offline field-research** mode; **ML-driven discovery** of non-obvious cross-cultural links from the graph.
- **Un-integrated raw data** sitting in [`data/archive/`](data/archive/) (contact-phenomena, proto-language lists, migration/origin sets) — promote into the canonical corpus where vetted.
- **Canonical-schema field promotion** — lift stable attribute-facts into first-class canonical-schema fields as domains mature.
- **More adapters** — Getty **AAT/TGN/ULAN** and **Lexibank** wordlist (ABVD graph-side) ingests beyond the shipped set.

---

## Chief / Ralph / ralphy Tasklist Status

- **Chief:** 16/16 tasklists merged (`10`–`91`); **0 pending**. Records in `tasks/chief/completed/`.
- **Ralph:** product PRD runs (deep-history Phases 11–15) — complete, in `tasks/ralph/completed/`.
- **ralphy:** earlier product batches (Phases 7–10) — complete, archived under `docs/archive/ralphy/`.
- **~12 proposed tasklists** (`chief/100`–`chief/112`) back the planned Phases A–C above — **none
  authored yet** (no `tasks/chief/*.json`); they are roadmap stubs numbered above the merged run.

No open *autonomous* work remains in this repo; the tail above is human-directed / proposed.

---

## Related Docs

**Consolidated roadmap history** (superseded by this file, kept for detail) — [`docs/roadmap/`](docs/roadmap/):
- [`prd-pinakes-deep-history-roadmap.md`](docs/roadmap/prd-pinakes-deep-history-roadmap.md) — Phases 7–15 + §16/§17 next-work (the Phase-A/B source).
- [`prd-pinakes-roadmap.md`](docs/roadmap/prd-pinakes-roadmap.md) — Phases 1–6 product PRD (all ✅).
- [`COMPREHENSIVE_ROADMAP.md`](docs/roadmap/COMPREHENSIVE_ROADMAP.md) — original Feb-2026 atlas vision (historical).

**Architecture & reference records** (living docs, kept in place):
- [`docs/UNIFIED-PROJECT-PLAN.md`](docs/UNIFIED-PROJECT-PLAN.md) — the TS→Python rewrite + repo-restructure plan (executed).
- [`docs/LUGH-EXTRACTION-PLAN.md`](docs/LUGH-EXTRACTION-PLAN.md) · [`docs/ML-EXTRACTION-ANALYSIS.md`](docs/ML-EXTRACTION-ANALYSIS.md) — the `lugh` extraction plan + decision.
- [`docs/capability-bus.md`](docs/capability-bus.md) — the KCB manifest surface + the "Not yet built" list (the Phase-C source).
- [`engine/docs/sources-linguistic.md`](engine/docs/sources-linguistic.md) · [`engine/docs/sources-genetic.md`](engine/docs/sources-genetic.md) — vetted source candidates (the Phase-B source).
- [`docs/LINGUISTIC_DISTANCE_FEATURE.md`](docs/LINGUISTIC_DISTANCE_FEATURE.md) — the distance engine + its future-enhancement list (wishlist source).
- [`engine/PLAN.md`](engine/PLAN.md) — the acquisition engine's master plan.
- [`docs/DATA-INVENTORY.md`](docs/DATA-INVENTORY.md) · [`docs/acquisition-throughput.md`](docs/acquisition-throughput.md).
</content>
</invoke>
