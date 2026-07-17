# shared/ — cross-cutting contracts

Code here is imported by both `server/` and `client/` (alias `@shared/*`).

## Canonical convergence schema

- `canonical-schema.json` is the **machine-readable source of truth** for the shared
  culture-scrape ↔ pinakes node/edge model. `canonical-schema.ts` types it and
  exposes accessors (`nodeHeaderRow`, `edgeHeaderRow`, `*ProvenanceColumns`,
  `nodeTypeByName`, …). Consume from `@shared/canonical-schema`; never fork the JSON.
- Column contracts mirror culture-scrape's Neo4j-import headers
  (`packages/culture-scrape/.../schema/headers.py`). Prose + mapping tables live in
  `docs/canonical-schema.md`.
- `lexicon-mapping.json` (US-002) is the machine-readable **lexicon → canonical** map:
  every `lexicons/*.tsv` gets a `kind` (node/edge/attribute/excluded), a node type, and a
  per-column disposition (`target` canonical field / `edge` type / `property` / `drop`).
  Consume via `@shared/lexicon-mapping` (`lexiconMappingByFile`, `nodeFiles`, `edgeFiles`,
  `assertValidLexiconMapping`). US-003 (`server/services/canonical-edges.ts`) reads the `edge`
  dispositions **and** the edge-table `target` dispositions (`:START_ID`/`:END_ID`/`:TYPE`/
  `time_start`/`confidence`/`source`) to emit `CanonicalEdge` records; free-text relationship
  vocabularies (e.g. `evolved-into`, `substrate`) are aligned to canonical edge types by the
  local `EDGE_TYPE_VALUE_MAPS` there. US-004 (export) reads `target`/`property`. Totality vs the
  live TSVs is enforced by the test, which
  reads headers from `resolve(process.cwd(), "lexicons")` and compares **unique** column names
  (some source headers, e.g. `words-base.tsv`, have duplicate columns).
- **US-004 export** (`scripts/export-for-culturescrape.ts`) consumes the node `target`/`property`
  dispositions here + `server/services/canonical-edges` to emit `export/culturescrape/` canonical
  TSVs. See `scripts/CLAUDE.md`.

## Confidence rubric (tiered-trust, US-001)

- `confidence-rubric.json` is the **single source of truth for what a `confidence` number
  means** — a per-provenance-class prior (`qid-anchored` 1.0 → `stub-needs-curation` 0.0),
  replacing the old blanket per-source constants. `confidence-rubric.ts` types it and exposes
  `confidenceForClass(cls, {scale})` (0–1, or `{scale:100}` for the archaeological lexicons'
  0–100 columns) / `confidenceCellForClass(...)` (string cell) / `assertValidConfidenceRubric()`.
  Consume via `@shared/confidence-rubric`; **never hard-code a confidence literal** — name the
  class instead, so every tier is tuned in one place.
- **Stampers:** the TS acquire/curate scripts (`scripts/acquire-*.ts`, `curate-*.ts`), the
  export's `DEFAULT_NODE_CONFIDENCE` / stub confidence, and `canonical-edges` `DEFAULT_EDGE_CONFIDENCE`.
- **Python mirror:** `packages/culture-scrape/src/culturescrape/confidence.py` (`confidence_for(cls)`),
  used by the acquire adapters + `named_in` linker; kept in lockstep with the JSON by
  `packages/culture-scrape/tests/test_confidence.py` (skips parity when the sibling JSON is absent).
- **GOTCHA — priors are chosen to preserve historically-emitted values** (grandfathering), so the
  export manifest stays byte-identical. If you re-calibrate a tier, the affected acquire scripts
  re-emit and you must regenerate the committed snapshots (export manifest + reconciliation report)
  and the Python mirror. Rubric prose lives in `docs/canonical-schema.md` §4.4.

## Trust tiers (tiered-trust, US-004)

- `trust-tier.ts` is the **single TS source of truth for the trust-tier policy** — the mirror of
  culture-scrape's `orchestrate/tiers.py` `classify_tier`. `classifyTrustTier({source, wikidataQid,
  sourceUrl, isEdge})` is a pure, dependency-free function of the *already-canonical* provenance
  columns (so `tier` is **derived**, never a stored column). Precedence must stay byte-identical to
  the Python: `inferred:` prefix → `inferred`; a `pinakes` source token → `curated`; else a
  node auto-admits iff QID-anchored **and** reference-backed (an edge on a citation alone), else
  `quarantine`. `ALL_TRUST_TIERS` / `TRUST_TIER_META` / `trustTierMeta(tier)` give the ordered
  list + display label/description. Consume via `@shared/trust-tier`.
- **Two app surfaces call it** (keep them in sync with the classifier, don't re-implement):
  the client provenance module `client/src/lib/graph/provenance.ts` (`provenanceTier(prov, isEdge)`,
  rendered by `ProvenanceBadge`/`ProvenanceList`/`TrustTierBadge`) surfaces the tier on graph
  detail/explorer panels + `global-search.ts` (`graphHitTier` on graph hits, local hits are
  `curated` by definition); and `server/services/data-quality-scorer.ts` (`computeCorpusTiers` /
  `buildCorpusTierReport`) reports corpus composition by tier.
- **GOTCHA — the app corpus is entirely `curated`.** Auto-admission never writes `lexicons/*.tsv`,
  so every exported lexicon row is `source=pinakes` → `curated` in the graph. The corpus-tier
  report therefore tracks **auto-admission readiness** (classify each curated node row by its own
  provenance, `source` omitted → `auto-admitted` iff QID + `source_url`, else `quarantine`) — the
  growth metric, not the graph tier. Committed snapshot `docs/corpus-tier-report.json`
  (`scripts/corpus-tier-report.ts`), asserted against the live corpus by
  `data-quality-scorer.test.ts`; regenerate after a node-lexicon QID/URL coverage change.

## Canonical schema v1.2 — the asset node + personal-media edges (analyzer-bridge US-003)

`canonical-schema.json` is at **v1.2.0**: it adds the `asset` node type (label `Asset`, the
`sha256:` id-space — a content-addressed media node, technical props ride in overflow) and the
`depicts`/`mentions` (`DEPICTS`/`MENTIONS`) edge types (`from: ["asset"]`, unconstrained `to`).
These are the Analyzer-bridge personal-media vocabulary. Bumping the schema version / node+edge
vocab has a **cross-language blast radius** — when you touch node/edge types again, update in
lockstep (all pinned by tests):

- TS: `shared/canonical-schema.test.ts` `EXPECTED_NODE_TYPES`/`EXPECTED_EDGE_TYPES` + the
  version assertion; `shared/predicate-mapping.json` `pending` flags + `pendingSchemaAdditions`
  (the validator throws the instant a `pending` type resolves — flip it) + `predicate-mapping.test.ts`.
- Python (`packages/culture-scrape`): the edge `:TYPE` vocab lives in `ontology/registry.py`
  (`REGISTRY`, pinned by `test_ontology_registry.py`) **and** must be documented in
  `docs/ontology.md` (pinned by `test_ontology_doc.py`); `schema/mapper.py` `PINAKES_EDGE_TYPE_MAP`
  (cover every exported edge :TYPE). The version + from/to bake into three regenerated,
  test-pinned artifacts: `datalog/schema/edge_constraints.tsv`, `datalog/schema/rules_registry.tsv`,
  `datalog/rules_registry.tsv` (regenerate via their `write_*`/`build_registry` fns). A node
  `:LABEL` needs no Python allowlist change (nothing rejects `Asset`).

## Gotchas

- **JSON imports widen string literals to `string`**, so `import x from './f.json'
  satisfies SomeType` fails when the type uses string-literal unions. Assert with
  `as SomeType` and add a runtime validator (see `assertValidCanonicalSchema`) for
  enum-level checks. `resolveJsonModule` is enabled in `tsconfig.json`.
- **`npm run check` (tsc) has a large pre-existing error baseline** (~145 errors in
  `server/tsv-storage.ts`, `shared/computation.ts`, etc.). Judge your change by whether
  it adds *new* errors in the files you touched, not by a zero exit. Scope tests with
  `npx vitest run <path>`.
