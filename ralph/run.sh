#!/usr/bin/env bash
# Run the LinguaScrape Ralph tasklists with ralphy (michaelshimeles/ralphy).
#
# Each tasklist is a ralphy JSON task file (tasks.json) living in its own numbered
# directory. They run in dependency order on the current branch, so each builds on
# the code produced by the previous one. A companion prd.json holds the human-readable
# spec (story ids, acceptance criteria, priorities); ralphy does not read it.
#
# Numbering continues from the archived Ralphy batches 9-12 (see docs/archive/ralphy/)
# to avoid collisions.
#
# Usage:
#   ./ralph/run.sh                 # run all present tasklists in order
#   ./ralph/run.sh 15              # run only tasklist 15
#   ./ralph/run.sh 15 16           # run tasklists 15 and 16
#   FAST=1 ./ralph/run.sh 15       # pass --fast (skip tests+lint)
#
# Prerequisites: ralphy on PATH, an authenticated Claude Code, and git.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# All planned tasklists, in dependency order. A tasklist with no tasks.json yet is
# skipped (not an error) so this list can be populated incrementally.
TASKLISTS=(
  "15-data-layer-convergence"
  "16-graph-app-integration"
  "17-data-acquisition"
  "18-narrative-education"
  "19-platform-infra"
  "20-speculative"
)

# Map a tasklist directory name to its leading number (e.g. "15-foo" -> 15).
num_of() { echo "${1%%-*}"; }

command -v ralphy >/dev/null 2>&1 || { echo "error: 'ralphy' not found on PATH"; exit 1; }

if [ ! -d .git ]; then
  echo "error: not a git repository (ralphy commits after each task)"; exit 1
fi

# Select tasklists by their leading number. No args = all present ones.
if [ "$#" -eq 0 ]; then
  SELECTED=("${TASKLISTS[@]}")
else
  SELECTED=()
  for want in "$@"; do
    match=""
    for dir in "${TASKLISTS[@]}"; do
      [ "$(num_of "$dir")" = "$want" ] && match="$dir" && break
    done
    [ -n "$match" ] || { echo "error: no tasklist numbered '$want'"; exit 1; }
    SELECTED+=("$match")
  done
fi

# Scalar (not an array): macOS bash 3.2 errors on empty-array expansion under `set -u`.
EXTRA_FLAGS=""
[ "${FAST:-0}" = "1" ] && EXTRA_FLAGS="--fast"

# Returns 0 only if every task in the given ralphy file is completed.
all_complete() {
  python3 - "$1" <<'PY'
import json, sys
tasks = json.load(open(sys.argv[1])).get("tasks", [])
incomplete = [t["title"] for t in tasks if not t.get("completed")]
if incomplete:
    print(f"  {len(incomplete)} of {len(tasks)} task(s) still incomplete:")
    for t in incomplete:
        print(f"    - {t}")
    sys.exit(1)
print(f"  all {len(tasks)} task(s) complete")
PY
}

total=${#SELECTED[@]}
n=0
for dir in "${SELECTED[@]}"; do
  n=$((n + 1))
  file="ralph/$dir/tasks.json"
  if [ ! -f "$file" ]; then
    echo "Skipping $dir (no tasks.json authored yet)."
    continue
  fi
  echo ""
  echo "==============================================================="
  echo "  [$n/$total] ralphy: $dir"
  echo "  file: $file"
  echo "==============================================================="

  ralphy --json "$file" --claude --max-retries 3 $EXTRA_FLAGS

  echo "Checking completion of $dir ..."
  if ! all_complete "$file"; then
    echo ""
    echo "Stopping: '$dir' did not finish. Fix/resume it, then re-run:"
    echo "    ./ralph/run.sh $(num_of "$dir")"
    echo "(completed tasks are skipped on re-run, so it picks up where it left off)"
    exit 1
  fi
done

echo ""
echo "All present selected tasklist(s) completed in order."
