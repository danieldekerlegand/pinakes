# Ralphy Tasklists

Six tasklists for [ralphy](https://github.com/michaelshimeles/ralphy), run in
dependency order. Each builds one subsystem of culture-scrape (see `../PLAN.md`).

Each tasklist directory holds:
- `tasks.json` — the **ralphy-executable** task file (`{project, description, tasks: [{title, description, completed}]}`).
- `prd.json` — the original human-readable spec (story ids, priorities, acceptance criteria). Kept for reference; ralphy does not read it.

| # | Tasklist | ralphy file | Tasks | Depends on |
|---|---|---|---|---|
| 1 | Core acquisition engine | `01-acquisition/tasks.json` | 13 | — |
| 2 | Canonical TSV schema + entity resolution | `02-schema-entity-resolution/tasks.json` | 13 | 1 |
| 3 | Ontology & cross-dimensional linking | `03-ontology-linking/tasks.json` | 12 | 2 |
| 4 | Neo4j bidirectional converter | `04-neo4j-converter/tasks.json` | 9 | 2 |
| 5 | Prolog/Datalog exporter | `05-datalog-exporter/tasks.json` | 9 | 2, 3 |
| 6 | Orchestration, seed corpus & QA | `06-orchestration-seedcorpus/tasks.json` | 11 | 1–5 |
| 10 | LinguaScrape convergence (ingest/reconcile/link/Datalog/Neo4j) | `10-linguascrape-convergence/tasks.json` | 8 | 1–6 |

(Tasklists 07–09 — GUI explorer, corpus expansion, Wikidata integration — also exist on disk.)

> **Vendored in a monorepo.** culture-scrape is vendored into the LinguaScrape repo at
> `packages/culture-scrape/` (no nested `.git`). Tasklist **10** is the Python-side companion
> to LinguaScrape's `ralph/15` (data-layer convergence); see `docs/culturescrape-integration.md`
> at the repo root. Drive tasklists from the **monorepo root** so ralphy commits to the enclosing
> repo, e.g. `ralphy --json packages/culture-scrape/ralph/10-linguascrape-convergence/tasks.json --claude`.

## Run them

The runner initializes git (ralphy auto-commits per task) and runs the tasklists
in dependency order on the current branch, so each builds on the previous one.

```bash
# from the repo root — run all six in order
./ralph/run.sh

# or run specific tasklists by number
./ralph/run.sh 1            # just tasklist 1
./ralph/run.sh 3 4          # tasklists 3 and 4

# the very first run has no tests/lint configured yet — skip them for tasklist 1
FAST=1 ./ralph/run.sh 1
```

### Or call ralphy directly

`ralphy` operates on the current working directory's git repo:

```bash
# from the repo root
ralphy --json ralph/01-acquisition/tasks.json --claude
```

Useful flags: `--fast` (skip tests+lint), `--max-iterations <n>` (0 = unlimited,
default), `--branch-per-task`, `--parallel --max-parallel <n>` (worktree isolation),
`--dry-run`, `--verbose`. See `ralphy --help`.

## Conventions every task assumes

- Package root: `src/culturescrape/`, installable via `pyproject.toml` (created by tasklist 1).
- The canonical schema in `docs/data-model.md` is authoritative.
- Acceptance criteria use Python checks: **mypy** (types), **pytest** (tests),
  **ruff** (lint). Network code is mocked against recorded fixtures (no live network in tests).
- Every acquired row carries full provenance (see the data model).

## Tips

- Tasklists 3 and 4 both depend only on 2 and are independent of each other; you can
  run them back to back, or in separate worktrees with `--parallel`.
- Each task's `description` embeds its full acceptance-criteria checklist, so a fresh
  ralphy agent has everything it needs without reading `prd.json`.
- Re-running a tasklist skips tasks already marked `completed: true` in its `tasks.json`.
