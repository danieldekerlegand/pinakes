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
  `NEO4J_PASSWORD=linguascrape` are low-entropy dictionary words → not flagged).
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

## Live-graph smoke test (US-005)

`smoke-graph.ts` is the one script here that makes **HTTP** calls (not a data
transform) — it probes the running app's `/api/graph/*` routes and asserts real,
non-empty data (`npm run smoke:graph`, docs in
`packages/culture-scrape/docs/convergence-build.md` "US-005"). Reusable shape for any
"hit the live app and check it" script:

- **Never throw on a down backend.** Every `fetch` is wrapped so a transport failure
  (`ECONNREFUSED`, timeout via `AbortController`) becomes a `{reached:false}` result,
  not an unhandled rejection. The CLI catches at the top and prints a clear message.
- **Exit-code contract:** `0` = passed **or** gracefully skipped (stack down — absent
  services are not a failure); `1` = a backend was **up** but a check returned
  empty/wrong data (a real regression). This lets it run locally with nothing up.
- Response **types are imported** from the server services (`graph-health`,
  `graph-store`, `culturescrape-client`) via `import type` — parity with the routes,
  erased at runtime. It imports no runtime server code, so it starts instantly.
- It discovers a real node `csid` from `/search` (sidecar), falling back to
  `/overview` (Neo4j) so the node/neighborhood checks can still run when only one
  backend is up.
- **GOTCHA — the sidecar and Neo4j must serve the SAME corpus or the cross-backend
  `node/:id` check 404s.** `discoverCsid` takes a csid from the **sidecar** search
  then looks it up in **Neo4j**; if the sidecar is on its bundled 9-node demo
  fixture (the `CORPUS` default) while Neo4j holds the LinguaScrape export
  (loaded by `to-neo4j export/culturescrape`), the csid doesn't exist in Neo4j and
  the smoke fails. To run a fully green smoke: point the sidecar at the same bare
  corpus — `docker-compose.yml` mounts the gitignored `export/culturescrape` at
  `/corpus:ro`, so bring the stack up with `CULTURESCRAPE_CORPUS=/corpus docker
  compose up -d culturescrape neo4j` (`load_corpus` reads a `nodes/`+`edges/` dir
  directly). Default stays the demo fixture so a bare `docker compose up` still
  starts when no export has been built.

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

## Bidirectional write-back (US-007)

`import-from-culturescrape.ts` is the **return leg** of the export: it reads the enriched
canonical node TSVs (`<canonicalDir>/nodes/<type>.tsv`) and writes graph-derived facts back
into `lexicons/*.tsv` via the **reverse** of the US-002 `target` map. `buildWriteBack(canonicalDir,
lexiconsDir, {overwrite})` is pure (returns edited in-memory files + a report);
`writeWriteBack`/`runWriteBack` do the filesystem side. Report →
`export/culturescrape/writeback/report.json` (gitignored). Full contract + ownership table:
[`docs/canonical-schema.md` §9](../docs/canonical-schema.md).

- **Only fills blanks by default** (enrichment). A differing curated cell is a **conflict** —
  reported (`report.conflicts`), never silently resolved; `{overwrite:true}` / `--overwrite`
  is the only way to apply it (still logged as a conflict).
- **`NON_WRITEBACK_FIELDS`** (identity + all provenance/confidence columns) are never written —
  LinguaScrape owns curated columns; the graph owns edges + external-authority enrichment.
- **GOTCHA — `linguascrape_id` is NOT globally unique** in the live corpus. The same id recurs
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

## New-row additions (US-003, data-population pilot)

Same file also grows the corpus: `--add-cultures [file]` **appends** curated,
reconciliation-*new* civilizations into `lexicons/civilizations.tsv` (default input:
committed `scripts/data/civilizations-additions.tsv`, derived from the US-002 acquired
corpus). `buildCultureAdditions(parsedFile, candidates)` is pure; `runCultureAdditions` /
`loadCultureAdditions` do the fs side. Report →
`export/culturescrape/writeback/civilizations-additions-report.json` (gitignored); committed
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
- **GOTCHA — after changing any `lexicons/*.tsv` row/column count, regenerate BOTH committed
  snapshots** or their live-corpus parity tests fail: `npx tsx scripts/export-for-culturescrape.ts`
  (→ `docs/culturescrape-export-manifest.json`) **and** `npx tsx scripts/reconciliation-report.ts`
  (→ `docs/reconciliation-report.json`). Adding a mapped column also needs its
  `shared/lexicon-mapping.json` disposition (totality test) — `npx tsc -p scripts/tsconfig.json`
  won't catch that; `shared/lexicon-mapping.test.ts` will.

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
  `ambiguousLinguascrapeIds` diagnostic keys on the raw `linguascrape_id` across **every** node
  type (`idIndex` in `export-for-culturescrape.ts`), so a generic culture id like `sumer`/`vedas`
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
  `oduduwa` as both writing-system + deity) → a global `ambiguousLinguascrapeIds` regression. `main`
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

## Convergence QA gate (US-008)

`convergence-qa.ts` is the network-free drift gate both projects run in CI. It composes the
existing pure builders — `buildExport` (§export) for the manifest + provenance coverage and
`buildReconciliation` (§reconciliation) for the id-overlap / unreconciled numbers — so there is
**one** source of truth per metric; don't recompute them here. `detectDrift(lexiconsDir)` is the
cheap gate (header reads only, no export build): it runs `assertValidCanonicalSchema` +
`assertValidLexiconMapping`, checks the export's provenance columns still exist, flags any
`lexicons/*.tsv` on disk that is unmapped, and flags any mapped column absent from a live header.
`buildConvergenceQA` adds the metrics; `runQA` returns `{ report, exitCode }` (`1` on drift).

- **Three hard checks fail the gate** (`report.ok === false` ⇒ non-zero exit), since US-001:
  (1) **drift** (as above); (2) **attribution** (`detectAttributionGaps`) — any acquisition-imported
  row (non-blank `wikidata_qid`-mapped cell) missing `source`/`source_url`/`retrieved_at`/`confidence`;
  it reads the **lexicons**, NOT the export (which force-blanks `source_url`/`retrieved_at`), and uses
  the per-file mapping so it generalises across domains without hard-coded column names; (3) **dedup
  regression** (`detectRegressions`) — a monotone ratchet against `docs/convergence-qa-baseline.json`
  (`duplicateCsids`, `ambiguousLinguascrapeIds`, `edgesWithUnresolvedEndpoint`, reconciliation
  `ambiguous`). The id-overlap / unreconciled / provenance-coverage numbers stay informational.
- **GOTCHA — the dedup ratchet is a baseline, not a zero.** The live corpus already has
  `duplicateCsids=44`, `ambiguousLinguascrapeIds=16`, `edgesWithUnresolvedEndpoint=139` (legit
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
- Artifact (`convergence-qa.{json,md}`) lands in the gitignored `export/culturescrape/convergence/`
  tree — no committed snapshot (the metrics track the live corpus, so a snapshot would need
  constant re-sync). CI runbook: `docs/canonical-schema.md` §10.

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
