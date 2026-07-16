# Civilizations — in-app verification (data-population pilot US-005)

Proof that the expanded civilizations corpus (89 → **170**, incl. the 81
Wikidata-acquired write-back rows from US-003) is actually **usable in the running
app**: it renders on the map, in the UnifiedExplorer, and in detail panels with
provenance shown. Cross-links the roadmap §15 and closes the pilot's UI leg.

## What shipped

The premise — "verify it renders" — did not hold as-is: civilizations reached the
UI only as a map layer, with **no explorer adapter** and **no provenance surfaced**.
So US-005 added the minimal wiring, then browser-verified it.

1. **Server** — `loadCivilizations()` (`server/tsv-storage.ts`) now emits the
   provenance columns (`description`, `wikidata_qid`, `source_url`, `retrieved_at`,
   `confidence`) into the `/api/map/civilizations` GeoJSON `properties`. The
   `CivilizationProperties` type (`client/src/lib/visualization/geospatial-types.ts`,
   shared with the server) gained those as optional fields. Live response: **170
   features, 81 carrying `wikidataQid` + `sourceUrl` + `confidence=1.0`.**
2. **Explorer adapter** — new `civilizations.adapter.ts` (registered in
   `registry.ts`) projects the corpus into temporal/spatial/categorical and returns
   a `provenance` in `detail()`, so the UnifiedExplorer renders `<ProvenanceList>`.
   Reachable at `/?panel=explore&ds=civilizations`. Boundary-less civs (placeholder
   geometry) are excluded from the spatial projection only.

## How it was verified

Stack: `docker compose` Neo4j 5 + culture-scrape sidecar (both serving the
`export/culturescrape` corpus), app on `:3050`.

- **Browser (Playwright, `e2e/civilizations.spec.ts`, 4/4 pass):**
  - **Map** — `/?view=map&layers=civilizations` loads the full corpus onto Leaflet
    (`/api/map/civilizations` → ≥150 features, provenance present).
    → `test-results/civilizations/map-civilizations.png`
  - **Explorer** — `ds=civilizations` shows a live item count (170) and the acquired
    civ **Ancient Crete** in the Table viz.
    → `test-results/civilizations/explorer-civilizations.png`
  - **Detail + provenance** — selecting Ancient Crete opens the detail panel with a
    `provenance-list` classified **sourced**, a `provenance-source-link` to
    `wikidata.org/entity/Q4752820`, and the QID as a field.
    → `test-results/civilizations/detail-provenance.png`
  - **Empty state** — a no-match search degrades to `0 items` + the Table's empty
    affordance, no crash.
- **Live-graph smoke (`npm run smoke:graph`): 5 passed, 0 failed, 0 skipped** —
  status (neo4j+sidecar up), metrics (5432 nodes / 5526 edges), search, node/:id,
  neighborhood/:id all green.
- **Typecheck** `npm run check` → 0 errors. Adapter unit tests (`civilizations.adapter.test.ts`) 7/7.

## Gotcha for the full scale-out (feeds US-006)

`npm run smoke:graph` is only green when **the sidecar and Neo4j serve the same
corpus**. `dev:full` builds the sidecar on its bundled 9-node demo fixture
(`CORPUS` default) while US-004 loads the Pinakes export into Neo4j — so the
smoke's cross-backend `node/:id` check 404s (a sidecar csid absent from Neo4j).
Fix wired here: `docker-compose.yml` mounts the gitignored `export/culturescrape`
at `/corpus:ro`; bring the stack up with

```
CULTURESCRAPE_CORPUS=/corpus docker compose up -d culturescrape neo4j
```

so both backends read the same bare `nodes/`+`edges/` corpus. The default stays
the demo fixture so a bare `docker compose up` still starts with no export built.

See also `docs/civilizations-neo4j-load.md` (US-004), `docs/culturescrape-integration.md`.
