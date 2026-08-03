# engine/ — the pinakes data/correlation engine (Python)

First-party pinakes code. It lived at `packages/culture-scrape/` while it was
vendored, then at `core/`; pinakes:20 US-1 moved it here and renamed the Python
package to **`pinakes_engine`** (the target layout of
[`docs/UNIFIED-PROJECT-PLAN.md` §4](../docs/UNIFIED-PROJECT-PLAN.md)). So it is
`import pinakes_engine.…`, the console script is `pinakes_engine`, and the dist is
`pinakes-engine`.

Two things the rename deliberately did **not** touch:

- **The `cs:` id-space** — a data namespace shared with `contracts/`, `ml/` and the
  client, not a package name. Changing it is a corpus migration, not a move.
- **The Datalog banner `culture-scrape — …`** in `datalog/{prolog,problog,souffle}.py`
  and the parity goldens. It is a byte-for-byte contract with the vendored agora
  `translation_py` engine, whose Rust emitters hard-code that string; it can only
  change when that wheel is rebuilt. `test_translation_parity.py` fails the moment
  the two sides disagree.

Own toolchain, run from this directory:

```bash
uv sync --frozen --all-extras && uv run ruff check . && uv run mypy src && uv run pytest
```

…or, from anywhere in the repo and with no sync step at all:
`uv run --project engine pytest`. That works from a **cold** checkout because
ruff/mypy/pytest — plus the `gui` + `neo4j` extras the suite imports at collection
time — are the `dev` **dependency group** (uv installs default groups
automatically), not an extra (which needs a flag uv run has no reason to guess).
`--all-extras` above is still what adds `graphrag`.

## GOTCHA — the lock and the venv live at the REPO ROOT, not here

pinakes:20 US-4 made the repo root a **virtual uv workspace root**
(`/pyproject.toml`, `[tool.uv.workspace] members = ["engine"]`) so this package
and `services/api`'s `pinakes` can never drift on a shared dependency. Two
consequences:

- **There is no `engine/uv.lock` and no `engine/.venv` any more** — they are
  `/uv.lock` and `/.venv`. The commands above still work verbatim from this
  directory (uv discovers the workspace root by walking up), but `uv lock`
  rewrites the *root* lock, and a stale `engine/.venv` left over from before the
  move is dead weight: delete it, `uv run` will not use it.
- `[tool.uv.sources]` in this file stays **relative to this file**
  (`vendor/…whl`); uv rebases it to `engine/vendor/…whl` in the root lock itself.
  Do not "fix" that path by hand.

`ml/` is deliberately NOT a member (`exclude = ["ml"]`) — it keeps its own
`ml/uv.lock` + `ml/.venv` so torch/pykeen never enter this environment.

## GOTCHA — this package sits ONE level below the repo root

It used to sit two (`packages/culture-scrape/`). Anything that walks up to the
repo root to read a shared contract had to lose exactly one level, and a wrong
count fails *silently* — the file simply "doesn't exist", and a test that guards
`if path.exists()` degrades to a skip instead of a failure. Current, verified:

| from | repo root |
| --- | --- |
| `src/pinakes_engine/<pkg>/x.py` | `Path(__file__).resolve().parents[4]` |
| `tests/x.py` | `Path(__file__).resolve().parents[2]` |
| `scripts/x.py` | `Path(__file__).resolve().parent.parent.parent` |

Walks to the **package** root (`examples.py`, `neo4j/queries.py`
`parents[3]`; the `tests/` `parents[1]`) are depth-independent and did not move.
Relative paths in `categories/*.yml`, `jobs/*.yml` and CLI help resolve against
the **cwd the CLI is invoked from** (this directory), so the live export is
`../build/corpus`, not `../../`.

`core/` → `engine/` was a **same-depth** rename, so not one of these walks changed
— which is why the suite matched its pre-move baseline exactly (1922 passed / 41
skipped). Read the skip count, not just the exit code (below).

If you ever relocate this package again: `git grep -n "parents\[[0-9]\]"` plus
`git grep -n 'parent\.parent'` over `src`/`tests`/`scripts` is the complete list,
and prove each one with `python -c "print(P, P.exists())"` rather than trusting
a green suite — the suite stayed green with the walks broken.

### …and prove it from INSIDE pytest, not just from `python -c`

`python -c` and pytest can disagree about what a test module's constants are.
pytest caches its **assertion-rewritten** bytecode as
`tests/__pycache__/<mod>.cpython-3XX-pytest-<ver>.pyc`, validated against the
source's `(mtime, size)` — and editing `parents[2]` → `parents[3]` changes
neither. So a walk that was edited and reverted within the same second keeps
serving stale bytecode: the source reads `parents[2]`, an interactive import
resolves `parents[2]`, and only pytest still computes `parents[3]`. Combined with
the `if path.exists()` skip guards, that quietly turned 4 of
`test_canonical_schema_parity.py`'s 8 assertions into skips (`1928 passed /
46 skipped` instead of `1932 / 42`) with a green exit code.

The tell is a direct import disagreeing with the test run. Confirm with a throwaway
probe that imports the module *under pytest* and prints the constant, and clear the
cache before trusting any path-related measurement:

```bash
find . -name __pycache__ -type d -not -path './.venv/*' -exec rm -rf {} +
```

`__pycache__` is gitignored and untracked, so this is a local-worktree failure
mode only — CI compiles fresh. But it means **skip-count evidence is only valid
against a cleared cache.**
