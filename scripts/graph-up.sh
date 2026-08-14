#!/usr/bin/env bash
# Bring the POPULATED graph up — idempotent, detached, and safe to re-run.
#
#   npm run graph:up          # or: ./scripts/graph-up.sh
#
# Three steps, each skipped when it is already satisfied:
#
#   1. start the `neo4j` docker-compose service and wait for it to report healthy;
#   2. build the canonical export (`scripts/export-for-engine.ts`) if it is absent;
#   3. MERGE that export into Neo4j (`pinakes_engine to-neo4j --mode loadcsv`).
#
# It leaves Neo4j RUNNING, because everything that consumes a populated graph —
# `npm start`, `npm run smoke:graph`, `npm run test:e2e` — is a separate process.
# Tear it down with `npm run sidecar:down`.
#
# There is no sidecar leg: since the cutover the engine is imported IN-PROCESS by
# the service (services/api/src/pinakes/engine/), so `/api/graph/status`'s
# `sidecar: true` means "the in-process corpus is readable", not "a container is
# up". The `pinakes_engine` compose service is not needed (and does not build —
# see infra/engine.Dockerfile).
#
# Env: PINAKES_ENGINE_CORPUS, NEO4J_* (see scripts/graph-env.sh),
#      PINAKES_FORCE_EXPORT=1 to rebuild the export even when it exists,
#      PINAKES_SKIP_LOAD=1     to skip the Neo4j load (graph already loaded).
# Runbook: docs/populated-graph-runbook.md.
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/graph-env.sh"
cd "$PINAKES_ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required to bring the graph up (it runs the Neo4j service)."
  echo "       To run the app WITHOUT graph features: npm run build && npm start"
  exit 1
fi

# ── 1. Neo4j ─────────────────────────────────────────────────────────────────
# Always from the repo root with an explicit -f: the compose file mounts ${PWD}
# at its own absolute path so the `file://<abs-path>` LOAD CSV URLs step 3 emits
# resolve inside the container.
echo "▶ Starting Neo4j (docker compose)…"
docker compose -f infra/docker-compose.yml up -d neo4j

echo "▶ Waiting for Neo4j to report healthy…"
for i in $(seq 1 60); do
  health="$(docker inspect -f '{{.State.Health.Status}}' pinakes-neo4j-1 2>/dev/null || echo unknown)"
  case "$health" in
    healthy) echo "  Neo4j healthy."; break ;;
    unhealthy)
      echo "error: Neo4j reported unhealthy. Logs:"
      docker logs --tail 30 pinakes-neo4j-1 || true
      exit 1
      ;;
  esac
  if [ "$i" = "60" ]; then
    echo "error: Neo4j did not become healthy within 120s. Logs:"
    docker logs --tail 30 pinakes-neo4j-1 || true
    exit 1
  fi
  sleep 2
done

# ── 2. The canonical export ──────────────────────────────────────────────────
if [ -n "${PINAKES_FORCE_EXPORT:-}" ] || [ ! -d "${PINAKES_ENGINE_CORPUS}/nodes" ]; then
  echo "▶ Building the canonical export → ${PINAKES_ENGINE_CORPUS} …"
  npx tsx scripts/export-for-engine.ts
else
  echo "▶ Canonical export present at ${PINAKES_ENGINE_CORPUS} (PINAKES_FORCE_EXPORT=1 to rebuild)."
fi

# ── 3. The load ──────────────────────────────────────────────────────────────
# MERGE-on-csid behind `IF NOT EXISTS` constraints, so re-running adds nothing.
if [ -n "${PINAKES_SKIP_LOAD:-}" ]; then
  echo "▶ Skipping the Neo4j load (PINAKES_SKIP_LOAD set)."
else
  echo "▶ Loading the corpus into Neo4j (idempotent MERGE)…"
  # The engine CLI logs at INFO and the Neo4j driver relays one server
  # notification per `IF NOT EXISTS` constraint, so a RE-run buries its one real
  # line under ~37 paragraphs of "already exists". Capture, then show the
  # summary — and dump the whole log untouched when the load actually fails.
  load_log="$(mktemp)"
  if ! uv run --all-packages pinakes_engine to-neo4j \
      "${PINAKES_ENGINE_CORPUS}" --mode loadcsv >"$load_log" 2>&1; then
    cat "$load_log"
    rm -f "$load_log"
    echo "error: the Neo4j load failed (see above)."
    exit 1
  fi
  grep -v 'Received notification from DBMS server' "$load_log" || true
  rm -f "$load_log"
fi

echo ""
echo "✓ Populated graph up. Verify with:  npm start  &&  npm run smoke:graph"
uv run --all-packages pinakes_engine neo4j-counts | head -4
