#!/usr/bin/env bash
# Run pinakes together with the vendored pinakes-engine sidecar + Neo4j.
#
#   npm run dev:full        # or: ./scripts/dev-full.sh
#
# Starts the docker-compose services (pinakes_engine + neo4j) detached, waits for
# the sidecar, builds the client, then runs the Pinakes service in the foreground.
# Stops the services on exit. The app degrades gracefully if the sidecar/graph
# never come up.
#
# Since the cutover (tasks/chief/80-cutover.json US-2) the app IS the Python
# service: `npm start` is `python -m pinakes`, which serves the built client and
# the whole /api surface from one process. For client work with HMR, run
# `npm run dev` (Vite) against a service started separately — Vite proxies /api.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required for 'dev:full' (it starts the pinakes-engine sidecar + Neo4j)."
  echo "       To run just the app without graph features: npm run build \&\& npm start"
  exit 1
fi

SIDECAR_URL="${PINAKES_ENGINE_API_URL:-http://localhost:8800}"

cleanup() {
  echo ""
  echo "Stopping pinakes-engine sidecar + Neo4j…"
  docker compose -f infra/docker-compose.yml stop pinakes_engine neo4j >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "▶ Starting pinakes-engine sidecar + Neo4j (docker compose)…"
docker compose -f infra/docker-compose.yml up -d --build pinakes_engine neo4j

echo "▶ Waiting for the sidecar at ${SIDECAR_URL} …"
for i in $(seq 1 60); do
  if curl -sf "${SIDECAR_URL}/" >/dev/null 2>&1; then
    echo "  sidecar ready."
    break
  fi
  if [ "$i" = "60" ]; then
    echo "  warning: sidecar not ready after 60s — continuing (the app degrades gracefully)."
  fi
  sleep 1
done

echo "▶ Building the client (npm run build)…"
npm run build

echo "▶ Starting the pinakes service (npm start)…"
npm start
