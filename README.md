# pinakes

**One Python service + one React client.** A FastAPI backend
([`services/api/`](./services/api/)) serves the whole `/api` surface *and* the built
React/Vite client ([`web/`](./web/)) from a single process, for exploring language,
culture, and deep history through interactive visualizations. Storage is **TSV-first** —
`data/source/lexicons/*.tsv` is the source of truth (loaded by
`pinakes.lexicons.storage`); there is no Postgres/Drizzle in the live path.

The TypeScript/Express backend this replaced was deleted in the final cutover
(`tasks/chief/80-cutover.json`; docs/UNIFIED-PROJECT-PLAN.md §7 Phase 4) after all 306
of its routes were ported — `contracts/parity/` is the frozen baseline the service is
still graded against. The TypeScript that remains is the client, the cross-cutting
contracts ([`contracts/`](./contracts/)) and the repo tooling ([`scripts/`](./scripts/)).

pinakes also consumes a **shared pinakes-engine graph** (Neo4j + Datalog) for
cross-domain correlation; the CPU-domain compute (linguistic distance, etymology) lives
in the service beside it. The engine is **imported in-process** — there is no sidecar HTTP
hop on the live path — and is **first-party pinakes code** at
[`engine/`](./engine/) — formerly vendored under `packages/culture-scrape/`, relocated into
pinakes proper and renamed to the `pinakes_engine` package. Canonical **format
rendering** — Neo4j/Prolog/Soufflé/ProbLog/TSV — is delegated to the embedded agora
translation engine (`agora:60-translation-engine-rust`) rather than hand-written here; see
[`docs/REMOVED_FEATURES.md`](./docs/REMOVED_FEATURES.md) for the retirement and what
remains in Python.

## Quickstart

```bash
npm install                   # the client + the repo tooling
uv sync --all-packages        # the Python service + the engine (one root .venv)
cp .env.example .env          # fill in API keys / graph config as needed

npm run build && npm start    # build the client, then serve everything from one
                              # process (`python -m pinakes`, $PORT default 3050)
npm run dev                   # client-only Vite dev server with HMR; proxies /api to
                              # a service started separately with `npm start`
npm run dev:full              # the above + pinakes-engine sidecar + Neo4j (needs Docker;
                              # the sidecar image is currently unbuildable — see
                              # infra/engine.Dockerfile)

npm run check                 # typecheck the client + contracts (tsc -p web/tsconfig.json)
npm run check:scripts         # typecheck scripts/ (its own tsconfig)
npm test                      # the full vitest suite
npm test -- <path>            # tests, scoped to what you changed

uv run --all-packages pytest engine/tests        # the engine suite
uv run --all-packages pytest services/api/tests  # the service suite
```

`.chief/verify.sh` runs exactly the checks a given diff needs and is the merge gate;
`CHIEF_VERIFY_DRY_RUN=1 .chief/verify.sh` prints the plan without running it.

The app runs fully **without** the graph stack — graph-dependent UI simply disables with a
tooltip. See the runbook below to enable it.

## Documentation

- **Graph integration & runbook** — [`docs/engine-integration.md`](./docs/engine-integration.md):
  architecture, the `/api/graph/*` route catalog and degradation contract (§10b), and the
  app-side **run / deploy / extend** runbook incl. env vars, `dev:full`, docker-compose, and
  production notes (§10c).
- **Canonical data contract** — [`docs/canonical-schema.md`](./docs/canonical-schema.md):
  node/edge schema, per-lexicon mapping, export/reconcile/write-back/QA tooling.
- **Ralph workflow** — [`docs/ralph-workflow.md`](./docs/ralph-workflow.md): the autonomous
  PRD-driven iteration loop under `tasks/ralph/` and `scripts/ralph/`.
- **Self-describing koine participant** —
  [`docs/self-describing-participant.md`](./docs/self-describing-participant.md): the four facets
  Pinakes owns in-repo — its namespace and minting authority, its capability manifest, its
  egress/dialect policy, and its public bridge mappings — where each lives, and why Pinakes
  needs only **koine** (the spec) and **agora** (the runtime) to join the fabric.
- **Capability bus (KCB) + the KFT `finetune` provider** —
  [`docs/capability-bus.md`](./docs/capability-bus.md): the manifest Pinakes publishes, its
  MCP/A2A fronts, and the **specialized, local-only** fine-tuning provider. Its trainer is
  **no longer in this repo**: the `ml/` workspace was extracted into the private **`lugh`**
  repo as `lugh:agent:finetune` ([`docs/LUGH-EXTRACTION-PLAN.md`](./docs/LUGH-EXTRACTION-PLAN.md)),
  and since the cutover deleted the app-side dispatch wrapper, a KFT job is run against
  lugh directly (`uv run --project $LUGH_ROOT pinakes-train-slm --kft-job <manifest>`);
  Pinakes still *advertises* and describes the capability on its MCP/A2A fronts.
  Fine-tuning is deliberately multi-provider (KFT §9/FT-K), and **two sibling
  legs are NOT built in this repo**: the *general*, cloud-capable trainer
  (`agora:90-finetune-trainer`) and the KCB client that calls both
  (`cuneiform:90-finetune-client`, replacing its `Runner::Stub`). Program map:
  `koine/tasks/chief/README.md`, Tranche D.
- **Data/correlation engine** — [`engine/README.md`](./engine/README.md)
  (Python ≥3.11; own `mypy`/`pytest`/`ruff` toolchain).

Nearby `CLAUDE.md` files (`services/api/`, `scripts/`, `contracts/`) hold
directory-specific conventions.
