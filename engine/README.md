# `engine/` — the Python knowledge/graph/scrape engine

**Status: empty placeholder.** Part of the target repo skeleton from
[`docs/UNIFIED-PROJECT-PLAN.md` §4](../docs/UNIFIED-PROJECT-PLAN.md). Nothing has
moved here yet; the live engine is still [`core/`](../core/) under the
`culturescrape` namespace.

## Purpose

Acquisition, ontology, Datalog, Neo4j, canonical schema, and orchestration — the
domain half of the backend, kept separate from the web half in
[`services/api/`](../services/api/) so the sidecar image stays slim and the ML
workspace stays torch-isolated.

Package name: **`pinakes_engine`** — the rename of today's `culturescrape`, which
completes the consistent `pinakes_*` family.

## Planned shape

```
engine/
├── src/pinakes_engine/   # acquire · ontology · datalog · neo4j · schema · orchestrate
├── inputs/               # blueprints · categories · jobs · cypher · datalog-examples
├── tests/
└── pyproject.toml
```

## Moves in later

| Current | Note |
|---|---|
| `core/` (`culturescrape`) | renamed and kept; absorbs the TS scraper stack's remaining coverage |
| `core/inputs/` | moves with the engine |
