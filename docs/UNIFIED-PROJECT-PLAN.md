# Unified project plan — one Python service, one clean repo

**Status:** proposal for review — nothing has been executed. This consolidates every decision
from the flatten/rewrite investigation into one plan. Supersedes the framing in
[ML-EXTRACTION-ANALYSIS.md](ML-EXTRACTION-ANALYSIS.md) (ml/ stays for now) and builds on
[DATA-INVENTORY.md](DATA-INVENTORY.md) (the data-layout cleanup already merged).

## 1. The end state

Pinakes becomes **one Python backend service + one React client + one isolated ML workspace**, in a **cleanly reorganized repo**, with the `culturescrape` name gone entirely.

- **One Python (FastAPI) service** absorbs today's TypeScript Express backend *and* the Python `culturescrape` engine — no more sidecar HTTP hop, no CLI-subprocess boundary. The engine is imported in-process.
- **The React client stays TypeScript** (it's a browser app) — served by the Python service, its API contract preserved.
- **`ml/` stays a separate `uv` workspace-in-repo** — its torch/pykeen stack must never leak into the web service's environment.
- **A dramatically better file structure** (see §4 — a first-class goal of this work, not a side effect).
- **No Node/Express, no Drizzle/pg, no DVC** in the running system.

## 2. Why (decisions + evidence)

| Decision | Rationale |
|---|---|
| **Replace TS with Python** (not the reverse) | Reuses the 34.7k-LOC engine + its 1,922 tests; going non-Python means rewriting **both** the ~72k TS *and* the 34.7k Python (~107k LOC) and keeping a Python ML island anyway. |
| **Python over Go/Rust** | Benchmark (2026-08-02): web-scraping is **network/politeness-bound** (`min_interval=1.0s`/host), not language-bound. CPU transform head-to-head (121k rows×50): Go 1.01s ≈ Rust 1.07s, **Python 2.54s, Bun/TS 6.72s**. Dropping TS is already a **2.6× CPU win**; Go/Rust's further 2.5× is irrelevant to scraping throughput. |
| **Hybrid Rust/Go later, maybe** | A Rust/Go parser/normalizer for the **bulk offline transform** hot path — added via `pyo3` **only if** profiling the real corpus shows it matters. Not now. |
| **Drop DVC** | The GGUF was never finetuned in production; all DVC trees are regenerable pilot/build outputs; the local-dir remote is stranded. Re-enable later (`dvc init` + cloud remote, or git-lfs) only if CI/collaborators/reproducible-pinning ever require it. |
| **ml/ stays separate** | Cleanly extractable (its only real coupling is the corpus seam), but deferred. Keeping torch out of the web env is the reason it's a distinct workspace. |

## 3. Scope & non-goals

**In scope:** rewrite the TS backend in Python; merge the engine in-process; erase `culturescrape`;
**reorganize the whole repo (§4)**; unify the two scraping stacks (§6); delete Node/Express/Drizzle/DVC.

**Non-goals (now):** extracting `ml/`; porting the React client off TS; adopting Rust/Go (reserved as a
targeted hot-path escape hatch); introducing a SQL database (persistence stays Neo4j + files).

## 4. Repo structure overhaul — a FIRST-CLASS GOAL

> The current repo is a mess and fixing it is an explicit deliverable of this work, not a
> by-product. **A rewrite is the cheapest possible time to do it:** the reason a big reorg was
> risky before (e.g. `lexicons/` has ~60 hardcoded path literals in `server/tsv-storage.ts`) is
> that it meant touching readers we weren't otherwise editing — but the rewrite *replaces every
> reader anyway*. So the file-structure overhaul rides for free on the port and must be planned
> in from the start, not bolted on later.

### What's wrong today
- Two backends interleaved at the root: `core/` (Python) beside `server/` (TS), `shared/` (TS), `scripts/` (TS).
- `server/routes.ts` is a **235 KB monolith**; `server/services/` has **94 files** including a whole **parallel/legacy TS scraper stack** (`*-scraper.ts`, ~14.3k LOC) duplicating the Python acquire engine.
- Top-level sprawl: `lexicons/`, `export/`, `sources/`, `data/`, `test/`, `e2e/`, plus a pile of root config files (`drizzle.config.ts`, `vite`, `tailwind`, `postcss`, `tsconfig`, `vitest`, `playwright`, `components.json`, `docker-compose.yml`, two lockfiles).
- Vestigial stacks: Drizzle/pg (declared, dormant — "TSV-only mode"), DVC (stranded).

### Target layout

```
pinakes/
├── services/
│   └── api/                    # the unified Python backend (FastAPI) — was server/ (rewritten)
│       ├── src/pinakes/        #   web layer: routing, auth, request/response, serves the client
│       ├── tests/
│       └── pyproject.toml
├── engine/                     # Python knowledge/graph/scrape engine — was core/ (culturescrape → renamed)
│   ├── src/pinakes_engine/     #   acquire · ontology · datalog · neo4j · schema · orchestrate
│   ├── inputs/                 #   blueprints · categories · jobs · cypher · datalog-examples (from core/inputs)
│   ├── tests/
│   └── pyproject.toml
├── web/                        # React/Vite client — was client/ (stays TS); TS build configs live HERE, not root
│   ├── src/
│   └── (vite · tailwind · postcss · tsconfig · vitest · playwright)
├── ml/                         # separate uv workspace (torch-isolated) — role unchanged
│   └── src/pinakes_ml/ …
├── contracts/                  # shared schema + registries — was shared/ (canonical-schema.json, predicate-mapping, …)
│                               #   with generated Python + TS bindings so both sides stay in sync
├── data/
│   ├── source/                 # curated inputs — lexicons/ MOVES here (finally cheap), haplogroups, cuisine, …
│   ├── archive/                # parked (from the data-reorg)
│   └── runtime/                # gitignored per-user state (collections, annotations, …)
├── build/                      # regenerable outputs (former export/culturescrape, core/out) — gitignored
├── infra/                      # docker-compose, Dockerfiles, deploy config
├── docs/
└── (root: README, LICENSE, uv workspace manifest, .gitignore — and NOTHING else structural)
```

### Naming (per the "split web + engine packages" decision)
- `pinakes` — the FastAPI **service/web** package (`services/api`).
- `pinakes_engine` — the **engine** package (`engine/`), the former `culturescrape`.
- `pinakes_ml` — unchanged. → consistent `pinakes_*` family; the `culturescrape`/`cs:` name and the ~197 hits across 33 server files, env vars (`CULTURESCRAPE_*`), API paths (`/api/scraping/culturescrape/*`), and the docker service all disappear.

**Status (20 US-1 + US-4):** the package, the docker service, the env vars
(`CULTURESCRAPE_*` → `PINAKES_ENGINE_*`), the API paths
(`/api/scraping/culturescrape/*` → `/api/scraping/engine/*`) and the server's
`CultureScrape*` exports (→ `Engine*`) are all done. Two deliberate survivors:
the **`cs:` id-space** (a data namespace shared with `contracts/`, `ml/` and the
client — a corpus migration, not a rename) and the client's
`culturescrape.adapter.ts` / `"culturescrape-graph"` **dataset id** (a UI/URL
identifier the e2e `?ds=` links carry; it retires with the explorer work, not
with the package).

### Move map (current → target)
| Current | Target | Note |
|---|---|---|
| `server/` (TS) | `services/api/src/pinakes/` | **rewritten** in Python; Node/Express/Drizzle deleted |
| `core/` (`culturescrape`) | `engine/src/pinakes_engine/` | renamed; kept + absorbed |
| `core/inputs/` | `engine/inputs/` | moves with the engine |
| `client/` | `web/` | stays TS; root TS configs move in with it — **done** (20 US-2) |
| `shared/` | `contracts/` | + generated Python bindings — move **done** (20 US-2); bindings still to come |
| `lexicons/` (top-level) | `data/source/lexicons/` | move **done** (20 US-3); readers' path literals rewritten in place |
| `scripts/` (TS) | `tooling/` | heavily culled; acquisition scripts fold into the engine |
| `export/culturescrape`, `core/out` | `build/` | regenerable, gitignored, DVC removed — `export/culturescrape` → `build/corpus` **done** (20 US-1) |
| `export/pinakes_engine` (`EXPORT_DIR`) | `build/corpus` | **STILL OPEN** — US-1's blanket rename turned `export/culturescrape` into `export/pinakes_engine` in `scripts/export-for-engine.ts`'s `EXPORT_DIR` instead of `build/corpus`, so `convergence-qa` / `reconciliation-report` / `entity-grounding` / `insimul-pack` / `import-from-engine` all still write under a *tracked, un-gitignored* `export/`. Not in any 20 story's ACs (20 US-2/3/4 each deleted the stray dir rather than widen scope); flipping the one constant needs a check that the TS export and the engine's own `build/corpus` are the same artifact, not a collision. Owner: whichever tasklist next touches `scripts/`. |
| `docker-compose.yml`, Dockerfiles | `infra/` | **done** (20 US-3) — `infra/{docker-compose.yml,engine.Dockerfile}`; invoke compose from the repo root with `-f` |
| Drizzle/pg, DVC (`.dvc/`, `*.dvc`) | *(deleted)* | vestigial / stranded |
| `engine/uv.lock` | `uv.lock` (root) | **done** (20 US-4) — the root `pyproject.toml` is a virtual uv workspace root; one lock + one `.venv` for `engine` (and `services/api` when it lands). `ml/` is `exclude`d and keeps its own. |

## 5. Target runtime architecture

- **One FastAPI app** (the engine already uses FastAPI for the sidecar — grow that into the whole backend). It serves the built React client and all `/api/*` routes in one process.
- **Neo4j** stays the graph store (already the shared substrate; Python already has 24 files using it — consolidate the 2 TS driver files into Python).
- **Files** for the rest: TSV corpus/lexicons + `data/runtime/*` JSON. **No SQL** (Drizzle/pg removed — "TSV-only mode" is already the truth).
- The two TS→Python seams **vanish**: `engine-client.ts` (HTTP to :8800, was `culturescrape-client.ts`) and `engine-acquisition.ts` (CLI subprocess, was `culturescrape-acquisition.ts`) become direct in-process calls.

## 6. Consolidate the two scraping stacks (directly serves the speed goal)

Today scraping logic is split: the Python `culturescrape` acquire engine (~7k LOC) **and** a parallel TS `*-scraper.ts` stack (~14.3k LOC). The rewrite **unifies them into one Python acquisition layer** in `pinakes_engine` — one concurrency model, one rate-limiter, one caching/politeness policy, one set of domain adapters. This removes duplication *and* is where "incredibly fast at AI-powered scraping" is actually won: a single well-architected async fetch layer (async `httpx` + a fast parser like `selectolax`/`lxml`) with proper concurrency and caching — the levers the benchmark showed matter, not the language.

## 7. Approach & phasing

**Chosen approach: phased, driven by Chief tasklists** (decided 2026-08-02). Each slice is authored as a `tasks/chief/NN-slug.json` story that Chief drives implement→verify→commit→merge; the backend is ported in verifiable vertical slices with incremental merges, then a single final cutover. This supersedes the earlier "big-bang" framing (lower risk) and requires a **real `.chief/verify.sh`** gate — Python `pytest` + parity/contract tests + client typecheck — wired in the foundation band. The phases below map to the tasklist bands.

- **Phase 0 — Foundation & cleanup.** Remove DVC (rm `.dvc/`, `*.dvc`, `.dvcignore`; gitignore the build outputs). Delete Drizzle/pg. Lay down the new repo skeleton (§4). Rename `culturescrape` → `pinakes_engine`. Stand up the FastAPI app shell. **Capture the current API contract** (generate an OpenAPI/route inventory from the running Express server + record the client's expected responses) — this is the parity spec.
- **Phase 1 — Engine in-process.** Fold the sidecar + CLI seams into direct calls; port the graph routes (`/api/graph/*`) onto the in-process engine.
- **Phase 2 — Port the pure-TS backend.** Route group by route group (contributions/review, collections, annotations, changelog, stewardship, analytics, correlations, entity resolver, etc.), each verified against the Phase-0 parity spec.
- **Phase 3 — Unify scraping (§6).** Consolidate the TS `*-scraper.ts` stack into the Python acquisition layer.
- **Phase 4 — Cutover.** Serve the client from FastAPI; delete Node/Express + the TS backend; single swap with a rollback path (keep the old server tag runnable until parity is signed off).
- **Phase 5 — (Deferred) Rust/Go hot path.** Only if bulk-transform profiling over the real corpus justifies a `pyo3` component.

## 8. Risks & mitigations

- **Rewrite scale (~72k LOC).** *Mitigation:* phased via Chief — parity harness first (foundation band), port in vertical slices each gated by `verify.sh`, keep the old server runnable until full parity, single rehearsed cutover with rollback.
- **Client contract drift.** The 111k-LOC React app depends on exact API shapes. *Mitigation:* the Phase-0 OpenAPI/contract capture + contract tests the Python routes must satisfy.
- **Losing the Python test net during moves.** *Mitigation:* the engine's 1,922 tests move with it; run them after every relocation (watch the skip count, per the `ml/CLAUDE.md` silent-SKIP lesson).
- **Reorg breaking hardcoded paths.** *Mitigation:* the rewrite replaces the readers, so relocation is deliberate, not incidental; `contracts/` bindings are generated, not path-joined ad hoc.
- **Two-lockfile / env bleed.** *Mitigation:* a `uv` workspace ties `pinakes` + `pinakes_engine`; `ml/` stays its own workspace so torch never enters the web env.

## 9. Concrete first steps (Phase 0)
1. Remove DVC + Drizzle/pg (safe, independent, immediate clutter reduction).
2. Generate the API contract spec from the current Express server (the parity baseline).
3. Create the new skeleton (§4) and move `client/ → web/`, `core/ → engine/` (rename), `shared/ → contracts/` — mechanically, before any Python porting. **Done** (20 US-1 + US-2).
4. Stand up the FastAPI shell that serves the client and returns 501 for not-yet-ported routes.

## 10. Decisions (resolved 2026-08-02)
- **Execution:** phased, via **Chief tasklists** (~12–16), incremental merges + a single final cutover.
- **Engine package name:** **`pinakes_engine`**.
- **Corpus on clone:** regenerable **`build/`** output (gitignored); the bundled fixture covers first-run.
- **`contracts/` bindings:** language-neutral source of truth (JSON/schema) with generated **Python and TS** bindings + a drift gate.
