# scripts/ — one-off / build-time tooling

Standalone TS run with `tsx` (e.g. `npx tsx scripts/<name>.ts`). Tests run under vitest.

## Type-checking

- **`scripts/` is excluded from the root `tsconfig.json` `include`, so `npm run check`
  does NOT type-check anything here.** Type-check scripts explicitly with
  `npx tsc -p scripts/tsconfig.json` (0 errors expected — keep it that way).
- `scripts/tsconfig.json` sets `baseUrl: ".."` + `paths` for `@shared/*` and `@/*`, so
  scripts may import `@shared/...` and cross-workspace files (e.g.
  `../server/services/...`). At runtime, `tsx` resolves `@shared` via the root tsconfig
  paths, and vitest resolves it via its own alias config — a plain `@shared` import works
  in all three (tsc/tsx/vitest).

## Conventions

- Main-module guard (run-as-CLI): `if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) { ... }`.
- Resolve repo paths from `import.meta.dirname` (e.g. `path.resolve(import.meta.dirname, "..")`).
- Keep the data-transform core **pure over an input dir** (e.g. `buildExport(lexiconsDir)`)
  and put filesystem writes in a thin `writeExport`/`runExport` wrapper — tests then drive
  the core with temp-dir fixtures (`fs.mkdtempSync`) and assert without touching real output.

## Canonical export (US-004)

`export-for-culturescrape.ts` emits `export/culturescrape/{nodes,edges}/<type>.tsv`
(gitignored) + `manifest.json`, and a committed manifest snapshot at
`docs/culturescrape-export-manifest.json`. It reuses `@shared/lexicon-mapping` (node
`target`/`property` dispositions) and `server/services/canonical-edges`
(`extractAllCanonicalEdges`) for edges. csid = `cs:<node-type>:<linguascrape-id>`; edge
endpoints are rewritten to node csids via a `linguascrape_id → csid` index built during the
node pass — endpoints with no exported node are counted + sampled in the manifest, never
emitted (keeps output `neo4j-admin import`-clean). Output is idempotent (rows sorted, no
wall-clock written). Combined `*coordinates` JSON cells (`{"lat":..,"lng":..}`) split into
`lat`/`lon`.

## Provenance propagation (US-006)

The export stamps all four provenance columns on **every** node and edge (values may be
blank, the column is always present). Rules:

- `source` = `linguascrape` (acquisition-source id) on 100% of rows — the reconciler
  anchor **and** culture-scrape's `validate.py` requires a non-empty `source`.
- The lexicon column mapped to canonical `source` actually holds **bibliographic
  citations**, not the adapter id. `parseCitation()` reshapes it (JSON array → `"; "`-joined)
  and it is preserved into the node **`source_query`** column — never dropped. `source` is
  in `PROVENANCE_FORCED_FIELDS` so the citation column is *not* read as `source`; it is read
  explicitly via `mapping.columns.find(c => c.target === "source")`.
- `source_url` = `deriveSourceUrl(...)`, which returns the first real `http(s)` URL found
  in the citation/cells, else `""`. **Never fabricate a URL.** Live corpus: 0 rows have one.
- `retrieved_at` = `""` (LinguaScrape records no retrieval timestamp).
- Edges have **no `source_query`** column (culture-scrape's edge schema omits it), so an
  edge that carried a citation is counted in `manifest.provenance.edge.citationsWithoutCanonicalColumn`
  (never silently dropped; embedded-FK edges keep it on the host node's `source_query`).
- **Coverage metric** = `manifest.provenance` (per-type non-blank counts for each
  provenance column + a human-readable `flags` list). It is deterministic (integer counts,
  no wall-clock), so it lives in the committed manifest snapshot and is asserted against a
  fresh build by a live test — re-run the export CLI after any change touching provenance.

## Reconciliation dry-run (US-005)

`reconciliation-report.ts` emits the keys culture-scrape's reconciler keys on
(language `iso639_1`/`iso639_2`/glottocode; normalized `(name, type, region)` for
everything else) and a **dry-run** estimate — no network, no live graph — of how the
export lands: `matched` (global anchor), `likely-new` (unique name key), or `ambiguous`
(blocking-key collision, listed with competing candidates, **never auto-merged**). Output:
`export/culturescrape/reconciliation/{keys.tsv,report.json}` (gitignored) + a committed
snapshot `docs/reconciliation-report.json` (ambiguities bounded to 50). `buildReconciliation()`
is pure over a lexicons dir; it reuses `mintCsid`/`normaliseConfidence` from
`export-for-culturescrape.ts`. **Gotcha:** the committed snapshot is asserted against the live
corpus by a test — re-run the CLI (`npx tsx scripts/reconciliation-report.ts`) after any
change that shifts node counts/keys, or that live test fails. Region is read from the first
header ending in `region` (`region`/`origin_region`/`proposed_region`); LinguaScrape has no
glottocode column today, so language matching rests on the ISO codes. See
`packages/culture-scrape/docs/reconcile-linguascrape.md`.
