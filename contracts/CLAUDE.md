# contracts/ — cross-cutting contracts

Code here is imported by both `server/` and `web/` (alias `@contracts/*`).

## Generated bindings — `generated/*.ts` + `python/` (40-contracts-codegen US-1)

The `*.json` files are the language-neutral **source of truth** and each has a
generated binding on both sides, emitted by `scripts/gen-contract-bindings.ts`
(`npm run gen:contracts`, read-only `npm run check:contracts`):

- **`generated/*.ts`** — the literal vocabularies a JSON import cannot express
  (`import x from './f.json'` widens every string cell to `string`, the gotcha at
  the bottom of this file). `CanonicalNodeTypeName`, `CanonicalNodeLabel`,
  `CanonicalEdgeTypeToken`, `ConfidenceClassName` and the header-row constants
  live there; the hand-written `canonical-schema.ts` / `confidence-rubric.ts`
  re-export them and use them on the runtime path (`nodeHeaderRow()` *is* the
  generated `CANONICAL_NODE_HEADER_ROW`).
- **`python/`** — the `pinakes-contracts` uv workspace package, a **declared
  dependency** of both `pinakes-engine` and `pinakes` (`services/api`), so the
  Python half no longer transcribes contract values or walks `parents[n]` up to
  the repo root. Details in [`python/README.md`](./python/README.md).

Rules:

- **Never hand-edit a generated file.** Change the JSON, run `npm run gen:contracts`,
  commit both. Same discipline as the koine registry mirror.
- **Generation is deterministic** (no wall-clock, sources read in a fixed order), so
  a re-run on a clean tree is an empty diff — which is what the drift gate rests on.
- **The drift gate (US-2) is enforced twice**, so neither CI nor a local run can miss it:
  `scripts/gen-contract-bindings.test.ts` regenerates from `contracts/*.json` and
  byte-compares **every** emitted file (Python *and* TS) against the committed one, and
  `.chief/verify.sh` runs `npm run check:contracts` whenever the diff touches a neutral
  source, `generated/`, `python/`, or the generator. Unlike the koine registry mirror this
  guard needs no sibling checkout — everything it compares lives in this tree, so it never
  skips. Editing a source and not regenerating blocks the merge.
- **A neutral-source edit also runs BOTH languages' suites.** `contracts/python/` is a
  workspace dependency of `pinakes-engine` and `services/api`, so `verify.sh` treats a
  `contracts/*.json` change as a Python source change (and as a TS one — the contract tests
  run even though a not-yet-regenerated change ships no `.ts`).
- **The generated Python EMBEDS its literals**; it reads no JSON at import time, so
  an installed wheel needs no repo layout. Only `document()` (the three registries)
  and `contract_path` touch disk. That is why `pinakes_engine.schema.headers` can
  import the canonical columns at module scope.
- **Adding a source document** means adding its emitter *and* its entry in
  `CONTRACT_SOURCES` / the generated `index.ts` / `pinakes_contracts.__init__` —
  all three come out of the same generator, so it is one edit in one file.
- The Python side derives, rather than restates: `NodeSchema.canonical()` is
  `parse_column(...)` over the contract's own header cells, and
  `pinakes_engine.confidence` is a re-export. Consequently the first four
  assertions in `engine/tests/test_canonical_schema_parity.py` are now near-
  tautologies — the load-bearing ones are the last two (header module vs. the
  embedded agora translation engine).

## Canonical convergence schema

- `canonical-schema.json` is the **machine-readable source of truth** for the shared
  pinakes-engine ↔ pinakes node/edge model. `canonical-schema.ts` types it and
  exposes accessors (`nodeHeaderRow`, `edgeHeaderRow`, `*ProvenanceColumns`,
  `nodeTypeByName`, …). Consume from `@contracts/canonical-schema`; never fork the JSON.
- Column contracts mirror pinakes-engine's Neo4j-import headers
  (`engine/.../schema/headers.py`). Prose + mapping tables live in
  `docs/canonical-schema.md`.
- `lexicon-mapping.json` (US-002) is the machine-readable **lexicon → canonical** map:
  every `data/source/lexicons/*.tsv` gets a `kind` (node/edge/attribute/excluded), a node type, and a
  per-column disposition (`target` canonical field / `edge` type / `property` / `drop`).
  Consume via `@contracts/lexicon-mapping` (`lexiconMappingByFile`, `nodeFiles`, `edgeFiles`,
  `assertValidLexiconMapping`). US-003 (`server/services/canonical-edges.ts`) reads the `edge`
  dispositions **and** the edge-table `target` dispositions (`:START_ID`/`:END_ID`/`:TYPE`/
  `time_start`/`confidence`/`source`) to emit `CanonicalEdge` records; free-text relationship
  vocabularies (e.g. `evolved-into`, `substrate`) are aligned to canonical edge types by the
  local `EDGE_TYPE_VALUE_MAPS` there. US-004 (export) reads `target`/`property`. Totality vs the
  live TSVs is enforced by the test, which
  reads headers from `resolve(process.cwd(), "data", "source", "lexicons")` and compares **unique** column names
  (some source headers, e.g. `words-base.tsv`, have duplicate columns).
- **US-004 export** (`scripts/export-for-engine.ts`) consumes the node `target`/`property`
  dispositions here + `server/services/canonical-edges` to emit `build/corpus/` canonical
  TSVs. See `scripts/CLAUDE.md`.

## Confidence rubric (tiered-trust, US-001)

- `confidence-rubric.json` is the **single source of truth for what a `confidence` number
  means** — a per-provenance-class prior (`qid-anchored` 1.0 → `stub-needs-curation` 0.0),
  replacing the old blanket per-source constants. `confidence-rubric.ts` types it and exposes
  `confidenceForClass(cls, {scale})` (0–1, or `{scale:100}` for the archaeological lexicons'
  0–100 columns) / `confidenceCellForClass(...)` (string cell) / `assertValidConfidenceRubric()`.
  Consume via `@contracts/confidence-rubric`; **never hard-code a confidence literal** — name the
  class instead, so every tier is tuned in one place.
- **Stampers:** the TS acquire/curate scripts (`scripts/acquire-*.ts`, `curate-*.ts`), the
  export's `DEFAULT_NODE_CONFIDENCE` / stub confidence, and `canonical-edges` `DEFAULT_EDGE_CONFIDENCE`.
- **Python mirror:** `engine/src/pinakes_engine/confidence.py` (`confidence_for(cls)`),
  used by the acquire adapters + `named_in` linker; kept in lockstep with the JSON by
  `engine/tests/test_confidence.py` (skips parity when the sibling JSON is absent).
- **GOTCHA — priors are chosen to preserve historically-emitted values** (grandfathering), so the
  export manifest stays byte-identical. If you re-calibrate a tier, the affected acquire scripts
  re-emit and you must regenerate the committed snapshots (export manifest + reconciliation report)
  and the Python mirror. Rubric prose lives in `docs/canonical-schema.md` §4.4.

## Trust tiers (tiered-trust, US-004)

- `trust-tier.ts` is the **single TS source of truth for the trust-tier policy** — the mirror of
  pinakes-engine's `orchestrate/tiers.py` `classify_tier`. `classifyTrustTier({source, wikidataQid,
  sourceUrl, isEdge})` is a pure, dependency-free function of the *already-canonical* provenance
  columns (so `tier` is **derived**, never a stored column). Precedence must stay byte-identical to
  the Python: `inferred:` prefix → `inferred`; a `pinakes` source token → `curated`; else a
  node auto-admits iff QID-anchored **and** reference-backed (an edge on a citation alone), else
  `quarantine`. `ALL_TRUST_TIERS` / `TRUST_TIER_META` / `trustTierMeta(tier)` give the ordered
  list + display label/description. Consume via `@contracts/trust-tier`.
- **Two app surfaces call it** (keep them in sync with the classifier, don't re-implement):
  the client provenance module `web/src/lib/graph/provenance.ts` (`provenanceTier(prov, isEdge)`,
  rendered by `ProvenanceBadge`/`ProvenanceList`/`TrustTierBadge`) surfaces the tier on graph
  detail/explorer panels + `global-search.ts` (`graphHitTier` on graph hits, local hits are
  `curated` by definition); and `server/services/data-quality-scorer.ts` (`computeCorpusTiers` /
  `buildCorpusTierReport`) reports corpus composition by tier.
- **GOTCHA — the app corpus is entirely `curated`.** Auto-admission never writes `data/source/lexicons/*.tsv`,
  so every exported lexicon row is `source=pinakes` → `curated` in the graph. The corpus-tier
  report therefore tracks **auto-admission readiness** (classify each curated node row by its own
  provenance, `source` omitted → `auto-admitted` iff QID + `source_url`, else `quarantine`) — the
  growth metric, not the graph tier. Committed snapshot `docs/corpus-tier-report.json`
  (`scripts/corpus-tier-report.ts`), asserted against the live corpus by
  `data-quality-scorer.test.ts`; regenerate after a node-lexicon QID/URL coverage change.

## Canonical schema v1.2 / v1.3 — the bridge vocabularies

`canonical-schema.json` is at **v1.3.0**. Two bridges own its post-1.1 additions:

- **v1.2 (the media-analysis bridge)** — the `asset` node type (label `Asset`, the `sha256:`
  id-space; a content-addressed media node, technical props ride in overflow) and the
  `depicts`/`mentions` (`DEPICTS`/`MENTIONS`) edge types (`from: ["asset"]`, unconstrained `to`).
- **v1.3 (insimul-bridge US-003)** — the generated-world vocabulary: `character` / `building` /
  `business` node types (`Character`/`Building`/`Business`) and `parent-of` / `spouse-of` /
  `employed-by` / `resides-in` / `caused-by` (`PARENT_OF`/`SPOUSE_OF`/`EMPLOYED_BY`/`RESIDES_IN`/
  `CAUSED_BY`). `character` is the vocabulary's **first person-family type**. The genealogy /
  occupancy edges are endpoint-constrained; `caused-by` is deliberately **unconstrained** — a
  truth event has no canonical node type, so Bridge 2 anchors truths on `myth-motif` (the type
  the registry already pairs them with, entry 6) rather than coining an `event` type.

Bumping the schema version / node+edge vocab has a **cross-language blast radius** — when you
touch node/edge types again, update in lockstep (all pinned by tests):

- TS: `contracts/canonical-schema.test.ts` `EXPECTED_NODE_TYPES`/`EXPECTED_EDGE_TYPES` + the
  version assertion; `contracts/predicate-mapping.json` `pending` flags + `pendingSchemaAdditions`
  (the validator throws the instant a `pending` type resolves — flip it **upstream in koine**,
  then re-vendor) + `predicate-mapping.test.ts`. **A NODE type also needs
  `contracts/capability-manifest.json`** — its produced entity port is total over `nodeTypes`, so
  `assertValidCapabilityManifest` fails until the port lists the new type too.
- Python (`engine`): the edge `:TYPE` vocab lives in `ontology/registry.py`
  (`REGISTRY`, pinned by `test_ontology_registry.py`) **and** must be documented in
  `docs/ontology.md` (pinned by `test_ontology_doc.py`); `schema/mapper.py` `PINAKES_EDGE_TYPE_MAP`
  (cover every exported edge :TYPE). The version + from/to bake into three regenerated,
  test-pinned artifacts: `datalog/schema/edge_constraints.tsv`, `datalog/schema/rules_registry.tsv`,
  `datalog/rules_registry.tsv` (regenerate via their `write_*`/`build_registry` fns). A node
  `:LABEL` needs no Python allowlist change (nothing rejects `Asset`).
- **The committed Bridge-1 fixture pack moves too.** `scripts/data/insimul-grounding-pack.json`
  embeds the registry version in `x_pinakes` and is content-addressed, so a registry re-vendor
  changes its `packId` — regenerate it (`packJson(buildFixturePack())` → `FIXTURE_PACK_PATH`)
  or `export-insimul-pack.test.ts` goes red.
- `contracts/trust-tier.ts` is the **app-facing display** mirror of `classify_tier` and knows only
  the four trust rungs; neither bridge partition (`personal`, `synthetic`) is mirrored there,
  by precedent — they never reach the app corpus.

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
  additions are `x_`-prefixed (`x_pinakes`, `x_surfaces`, `x_grant`, `x_produced_by`,
  `x_specialization`) so the document can be served verbatim to a registry.
- **The KFT `finetune` capability (90-US-3) is the one specialized entry, and the validator
  pins it to what lugh admits.** KFT is multi-provider (`koine/specs/fine-tuning.md` §9,
  FT-K): agora hosts the general trainer, Pinakes advertises a NARROW one. `x_specialization`
  (`provider_class`/`modality`/`methods`/`egress`/`domains`) is the tiebreak signal, and
  `assertFinetuneCapability` rejects an advertisement that widened past
  lugh's admission gate — a second modality, a `full`/`dpo` method, an `exportable`
  egress. **Widening the manifest without widening admission routes jobs here that are then
  refused**, which is the exact failure FT-K's tiebreak exists to prevent. `cost.meter` must
  stay `gpu-seconds` (KFT §7 spend gating).
- **Two vocabularies come from koine's registry, NOT from `canonical-schema.json`.**
  `KINP_ENTITY_TYPES` (`model` — `registry/entity-types.tsv`) is the allowlist that lets a
  capability port name a non-csid entity type; `KFT_WEIGHT_MEDIA_TYPES`
  (`registry/media-types.tsv`) bounds the `media` plane. `MediaPort` is the third plane
  (`entity` | `knowledge` | `media`); the finetune weights port is the only one Pinakes
  publishes. Add to these lists only when koine's registry does — they are mirrors.
- **A capability's ports may span planes; the produced-port rules do not change.** The entity
  totality check and the `grounding-only` + `pinakes:world:*` pins apply to `produces` /
  `consumes`; a capability-level knowledge port can legitimately omit `worlds` (the finetune
  training-set port does — its data is not consensus-reality knowledge).

## Self-describing participant — `participant.json` + `egress-policy.json` (90-repatriate-koine-config US-1)

Pinakes owns its fabric-participation config in-repo: koine has no central config store, so the
namespace, the minting-authority claim, the egress/dialect policy and the mapping pointers are
published from *this* repository (`koine/docs/self-describing-participant.md`, ADR-0007). Prose +
the four-facet table live in `docs/capability-bus.md`.

- **`egress-policy.json` is the SOURCE OF TRUTH for the dialect and the egress classes, and the
  other contracts read it rather than restating it.** `capability-manifest.ts` validates every
  knowledge port against `EGRESS_POLICY.knowledgeDialect` and the `finetune` capability's
  advertised egress against the `slm-training-corpora` record class; `kgp.ts` takes
  `DEFAULT_DIALECT` from the same field. Widening a port now means changing the policy first,
  which is the point. **Keep `egress-policy.ts` a LEAF** — it imports no other contract, so the
  manifest can depend on the policy without a cycle (the manifest references the policy, never
  the reverse). Per-*relation* egress is NOT here: it lives per entry in the vendored
  `predicate-mapping.json` mirror, and the policy points at it.
- **`participant.json` is a SOURCE document, not a second manifest.** Pointers and references
  only: koine's schema is `additionalProperties: false` on every facet block precisely so a
  manifest payload, a mapping's rows or a node/edge ontology will not validate. Its value is
  `assertParticipantManifestAgreement` — the drift check tying the declaration to what is
  actually published (identity, namespace + kinds, the manifest/policy pointers both ways, the
  served MCP/A2A endpoints, every port's dialect). Without that check the declaration would be
  exactly the hand-maintained copy ADR-0007 bounds it against.
- **A served endpoint's path rides in a location's `note`, and that is deliberate.** koine's
  `location` shape admits `path`/`url`/`note` and nothing else, and pinakes ships no fixed public
  origin (`PINAKES_PUBLIC_ORIGIN` is a deployment concern), so committing an absolute `url` would
  be a guess. The drift check asserts the note names `endpoints.a2a` / `endpoints.mcp`, so moving
  a front breaks the declaration loudly.
- **`koine-schema.ts` is TEST SUPPORT and touches `node:fs`** — the second file in `contracts/`
  that does, after `parity/harness.ts`. Never import it from `web/src`. It is a deliberately
  small draft-2020-12 subset checker (koine ships shape without validators: "Validators live
  downstream per ADR-0001"), and `assertSupportedKeywords` fails loudly on a keyword it does not
  implement rather than passing a document by not looking at it. The conformance tests `skipIf`
  when no sibling koine checkout is present — same rule as the registry-mirror gate.
- **Every pointer must be relative to this repo's root.** `assertValidParticipant` rejects an
  absolute path or one that climbs out (`../koine/...`): no participant reads another
  participant's repository, and a shared-checkout dependency wearing a pointer's clothes is the
  failure that convention exists to prevent.

## Predicate-mapping registry — `predicate-mapping.json` + `predicate-mapping.ts`

The bridge contract between the canonical node/edge vocabulary and the relation vocabularies of
the projects pinakes bridges (the `projects` block of the vendored koine registry). Same JSON + typed-accessor +
runtime-validator shape as `canonical-schema`/`capability-manifest`, with one difference that
governs how you edit it:

- **The JSON is a generated MIRROR, not a source — and so is `kgp.ts`'s relation vocabulary.**
  The authoritative copies are koine `registry/predicate-mapping.json` and
  `registry/relations.tsv` + `registry/relations/<domain>.tsv` (the JSON declares this in its own
  `canonicalHome`/`mirrors` blocks). Never hand-edit `contracts/predicate-mapping.json` **or**
  `kgp.ts`'s `KGP_CORE_RELATIONS`/`KGP_DOMAIN_RELATIONS` — a published signature is immutable
  (KGP §3.2 / the registry `signaturePolicy`). Upstream the correction to koine, bump its
  `registryVersion`, then re-vendor with **`npm run regen:registry-mirror`** — the one supported
  re-vendor path (deterministic; regenerates BOTH mirrors together so they can never go
  one-sided). `npm run check:registry-mirror` is the read-only staleness check. The plain `cp`
  is retired — a `cp` re-vendored only the JSON and left the `kgp.ts` vocabulary to drift. The
  drift gate in `predicate-mapping.test.ts` compares the JSON **byte-for-byte** AND the TSV
  vocabulary signature-for-signature, and `convergence-qa.ts` blocks on staleness; all `skipIf`
  when no koine checkout is present (`KOINE_ROOT`, else `~/Development/koine`) — the same
  skipif-gated sibling-checkout pattern as the Python confidence-rubric parity test. **Worked
  example of that flow:** `insimul-bridge` US-002 needed `country_name/2` / `settlement_name/2` /
  `item_name/2` (a nameless world seed is unusable, and all three are in Insimul's shipped
  `predicate-schema.ts`), so they were added to koine entries 1/2/5, `registryVersion` went
  0.4.0 → **0.4.1**, and the mirror was re-vendored with `npm run regen:registry-mirror` — not
  added locally.
- **The mirror is EXEMPT from the publish-prep genericization sweep, deliberately.** The
  open-sourcing pass (`62-genericize-and-publish-prep`) renamed closed-sibling references
  across pinakes's own code/docs to an agnostic taxonomy (`analyzer`→analyzer,
  `formant`→composer, `cuneiform`→orchestrator, `tessera`→cache, `rosetta`→legacy), but
  `predicate-mapping.json` still carries a `projects.analyzer` block and an ecosystem-scoped
  `agora` package reference — and `predicate-mapping.test.ts` must keep naming those keys. **That is correct
  and must not be "fixed".** The `projects.<name>` keys are the ecosystem contract's own
  identifiers; renaming one here would fork the registry permanently and fail the
  byte-for-byte drift gate. A rename has to be upstreamed to koine and re-vendored. So the
  publish-readiness proof-grep for closed-sibling identifiers scopes **out** the vendored
  mirror and its test, along with `data/source/lexicons/`, `data/`, and cultural fixtures (where
  `Analyzer`/`cuneiform`/`Rosetta` are domain content, not project names).
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
  other file in `contracts/` — imports no node builtin and stays client-safe. The caller supplies
  `node:crypto`.
- **`KGP_CORE_RELATIONS` is vendored from koine `registry/relations.tsv`**, not fetched, so ids
  can be minted offline. A published signature is **immutable** (changing arity/symmetry would
  silently change every dependent claim id) — upstream changes arrive as *new* relation names,
  new rows are additive. Each row carries a dialect tier; `assertRelationAllowed` keeps a
  `horn-safe` relation out of a `grounding-only` pack.
- **Only namespace and kind of a CURIE are case-folded** (KGP §3.2 rule 3). `wikidata:ent:Q150`
  keeps its `Q` — an external authority's local id is not ours to lowercase. Our own locals are
  lowercased + percent-encoded by `csidToKinpCurie` per `docs/canonical-schema.md` §3.1.

## Express → FastAPI parity baseline — `parity/` (30-api-shell-parity US-1)

`parity/openapi.json` is the machine-readable contract the Python service
(`services/api`) must satisfy as route groups move off `server/`. Full contract:
[`parity/README.md`](./parity/README.md). What to know before touching it:

- **It is HARVESTED, never hand-written** (`npm run parity:spec` →
  `scripts/gen-parity-spec.ts`): the generator boots the real Express app, walks
  `app._router.stack`, and attributes each registration to its **call site** by
  instrumenting `app.get/post/...` and reading a stack frame. That last bit is why a
  constant-path registration (`app.get(MCP_ROUTE_PATH, …)`, the `.well-known`
  documents) is attributed correctly where a static regex misses it — all 306 routes
  carry a `source`. Gotcha: `app.get(name)` with **no handler** is Express's settings
  getter, not a route; the instrumentation guards on `handlers.length > 0`.
- **Fixtures record SHAPES, not values** (`parity/shape.ts`). The corpus grows and ids
  churn, so a value assertion would be a liability. The comparison is deliberately
  asymmetric — a ported handler may return *more* than the baseline, never less; a
  key the baseline carried only sometimes is `optional`; an empty array passes (data,
  not shape); a baseline `null` matches anything, but a `null` **branch of a union**
  means nullable and only matches null.
- **`parity/requests.json` is the one hand-written file**, and every entry must be
  **side-effect free** — a read, or a write rejected at validation before it reaches a
  store (the `expectStatus: 400` entries). Never record something that mutates the
  corpus or the contribution queue. Re-record with `npm run parity:record` **before**
  `npm run parity:spec` (the spec folds recorded shapes into response schemas).
- **`harness.ts` is fetch-injected on purpose** — the same fixtures grade Express
  (`parity/parity.test.ts`) and, as routes land, the FastAPI service. It is the only
  file in `contracts/` that touches `node:fs` (`loadParityFixtures`); never import it
  from `web/src`.
- Both artifacts are deterministic (no wall-clock), so an unchanged API re-generates
  byte-identically — and `parity.test.ts` fails when `openapi.json` drifts from the
  live routing table.

## Gotchas

- **JSON imports widen string literals to `string`**, so `import x from './f.json'
  satisfies SomeType` fails when the type uses string-literal unions. Assert with
  `as SomeType` and add a runtime validator (see `assertValidCanonicalSchema`) for
  enum-level checks. `resolveJsonModule` is enabled in `web/tsconfig.json`.
- **`npm run check` (tsc) has a large pre-existing error baseline** (~145 errors in
  `server/tsv-storage.ts`, `contracts/computation.ts`, etc.). Judge your change by whether
  it adds *new* errors in the files you touched, not by a zero exit. Scope tests with
  `npx vitest run <path>`.
