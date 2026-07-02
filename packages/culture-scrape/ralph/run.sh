#!/usr/bin/env bash
# Run the culture-scrape tasklists with ralphy (michaelshimeles/ralphy).
#
# Each tasklist is a ralphy JSON task file (tasks.json). They run in dependency
# order on the current branch, so each builds on the code produced by the previous.
#
# Usage:
#   ./ralph/run.sh                 # run all tasklists in order
#   ./ralph/run.sh 1               # run only tasklist 1
#   ./ralph/run.sh 3 4             # run tasklists 3 and 4
#   FAST=1 ./ralph/run.sh 1        # pass --fast (skip tests+lint) — useful for the very first run
#
# Prerequisites: ralphy on PATH, an authenticated Claude Code, and git.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Tasklists in dependency order.
TASKLISTS=(
  "01-acquisition"
  "02-schema-entity-resolution"
  "03-ontology-linking"
  "04-neo4j-converter"
  "05-datalog-exporter"
  "06-orchestration-seedcorpus"
  "07-gui-explorer"
  "08-corpus-expansion"
  "09-wikidata-integration"
)

# Ensure ralphy is available.
command -v ralphy >/dev/null 2>&1 || { echo "error: 'ralphy' not found on PATH"; exit 1; }

# ralphy auto-commits per task, so a git repo is required.
if [ ! -d .git ]; then
  echo "Initializing git repository (ralphy commits after each task)..."
  git init -b main >/dev/null
  git config user.email >/dev/null 2>&1 || git config user.email "ralphy@local"
  git config user.name  >/dev/null 2>&1 || git config user.name  "ralphy"
  git add -A
  git commit -m "chore: initial plan, data model, and ralphy tasklists" >/dev/null
fi

# Select which tasklists to run (by 1-based index). No args = all.
if [ "$#" -eq 0 ]; then
  SELECTED=("${TASKLISTS[@]}")
else
  SELECTED=()
  for n in "$@"; do
    idx=$((n - 1))
    [ "$idx" -ge 0 ] && [ "$idx" -lt "${#TASKLISTS[@]}" ] || { echo "error: invalid tasklist number '$n' (1-${#TASKLISTS[@]})"; exit 1; }
    SELECTED+=("${TASKLISTS[$idx]}")
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
  echo ""
  echo "==============================================================="
  echo "  [$n/$total] ralphy: $dir"
  echo "  file: $file"
  echo "==============================================================="

  ralphy --json "$file" --claude --max-retries 3 $EXTRA_FLAGS

  # Gate: do not start the next tasklist until this one is fully complete.
  echo "Checking completion of $dir ..."
  if ! all_complete "$file"; then
    echo ""
    echo "Stopping: '$dir' did not finish. Fix/resume it, then re-run:"
    echo "    ./ralph/run.sh $n"
    echo "(completed tasks are skipped on re-run, so it picks up where it left off)"
    exit 1
  fi
done

echo ""
echo "All $total selected tasklist(s) completed in order."
