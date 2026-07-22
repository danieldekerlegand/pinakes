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

## KCB capability manifest — `capability-manifest.json` + `capability-manifest.ts`

The Koine capability-bus manifest Pinakes publishes as the `pinakes:agent:resolver` authority
provider (`koine/specs/capability-bus.md` §2/§6). Same JSON-source-of-truth + typed-accessor +
runtime-validator shape as `predicate-mapping`/`canonical-schema` — full contract in
`docs/capability-bus.md`, served by `server/routes/capability-bus.ts`.

- **It is a surface wrapper, and the validator enforces that.** Every capability must declare
  ≥1 `x_surfaces` entry naming an already-built route + the merged file implementing it, so a
  capability can never be advertised with nothing behind it. Adding a capability means pointing
  at code that exists, not writing new code here.
- **The produced entity port is total over `canonical-schema.json` `nodeTypes`** — add a
  canonical node type and `assertValidCapabilityManifest` fails until the port lists it too
  (an unlisted entity is undiscoverable on the bus). Capability-level ports use the `"*"`
  wildcard (`ENTITY_TYPE_WILDCARD`) instead of restating the list.
- **Knowledge ports are pinned to `grounding-only` + a `pinakes:world:*` world.** The validator
  rejects a higher dialect tier or a foreign world, so an accidental `full-prolog` or
  `insimul:world:…` port can't be published.
- **Pass the manifest through, don't read module state.** `assertValidCapabilityManifest(m)`
  and the `produced*Port` accessors all take the manifest as a parameter — an accessor that
  closed over `CAPABILITY_MANIFEST` silently validated the live doc instead of the clone under
  test (caught by the mutation tests; keep that pattern for any new check).
- Spec-conformant keys stay spec-named (`kcb_version`, `grants_required`); Pinakes-local
  additions are `x_`-prefixed (`x_pinakes`, `x_surfaces`, `x_grant`, `x_produced_by`) so the
  document can be served verbatim to a registry.

## Predicate-mapping registry — `predicate-mapping.json` + `predicate-mapping.ts`

The bridge contract between the canonical node/edge vocabulary and the relation vocabularies of
the projects pinakes bridges (`projects.analyzer`, `projects.insimul`). Same JSON + typed-accessor +
runtime-validator shape as `canonical-schema`/`capability-manifest`, with one difference that
governs how you edit it:

- **The JSON is a generated MIRROR, not a source.** The authoritative copy is koine
  `registry/predicate-mapping.json` (the file declares it in its own `canonicalHome`/`mirrors`
  blocks). Never hand-edit `shared/predicate-mapping.json` — upstream the correction to koine,
  bump its `registryVersion`, then re-vendor with a plain `cp`. The drift gate in
  `predicate-mapping.test.ts` compares the two **byte-for-byte** and `skipIf`s when no koine
  checkout is present (`KOINE_ROOT`, else `~/Development/koine`) — the same skipif-gated
  sibling-checkout pattern as the Python confidence-rubric parity test.
- **Two axes, not one** (registryVersion ≥ 0.3.0): per-entry `dialect` (`grounding-only` ⊂
  `horn-safe` ⊂ `full-prolog` — what a consumer may *evaluate*) and `egress` (`exportable` /
  `local-only` — whether it may *leave*). `local-only` is an **egress class, not a fourth dialect
  tier**; the pre-0.3.0 `portabilityClasses` array is gone. Trust tiers are a *third*, unrelated
  axis carried on provenance (see `trust-tier.ts`) — do not conflate the three.
- **The registry never coins relation names.** An `edge`/`derived-rule` entry crosses as a KGP
  claim and must name its koine relation(s) in `koineRelations`; every other kind must name none.
  The validator resolves each against `kgp.ts`'s vendored vocabulary (`KGP_CORE_RELATIONS` +
  `KGP_DOMAIN_RELATIONS`), so closing a vocabulary gap means **adding a row to koine's
  `relations.tsv` / `relations/<domain>.tsv`** and re-vendoring both files. A domain prefix is the
  TSV's `domain` column, **not** its file stem (`relations/cinematography.tsv` → `cine:`).
- **`pending` is a live checklist against `canonical-schema.json`** (see the v1.2 section above):
  a `pending: true` type must be listed in that project's `pendingSchemaAdditions` *and* must not
  yet resolve; flipping either without the other fails validation. Insimul's block is the open
  one — the v1.3 `character`/`building`/`business` nodes + genealogy/employment/residence/causality
  edges land with `insimul-bridge` US-003.
- **A bridged predicate the producer has not shipped is allowed, not a failure** — the registry is
  authored partly from a design draft. `unverifiedPredicates(project, catalog)` flags them for a
  human; `assertValidPredicateMapping` never consults it. The test cross-checks against Insimul's
  `predicate-schema.ts` when that checkout exists (`INSIMUL_ROOT`).

## KGP grounding-pack contract — `kgp.ts`

The pinakes side of `koine/specs/grounding-pack.md` (0.4.0): the **normative** §3 claim
normalization + §3.1 claim ids, §2.1 pack identity, the vendored core relation registry, the
KINP identifier forms, and the §7.1 licence-class policy. Consumed by
`scripts/export-entity-grounding.ts`; prose in `docs/grounding-pack.md`.

- **Never hand-roll a claim id or a pack hash.** Cross-producer dedup works only if every
  project reduces a claim to the identical byte string first — `claimHashInput` is that string
  and `mintClaimId`/`mintPackId` are the only way to mint. Confidence, provenance, licence and
  embeddings are **excluded** from the claim hash on purpose (the same fact from two producers
  must merge); `manifest.created`/`signing` are excluded from `pack_id` for the same reason.
- **Pure + hasher-injected.** `sha256` is a parameter (`Sha256Hex`), so this module — like every
  other file in `shared/` — imports no node builtin and stays client-safe. The caller supplies
  `node:crypto`.
- **`KGP_CORE_RELATIONS` is vendored from koine `registry/relations.tsv`**, not fetched, so ids
  can be minted offline. A published signature is **immutable** (changing arity/symmetry would
  silently change every dependent claim id) — upstream changes arrive as *new* relation names,
  new rows are additive. Each row carries a dialect tier; `assertRelationAllowed` keeps a
  `horn-safe` relation out of a `grounding-only` pack.
- **Only namespace and kind of a CURIE are case-folded** (KGP §3.2 rule 3). `wikidata:ent:Q150`
  keeps its `Q` — an external authority's local id is not ours to lowercase. Our own locals are
  lowercased + percent-encoded by `csidToKinpCurie` per `docs/canonical-schema.md` §3.1.

## Gotchas

- **JSON imports widen string literals to `string`**, so `import x from './f.json'
  satisfies SomeType` fails when the type uses string-literal unions. Assert with
  `as SomeType` and add a runtime validator (see `assertValidCanonicalSchema`) for
  enum-level checks. `resolveJsonModule` is enabled in `tsconfig.json`.
- **`npm run check` (tsc) has a large pre-existing error baseline** (~145 errors in
  `server/tsv-storage.ts`, `shared/computation.ts`, etc.). Judge your change by whether
  it adds *new* errors in the files you touched, not by a zero exit. Scope tests with
  `npx vitest run <path>`.
