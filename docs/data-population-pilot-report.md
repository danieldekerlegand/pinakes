# Data-population pilot report — civilizations

**Verdict: GO** for the full `data-population` scale-out, conditional on three named
pipeline fixes (below). The acquisition → reconcile → write-back → graph → UI pipeline was
proven end-to-end on one domain (civilizations), landing real, attributed data all the way
into the running app.

- **Pilot:** `data-population-pilot` (branch `ralph/data-population-pilot`), US-001…US-006.
- **Roadmap:** de-risks [§15 "Data population at scale"](./roadmap/prd-pinakes-deep-history-roadmap.md#15-data-population-at-scale--the-priority),
  the highest-leverage gap. Civilizations was §15's first pilot row (89 actual → 150+ target).
- **Date:** 2026-07-08. Accurate against the committed state of US-001…US-005.

---

## 1. What shipped (entities added)

| metric | value |
| --- | --- |
| civilizations before | 89 (curated seed) |
| civilizations after | **170** |
| net added | **+81** |
| §15 target | 150+ |
| target attainment | **113%** — target met |
| `:Culture` nodes in Neo4j | 340 (170 civilizations + other culture lexicons → `:Culture`) |
| map features served | 170 (`/api/map/civilizations`) |

The 81 added rows were curated from the three **tightest** verified Wikidata classes:
ancient civilization (Q28171280) ×21, civilization (Q8432) ×47, empire (Q48349) ×13.
Source of truth is `data/source/lexicons/civilizations.tsv` (89→170); the built corpus stays gitignored.

## 2. Reconciliation / dedup rate

Acquisition ran the 8 verified SPARQL queries in `jobs/civilizations.yml` and normalized
into the canonical corpus: **4,743 nodes, 4,734 distinct `:Culture` by QID**, 100% connected.
That acquired set was reconciled against the 89 curated civilizations
(`src/pinakes_engine/schema/lexicon_reconcile.py`, cross-source fuzzy threshold 0.93):

| bucket | count |
| --- | --- |
| matched (existing ↔ acquired) | 57 (all verified correct) |
| new | 4,677 |
| **ambiguous** | **0** (none auto-merged) |
| union, distinct | 4,766 |

- **Dedup held:** 0 ambiguous, 0 duplicate QIDs in the corpus (convergence QA `dup=0`,
  `dangling=0`). The write-back is independently idempotent — a second run adds 0 and leaves
  the file byte-identical (dedup by `wikidata_qid` → normalised name → id).
- **Curation, not bulk-append (key finding).** The 8 verified classes are *broader* than
  "civilization": ~14% (683) of acquired rows were unlabelled (name == QID), and the broad
  classes (`historical-country`, `realm`, `dynasty`, `city-state`, `kingdom`) pull in modern
  states, orgs, militias, parties, and movements. So of 4,677 "new" rows we deliberately wrote
  back only **81** — QID-named and non-civilization noise dropped, names already present
  removed. **Yield after curation ≈ 1.7%** of the raw acquired set for this domain. This is the
  single most important lesson for scale-out: raw acquisition volume ≠ publishable rows.

## 3. Provenance / attribution compliance (Guiding Principle #8)

- **Every added row carries full provenance.** All 81 appended rows have `wikidata_qid`,
  `source_url` (`http://www.wikidata.org/entity/<QID>`), `retrieved_at` (acquisition ISO-8601),
  `confidence = 1.0`, and a bibliographic `sources = ["Wikidata"]`. Four provenance columns were
  added to `civilizations.tsv` and mapped in `contracts/lexicon-mapping.json`; existing curated rows
  carry them blank.
- **QA gate passes.** The convergence QA gate is green: provenance coverage 0.999 (≥0.5 floor),
  `dup=0`, `dangling=0`, 0 drift. Python gate green throughout (ruff/mypy clean, pytest 1488
  passed / 20 skipped).
- **No curated cell was clobbered.** Write-back is append-only by construction; a conflicting
  curated cell is *reported*, never silently overwritten (0 conflicts here).
- **Known attribution gap (fix #1 below).** `scripts/export-for-engine.ts` derives the
  canonical `source_url` only from the bibliographic citation, so the Wikidata entity URL lives in
  the lexicon (and is shown in-app, which reads the lexicon) but is **not yet propagated** to the
  canonical export / Neo4j for these rows. `source` is still force-stamped `pinakes` and the
  QID/citation preserved in `source_query`. The app shows the source link; the graph does not.

## 4. Wall-clock / throughput

| stage | command | wall-clock | output |
| --- | --- | --- | --- |
| acquire + normalize | 8 SPARQL queries (`jobs/civilizations.yml`) | **~75 s** | 4,734 distinct `:Culture` |
| reconcile | `scripts/reconcile_civilizations.py` | seconds (in-memory) | matched/new/ambiguous report |
| curate | manual + `scripts/data/civilizations-additions.tsv` | human step | 81 publishable rows |
| write-back | `import-from-engine.ts --add-cultures` | seconds | `civilizations.tsv` 89→170 |
| canonical export | `export-for-engine.ts` | seconds | 5,432 nodes / 5,526 edges (gitignored) |
| Neo4j load | `pinakes_engine to-neo4j --mode loadcsv` | **~19 s** | 37 constraint/index + 24 LOAD CSV stmts |
| verify counts | `pinakes_engine neo4j-counts` | seconds | `:Culture: 340`, idempotent on re-load |

**Throughput reading:** the machine steps are cheap and fast (network acquisition ~75 s/domain,
graph load ~19 s). The **curation step is the throughput bottleneck** — turning 4,677 raw "new"
rows into 81 trustworthy ones was human judgement, not compute. Scale-out cost scales with
*curation*, not acquisition.

## 5. Graph & app verification (real breadth, end-to-end)

- **Neo4j:** loaded the expanded corpus via `to-neo4j --mode loadcsv`; `neo4j-counts` shows
  **`:Culture: 340`** (target 150+), total 5,432 nodes / 1,931 edges. Load is idempotent
  (MERGE-on-`csid` behind an `Entity.csid` uniqueness constraint) — a second load leaves counts
  unchanged. 81 `:Culture` nodes carry `wikidata_qid` + `confidence=1.0`.
- **App (live `dev:full` stack):** civilizations render on the **map** (170 features, 81 with
  `wikidataQid`+`sourceUrl`+`confidence=1.0`), in the **UnifiedExplorer** (new
  `civilizations.adapter.ts`, 170 items), and in **detail panels with provenance** (`<ProvenanceList>`
  + source link to wikidata.org). `e2e/civilizations.spec.ts` 4/4 pass; `npm run smoke:graph`
  5/5 pass; `npm run check` 0 new errors. Screenshots in `test-results/civilizations/`.

## 6. Gotchas (must-carry into scale-out)

1. **Broad Wikidata classes are noisy.** `historical-country` / `realm` / `dynasty` / `city-state`
   / `kingdom` return modern states, parties, militias, and movements alongside real
   civilizations, plus ~14% unlabelled (QID-named) rows. Curate down to the tight classes or add a
   noise filter — do **not** bulk-append the acquired set.
2. **Neo4j `loadcsv` needs real infra, not `docker compose -f infra/docker-compose.yml up`.** The `file://` LOAD CSV path
   needs APOC + `allow_csv_import_from_file_urls=true` **and** `server.directories.import=/` to lift
   the import-dir jail (the trap: `allow_csv` alone still resolves `file:///abs` *under* the import
   dir → `ExternalResourceFailed`). `infra/docker-compose.yml`'s `neo4j` service now wires this.
3. **`smoke:graph` needs the sidecar and Neo4j on the SAME corpus.** `dev:full` defaults the
   sidecar to a bundled 9-node demo while Neo4j holds the real export → the cross-backend `node/:id`
   check 404s. Run `PINAKES_ENGINE_CORPUS=/corpus docker compose -f infra/docker-compose.yml up -d pinakes_engine neo4j`.
4. **After any `data/source/lexicons/*.tsv` shape change, regenerate BOTH committed snapshots**
   (`docs/engine-export-manifest.json` via the export CLI, and `docs/reconciliation-report.json`
   via the reconciliation CLI) or their live-corpus parity tests fail.
5. **`source_url` does not reach the graph** (see §3). App-visible ≠ graph-visible for external URLs.

## 7. Recommendation & required pipeline fixes

**GO** — proceed to `data-population` across the remaining §15 domains (archaeological sites 151→500+,
archaeological cultures 27→200+, migration routes 62→100+, trade routes, cuisines 21→80+, literary
traditions). The pipeline is proven and the QA/attribution gates hold. Do it **one domain at a time**
behind the same curate → QA → commit gate, not a single mega-run.

Ship these fixes with (or before) the scale-out:

- **Fix #1 — propagate `source_url`/`wikidata_qid` into the canonical export.** Make
  `export-for-engine.ts` emit the lexicon's `source_url`/`wikidata_qid` onto the canonical
  node so Neo4j and the graph API carry the Wikidata attribution, not just the lexicon. Today the
  app shows it but the graph does not — an academic-credibility gap at scale.
- **Fix #2 — add a reusable noise filter / curation harness.** The manual "drop QID-named, drop
  militias/parties/`… people`/`… culture`/`… district`, drop tight-vs-broad classes" pass was
  civilization-specific. Generalise it (per-domain allow/deny class lists + a QID-named reject) so
  each domain isn't re-curated from scratch. Curation is the throughput bottleneck (§4) — invest here.
- **Fix #3 — make corpus alignment the default for verification.** Bake the
  `PINAKES_ENGINE_CORPUS=/corpus` alignment into the `dev:full` / verification path so `smoke:graph`
  is green out of the box against the real export, not the demo fixture.

Optional but recommended: capture a per-domain "acquired → curated → published" yield metric in the
QA report so §15's progress table can be tracked automatically as domains fill in.

---

## References

- Roadmap: [§15 Data population at scale](./roadmap/prd-pinakes-deep-history-roadmap.md#15-data-population-at-scale--the-priority),
  [§16 Production-verification pass](./roadmap/prd-pinakes-deep-history-roadmap.md), Guiding Principles #5 & #8.
- Integration design: [`engine-integration.md`](./engine-integration.md),
  [`engine/docs/convergence-build.md`](../engine/docs/convergence-build.md).
- Pilot artifacts: [`civilizations-writeback.md`](./civilizations-writeback.md),
  [`civilizations-neo4j-load.md`](./civilizations-neo4j-load.md),
  [`civilizations-app-verification.md`](./civilizations-app-verification.md).
- Per-story detail: `scripts/ralph/prd.json` (`notes`) and `scripts/ralph/progress.txt`.
