# Data inventory & reorganization plan

**Status:** proposal — nothing has moved. This maps every data location in the repo,
what code references it, and a risk-ordered plan to consolidate it.

## Principles (agreed)

1. **Organize in place; do not prejudge the ML split.** `ml/` is already a
   self-contained island — its only read from outside `ml/` is the canonical corpus
   at `export/culturescrape/{nodes,edges}`. So this reorg touches **non-ML** data only
   and stays compatible with either keeping or later extracting `ml/`.
2. **The canonical corpus is the one seam.** `export/culturescrape` is produced by
   `core/` and consumed by `ml/`. Leave it exactly where it is; it is already the
   producer→consumer handoff a future split would use.
3. **Move by risk, verify each batch.** Per `ml/CLAUDE.md`, a stale repo-root-relative
   path does **not** fail — it turns a live test into a permanent silent SKIP. So every
   batch = `git mv` + reference sweep + **re-run tests and diff the skip count** before
   the next batch.

## Taxonomy — every data location

| # | Location | Role | Tracking | Coupling (how paths resolve) | Recommendation |
|---|---|---|---|---|---|
| 1 | `lexicons/` (57 tsv) | Curated source | git | **HIGH** — ~60 hardcoded `"lexicons/*.tsv"` literals in `server/tsv-storage.ts` + `process.cwd()` assumption; `import.meta`-relative in scripts | **Leave in place**, document as canonical home |
| 2 | `core/blueprints/` (13 yml) | Pipeline input | git | Medium — CLI arg / `__file__`-relative in tests | Optional: group under `core/inputs/` |
| 3 | `core/categories/` (132 yml) | Input **and** generated | git | Medium — CLI default `categories/` + generator `out_dir` + `REPO_ROOT` in tests | Optional: group under `core/inputs/` |
| 4 | `core/datalog/examples/` | Pipeline input | git | Medium — constant `parents[3]/"datalog/examples"` | Optional: group under `core/inputs/` |
| 5 | `core/cypher/` (10) | Pipeline input | git | Medium — constant `parents[3]/"cypher"` | Optional: group under `core/inputs/` |
| 6 | `core/jobs/` (19) | Input **and** generated | git | Medium — CLI arg; job yml hardcodes `../out/<job>` | Optional: group under `core/inputs/` |
| 7 | `core/out/pinakes-full` | Generated output | **DVC** | Low — only `core/jobs/*.yml` hardcode `../out/...` | Leave (DVC output) |
| 8 | `data/*.txt` `*.csv` (loose) | Curated source | git | Split — see below | Partition: keep-referenced → `data/source/`; orphans → decide |
| 9 | `data/cuisine/` | Duplicate copy | git | **None** — no code references it | **Delete** (stray dup of top-level cuisine files) |
| 10 | `data/contributions/` | Runtime queue | git *(inconsistent)* | Medium — `"data/contributions"` default in `contribution-service.ts` + 6 route defaults | **Gitignore** + move samples to fixtures |
| 11 | `data/{collections,annotations,stewardship,changelog,living-dataset}/` | Runtime user state | gitignored | Medium — one constructor default string each | Move under `data/runtime/` |
| 12 | `scripts/data/` (23 tsv + fixture) | Curated source / regen output | git | Medium — centralized `DATA_DIR` off `import.meta.dirname` | Leave (co-located with the scripts that own it) |
| 13 | `shared/*.json` (5) | **Contracts/schema** | git | Medium-high — `.ts` co-import + `REPO_ROOT/"shared"` + Python `parents[4]/"shared"` | **Leave** (correctly co-located with `.ts` wrappers) |
| 14 | `export/culturescrape/` | Canonical corpus | **DVC** | Low — CLI arg, no hardcoded default | **Leave** (the ML seam) |
| 15 | `ml/{data,models}` + `ml/{configs,manifests,fixtures,predictions,scallop}` | ML artifacts | DVC + git | Self-contained under `ml/` | **Leave** (already an island) |
| 16 | `sources/` (glottolog, LinguaMeta.pdf, url-nlp) | External dumps | gitignored | Low — one path in `server/services/boundary-resolver.ts:404` | Leave |
| 17 | `etymology-tree/` | Standalone Clojure subproject | git | **None** — unreferenced by any TS/Python | Decide: own repo / vendor / remove |

### Detail on the loose `data/` files (#8)

- **Referenced (move + update 1 ref each):** `data/haplogroups.txt` →
  `scripts/convert-haplogroups.js:16` (`__dirname`-relative); `data/top_100_foods_by_cuisine.csv`
  → `scripts/convert-cuisines.js:14`.
- **Orphans — no code references anywhere:** `eurasian_groups.txt`, `proto-languages.txt`,
  `native_migrations.txt`, `origins_unknown.txt`, `language_contact_phenomena.csv`,
  `language_hierarchy_complete_with_contact.csv`, `linguistic_contact_patterns.txt`,
  `top_30_main_dishes_by_cuisine.csv`, `top_30_soups_by_cuisine.csv`, `top_100_foods_by_cuisine.md`.

## Proposed target layout (non-ML only)

```
data/
  source/        # curated hand-authored INPUTS, committed
    haplogroups.txt
    top_100_foods_by_cuisine.csv
    <orphans you choose to keep>
  runtime/       # gitignored per-user state (was the 5 loose dirs)
    collections/  annotations/  stewardship/  changelog/  living-dataset/
    contributions/            # now gitignored, consistent with siblings
  archive/       # (optional) orphaned files kept for reference, gitignored or committed
lexicons/                     # UNCHANGED — canonical lexicon TSVs (too costly to move)
core/
  inputs/        # OPTIONAL consolidation of pipeline inputs
    blueprints/  categories/  jobs/  cypher/  datalog-examples/
  out/                        # UNCHANGED (DVC output)
  src/ …                      # code
export/culturescrape/         # UNCHANGED — the ML seam (DVC)
ml/ …                         # UNCHANGED — self-contained island
shared/                       # UNCHANGED — contracts, co-located with .ts
```

Everything marked UNCHANGED is a deliberate leave-in-place with a rationale in the table
above (high move cost + low clarity gain, or "already correctly placed").

## Decisions (resolved)

1. **Orphan loose files (#8):** **Archive** → `data/archive/`.
2. **`data/cuisine/` (#9):** **Delete** (stray duplicate, no references).
3. **`data/contributions/` (#10):** **Gitignore** it (consistent with its 5 siblings);
   relocate the 4 sample JSONs to a fixtures dir.
4. **`core/inputs/` consolidation (#2-6):** **Yes** — consolidate under `core/inputs/`
   (Batch E, highest-risk, done last and isolated with careful skip-count checks).
5. **`etymology-tree/` (#17):** **Remove** (recoverable from git history).

## Batched move plan (risk-ordered; nothing runs until you approve)

Each batch: `git mv` → sweep references → run the affected test suites → **diff skip
count** → commit. TS gates: `bun run test` / vitest + `bun run scripts/convergence-qa.ts`.
Python gates (need the `uv` env): `cd core && uv run pytest` and `cd ml && uv run pytest`.

- **Batch A — trivial, zero coupling.** Resolve decisions 1 & 2: delete/archive the orphan
  loose files and `data/cuisine/`. No code changes. Verify: full test run still green,
  **skip count unchanged**.
- **Batch B — top-level `data/` runtime consolidation.** Create `data/runtime/`, move the
  5 gitignored dirs, update the 5 constructor defaults (`server/services/{collections,
  annotations,stewardship,changelog,living-dataset}.ts`) and root `.gitignore`. Verify:
  server route tests + a manual create/read of each runtime store.
- **Batch C — contributions consistency (decision 3).** Gitignore `data/contributions/`,
  update `contribution-service.ts:229` + the 6 route defaults, relocate samples. Verify:
  `server/routes/contributions.test.ts`.
- **Batch D — referenced loose files → `data/source/`.** Move `haplogroups.txt` +
  `top_100_foods_by_cuisine.csv`, update the 2 converter scripts (`convert-haplogroups.js:16`,
  `convert-cuisines.js:14`). Verify: run both converters, diff their emitted TSVs.
- **Batch E — OPTIONAL `core/inputs/` (decision 4).** Move blueprints/categories/jobs/
  cypher/datalog-examples; update Python constants (`datalog/examples.py`, `neo4j/queries.py`,
  `acquire/categories.py`, `orchestrate/generate.py`, CLI defaults) + test `REPO_ROOT` joins.
  Highest risk in this plan — **diff the pytest skip count carefully** (this is the exact
  trap `ml/CLAUDE.md` documents). Do it last and on its own.

## Explicitly out of scope (leave as-is, with reason)

- `lexicons/` — ~60 hardcoded literals + `process.cwd()`; top-level is already a clear home.
- `shared/*.json` — contracts deliberately co-located with their `.ts` wrappers.
- `export/culturescrape/`, `ml/**` — the corpus seam and the ML island.
- Test fixtures (`core/tests/fixtures/**`, `ml/fixtures/`) — belong with their tests.
- `sources/` — gitignored external dumps, one code path.
