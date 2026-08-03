# `infra/` — deployment and local-orchestration config

Part of the target repo skeleton from
[`docs/UNIFIED-PROJECT-PLAN.md` §4](../docs/UNIFIED-PROJECT-PLAN.md). Filled in by
pinakes:20 US-3.

## Purpose

Compose files, Dockerfiles, and deploy config — pulled off the root so the root
holds README, LICENSE, the uv workspace manifest, and `.gitignore` and nothing
else structural.

## Contents

| File | Note |
|---|---|
| `docker-compose.yml` | the `pinakes_engine` sidecar + a `graph`-profiled Neo4j; service renamed `culturescrape` → `pinakes_engine` with the engine (US-1) |
| `engine.Dockerfile` | the sidecar image — **known broken**, see the ⚠️ note at the top of the file |

## Two things that bite after the move

- **Always invoke compose from the repo root with an explicit `-f`:**
  `docker compose -f infra/docker-compose.yml …`. Both npm scripts (`sidecar:up`,
  `sidecar:down`) and `scripts/dev-full.sh` do. `${PWD}` inside the file must be the
  repo root — the `neo4j` service bind-mounts the checkout **at its own absolute host
  path** so the `file://<abs-path>` LOAD CSV URLs `pinakes_engine to-neo4j` emits
  resolve inside the container. A `cd infra && docker compose up` mounts the wrong tree.
- **The project name is pinned** (`name: pinakes`). Compose otherwise derives it from
  the compose file's directory, so moving the file here would have silently renamed the
  project to `infra` and orphaned the existing `neo4j-data` volume.

`engine.Dockerfile`'s build **context is `../engine`**, not this directory — the repo
root would drag `node_modules/` into the build, and the image's `COPY` paths are
package-relative. The Dockerfile is read by the client rather than from the context,
so naming it from outside is fine.
