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

## Collaborative collections — `services/collections.ts` + `routes/collections.ts`

`/api/collections/*` (US-007) is user-curated groups of entities. **Persistence
is JSON-per-record on disk** (like `contribution-service.ts`) — one file under the
**gitignored** `data/collections/` — via a `CollectionStore` class, but every
mutation/validation/ownership rule is a **pure** function (`createCollection`,
`applyCollectionUpdate`, `addCollectionItem`, `removeCollectionItem`, `canView`,
`canEdit`, `toShareView`, `validateCollectionInput`) taking `id`/`shareToken`/`now`
as params so CRUD is unit-tested with no fs/clock.

- **No auth** → ownership is a soft, opaque owner id resolved by `resolveOwner(req)`:
  `x-owner-id` header → `?owner=` query → body `owner`, default `"anonymous"`. The
  client persists a per-browser id in localStorage (`lib/collections.getOwnerId`).
- **Entities are referenced by stable id** `cs:<type>:<id>` (`stableEntityId`,
  mirrors `graph-resolver.mintCsid`) — dedup + remove key on it.
- **Sharing** = an unguessable `shareToken`; `GET /api/collections/shared/:token`
  returns the owner-free `toShareView` regardless of visibility. Register that
  two-segment route before `/:id`.
- Store methods throw `CollectionAccessError` (→ 403) on a non-owner mutate and
  return `null` for a missing id (→ 404); the route maps both.
- **Route test pattern without a storage mock:** `registerCollectionRoutes(app,
  store)` takes an **injectable** store, so the test passes a `new
  CollectionStore(tmpDir)` (`fs.mkdtempSync`) instead of `vi.mock`-ing storage —
  simpler than the summaries/graph mock pattern when the service owns its own fs.

## User annotations & notes — `services/annotations.ts` + `routes/annotations.ts`

`/api/annotations/*` (US-008) is per-user free-text notes on entities — the same
JSON-per-record + injectable-store + soft-owner pattern as collections (above), so
copy that shape. Differences to know:

- **Keyed by (entity `stableId` + owner)**, not by a top-level record id you hold.
  Lookups are `GET /api/annotations?entity=cs:<type>:<id>` (or `?type=&id=`); the
  route resolves the stable id and `store.listForEntity(stableId, owner)` returns
  the owner's own notes **plus** everyone's *public* notes (pure
  `visibleAnnotations`, own-first then newest-updated).
- **Private by default; sharing = flip `visibility` to `public`** (`PATCH`). There is
  no share-token (unlike collections) — a public note is simply visible to any viewer
  of that entity.
- **Never leak another user's owner id.** Every outgoing annotation goes through
  pure `toView(annotation, viewer)` → owner-free `AnnotationView` with an
  `editable` boolean (`canEdit`), used uniformly by list/get/create/patch responses.
- Store throws `AnnotationAccessError` (→ 403) on a non-owner mutate; `canView`
  gate returns 403 on a private read by a non-owner. Route test uses the injectable
  `new AnnotationStore(tmpDir)` (same as collections).

## Drawn-geometry authoring — `services/drawn-geometry.ts` + `routes/drawn-geometry.ts`

`POST /api/map/drawn-geometry` (US-001) takes a GeoJSON **Polygon or LineString**
drawn on the map and lands it in the **contribution review queue** (never a
direct TSV write) with provenance `entityData.source = 'user-drawn'`. Pattern to
reuse for any "author geometry in-app" feature:

- The service is **pure** (no fs/express): `validateGeometry` (structural GeoJSON
  — closed rings ≥4 positions, LineString ≥2, `[lng,lat]` within world bounds),
  `validateDrawnGeometry` (adds entity association + non-inverted time range +
  target/geometry-kind agreement), `serializeGeometry` (canonical JSON string
  matching a TSV `geometry`/`waypoints` cell), and `drawnGeometryToContribution`
  (→ `Partial<Contribution>`). Unit-test these directly; no server needed.
- `DrawnGeometryTarget` (`boundary`/`language-range` = Polygon; `trade-route`/
  `migration-route` = LineString) maps 1:1 onto `ContributionEntityType` — those
  last two were **added** to the enum + `REQUIRED_FIELDS` in
  `contribution-service.ts` so routes can queue too. Extend both together.
- Route takes an **injectable** `ContributionService` (default `new
  ContributionService()`), so the test points it at a `mkdtempSync` dir — same
  pattern as collections/annotations.
- For `language-range`, `associatedEntityId` is mirrored into
  `entityData.languageId` to satisfy that type's required fields.
- Client entry point is `client/src/components/visualizations/BoundaryDrawingPanel
  .tsx` (uses the existing `useDrawingTool` hook); it posts the `DrawnGeometryInput`
  shape (geometry + target + associatedEntityId + timePeriodStart/End).

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
