#!/usr/bin/env bash
#
# run-all.sh — drive the LinguaScrape PRDs through Ralph sequentially, in dependency
# order. For each PRD it seeds scripts/ralph/prd.json and runs ./ralph.sh (which loops
# fresh agent instances until every story passes or max iterations is hit), then — by
# default — verifies the result and merges the branch into main.
#
# Per-PRD lifecycle:
#   1. Skip if already complete+merged (completed/<name>.json carries mergedToMain).
#   2. Seed prd.json (RESUME=1 → from a partial snapshot; else the template).
#   3. Run ralph.sh.
#   4. Snapshot the passes-state to scripts/ralph/snapshots/<name>.json (gitignored).
#   5. If complete AND AUTO_MERGE_MAIN: run a baselined verification gate (typecheck +
#      tests for the areas the branch changed). If it passes AND the merge is clean,
#      merge into main, write tasks/ralph/completed/<name>.json (with mergedToMain),
#      RETIRE the source template, and delete the branch. The next PRD then branches
#      from the updated main (dependency chaining).
#
# Usage:
#   ./scripts/ralph/run-all.sh                          # all pending, in order
#   ./scripts/ralph/run-all.sh graph-app-integration    # a subset
#   AUTO_MERGE_MAIN=0 ./scripts/ralph/run-all.sh ...     # complete but don't merge
#   RESUME=1 ./scripts/ralph/run-all.sh <name>           # resume a partial run
#
# Env vars:
#   TOOL=claude|amp        AI tool (default: claude)
#   AUTO_MERGE_MAIN=0      disable auto-merge; leave each completed branch for review. Default 1.
#   NO_VERIFY=1            skip the pre-merge verification gate (NOT advised). Default 0.
#   STOP_ON_INCOMPLETE=0   keep going past an incomplete / failed-verify / conflicted PRD. Default 1.
#   RESUME=1               seed from a partial snapshot instead of restarting. Default 0.
#   FORCE=1                skip the clean-tree / on-main precondition check.
#   STRICT_VERIFY=1        fail on any failure instead of only NEW-vs-main failures. Default 0.
#
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$DIR/../.." && pwd)"
SRC="$REPO/tasks/ralph"
COMPLETED="$SRC/completed"     # git-tracked records of merged PRDs
SNAP="$DIR/snapshots"          # gitignored per-PRD runtime snapshots (resume source)
mkdir -p "$COMPLETED" "$SNAP"

TOOL="${TOOL:-claude}"
AUTO_MERGE_MAIN="${AUTO_MERGE_MAIN:-1}"
NO_VERIFY="${NO_VERIFY:-0}"
STOP_ON_INCOMPLETE="${STOP_ON_INCOMPLETE:-1}"
RESUME="${RESUME:-0}"
FORCE="${FORCE:-0}"
STRICT_VERIFY="${STRICT_VERIFY:-0}"

# PRD run order (dependency-aware) and max iterations each (stories + buffer).
# Only PENDING PRDs are listed; merged PRDs are recorded under tasks/ralph/completed/
# (skipped here). Dependencies:
#   - data-layer-convergence (shared schema + LinguaScrape canonical export) is first.
#   - linguascrape-convergence-python (Python ingest/reconcile/Datalog/Neo4j load) needs the export.
#   - graph-app-integration (TS app queries the shared graph) needs the graph loaded.
#   - data-acquisition / narrative-education build on the graph; platform-infra on convergence;
#     speculative (AI insights over the graph) runs last.
ORDER=(
  "data-layer-convergence:12"
  "linguascrape-convergence-python:11"
  "graph-app-integration:15"
  "platform-infra:15"
  "data-acquisition:15"
  "narrative-education:14"
  "speculative:14"
)
ALL_NAMES="data-layer-convergence linguascrape-convergence-python graph-app-integration platform-infra data-acquisition narrative-education speculative"

# Optional positional filter: run only the named PRDs (still in ORDER order).
if [ "$#" -gt 0 ]; then
  WANTED=" $* "
  FILTERED=()
  for e in "${ORDER[@]}"; do
    [[ "$WANTED" == *" ${e%%:*} "* ]] && FILTERED+=("$e")
  done
  ORDER=("${FILTERED[@]}")
  if [ "${#ORDER[@]}" -eq 0 ]; then
    echo "No matching PRDs. Valid names: $ALL_NAMES" >&2; exit 2
  fi
fi

# Precondition: clean tree, on main (Ralph branches each PRD from main).
if [ "$FORCE" != "1" ]; then
  cur="$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  if [ -n "$(git -C "$REPO" status --porcelain --untracked-files=no)" ]; then
    echo "ERROR: uncommitted tracked changes — commit/stash first, or re-run with FORCE=1." >&2
    git -C "$REPO" status --short | head; exit 1
  fi
  [ "$cur" = "main" ] || { echo "ERROR: not on 'main' (on '$cur'). Run: git checkout main (or FORCE=1)." >&2; exit 1; }
fi
command -v jq >/dev/null || { echo "ERROR: jq is required (brew/apt install jq)."; exit 1; }

# ----------------------------------------------------------------------------
# BASELINED verification gate: a completed branch is judged against MAIN. A check
# fails ONLY if it introduces a failure not already present on main (so a finished
# branch is never parked for pre-existing breakage it didn't cause). Mechanism: run
# the check on the branch; if it has failures, briefly check out main, run the SAME
# check, and fail only on the set difference. STRICT_VERIFY=1 disables baselining.
# ----------------------------------------------------------------------------
# Normalizers: a tool's output -> a stable, sorted set of failure signatures.
_norm_tsc()    { grep -E ': error TS[0-9]+' | sed -E 's/\([0-9]+,[0-9]+\)//' | sort -u; }
_norm_vitest() { grep -E '^[[:space:]]*FAIL[[:space:]]' | sed -E 's/^[[:space:]]*FAIL[[:space:]]+//' | sort -u; }
_norm_pytest() { grep -E '^(FAILED|ERROR) ' | sed -E 's/ - .*$//' | sort -u; }
_norm_mypy()   { grep -E ': error:' | sed -E 's/:[0-9]+:([0-9]+:)? error:/: error:/' | sort -u; }
_norm_ruff()   { grep -E '^[^[:space:]]+:[0-9]+:[0-9]+:' | sed -E 's/:[0-9]+:[0-9]+:/:/' | sort -u; }

_new_failures() { comm -23 <(printf '%s\n' "$1") <(printf '%s\n' "$2"); }

# Gate a non-vitest check. $1=label $2=cmd (eval'd) $3=normalizer fn.
gated_check() {
  local label="$1" cmd="$2" norm="$3"
  local bf; bf="$( ( eval "$cmd" ) 2>&1 | "$norm" )"
  [ -z "$bf" ] && { echo "  verify: $label ✓"; return 0; }
  if [ "$STRICT_VERIFY" = 1 ]; then echo "  ✗ $label (strict):"; printf '      %s\n' "$bf"; return 1; fi
  local cur; cur="$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
  git -C "$REPO" checkout main >/dev/null 2>&1 || { echo "  ✗ $label (couldn't baseline vs main)"; return 1; }
  local mf; mf="$( ( eval "$cmd" ) 2>&1 | "$norm" )"
  git -C "$REPO" checkout "$cur" >/dev/null 2>&1
  local new; new="$(_new_failures "$bf" "$mf")"
  [ -z "$new" ] && { echo "  verify: $label — all failures pre-existing on main (ignored) ✓"; return 0; }
  echo "  ✗ $label — NEW vs main:"; printf '      %s\n' "$new"; return 1
}

# Run vitest, retrying on a crash (no Tests summary line).
_vitest_out() {
  local out=""
  for _try in 1 2 3; do
    # NO_COLOR so vitest's summary line isn't wrapped in ANSI codes (v4 colors even when its
    # output is captured, not a TTY); strip any residual escapes so the summary regex matches.
    out="$( cd "$REPO" && NO_COLOR=1 FORCE_COLOR=0 npx vitest run "$@" 2>&1 | perl -pe 's/\e\[[0-9;]*m//g' )"
    printf '%s\n' "$out" | grep -qE 'Tests[[:space:]]+[0-9]+ (passed|failed)' && break
    echo "    (vitest: no summary — retry $_try/3)" >&2
  done
  printf '%s' "$out"
}

# Gate a vitest run with crash-awareness + baselining. $1=label, rest=vitest args.
gated_vitest() {
  local label="$1"; shift
  local out; out="$(_vitest_out "$@")"
  local bf passed
  bf="$(printf '%s\n' "$out" | _norm_vitest)"
  passed="$(printf '%s\n' "$out" | grep -qE 'Tests[[:space:]]+[0-9]+ passed' && echo y)"
  [ -z "$bf" ] && [ -n "$passed" ] && { echo "  verify: $label ✓"; return 0; }
  [ -z "$bf" ] && [ -z "$passed" ] && { echo "  ✗ $label (vitest crashed — no summary after 3 tries)"; return 1; }
  if [ "$STRICT_VERIFY" = 1 ]; then echo "  ✗ $label (strict):"; printf '      %s\n' "$bf"; return 1; fi
  local cur; cur="$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
  git -C "$REPO" checkout main >/dev/null 2>&1 || { echo "  ✗ $label (couldn't baseline vs main)"; return 1; }
  local mf; mf="$(_vitest_out "$@" | _norm_vitest )"
  git -C "$REPO" checkout "$cur" >/dev/null 2>&1
  local new; new="$(_new_failures "$bf" "$mf")"
  [ -z "$new" ] && { echo "  verify: $label — failures all pre-existing on main (ignored) ✓"; return 0; }
  echo "  ✗ $label — NEW failing tests vs main:"; printf '      %s\n' "$new"; return 1
}

# --- Verification gate: baselined checks for the areas the branch changed (cwd = feature branch). ---
verify_branch() {
  local files; files="$(git -C "$REPO" diff --name-only main...HEAD)"
  [ -z "$files" ] && { echo "  verify: no diff vs main"; return 0; }
  # Web app (TypeScript): typecheck the project if any TS changed; run changed vitest specs.
  if echo "$files" | grep -qE '^(client|server|shared|scripts)/.*\.(ts|tsx)$'; then
    gated_check "typecheck (tsc)" 'cd "$REPO" && npx tsc --noEmit' _norm_tsc || return 1
  fi
  local tst; tst="$(echo "$files" | grep -E '^(client|server|shared|scripts|test)/.*\.test\.ts$')"
  if [ -n "$tst" ]; then
    # shellcheck disable=SC2086
    gated_vitest "changed tests" $tst || return 1
  fi
  # culture-scrape sidecar (Python, uv-managed .venv — `python` isn't on PATH here): mypy + pytest + ruff.
  if echo "$files" | grep -q '^packages/culture-scrape/'; then
    gated_check "mypy" 'cd "$REPO/packages/culture-scrape" && uv run --no-sync mypy src' _norm_mypy || return 1
    gated_check "pytest" 'cd "$REPO/packages/culture-scrape" && uv run --no-sync pytest -q' _norm_pytest || return 1
    gated_check "ruff" 'cd "$REPO/packages/culture-scrape" && uv run --no-sync ruff check .' _norm_ruff || return 1
  fi
  return 0
}

# --- Finalize a merged PRD: stamp record, retire template, delete branch (cwd = main). ---
finalize_merged() {
  local name="$1" branch="$2" sha="$3" src="$SNAP/$name.json" rec="$COMPLETED/$name.json"
  [ -f "$src" ] || src="$SRC/$name.json"
  node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('$src','utf8'));j.userStories.forEach(s=>s.passes=true);j.mergedToMain='$sha';fs.writeFileSync('$rec',JSON.stringify(j,null,2)+'\n');"
  git -C "$REPO" rm -q --ignore-unmatch "tasks/ralph/$name.json"
  git -C "$REPO" add "tasks/ralph/completed/$name.json"
  git -C "$REPO" commit -q -m "chore(ralph): $name complete @$sha — record + retire template

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  git -C "$REPO" branch -d "$branch" >/dev/null 2>&1 || true
}

echo "Ralph multi-PRD run — tool=$TOOL  auto-merge=$AUTO_MERGE_MAIN  verify=$([ "$NO_VERIFY" = 1 ] && echo off || echo on)  stop-on-incomplete=$STOP_ON_INCOMPLETE"
echo "PRDs: $(printf '%s ' "${ORDER[@]%%:*}")"; echo

SUMMARY=()
for entry in "${ORDER[@]}"; do
  name="${entry%%:*}"; iters="${entry##*:}"
  json="$SRC/$name.json"; rec="$COMPLETED/$name.json"; snap="$SNAP/$name.json"
  echo "==================================================================="
  echo "  PRD: $name"
  echo "==================================================================="

  if [ -f "$rec" ] && [ -n "$(jq -r '.mergedToMain // empty' "$rec" 2>/dev/null)" ]; then
    echo "  ✓ already complete (merged @$(jq -r .mergedToMain "$rec")) — skipping"
    SUMMARY+=("$name: DONE @$(jq -r .mergedToMain "$rec")"); echo; continue
  fi
  if [ ! -f "$json" ]; then
    echo "  SKIP: no template tasks/ralph/$name.json and no merged record"
    SUMMARY+=("$name: MISSING"); echo; continue
  fi

  branch="$(jq -r '.branchName' "$json")"
  echo "  branch: $branch   max-iters: $iters"

  seed="$json"
  if [ "$RESUME" = "1" ] && [ -f "$snap" ] \
     && [ "$(jq '[.userStories[]|select(.passes)]|length' "$snap" 2>/dev/null || echo 0)" -gt 0 ] \
     && [ "$(jq '[.userStories[]|select(.passes==false)]|length' "$snap" 2>/dev/null || echo 1)" -gt 0 ]; then
    seed="$snap"; echo "  RESUME: seeding from $seed"
  fi
  cp "$seed" "$DIR/prd.json"
  echo "$branch" > "$DIR/.last-branch"
  { echo "# Ralph Progress Log — $name"; echo "Started: $(date)"; echo "---"; } > "$DIR/progress.txt"

  "$DIR/ralph.sh" --tool "$TOOL" "$iters" || true   # don't abort the chain on non-zero exit

  remaining="$(jq '[.userStories[]|select(.passes==false)]|length' "$DIR/prd.json" 2>/dev/null || echo '?')"
  total="$(jq '.userStories|length' "$DIR/prd.json" 2>/dev/null || echo '?')"
  done_n=$(( total - remaining )) 2>/dev/null || done_n='?'
  cp "$DIR/prd.json" "$snap"
  cp "$DIR/progress.txt" "$SNAP/$name.progress.txt" 2>/dev/null || true
  echo "  snapshot -> scripts/ralph/snapshots/$name.json ($done_n/$total)"

  if [ "$remaining" != "0" ]; then
    echo "!! $name INCOMPLETE ($done_n/$total; $remaining failing) on $branch"
    SUMMARY+=("$name: INCOMPLETE $done_n/$total ($branch)")
    [ "$STOP_ON_INCOMPLETE" = "1" ] && { echo "!! stopping (STOP_ON_INCOMPLETE=1)."; break; }
    echo; continue
  fi

  echo ">> $name COMPLETE ($done_n/$total) on $branch"
  if [ "$AUTO_MERGE_MAIN" != "1" ]; then
    SUMMARY+=("$name: COMPLETE unmerged ($branch)"); echo; continue
  fi

  if [ "$NO_VERIFY" != "1" ]; then
    echo ">> verifying $branch before merge"
    if ! verify_branch; then
      echo "!! verification FAILED — leaving $branch unmerged for review."
      SUMMARY+=("$name: VERIFY-FAILED ($branch)")
      [ "$STOP_ON_INCOMPLETE" = "1" ] && { echo "!! stopping."; break; }
      echo; continue
    fi
  fi

  echo ">> merging $branch into main"
  git -C "$REPO" checkout main >/dev/null 2>&1
  if git -C "$REPO" merge --no-ff "$branch" -m "Merge $branch (ralph, auto-verified)"; then
    sha="$(git -C "$REPO" rev-parse --short HEAD)"
    finalize_merged "$name" "$branch" "$sha"
    echo ">> $name MERGED @$sha — template retired, branch deleted"
    SUMMARY+=("$name: MERGED @$sha")
  else
    git -C "$REPO" merge --abort 2>/dev/null || true
    git -C "$REPO" checkout "$branch" >/dev/null 2>&1 || true
    echo "!! merge conflict — aborted; $branch left for manual merge."
    SUMMARY+=("$name: MERGE-CONFLICT ($branch)")
    [ "$STOP_ON_INCOMPLETE" = "1" ] && { echo "!! stopping."; break; }
  fi
  echo
done

echo "==================================================================="
echo "  Run summary"
printf '   - %s\n' "${SUMMARY[@]}"
echo "==================================================================="
