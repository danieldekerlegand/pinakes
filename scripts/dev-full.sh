#!/usr/bin/env bash
# The one-command bring-up: the pinakes service + the built client, against a
# Neo4j POPULATED from the canonical export.
#
#   npm run dev:full        # or: ./scripts/dev-full.sh
#
# It delegates the graph half to `scripts/graph-up.sh` (start Neo4j → build the
# export → MERGE it in — each step idempotent), then builds the client and runs
# the Pinakes service in the foreground. Since the cutover
# (tasks/chief/80-cutover.json US-2) the app IS the Python service: `npm start`
# is `python -m pinakes`, which serves the built client AND the whole /api
# surface from one process, so "the service and the client together" is one
# process, not two. For client work with HMR, run `npm run dev` (Vite proxies
# /api) against a service started separately.
#
# Neo4j is left RUNNING on exit so `npm run smoke:graph` / `npm run test:e2e`
# can be pointed at the same populated graph; stop it with `npm run sidecar:down`.
#
# There is no sidecar container leg any more — the engine is imported in-process
# (services/api/src/pinakes/engine/), and the `pinakes_engine` compose image does
# not build (infra/engine.Dockerfile). `/api/graph/status`'s `sidecar` field is
# the in-process corpus reader, and it is green as long as PINAKES_ENGINE_CORPUS
# points at the same export Neo4j was loaded from — which is what graph-env.sh
# guarantees.
#
# Env: see scripts/graph-env.sh. `PINAKES_SKIP_GRAPH=1` starts the app alone
# (the graph UI then degrades via GraphFeatureGate).
# Runbook: docs/populated-graph-runbook.md.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${SCRIPT_DIR}/graph-env.sh"
cd "$PINAKES_ROOT"

if [ -n "${PINAKES_SKIP_GRAPH:-}" ]; then
  echo "▶ Skipping the graph bring-up (PINAKES_SKIP_GRAPH set); the app degrades gracefully."
else
  "${SCRIPT_DIR}/graph-up.sh"
fi

echo "▶ Building the client (npm run build)…"
npm run build

echo "▶ Starting the pinakes service (npm start) on port ${PORT:-3050}…"
echo "  corpus: ${PINAKES_ENGINE_CORPUS}"
echo "  neo4j:  ${NEO4J_URI}"
npm start
