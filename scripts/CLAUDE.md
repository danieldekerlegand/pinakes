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

## Convergence QA gate (US-008)

`convergence-qa.ts` is the network-free drift gate both projects run in CI. It composes the
existing pure builders — `buildExport` (§export) for the manifest + provenance coverage and
`buildReconciliation` (§reconciliation) for the id-overlap / unreconciled numbers — so there is
**one** source of truth per metric; don't recompute them here. `detectDrift(lexiconsDir)` is the
cheap gate (header reads only, no export build): it runs `assertValidCanonicalSchema` +
`assertValidLexiconMapping`, checks the export's provenance columns still exist, flags any
`lexicons/*.tsv` on disk that is unmapped, and flags any mapped column absent from a live header.
`buildConvergenceQA` adds the metrics; `runQA` returns `{ report, exitCode }` (`1` on drift).

- **Only drift fails the gate** (`report.ok === false` ⇒ non-zero exit). The id-overlap /
  unreconciled / provenance numbers are informational — never threshold them into a hard failure.
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
