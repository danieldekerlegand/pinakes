# Explorer dataset adapters

The UnifiedExplorer is adapter-driven: a new dataset is a `DatasetAdapter` here
(declare dimensions; the generic visualizations follow). Don't hand-build
per-dataset panels. Register the adapter in `registry.ts` (`ADAPTERS`) — that is
all the picker needs.

## The fetch/projection contract (read before authoring)

- **The explorer does ONE GET.** `UnifiedExplorer.tsx` fetches `adapter.endpoint`
  with **no id/params** (`queryKey=[endpoint]`, plain `fetch`), then
  `adapter.unwrap(json)` → rows → `adapter.project(rows, {searchQuery, facetFilters})`.
  There is no per-id fetch, so the endpoint must return the whole dataset in one
  response.
- **`unwrap` returns `TRaw[]` and `project` only sees those rows** — no side
  channel. If a projection needs data that isn't per-row (e.g. graph edges),
  embed it into each row (e.g. `row = {node, incidentEdges}`) and dedup inside
  `project`.
- **`detail(payload)`** receives whatever a projection item put in its `payload`.
  Set `payload: row` consistently across **all** dimensions so `detail(row)`
  always works regardless of which visualization the click came from.
- **Facet dropdown options come only from `categorical` rows' STRING facet
  values** (the `facetOptions` loop keeps `typeof v === "string"`). Every
  `filterableFacets` key must therefore appear as a string in
  `categorical[].facets`, and `project` must actively filter on those keys from
  `opts.facetFilters` — declaring a facet does **not** auto-filter.

## Dimensions & compatibility

- Compatibility is a pure dimension-subset check (`compatibility.ts`): declaring
  all of `temporal|spatial|relational|hierarchical|categorical` makes the adapter
  render through every `Generic*` visualization. Only declare a dimension you
  actually project into.
- `registry.ts` casts each adapter `as DatasetAdapter` because
  `DatasetAdapter<T>` isn't assignable to `DatasetAdapter<unknown>` under strict
  contravariance. In tests, pull the entry from `ADAPTERS` (already widened)
  rather than casting.

## Testing

The repo has **no jsdom/testing-library** (vitest env=node, `include=**/*.test.ts`).
"Adapter tests" test the pure `unwrap`/`project`/`detail` functions and
`compatibleVisualizations`, not DOM rendering. See `culturescrape.adapter.test.ts`.

## GeoJSON-endpoint adapter (`civilizations.adapter.ts`)

The civilizations dataset is the only adapter whose `endpoint` returns a GeoJSON
`FeatureCollection` (`/api/map/civilizations`) rather than a `{rows}` envelope —
so `unwrap` reads `resp.features`, and every projection/`detail` works over the
feature's `.properties`. Reuse notes for any map-GeoJSON dataset:

- **`payload: feature` on every dimension** (temporal/spatial/categorical) so
  `detail(feature)` is uniform regardless of which viz the click came from.
- **Provenance in `detail()`**: `detail` returns a `provenance: Provenance`
  (`@/lib/graph/provenance`) so the UnifiedExplorer renders `<ProvenanceList>`
  (`data-testid="provenance-list"`). Build it from the row's own columns
  (Wikidata `wikidataQid`/`sourceUrl`/`retrievedAt`/`confidence`, else fall back
  to `sources[0]`); return `undefined` when nothing is attributable so the panel
  omits the block. This is what surfaces the US-003 write-back provenance in-app.
- **Placeholder geometry**: `server/tsv-storage.ts` stamps a tiny
  `[[[0,0],[0,1],[1,1],[1,0],[0,0]]]` polygon for a civ with no curated boundary.
  The adapter's `isPlaceholderGeometry` drops those from the **spatial** projection
  only (they'd all pile at ~[0.5,0.5]); they still appear in temporal/categorical.
- **The map-layer type is shared client↔server**: `CivilizationProperties`
  (`geospatial-types.ts`) is imported by `server/tsv-storage.ts`, so a new
  server-emitted field must be added there as an OPTIONAL property first (else the
  server `tsc` breaks). The loader only emits a provenance column when the header
  has it — so adding a `data/source/lexicons/civilizations.tsv` column is enough.

## Shared-graph adapter (`culturescrape.adapter.ts`)

Fetches `/api/graph/overview` (`{nodes, edges}` from Neo4j). Reuses the US-007
payload types + `primaryLabel` from `@/lib/graph/neighborhood-graph` (that module
only `import type`s NetworkGraph, so it pulls no d3 into the eager bundle). It is
the only adapter that depends on a live backend — when the graph is offline the
single GET 503s and the explorer shows its error state.
