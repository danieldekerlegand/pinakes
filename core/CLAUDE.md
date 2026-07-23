# core/ — the pinakes data/correlation engine (Python)

First-party pinakes code. It lived at `packages/culture-scrape/` while it was
vendored; pinakes:50 US-3 relocated it here ("into pinakes proper"). The Python
package namespace is **unchanged** and stays `culturescrape` — only the checkout
path moved, so every `import culturescrape.…`, the `culturescrape` console script
and the `cs:` id-space are exactly as before.

Own toolchain, run from this directory:

```bash
uv sync --frozen --all-extras && uv run ruff check . && uv run mypy src && uv run pytest
```

## GOTCHA — this package sits ONE level below the repo root

It used to sit two (`packages/culture-scrape/`). Anything that walks up to the
repo root to read a shared contract had to lose exactly one level, and a wrong
count fails *silently* — the file simply "doesn't exist", and a test that guards
`if path.exists()` degrades to a skip instead of a failure. Current, verified:

| from | repo root |
| --- | --- |
| `src/culturescrape/<pkg>/x.py` | `Path(__file__).resolve().parents[4]` |
| `tests/x.py` | `Path(__file__).resolve().parents[2]` |
| `scripts/x.py` | `Path(__file__).resolve().parent.parent.parent` |

Walks to the **package** root (`examples.py`, `neo4j/queries.py`
`parents[3]`; the `tests/` `parents[1]`) are depth-independent and did not move.
Relative paths in `categories/*.yml`, `jobs/*.yml` and CLI help resolve against
the **cwd the CLI is invoked from** (this directory), so the live export is
`../export/culturescrape`, not `../../`.

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
