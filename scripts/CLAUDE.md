# scripts/ — one-off / build-time tooling

Standalone TS run with `tsx` (e.g. `npx tsx scripts/<name>.ts`). Tests run under vitest.

## Type-checking

- **`scripts/` is excluded from the project `web/tsconfig.json` `include`, so `npm run check`
  does NOT type-check anything here.** Type-check scripts explicitly with
  `npx tsc -p scripts/tsconfig.json` (0 errors expected — keep it that way).
- `scripts/tsconfig.json` sets `baseUrl: ".."` + `paths` for `@contracts/*` and `@/*`, so
  scripts may import `@contracts/...` and cross-workspace files (e.g.
  `../server/services/...`). At runtime, `tsx` resolves `@contracts` via the **root
  `tsconfig.json` shim** (tsx looks for the nearest tsconfig at or above its cwd, and the
  real project config now lives in `web/`), and vitest resolves it via its own alias config
  — a plain `@contracts` import works in all three (tsc/tsx/vitest).

## Conventions

- Main-module guard (run-as-CLI): `if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ""))) { ... }`.
- Resolve repo paths from `import.meta.dirname` (e.g. `path.resolve(import.meta.dirname, "..")`).
- Keep the data-transform core **pure over an input dir** (e.g. `buildExport(lexiconsDir)`)
  and put filesystem writes in a thin `writeExport`/`runExport` wrapper — tests then drive
  the core with temp-dir fixtures (`fs.mkdtempSync`) and assert without touching real output.
- **The corpus lives at `data/source/lexicons/`, not `lexicons/`** (pinakes:20 US-3). The
  house pattern is `const LEXICONS_DIR = path.join(REPO_ROOT, "data", "source", "lexicons")`
  as the *default argument* of an otherwise dir-pure function. Never write the path as a
  bare string literal — a wrong dir does not throw here, it yields an empty file list and a
  cheerfully green "0 rows, 0 drift" report.

## Secret scanning (US-003)

`secret-scan.ts` is the commit-time / CI guard against leaked credentials. Same
shape as the other scripts: a **pure core** (`scanForSecrets(files: {path,content}[])
→ Finding[]`, filesystem/network-free, so tests drive it with in-memory files) +
thin git wrappers (`collectStagedFiles` reads `git show :<path>` blobs;
`collectTrackedFiles` reads `git ls-files` working-tree content). CLI: no args =
full-tree scan (`npm run secret-scan`, CI mode); `--staged` = staged-only
(`npm run secret-scan:staged`, what the hook runs). Exit `1` on any finding.

- **Wiring:** pre-commit hook at `.githooks/pre-commit` (installed by the
  `prepare` npm script → `git config core.hooksPath .githooks`, so it also arms on
  a fresh `npm install`); CI at `.github/workflows/secret-scan.yml`. Full setup +
  rule list in `docs/SECURITY.md` "Secret scanning".
- **Rules are high-confidence on purpose.** Provider-prefixed keys, private-key
  blocks, and secret-named assignments gated on Shannon entropy (≥ 3.5 bits/char,
  ≥ 20 chars, mixed char classes). This is what lets a full-tree scan of all 1400+
  tracked files pass clean (weak values like `.env.example`'s
  `NEO4J_PASSWORD=pinakes` are low-entropy dictionary words → not flagged).
- **`.env` is a PATH rule, not content** — any real `.env*` file is blocked
  regardless of content; templates (`.env.example`, `*.sample`, `*.template`) are
  allowlisted.
- **GOTCHA — provider regexes are exact-length + `\b`-anchored.** e.g. AWS is
  `AKIA` + exactly 16 caps, Google is `AIza` + exactly 35 chars; a test fixture
  one char too long fails the trailing `\b`. Build planted-secret fixtures from
  fragments (never a literal key) so this file — and the scanner (which contains
  the rule patterns) — are self-allowlisted and don't trip the tree scan.
- **Escape hatches:** inline `secret-scan:allow` comment on a line, or add the path
  to `ALLOWLISTED_PATHS` in the script. Findings mask the match (`AKIA…LE`) so the
  report never re-leaks the secret.

### Per-record SPDX license + edge citations (canonical schema v1.1, US-003)

The export stamps a `license` column on **every** node and edge and a `source_query`
citation column on **edges** (nodes already had one). Both are v1.1 additions to
`contracts/canonical-schema.json` (role `provenance`; `license` required, edge `source_query`
optional). Rules:

- **`license` is resolved from the record's `source` via `SOURCE_LICENSES`** (a registry in
  `export-for-engine.ts`, `source id → SPDX`), defaulting to `DEFAULT_LICENSE`
  (`CC-BY-4.0`). The TS export stamps `source = pinakes` on every row, so today every
  exported record is `CC-BY-4.0`; the registry is the forward-looking mechanism (e.g.
  `wikidata → CC0-1.0`, `wiktionary → CC-BY-SA-4.0`) that fires when pinakes-engine's own
  acquisition paths stamp a different `source` — land it **before** the first share-alike
  source, not after.
- **Edge citations stop being dropped.** Previously an edge citation had no canonical column
  (`provenance.edge.citationsWithoutCanonicalColumn` counted the residue, ~1,094). Now the
  extractor's real citation (`e.provenance.source` when ≠ the source-file fallback) is written
  to the edge `source_query`, so the residue is permanently `0`.
- **Both are in `PROVENANCE_FORCED_FIELDS`** (skipped by the generic `target`→column loop and
  set explicitly) and in `NODE_/EDGE_PROVENANCE_FIELDS` (so the manifest coverage + the
  convergence-QA drift check see them). `license` is also in the importer's
  `NON_WRITEBACK_FIELDS` (graph-owned; never written back to lexicons).
- **Python lockstep:** pinakes-engine's `pinakes-export` adapter already lifts
  `source_query`/`license` into `Provenance` (its `_PROVENANCE_COLUMNS`); a row-level `license`
  cell wins over the export-level `license` param. pinakes-engine's OWN `headers.py`
  `NodeSchema/EdgeSchema.canonical()` were deliberately **not** changed (they already diverge
  from the TS export header, and touching them cascades into its neo4j export + categorizer +
  ~6 tests) — the adapter parses the extra columns fine (plain string columns).
- **GOTCHA — `export-for-engine.ts` contains literal NUL bytes** (`\x00`) as the edge
  sort-key separator, so plain `grep` reports it as a binary file — use `grep -a` / `rg --text`.
- After any change here, regenerate `docs/engine-export-manifest.json`
  (`npx tsx scripts/export-for-engine.ts`) and run `npm run convergence-qa` — a
  live-corpus test asserts `snapshot.provenance` equals a fresh build's.

## Live-graph smoke test (US-005)

`smoke-graph.ts` is the one script here that makes **HTTP** calls (not a data
transform) — it probes the running app's `/api/graph/*` routes and asserts real,
non-empty data (`npm run smoke:graph`, docs in
`engine/docs/convergence-build.md` "US-005"). Reusable shape for any
"hit the live app and check it" script:

- **Never throw on a down backend.** Every `fetch` is wrapped so a transport failure
  (`ECONNREFUSED`, timeout via `AbortController`) becomes a `{reached:false}` result,
  not an unhandled rejection. The CLI catches at the top and prints a clear message.
- **Exit-code contract:** `0` = passed **or** gracefully skipped (stack down — absent
  services are not a failure); `1` = a backend was **up** but a check returned
  empty/wrong data (a real regression). This lets it run locally with nothing up.
- Response **types are imported** from the server services (`graph-health`,
  `graph-store`, `engine-client`) via `import type` — parity with the routes,
  erased at runtime. It imports no runtime server code, so it starts instantly.
- It discovers a real node `csid` from `/search` (sidecar), falling back to
  `/overview` (Neo4j) so the node/neighborhood checks can still run when only one
  backend is up.
- **GOTCHA — the sidecar and Neo4j must serve the SAME corpus or the cross-backend
  `node/:id` check 404s.** `discoverCsid` takes a csid from the **sidecar** search
  then looks it up in **Neo4j**; if the sidecar is on its bundled 9-node demo
  fixture (the `CORPUS` default) while Neo4j holds the pinakes export
  (loaded by `to-neo4j build/corpus`), the csid doesn't exist in Neo4j and
  the smoke fails. To run a fully green smoke: point the sidecar at the same bare
  corpus — `infra/docker-compose.yml` mounts the gitignored `build/corpus` at
  `/corpus:ro`, so bring the stack up with `PINAKES_ENGINE_CORPUS=/corpus docker
  compose up -d pinakes_engine neo4j` (`load_corpus` reads a `nodes/`+`edges/` dir
  directly). Default stays the demo fixture so a bare `docker compose -f infra/docker-compose.yml up` still
  starts when no export has been built.

## Entity-grounding snapshot (KGP-retargeted, US-PKA3)

`export-entity-grounding.ts` emits a compact, license-filtered JSON snapshot of canonical
**entities + reconciliation keys** that an analyzer's enrichment step consumes offline to ground
per-file facts (the media-analysis bridge spec §4.2). Same pure-builder shape as the canonical export:
`buildEntityGrounding(lexiconsDir, {licenseClasses, domains})` reads the node lexicons (via
`nodeFiles()`), and `snapshotEnvelope`/`writeSnapshot`/`runExport` do the wrapping + fs side.
Live output: `build/corpus/entity-grounding/snapshot.json` (gitignored). Run with
`npm run entity-grounding` (`--license-classes CC0,CC-BY` default, `--domains language,culture`,
`--out <dir>`, `--emit-fixture`).

- **Reuses the export/reconciliation helpers** — `mintCsid` (QID-anchored csid + csid dedup),
  `normaliseConfidence`, `licenseForSource`, `deriveSourceUrl`, `parseCitation`, `EXPORT_SOURCE`
  from `export-for-engine.ts`, and `normalizeKey`/`normalizeQid` from `reconciliation-report.ts`.
  Don't re-implement id minting / license resolution — import them so the snapshot stays consistent
  with the TSV export (same csids, same `source=pinakes → CC-BY-4.0` default).
- **Size-conscious: keys + names only.** Each record is `{csid, entityType, name, aliases,
  reconciliation:{wikidataQid, normalizedName, iso639_1?/iso639_2?/glottocode? (languages only,
  omitted when blank)}, provenance:{source, sourceUrl, retrievedAt, confidence}, license}`.
  **Never add `description`/bulk fields** — a test asserts the record key set. Language codes are
  read by raw header name (`iso639_1`/`iso639_2`/`/glotto/`), NOT via the canonical mapping (they map
  to `language_code`/property, not distinct canonical fields).
- **License filtering is by *class*** (family, version-independent — `licenseClass("CC-BY-4.0")==="CC-BY"`,
  and `assertLicenseColumn()` fails the build with the remedy in the message if the canonical schema
  ever loses the v1.1 per-record `license` column; `licenseClasses: null` disables the filter and is
  for the Insimul projection's excluded-record tally only — never for emitting a pack),
  `"CC0-1.0"→"CC0"`). Default classes `CC0`+`CC-BY` **exclude** share-alike (`CC-BY-SA-*`). A row-level
  `license` column wins over the source default (mirrors pinakes-engine's adapter), so a future
  mixed-license corpus grounds with genuine per-record licenses; today every real row is `CC-BY-4.0`.
- **Determinism:** entities are csid-sorted, assertions claim-id-sorted, neither carries a
  wall-clock; two builds are byte-identical **modulo the envelope `generatedAt`/`manifest.created`**
  (the sole non-deterministic field — the pure builder never stamps it, `runExport` does via
  `new Date().toISOString()`) and that field is **excluded from `pack_id`**, so the same corpus
  always yields the same content address. The committed **fixture** snapshot
  (`scripts/data/entity-grounding-snapshot.json`, built from `scripts/data/entity-grounding-fixture/`
  with a pinned `FIXTURE_GENERATED_AT`) is asserted in-sync by a test — regenerate with
  `npm run entity-grounding -- --emit-fixture` after any shape change. No committed *live* snapshot
  (6708 entities — too big; the fixture pins the shape instead).
- **The envelope is a KGP GroundingPack (US-PKA3), the payload is not.** `buildGroundingPack`
  (was `snapshotEnvelope`) wraps the *unchanged* entity records in `koine/specs/grounding-pack.md`
  §2: `kgp_version`/`pack_id`/`producer`/`worlds`/`kind`/`basis`/`dialect` + a
  `manifest{counts,created,signing,license_policy}`, and `buildAssertions` mints one
  `exact_match(pinakes:ent:<type>.<local>, wikidata:ent:<QID>)` claim per QID-bearing entity.
  Normalization lives in `@contracts/kgp` — **never hand-roll a claim or pack hash**; `contractVersion`
  is `2.0.0` (the envelope broke, the records did not). Full contract: `docs/grounding-pack.md`.

## Insimul grounding pack (insimul-bridge US-002)

`export-insimul-pack.ts` is a **projection of the KGP pack, not a second corpus reader** — it
imports `buildEntityGrounding`/`buildGroundingPack` from `export-entity-grounding.ts` and
re-wraps the result in Insimul's own envelope. Two envelopes are unavoidable: `@insimul/core`'s
`groundingPackSchema` pins `contractVersion: "insimul-grounding-v1"` and `source: "linguascrape"`
(the project's former name) as **zod literals**, so a single document cannot satisfy both. The
KGP `pack_id` rides across in `x_pinakes.kgpPackId`. Run: `npm run insimul-pack [-- --domains
culture,place,language --license-classes CC0,CC-BY --out <dir> --emit-fixture]`. Full contract:
[`docs/grounding-pack.md`](../docs/grounding-pack.md) "The Insimul projection".

- **`SEED_MAPPINGS` resolves its registry entry THROUGH the in-repo bridge mapping**
  (`contracts/bridge-insimul.json`, 90-repatriate-koine-config US-2) — a seed names a canonical
  node type and nothing else, and `bridgeRowFor()` looks the correspondence up. So a node type
  the bridge does not declare as crossing outward cannot be seeded at all, and the emitted pack
  records `x_pinakes.bridgeMapping` (**bump `bridgeVersion` ⇒ regenerate the fixture pack**).
- **`assertSeedMappingsRegistered()` still enforces the registry** (at build time *and* in the
  test): a mapping may only emit a predicate its resolved `projects.insimul` entry's `external`
  cell names, only through an entry that crosses `LS->IN`/`both`, is `exportable`, and is not
  `pending`. **Never
  widen the table to add a predicate** — upstream it to koine `registry/predicate-mapping.json`,
  bump `registryVersion`, `cp` the mirror back. That is how 0.4.1 added `country_name/2` /
  `settlement_name/2` / `item_name/2` (a nameless world seed is unusable; all three are in
  Insimul's shipped `predicate-schema.ts`, which a skipif-gated test cross-checks).
- **Registry entries with a prose `external` cell emit no facts, by construction** —
  `externalPredicates()` finds no `name/arity` in "religion truths / backstory templates", so
  deities/myth-motifs ride as entity records only. That is the designed behaviour, not a gap.
- **Skip, never fake.** A blank/non-numeric source cell drops the fact; a foreign key
  (`settlement_of_country/2`, `language_parent/2`) is emitted only when it resolves to an entity
  **inside the pack**, so a license-filtered country can't leave a dangling seed reference. FKs
  resolve through a `nodeType\0pinakesId → csid` index so a QID-anchored target
  (`civilization_id=sumer` → `cs:culture:Q35355`) links correctly.
- **`fields` is where domain data lives** (settlement `lat`/`lon`, `governmentType`,
  `realCode`). The KGP entity record stays keys-and-names only — do not add bulk fields there.
  Coordinates are handled uniformly for every node type: `latitude`+`longitude` columns, else a
  `*coordinates` JSON cell via the export's `parseCoordinates`.
- **The consumer's schema is vendored + drift-gated**, same pattern as the koine registry
  mirror: `scripts/data/insimul-grounding-pack.schema.json` is byte-derived from
  `$INSIMUL_ROOT/packages/core/schemas/grounding-pack.schema.json` (default
  `~/Development/workspace/insimul-babylon`) and the test compares them under `skipIf`.
  `assertMatchesInsimulSchema` runs inside `buildInsimulPack`, so a pack Insimul would reject
  never reaches disk. `validateJsonSchema` is a deliberate ~60-line draft-07 *subset* checker
  (no JSON-Schema runtime in this repo); an unsupported keyword surfaces as a violation.
- **GOTCHA — the fixture lexicons are SHARED with the KGP snapshot.** Adding a row/file to
  `scripts/data/entity-grounding-fixture/` moves **both** committed packs; regenerate both
  (`npm run entity-grounding -- --emit-fixture` **and** `npm run insimul-pack -- --emit-fixture`)
  or the sync tests fail. Adding an *unmapped* column is free — only columns the lexicon mapping
  maps (or the raw-header lookups: `license`, `iso639_*`, `/glotto/`, `latitude`/`longitude`,
  `*coordinates`, and the seed columns) are read.

## Canonical export (US-004)

`export-for-engine.ts` emits `build/corpus/{nodes,edges}/<type>.tsv`
(gitignored) + `manifest.json`, and a committed manifest snapshot at
`docs/engine-export-manifest.json`. It reuses `@contracts/lexicon-mapping` (node
`target`/`property` dispositions) and `server/services/canonical-edges`
(`extractAllCanonicalEdges`) for edges. **csid is QID-anchored (US-005):** a row with a
non-blank `wikidata_qid` mints `cs:<node-type>:<QID>` (a known QID *is* the identity per
`contracts/canonical-schema.json` `idScheme`); a row without one falls back to
`cs:<node-type>:<pinakes-id>`. `mintCsid(nodeType, pinakesId, qid?)` is the single source —
`wikidata_qid` must be read from the row *before* minting (it is a normal `target` column, so
`targetIdx.get("wikidata_qid")`), and `reconciliation-report.ts` passes the same qid so both
snapshots agree. Edge endpoints are rewritten to node csids via a `pinakes_id → csid`
index built during the node pass (so QID-anchoring re-points edges for free — endpoints are
still keyed on `pinakes_id`, which is unchanged) — endpoints with no exported node are
counted + sampled in the manifest, never emitted (keeps output `neo4j-admin import`-clean).
Output is idempotent (rows sorted, no wall-clock written). Combined `*coordinates` JSON cells
(`{"lat":..,"lng":..}`) split into `lat`/`lon`.

- **GOTCHA — QID-anchoring is snapshot-neutral for the export MANIFEST but not the
  reconciliation report.** The manifest holds only counts + pinakesId-keyed unresolved samples (no
  csid strings), so if no dedup counts move it stays byte-identical. `docs/reconciliation-report.json`
  lists csids, so it DOES change — regenerate it (`npx tsx scripts/reconciliation-report.ts`).
  The write-back round-trip stays a 0-change no-op because `import-from-engine.ts` keys on
  `pinakes_id` (unchanged), and `csid` is in `NON_WRITEBACK_FIELDS`.

- **Unresolved edge endpoints mint flagged stub nodes, not dropped edges (US-007).** An edge
  whose start/end id has no exported node used to be counted-and-dropped
  (`edgesWithUnresolvedEndpoint`). Now `buildExport` mints a **needs-curation stub node** for
  that id so the edge is recovered. Chosen over hand-curating ~128 missing rows because it is
  deterministic, network-free, and self-contained (one story); the stubs carry
  `STUB_NEEDS_CURATION_NOTE` in `description` + `confidence=0` + `name = humanizeId(id)`, and a
  follow-up curation pass replaces them with real typed nodes (many are id-space mismatches —
  `cultural-lineages.tsv` writes flat `proto_indo_european`, `families.tsv` the hierarchical
  `indo_european`). Stub **type** is borrowed from the resolved counterpart endpoint when there
  is one, else `STUB_TYPE_BY_SOURCE_FILE[sourceFile]` (both endpoints unresolved), else
  `DEFAULT_STUB_TYPE` (`culture`). Minted **once per id** (`idIndex` first-wins), so no
  `ambiguousPinakesIds` / `duplicateCsids` regression — only `edgesWithUnresolvedEndpoint`
  moves (→0; re-baseline `docs/convergence-qa-baseline.json`). Manifest gains
  `diagnostics.stubNodes{Minted,ByType,Samples}`. Stubs have no lexicon row, so the write-back
  round-trip still no-ops (import keys on `pinakes_id`; a stub id matches nothing → skipped).
  `reconciliation-report.json` reads **lexicons**, not the export, so it is unchanged by stubs.

- **GOTCHA — a literal `"null"` FK cell is not an id.** `writing-systems.tsv` writes the string
  `"null"` in `parent_system_id` for a root script; `canonical-edges.ts` now treats
  `""`/`null`/`none`/`n/a`/`undefined` (case-insensitive, `isBlankId`) as a blank endpoint in
  both `splitIdList` and the edge-table start/end guard, so no phantom `descended-from → null`
  edge is emitted (was 15 of the dropped edges).

## Provenance propagation (US-006)

The export stamps all four provenance columns on **every** node and edge (values may be
blank, the column is always present). Rules:

- `source` = `pinakes` (acquisition-source id) on 100% of rows — the reconciler
  anchor **and** pinakes-engine's `validate.py` requires a non-empty `source`.
- The lexicon column mapped to canonical `source` actually holds **bibliographic
  citations**, not the adapter id. `parseCitation()` reshapes it (JSON array → `"; "`-joined)
  and it is preserved into the node **`source_query`** column — never dropped. `source` is
  in `PROVENANCE_FORCED_FIELDS` so the citation column is *not* read as `source`; it is read
  explicitly via `mapping.columns.find(c => c.target === "source")`.
- `source_url` = the lexicon row's mapped `source_url` column **verbatim** when present
  (US-004: ~1.9k acquired rows carry a Wikidata entity URL), else `deriveSourceUrl(...)`
  (first real `http(s)` URL embedded in the citation/cells), else `""`. **Never fabricate a
  URL.** `retrieved_at` = the row's mapped `retrieved_at` column verbatim, else `""`.
- **US-004 propagation:** `source_url`/`retrieved_at` are in `PROVENANCE_FORCED_FIELDS` (so the
  generic `target`→column loop skips them) and are read **explicitly** in `buildNodesForFile`
  from `mapping.columns.find(c => c.target === "source_url" | "retrieved_at")`. The 15 acquire
  lexicons map both columns; node coverage in the manifest is ~1,868 each (fewer than the 1,932
  populated lexicon rows: `trade-routes.tsv` is `kind: attribute` = not exported, plus dropped
  duplicate/missing-id rows). Edges carry no lexicon URL (their source files don't map the
  columns), so edge `source_url`/`retrieved_at` stay `0` — the export change is node-only.
  The `node.source_url`/`node.retrieved_at` "0/N … left blank" flags now only appear when a
  build genuinely has zero (e.g. a fixture without the columns).
- Edges have **no `source_query`** column (pinakes-engine's edge schema omits it), so an
  edge that carried a citation is counted in `manifest.provenance.edge.citationsWithoutCanonicalColumn`
  (never silently dropped; embedded-FK edges keep it on the host node's `source_query`).
- **Coverage metric** = `manifest.provenance` (per-type non-blank counts for each
  provenance column + a human-readable `flags` list). It is deterministic (integer counts,
  no wall-clock), so it lives in the committed manifest snapshot and is asserted against a
  fresh build by a live test — re-run the export CLI after any change touching provenance.

## Bidirectional write-back (US-007)

`import-from-engine.ts` is the **return leg** of the export: it reads the enriched
canonical node TSVs (`<canonicalDir>/nodes/<type>.tsv`) and writes graph-derived facts back
into `data/source/lexicons/*.tsv` via the **reverse** of the US-002 `target` map. `buildWriteBack(canonicalDir,
lexiconsDir, {overwrite})` is pure (returns edited in-memory files + a report);
`writeWriteBack`/`runWriteBack` do the filesystem side. Report →
`build/corpus/writeback/report.json` (gitignored). Full contract + ownership table:
[`docs/canonical-schema.md` §9](../docs/canonical-schema.md).

- **Only fills blanks by default** (enrichment). A differing curated cell is a **conflict** —
  reported (`report.conflicts`), never silently resolved; `{overwrite:true}` / `--overwrite`
  is the only way to apply it (still logged as a conflict).
- **`NON_WRITEBACK_FIELDS`** (identity + all provenance/confidence columns) are never written —
  pinakes owns curated columns; the graph owns edges + external-authority enrichment.
- **GOTCHA — `pinakes_id` is NOT globally unique** in the live corpus. The same id recurs
  *within* a file (`languages.tsv` uses `abe` for two distinct languages) **and across files of
  the same node type** (`mohenjo-daro` is in both `archaeological-sites.tsv` and `settlements.tsv`,
  both → `place`). The export dedups to one canonical row, so any write keyed on such an id could
  land on the wrong row. The write-back therefore counts each id **across the whole node type**
  (not per file) and **skips** any id with count > 1 (or a duplicated canonical id), reporting it
  in `report.ambiguousIds`. This is what makes the round-trip lossless — never widen the write to
  ambiguous ids without a stronger key. A live-corpus test asserts the real export→import is a
  0-change / 0-conflict no-op.
- **Byte-faithful rewrite:** `readLexiconFile`/`serializeLexiconFile` preserve EOL + trailing-newline
  shape and keep cells raw, so an unedited file re-serialises identically (only changed files are
  written back).

## Column enrichment of existing rows (US-006, language ranges/endangerment)

The **third** write-back mode in `import-from-engine.ts`, alongside the export-driven
write-back and `--add-rows`: `--enrich <file> --target <lexicon.tsv> [--key <col>] [--overwrite]`
fills **blank cells on EXISTING rows** from a curated enrichment TSV (it does NOT append rows).
Use it when a domain is already populated and you're back-filling a *property* (e.g. sourced
UNESCO endangerment status onto `languages.tsv`). `buildEnrichment(target, records, {keyColumn,
overwrite})` is pure; `runEnrichment`/`loadEnrichmentFile` do the fs side. Report →
`build/corpus/writeback/<lexicon>-enrichment-report.json` (gitignored).

- **Same conservatism as the write-back:** fills a blank target cell only; a differing curated
  cell is a **conflict** (reported, never resolved unless `--overwrite`). Existing rows are never
  appended to, and the join key must address **exactly one** row — a key matching 0 rows is
  `unmatched`, >1 is `ambiguous`; both are reported and skipped, never guessed.
- **No dead columns:** a probed enrichment column that is blank in *every* record (e.g.
  `range_geojson` — Wikidata has no inline range polygons for our corpus) is NOT added to the
  target header. Only columns with ≥1 non-blank value are written (`ensureColumns` pads the rest).
- **Provenance rides along:** every written enrichment column carries its provenance columns
  (`wikidata_qid`/`source_url`/`retrieved_at`/`confidence`/`sources`) on the same row, so the
  attribution gate enforces sourcing on the enriched rows. Map those columns as `target`s (and the
  enriched property, e.g. `endangerment_status`, as a `property`) in `lexicon-mapping.json`.
- **Acquire side:** `acquire-language-status.ts` is the networked step (Wikidata `P1999` UNESCO
  status, keyed by ISO-639-3 in the `iso639_2` column). Like the write-back, it only enriches rows
  whose ISO **and** id are unique in the corpus (26 ISO codes / 30 ids recur — e.g. `abe` is two
  languages); an ambiguous key can't address one row, so it's skipped. Committed output
  `scripts/data/language-enrichment.tsv` is the network-free replay source.
- **Dashboard wiring (AC3):** the enriched `endangerment_status` is a NEW column distinct from the
  free-text `status`. `server/routes/language-preservation.ts`'s loader **prefers** it when present
  (`(l.endangermentStatus ?? "").trim() || l.status`), so the endangered-language dashboard reflects
  the sourced vitality. The runtime `Language` type lives in **`contracts/types.ts`** (hand-written) —
  add the field there and read it in `tsv-storage.ts`'s `getLanguages` parse. (There is no longer a
  competing `@shared/schema`; the Drizzle module was deleted in `10-foundation-cleanup` US-2 and its
  still-referenced record shapes moved into `contracts/types.ts`.)

## New-row additions (US-003, data-population pilot)

Same file also grows the corpus: `--add-cultures [file]` **appends** curated,
reconciliation-*new* civilizations into `data/source/lexicons/civilizations.tsv` (default input:
committed `scripts/data/civilizations-additions.tsv`, derived from the US-002 acquired
corpus). `buildCultureAdditions(parsedFile, candidates)` is pure; `runCultureAdditions` /
`loadCultureAdditions` do the fs side. Report →
`build/corpus/writeback/civilizations-additions-report.json` (gitignored); committed
summary: [`docs/civilizations-writeback.md`](../docs/civilizations-writeback.md).

- **Generic path — `--add-rows <file> --target <lexicon.tsv>`** (data-population at scale,
  US-002+): same append-only/idempotent machinery for **any** node lexicon, not just
  civilizations. The additions TSV may carry **domain-specific columns** beyond the core
  provenance set (`id`/`name`/`wikidata_qid`/`source_url`/`retrieved_at`/`confidence`/`sources`);
  any header that also exists in the target lexicon is written via `CultureAddition.extra`
  (`loadCultureAdditions` collects the non-core columns; `buildCultureAdditions` sets each only
  if the target has that column). Report name is derived from the target
  (`<lexicon>-additions-report.json`). Used for archaeological-sites (coordinates/site_type/
  time_period/description). Acquisition + curation for that domain lives in
  `acquire-archaeological-sites.ts` (see §acquire below).
- **GOTCHA — reconcile against the WHOLE node type, not one file.** csid = `cs:<node>:<id>`,
  so reusing an id already used by another lexicon of the same node type collapses two nodes
  into one on export → a `duplicateCsids` regression the QA gate blocks (caught adding sites vs
  `settlements.tsv`/`rivers-and-waters.tsv`, all `place`). The acquire step dedups new ids **and
  names** across every `node === "place"` file (derived from `lexicon-mapping.json`), never just
  the target file.

- **Append-only, never rewrites a curated row** — so no curated cell can be clobbered by
  construction. A candidate is **skipped** on duplicate `wikidata_qid` or normalised name, and
  an id that collides with a *different* existing row is a **conflict** (never appended). This
  makes the CLI **idempotent** — a second run adds 0 (dedup by the qid it just wrote), and the
  file is byte-identical.
- **`ensureColumns`** extends the target header with any missing provenance column
  (`wikidata_qid`/`source_url`/`retrieved_at`/`confidence`) and pads every existing row with a
  blank cell so the grid stays rectangular. Those four are mapped as `target`s in
  `lexicon-mapping.json` — and are all in `NON_WRITEBACK_FIELDS` (+ `wikidata_qid` added there),
  so the export→import round-trip stays a **no-op** (export force-blanks `source_url`/`retrieved_at`
  and copies `wikidata_qid`/`confidence`; import never writes any of them back).
- **GOTCHA — after changing any `data/source/lexicons/*.tsv` row/column count, regenerate BOTH committed
  snapshots** or their live-corpus parity tests fail: `npx tsx scripts/export-for-engine.ts`
  (→ `docs/engine-export-manifest.json`) **and** `npx tsx scripts/reconciliation-report.ts`
  (→ `docs/reconciliation-report.json`). Adding a mapped column also needs its
  `contracts/lexicon-mapping.json` disposition (totality test) — `npx tsc -p scripts/tsconfig.json`
  won't catch that; `contracts/lexicon-mapping.test.ts` will.

## Domain acquisition (US-002, data-population at scale)

`acquire-archaeological-sites.ts` is the per-domain **acquire → reconcile → curate** step
(runbook steps 3–5): the one networked script. It queries Wikidata WDQS (`Q839954`
archaeological site, ranked by `wikibase:sitelinks` as a notability floor), collapses
multi-value bindings per QID (earliest inception), reconciles against the existing `place`
lexicons, and writes a committed `scripts/data/<domain>-additions.tsv` with **full provenance
on every row** (`wikidata_qid`/`source_url`/`retrieved_at`/`confidence`/`sources`). The committed
TSV is the network-free source of truth the write-back + gate replay — CI never hits Wikidata.

- **WDQS gotcha:** POST the query (form-encoded), read as text then `JSON.parse` (a timeout can
  return HTTP 200 with an HTML/partial body — retry with backoff, don't assume `res.ok` ⇒ JSON).
  Avoid `OPTIONAL { ?s wdt:P31 ?type }` cross-products + `ORDER BY` in one query — it times out at
  ~55s; filter by a sitelinks floor and sort client-side instead.
- `confidence` is written on the lexicon's **own scale** (sites use 0–100, so acquired rows get
  `90`, not `0.9`) — the export's `normaliseConfidence` maps `>1 → /100`, so both scales converge
  to 0–1 canonically, but keep a single column internally consistent.

`acquire-archaeological-cultures.ts` (US-003) is the sibling for `archaeological-culture` nodes
(Wikidata `Q465299`, ranked by sitelinks). Two extra lessons it encodes:

- **Coordinates are OPTIONAL for cultures** — a culture is a *region*, so only ~10% of `Q465299`
  items carry `P625`. Don't gate on coordinates the way the sites script does; the `coordinates`
  column is a property and may be blank.
- **Dedup ids across the WHOLE corpus, not just the same node type.** The export's
  `ambiguousPinakesIds` diagnostic keys on the raw `pinakes_id` across **every** node
  type (`idIndex` in `export-for-engine.ts`), so a generic culture id like `sumer`/`vedas`
  colliding with a *civilization*/*place* id of the same string is a ratchet regression the gate
  blocks — even though the csids differ (`cs:archaeological-culture:sumer` ≠ `cs:culture:sumer`).
  `loadExisting` therefore seeds the used-id set from **all** `kind === "node"` files and suffixes
  a collision (`sumer` → `sumer-culture` → `sumer-<qid>`). (Names still dedup per-type — a culture
  and a civilization may share a name; reconciliation keys on `(name, type, region)`.) This is a
  stricter rule than the sites script's per-`place`-type dedup.
- **Embedded edges must resolve to real nodes.** Predecessor/successor (Wikidata `P155`/`P156`)
  are mapped to the *minted ids of other acquired cultures in the same batch* — only in-corpus
  targets are written, so every `descended-from`/`absorbed-into` edge lands (the gate's
  `edgesWithUnresolvedEndpoint` ratchet never regresses). Build a `qid → minted-id` map in a first
  pass, then resolve the FK columns in a second pass.

## Curated (non-networked) additions — `curate-route-additions.ts` (US-003)

Not every domain is bulk-acquirable. Migration & trade routes need real **geometry** (a GeoJSON
`LineString` of waypoints) Wikidata doesn't carry, and their Wikidata classes are inconsistent
(`Q131569` "human migration" is polluted with treaties). So `curate-route-additions.ts` is the
offline analogue of an acquire script: it holds **hand-curated** route records — each anchored to a
**verified Wikidata QID** (resolved via the `wbsearchentities` REST API and confirmed against the
entity description) so every row still carries genuine provenance — and emits the committed
`scripts/data/{migration,trade}-routes-additions.tsv`. Write the TSV from a JS array via a header +
per-record cell map (never hand-type TSV with many JSON columns — one stray tab breaks the grid).

- **A curated FK column must be resolved through a THROWING map, never emitted raw.**
  `traded_goods` is a foreign key into `trade-goods.tsv`, but the curated records name goods in
  prose ("grain", "textiles") because that is what is readable to author. tr-026..tr-039 shipped
  with those names serialised straight into the id column: 31 dangling references that no
  consumer could resolve and that no gate caught (the export ignores `attribute` files, so only
  `test/economy-trade-section.test.ts` saw it — red for months). `TRADE_GOOD_IDS` +
  `resolveTradedGoods()` now make an unmapped name a **build failure** naming the route, the
  good, and the two ways to fix it. Generic names ("textiles", "spices", "metals", "metalwork")
  resolve to deliberately **aggregate** goods (tg-046/048/049/050), not to a specific fibre or
  metal — the sources name a category, and resolving to a specific good would invent precision.
  `NOT_TRADE_GOODS` is the explicit escape for non-commodities (tr-026's "royal dispatches" is
  correspondence; it belongs in the route `description`, which already carries it).
- **GOTCHA — a node-lexicon row change cascades into the private `lugh` repo, not just `docs/`.**
  The two-snapshot rule below is incomplete: five more committed manifests are built from the live
  corpus and asserted against a fresh build by lugh's tests — they moved there with the `ml/`
  workspace (`docs/LUGH-EXTRACTION-PLAN.md`). After changing any node lexicon, regenerate them
  **in your lugh checkout**: `pinakes-export-triples`, `pinakes-export-verbalizations`,
  `pinakes-export-kgqa`, then `pinakes-export-queries`, then `pinakes-eval-kgqa` — **in that
  order**, because the later ones read the splits the earlier ones write. Their tests are
  `skipif(not <export_dir>.exists())`, so in a checkout that has never run the export they
  silently **skip** and a stale manifest looks green; running the export is what un-gates them.
  Nothing in pinakes's own gate covers this — the cascade is now cross-repo.
- **`--add-rows` now also ensures a `sources` column.** `buildCultureAdditions` calls
  `ensureColumns(target, [...ADDITION_PROVENANCE_COLUMNS, "sources"])`, so a target lexicon with no
  citation column today (migration-routes / trade-routes) gets one, and every appended row records
  its `sources` cell (required by the attribution gate, which needs a column mapped to canonical
  `source`). Files that already have `sources` are untouched.
- **An `attribute`-kind file can still be gated.** `trade-routes.tsv` is `kind: attribute` (no
  canonical node/edge — it's not in `nodeFiles()`/`edgeFiles()`), but mapping its provenance
  columns as `target`s is valid (the mapping validator allows `target` on any kind) and makes the
  attribution gate enforce provenance on its imported rows. The export/reconciliation ignore it
  (they only process node files), so this is free rigor with no side effects.

## Multi-domain acquire — `acquire-food-drink.ts` (US-004)

Some blueprints cover several sibling lexicons that share the same acquire machinery. Rather
than a script per lexicon, `acquire-food-drink.ts` drives **three** food-drink domains from one
`DOMAINS` config array — `cuisines` (node `cuisine`, Wikidata `Q1968435`), `ingredient-origins`
(node `ingredient`, `Q25403900`) and `cooking-techniques` (attribute, `Q1039303`) — each with its
own class, target lexicon, column list, name-dedup siblings, sitelink floor + limit, and a
`buildCells(mergedItem)` closure. `npx tsx scripts/acquire-food-drink.ts [--domain cuisines|
ingredients|techniques] [--limit N] [--min-sitelinks N]` (no `--domain` ⇒ all three). Each emits
its own committed `scripts/data/<lexicon>-additions.tsv`; write back with `--add-rows` as usual.

- **`nameSiblings` must list every lexicon of the same node type**, not just the target — e.g.
  ingredients dedup names across BOTH `ingredient-origins.tsv` and `cuisine-items.tsv` (both node
  `ingredient`), or a Wikidata "rice" would duplicate a curated one in the sibling file and the
  csid dedup would regress. Ids still dedup across the whole corpus (all `kind==="node"` files) +
  the target's own ids (so an **attribute** target like cooking-techniques, absent from the node
  set, still gets unique appended ids).
- **Strip class-suffix noise from labels before reconciling.** Wikidata cuisine labels are
  "Italian cuisine" / "cuisine of the United States"; `cuisineName()` reduces them to "Italian" /
  "United States" so they reconcile against the seed lexicon's bare names (else all 21 seeds
  re-appear as duplicates-not-caught). Do the label→name normalisation in `buildCells`, and dedup
  on that display name, not the raw label.
- Same attribute-file rigor as trade-routes: cooking-techniques is `kind: attribute`, so its
  provenance columns are mapped as `target`s (`sources`→`source`, etc.) purely to arm the
  attribution gate; export/reconcile ignore it. Cuisine/ingredient are node files — their new
  provenance columns are ordinary `target`s and land in the export/graph.

## Cultural-breadth acquire — `acquire-cultural-domains.ts` (US-005)

Same `DOMAINS[]` shape as `acquire-food-drink.ts`, extended to five newer cultural domains:
`writing-systems` (Q8192), `deities` (Q178885), `architectural-styles` (Q32880),
`dance-traditions` (subclasses of dance Q11401/folk-dance Q201022), `literary-traditions`
(literary movement Q2198855). `myth-motifs` is NOT here — the narrative-motif class (Q1697305)
is polluted with modern tropes, so it is hand-curated in `curate-myth-motifs.ts` (route-style).
Two reuse rules it adds beyond the food-drink script:

- **GOTCHA — share ONE `usedIds` set across all domains in a run.** When several domains are
  acquired in one invocation *before any write-back*, each domain's per-domain re-read of the
  lexicons can't see a sibling domain's just-minted ids (the additions TSVs aren't on disk yet),
  so two domains mint the same generic id (`romanticism` as both art-tradition + literary-tradition,
  `oduduwa` as both writing-system + deity) → a global `ambiguousPinakesIds` regression. `main`
  now seeds one `usedIds` set from every node lexicon and threads it through every `curate` call;
  the earlier-listed domain in `DOMAINS` keeps the bare id, the later one gets the `-<slugFallback>`
  suffix. (Names still dedup per node type via `nameSiblings` — art-tradition spans architectural
  + dance + art + music-traditions, so both those `nameSiblings` list all four.)
- **Verify a Wikidata class QID before trusting a class count.** `Q184356` looked like "folk dance"
  by a mislabelled count query but is actually *radio telescope* — the acquire returned telescopes.
  Always confirm the class label (`SELECT ?l WHERE { wd:QXXXX rdfs:label ?l }`) or sample a few
  results before wiring a class in. Dances are modelled as **subclasses** of dance, not instances,
  and music genres are mis-filed under dance — exclude `FILTER NOT EXISTS { ?s wdt:P279* wd:Q188451 }`.
- **Cross-domain edges via `P460`.** Deities carry a `syncretism_links` → `syncretized-with` edge:
  Wikidata `P460` ("said to be the same as") is resolved in a post-mint pass to the minted ids of
  OTHER deities in the same batch (in-corpus only, `edgeColumn` on the `DomainConfig`), so every
  edge lands and `edgesWithUnresolvedEndpoint` never regresses (same idea as US-003 P155/P156).

`curate-myth-motifs.ts` is the offline analogue (like `curate-route-additions.ts`): ~29 hand-picked
cross-cultural motifs, each anchored to a **verified** Wikidata QID (resolved via `wbsearchentities`
and confirmed against the entity description — filter search hits whose description signals
myth/folklore, since top-1 is noisy: it returned video games/films/plants for many terms). Fixed
`RETRIEVED_AT` for a deterministic file; write back with the same `--add-rows` path.

## Contract bindings codegen — `gen-contract-bindings.ts` (40-contracts-codegen US-1)

Emits the Python **and** TypeScript bindings for the five language-neutral sources in
`contracts/*.json` — `npm run gen:contracts` writes, `npm run check:contracts` is the
read-only staleness check. Contract + rules: [`contracts/CLAUDE.md`](../contracts/CLAUDE.md).

- Same pure-core/thin-fs shape as the rest of this directory: `buildBindings(documents)`
  returns a `Map<repo-relative path, contents>` and is the whole contract of the script;
  `readContractDocuments` / `staleBindings` / `writeBindings` / `runGen` / `runCheck` are
  the fs shell. `gen-contract-bindings.test.ts` drives `buildBindings` with in-memory
  documents — no temp dirs.
- **That same test is the drift gate (US-2).** It byte-compares every emitted file against
  the committed one via `it.each`, so a failure names the stale path, and it carries a
  **negative control** (a bogus root must report *everything* stale) — a byte-equality test
  that can only pass is no gate. `.chief/verify.sh` pairs it with `npm run check:contracts`,
  selected on `contracts/*.json` / `generated/` / `python/` / this script.
- **Output must stay deterministic.** No wall-clock, sources read in `CONTRACT_SOURCES`
  order, object keys emitted in document order. A re-run on a clean tree is an empty diff;
  the drift gate compares byte-for-byte.
- **Emitting Python from a TS template literal: watch the backticks.** The generated
  Python uses reST double-backtick markup, and a bare `` `` `` inside a JS template literal
  closes it. Escape them (`` \`\` ``) or use a plain double-quoted string.
- A JSON prior of `1` must be emitted as `1.0` (`pyFloat`), or the Python prior stops
  being a `float` and `engine/tests/test_confidence.py` catches it.

## Koine registry re-vendor — `regen-registry-mirror.ts` (40-registry-mirror-autoregen)

The deterministic re-vendor for the TWO on-disk koine mirrors pinakes keeps, replacing the
old manual `cp`. `contracts/predicate-mapping.json` is a byte copy of koine
`registry/predicate-mapping.json`; `contracts/kgp.ts`'s `KGP_CORE_RELATIONS` (from koine
`registry/relations.tsv`) + `KGP_DOMAIN_RELATIONS` (from
`registry/relations/{cinematography,media,social}.tsv`) are the second mirror. **Never
hand-edit either** — a published signature is immutable (KGP §3.2 / the registry
`signaturePolicy`); upstream the correction to koine, bump `registryVersion`, then regen.

- **`npm run regen:registry-mirror`** (`--` nothing) re-vendors both mirrors from the koine
  checkout and prints what changed. **`npm run check:registry-mirror`** (`--check`) is the
  read-only sibling: it reports whether either mirror is stale and exits `1` if so (naming
  `npm run regen:registry-mirror` as the remedy), writing nothing. Both resolve the koine
  checkout from `KOINE_ROOT`, else `~/Development/koine` — the SAME resolution
  `contracts/predicate-mapping.test.ts` uses (`resolveKoineRoot()`).
- Same pure-core/thin-fs shape as the other scripts: `parseRelationsTsv` / `renderEntries` /
  `regenerateKgpSource` / `buildRegen` are pure over the koine sources; `writeRegen`/`runRegen`
  (and read-only `diffRegen`/`runCheck`) do the fs side. `buildRegen` reads + validates all five
  koine sources before any write, so a missing source aborts without leaving a one-sided mirror.
- `kgp.ts` uses `// @generated:begin/end {core,domain}-relations` markers; the regen replaces
  only the entry lines between them (JSDoc + const decls preserved). The domain prefix is the TSV
  `domain` column, NOT the file stem (`cinematography.tsv` → `cine:`).
- **The drift gates that pair with it:** `contracts/predicate-mapping.test.ts` byte-compares the JSON
  and signature-compares the TSV vocabulary under `skipIf(!hasKoine)`, and `convergence-qa.ts`
  `detectRegistryStaleness` emits a `registry-stale` `DriftIssue` (both guarded on koine presence,
  so a checkout without the sibling repo is unaffected). Running the regen against the live 0.4.2
  koine checkout is an empty diff — the mirrors are already vendored.

## Convergence QA gate (US-008)

`convergence-qa.ts` is the network-free drift gate both projects run in CI. It composes the
existing pure builders — `buildExport` (§export) for the manifest + provenance coverage and
`buildReconciliation` (§reconciliation) for the id-overlap / unreconciled numbers — so there is
**one** source of truth per metric; don't recompute them here. `detectDrift(lexiconsDir)` is the
cheap gate (header reads only, no export build): it runs `assertValidCanonicalSchema` +
`assertValidLexiconMapping`, checks the export's provenance columns still exist, flags any
`data/source/lexicons/*.tsv` on disk that is unmapped, and flags any mapped column absent from a live header.
`buildConvergenceQA` adds the metrics; `runQA` returns `{ report, exitCode }` (`1` on drift).

- **Three hard checks fail the gate** (`report.ok === false` ⇒ non-zero exit), since US-001:
  (1) **drift** (as above); (2) **attribution** (`detectAttributionGaps`) — any acquisition-imported
  row (non-blank `wikidata_qid`-mapped cell) missing `source`/`source_url`/`retrieved_at`/`confidence`;
  it reads the **lexicons**, NOT the export (which force-blanks `source_url`/`retrieved_at`), and uses
  the per-file mapping so it generalises across domains without hard-coded column names; (3) **dedup
  regression** (`detectRegressions`) — a monotone ratchet against `docs/convergence-qa-baseline.json`
  (`duplicateCsids`, `ambiguousPinakesIds`, `edgesWithUnresolvedEndpoint`, reconciliation
  `ambiguous`). The id-overlap / unreconciled / provenance-coverage numbers stay informational.
- **GOTCHA — the dedup ratchet is a baseline, not a zero.** The live corpus already has
  `duplicateCsids=44`, `ambiguousPinakesIds=16`, `edgesWithUnresolvedEndpoint=139` (legit
  cross-file id reuse), so an absolute `=== 0` would be red on day one. After a data change that
  *legitimately* moves these, re-baseline with `npm run convergence-qa:baseline`
  (`--write-baseline`) — a live-corpus test asserts `report.regressions === []` on `main`, so a stale
  baseline fails CI. Run `npm run convergence-qa` before committing any data change.
- **A directory is a corpus, not a full-mapping assertion.** Column drift is only checked for
  files actually present, so a fixture with a subset of the mapped files is clean — a mapped file
  being *absent* is not drift (only present-but-unmapped, or a renamed column, is). This is what
  lets the drift tests use tiny fixtures instead of copying the whole live corpus.
- **Fixture trick for a clean mapped file:** build its header from
  `lexiconMappingByFile(file).columns.map(c => c.column)` so it matches the mapping exactly (no
  false `missing-source-column`). Drop one column to simulate a rename; add an extra `*.tsv` to
  simulate an unmapped file. See `convergence-qa.test.ts`.
- Artifact (`convergence-qa.{json,md}`) lands in the gitignored `build/corpus/convergence/`
  tree — no committed snapshot (the metrics track the live corpus, so a snapshot would need
  constant re-sync). CI runbook: `docs/canonical-schema.md` §10.

## Coverage report vs roadmap targets (US-008)

`coverage-report.ts` compares actual lexicon row counts against the roadmap /
data-population **targets** per domain and flags any domain still under target. It emits two
committed artifacts — `docs/coverage-report.json` (deterministic, no timestamp; asserted
against the live corpus by `server/services/data-quality-scorer.test.ts`) and
`docs/coverage-report.md` (human table). Re-run `npx tsx scripts/coverage-report.ts` after any
data change that moves a target domain's count, or the parity test fails.

- **Targets + comparison live in the service, not here.** `ROADMAP_TARGETS`, the pure
  `computeCoverage(rowCounts)`, and `buildCoverageReport(lexiconsDir)` are exported from
  `server/services/data-quality-scorer.ts` so `/api/data-quality` and this committed report are
  **one source of truth**. The script is just the deterministic file-writer + Markdown renderer.
- **Two target kinds:** `kind: "roadmap"` = the hard §8/§15 numbers from
  docs/prd-pinakes-deep-history-roadmap.md; `kind: "breadth"` = the credible-breadth goals
  the US-003..005 stories set for domains the roadmap describes only qualitatively
  ("foundational corpus"). Each carries a `source` string. When you add a domain target, add it
  to `ROADMAP_TARGETS` and regenerate the committed report.

## Corpus trust-tier report (tiered-trust US-004)

`corpus-tier-report.ts` is the deterministic file-writer for the trust-tier composition, the exact
sibling of `coverage-report.ts`: it imports `buildCorpusTierReport` from the shared
`data-quality-scorer` service (one source of truth) and emits `docs/corpus-tier-report.{json,md}`.
The JSON is asserted against the live corpus by `server/services/data-quality-scorer.test.ts`, so
**re-run `npx tsx scripts/corpus-tier-report.ts` after any node-lexicon change that moves QID /
`source_url` coverage** (e.g. a QID backfill), or that parity test fails. Tiers come from
`@contracts/trust-tier` (`classifyTrustTier`, the TS mirror of pinakes-engine's `orchestrate/tiers.py`);
the report tracks **auto-admission readiness** (the whole curated corpus is `graphTier: curated`).

## Reconciliation dry-run (US-005)

`reconciliation-report.ts` emits the keys pinakes-engine's reconciler keys on
(language `iso639_1`/`iso639_2`/glottocode; normalized `(name, type, region)` for
everything else) and a **dry-run** estimate — no network, no live graph — of how the
export lands: `matched` (global anchor), `likely-new` (unique name key), or `ambiguous`
(blocking-key collision, listed with competing candidates, **never auto-merged**). Output:
`build/corpus/reconciliation/{keys.tsv,report.json}` (gitignored) + a committed
snapshot `docs/reconciliation-report.json` (ambiguities bounded to 50). `buildReconciliation()`
is pure over a lexicons dir; it reuses `mintCsid`/`normaliseConfidence` from
`export-for-engine.ts`. **Gotcha:** the committed snapshot is asserted against the live
corpus by a test — re-run the CLI (`npx tsx scripts/reconciliation-report.ts`) after any
change that shifts node counts/keys, or that live test fails. Region is read from the first
header ending in `region` (`region`/`origin_region`/`proposed_region`). Language matching
uses `iso639_1 || iso639_2 || glottocode` (US-006 added a `glottocode` column to
`languages.tsv`, so the glottocode is a fallback anchor for languages lacking an ISO code; the
report's `keyCoverage.languages.withGlottocode` tracks it). See
`engine/docs/reconcile-pinakes.md`.

- **The QID anchor IS cascade step 1 (US-003).** The report originally bucketed on the
  language/name key only, so a node that already carried a `wikidata_qid` was miscounted as
  `likely-new`. It now buckets **any** QID-bearing node as `matched` (a QID resolves the same
  entity every time; two nodes sharing a QID are the same entity, collapsed by
  `reconcile_shared_qids`, NOT a blocking ambiguity — so QID never produces an ambiguity
  group). `keyCoverage.withWikidataQid` counts them and `KEYS_HEADER` gained a `wikidata_qid`
  column. This is why backfilling QIDs (below) moves `matched`: without the anchor-aware
  bucketing, a filled `wikidata_qid` would not change the report.

## Batch QID backfill on unreconciled rows (US-003)

`reconcile-lexicon-qids.ts` is the networked **acquire → reconcile** step that proposes
`wikidata_qid`s for lexicon rows that lack one (the reason ~80% of nodes were `likely-new`).
Same replay-source discipline as the acquire scripts: it writes a committed, deterministic
candidates artifact `scripts/data/lexicon-qid-candidates.tsv` (CI never hits Wikidata),
and `--apply` fills the blanks from it.

- **Exact-label match, precision-first.** Per addressable row (blank `wikidata_qid`, non-blank
  `name`, `id` unique in its file) it queries Wikidata for an entity whose English `rdfs:label`
  equals the name exactly — **class-constrained** (`wdt:P31/wdt:P279* wd:<class>`) via
  `QID_TARGETS` where a reliable class exists, else **global label uniqueness** (minus
  Wikimedia disambiguation/category/list pages). Exactly one match ⇒ `accepted`; ≥2 ⇒
  `ambiguous` (competing QIDs listed, **never auto-accepted**); 0 ⇒ `none`. `languages.tsv` is
  excluded (already ISO/glottocode-matched — a QID adds no `matched`).
- **Apply = the enrichment write-back.** `applyAccepted` calls
  `import-from-engine.buildEnrichment` per file: fills the blank `wikidata_qid` plus full
  provenance (`source_url`, `retrieved_at`, `confidence` from the `exact-reconciled` rubric class
  on the file's own 0–1/0–100 scale via `detectConfidenceScale`, `sources`). Blanks only — a
  differing curated cell (e.g. an existing `confidence`) is a reported conflict, never clobbered.
  **The attribution gate requires all of source/source_url/retrieved_at/confidence on any
  QID-bearing row**, so an accepted row MUST end up with every provenance cell non-blank (it
  does — pre-existing or newly filled). Idempotent: re-running `--apply` adds 0.
- **GOTCHA — filling a QID re-mints the csid** (`cs:<type>:<id>` → `cs:<type>:<QID>`), so after
  `--apply` regenerate BOTH `docs/engine-export-manifest.json` and
  `docs/reconciliation-report.json` and run `npm run convergence-qa`. A backfilled QID that
  collides with an existing same-type QID would create a `duplicateCsids` regression the gate
  blocks — none occurred, but verify the diagnostics after a fresh batch.
- The matched-share ceiling (why one pass lands ~37%, not ≥50%) is documented in
  `engine/docs/reconcile-pinakes.md` (US-003): most remaining
  `likely-new` nodes live in lexicon files that carry **no** `wikidata_qid` column yet, so
  backfilling them needs a per-file schema addition (a separate scale-up).

## Language glottocode enrichment (US-006)

`acquire-language-glottocode.ts` is the per-domain **acquire → enrich** step for the
`glottocode` column on `languages.tsv` (language identity must not rest solely on ISO codes —
macro-code collisions like `hmn`). Same shape as `acquire-language-status.ts`: the one
networked step, emitting a committed replay TSV (`scripts/data/language-glottocode-enrichment
.tsv`) the write-back + gate operate on (CI never hits Wikidata). Apply it with the generic
enrichment write-back: `import-from-engine --enrich <file> --target languages.tsv`.

- **Two glottocode sources, Wikidata-first.** Wikidata **P1394** (`glottolog code`) keyed by the
  row's `wikidata_qid` is primary (every QID-bearing corpus language resolves one); `words.tsv`
  `Glottocode` (LexiBank/CLDF, joined by the `iso639_2` ISO-639-3 slot) is the fallback for
  rows with **no** QID. A QID row always resolves via Wikidata, so words.tsv only adds a handful.
- **Provenance rule avoids write-back conflicts.** A Wikidata-sourced glottocode inherits the
  target row's *existing* Wikidata provenance (its QID/`source_url` are already stamped), so the
  enrichment record carries **only** `glottocode` — re-stamping `retrieved_at`/`sources` would
  conflict with the endangerment enrichment's UNESCO provenance and be *reported*. A words.tsv-only
  (no-QID) row has blank provenance, so it *is* stamped with Glottolog provenance (its first
  sourced datum). Net: `--enrich` lands 0 conflicts.
- **`glottocode` is mapped as `property`** in `lexicon-mapping.json` (mirrors `iso639_2` — a
  secondary reconciliation key with no dedicated canonical field), so it is NOT in the export node
  header (`nodeHeaderRow` is fixed) and the export manifest's node columns are unchanged. The only
  manifest movement is the 24 words.tsv rows gaining `source_url`/`retrieved_at`/`source_query`
  provenance (a deliberate coverage rise). The reconciliation report reads glottocode by a
  column-name regex (`/glotto/i`), not via the canonical mapping, so `withGlottocode` populates
  from the property column.

## Identity dedupe migration — `dedupe-identity.ts` (US-008)

The one-shot, idempotent, byte-faithful migration that burned the export's 44 duplicate
csids (`cs:<type>:<id>` collisions = same `id` reused by ≥2 nodes of ONE type) and 16
ambiguous `pinakes_id`s (one raw `id` across ≥2 node TYPES → different csids) to zero.
It edits `data/source/lexicons/*.tsv` in place (per-file EOL + trailing-newline preserved; only the
targeted cells change) and is safe to re-run (a row whose old id is already gone is skipped).
Reusable rules for any future id-collision cleanup:

- **The two metrics are driven ONLY by the node `id` column.** duplicateCsids = same-type
  same-id; ambiguousPinakesIds = same raw id across types. So the fix is always a node
  `id` rename or a row delete — nothing else moves them. `id` renames do NOT touch the
  reconciliation `ambiguous` metric (languages key on iso639_1/iso639_2/glottocode, everything
  else on (name,type,region) — never `id`).
- **Rename, don't delete, to avoid clobbering curated data.** Keep BOTH near-duplicate rows
  with distinct ids (`-classical` for `is_historical_variant=true` entries, `-manding`/`-western`
  for a language duplicated under two family hierarchies, a name-slug for a distinct language that
  mis-shares an ISO/collective code — the 9 Totonac lects all carried `iso639_2=tot`). Only
  delete a row that is **byte-identical** to its twin (3 cuisine-items rows here).
- **Keep the id on the FK/edge-referenced side; rename the leaf.** Every original id must still
  resolve to a kept node so no edge is orphaned into a needs-curation stub (US-007) and the 6
  referential-integrity FKs (`data-quality-scorer.ts` `FOREIGN_KEY_MAP`:
  languages.family_id/parent_language_id, families.parent_id, grammar-features/phonological-
  inventories/words → languages.id) stay 100%. For a cross-type pair, the referencing COLUMN
  disambiguates the type (`civilization_id`→culture, `archaeological_culture_id`→arch-culture,
  `families.parent_id`→family, `language_id`/`Language_ID`→language), so re-point precisely.
  Only the renamed node's own references need following: e.g. keeping the Nok archaeological
  culture but renaming the Nooksack *language* means re-pointing grammar-features/phonological-
  inventories `language_id` (the language FKs) but nothing else.
- **The EDGE-endpoint columns are the ones that mint stubs if orphaned** (from
  `contracts/lexicon-mapping.json` `edge`/`:START_ID`/`:END_ID` dispositions): archaeological-cultures
  predecessor/successor_culture_ids, cultural-lineages source_id/target_id (**polymorphic** — any
  node type), deities.syncretism_links, etymology-relations + language-contacts endpoints,
  families.parent_id, languages.family_id/parent_language_id, writing-systems.parent_system_id.
  `associated_*`/`culture_id`/`pantheon` are **property** columns (not FKs, not edges) — not gate-
  checked, so they re-resolve to the kept same-id node harmlessly.
- **VERIFY EMPIRICALLY, twice.** New ids can collide with EXISTING ones (here `esselen`,
  `mohenjo-daro-settlement`, and an existing `indus-valley-civilization` archaeological culture
  all pre-existed — the first slug choices regressed). After the migration re-run the
  duplicate/ambiguous diagnostic AND the export, and watch `diagnostics.{duplicateCsids,
  ambiguousPinakesIds,edgesWithUnresolvedEndpoint,stubNodesMinted}` (stubs must NOT rise).
- **Recovering dropped rows RAISES reconciliation `ambiguous`.** The 44 duplicate-csid rows were
  being silently dropped from BOTH the export and reconciliation (`buildReconciliationKeys`
  `duplicateCsidsDropped`). Making them distinct surfaces them in reconciliation, where near-dups
  sharing an ISO/collective code legitimately block-collide → `reconciliationAmbiguous` rose
  242→302. That is a **deliberate, explained** re-baseline of `docs/convergence-qa-baseline.json`
  (`npm run convergence-qa:baseline`), not a regression to hide. Lowering it is a follow-up
  glottocode/ISO-enrichment task.

## API parity baseline — `gen-parity-spec.ts` + `record-parity-fixtures.ts` (30-api-shell-parity US-1)

The two generators behind `contracts/parity/` (contract + rules:
[`contracts/parity/README.md`](../contracts/parity/README.md)). `npm run parity:record`
replays the curated catalog against the real Express app on an ephemeral port and writes
`contracts/parity/fixtures/`; `npm run parity:spec` harvests the routing table into
`contracts/parity/openapi.json`. **Record first** — the spec folds recorded shapes into each
operation's response schema. `npm run parity:spec:check` is the read-only sibling (exit 1 when
stale), and `contracts/parity/parity.test.ts` enforces both in CI.

- **These are the only scripts here that boot the server.** `harvestRoutesFromApp` calls the
  real `registerRoutes(app)` and never listens; the recorder listens on `127.0.0.1:0` (never a
  bare `listen(0)` — see `server/CLAUDE.md`). Registration is side-effect-safe today (the KCB
  registry push is fire-and-forget and no-ops without `KCB_REGISTRY_URL`); keep it that way, or
  the generators start needing a live backend.
- **Attribution comes from a stack frame, not a regex** (`instrumentRouteSources` +
  `callerFile`) — that is what attributes `app.get(MCP_ROUTE_PATH, …)` to `routes/mcp.ts`.
  `tsx` emits source maps, so frames name the original `.ts`.
- **Both outputs are deterministic**: no timestamps, fixtures sorted by id, spec paths sorted.
  Re-running against an unchanged API is an empty diff — keep any new field wall-clock-free.
- A recorded response reflects the recording environment (no Neo4j / sidecar / API keys), so
  degraded contracts (`/api/graph/status`) are recorded as such **on purpose**.
