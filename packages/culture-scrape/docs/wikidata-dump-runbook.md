# Wikidata dump runbook — obtaining a real slice

The bulk-dump stack (`acquire/wikidata_dump.py` reader, `wikidata_dump_index.py`
class-membership index, `wikidata_hydration.py` profiles, `wikidata_enrich.py`)
was proven only against a 10 KB committed fixture (`tests/fixtures/wikidata/`).
This runbook is the reproducible recipe for pointing that stack at **real**
Wikidata data — either the official full dump, a streamed domain filter, or the
bounded API-composed slice — so the scale work (US-002..US-007 of the
`ralph/wikidata-dump-slice` PRD; Phase 3 of `NEUROSYMBOLIC_ROADMAP.md`) runs on
genuine bytes.

All three paths produce the **same file framing** the reader accepts, so they are
interchangeable downstream. Whatever you build stays **gitignored** (`out/*` in
`packages/culture-scrape/.gitignore`); commit the manifest/measurements, never the
slice itself.

## What the reader expects (the framing contract)

`iter_entities()` reads the official `latest-all.json.gz` shape: one big JSON
array printed **one entity per line** — a bare `[` first line, a bare `]` last
line, and every entity line but the final one ending in a trailing comma.
Compression is by extension (`.gz`, `.bz2`, or plain `.json`). Any of the three
recipes below yields exactly this.

Provenance convention: **name the file with a `YYYYMMDD`** matching the data's
date (e.g. `wikidata-20260712-blueprint-slice.json.gz`). `dump_version()` parses
that date from the name and records it; a name without one records
`"unknown"`.

---

## Recipe A — bounded, API-composed slice (default; polite, no ~90 GB download)

This is what CI-adjacent scale work uses: real labels, claims, and sitelinks for
a bounded set of blueprint-class members, small enough to build in-session
without hammering Wikimedia. It resolves member QIDs per class from WDQS
(bounded by `--limit-per-class`), fetches full entity JSON via `wbgetentities` in
batches of 50, and writes the dump framing plus a sidecar manifest. Every request
goes through the shared `HttpClient` (rate-limited, retried, cached, and
User-Agent-identified per the Wikimedia policy).

```bash
cd packages/culture-scrape
uv run culturescrape build-slice \
  blueprints/food-drink.yml blueprints/language.yml blueprints/myth-religion.yml \
  --out out/wikidata/wikidata-$(date -u +%Y%m%d)-blueprint-slice.json.gz \
  --limit-per-class 200
```

- `--limit-per-class` (default 200) is the politeness bound — the max members
  drawn per class. Raise it for a fuller slice; keep it modest for repeated runs.
- `--no-transitive` selects direct `P31` instances only; the default is the
  `P31/P279*` transitive idiom (a bare `subclass_of` stub is always transitive).
- `--cache-dir` overrides the HTTP cache (default `<out-dir>/.http-cache`,
  gitignored). Re-runs hit the cache, so iterating is cheap and polite.

The command prints per-domain counts and an HTTP cache-hit/miss/retry tally, and
writes `<out>.manifest.json` beside the slice. The manifest records
`source: wikidata-api-composed` (so it is never mistaken for a byte-slice of the
official dump), the parsed `dump_version`, and the exact classes + obtained
counts per domain.

### Recorded provenance — reference build (2026-07-12)

| field | value |
| --- | --- |
| file | `out/wikidata/wikidata-20260712-blueprint-slice.json.gz` (~9.8 MB gz, gitignored) |
| source | `wikidata-api-composed` |
| dump_version | `20260712` |
| transitive / limit-per-class | `true` / `200` |
| entity_total | **5,691** |
| food-drink | 2,675 entities across 14 classes (e.g. Q746549 dish, Q10943 cheese) |
| language | 965 entities across 5 classes (e.g. Q34770 language, Q8192 writing system) |
| myth-religion | 2,370 entities across 12 classes (e.g. Q178885 deity, Q2239243 mythical creature) |

Bandwidth/disk: a few tens of MB over the wire (cached), <10 MB on disk. No full
dump required.

---

## Recipe B — streamed domain filter (real dump bytes, never persists the full dump)

When you want an actual slice of the official dump for a domain without storing
the ~90 GB whole, stream it through
[`wikibase-dump-filter`](https://github.com/maxlath/wikibase-dump-filter) and keep
only the entities whose `P31` (instance-of) matches your blueprint classes. The
full dump is read off the wire once; only the matched entities land on disk.

```bash
# Requires: wikibase-dump-filter (npm i -g wikibase-dump-filter), curl, gzip.
# ~10-30 GB free recommended for the filtered output; bandwidth = full dump size
# read once (~90 GB compressed over the wire, decompressed in-stream).
cd packages/culture-scrape
mkdir -p out/wikidata
curl -s https://dumps.wikimedia.org/wikidatawiki/entities/latest-all.json.gz \
  | gzip -d \
  | wikibase-dump-filter \
      --claim 'P31:Q746549|Q10943|Q34770|Q8192|Q178885|Q2239243' \
  | gzip \
  > out/wikidata/wikidata-$(date -u +%Y%m%d)-streamed-slice.json.gz
```

- Widen `--claim P31:...` to the union of every class QID your domains need (see
  the reference class QIDs above and the full lists in each blueprint's
  `wikidata_class` / `subclass_of` stubs). `wikibase-dump-filter` preserves the
  `[`/entity/`]` framing, so the output is directly readable.
- The `latest-all` name has no date; rename the output with the dump's publish
  date (from the [dumps directory listing](https://dumps.wikimedia.org/wikidatawiki/entities/))
  so provenance is accurate.
- Politeness: this reads the full dump once. Do it sparingly, off-peak, and do
  not parallelise multiple full-dump streams.

---

## Recipe C — the full official dump (~90 GB compressed on disk)

Only when a whole-corpus scan is genuinely needed. The reader streams it
one entity at a time, so RAM stays bounded, but you must provision the disk.

```bash
# ~90 GB compressed on disk; multi-TB expanded if you ever decompress (don't —
# the reader reads the .gz directly). Verify against the published checksums.
cd packages/culture-scrape
mkdir -p out/wikidata
curl -O https://dumps.wikimedia.org/wikidatawiki/entities/latest-all.json.gz
# (rename with the dump's publish date for provenance)
```

Point any of the dump-stack entry points at the local path — the reader never
downloads. In a job spec the dump adapter reads `source.params.path` (falling
back to `source.query`) and selects on `source.params.class` (`;`-separated
QIDs), with `source.params.transitive` for the `P31/P279*` idiom.

---

## Verifying a slice

A `skipif`-gated smoke test iterates the first N entities of a real slice when
present (`tests/test_wikidata_slice_smoke.py`). It looks for the newest slice in
`out/wikidata/` (or the path in `CULTURESCRAPE_WIKIDATA_SLICE`) and asserts the
leading sample parses cleanly with no skips, carries string QIDs and `P31`
claims, and (for a manifest-bearing slice) covers the three blueprint domains.
On a fresh checkout with no slice it is skipped, so it never fails a build that
has not provisioned one.

```bash
cd packages/culture-scrape
uv run pytest tests/test_wikidata_slice.py tests/test_wikidata_slice_smoke.py -q
# Or point at an explicit slice:
CULTURESCRAPE_WIKIDATA_SLICE=out/wikidata/wikidata-20260712-blueprint-slice.json.gz \
  uv run pytest tests/test_wikidata_slice_smoke.py -q
```

The fixture-based dump tests (`test_wikidata_dump*.py`) stay green regardless —
this runbook adds a real-data path without touching the committed fixture.
