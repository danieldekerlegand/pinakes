# pinakes

A TypeScript/React/Vite + Express application for exploring language, culture, and deep
history through interactive visualizations. Storage is **TSV-first** — `data/source/lexicons/*.tsv` is
the source of truth (loaded by `server/tsv-storage.ts`); there is no Postgres/Drizzle in the
live path.

pinakes also consumes a **shared pinakes-engine graph** (Neo4j + Datalog) for
cross-domain correlation, while keeping CPU-domain compute (linguistic distance, etymology)
in TypeScript. The Python data/correlation engine is **first-party pinakes code** at
[`engine/`](./engine/) — formerly vendored under `packages/culture-scrape/`, relocated into
pinakes proper and renamed to the `pinakes_engine` package. Canonical **format
rendering** — Neo4j/Prolog/Soufflé/ProbLog/TSV — is delegated to the embedded agora
translation engine (`agora:60-translation-engine-rust`) rather than hand-written here; see
[`docs/REMOVED_FEATURES.md`](./docs/REMOVED_FEATURES.md) for the retirement and what
remains in Python.

## Quickstart

```bash
npm install
cp .env.example .env          # fill in API keys / graph config as needed

npm run dev                   # app only (graph features degrade off gracefully)
npm run dev:full              # app + pinakes-engine sidecar + Neo4j (needs Docker; the
                              # sidecar image is currently unbuildable — see infra/engine.Dockerfile)

npm run check                 # typecheck (tsc -p web/tsconfig.json)
npm test                      # the full vitest suite
npm test -- <path>            # tests, scoped to what you changed
npm run build && npm start    # production build + serve
```

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
- **Capability bus (KCB) + the KFT `finetune` provider** —
  [`docs/capability-bus.md`](./docs/capability-bus.md): the manifest Pinakes publishes, its
  MCP/A2A fronts, and the **specialized, local-only** fine-tuning provider that wraps
  [`ml/`](./ml/). Fine-tuning is deliberately multi-provider (KFT §9/FT-K), and **two sibling
  legs are NOT built in this repo**: the *general*, cloud-capable trainer
  (`agora:90-finetune-trainer`) and the KCB client that calls both
  (`cuneiform:90-finetune-client`, replacing its `Runner::Stub`). Program map:
  `koine/tasks/chief/README.md`, Tranche D.
- **Data/correlation engine** — [`engine/README.md`](./engine/README.md)
  (Python ≥3.11; own `mypy`/`pytest`/`ruff` toolchain).

Nearby `CLAUDE.md` files (`scripts/`, `contracts/`) hold directory-specific conventions.
