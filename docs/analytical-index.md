# Runtime analytical index (DuckDB over the TSVs)

_Story: US-001 (tasklist 13 — platform & infrastructure)._

pinakes keeps `data/source/lexicons/*.tsv` as the **single source of truth** (loaded by
`server/tsv-storage.ts`). Heavy *tabular* work — facet counts, `GROUP BY`
aggregates, ad-hoc analytical SQL — used to mean re-parsing files and looping in
JS on every request. The **analytical index** (`server/services/analytical-index.ts`)
is a runtime, in-memory **DuckDB** mirror of those TSVs that answers that class of
query in one indexed pass.

It is **derived and read-only**: it never writes back to the TSVs and is not on
the TSV write path. Dropping it changes nothing about the data — only query speed.

## Division of labour

| Query kind                                   | Backend                                            |
| -------------------------------------------- | -------------------------------------------------- |
| tabular / aggregate (faceting, counts, sums) | **this DuckDB index**                              |
| graph / correlation (neighborhoods, paths)   | **Neo4j** (`server/services/graph-store.ts`)       |
| CPU-domain (linguistic distance, etymology)  | **TypeScript** (stays in-process)                  |

See `docs/engine-integration.md` for the broader system-of-record split.

## How the mirror stays faithful to the TSVs

DuckDB reads each TSV **byte-faithfully**, matching `tsv-storage.ts`'s `parseTsv`
(a plain `split("\t")`):

- `delim='\t'`, `header=true` — one table per file, columns from the header row.
- `all_varchar=true` — every column is `VARCHAR`, so index cells compare `===` to
  the raw string cells the in-memory loaders use (no type coercion drift).
- `quote='', escape=''` — quoting/escaping disabled; a cell containing `"` is kept
  literally, exactly as `split("\t")` would.
- `nullstr` = an impossible sentinel — so **empty cells stay `""`, never `NULL`**.

Table names are the sanitized file base name: `language-ranges.tsv` →
`language_ranges` (`tableNameForFile`). This is the only place a filename touches
SQL; column names are validated against the table's real header before use.

## Incremental rebuilds

The index tracks each table's source-file **mtime + size**. `refresh()` re-syncs
the index with the directory:

- a **new** `*.tsv` → its table is built (`rebuilt`);
- a **changed** `*.tsv` (mtime or size differs) → its table is rebuilt in place
  via `CREATE OR REPLACE TABLE` — only that one table, not the whole corpus;
- a **removed** `*.tsv` → its table is dropped (`dropped`);
- an **unchanged** file → skipped (no DuckDB work).

`refresh()` returns `{ rebuilt, dropped }` so callers can log/react. It is cheap
enough to call on demand (e.g. after a scraper writes a TSV, or on a timer) to
pick up edits without restarting the server.

> Cache-invalidation rule of thumb: whatever writes a `data/source/lexicons/*.tsv` should call
> `getAnalyticalIndex().then(i => i.refresh())` afterwards, or the index serves the
> previous snapshot until the next refresh / restart.

## Lifecycle

- **Startup:** `server/index.ts` warms the singleton after `listen()` so the first
  faceted request doesn't pay the build cost. Warm-up failure is non-fatal — the
  build just defers to first use.
- **Singleton:** `getAnalyticalIndex()` builds once (concurrent first-callers share
  the build) over `LEXICONS_DIR` (default `./data/source/lexicons`).
- **Shutdown:** `closeAnalyticalIndex()` releases the DuckDB connection + instance
  (wired into the `SIGTERM`/`SIGINT` handler alongside the Neo4j driver).

## HTTP surface (`/api/analytics/*`)

- `GET /api/analytics/tables` — indexed tables with columns + row counts.
- `GET /api/analytics/facets/:table/:column` — facet counts (distinct value → row
  count, ordered by count desc). Unknown table/column → `404`.

Faceted global search (US-005) is the primary consumer and routes its facet
counts through `AnalyticalIndex.facetCounts` / `query`.

## Testing

`server/services/analytical-index.test.ts` builds an index over a temp-dir fixture
corpus and asserts **query parity**: every facet/aggregate result is checked
against an independent pure-JS reference that re-parses the same TSV the way
`tsv-storage.ts` does. Tests also cover blank-cell handling, ordering, parameter
binding, and incremental refresh (add / change / remove a file). DuckDB runs fully
in-memory — no network, no on-disk database.
