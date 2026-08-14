#!/usr/bin/env bash
# Browser-verify the atlas against the POPULATED graph (pinakes:100 US-2).
#
#   npm run test:e2e:graph        # or: ./scripts/e2e-graph.sh [-- playwright args]
#
# This is `npm run test:e2e` plus the two things that make the run see real data
# instead of an empty graph:
#
#   1. `graph-up.sh` — Neo4j up + the canonical export MERGEd in (idempotent).
#   2. the `graph-env.sh` variables EXPORTED into the environment Playwright
#      inherits. `webServer.env` in web/playwright.config.ts merges with
#      `process.env`, so the service Playwright boots reads the same
#      `PINAKES_ENGINE_CORPUS` / `NEO4J_*` this shell resolved — which is what
#      makes `/api/graph/status` answer `neo4j: true` inside the browser run and
#      the graph-state-aware specs (e2e/support/graph-state.ts) take their
#      populated-graph branch.
#
# Without this, `npm run test:e2e` is still correct — it just takes the
# graph-DOWN branch and verifies graceful degradation instead.
#
# Env: everything in scripts/graph-env.sh, plus
#   PINAKES_SKIP_GRAPH=1   drive the suite against whatever graph state is up
#                          (skips step 1; useful when it is already loaded)
#   E2E_PORT               the port Playwright boots on (default 3055)
#
# Runbook: docs/populated-graph-runbook.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${SCRIPT_DIR}/graph-env.sh"
cd "$PINAKES_ROOT"

if [ -n "${PINAKES_SKIP_GRAPH:-}" ]; then
  echo "▶ Skipping the graph bring-up (PINAKES_SKIP_GRAPH set)."
else
  "${SCRIPT_DIR}/graph-up.sh"
fi

# Playwright REUSES a server already listening on the port (reuseExistingServer,
# non-CI) — and a reused server keeps the environment IT was started with, not
# the one exported above. So a stale `npm start` on this port would quietly send
# the run down the graph-DOWN branch (or, worse, a half-up one) while printing
# nothing. Probe it and refuse rather than "verify" the wrong stack.
E2E_PORT="${E2E_PORT:-3055}"
STATUS="$(curl -fsS -m 5 "http://localhost:${E2E_PORT}/api/graph/status" 2>/dev/null || true)"
if [ -n "$STATUS" ]; then
  echo "▶ A server is already listening on ${E2E_PORT}; Playwright will reuse it."
  echo "  /api/graph/status → ${STATUS}"
  if ! printf '%s' "$STATUS" | grep -q '"neo4j": *true' ||
     ! printf '%s' "$STATUS" | grep -q '"sidecar": *true'; then
    echo "✗ That server does not see the populated graph (needs neo4j AND sidecar true)." >&2
    echo "  It was started without the scripts/graph-env.sh environment. Stop it and" >&2
    echo "  re-run, or start it with: PORT=${E2E_PORT} npm run dev:full" >&2
    echo "  (\`npm run test:e2e\` alone is still valid — it verifies the graph-DOWN branch.)" >&2
    exit 1
  fi
fi

# The browser binary is NOT a repo dependency — `npm install` only fetches the
# @playwright/test package. A checkout that has never run this exits with
# "Executable doesn't exist … npx playwright install", which reads like a spec
# failure. Idempotent and near-instant once present.
echo "▶ Ensuring the Chromium build Playwright expects is installed…"
npx playwright install chromium

echo "▶ Running the e2e suite against the populated graph…"
echo "  corpus: ${PINAKES_ENGINE_CORPUS}"
echo "  neo4j:  ${NEO4J_URI}"
echo "  port:   ${E2E_PORT:-3055}"
exec npx playwright test --config web/playwright.config.ts "$@"
