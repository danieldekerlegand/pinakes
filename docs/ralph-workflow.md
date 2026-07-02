# Ralph Workflow

LinguaScrape uses the **Ralph** long-running-agent loop to work through PRDs autonomously.
It replaces the earlier `ralphy` JSON-tasklist tooling (archived under `docs/archive/ralphy/`).

## Layout

```
scripts/ralph/
  ralph.sh        # the loop: repeatedly feeds an agent prompt until a PRD's stories all pass
  prompt.md       # agent instructions (amp variant)
  CLAUDE.md       # agent instructions (claude variant) + LinguaScrape commands/conventions
  run-all.sh      # multi-PRD orchestrator: seed → loop → verify → merge → retire
  .gitignore      # ignores runtime state: prd.json, progress.txt, .last-branch, archive/, snapshots/
tasks/ralph/
  <name>.json     # PRD library — one file per feature (the templates)
  completed/      # merged PRD records (stamped with mergedToMain), git-tracked
```

A **PRD** is a JSON file: `{ project, branchName, description, userStories: [ { id, title,
description, acceptanceCriteria, passes, notes } ] }`. Stories are listed in priority order; the
agent implements the first `passes: false` story per iteration, then flips it to `true`.

## Run one PRD

`ralph.sh` operates on `scripts/ralph/prd.json` (runtime state, gitignored). Seed it, then loop:

```bash
cp tasks/ralph/data-layer-convergence.json scripts/ralph/prd.json
./scripts/ralph/ralph.sh --tool claude 12      # up to 12 iterations
```

Each iteration runs a fresh agent that: picks the next unfinished story, implements it, runs the
touched workspace's quality checks (see `scripts/ralph/CLAUDE.md`), commits
`feat: [Story ID] - [Story Title]`, sets `passes: true`, and appends to `progress.txt`. The loop
exits when the agent emits `<promise>COMPLETE</promise>`.

## Run everything (recommended)

`run-all.sh` drives all pending PRDs in dependency order — seed → loop → snapshot → **baselined
verify** → merge to `main` → record under `completed/` → retire the template → next PRD branches
from the updated `main`:

```bash
git checkout main                       # must be clean + on main
./scripts/ralph/run-all.sh              # all pending PRDs, in order
./scripts/ralph/run-all.sh graph-app-integration    # just one (or a subset)

AUTO_MERGE_MAIN=0 ./scripts/ralph/run-all.sh ...     # complete but don't merge
RESUME=1          ./scripts/ralph/run-all.sh <name>  # resume a partial run
```

**Dependency order:** `data-layer-convergence` → `linguascrape-convergence-python` →
`graph-app-integration` → `platform-infra` → `data-acquisition` → `narrative-education` →
`speculative`.

### Verification gate

Before merging, `run-all.sh` runs only the checks for the areas the branch changed, **baselined
against `main`** — a check fails only on failures the branch *introduces* (pre-existing breakage on
`main` never blocks a finished branch). Set `STRICT_VERIFY=1` to fail on any failure.

- Web app (`client/`, `server/`, `shared/`): `npx tsc --noEmit` + `vitest run <changed specs>`
- culture-scrape sidecar (`packages/culture-scrape/`): `mypy src` + `pytest` + `ruff check .`

## Notes

- `main` stays clean; every PRD runs on its `ralph/<feature>` branch.
- culture-scrape is vendored at `packages/culture-scrape/`; the same Ralph run commits to both the
  TS app and the Python sidecar. Its **own** upstream `ralph/` (numbered `ralphy` tasklists) is kept
  as vendored reference and is not used by this workflow.
- Requires `jq`, and `ralphy` is **not** needed. Uses `claude` (default) or `amp`.
