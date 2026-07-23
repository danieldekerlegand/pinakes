# Storage and publishing

culture-scrape keeps a **lean code repository and publishes data separately.**
The git repo holds the small, diff-friendly *inputs* that define a corpus; the
corpus itself — which grows without bound as categories are added — is never
committed. It is a deterministic function of those inputs and the upstream
sources, so you reproduce it by re-running the pipeline and you *share* it as a
versioned release artifact.

## What is versioned vs. generated

| Versioned (committed, small, diffable) | Generated (ignored, regenerable) |
|---|---|
| `src/` — the pipeline | `out/` — every stage's output |
| `categories/`, `blueprints/`, `jobs/` — what to scrape | `out/<job>/corpus/` — canonical TSV + `metrics.json`, `qa.json` |
| `docs/`, `PLAN.md`, `README.md` | `out/<job>/corpus-neo4j/`, `corpus-datalog/` — exports |
| `ralph/` — the build tasklists | `out/<job>/catalog.json` and per-category trees |
| `tests/` and their fixtures | `dist/` — packaged artifacts; `.http-cache/` — fetch caches |

`out/`, `dist/`, and `.http-cache/` are in [`.gitignore`](../.gitignore). The
ready-made sample corpus under [`datalog/examples/dataset`](../datalog/examples/)
is the deliberate exception — it is a tiny, hand-curated fixture the docs and
tests run against, not generated output.

## Reproducing a corpus

A corpus is regenerable from the versioned inputs alone:

```sh
culturescrape run jobs/seed-corpus.yml      # rebuilds out/seed-corpus/ from scratch
```

Because the inputs are committed and the build is deterministic, anyone with the
repo can reconstruct the same corpus (modulo upstream source drift — see below).
That is why committing the output would only bloat git history with data that
adds no information the inputs don't already carry.

## Publishing a corpus

To share a built corpus, package it into a single verifiable artifact and upload
that to a GitHub Release, object storage, or a dedicated data repository:

```sh
culturescrape package out/seed-corpus --out dist --name seed-corpus-2026-06
# -> dist/seed-corpus-2026-06.tar.gz + dist/seed-corpus-2026-06-manifest.json
```

The archive bundles the canonical `corpus/` TSV with the Neo4j and Datalog
exports; it is **byte-for-byte reproducible** (normalized timestamps and sorted
file order), so the same corpus always packs to the same bytes. The manifest
records node/edge counts, a SHA-256 per file, and a digest over the whole bundle,
so a downloader can verify integrity. See
[`src/culturescrape/orchestrate/package.py`](../src/culturescrape/orchestrate/package.py).

## Source drift and snapshots

Upstream sources (Wikidata, PetScan, dumps) change over time, so a rebuild months
later will differ from today's. The published artifact *is* the snapshot: tag each
release with the date or a version, and let the scheduled-refresh mode
([`docs/scheduling.md`](scheduling.md)) keep a working corpus current between
releases. Keep the inputs in git; keep the snapshots in releases.
