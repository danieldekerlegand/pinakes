# Shared environment for the populated-graph bring-up. SOURCE this, don't run it:
#
#   . "$(dirname "$0")/graph-env.sh"
#
# It resolves the three things every leg of the bring-up needs to agree on — the
# repo root, the Neo4j connection, and which corpus directory is "the corpus" —
# and exports them, so `scripts/graph-up.sh` (which loads Neo4j), the pinakes
# service (which reads the same corpus in-process) and `npm run smoke:graph`
# (which asserts the two agree) can never drift apart. Every value is `:=`
# defaulted, so an operator's own export always wins.
#
# Runbook: docs/populated-graph-runbook.md.

PINAKES_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PINAKES_ROOT

# The documented local dev credential (.env.example). `neo4j/pinakes` is 7
# characters, under neo4j:5's 8-character floor, which is why the compose file
# lowers `dbms.security.auth_minimum_password_length` — see infra/docker-compose.yml.
: "${NEO4J_URI:=bolt://localhost:7687}"
: "${NEO4J_USER:=neo4j}"
: "${NEO4J_PASSWORD:=pinakes}"
: "${NEO4J_AUTH:=${NEO4J_USER}/${NEO4J_PASSWORD}}"
export NEO4J_URI NEO4J_USER NEO4J_PASSWORD NEO4J_AUTH

# Which directory holds the canonical export (a bare `nodes/` + `edges/` tree).
# `scripts/export-for-engine.ts` writes `export/pinakes_engine` today and
# tasks/chief/105-export-dir-unify.json moves it to the gitignored `build/corpus`;
# prefer whichever is actually populated so this bring-up survives that move.
if [ -z "${PINAKES_ENGINE_CORPUS:-}" ]; then
  if [ -d "${PINAKES_ROOT}/build/corpus/nodes" ]; then
    PINAKES_ENGINE_CORPUS="${PINAKES_ROOT}/build/corpus"
  else
    PINAKES_ENGINE_CORPUS="${PINAKES_ROOT}/export/pinakes_engine"
  fi
fi
export PINAKES_ENGINE_CORPUS
