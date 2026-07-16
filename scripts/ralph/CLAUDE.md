# Ralph Agent Instructions

You are an autonomous coding agent working on a software project.

## Your Task

1. Read the PRD at `prd.json` (in the same directory as this file)
2. Read the progress log at `progress.txt` (check Codebase Patterns section first)
3. Check you're on the correct branch from PRD `branchName`. If not, check it out or create from main.
4. Pick the **first** user story where `passes: false` (stories are listed in priority order)
5. Implement that single user story
6. Run quality checks for the workspace(s) you touched — see the **Project: pinakes** section below for the exact commands
7. Update CLAUDE.md files if you discover reusable patterns (see below)
8. If checks pass, commit ALL changes with message: `feat: [Story ID] - [Story Title]`
9. Update the PRD to set `passes: true` for the completed story
10. Append your progress to `progress.txt`

## Progress Report Format

APPEND to progress.txt (never replace, always append):
```
## [Date/Time] - [Story ID]
- What was implemented
- Files changed
- **Learnings for future iterations:**
  - Patterns discovered (e.g., "this codebase uses X for Y")
  - Gotchas encountered (e.g., "don't forget to update Z when changing W")
  - Useful context (e.g., "the explorer adapters live in client/src/lib/visualization/adapters")
---
```

The learnings section is critical — it helps future iterations avoid repeating mistakes and understand the codebase better.

## Consolidate Patterns

If you discover a **reusable pattern** that future iterations should know, add it to the `## Codebase Patterns` section at the TOP of progress.txt (create it if it doesn't exist). Only add patterns that are **general and reusable**, not story-specific details.

## Update CLAUDE.md Files

Before committing, check if any edited files have learnings worth preserving in nearby CLAUDE.md files:

1. **Identify directories with edited files** — which directories you modified
2. **Check for existing CLAUDE.md** — in those directories or parents
3. **Add valuable learnings** — API patterns/conventions, gotchas, file dependencies, testing approaches, config requirements

Do NOT add story-specific implementation details, temporary debugging notes, or anything already in progress.txt. Only add **genuinely reusable knowledge**.

## Quality Requirements

- ALL commits must pass the touched workspace's quality checks (typecheck, tests, and — Python only — lint)
- Do NOT commit broken code
- Keep changes focused and minimal; follow existing code patterns

## Browser Testing (If Available)

For any story that changes UI, verify it works in the browser if you have browser testing tools configured (e.g., via MCP or the dev-browser skill): run the app (`npm run dev`, or `npm run dev:full` when the culture-scrape graph is needed), navigate to the relevant page, verify the change, and screenshot if helpful. If no browser tools are available, note in progress.txt that manual browser verification is needed. Do not mark a UI story `passes: true` without some browser-level confirmation.

## Stop Condition

After completing a user story, check if ALL stories have `passes: true`.

If ALL stories are complete and passing, reply with:
<promise>COMPLETE</promise>

If there are still stories with `passes: false`, end your response normally (another iteration will pick up the next story).

## Important

- Work on ONE story per iteration
- Commit frequently; keep CI green
- Read the Codebase Patterns section in progress.txt before starting

## Project: pinakes — Commands, Conventions & Gotchas

A TypeScript/React/Vite + Express app with **TSV-first storage** (`lexicons/*.tsv` is the source of truth; no Postgres/Drizzle in the live path). The Python data/correlation engine **culture-scrape is vendored** at `packages/culture-scrape/` (no nested `.git` — commits go to this monorepo). The authoritative integration design is `docs/culturescrape-integration.md`.

### Quality-check commands by area

- **Web app** (`client/`, `server/`, `shared/` — React 18 + Vite + Express + vitest)
  - Typecheck: `npm run check` (runs `tsc`) — must be clean for the files you touched.
  - Tests (scope to the area you changed, e.g. a file or dir): `npx vitest run <path-you-touched>`
  - Run the app: `npm run dev`; with the graph sidecar + Neo4j: `npm run dev:full` (see docker-compose.yml, .env.example).
- **culture-scrape sidecar** (`packages/culture-scrape/`, Python ≥3.11) — run from that directory:
  - Types: `python -m mypy src` · Tests: `python -m pytest` · Lint: `python -m ruff check .`
  - Network is mocked against fixtures in tests — no live network / no live Neo4j.

"Typecheck passes" = the touched workspace's typecheck is clean. "Tests pass" = the test command **scoped to the files/area you changed** is green. Never commit if your scoped typecheck or scoped tests fail.

### Conventions & gotchas (read before editing)

- **Keep `main` clean.** Each PRD runs on its `ralph/<feature>` branch created from `main`. Never commit directly to `main`.
- **TSV is the source of truth.** Data lives in `lexicons/*.tsv`, loaded by `server/tsv-storage.ts`. Prefer extending TSV + loaders over introducing a database.
- **The explorer is adapter-driven.** New datasets become a `DatasetAdapter` in `client/src/lib/visualization/adapters/` (declare dimensions; the generic visualizations follow). Don't hand-build per-dataset panels.
- **Shared graph = correlation system-of-record.** Relational/graph queries go through Neo4j (via the graph app-integration work) + culture-scrape's Datalog; keep CPU-domain compute (linguistic distance, etymology) in TS. See `docs/culturescrape-integration.md`.
- **culture-scrape is vendored, not upstream-linked.** Python-side convergence work lives under `packages/culture-scrape/`; use its own toolchain (mypy/pytest/ruff).
- **Commit message:** `feat: [Story ID] - [Story Title]`. End the commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **One story per iteration; keep CI green.** A red typecheck/test compounds across fresh-context iterations — never commit broken code.
