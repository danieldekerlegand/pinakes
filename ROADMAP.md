# pinakes — Roadmap

> The knowledge/data hub of the neuro-symbolic ecosystem: a Wikidata-anchored
> **canonical graph** and an interactive **world-cultures atlas** (languages × geography ×
> time × culture), served as a koine/agora fabric participant. North star: *the primary
> open reference for tracing any modern culture back through millennia.*

**Status:** Feature-complete & architecturally consolidated — in maintenance + data-growth mode · **Last updated:** 2026-08-10

This is the single canonical roadmap. It consolidates three superseded product-roadmap
documents (now under [`docs/roadmap/`](docs/roadmap/)) and the architecture-rewrite plan
([`docs/UNIFIED-PROJECT-PLAN.md`](docs/UNIFIED-PROJECT-PLAN.md)). Every phase both of those
described has shipped; what remains is a short tail of cleanup + long-horizon work.

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
- **Corpus at scale:** all Phase-15 data-population targets met (170 civilizations, 550
  archaeological sites, 277 archaeological cultures, 206 deities, 115 writing systems, 101
  cuisines, …).
- **Fabric:** serves its KCB manifest / AgentCard, resolves KINP identity, advertises the KFT
  `finetune` capability (dispatched to the `lugh` checkout).
- **Chief program:** all 16 tasklists (`10`–`91`) merged; **nothing pending**.

---

## Milestones

Two tracks ran in parallel: the **architecture** track (the TS→Python rewrite + fabric
integration, driven by Chief) and the **product** track (atlas features + data, driven by the
PRDs / Ralph / ralphy).

### Architecture & platform track  — ✅ complete

| Phase | What | Status |
|---|---|---|
| 0 — Foundation & cleanup | drop DVC/Drizzle, new repo skeleton, `culturescrape`→`pinakes_engine`, FastAPI shell, parity spec | ✅ `chief/10`,`20`,`30` |
| — Contracts codegen | language-neutral schema → generated Py+TS bindings + drift gate | ✅ `chief/40` |
| 1 — Engine in-process | fold sidecar/CLI seams into direct calls; port graph routes | ✅ `chief/50` |
| 2 — Port the backend | contributions, collab stores, analytics, entity/search, ingest, catalog/bus — each parity-gated | ✅ `chief/60`–`65` |
| 3 — Unify scrapers | one Python acquisition layer; retire the ~14k-LOC TS scraper stack | ✅ `chief/70` |
| 4 — Cutover | delete `server/`, one process serves client + all `/api`; 306/306 parity | ✅ `chief/80` |
| — Extract `lugh` | training/ML workspace → private `lugh` repo as `lugh:agent:finetune` | ✅ `chief/90-extract-lugh` |
| — Repatriate koine config | self-describing participant config in-repo | ✅ `chief/90-repatriate-koine-config` |
| — Publish corpus artifact | versioned corpus release/DOI surface | ✅ `chief/91` |
| 5 — Rust/Go hot path | `pyo3` bulk-transform accel | ⬜ **Deferred** — only if corpus profiling justifies (acquisition is 96–99% network-bound; see [`docs/acquisition-throughput.md`](docs/acquisition-throughput.md)) |

### Product & feature track  — ✅ complete (Phases 1–15)

| Phase | Theme | Status |
|---|---|---|
| 1 | Sample texts & text-level etymology | ✅ |
| 2 | Structural linguistic comparison (phonology, grammar, writing systems) | ✅ |
| 3 | Animated temporal atlas (civilizations, sites, migrations, battles) | ✅ |
| 4 | Cross-domain correlation & deep analysis | ✅ |
| 5 | Expanded cultural domains (material culture, foodways, kinship, arts, economy) | ✅ |
| 6 | Platform maturity (global search, narratives, deep-linking, perf, a11y) | ✅ |
| 7 | Deep-history lineage engine ("Yamnaya → Persians" traversable) | ✅ |
| 8 | Massive data expansion | ✅ |
| 9 | New cultural domains (dance, literature, architecture, writing systems) | ✅ |
| 10 | Advanced map & visualization | ✅ |
| 11 | Data acquisition & scraping | ✅ |
| 12 | Narrative & educational features | ✅ |
| 13 | Platform & infrastructure | ✅ |
| 14 | Speculative & long-term vision | ✅ (foundational; see long-term goals below) |
| 15 | Data population at scale — **all targets met** | ✅ |

> The Feb-2026 [`COMPREHENSIVE_ROADMAP`](docs/roadmap/COMPREHENSIVE_ROADMAP.md) predates this
> work; its "2/6 domains / Phase-6 pending" status is **superseded** — those domains and polish
> shipped in Phases 7–15. It is retained as the original atlas vision.

---

## Remaining / Next

pinakes is essentially done; the tail is small and mostly non-urgent.

1. **`EXPORT_DIR` cleanup** ⬜ — the blanket rename left the engine export writing under a
   tracked `export/pinakes_engine` instead of the gitignored `build/corpus`; unify the two.
   Owner: the next tasklist that touches `scripts/`
   ([move-map note in `docs/UNIFIED-PROJECT-PLAN.md` §4](docs/UNIFIED-PROJECT-PLAN.md)).
2. **Deferred Rust/Go hot path** ⬜ — reserved `pyo3` escape hatch for bulk offline transform.
   Re-evaluate only if `parse_seconds / worker_seconds` leaves the low single digits.
3. **Living dataset — ongoing** 🚧 — scheduled acquisition ingestion + annual DOI snapshot
   cadence keep the corpus current and citable (`/api/living-dataset/*`). This is steady-state,
   not a project phase.
4. **Data growth & freshness — ongoing** 🚧 — continue widening domains/coverage past the
   Phase-15 targets; refresh from upstream sources.

### Long-term goals (multi-year, from Phase 14 vision)
- Academic citations of the corpus in published research.
- Educational-institution adoption.
- Recognized as a primary open reference for world-culture research.

---

## Chief / Ralph / ralphy Tasklist Status

- **Chief:** 16/16 tasklists merged (`10`–`91`); **0 pending**. Records in `tasks/chief/completed/`.
- **Ralph:** product PRD runs (deep-history Phases 11–15) — complete, in `tasks/ralph/completed/`.
- **ralphy:** earlier product batches (Phases 7–10) — complete, archived under `docs/archive/ralphy/`.

No open autonomous work remains in this repo.

---

## Related Docs

**Consolidated roadmap history** (superseded by this file, kept for detail) — [`docs/roadmap/`](docs/roadmap/):
- [`prd-pinakes-deep-history-roadmap.md`](docs/roadmap/prd-pinakes-deep-history-roadmap.md) — Phases 7–15, the most recent product roadmap (all ✅).
- [`prd-pinakes-roadmap.md`](docs/roadmap/prd-pinakes-roadmap.md) — Phases 1–6 product PRD (all ✅).
- [`COMPREHENSIVE_ROADMAP.md`](docs/roadmap/COMPREHENSIVE_ROADMAP.md) — original Feb-2026 atlas vision (historical).

**Architecture & reference records** (living docs, kept in place):
- [`docs/UNIFIED-PROJECT-PLAN.md`](docs/UNIFIED-PROJECT-PLAN.md) — the TS→Python rewrite + repo-restructure plan (executed).
- [`docs/LUGH-EXTRACTION-PLAN.md`](docs/LUGH-EXTRACTION-PLAN.md) · [`docs/ML-EXTRACTION-ANALYSIS.md`](docs/ML-EXTRACTION-ANALYSIS.md) — the `lugh` extraction plan + decision.
- [`engine/PLAN.md`](engine/PLAN.md) — the acquisition engine's master plan.
- [`docs/DATA-INVENTORY.md`](docs/DATA-INVENTORY.md) · [`docs/acquisition-throughput.md`](docs/acquisition-throughput.md) · [`docs/capability-bus.md`](docs/capability-bus.md).
