# pinakes

A TypeScript/React/Vite + Express application for exploring language, culture, and deep
history through interactive visualizations. Storage is **TSV-first** — `lexicons/*.tsv` is
the source of truth (loaded by `server/tsv-storage.ts`); there is no Postgres/Drizzle in the
live path.

pinakes also consumes a **shared culture-scrape graph** (Neo4j + Datalog) for
cross-domain correlation, while keeping CPU-domain compute (linguistic distance, etymology)
in TypeScript. The Python data/correlation engine is **first-party pinakes code** at
[`core/`](./core/) — formerly vendored under `packages/culture-scrape/`, relocated into
pinakes proper (the `culturescrape` package namespace is unchanged).

## Quickstart

```bash
npm install
cp .env.example .env          # fill in API keys / graph config as needed

npm run dev                   # app only (graph features degrade off gracefully)
npm run dev:full              # app + culture-scrape sidecar + Neo4j (needs Docker)

npm run check                 # typecheck (tsc)
npx vitest run <path>         # tests, scoped to what you changed
npm run build && npm start    # production build + serve
```

The app runs fully **without** the graph stack — graph-dependent UI simply disables with a
tooltip. See the runbook below to enable it.

## Documentation

- **Graph integration & runbook** — [`docs/culturescrape-integration.md`](./docs/culturescrape-integration.md):
  architecture, the `/api/graph/*` route catalog and degradation contract (§10b), and the
  app-side **run / deploy / extend** runbook incl. env vars, `dev:full`, docker-compose, and
  production notes (§10c).
- **Canonical data contract** — [`docs/canonical-schema.md`](./docs/canonical-schema.md):
  node/edge schema, per-lexicon mapping, export/reconcile/write-back/QA tooling.
- **Ralph workflow** — [`docs/ralph-workflow.md`](./docs/ralph-workflow.md): the autonomous
  PRD-driven iteration loop under `tasks/ralph/` and `scripts/ralph/`.
- **Data/correlation engine** — [`core/README.md`](./core/README.md)
  (Python ≥3.11; own `mypy`/`pytest`/`ruff` toolchain).

Nearby `CLAUDE.md` files (`scripts/`, `shared/`) hold directory-specific conventions.
