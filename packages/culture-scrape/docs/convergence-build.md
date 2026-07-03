# Reproducible convergence build (US-008)

This is the documented, one-command recipe that (re)builds the LinguaScrape-inclusive
corpus from the committed fixture export — deterministically, offline, and CI-runnable.
It ties together every earlier convergence step: **ingest → reconcile → link →
Datalog/Neo4j**. For the design behind each step see
[`reconcile-linguascrape.md`](reconcile-linguascrape.md) and the repo-root
[`docs/culturescrape-integration.md`](../../../docs/culturescrape-integration.md).

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
