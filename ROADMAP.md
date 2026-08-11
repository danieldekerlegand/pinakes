# pinakes — Roadmap

> The knowledge/data hub of the neuro-symbolic ecosystem: a Wikidata-anchored
> **canonical graph** and an interactive **world-cultures atlas** (languages × geography ×
> time × culture), served as a koine/agora fabric participant. North star: *the primary
> open reference for tracing any modern culture back through millennia.*

**Status:** Feature-complete & architecturally consolidated — the atlas *engine* is built and the
corpus is populated (14/15 domains at target); now in a **production-hardening + data-growth** tail
with a mined "second act" (Phases A–D below), re-shaped on 2026-08-11 by **decision D4**
([`docs/DECISION-D4-CLDF-AND-WIKIBASE.md`](docs/DECISION-D4-CLDF-AND-WIKIBASE.md)): ingest the
published CLDF corpora instead of hand-curating them, tier by licence **at ingest**, and adopt
**Wikibase** as the canonical store · **Last updated:** 2026-08-11

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

**In scope:** the multi-domain corpus, the graph + analytical index, the atlas client,
acquisition/scraping, contribution + review, citation/versioned releases, fabric participation.
**Out of scope:** general format translation (moved to agora), model training (moved to `lugh`).

**Where the corpus comes from — restated by D4(a).** What a maintained open dataset already
publishes is **ingested, never hand-curated**: Glottolog (~8,600 language-level languoids),
Grambank, WALS, PHOIBLE, Concepticon and Lexibank are the linguistics **substrate**, ingested as
CLDF through one reusable adapter. **CLLD** is the framework they publish through — the
presentation layer pinakes had been rebuilding. Curation is spent on the two things nobody
publishes: the **cross-domain lineage DAG** (cuisine · religion · genetics · trade × language),
which is pinakes's actual differentiator, and the countable residual the catalogues do not cover
(reconstructed proto-languages, historical variants, dialect-level entries, range polygons).

**Where the corpus lives — restated by D4(b).** **Wikibase** becomes the canonical store, because
statements + qualifiers + references + ranks make *"true at time T, place P, per source S"* a
primitive rather than a TSV convention. Neo4j and DuckDB become **derived read-indexes**; TSV
becomes **import/export only**. This is a 2–3 month program (Phase D) gated on a measured
go/no-go, with **Oxigraph + the Wikibase data model** as the documented fallback.

**⚠ How a licence attaches — restated by D4/F5.** Corpus tiering by licence happens **at ingest**,
not at publication. Obligations propagate off-repo (pinakes → `lugh`'s training corpus → trained
models; pinakes → `insimul` synthetic worlds), so a mis-stamped row cannot be repaired by a
downstream filter. See [`docs/DECISION-D4-CLDF-AND-WIKIBASE.md`](docs/DECISION-D4-CLDF-AND-WIKIBASE.md) §4.

## Current State

- **One Python (FastAPI) service + one React/Vite client.** The former TS/Express backend and
  the Python `culturescrape` engine were unified into one in-process service (`services/api` +
  `engine/`); Node/Express/Drizzle/DVC are gone. `contracts/` holds the shared schema with
  generated Python + TS bindings and a drift gate.
- **Persistence:** Neo4j (graph) · TSV corpus under `data/source/lexicons/` · DuckDB analytical
  index · JSON runtime stores. No SQL app DB. **TSV is still the source of truth until Phase D's
  `124` cutover lands** — the D4(b) end state (Wikibase canonical, Neo4j/DuckDB derived) is
  decided but unbuilt, and `CLAUDE.md`'s "TSV-first" invariant remains in force meanwhile.
- **Corpus at scale:** **14 of 15** Phase-15 data-population targets met (170 civilizations, 550
  archaeological sites, 277 archaeological cultures, 206 deities, 115 writing systems, 101
  cuisines, …). The one exception is **`language-range-polygons`, landed at 133/200** — Wikidata
  carries no inline range polygons for the corpus, so closing the gap needs a non-Wikidata source
  (see Phase B). This is honestly flagged in the live `/api/data-quality` coverage report.
- **The curated spine is the expensive half, and D4(a) retires it.** 1,099 hand-curated language
  rows + 543 family rows stand against Glottolog's published, maintained catalogue — and
  [`docs/corpus-tier-report.md`](docs/corpus-tier-report.md) shows the spend is not buying
  provenance quality: **552/1,099** languages and **0/543** families are QID-anchored *and*
  reference-backed. Phase B ingests the substrate (`113`) and Phase B's `119` retires the
  superseded rows into it, gated on a committed superseded/additive/unmatched delta report.
- **⚠ Licence enforcement is at the wrong end of the pipe — a latent defect, not a preference.**
  `contracts/egress-policy.json` declares `enforcedAt: "pack-construction"`; the lexicon TSVs carry
  **no `license` column** at all, so the SPDX id is *derived at export time* from each row's
  `source` cell (`licenseForSource` in `scripts/export-for-engine.ts`). Share-alike (PHOIBLE,
  kaikki — `CC-BY-SA-3.0`) and non-commercial (Seshat — `CC-BY-NC-SA-4.0`) records therefore enter
  the same corpus as the permissive core and are separated only at packaging. `117` closes this
  and is the head of the D4 chain.
- **Fabric:** serves its KCB manifest / AgentCard, resolves KINP identity, advertises the KFT
  `finetune` capability (dispatched to the `lugh` checkout). *Caveat:* since the `80` Python-only
  cutover the `finetune` MCP tool is **advertised but its invoke degrades** — the Python service
  cannot spawn the `lugh` subprocess the way the retired Express front did (see Phase C).
- **Chief program:** 16/16 built-program tasklists (`10`–`91`) merged; **24** proposed forward
  tasklists authored (`tasks/chief/*.json`, `passes:false`, unrun) — pending a run, not merged, of
  which 1 parked. The D4 reconciliation added `117`–`124` and rewrote `113`.

---

## Milestones

One list, everything: shipped, in-progress, and planned. The **architecture** track (the TS→Python
rewrite + fabric integration, driven by Chief) and the **product** track (atlas features + data,
driven by the PRDs / Ralph / ralphy) ran in parallel and are both complete; Phases **A**–**D** are
the mined-but-unbuilt "second act" (**B** re-shaped and **D** created by decision D4); the
**Ongoing** and **Loose wishlist** blocks at the end cover
steady-state and un-phased work. Status legend: **✅ shipped/merged · 🚧 partial / in-progress ·
⬜ not started**. The Tasklist column is the Chief tasklist that delivered a row (✅ merged) or the
*(proposed)* one that would (the `chief/100+` rows are now authored — `passes:false`, unrun).

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

### Phase B — CLDF substrate ingest, licence tiering & population — ⬜ planned (scale: M/L)

**Re-shaped by D4(a) on 2026-08-11** ([`docs/DECISION-D4-CLDF-AND-WIKIBASE.md`](docs/DECISION-D4-CLDF-AND-WIKIBASE.md)).
The phase was written as *widening acquisition breadth around a hand-curated spine*; it is now the
phase that **makes the published CLDF corpora the substrate and retires hand-curation into them**.
Source: [`engine/docs/sources-linguistic.md`](engine/docs/sources-linguistic.md),
[`engine/docs/sources-genetic.md`](engine/docs/sources-genetic.md).

Three things must land in order. **(1) Licence tiering moves to ingest** (`117`) — nothing else may
ingest first, because a tier that is stamped at publication cannot be repaired downstream.
**(2) Adapter built ≠ corpus populated:** `106`–`109` + `118` *build* the plumbing (hermetic,
fixture-gated); `113` **executes** it — the live acquisitions, the TSVs landed through the acquire →
reconcile → write-back cascade, the re-baselined QA gates, the regenerated pinned snapshots. Until
`113` runs, a green adapter tasklist means the atlas *could* be populated, not that it is.
**(3) Retirement is separate from ingest** (`119`) — the ingest is reviewed before anything curated
is displaced.

| Status | Milestone | Tasklist |
|---|---|---|
| ⬜ | ⚠ **Licence tiering AT INGEST** — a stored per-row SPDX licence + tier, an admission gate that fail-closes on an unregistered id, share-alike kept as a distinct overlay and non-commercial quarantined, and `egress-policy.json` re-pointed at ingest with pack-construction as defence-in-depth. **Closes a latent legal defect; head of the D4 chain** · M/L | `chief/117-license-tiering-at-ingest` *(proposed)* |
| ⬜ | A **reusable CLDF dump adapter** (`source.type: dump`), modelled on the Getty/Pleiades dump adapters — the shared plumbing every CLDF source below rides on · M | `chief/106-reusable-cldf-dump-adapter` *(proposed)* |
| ⬜ | **Glottolog** 5.x CLDF category spec — the authoritative open language-family tree (`DESCENDS_FROM` genealogy), now the language/family **substrate** rather than a top-up. *Licence corrected in the D4 review: `CC-BY-4.0`, not CC-BY-SA-3.0* · M | `chief/107-glottolog-cldf-adapter` *(proposed)* |
| ⬜ | **Grambank + Concepticon** CLDF specs — the rest of the CLLD-published substrate (195 features × 2,400+ languages; the concept-set catalogue `words-base.tsv` is informally derived from), with **licence due diligence as story one** (Concepticon has no SPDX on its repo; PHOIBLE's repo is GPL-3.0 while its data is CC-BY-SA) · M | `chief/118-cldf-substrate-expansion` *(proposed)* |
| ⬜ | **DBpedia `dbo:influencedBy`** adapter — broader (noisier) `INFLUENCED_BY`/derivation coverage; license-aware (CC-BY-SA → the share-alike overlay tier) SPARQL/dump ingest (sources-genetic §"Next") · M | `chief/108-dbpedia-influencedby-adapter` *(proposed)* |
| ⬜ | A **non-Wikidata `language-range-polygons`** source to close **133/200** — historical/modern range GeoJSON boundaries. *Stays curated/ingested here because nobody publishes it: Glottolog carries point coordinates, not ranges* · M | `chief/109-language-range-polygon-source` *(proposed)* |
| ⬜ | **Run the acquisitions** — execute the population the adapters only enable, at substrate scale: Glottolog (~8,600 language-level languoids inside ~26k), Grambank, the DBpedia edge pull, the range-polygon push; land committed TSVs through the ingest tier gate, re-baseline convergence-QA, regenerate the pinned snapshots + the lugh-checkout manifests, verify domain coverage *and* licence-tier composition. *Needs live egress for the acquire steps (CI stays network-free via the committed replay TSVs)* · M/L | `chief/113-run-phase-b-acquisitions` *(proposed, **rewritten** for D4)* |
| ⬜ | **Retire hand-curation into the ingest, and redirect it** — audit the 1,099 language + 543 family rows as superseded / additive / unmatched, retire the superseded ones without losing a curated value, guard against the spine silently re-growing by hand, and stand the **cross-domain lineage DAG** (cuisine · religion · genetics · trade × language) up as a first-class curated artifact with a schema, a coverage report and a target · M/L | `chief/119-retire-handcuration-into-ingest` *(proposed)* |
| ⬜ | **Insimul worlds consumer adapter** (Bridge-2, cross-repo) — ingest insimul world exports into the canonical graph as the **`synthetic`** corpus tier (world_id + seed provenance, proprietary licence, containment from every open-data surface, `based_on` never `same_as`); the pinakes consumer half insimul's `210-insimul-acquisition-adapter` names · M | `chief/114-insimul-worlds-consumer-adapter` *(proposed)* |

*Depends on:* `117` depends on nothing and gates the ingesting rows (`113`, `114`, `118`). `106` is
the head of the adapter chain; `107`–`109` and `118` build on it. `113` depends on all four adapters
plus `117`/`118` (and needs live network egress for its acquire steps); `119` depends on `113`; and
`114` depends cross-repo on insimul's `210` export emitter as well as on `117`.

### Phase C — Fabric completion — ⬜ planned (scale: M)

The last KCB/KGP verbs and the grant-enforcement seam the capability-bus doc lists as **"Not yet
built."** Source: [`docs/capability-bus.md`](docs/capability-bus.md) §"Not yet built".

| Status | Milestone | Tasklist |
|---|---|---|
| ⬜ | **KGP `subscribe`/`fetch`** verbs for the knowledge ports — today `subscribe` exists only for `finetune` telemetry; the knowledge ports surface only `describe` + `invoke` (KGP §6 delta subscriptions come with the grounding-pack work) · M | `chief/110-kgp-subscribe-fetch-verbs` *(proposed)* |
| ⬜ | **Grant enforcement** — issuance / rotation / spend ceilings, plus grant-gated `budget_units` admission for `finetune` (today `cost.meter`/`est_units` publish the figure but no ceiling is checked); **cross-repo: orchestrator** owns the grant issuer (KCB §5) · M | `chief/111-grant-enforcement-and-budget-ceilings` *(proposed)* |
| ⬜ | **Re-wire the KFT `finetune` MCP tool** — advertised-but-not-dispatchable since the `80` Python-only cutover (the Python service can't spawn the `lugh` subprocess the Express front did); resolve when `lugh:30-kft-provider-manifest` publishes `lugh:agent:finetune` and the fabric routes there directly · S | `chief/112-rewire-kft-finetune-mcp` *(proposed)* |
| ⬜ | **Canonical-schema learned-probability + reasoning-scope** — the edge attribute (soft, model-produced probability distinct from curated `confidence`) + reasoning-scope marker that lugh `210`'s Scallop writeback proposes upstream and dead-ends without; contract JSON + codegen + validators (*the cross-repo "v1.2" label predates the on-disk 1.3.0 — lands as the next bump with the alias recorded*) · M | `chief/115-canonical-schema-v1-2` *(proposed)* |

*Depends on:* **agora/orchestrator** (the grant issuer for `111`, encoded as
`agora:67-kcb-grant-issuer`) and **lugh** (the `lugh:agent:finetune` manifest that retires the
transitional advertisement in `112`; lugh `210` is the consumer waiting on `115`).

### Phase D — Wikibase as the canonical store — ⬜ planned (scale: L — a 2–3 month program)

**Decided by D4(b) on 2026-08-11** ([`docs/DECISION-D4-CLDF-AND-WIKIBASE.md`](docs/DECISION-D4-CLDF-AND-WIKIBASE.md) §5).
Wikibase natively models **statements + qualifiers + references + ranks**, so *"true at time T,
place P, per source S"* becomes a primitive instead of a TSV convention every reader reconstructs,
and two competing classifications become two ranked statements instead of a resolution the corpus
has to bake in and lose. Proven in this exact domain — **FactGrid**, **Enslaved.org**, **Rhizome
ArtBase**, plus a peer-reviewed CIDOC-CRM-over-Wikibase modelling method to follow rather than
reinvent.

**The costs are real and are encoded in the tasklists, not discovered during them:** a
**four-service stack** (MediaWiki + relational store + triplestore query service + updater) whose
own guidance says it may demand dedicated sysadmin attention; an **inherited migration** — the
Blazegraph-era query service is end-of-life, the WDQS graph split went live **2025-05-09** and the
legacy endpoint sunset **Dec 2025**, so a new deployment lands on QLever-era tooling rather than on
what most tutorials assume; and realistically **2–3 months** across the five rows below. The
**documented fallback**, a legitimate outcome rather than a failure: **Oxigraph** (Apache-2.0,
single binary, no updater, no MediaWiki) with the Wikibase *data model* replicated on top.

| Status | Milestone | Tasklist |
|---|---|---|
| ⬜ | **Assess + ops gate** — stand the four-service stack up reproducibly on non-EOL query tooling, load a representative corpus slice, benchmark import throughput and the atlas's real read patterns against today's Neo4j/DuckDB timings, and record the **go / Oxigraph-fallback decision with the numbers attached**. *The whole program is gated on this row* · L | `chief/120-wikibase-assessment-and-ops-gate` *(proposed)* |
| ⬜ | **Property ontology** — map every canonical-schema node type, edge type and column to an item / property / qualifier / reference / rank (validator-enforced, no silent gaps): temporal + geographic scoping as qualifiers, the provenance quartet as references, trust tier → rank, `cs:` csid identity + Wikidata anchoring preserved, and the `117` licence tier queryable at statement granularity · L | `chief/121-wikibase-property-ontology` *(proposed)* |
| ⬜ | **Corpus import** — an idempotent, resumable, re-runnable import under the `121` mapping with a **completeness proof that fails loudly**: every column landed, every reference preserved, every tier reconciling with the corpus-tier report. *TSV stays the source of truth throughout, so this is safe to re-run* · L | `chief/122-wikibase-corpus-import` *(proposed)* |
| ⬜ | **Derived read-index rebuild** — Neo4j + DuckDB rebuilt from the store, reproducibly and from empty, with the atlas read path unchanged and benchmarked against the `120` baseline; no write path to an index survives outside the rebuild · L | `chief/123-derived-read-index-rebuild` *(proposed)* |
| ⬜ | **Cutover** — **rollback rehearsed first**, then writes go to the store, TSV becomes a deterministic import/export projection (the `91`/`102` DOI packaging keeps working off it), and every document asserting the TSV-first authority — starting with `CLAUDE.md`'s first invariant — is corrected · L | `chief/124-wikibase-cutover` *(proposed)* |

*Depends on:* a strict chain — `120` → `121` → `122` → `123` → `124`. `122` additionally depends on
`117` (a record must already carry its tier at admission; importing first and tiering later would
recreate the exact defect D4 flagged) and on `113` (the substrate being imported is the ingested one,
not the spine `119` retires).

### Ongoing — steady-state, not a phase — 🚧 continuous

| Status | Milestone | Tasklist |
|---|---|---|
| 🚧 | **Living dataset** — scheduled acquisition ingestion + annual DOI snapshot cadence keep the corpus current and citable (`/api/living-dataset/*`); the annual-cadence half is now tasklisted on the shipped `91`/`102` machinery | `chief/116-doi-release-cadence` *(proposed)* |
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

- **Chief:** 16/16 built-program tasklists merged (`10`–`91`); **24** proposed forward tasklists
  authored (`tasks/chief/*.json`, `passes:false`, unrun) — pending a run, not merged, of which 1
  parked. Records in `tasks/chief/completed/`.
- **Ralph:** product PRD runs (deep-history Phases 11–15) — complete, in `tasks/ralph/completed/`.
- **ralphy:** earlier product batches (Phases 7–10) — complete, archived under `docs/archive/ralphy/`.
- **24 proposed tasklists** (`chief/100`–`chief/124`) back the planned Phases A–D + the Ongoing
  cadence above — **all authored** (`tasks/chief/*.json`, `passes:false`, unrun); they are numbered
  above the merged run. `113` is the Phase-B *population run* (the adapters `106`–`109`/`118` only
  build), `114`/`115` carry the cross-repo insimul/lugh seams, `116` the annual DOI cadence.
- **The D4 reconciliation (2026-08-11)** added `117` (licence tiering at ingest — the head of the
  chain and the one row that closes a live defect), `118` + `119` (CLDF substrate expansion and the
  retirement of hand-curation into it), and `120`–`124` (the Phase-D Wikibase program); it
  **rewrote `113`** around substrate-scale CLDF ingest, and re-scoped `107` (licence correction:
  Glottolog is `CC-BY-4.0`), `114` (now gated on `117`) and `115` (its two attributes get a home in
  `121`'s property ontology). No tasklist was retired — the Phase-B rows that looked like
  hand-curation (`109`'s range polygons, the unmatched residual) survive precisely because nobody
  publishes what they cover.

No open *autonomous* work remains in this repo; the tail above is human-directed / proposed.

---

## Related Docs

**Consolidated roadmap history** (superseded by this file, kept for detail) — [`docs/roadmap/`](docs/roadmap/):
- [`prd-pinakes-deep-history-roadmap.md`](docs/roadmap/prd-pinakes-deep-history-roadmap.md) — Phases 7–15 + §16/§17 next-work (the Phase-A/B source).
- [`prd-pinakes-roadmap.md`](docs/roadmap/prd-pinakes-roadmap.md) — Phases 1–6 product PRD (all ✅).
- [`COMPREHENSIVE_ROADMAP.md`](docs/roadmap/COMPREHENSIVE_ROADMAP.md) — original Feb-2026 atlas vision (historical).

**Architecture & reference records** (living docs, kept in place):
- [`docs/DECISION-D4-CLDF-AND-WIKIBASE.md`](docs/DECISION-D4-CLDF-AND-WIKIBASE.md) — **decision D4**: ingest CLDF, tier by licence at ingest, adopt Wikibase as canonical (the Phase-B re-shape + Phase-D source).
- [`docs/UNIFIED-PROJECT-PLAN.md`](docs/UNIFIED-PROJECT-PLAN.md) — the TS→Python rewrite + repo-restructure plan (executed).
- [`docs/LUGH-EXTRACTION-PLAN.md`](docs/LUGH-EXTRACTION-PLAN.md) · [`docs/ML-EXTRACTION-ANALYSIS.md`](docs/ML-EXTRACTION-ANALYSIS.md) — the `lugh` extraction plan + decision.
- [`docs/capability-bus.md`](docs/capability-bus.md) — the KCB manifest surface + the "Not yet built" list (the Phase-C source).
- [`engine/docs/sources-linguistic.md`](engine/docs/sources-linguistic.md) · [`engine/docs/sources-genetic.md`](engine/docs/sources-genetic.md) — vetted source candidates (the Phase-B source).
- [`docs/LINGUISTIC_DISTANCE_FEATURE.md`](docs/LINGUISTIC_DISTANCE_FEATURE.md) — the distance engine + its future-enhancement list (wishlist source).
- [`engine/PLAN.md`](engine/PLAN.md) — the acquisition engine's master plan.
- [`docs/DATA-INVENTORY.md`](docs/DATA-INVENTORY.md) · [`docs/acquisition-throughput.md`](docs/acquisition-throughput.md).
