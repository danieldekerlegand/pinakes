# shared/ — cross-cutting contracts

Code here is imported by both `server/` and `client/` (alias `@shared/*`).

## Canonical convergence schema

- `canonical-schema.json` is the **machine-readable source of truth** for the shared
  culture-scrape ↔ LinguaScrape node/edge model. `canonical-schema.ts` types it and
  exposes accessors (`nodeHeaderRow`, `edgeHeaderRow`, `*ProvenanceColumns`,
  `nodeTypeByName`, …). Consume from `@shared/canonical-schema`; never fork the JSON.
- Column contracts mirror culture-scrape's Neo4j-import headers
  (`packages/culture-scrape/.../schema/headers.py`). Prose + mapping tables live in
  `docs/canonical-schema.md`.
- `lexicon-mapping.json` (US-002) is the machine-readable **lexicon → canonical** map:
  every `lexicons/*.tsv` gets a `kind` (node/edge/attribute/excluded), a node type, and a
  per-column disposition (`target` canonical field / `edge` type / `property` / `drop`).
  Consume via `@shared/lexicon-mapping` (`lexiconMappingByFile`, `nodeFiles`, `edgeFiles`,
  `assertValidLexiconMapping`). US-003 (edge extraction) reads the `edge` dispositions; US-004
  (export) reads `target`/`property`. Totality vs the live TSVs is enforced by the test, which
  reads headers from `resolve(process.cwd(), "lexicons")` and compares **unique** column names
  (some source headers, e.g. `words-base.tsv`, have duplicate columns).

## Gotchas

- **JSON imports widen string literals to `string`**, so `import x from './f.json'
  satisfies SomeType` fails when the type uses string-literal unions. Assert with
  `as SomeType` and add a runtime validator (see `assertValidCanonicalSchema`) for
  enum-level checks. `resolveJsonModule` is enabled in `tsconfig.json`.
- **`npm run check` (tsc) has a large pre-existing error baseline** (~145 errors in
  `server/tsv-storage.ts`, `shared/computation.ts`, etc.). Judge your change by whether
  it adds *new* errors in the files you touched, not by a zero exit. Scope tests with
  `npx vitest run <path>`.
