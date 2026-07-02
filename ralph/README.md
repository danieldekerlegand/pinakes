# Ralph Tasklists

Tasklists for [ralphy](https://github.com/michaelshimeles/ralphy), run in dependency
order. Each builds out one slice of the remaining LinguaScrape roadmap
(`docs/prd-linguascrape-deep-history-roadmap.md`, Phases 11-14) plus the culture-scrape
integration.

Numbering **continues from the archived Ralphy batches 9-12** (see
`docs/archive/ralphy/`) so ids never collide with completed work. The completed
roadmap phases (7-10 — deep-history lineage engine, data expansion, cultural domains,
advanced map/viz) were delivered by those archived batches.

Each tasklist directory holds:

- `tasks.json` — the **ralphy-executable** task file
  (`{project, description, tasks: [{title, description, completed}]}`).
- `prd.json` — the human-readable spec (story ids, acceptance criteria, priorities).
  Kept for reference; ralphy does not read it.

| #  | Tasklist | ralphy file | Tasks | Depends on | Status |
|----|----------|-------------|-------|------------|--------|
| 15 | Data-layer convergence (shared canonical schema) | `15-data-layer-convergence/tasks.json` | 9 | — | ✅ authored |
| 16 | Graph app integration (Neo4j SoR + FastAPI proxy) | `16-graph-app-integration/tasks.json` | 12 | 15 | ✅ authored |
| 17 | Data acquisition — remaining Phase 11 gaps | `17-data-acquisition/tasks.json` | 12 | 16 | ✅ authored |
| 18 | Narrative & educational features — Phase 12 gaps | `18-narrative-education/tasks.json` | 11 | 16 | ✅ authored |
| 19 | Platform & infrastructure — Phase 13 gaps | `19-platform-infra/tasks.json` | 12 | 15 | ✅ authored |
| 20 | Speculative & long-term vision — Phase 14 gaps | `20-speculative/tasks.json` | 11 | 18 | ✅ authored |

> Tasklists 17–20 contain **only verified gaps** — items an audit confirmed are already built
> (e.g. bulk import, Glottolog/WALS, curated journeys, NL search, dark mode, deck.gl) are excluded.
> The Python-side convergence companion is `packages/culture-scrape/ralph/10-linguascrape-convergence`.

> **Python side (same repo):** culture-scrape is vendored in-repo at
> **`packages/culture-scrape/`**, so the Python-side ingestion, reconciliation, and Datalog
> work for convergence is an in-repo concern — `ralphy` can modify `packages/culture-scrape/`
> directly, and that project ships its own tasklists under `packages/culture-scrape/ralph/`.
> No cross-repo split. See `docs/culturescrape-integration.md` §6.

## culture-scrape integration (tasklists 15–16)

Integration approach: **shared canonical schema with Neo4j/Datalog as the correlation
system-of-record** (not a loose API bridge, and not a Python rewrite of the backend).
culture-scrape (vendored at `packages/culture-scrape/`) ingests LinguaScrape's `lexicons/*.tsv` as an
acquisition source, reconciles entities, and loads a unified graph into Neo4j + Datalog;
TSV stays the portable source of truth on both sides. LinguaScrape stays TypeScript and
queries the shared graph via a **Neo4j TS driver** (relational traversal) plus the
**FastAPI proxy** (search + Datalog inference), surfaced through the existing
UnifiedExplorer adapter system, degrading gracefully when the graph is offline.

- **15 — Data-layer convergence:** the shared schema contract, per-TSV mapping, edge
  extraction, ingestion-ready export, reconciliation keys, provenance, write-back, QA.
- **16 — Graph app integration:** Neo4j TS driver, proxy routes, explorer adapter, graph
  neighborhood views, federated search, provenance UI, Datalog/Cypher console.

See `docs/culturescrape-integration.md` for the authoritative design.

## Run them

`ralphy` operates on the current working directory's git repo and auto-commits per task.

```bash
# from the repo root — run all present tasklists in dependency order
./ralph/run.sh

# or run specific tasklists by their number
./ralph/run.sh 15            # just tasklist 15
./ralph/run.sh 15 16         # tasklists 15 and 16

# skip tests+lint (useful for a first exploratory pass)
FAST=1 ./ralph/run.sh 15
```

### Or call ralphy directly

```bash
ralphy --json ralph/15-culturescrape-integration/tasks.json --claude
```

Useful flags: `--fast` (skip tests+lint), `--max-retries <n>`, `--branch-per-task`,
`--parallel --max-parallel <n>` (worktree isolation), `--dry-run`, `--verbose`.
See `ralphy --help`.

## Conventions every task assumes

- App root: `server/` (Express + `tsx`), `client/src/` (React + Vite), `lexicons/*.tsv`
  (TSV-first storage). No Postgres/Drizzle — TSV is the source of truth.
- Acceptance criteria use TypeScript checks: **`npm run check`** (tsc types) and
  **vitest** (tests). Network/sidecar calls are mocked against fixtures — no live
  network in tests.
- The deep-history roadmap (`docs/prd-linguascrape-deep-history-roadmap.md`) is the
  authoritative plan; each tasklist targets the true remaining gaps in its phase
  (several Phase 11-13 items are already partially done — tasklists only cover the gaps).
