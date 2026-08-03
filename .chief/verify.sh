#!/usr/bin/env bash
# .chief/verify.sh — pinakes merge gate. Path-scoped: run only the checks a branch's diff needs,
# and skip a check gracefully if its toolchain isn't installed. Return 0 = allow merge, non-zero = block.
#
# Note: the TypeScript check below is a hard gate (fail on any tsc error). If pinakes `main` ever
# carries a pre-existing tsc baseline, switch this to a baseline-diff (fail only on NEW errors vs
# $CHIEF_BASE_BRANCH) — see insimul/.chief for that pattern.
set -uo pipefail

changed="$(git diff --name-only "$CHIEF_BASE_BRANCH"...HEAD)"
[ -z "$changed" ] && { echo "verify: no diff vs $CHIEF_BASE_BRANCH"; exit 0; }

fail=0
run(){ echo "== $* =="; "$@" || { echo "FAIL: $*"; fail=1; }; }

# This repo's chief program uses bun; fall back to npm.
if command -v bun >/dev/null; then RUN="bun run"; elif command -v npm >/dev/null; then RUN="npm run"; else RUN=""; fi

# TypeScript typecheck when any TS changed
if printf '%s\n' "$changed" | grep -qE '\.tsx?$'; then
  if [ -n "$RUN" ]; then run $RUN check; else echo "skip: no bun/npm for tsc"; fi
fi

# koine registry-mirror drift guard, when the mirror or anything registry-shaped changed.
# The guard reads the AUTHORITATIVE registry out of a sibling koine checkout
# ($KOINE_ROOT, else ~/Development/koine — same resolution as scripts/regen-registry-mirror.ts).
# When that checkout is absent the script exits 1 with "koine source file not found", which is
# indistinguishable from real drift, so probe for it first and skip: a check that cannot run
# produces no signal, and a gate that hard-fails on every machine without koine is a gate
# everyone learns to ignore. Present-but-drifted still fails, which is the case that matters.
if printf '%s\n' "$changed" | grep -qiE 'registry|predicate-mapping|canonical-schema'; then
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
  python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$f" 2>/dev/null || { echo "FAIL: invalid JSON $f"; fail=1; }
done < <(printf '%s\n' "$changed" | grep -E '\.json$' | grep -vE '(^|/)(tests?|__tests__)/.*fixtures?/|(^|/)fixtures?/')

[ "$fail" -eq 0 ] && echo "verify: PASS" || echo "verify: FAIL"
exit $fail
