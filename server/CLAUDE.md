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
