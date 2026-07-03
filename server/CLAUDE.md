# server/ — Express API + TSV loaders

## Quality-gate reality (read first)

- **`npm run check` (`tsc`) is NOT clean on `main`** — there are ~145 pre-existing
  errors (bulk in `server/tsv-storage.ts` and `server/routes.ts`). The practical
  gate is therefore **"my touched files add zero errors, and the total count does
  not rise"**, not "tsc is green". Verify with:
  `npm run check 2>&1 | grep "error TS" | grep -E "<files you touched>"` → expect
  none, and confirm the total error count is unchanged from baseline.
- **No `target` in `tsconfig.json`** ⇒ TS defaults to a low target with
  `downlevelIteration` off. **Spreading a Map/Set iterator fails** (`TS2802`,
  e.g. `[...map.keys()]`, `[...map.entries()]`). Use `Array.from(map.keys())`
  instead. Spreading a plain **array** is fine.

## Route registration

New route groups live in `server/routes/<area>.ts` exporting
`register<Area>Routes(app: Express): void`, called from `registerRoutes` in
`server/routes.ts` (right after `registerGraphRoutes`). Keeping them in their own
file avoids editing the large, already-error-heavy `routes.ts` body.

## Progressive summary/detail — `services/entity-summary.ts` + `routes/summaries.ts`

`/api/summaries/:domain` returns **lightweight** rows (a per-domain subset of the
detail record, paginated `offset`/`limit`); `/api/summaries/:domain/:id` (or the
canonical `/api/<domain>/:id`) returns the full record. The projection +
pagination is **pure** (`services/entity-summary.ts` — `SUMMARY_CONTRACTS`,
`summarizeEntity`, `paginate`, `summarizeList`); the route just maps a domain to
its storage fetcher in `DOMAIN_FETCHERS`. Summary is **always a strict subset of
detail** (contract fields led by `id`+`name`), so the two-step load is lossless.
Add a domain by declaring `fields`/`detailEndpoint` in `SUMMARY_CONTRACTS` + a
fetcher in `DOMAIN_FETCHERS`. Gotcha: `getCivilizations()` returns GeoJSON
`CivilizationFeature[]` (would need `.properties` projection) — it is excluded
(use the map bbox API instead); every other `get<Entity>()` returns flat rows.
Full contract table: `docs/progressive-loading.md`.

## Map viewport/bbox culling — `services/geo-bbox.ts`

Any `/api/map/*` GeoJSON endpoint can cull to the client viewport with **one line**:
`const { features, meta } = applyViewport(allFeatures, viewportOptionsFromQuery(req.query));`
then return `features` and merge `meta` into the response `metadata`. Accepts
`bbox=west,south,east,north` (swapped corners auto-normalized), `zoom`, `limit`, `offset`.
The module is **pure + dependency-free** (structural GeoJSON types, no Express/storage
import) so it is trivially unit-tested. Gotchas: features whose geometry yields no bounds
(geometry-less/malformed) are conservatively **kept**, never dropped; a missing/garbage
bbox is a no-op (full layer). Client side sends the bbox via the React Query key, not a
manual fetch — see `client/src/lib/visualization/map-performance.ts` `viewportParams()`.

## Faceted global search — `services/global-search.ts`

`/api/search` is federated (local corpus + shared graph) **and** faceted. Facet
counts (per `entityType` + `source`) and filter params live in pure helpers:
`computeFacets`/`combineFacets`/`matchesFilters`/`applyFacetFilters`/
`parseSearchFilters`/`emptyFacets`, plus `SearchFacets`/`SearchFilters` types.

- Facets are computed over the **full, unfiltered** match set *before*
  filtering/slicing so chip counts stay stable while a filter is active;
  `totalCount` is the **filtered** count.
- Signature gotcha: `federatedSearch(query, filters?, deps?)` — `filters` is the
  2nd positional arg (deps is 3rd). `globalSearch(query, filters?)`,
  `mergeGraphResults(..., filters?)` follow suit. Grep before changing.
- `mergeGraphResults` returns graph-**only** facets (over the deduped, unfiltered
  graph subset); `federatedSearch` `combineFacets(local, graph)`. Dedup runs
  before faceting so a graph hit duplicating a local result is counted once.
- Route parses `?types=a,b&sources=local,graph` via `parseSearchFilters(req.query)`.
- **Not** wired to the DuckDB index: search-result facets must reflect the in-TS
  fuzzy-scored subset. Corpus-wide faceting is a different feature and already
  lives at `/api/analytics/facets/:table/:column` (see analytical index below).

## Lazy-singleton services

External-backend / expensive services follow the `graph-store.ts` pattern: a
module-level `let singleton = null`, a `get…()` that builds once (concurrent
first-callers share one in-flight build promise), and a `close…()` wired into the
`SIGTERM`/`SIGINT` handler in `server/index.ts`. See `services/analytical-index.ts`.

## Analytical index (DuckDB) — `services/analytical-index.ts`

Runtime, in-memory DuckDB mirror of `lexicons/*.tsv` for **tabular/aggregate**
queries (faceting, `GROUP BY`); graph queries still go to Neo4j. Full contract:
`docs/analytical-index.md`. Key gotchas:

- Uses `@duckdb/node-api` (native addon, `DuckDBInstance.create(":memory:")`).
  Loads fine under `node`, `tsx`, **and vitest** — no special pool config needed.
- **Byte-faithful `read_csv` config** (matches `parseTsv`'s `split("\t")`):
  `delim='\t', header=true, all_varchar=true, quote='', escape='',
  nullstr=<impossible sentinel>`. The empty-string `nullstr` sentinel keeps blank
  cells as `""` (not `NULL`), which is what makes index results equal the
  in-memory string cells — the basis of the parity tests.
- Counts come back as **BigInt** → not JSON-serializable. Read results with
  `reader.getRowObjectsJson()` (BigInt → string) and `Number(...)` the counts.
- Table name = sanitized file base (`tableNameForFile`); it is the only identifier
  built from a filename. Validate column names against the real header before
  interpolating into SQL.
