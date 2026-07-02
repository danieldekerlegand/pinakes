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
