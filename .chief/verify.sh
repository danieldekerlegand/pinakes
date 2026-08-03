#!/usr/bin/env bash
# .chief/verify.sh — pinakes merge gate. Path-scoped: run only the checks a branch's diff needs,
# and skip a check gracefully if its toolchain isn't installed. Return 0 = allow merge, non-zero = block.
#
# The repo holds two halves that are being merged into one (docs/UNIFIED-PROJECT-PLAN.md §5/§7):
# the TypeScript client + legacy Express server, and the Python engine + `services/api` FastAPI
# service that is replacing it. `contracts/parity/` is the contract between them, so a change to
# the parity spec is a change to BOTH sides and triggers both suites.
#
# Everything here is read-only and cheap (whole gate ≈ 20s warm), so the scoping is about signal,
# not runtime — a failure names the half that broke.
#
# Note: the TypeScript check below is a hard gate (fail on any tsc error). If pinakes `main` ever
# carries a pre-existing tsc baseline, switch this to a baseline-diff (fail only on NEW errors vs
# $CHIEF_BASE_BRANCH) — see insimul/.chief for that pattern.
set -uo pipefail

# Default so the gate is runnable by hand (`.chief/verify.sh`) exactly as the driver runs it.
base="${CHIEF_BASE_BRANCH:-main}"
changed="$(git diff --name-only "$base"...HEAD)"
[ -z "$changed" ] && { echo "verify: no diff vs $base"; exit 0; }

fail=0
# CHIEF_VERIFY_DRY_RUN=1 prints the plan without executing it — so you can check what a given
# diff actually selects (`CHIEF_VERIFY_DRY_RUN=1 CHIEF_BASE_BRANCH=<sha> .chief/verify.sh`)
# without paying for the run. Scoping you can't inspect is scoping nobody trusts.
dry="${CHIEF_VERIFY_DRY_RUN:-}"
run(){ echo "== $* =="; [ -n "$dry" ] && return 0; "$@" || { echo "FAIL: $*"; fail=1; }; }
# touched <extended-regex> — did the diff touch a matching path?
touched(){ printf '%s\n' "$changed" | grep -qE "$1"; }

# The language-neutral contract sources (contracts/*.json, NOT contracts/parity/*.json) and the
# bindings scripts/gen-contract-bindings.ts emits from them. Both halves of the stack consume the
# generated side, so this set selects the drift gate AND both languages' suites below.
CONTRACT_SRC_RE='^contracts/[^/]+\.json$'
CONTRACT_GEN_RE="$CONTRACT_SRC_RE|^contracts/generated/|^contracts/python/|^scripts/gen-contract-bindings\.ts$"

# This repo's chief program uses bun; fall back to npm. npm needs `--` before script args.
if command -v bun >/dev/null; then RUN="bun run"; ARGSEP=""
elif command -v npm >/dev/null; then RUN="npm run"; ARGSEP="--"
else RUN=""; ARGSEP=""; fi

# ---------------------------------------------------------------- TypeScript / client half

# `bun run check` is `tsc -p web/tsconfig.json`, which covers web/ + contracts/ + server/.
# scripts/ has its OWN tsconfig and is NOT in that project — typecheck it separately, or a
# broken generator (scripts/gen-parity-spec.ts) sails through.
if touched '\.tsx?$'; then
  if [ -n "$RUN" ]; then
    run $RUN check
    touched '^scripts/' && run $RUN check:scripts
  else
    echo "skip: no bun/npm for tsc"
  fi
fi

# Vitest. Any TS change runs the whole suite (~11s) — it subsumes the parity tests. A change to
# the parity spec/fixtures alone ships no TS but still invalidates the recorded baseline, so run
# contracts/parity on its own in that case.
vitest_scope=""
if touched '\.tsx?$'; then vitest_scope="all"
# A neutral contract source edited WITHOUT regenerating ships no TS at all, yet it is exactly the
# case the contract tests (and the drift gate below) exist to catch — run the whole suite.
elif touched "$CONTRACT_SRC_RE"; then vitest_scope="all"
elif touched '^contracts/parity/'; then vitest_scope="contracts/parity"; fi
if [ -n "$vitest_scope" ]; then
  if [ -z "$RUN" ]; then echo "skip: no bun/npm for vitest"
  elif [ "$vitest_scope" = "all" ]; then run $RUN test
  else run $RUN test $ARGSEP "$vitest_scope"; fi
fi

# ---------------------------------------------------------------- Python half

# `uv run --all-packages` syncs the root workspace venv itself, so there is no separate sync step.
# It must be --all-packages, not --project <member>: the root pytest.ini's testpaths span BOTH
# suites regardless of which project is selected, so a single-project env dies collecting the
# other one on a cold checkout. Scope a run with a path argument instead.
PY_ROOT_CONFIG='^(pyproject\.toml|uv\.lock|pytest\.ini)$'
# `pinakes-contracts` (contracts/python/) is a workspace dependency of BOTH Python members, and its
# modules are generated from contracts/*.json — a source edit is a Python source edit, imported at
# module scope by pinakes_engine.schema.headers / .confidence. So both suites run for either.
PY_CONTRACTS="$CONTRACT_SRC_RE|^contracts/python/"
py_engine=0; py_api=0
touched "^engine/|$PY_CONTRACTS|$PY_ROOT_CONFIG" && py_engine=1
# contracts/parity/openapi.json IS the service's 501 catalog — it changes what the app registers.
touched "^services/api/|^contracts/parity/|$PY_CONTRACTS|$PY_ROOT_CONFIG" && py_api=1

if [ "$py_engine" -eq 1 ] || [ "$py_api" -eq 1 ]; then
  if ! command -v uv >/dev/null; then
    echo "skip: no uv for Python suites"
  else
    PYTEST=(uv run --all-packages pytest -q -p no:cacheprovider)
    # -p no:cacheprovider: keep the gate from writing .pytest_cache into a clean worktree.
    [ "$py_engine" -eq 1 ] && run "${PYTEST[@]}" engine/tests
    if [ "$py_api" -eq 1 ]; then
      run "${PYTEST[@]}" services/api/tests
      run uv run --all-packages ruff check services/api
      # mypy resolves its `files =` against cwd, not the config file, so point uv at the member
      # directory (`--directory`, not `--project`) or it dies with "Missing target module".
      run uv run --directory services/api --all-packages mypy
    fi
  fi
fi

# ---------------------------------------------------------------- Cross-cutting

# Contract-bindings drift guard (40-contracts-codegen US-2). `contracts/*.json` is the
# language-neutral source of truth and BOTH languages consume generated bindings, so a source
# edited without `npm run gen:contracts` — or a hand-edited generated file — must block the merge.
# Unlike the registry mirror below this needs no sibling checkout: everything it compares is in
# this tree, so it never skips and is a hard gate. Read-only (`--check` writes nothing).
if touched "$CONTRACT_GEN_RE"; then
  if [ -z "$RUN" ]; then echo "skip: contract bindings (no runner)"
  else run $RUN check:contracts; fi
fi

# koine registry-mirror drift guard, when the mirror or anything registry-shaped changed.
# The guard reads the AUTHORITATIVE registry out of a sibling koine checkout
# ($KOINE_ROOT, else ~/Development/koine — same resolution as scripts/regen-registry-mirror.ts).
# When that checkout is absent the script exits 1 with "koine source file not found", which is
# indistinguishable from real drift, so probe for it first and skip: a check that cannot run
# produces no signal, and a gate that hard-fails on every machine without koine is a gate
# everyone learns to ignore. Present-but-drifted still fails, which is the case that matters.
if touched 'registry|predicate-mapping|canonical-schema'; then
  koine_src="${KOINE_ROOT:-$HOME/Development/koine}/registry/predicate-mapping.json"
  if [ -z "$RUN" ]; then echo "skip: registry-mirror (no runner)"
  elif [ ! -f "$koine_src" ]; then echo "skip: registry-mirror (no koine checkout at $koine_src — set KOINE_ROOT)"
  else run $RUN check:registry-mirror; fi
fi

# JSON config/data must parse. Test fixtures are exempt: some are malformed ON PURPOSE
# (engine/tests/fixtures/wikidata/sample-dump.json carries a truncated line to exercise the
# dump reader's bad-record path), and a *moved* fixture would otherwise fail this gate on
# content that never changed.
while IFS= read -r f; do
  [ -f "$f" ] || continue
  echo "== json parse $f =="
  [ -n "$dry" ] && continue
  python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$f" 2>/dev/null || { echo "FAIL: invalid JSON $f"; fail=1; }
done < <(printf '%s\n' "$changed" | grep -E '\.json$' | grep -vE '(^|/)(tests?|__tests__)/.*fixtures?/|(^|/)fixtures?/')

[ "$fail" -eq 0 ] && echo "verify: PASS" || echo "verify: FAIL"
exit $fail
