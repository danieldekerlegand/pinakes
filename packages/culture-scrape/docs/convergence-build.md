# Corpus rebuild & graph-refresh runbook (US-008)

This is **the** operational runbook for the LinguaScrape ↔ culture-scrape convergence:
how to (re)build the merged corpus, load it into Neo4j, materialize the Datalog
inference layer, and prove the live app talks to the stack — end to end, with the exact
commands. It also records the **refresh cadence** and the **"add a new domain to the live
graph" checklist**.

Two audiences read this doc:

- **Just want a deterministic, offline, CI-runnable rebuild?** Run [the one
  command](#the-one-command) — it (re)builds the corpus from the committed fixture export.
- **Operating the real, live graph?** Follow [the full pipeline](#the-full-pipeline-at-a-glance)
  (US-001 → US-005): build the *full* corpus from the live lexicons, load Neo4j, materialize
  Datalog, and smoke-test from the app.

**Where the pieces are documented** (this runbook stitches them together):

- **Contract** — the shared node/edge schema every step targets:
  [`docs/canonical-schema.md`](../../../docs/canonical-schema.md).
- **Design & data flow** — why convergence works this way, plus the round-trip diagram and
  the "add a new LinguaScrape domain" mapping steps:
  [`docs/culturescrape-integration.md`](../../../docs/culturescrape-integration.md)
  (§8 end-to-end data flow, §9 add-a-domain, §10 which side owns which step).
- **Per-step design** — [`reconcile-linguascrape.md`](reconcile-linguascrape.md) (ingest/merge),
  [`neo4j.md`](neo4j.md) (load), [`datalog.md`](datalog.md) (inference).

## The full pipeline at a glance

The live-graph refresh is five phases. Each maps to a story and to a detailed section
below; run them in order. Steps 1–2 are TypeScript at the repo root; steps 3–5 are the
Python engine under `packages/culture-scrape/` (paths below are relative to that package
root unless noted). The design-level round trip is
[`culturescrape-integration.md` §8](../../../docs/culturescrape-integration.md).

| # | Phase | Command | Detail |
|---|---|---|---|
| 1 | **Export** the live lexicons → canonical TSV | `npx tsx scripts/export-for-culturescrape.ts` *(repo root)* | [full corpus (US-001)](#the-full-publishable-corpus-us-001) |
| — | **Reconcile** dry-run (optional preview) | `npx tsx scripts/reconciliation-report.ts` *(repo root)* | [§8](../../../docs/culturescrape-integration.md) |
| 2 | **Build** the corpus (acquire → normalize → reconcile/link → export) | `uv run culturescrape run jobs/linguascrape-full.yml` | [US-001](#the-full-publishable-corpus-us-001) |
| — | **Validate + QA** the output | `uv run culturescrape validate out/linguascrape-full/corpus` | [US-001](#the-full-publishable-corpus-us-001) |
| 3 | **Publish** the versioned artifact (`.tar.gz` + SHA-256 manifest) | `uv run culturescrape package out/linguascrape-full/corpus --out dist --name linguascrape-full-corpus` | [US-001](#the-full-publishable-corpus-us-001) |
| 4 | **Load** into Neo4j (constraints/indexes + idempotent MERGE) | `uv run culturescrape to-neo4j out/linguascrape-full/corpus --mode loadcsv` | [US-002](#load-the-corpus-into-neo4j-us-002) |
| — | **Smoke** the load (counts by type) | `uv run culturescrape neo4j-counts` | [US-002](#load-the-corpus-into-neo4j-us-002) |
| 5 | **Materialize** Datalog inference | `uv run culturescrape datalog-materialize out/linguascrape-full/corpus` | [US-004](#materialize-datalog-inference-at-scale-us-004) |
| 6 | **Prove** the app talks to the live stack | `npm run dev:full` then `npm run smoke:graph` *(repo root)* | [US-005](#end-to-end-live-graph-smoke-test-us-005) |

The rest of this doc drills into each phase. If you only need a deterministic offline
rebuild of the small fixture corpus (for CI / a quick sanity check), the next section is
all you need.

## Refresh cadence

- **On any lexicon or mapping change** that shifts the corpus shape (a new/edited
  `lexicons/*.tsv` row, a `shared/lexicon-mapping.json` change, a new linker): re-run
  phases 1–2, then re-sync the committed fingerprints — `docs/convergence-manifest.json`
  (fixture build) and/or `docs/corpus-release-manifest.json` (full build). The snapshot
  tests fail in CI otherwise (see [The committed manifest](#the-committed-manifest)).
- **On a corpus rebuild for the live graph**: run the full pipeline (phases 1–6). The
  Neo4j load (phase 4) is **idempotent** — `MERGE` on `csid` + `IF NOT EXISTS` constraints
  mean re-loading never duplicates nodes, so a refresh is always safe to re-run.
- **Datalog materialization (phase 5) is derived, not stored** — it is recomputed from the
  corpus each refresh; there is nothing to migrate. Re-sync
  `docs/datalog-materialization-manifest.json` if the derived counts move.
- **CI runs the fixture path only** (offline, deterministic): `culturescrape run
  jobs/linguascrape.yml` + the manifest snapshot test. The full/live path (phases 1–6)
  needs the live lexicons, Neo4j, and Docker, so it is an operator step, not a CI gate.

## The one command

```bash
cd packages/culture-scrape
culturescrape run jobs/linguascrape.yml
```

`jobs/linguascrape.yml` declares a single category (`categories/linguascrape.yml`) that
reads LinguaScrape's canonical `nodes/*.tsv` + `edges/*.tsv` export through the
`linguascrape-export` adapter. `culturescrape run` sees a full-pipeline job (all of
`acquire → normalize → link → export`) and takes the **corpus** path
(`orchestrate/corpus.build_corpus`): it acquires + normalizes the category, stitches it,
links across every dimension, writes the canonical corpus TSV, validates it, grades the QA
gates, and generates the Neo4j import script and the Datalog `.pl`/`.dl` programs.

Because the export ships the shared canonical shape already (its own `:LABEL` / `csid` /
`:TYPE`), `normalize` takes the short LinguaScrape path
(`schema/pipeline._normalize_linguascrape`): it maps via `map_linguascrape_records` — which
re-mints each `csid` deterministically (QID- then `linguascrape_id`-anchored) so a re-run is
**idempotent** — splits nodes from edges, and dedups the nodes. No field-rename, anchoring,
reconciliation, or category/type synthesis runs. The output is byte-stable: the same fixture
always produces the same corpus.

## What it writes (all under `out/linguascrape/`, gitignored)

| Path | Contents |
| --- | --- |
| `corpus/nodes/*.tsv`, `corpus/edges/*.tsv` | the canonical merged corpus |
| `corpus/metrics.json` | connectivity metrics |
| `corpus/manifest.json` | node/edge **type counts** (see below) |
| `corpus/qa.json`, `corpus/shared.txt` | QA report + shared-entity report |
| `corpus-neo4j/neo4j-admin-import.sh` | Neo4j bulk-import script |
| `corpus-datalog/*.pl`, `*.dl` | Datalog programs (rules + facts) |

The whole `out/` tree is gitignored (`.gitignore` `/out/`) — a corpus is regenerable, so it
is never committed. What **is** committed is the manifest fingerprint.

## The committed manifest

`corpus/manifest.json` (built by `orchestrate/manifest.build_manifest`) is a deterministic,
content-only fingerprint of the corpus: total node/edge counts, node counts by `:LABEL`,
edge counts by `:TYPE`, and the LinguaScrape-origin edge breakdown. It carries no wall-clock
and no paths, so the same corpus always serialises to the same bytes. A snapshot of it is
committed at [`docs/convergence-manifest.json`](convergence-manifest.json) and a test
(`tests/test_convergence_build.py`) rebuilds the corpus offline and asserts the fresh
manifest matches it byte-for-byte — so a build that silently gains or drops a node/edge type
fails CI even though the corpus itself is not committed.

**Re-sync it after any change that shifts the corpus shape** (a new fixture row, a mapping
change, a new linker): re-run the command above and copy `out/linguascrape/corpus/manifest.json`
over `docs/convergence-manifest.json`, or the snapshot test fails.

## Relaxed corpus floors (why this job sets two)

`jobs/linguascrape.yml` declares two optional overrides:

```yaml
min_provenance_completeness: 0.0
min_component_fraction: 0.5
```

Both suit a **LinguaScrape-only** convergence corpus and are honest, not a loophole:

- **`min_provenance_completeness: 0.0`** — the generic provenance gate counts a row as
  sourced only with `source` + `source_url` + `retrieved_at`. LinguaScrape records no
  external `source_url` (see [`reconcile-linguascrape.md`](reconcile-linguascrape.md) "What
  LinguaScrape ships"), so this floor would reject the corpus. Provenance is still enforced
  — by the **LinguaScrape provenance QA gate** (`linguascrape_provenance_completeness`, min
  `1.0`), which checks the `source` stamp every LinguaScrape row actually carries.
- **`min_component_fraction: 0.5`** — a small single-domain fixture corpus need not reach the
  multi-domain seed corpus's near-`1.0` connectivity.

A truly **merged** corpus (native Wikidata categories, which carry `source_url`, plus this
LinguaScrape category) meets both defaults and can drop the overrides — add the LinguaScrape
category to a job like `jobs/seed-corpus.yml` to build it (that path needs live Wikidata, so
it is not offline/deterministic).

## Validate + QA the output

```bash
culturescrape validate out/linguascrape/corpus
culturescrape qa out/linguascrape/corpus --min-provenance-completeness 0 --fail-on-violation
```

`validate` confirms the TSV is schema-valid; `qa` (with the same relaxed provenance floor the
build uses) passes every gate, including all four LinguaScrape-scoped gates. The build itself
already runs both — these commands just re-check the artifact independently.

## The full, publishable corpus (US-001)

Everything above builds from the committed **6-row fixture** so the job is offline and
CI-deterministic. To build and publish the **full** LinguaScrape-inclusive corpus (every
mapped domain — ~5.3k nodes / ~5.4M linked edges) from the *live* lexicons, use the parallel
`linguascrape-full` job. It is identical to `linguascrape.yml` except its category
(`categories/linguascrape-full.yml`) points `source.query` at the real export tree instead of
the fixture, so the fixture-pinned snapshot test is untouched.

```bash
# 1. Refresh the canonical export from the live lexicons (writes the gitignored
#    repo-root export/culturescrape/{nodes,edges}). Run from the repo root:
npx tsx scripts/export-for-culturescrape.ts

# 2. Build the full corpus (acquire → normalize → link → export). From the package root:
cd packages/culture-scrape
uv run culturescrape run jobs/linguascrape-full.yml

# 3. Validate + QA the output (the build already runs both; re-check independently):
uv run culturescrape validate out/linguascrape-full/corpus
uv run culturescrape qa out/linguascrape-full/corpus \
  --min-provenance-completeness 0 --fail-on-violation

# 4. Publish it as a versioned artifact — a deterministic .tar.gz beside a
#    SHA-256 manifest (per-file hashes + a bundle digest + node/edge type counts):
uv run culturescrape package out/linguascrape-full/corpus \
  --out dist --name linguascrape-full-corpus
```

`package` writes `dist/linguascrape-full-corpus.tar.gz` + `dist/linguascrape-full-corpus-manifest.json`
(both gitignored — `dist/` is a release stage, not committed). The published bundle is uploaded
to a release / object store; the **committed** record of it is
[`docs/corpus-release-manifest.json`](corpus-release-manifest.json) — a copy of that SHA-256
manifest enriched with the job + build provenance. Re-sync it after a rebuild:

```bash
python3 - <<'PY'
import json
art = json.load(open("dist/linguascrape-full-corpus-manifest.json"))
release = {
    "job": "linguascrape-full",
    "built_from": "export/culturescrape (scripts/export-for-culturescrape.ts) -> jobs/linguascrape-full.yml",
    "note": "node/edge counts + nodes_by_label/edges_by_type are the DETERMINISTIC corpus fingerprint; "
            "'digest'/per-file 'sha256' pin THIS point-in-time bundle (retrieved_at carries the "
            "ingestion wall-clock, so the bytes are not reproducible across builds).",
    "artifact": art["name"] + ".tar.gz",
    "node_count": art["node_count"], "edge_count": art["edge_count"],
    "nodes_by_label": art["nodes_by_label"], "edges_by_type": art["edges_by_type"],
    "digest": art["digest"], "files": art["files"],
}
open("docs/corpus-release-manifest.json", "w").write(json.dumps(release, indent=2) + "\n")
PY
```

**Determinism boundary.** The corpus **shape** — total counts and the `nodes_by_label` /
`edges_by_type` breakdown — is deterministic and is the reproducible fingerprint. The tar.gz
**digest** is *not* reproducible across builds: the `linguascrape-export` adapter stamps a
blank `retrieved_at` with the ingestion wall-clock, so each build's bytes differ. The digest
therefore identifies one point-in-time release; integrity of *that* bundle is what a
downloader verifies against the committed SHA-256 manifest.

**On edge scale.** The full corpus's ~5.4M edges are dominated by the temporal linker
materializing pairwise `PRECEDES` / `FOLLOWS` / `CONTEMPORARY_WITH` within each
`(:LABEL, place_qid)` facet; LinguaScrape rows rarely carry a `place_qid`, so large
same-label sets (e.g. `Ingredient`, `Place`) compare all-pairs. `PRECEDES` / `FOLLOWS` are
registered `transitive=True`, so their full closure is intended to be *derived* in Datalog
(US-004), not stored — a future optimization is to have the linker emit only adjacent
ordering edges and leave transitivity to the Datalog rules. This does not affect correctness:
`validate` and every QA gate pass on the output.

## Load the corpus into Neo4j (US-002)

With the full corpus built (US-001 above), load it into a running Neo4j (see
`docker-compose.yml` / `npm run dev:full` at the repo root for a local instance; APOC is
required for the incremental path). The operator's reference is [`docs/neo4j.md`](neo4j.md);
the exact commands for the full corpus are:

```bash
cd packages/culture-scrape
export NEO4J_URI='bolt://localhost:7687' NEO4J_USER='neo4j' NEO4J_PASSWORD='...'

# First load into a FRESH, stopped DB — fastest; bulk neo4j-admin import.
# Apply the schema constraints/indexes first (global + per-label), then import:
uv run culturescrape to-neo4j out/linguascrape-full/corpus --mode admin \
  --out out/linguascrape-full/corpus-neo4j
#   ...then run the emitted corpus-neo4j/neo4j-admin-import.sh with the server stopped.

# Every load AFTER the first — incremental, idempotent LOAD CSV against the RUNNING DB.
# This applies the global Entity csid constraint + a per-label csid constraint and name
# index for each of the 18 labels (39 statements) BEFORE the MERGE-based load, so re-running
# never duplicates nodes. Pass --no-constraints once they are already in place.
uv run culturescrape to-neo4j out/linguascrape-full/corpus --mode loadcsv
# applied 39 constraint/index statement(s) and ran N LOAD CSV statement(s) against Neo4j
```

**Smoke query — counts by type.** Prove the graph holds what the corpus manifest claims:

```bash
uv run culturescrape neo4j-counts
# node counts by label (total 5285):  Entity: 5285 / Ingredient: 2076 / ...
# edge counts by type (total ...):    FOLLOWS: ... / ...
```

Every node carries the shared `Entity` anchor, so its tally is the total node count; compare
each label/type tally against `docs/corpus-release-manifest.json`'s `nodes_by_label` /
`edges_by_type` fingerprint. The same two queries ship as
`cypher/node-counts-by-label.cypher` and `cypher/edge-counts-by-type.cypher` to run under
`cypher-shell`. The load is **idempotent** — `MERGE` on `csid` and `IF NOT EXISTS` constraints
mean re-running `to-neo4j --mode loadcsv` leaves counts unchanged.

## Materialize Datalog inference at scale (US-004)

The `run` job already writes a rule-bearing Datalog export beside the corpus at
`out/linguascrape-full/corpus-datalog/` (`graph.pl` + `graph.dl` + one `.facts` per relation,
built with `--rules`, so the shared inference library is attached). To (re)build it standalone:

```bash
cd packages/culture-scrape
uv run culturescrape to-datalog out/linguascrape-full/corpus --engine both --rules \
  --out out/linguascrape-full/corpus-datalog
```

Loading that program into `swipl`/`souffle` materializes the derived relations, but neither
engine is in CI and `graph.pl` is ~1 GB. `datalog-materialize` computes each rule's extension
**engine-free** (naive fixpoint over the projected facts) and records the base/derived counts:

```bash
uv run culturescrape datalog-materialize out/linguascrape-full/corpus \
  --json docs/datalog-materialization-manifest.json
# base relations read (8): contemporary_with: 505245 / descends_from: 1468 / located_in: 475 / ...
# derived relations (total 1016860): contemporary: 1010490 / ancestor: 2770 / same_region: 2219 / ...
```

The four US-004 targets over the full corpus (fingerprint committed in
`docs/datalog-materialization-manifest.json`):

| Target | Derived tuples | Notes |
|---|---|---|
| `contemporary/2` (symmetric `contemporary_with/2`) | 1,010,490 | derived in the logic layer, **not** stored as edges |
| `ancestor/2` (transitive `descends_from/2`) | 2,770 | full language/culture descent closure |
| `same_region/2` (co-location via `within_region/2`) | 2,219 | geographic half of the cross-domain correlation |
| `genetic_linguistic_correlation/2` | 0 | empty here — LinguaScrape ships no genetics domain |

`genetic_linguistic_correlation/2` is 0 because the LinguaScrape-only corpus has no haplogroup
source (no `originates_from`/`spoken_in` edges); it materializes on a merged corpus that adds
one, and its expected shape is exercised on the bundled fixture (which carries the ported
`source: linguascrape` genetics facts). This is also why storing the ~1 M `contemporary`
closure as edges is avoided — the closure stays a **derived** relation in Datalog rather than
being materialized back into TSV (the `PRECEDES`/`FOLLOWS` note above is the same principle).

**Validation.** `culturescrape validate out/linguascrape-full/corpus` (the schema/QA gate from
US-001) covers the base facts the export projects; the derived layer is validated engine-free
by `datalog-materialize` (the manifest counts) and, when an engine is present, by the
`swipl`-gated example tests in `tests/test_datalog_examples.py` /
`tests/test_datalog_linguascrape.py`. The exported `graph.pl`/`graph.dl` are asserted
well-formed by `tests/test_cli_datalog.py`. Example queries with their expected shapes are in
[`docs/datalog.md`](datalog.md) — "Materializing inference at scale (US-004)" and the shipped
`datalog/examples/*.pl`.

## End-to-end live-graph smoke test (US-005)

US-001..US-004 build, load, and materialize the graph; this last step proves the
**app** actually talks to the live stack (not a mock). From the repo root, with the
full stack up:

```bash
npm run dev:full        # app + culture-scrape sidecar + Neo4j (needs Docker)
# in another shell:
npm run smoke:graph     # or: npx tsx scripts/smoke-graph.ts
```

`scripts/smoke-graph.ts` hits the first-party `/api/graph/*` routes on the running
LinguaScrape server and asserts each returns **real, non-empty** data:

| Check | Route | Assertion |
|---|---|---|
| `status` | `GET /api/graph/status` | `available` (a backend is reachable) |
| `metrics` | `GET /api/graph/metrics` | `node_count > 0` (sidecar) |
| `search` | `GET /api/graph/search?q=…` | ≥ 1 hit; its `csid` feeds the node checks (sidecar) |
| `node/:id` | `GET /api/graph/node/:id` | the node resolves by `csid` (Neo4j) |
| `neighborhood/:id` | `GET /api/graph/neighborhood/:id` | ≥ 1 node in the sub-graph (Neo4j) |

**Graceful degradation.** With nothing up it prints a clear *"stack down"* message
and exits `0` (absent services are not a failure); a check only **fails the run
(exit 1)** when a backend is up but returns empty/wrong data — a genuine regression.
When the sidecar is down but Neo4j is up it still probes a node via the Neo4j-backed
`/api/graph/overview` fallback, and reports any un-runnable check as *skipped*.

Config: `SMOKE_GRAPH_URL` (default `http://localhost:$PORT`, `PORT` default `3050`)
and `SMOKE_GRAPH_TIMEOUT_MS` (default `15000`). Type-check the script with
`npx tsc -p scripts/tsconfig.json`.

## Add a new domain to the live graph

Bringing a new (or newly-relevant) `lexicons/<file>.tsv` into the *live* graph is the
mapping work in [`culturescrape-integration.md` §9](../../../docs/culturescrape-integration.md)
followed by one full-pipeline refresh. The checklist:

1. **Map & disposition the file** — add it to
   [`shared/lexicon-mapping.json`](../../../shared/lexicon-mapping.json) (a `kind` + a
   canonical `node`/`edge` type) and give every column a disposition, following the naming
   conventions in [`canonical-schema.md` §6](../../../docs/canonical-schema.md). If it needs a
   node/edge type that doesn't exist yet, add it to
   [`shared/canonical-schema.json`](../../../shared/canonical-schema.json) **and** the §1/§2
   tables in `canonical-schema.md` first. (Full steps: integration §9 items 1–4.)
2. **Validate the mapping:** `npx vitest run shared/lexicon-mapping.test.ts` — asserts every
   `lexicons/*.tsv` is accounted for and every referenced column is real.
3. **Re-export + refresh snapshots:** `npx tsx scripts/export-for-culturescrape.ts`, then
   `npx tsx scripts/reconciliation-report.ts`; re-sync the committed
   `docs/culturescrape-export-manifest.json` / `docs/reconciliation-report.json`.
4. **Run the QA gate:** `npx tsx scripts/convergence-qa.ts` must exit `0` (no schema/id drift).
5. **Rebuild the corpus** through phases 1–3 above (the tabular adapter ingests the new
   `nodes/`/`edges/` files with no Python code change as long as the headers match the
   canonical schema). Re-sync `docs/corpus-release-manifest.json` and, if the fixture shape
   changed, `docs/convergence-manifest.json`.
6. **Reload & re-materialize:** phases 4–5 — `to-neo4j --mode loadcsv` (idempotent) then
   `datalog-materialize`. New `:LABEL`s are picked up automatically (per-label constraints are
   derived from the corpus's `:LABEL` cells — see [US-002](#load-the-corpus-into-neo4j-us-002)).
7. **Prove it end-to-end:** phase 6 — `npm run smoke:graph` against the running stack; search
   should now return hits for the new domain and its node/neighborhood resolve.
8. **Python-side handling (only if needed):** bespoke reconcile/ontology logic for the new type
   lives under `packages/culture-scrape/` — see integration §10 and
   [`reconcile-linguascrape.md`](reconcile-linguascrape.md).

## Cross-links

- [`docs/canonical-schema.md`](../../../docs/canonical-schema.md) — the shared node/edge
  contract every phase targets (the *what*).
- [`docs/culturescrape-integration.md`](../../../docs/culturescrape-integration.md) — the
  convergence design, §8 end-to-end data flow, §9 add-a-domain, §10 ownership (the *why* and
  *where*).
- [`neo4j.md`](neo4j.md) · [`datalog.md`](datalog.md) · [`reconcile-linguascrape.md`](reconcile-linguascrape.md)
  · [`ontology.md`](ontology.md) — per-step engine references.
