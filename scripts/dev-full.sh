#!/usr/bin/env bash
# Run Pinakes together with the vendored culture-scrape sidecar + Neo4j.
#
#   npm run dev:full        # or: ./scripts/dev-full.sh
#
# Starts the docker-compose services (culturescrape + neo4j) detached, waits for
# the sidecar, then runs the app dev server in the foreground. Stops the services
# on exit. The app degrades gracefully if the sidecar/graph never come up.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required for 'dev:full' (it starts the culture-scrape sidecar + Neo4j)."
  echo "       To run just the app without graph features: npm run dev"
  exit 1
fi

SIDECAR_URL="${CULTURESCRAPE_API_URL:-http://localhost:8800}"

cleanup() {
  echo ""
  echo "Stopping culture-scrape sidecar + Neo4j…"
  docker compose stop culturescrape neo4j >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "▶ Starting culture-scrape sidecar + Neo4j (docker compose)…"
docker compose up -d --build culturescrape neo4j

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

echo "▶ Starting Pinakes dev server (npm run dev)…"
npm run dev
