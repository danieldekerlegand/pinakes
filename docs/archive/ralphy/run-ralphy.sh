#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./run-ralphy.sh                  # runs phases 9-14 (default)
#   ./run-ralphy.sh 9 10             # runs phases 9 and 10 only
#   ./run-ralphy.sh 12               # runs phase 12 only

MAX_PARALLEL=4
RALPHY_DIR="$(cd "$(dirname "$0")" && pwd)/ralphy"

if [ $# -eq 0 ]; then
  PHASES=(9 10 11 12 13 14)
else
  PHASES=("$@")
fi

for phase in "${PHASES[@]}"; do
  file=$(ls "$RALPHY_DIR"/ralphy-phase${phase}*.json 2>/dev/null | head -1 || true)
  if [ -z "$file" ]; then
    echo "No phase file found for phase $phase, skipping."
    continue
  fi
  echo "Starting phase $phase: $file"
  ralphy --parallel --max-parallel "$MAX_PARALLEL" --json "$file"
done

echo "All phases complete!"
