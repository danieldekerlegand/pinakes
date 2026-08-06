# Project context for Chief agents

This is appended to Chief's generic loop instructions and given to the agent each
iteration. Put your project's specifics here.

## Quality checks (loop step 5 — how to verify a story)

Run the subset your story touched. The merge gate `.chief/verify.sh` runs exactly these,
selected by the branch's diff — so if your story passes the gate, it passes review.

| Half | Command | Warm |
|---|---|---|
| TypeScript typecheck (web/ + contracts/) | `bun run check` | ~2s |
| TypeScript typecheck (scripts/ — its OWN tsconfig, *not* in `check`) | `bun run check:scripts` | ~2s |
| JS/TS tests | `bun run test` (= `vitest run --config web/vitest.config.ts`) | ~11s |
| ...scoped | `bun run test <path>` | ~2s |
| Python engine | `uv run --all-packages pytest -q engine/tests` | ~5s |
| Python service | `uv run --all-packages pytest -q services/api/tests` | ~1s |
| Python lint | `uv run --all-packages ruff check services/api` | <1s |
| Python types (strict) | `uv run --directory services/api --all-packages mypy` | <1s |

The whole gate is ~20s warm. There is no excuse for guessing:

```sh
CHIEF_BASE_BRANCH=main .chief/verify.sh                      # the real gate
CHIEF_VERIFY_DRY_RUN=1 CHIEF_BASE_BRANCH=main .chief/verify.sh   # just print what it would run
```

Only mark a story done when the relevant checks are green.

## Conventions

- **One service, one client.** `services/api/` (FastAPI) serves the whole `/api` surface *and*
  the built React client from one process; `engine/` is imported in-process. The TypeScript
  that remains is `web/` (the client), `contracts/` (cross-cutting contracts) and `scripts/`
  (repo tooling). The Express backend was deleted by 80-cutover US-2.
- **`contracts/parity/` is a FROZEN baseline**, not a live contract between two halves: the
  Express app it was harvested from is gone. It is still the service's route catalog — a change
  there selects the Python suite (see `contracts/parity/README.md`).
- **Adding a route group = adding one file** to `services/api/src/pinakes/routers/`. It is
  auto-discovered; no shared wiring to edit. Baseline coverage is *computed* (parity spec routes
  minus routes the app registered), never stored — the number cannot disagree with the code.
- Commit style: `feat: [Story ID] - [Story Title]`, per the Chief loop.

## Gotchas

- **`uv run --project <member>` does NOT scope pytest collection.** uv doesn't change cwd, so
  pytest finds the root `pytest.ini` whose `testpaths` spans both suites either way — and a
  single-member env then dies collecting the other suite on a cold checkout. Always
  `uv run --all-packages pytest <path>`. Scope by path, never by project.
- **mypy resolves `files =` against cwd, not the config file.** Use `--directory services/api`
  (not `--project`), or it dies with "Missing target module".
- **A bare `vitest` finds no config** — it lives at `web/vitest.config.ts`. Use `bun run test`.
- **`.chief/state/prd.json` is gitignored** (`.gitignore` `.chief/state/`), so `git checkout` on
  it silently no-ops. Edit it in place; never try to restore it from git.
- **The Node backend is gone** — `server/` was deleted by 80-cutover US-2, and with it the
  `dev`/`start` Express entry points and the esbuild leg of `build`. `npm start` is the Python
  service; `npm run build` is the client only; `npm run dev` is Vite with `/api` proxied across.
  Two pure-TSV libraries survived the delete at `scripts/lib/` because repo tooling consumes
  them (`data-quality-scorer.ts`, `canonical-edges.ts`).
- **The ML/training workspace is gone** — `ml/` was extracted into the private `lugh` repo
  (90-extract-lugh; `docs/LUGH-EXTRACTION-PLAN.md`). Nothing here imports it, and the merge
  gate has no ML leg. lugh runs its OWN `chief run` against its own tasklists.
- The registry-mirror drift guard needs a sibling koine checkout (`$KOINE_ROOT`, else
  `~/Development/koine`). The gate *skips* it when absent — a check that cannot run is no signal.
