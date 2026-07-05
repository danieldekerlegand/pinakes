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

## Timeline-event authoring — `services/timeline-event.ts` + `routes/timeline-event.ts`

`POST /api/timeline/event` (US-002) takes an **event** (single year) or **period**
(dated range) authored on the temporal axis and lands it in the **contribution
review queue** (never a direct TSV write) with provenance
`entityData.source = 'user-authored'`. Same shape as drawn-geometry (above) —
copy it for any "author temporal data in-app" feature:

- Service is **pure** (no fs/express): `validateTimelineEvent(input, bounds?)`
  (entity association + lane/magnitude vocab + in-bounds, non-inverted range;
  `bounds` intersects the global `[TIMELINE_MIN_YEAR=-50000, TIMELINE_MAX_YEAR=2100]`),
  `serializeTimelineEvent` (→ the `culture-events.tsv` row shape, `year` = start),
  `timelineEventToContribution` (→ `Partial<Contribution>`). Unit-test directly.
- **`event` vs `period`**: an `event` must have no divergent end (`timePeriodEnd`
  null or == start); a `period` **requires** `timePeriodEnd >= start`. Both the
  serialized row and the culture-events loader use a single `year` column, so the
  full range lives only on the queued `entityData` for a reviewer.
- Added `timeline-event` to `ContributionEntityType` + `REQUIRED_FIELDS`
  (`["title","cultureProfileId","lane"]`). **Gotcha:** keep required-field keys
  **non-numeric** — the contribution service checks `entityData[field]` truthiness,
  so a numeric field of `0` (e.g. year 0) would spuriously fail. Validate numbers
  in the service instead.
- Route takes an **injectable** `ContributionService`; test points it at a
  `mkdtempSync` dir (same as collections/drawn-geometry).
- Client entry point: `client/src/components/visualizations/TimelineEventAuthoringPanel
  .tsx` (a clickable SVG axis reusing `culture-evolution-timeline-utils`
  `xToYear`/`yearToX`), mounted via an "Add entry" toggle in
  `culture-profile/culture-evolution-timeline-section.tsx`.

## Relationship-builder authoring — `services/relationship-edge.ts` + `routes/relationship-edge.ts`

`POST /api/relationships/edge` (US-003) takes a typed edge authored by dragging
one entity onto another (source, target, relationship_type, time range,
confidence) and lands it in the **contribution review queue** (never a direct TSV
write) with provenance `entityData.source = 'user-authored'`; a reviewer promotes
it into `cultural-lineages.tsv`. Same pure-service + injectable-route shape as
timeline-event/drawn-geometry — differences to know:

- **Vocabulary is the canonical edge vocabulary**, not a local list:
  `RELATIONSHIP_TYPE_OPTIONS` is derived from `@shared/canonical-schema`
  `CANONICAL_SCHEMA.edgeTypes` (14 kebab names + Neo4j tokens). Reuse it for any
  "pick a relationship type" UI so authored edges stay export-compatible.
- **Dedup is enforced server-side against corpus + queue.** The route builds the
  existing-edge set from `extractAllCanonicalEdges(lexiconsDir)` (`services/canonical-edges`,
  ~5.6k edges live) **plus** every queued `relationship` contribution, then the
  pure `validateRelationshipEdge(input, existing)` rejects a duplicate
  `(sourceId, targetId, relationshipType)` triple. **Direction matters** —
  `A→B` and `B→A` are distinct; dedup key is `edgeKey()` (trim-normalized ids).
- **Self edges** (`sourceId === targetId`) are rejected in the validator.
- **Status codes:** 201 (queued, returns a `relationship` confirmation summary
  with the Neo4j token), **409** on a duplicate (`duplicate: true`), 400 on other
  validation errors (self edge, non-canonical type, inverted range).
- Route takes injectable `{ contributions, lexiconsDir }` — tests point both at
  temp dirs (seed a `cultural-lineages.tsv` in the temp lexicons dir to exercise
  corpus dedup). Added `relationship` to `ContributionEntityType` +
  `REQUIRED_FIELDS` (`["sourceId","targetId","relationshipType"]`).
- Client entry: `client/src/components/visualizations/RelationshipBuilderPanel.tsx`
  (HTML5 drag-and-drop palette → source/target drop slots → form), mounted behind
  a "Build relationship" toggle in `CulturalLineageExplorer.tsx` (fed `graph.nodes`).

## URL-paste extractor — `services/url-extractor.ts` + `routes/url-extractor.ts`

`POST /api/extract/url` (US-004) turns a pasted **Wikipedia/Wikidata** URL into a
structured entity **draft** (name, description, coordinates, dates,
relationships, each with a 0..1 confidence) and lands it in the **contribution
review queue** flagged `entityData.aiGenerated/autoDerived` + `source='auto-derived'`
— never a live write. Reuse notes:

- **Single-entity resolution is NOT SPARQL.** A pasted URL is one entity, so
  Wikidata is resolved via the REST endpoint `Special:EntityData/<QID>.json`
  (`liveDeps.fetchWikidataEntity`), not the Query Service. The statement →
  field vocabulary (P571 inception→start year, P625→lat/lng, P144/P737/P279→
  relationships, …) is kept **aligned with culture-scrape's hydration profile**
  (`packages/culture-scrape/.../acquire/wikidata_hydration.py`). Bulk SPARQL *set*
  acquisition stays culture-scrape's job (US-005) — don't add a TS SPARQL client.
- **Network is behind an injectable `UrlExtractorDeps`** (`fetchWikidataEntity` +
  `fetchWikipediaPage`); tests pass fixture-backed deps reading
  `services/fixtures/url-extractor/*.json` (recorded WD entity + WP summary
  payloads) — no live fetch. Default `liveDeps` hit the real REST APIs.
- **Wikipedia flow**: resolve the article → its `wikibase_item` QID via the REST
  summary endpoint, then extract from that Wikidata entity (WP summary `extract`
  overrides the WD description). No item ⇒ a summary-only draft.
- Pure helpers are unit-tested directly: `parseSourceUrl`, `parseWikidataYear`
  (BCE = negative), `draftFromWikidataEntity`, `draftToContribution` (defaults
  `entityType='civilization'` — name-only-safe; route whitelists a few overrides),
  `overallConfidence` (mean field confidence → 1..99, always < 100 so drafts read
  as needs-review). Route: 201 `{ draft, contribution }`, 400 on a bad URL /
  unsupported entityType, **502** on a source/network failure.

## culture-scrape Wikidata bulk acquisition — `services/culturescrape-acquisition.ts` + `routes/culturescrape-acquisition.ts`

`POST /api/scraping/culturescrape` (US-005) triggers **culture-scrape's** Wikidata
SPARQL acquisition of one domain (civilizations / sites / figures / trade-goods);
`GET /api/scraping/culturescrape/categories` lists them. Reuse notes for any
"trigger a background scraper from the dashboard" feature:

- **Bulk SPARQL stays in Python — never add a TS SPARQL client.** The live runner
  (`liveJobRunner`) writes a culture-scrape category spec (`buildCategorySpecYaml`,
  matching `packages/culture-scrape/categories/*.yml`) to a temp file and spawns
  `python -m culturescrape.cli fetch <spec> --out <dir>` (cwd = package dir,
  `PYTHONPATH` includes its `src`; `python`/`packageDir`/`timeout` overridable via
  `CULTURESCRAPE_{PYTHON,DIR,FETCH_TIMEOUT_MS}` env). It reads back the
  `<id>.jsonl` records + `<id>.report.json`. Single-**entity** lookups still use the
  REST `Special:EntityData` endpoint (`url-extractor.ts`); only bulk **sets** shell out.
- **The runner is an injectable boundary** (`CultureScrapeJobRunner.runFetch`) so
  the whole pipeline is unit-tested with a fake returning recorded `RawRecord`s —
  no subprocess, no network. `runAcquisitionJob` (pure over runner + an injectable
  `ContributionService`) fetches then maps each record → `Partial<Contribution>`
  and enqueues it; it returns `{acquired, queued, skipped, contributionIds, report}`.
- **Acquired records land in the contribution review queue**, never a live TSV
  write — flagged `entityData.source='culturescrape-wikidata'` + `autoDerived:true`
  (`aiGenerated:false` — it's a structured source, not an LLM), confidence clamped
  to 1..99 so it reads as needs-review. `recordToContribution` returns `null` to
  **skip** a row with no label (Wikidata's label service echoes the QID for
  unlabeled items — filter `name === qid`) or a missing required coordinate.
- **`RawRecord` shape** (culture-scrape `.jsonl`): `{fields:{item,itemLabel,image,
  coord,qid}, provenance:{source,source_url,source_query,retrieved_at,confidence,
  license}}`. `coord` is WKT `Point(lng lat)` — `parseWktPoint` → `{lat,lng}`
  (note the lng/lat order swap).
- **Coordinate-required domains** (sites → `archaeological-site`, which needs a
  truthy `coordinates`) bind `wdt:P625` as a **required** triple in the SPARQL so
  every returned row has one; other domains make it OPTIONAL. Added
  `historical-figure` + `trade-good` (both `["name"]`) to `ContributionEntityType`
  + `REQUIRED_FIELDS`; `civilization` (name-only) is reused for civilizations.
- **Progress streams through the existing `jobStore`** (dashboard polls
  `GET /api/scraping-jobs` every 2s) — the route creates a job
  (`languageId='culturescrape:<domain>'`, `dataSource='other'`), runs
  `runAcquisitionJob` fire-and-forget, and maps `onProgress` →
  `updateJob({statusMessage, completedWords=queued, failedWords=skipped, totalWords})`.
  **Route test hook:** `onJobSettled(jobId, result, error)` lets a test await the
  background job deterministically instead of polling. POST returns **202**; **400**
  on unknown domain / non-positive limit. Client entry: the "Wikidata Bulk
  Acquisition" card in `client/src/pages/scraper-dashboard.tsx` (Start Scraping tab).

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
