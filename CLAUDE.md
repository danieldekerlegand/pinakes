# pinakes — the Wikidata-anchored knowledge/data hub

**One Python (FastAPI) service + one React/Vite client** building the ecosystem's
**canonical knowledge authority**: a Wikidata-anchored graph and world-cultures atlas
(languages × geography × time × culture), TSV-first, served as a koine/agora fabric
participant (KCB provider, `pinakes:agent:resolver`). The service (`services/api`) imports
the engine (`engine/`, package `pinakes_engine`) **in-process** — no sidecar hop on the
live path. Mission + status: [`ROADMAP.md`](ROADMAP.md); orientation: [`README.md`](README.md).

**What belongs here:** the curated multi-domain TSV corpus, the canonical node/edge schema
and its contracts, acquisition/reconcile/write-back tooling, the Neo4j+Datalog graph, the
atlas client, fabric participation (KCB/KGP/KINP surfaces).
**What does NOT:** general format *translation* (moved to **agora** — the embedded Rust
translation engine is consumed, never rebuilt here) and model *training* (moved to the
private **lugh** repo, `docs/LUGH-EXTRACTION-PLAN.md` — pinakes advertises the KFT
`finetune` capability but hosts no trainer).

## Quality gates — `.chief/verify.sh` is the merge gate

`.chief/verify.sh` is the single source of truth: path-scoped (runs only what a diff
needs), ≈20s warm. `CHIEF_VERIFY_DRY_RUN=1 .chief/verify.sh` prints the plan without
running it. The checks it composes (all currently green; bun preferred, npm fallback):

```bash
bun run check          # tsc -p web/tsconfig.json — web/ + contracts/; HARD gate, 0 errors
bun run check:scripts  # tsc -p scripts/tsconfig.json — scripts/ has its OWN project
bun run test           # full vitest suite (~3s; scope with: npx vitest run <path>)

uv run --all-packages pytest -q engine/tests        # engine suite (~2200 tests, ~8s)
uv run --all-packages pytest -q services/api/tests  # service suite (~2050 tests, ~50s)
uv run --all-packages ruff check services/api       # lint (service half)
uv run --directory services/api --all-packages mypy # NOTE --directory, not --project

bun run check:contracts        # contract-bindings drift gate (read-only)
bun run check:registry-mirror  # koine registry-mirror drift (needs sibling koine checkout)
bun run test:e2e               # Playwright browser smoke — NOT in verify.sh; see e2e/CLAUDE.md
```

- **Always `uv run --all-packages`**, never `--project <member>`, for pytest: the root
  `pytest.ini` testpaths span both suites, so a single-project env dies collecting the
  other on a cold checkout. Scope with a *path* argument, not the config.
- The uv workspace (`pyproject.toml`) is virtual: **one root `uv.lock` + one root `.venv`**
  for `contracts/python` + `engine` + `services/api`. Engine-scoped ruff/mypy live in
  [`engine/CLAUDE.md`](engine/CLAUDE.md) (`uv run ruff check . && uv run mypy src` from `engine/`).
- After a **data change**, run `bun run convergence-qa` (drift/attribution/dedup-ratchet
  gate) and regenerate the committed snapshots it and the tests pin — see
  [`scripts/CLAUDE.md`](scripts/CLAUDE.md) for the full regeneration matrix.

## Layout

| Path | What it is | Authority |
|---|---|---|
| `services/api/` | The `pinakes` FastAPI service — serves all of `/api` + the built client | [`services/api/CLAUDE.md`](services/api/CLAUDE.md) |
| `engine/` | `pinakes_engine` — graph/correlation engine (Neo4j, Datalog, acquire) | [`engine/CLAUDE.md`](engine/CLAUDE.md) (+ per-package files under `src/`) |
| `web/` | React/Vite client; owns the TS project config (`web/tsconfig.json`, vitest/playwright configs) | — |
| `contracts/` | Language-neutral `*.json` sources + generated TS/Python bindings; koine mirrors; parity baseline | [`contracts/CLAUDE.md`](contracts/CLAUDE.md) |
| `scripts/` | Repo tooling: export/write-back/acquire/QA, codegen, registry re-vendor | [`scripts/CLAUDE.md`](scripts/CLAUDE.md) |
| `data/source/lexicons/` | The TSV corpus — **the source of truth** | `docs/canonical-schema.md` |
| `e2e/` | Playwright specs (`*.spec.ts`, never `*.test.ts`) | [`e2e/CLAUDE.md`](e2e/CLAUDE.md) |
| `docs/` | Canonical schema, engine integration/runbook, capability bus, grounding packs, committed report snapshots | — |
| `tasks/chief/` | Chief tasklists (`NN-slug.json`; finished → `completed/`) | `~/Development/CLAUDE.md` conventions |

`server/` and `test/` are residue of the deleted TS/Express backend era; the live backend
is Python. `build/` is generated output (e.g. `build/corpus/` — the canonical export).

## Invariants an agent must not violate

- **TSV-first.** `data/source/lexicons/*.tsv` is the corpus source of truth; the graph and
  every export derive from it. No SQL app DB. Path is `data/source/lexicons/`, never a
  bare `lexicons/` literal (a wrong dir yields a cheerfully green empty report).
- **`contracts/*.json` is the source; bindings are generated.** Never hand-edit
  `contracts/generated/`, `contracts/python/`, or any generated file — edit the JSON, run
  `bun run gen:contracts`, commit both. The drift gate blocks anything else.
- **Vendored koine mirrors are immutable here.** `contracts/predicate-mapping.json` and
  `kgp.ts`'s relation vocabularies re-vendor via `bun run regen:registry-mirror` only;
  a vocabulary change is upstreamed to koine (bump `registryVersion`), never made locally.
- **Never hard-code a confidence literal or hand-roll a claim id / pack hash** — use
  `@contracts/confidence-rubric` and `@contracts/kgp`'s minting functions.
- **The `cs:` id-space is shared data** (with lugh and the client); changing it is a
  corpus migration, not a refactor. csids are QID-anchored: a known `wikidata_qid` *is*
  the identity.
- **Provenance rides on every row** (`source`/`source_url`/`retrieved_at`/`confidence`);
  never fabricate a URL. The convergence-QA attribution + dedup-ratchet gates enforce it.
- **A node-lexicon change cascades**: regenerate `docs/engine-export-manifest.json` +
  `docs/reconciliation-report.json` (and re-baseline convergence-QA if dedup counts
  legitimately move); the lugh repo's manifests move too — see `scripts/CLAUDE.md`.
- **Don't re-specify the fabric.** koine is the spec, agora the runtime; translation and
  training stay out of this repo (ROADMAP non-goals, verbatim).
