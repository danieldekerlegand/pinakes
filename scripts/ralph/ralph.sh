#!/bin/bash
# Ralph Wiggum - Long-running AI agent loop
# Usage: ./ralph.sh [--tool amp|claude] [max_iterations]
#
# LinguaScrape is a single repo (no submodules). Each PRD may still declare a
# `repo` field; it defaults to "." (the repo root), where branches/commits happen
# and where progress detection (did a new commit land?) tracks HEAD.

set -e

# Parse arguments
TOOL="claude"  # Default to claude for this project
MAX_ITERATIONS=10

while [[ $# -gt 0 ]]; do
  case $1 in
    --tool)
      TOOL="$2"
      shift 2
      ;;
    --tool=*)
      TOOL="${1#*=}"
      shift
      ;;
    *)
      # Assume it's max_iterations if it's a number
      if [[ "$1" =~ ^[0-9]+$ ]]; then
        MAX_ITERATIONS="$1"
      fi
      shift
      ;;
  esac
done

# Validate tool choice
if [[ "$TOOL" != "amp" && "$TOOL" != "claude" ]]; then
  echo "Error: Invalid tool '$TOOL'. Must be 'amp' or 'claude'."
  exit 1
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRD_FILE="$SCRIPT_DIR/prd.json"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"
ARCHIVE_DIR="$SCRIPT_DIR/archive"
LAST_BRANCH_FILE="$SCRIPT_DIR/.last-branch"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Archive previous run if branch changed
if [ -f "$PRD_FILE" ] && [ -f "$LAST_BRANCH_FILE" ]; then
  CURRENT_BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")
  LAST_BRANCH=$(cat "$LAST_BRANCH_FILE" 2>/dev/null || echo "")

  if [ -n "$CURRENT_BRANCH" ] && [ -n "$LAST_BRANCH" ] && [ "$CURRENT_BRANCH" != "$LAST_BRANCH" ]; then
    # Archive the previous run
    DATE=$(date +%Y-%m-%d)
    # Strip "ralph/" prefix from branch name for folder
    FOLDER_NAME=$(echo "$LAST_BRANCH" | sed 's|^ralph/||')
    ARCHIVE_FOLDER="$ARCHIVE_DIR/$DATE-$FOLDER_NAME"

    echo "Archiving previous run: $LAST_BRANCH"
    mkdir -p "$ARCHIVE_FOLDER"
    [ -f "$PRD_FILE" ] && cp "$PRD_FILE" "$ARCHIVE_FOLDER/"
    [ -f "$PROGRESS_FILE" ] && cp "$PROGRESS_FILE" "$ARCHIVE_FOLDER/"
    echo "   Archived to: $ARCHIVE_FOLDER"

    # Reset progress file for new run
    echo "# Ralph Progress Log" > "$PROGRESS_FILE"
    echo "Started: $(date)" >> "$PROGRESS_FILE"
    echo "---" >> "$PROGRESS_FILE"
  fi
fi

# Track current branch
if [ -f "$PRD_FILE" ]; then
  CURRENT_BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")
  if [ -n "$CURRENT_BRANCH" ]; then
    echo "$CURRENT_BRANCH" > "$LAST_BRANCH_FILE"
  fi
fi

# Initialize progress file if it doesn't exist
if [ ! -f "$PROGRESS_FILE" ]; then
  echo "# Ralph Progress Log" > "$PROGRESS_FILE"
  echo "Started: $(date)" >> "$PROGRESS_FILE"
  echo "---" >> "$PROGRESS_FILE"
fi

# --- Adaptive iteration control + session-limit recovery ---------------------
# MAX_ITERATIONS is a SOFT budget, not a hard wall. As long as each iteration
# makes forward progress (a story flips to passes:true, OR a new commit lands),
# Ralph keeps going past the budget — up to HARD_MAX — so a PRD that just needs
# a few more turns isn't cut off mid-flight. It gives up only once it has spent
# the budget AND stalled (no progress) for STALL_LIMIT consecutive iterations,
# or reaches the HARD_MAX safety ceiling.
STALL_LIMIT="${STALL_LIMIT:-2}"
HARD_MAX="${HARD_MAX:-$(( MAX_ITERATIONS*3 > 20 ? MAX_ITERATIONS*3 : 20 ))}"

# On a Claude session/usage limit, sleep until it resets and RESUME the same
# story instead of aborting the run.
RATE_LIMIT_RETRY="${RATE_LIMIT_RETRY:-1}"
RATE_LIMIT_WAIT="${RATE_LIMIT_WAIT:-3600}"
RATE_LIMIT_MAX_WAITS="${RATE_LIMIT_MAX_WAITS:-8}"
RATE_LIMIT_PATTERN="${RATE_LIMIT_PATTERN:-(usage limit reached|session limit reached|(hit|reached) your (session|usage|rate) limit|rate limit exceeded|429 too many requests)}"

# The repo the PRD's branch/commits live in (repo-root-relative; "." = root).
PRD_REPO_REL="$(jq -r '.repo // "."' "$PRD_FILE" 2>/dev/null || echo ".")"
REPO="$REPO_ROOT/$PRD_REPO_REL"
[ -d "$REPO" ] || { echo "ERROR: PRD repo '$PRD_REPO_REL' not found under $REPO_ROOT"; exit 1; }

_passes() { jq '[.userStories[]? | select(.passes==true)] | length' "$PRD_FILE" 2>/dev/null || echo 0; }
_total()  { jq '.userStories | length' "$PRD_FILE" 2>/dev/null || echo '?'; }
_head()   { git -C "$REPO" rev-parse HEAD 2>/dev/null || echo none; }

# Seconds to sleep after a limit message: prefer a parsed reset time (a unix
# epoch near "reset", or a "…3pm"-style clock time), else RATE_LIMIT_WAIT; +60s
# buffer; capped at 6h.
_seconds_until_reset() {
  local out="$1" now epoch t secs; now=$(date +%s)
  epoch=$(printf '%s' "$out" | grep -oiE '(reset|limit)[^0-9]{0,40}1[0-9]{9}' | grep -oE '1[0-9]{9}' | head -1)
  if [ -z "$epoch" ]; then
    t=$(printf '%s' "$out" | grep -oiE '[0-9]{1,2}(:[0-9]{2})?[[:space:]]*(am|pm)' | head -1)
    if [ -n "$t" ]; then
      epoch=$(date -d "today $t" +%s 2>/dev/null || echo "")
      [ -n "$epoch" ] && [ "$epoch" -le "$now" ] && epoch=""
    fi
  fi
  if [ -n "$epoch" ] && [ "$epoch" -gt "$now" ]; then secs=$(( epoch - now + 60 )); else secs="$RATE_LIMIT_WAIT"; fi
  [ "$secs" -gt 21600 ] && secs=21600
  echo "$secs"
}

echo "Starting Ralph — Tool: $TOOL — repo: $PRD_REPO_REL — budget $MAX_ITERATIONS iters (extends while progressing; hard cap $HARD_MAX; stall limit $STALL_LIMIT)"

prev_pass=$(_passes); prev_head=$(_head)
i=0; stall=0; waits=0
while :; do
  i=$((i+1))
  echo ""
  echo "==============================================================="
  echo "  Ralph Iteration $i ($TOOL) — budget $MAX_ITERATIONS · cap $HARD_MAX · $(_passes)/$(_total) passing"
  echo "==============================================================="

  # Run the selected tool with the ralph prompt, from the repo root so the agent
  # can see the whole tree and the plan docs.
  if [[ "$TOOL" == "amp" ]]; then
    OUTPUT=$(cd "$REPO" && cat "$SCRIPT_DIR/prompt.md" | amp --dangerously-allow-all 2>&1 | tee /dev/stderr) || true
  else
    # Claude Code: --dangerously-skip-permissions for autonomous operation, --print for output.
    OUTPUT=$(cd "$REPO" && claude --dangerously-skip-permissions --print < "$SCRIPT_DIR/CLAUDE.md" 2>&1 | tee /dev/stderr) || true
  fi

  # Completion signal
  if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
    echo ""
    echo "Ralph completed all tasks! (iteration $i)"
    exit 0
  fi

  # Session/usage limit -> sleep until reset and resume (a blocked turn is free)
  if echo "$OUTPUT" | grep -qiE "$RATE_LIMIT_PATTERN"; then
    if [ "$RATE_LIMIT_RETRY" = "1" ] && [ "$waits" -lt "$RATE_LIMIT_MAX_WAITS" ]; then
      waits=$((waits+1))
      secs=$(_seconds_until_reset "$OUTPUT")
      echo ""
      echo "Ralph hit a session/usage limit. Sleeping ${secs}s (~$(( secs/60 )) min) then resuming — wait $waits/$RATE_LIMIT_MAX_WAITS."
      sleep "$secs"
      i=$((i-1))   # the blocked turn doesn't consume the budget
      continue
    fi
    echo ""
    echo "Ralph hit a session/usage limit and won't retry (RATE_LIMIT_RETRY=$RATE_LIMIT_RETRY, waits=$waits/$RATE_LIMIT_MAX_WAITS). Stopping."
    exit 2
  fi

  # Progress check: did a story pass, or a new commit land in the PRD's repo?
  now_pass=$(_passes); now_head=$(_head)
  if [ "$now_pass" -gt "$prev_pass" ] || [ "$now_head" != "$prev_head" ]; then
    stall=0
    echo "Iteration $i: progress ($now_pass/$(_total) passing). Continuing..."
  else
    stall=$((stall+1))
    echo "Iteration $i: no progress (stall $stall/$STALL_LIMIT)."
  fi
  prev_pass=$now_pass; prev_head=$now_head

  # Give up only after spending the budget AND stalling, or at the hard ceiling.
  if [ "$stall" -ge "$STALL_LIMIT" ] && [ "$i" -ge "$MAX_ITERATIONS" ]; then
    echo ""
    echo "Ralph stalled $stall iterations after its $MAX_ITERATIONS-iter budget without completing. Stopping."
    echo "Check $PROGRESS_FILE for status."
    exit 1
  fi
  if [ "$i" -ge "$HARD_MAX" ]; then
    echo ""
    echo "Ralph hit the hard iteration ceiling ($HARD_MAX) without completing. Stopping."
    echo "Check $PROGRESS_FILE for status."
    exit 1
  fi
  sleep 2
done
