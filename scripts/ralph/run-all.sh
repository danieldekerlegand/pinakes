#!/usr/bin/env bash
#
# run-all.sh — drive the pinakes PRDs through Ralph sequentially, in dependency
# order. For each PRD it seeds scripts/ralph/prd.json and runs ./ralph.sh (which loops
# fresh agent instances until every story passes or max iterations is hit), then — by
# default — verifies the result and merges the branch into main.
#
# Per-PRD lifecycle:
#   1. Skip if already complete+merged (completed/<name>.json carries mergedToMain).
#   2. Seed prd.json (auto-resume from a partial snapshot if one exists; RESUME=0 → template).
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
#   ./scripts/ralph/run-all.sh <name>                    # auto-resumes a partial run
#   RESUME=0 ./scripts/ralph/run-all.sh <name>           # force a fresh restart instead
#
# Env vars:
#   TOOL=claude|amp        AI tool (default: claude)
#   AUTO_MERGE_MAIN=0      disable auto-merge; leave each completed branch for review. Default 1.
#   NO_VERIFY=1            skip the pre-merge verification gate (NOT advised). Default 0.
#   STOP_ON_INCOMPLETE=0   keep going past an incomplete / failed-verify / conflicted PRD. Default 1.
#   RESUME=0               force a FRESH restart of a partial PRD (default is auto-resume
#                          from the partial snapshot if one exists).
#   FORCE=1                skip the clean-tree / on-main precondition check.
#   STRICT_VERIFY=1        fail on any failure instead of only NEW-vs-main failures. Default 0.
#   AUTO_RECOVER=0         disable auto-recovery of a stranded ralph/* branch. Default 1
#                          (preserve any WIP as a commit on that branch, then switch to main).
#
# Per-PRD loop knobs (environment, passed through to ralph.sh — see there for detail):
#   STALL_LIMIT / HARD_MAX / RATE_LIMIT_RETRY / RATE_LIMIT_WAIT / RATE_LIMIT_MAX_WAITS
#   MAX_ITERATIONS is now a SOFT budget: ralph.sh extends past it while a PRD keeps
#   making progress (a story passes or a commit lands), and on a session/usage limit
#   it sleeps until reset and resumes the same story instead of aborting.
#
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$DIR/../.." && pwd)"
SRC="$REPO/tasks/ralph"
COMPLETED="$SRC/completed"     # git-tracked records of merged PRDs
SNAP="$DIR/snapshots"          # gitignored per-PRD runtime snapshots (resume source)
mkdir -p "$COMPLETED" "$SNAP"

# Single-driver lock. Two git drivers on one repo (a second run-all, OR an interactive
# agent doing checkouts/commits) share .git/HEAD and the working tree and WILL corrupt each
# other's commits/branches. Refuse to start if a lock is already held.
LOCK="$DIR/.run-all.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "ERROR: another Ralph driver appears to be active (lock: $LOCK)." >&2
  echo "       Never run two drivers on one repo. If you are certain none is running:" >&2
  echo "         rmdir '$LOCK'" >&2
  exit 1
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

TOOL="${TOOL:-claude}"
AUTO_MERGE_MAIN="${AUTO_MERGE_MAIN:-1}"
NO_VERIFY="${NO_VERIFY:-0}"
STOP_ON_INCOMPLETE="${STOP_ON_INCOMPLETE:-1}"
RESUME="${RESUME:-1}"   # auto-resume partial PRDs by default; RESUME=0 forces a fresh restart
FORCE="${FORCE:-0}"
STRICT_VERIFY="${STRICT_VERIFY:-0}"

# PRD run order (dependency-aware) and max iterations each (stories + buffer).
# Only PENDING PRDs are listed; merged PRDs are recorded under tasks/ralph/completed/
# (skipped automatically even if listed here).
#
# Roadmap Phases 7-15 (incl. security-hardening, data-population-pilot, data-population)
# are complete (see tasks/ralph/completed/ and docs/prd-pinakes-deep-history-roadmap.md).
# These are the neurosymbolic-roadmap PRDs, in dependency order:
#   - symbolic-engine-truth:      Phase 0 — real engines in CI/sidecar, rel_conf confidence fix,
#                                 provenance propagation, QID-anchored csids, id burndown.
#   - scale-ready-conversion:     Phase 1 — temporal edges become rules (kills the O(n^2) blowup),
#                                 streaming emitters, schema v1.1 (edge citations + SPDX license).
#   - first-ml-loop:              Phase 2 — ml/ workspace + DVC/MLflow, triples + splits, PyKEEN
#                                 baselines, ProbLog emitter, logical-consistency CI ratchet.
#   - wikidata-dump-slice:        Phase 3a — real dump slice, SQLite index, blueprint builds,
#                                 richer hydration, incremental updates, scale report.
#                                 OPERATOR: US-001 needs provisioned disk/bandwidth (see PRD).
#   - tiered-trust-corpus:        Phase 3b — confidence rubric, auto-admission graph corpus
#                                 (never writes lexicons/), QID backfill, tier surfacing.
#   - source-breadth-cldf:        Phase 4a — Glottolog/WALS/PHOIBLE/Lexibank/kaikki ingestion,
#                                 license-partitioned packaging.
#   - rules-layer:                Phase 4b — P279 taxonomy, P2302 property constraints, schema
#                                 constraints as violation rules, rules registry, YAGO eval.
#   - graphrag-and-training-data: Phase 5a — vector index + hybrid retrieval, verbalization +
#                                 KGQA dataset generators, KGQA eval, QLoRA pipeline + runbook.
#   - scallop-pilot:              Phase 5b — Scallop rule-guided link prediction, DeepProbLog
#                                 feasibility comparison + go/no-go.
ORDER=(
  "symbolic-engine-truth:13"
  "scale-ready-conversion:9"
  "first-ml-loop:9"
  "wikidata-dump-slice:11"
  "tiered-trust-corpus:8"
  "source-breadth-cldf:9"
  "rules-layer:9"
  "graphrag-and-training-data:9"
  "scallop-pilot:8"
# --- Cross-project bridge (the Insimul bridge spec) — UNCOMMENT once its deps have merged:
#     US-001 anytime; US-002 needs scale-ready-conversion; US-003 needs tiered-trust-corpus;
#     US-004/005 need first-ml-loop. Coordinate with the Insimul-side counterpart
#     (~/Development/workspace/tasks/ralph/pinakes-bridge.json).
  "insimul-bridge:9"         # predicate-mapping registry + grounding-pack exporter + insimul adapter (schema v1.2, synthetic tier) + VESPACE adherence tier + dataset generators
# --- SLM pilot (the Insimul bridge spec Phase D) — PROVISIONAL; re-ground before running.
#     Needs first-ml-loop + insimul-bridge (US-004/005) merged; US-003 may need rented GPU
#     (operator); baseline model Qwen2.5-3B-Instruct (matches Insimul's local-AI deployment).
#  "slm-pilot:10"            # frozen eval protocol + QLoRA pipeline + 3B baseline fine-tune + GGUF parity + Insimul handoff + go/no-go report
# --- The Analyzer bridge + its edit-ops SLM pilot used to be scheduled here. Both were
#     excised from pinakes (they train on Analyzer exhaust, not cultural knowledge) and
#     re-homed to Analyzer itself; they are no longer pinakes PRDs.
)
ALL_NAMES="symbolic-engine-truth insimul-bridge slm-pilot scale-ready-conversion first-ml-loop wikidata-dump-slice tiered-trust-corpus source-breadth-cldf rules-layer graphrag-and-training-data scallop-pilot"

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
# A run killed mid-ralph (SIGKILL, crash) can strand the repo on a ralph/* branch,
# often with WIP. AUTO_RECOVER (default on) PRESERVES that WIP as a commit on its
# branch and switches back to main, so a plain re-run resumes instead of erroring.
AUTO_RECOVER="${AUTO_RECOVER:-1}"
if [ "$FORCE" != "1" ]; then
  cur="$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  if [ "$AUTO_RECOVER" = "1" ] && printf '%s' "$cur" | grep -q '^ralph/'; then
    if [ -n "$(git -C "$REPO" status --porcelain)" ]; then
      git -C "$REPO" add -A \
        && git -C "$REPO" commit -q -m "wip: auto-preserved by run-all before restart (was on $cur)" \
        && echo "  ↻ auto-preserved uncommitted WIP as a commit on $cur"
    fi
    git -C "$REPO" checkout main >/dev/null 2>&1 && { cur=main; echo "  ↻ switched back to main"; }
  fi
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
  if echo "$files" | grep -q '^core/'; then
    gated_check "mypy" 'cd "$REPO/core" && uv run --no-sync mypy src' _norm_mypy || return 1
    gated_check "pytest" 'cd "$REPO/core" && uv run --no-sync pytest -q' _norm_pytest || return 1
    gated_check "ruff" 'cd "$REPO/core" && uv run --no-sync ruff check .' _norm_ruff || return 1
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
  if [ "$RESUME" != "0" ] && [ -f "$snap" ] \
     && [ "$(jq '[.userStories[]|select(.passes)]|length' "$snap" 2>/dev/null || echo 0)" -gt 0 ] \
     && [ "$(jq '[.userStories[]|select(.passes==false)]|length' "$snap" 2>/dev/null || echo 1)" -gt 0 ]; then
    seed="$snap"; echo "  resuming from snapshot: $seed"
  fi
  cp "$seed" "$DIR/prd.json"
  echo "$branch" > "$DIR/.last-branch"
  { echo "# Ralph Progress Log — $name"; echo "Started: $(date)"; echo "---"; } > "$DIR/progress.txt"

  "$DIR/ralph.sh" --tool "$TOOL" "$iters" || true   # don't abort the chain on non-zero exit

  # A session-limit stop can interrupt a story mid-edit, leaving uncommitted tracked changes
  # that would block the NEXT run's clean-tree precondition. Checkpoint them on the branch so a
  # plain re-run just works; the resuming agent finishes that story on top of the checkpoint.
  # (scripts/ralph/{prd.json,progress.txt,...} are gitignored, so `git add -A` never stages them.)
  if [ -n "$(git -C "$REPO" status --porcelain)" ]; then
    git -C "$REPO" add -A
    git -C "$REPO" commit -q -m "wip($name): checkpoint interrupted work" || true
    echo "  checkpointed uncommitted work on $branch"
  fi

  remaining="$(jq '[.userStories[]|select(.passes==false)]|length' "$DIR/prd.json" 2>/dev/null || echo '?')"
  total="$(jq '.userStories|length' "$DIR/prd.json" 2>/dev/null || echo '?')"
  done_n=$(( total - remaining )) 2>/dev/null || done_n='?'
  cp "$DIR/prd.json" "$snap"
  cp "$DIR/progress.txt" "$SNAP/$name.progress.txt" 2>/dev/null || true
  echo "  snapshot -> scripts/ralph/snapshots/$name.json ($done_n/$total)"

  if [ "$remaining" != "0" ]; then
    echo "!! $name INCOMPLETE ($done_n/$total; $remaining failing) on $branch"
    SUMMARY+=("$name: INCOMPLETE $done_n/$total ($branch)")
    # Return to main (the branch's progress is committed/checkpointed) so the next plain
    # `run-all.sh` passes its on-main precondition and auto-resumes this PRD from its snapshot.
    git -C "$REPO" checkout main >/dev/null 2>&1 || true
    [ "$STOP_ON_INCOMPLETE" = "1" ] && { echo "!! stopping (STOP_ON_INCOMPLETE=1). Re-run ./scripts/ralph/run-all.sh to resume."; break; }
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
