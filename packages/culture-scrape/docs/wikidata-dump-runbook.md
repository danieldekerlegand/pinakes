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

## Building the class-membership index (on-disk KV store)

Resolving a class straight from the dump scans every entity — twice for the
transitive `P31/P279*` idiom. The index precomputes both relations once into a
**SQLite** KV store (`<dump>.index.sqlite3`, stdlib `sqlite3` — no dependency),
so the adapter answers membership from indexed lookups instead of a rescan, and
the transitive closure needs no second full pass. Lookups are memory-bounded:
only the rows a query touches (a class's members, a root's subclass closure) are
read, never the whole index.

```bash
cd packages/culture-scrape
# Writes <dump>.index.sqlite3 beside the dump (override with --out).
uv run culturescrape index-wikidata out/wikidata/wikidata-20260712-blueprint-slice.json.gz
```

The adapter picks the sidecar up automatically when present (or name one with
`source.params.index`); it is rebuilt, not reused, if the dump's fingerprint
(name/size/date) changes, so a stale index can never answer for the wrong dump.
The `.sqlite3` file is a large artifact — it stays gitignored (`out/*`), like the
slice; commit only the measurements below.

### Recorded build — reference slice (2026-07-12)

Against the 5,691-entity API-composed reference slice
(`wikidata-20260712-blueprint-slice.json.gz`, 9.80 MB gz):

| metric | value |
| --- | --- |
| entities indexed | 5,691 (0 skipped) |
| classes with ≥1 `P31` member | 1,073 |
| classes with ≥1 `P279` subclass | 691 |
| build wall-clock | 2.48 s |
| build peak memory (tracemalloc) | 4.4 MB |
| on-disk index size | 0.58 MB |
| transitive lookup (`Q2095` food, `P279*`) | 1.2 ms → 19 members |

Build memory is bounded by the `_FLUSH_ROWS` (50k) insert buffer, not the dump
size — the same streaming discipline the reader uses, so this extrapolates to
the full dump (index size scales with entity count, not with peak RAM).

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

---

## Building a whole blueprint from the slice, offline (US-003)

Once a slice (Recipe A/B/C) and its index exist, a whole blueprint builds end to
end **with no network** — acquire → normalize → stitch → link → export → QA —
producing a canonical corpus, a Neo4j bulk-import script, and a Datalog program.
The lever is `generate`'s **dump mode**: `--dump` retargets every
`wikidata_class` stub at the local slice (`source.type: wikidata-dump`) instead of
the live Query Service.

```bash
cd packages/culture-scrape
SLICE=$(pwd)/out/wikidata/wikidata-20260712-blueprint-slice.json.gz

# 1. Expand the blueprint into dump-sourced categories + a runnable job.
#    Use ABSOLUTE paths for --dump/--index so the categories resolve from anywhere.
uv run culturescrape generate blueprints/food-drink.yml \
  --dump  "$SLICE" \
  --index "$SLICE.index.sqlite3" \
  --hydrate default \
  --out out/food-drink-dump/categories \
  --job jobs/food-drink-dump.yml \
  --force
# (--min-component-fraction / --min-provenance-completeness are written into the
#  job if you need to relax the corpus floors; food-drink needs neither — see below.)

# 2. Run the whole pipeline offline. The dump adapter opens no connection.
uv run culturescrape run jobs/food-drink-dump.yml --workers 4
```

The generated job carries no floor overrides — the single food-drink domain
clears the **default** corpus gates (connectivity ≥ 90%, provenance ≥ 50%,
zero duplicates, zero dangling edges), because its entities interconnect through
the linker-minted shared **place** hubs (`ORIGINATES_FROM`/`LOCATED_IN` off each
dish's country of origin). A more scattered single domain may legitimately
fragment below 90% — relax it with `--min-component-fraction` and record the
rationale, per the seed-corpus precedent.

### Recorded build — reference slice (2026-07-12)

All 14 food-drink classes, from the 5,691-entity API-composed slice
(`out/wikidata/wikidata-20260712-blueprint-slice.json.gz`), on a warm index:

| stage | measurement |
| --- | --- |
| acquire (14 categories) | **972** member entities selected; **146.2 s CPU** summed / **~46 s wall** at 4 workers |
| normalize (14 categories) | **2,943** node+edge rows; **5.3 s CPU** summed |
| stitch + link + export (corpus) | inline; total build **45.9 s wall** |
| **corpus** | **1,062 nodes / 2,655 edges**; largest component **99.91%** (1,061/1,062) |
| peak memory | **71 MB** RSS · **9.7 MB** Python-object peak (`tracemalloc`) — streaming, bounded by the flush buffer, not the slice |
| Neo4j | `corpus-neo4j/neo4j-admin-import.sh` (4 node files, edge files) generated |
| Datalog | **15,702** facts projected (`corpus-datalog/`, swipl + souffle) |
| QA | all corpus gates **pass** (provenance 0.99, 0 duplicates, 0 dangling edges) |

**Scale note (feeds US-007).** Acquire dominates: **146 s of CPU** for a 5,691-entity
slice, because each of the 14 categories independently streams the *entire* slice
(14 full passes). The index makes membership an O(1) lookup, but `iter_entities`
still reads every line per category. At full-dump scale this is 14 × ~100 M-entity
passes — the first thing to fix for the next scale step (one grouped pass, or a
membership-partitioned reader). Memory does **not** grow with the slice, so the
blocker is throughput, not RAM.

### A real engine answers a smoke query

The engine-free Datalog evaluator materialises the inference rules over the built
corpus (a real fixpoint, no swipl/souffle needed) — excluding the arithmetic
temporal rules, which are intractable to materialise and are derived lazily by a
real engine:

```bash
uv run culturescrape datalog-materialize out/food-drink/corpus \
  --exclude contemporary precedes follows
# base:  located_in: 723 ...
# derived (total 88,230):  same_region: 87,507 · within_region: 723 ...
```

### Reconciliation against curated rows

The corpus is reconciled against the nearest overlapping LinguaScrape lexicon with
the offline cascade (`reconcile_corpus_against_lexicon`; language code → exact
`(name, type, region)` → fuzzy name, ambiguous rows **never** auto-merged):

| corpus (dish) vs curated | matched | new | ambiguous | union distinct |
| --- | --- | --- | --- | --- |
| 960 named dish nodes vs `lexicons/cuisines.tsv` (101 rows) | 0 | 960 | 0 | 1,061 |

The zero-match result is honest and expected: LinguaScrape curates **cuisines**
(e.g. "Italian cuisine"), not individual dishes, so there is no identity overlap
to damage — every dish stands as its own `new` node and nothing is auto-merged.
A domain that *does* overlap a curated lexicon (US-004's language / myth-religion)
will report real `matched` counts; ambiguous rows are always withheld for triage.

### Verifying offline (skipif-gated)

`tests/test_blueprint_food_drink_dump_smoke.py` proves this path end to end where a
real slice is present: it expands a 2-class food-drink subset in dump mode, builds
the corpus with an HTTP factory that **raises** (any network call fails the test),
and asserts the corpus validates, clears the QA gates, is connected, exports Neo4j
+ Datalog, answers the engine smoke query, and reconciles. On a fresh checkout with
no slice it is skipped.

```bash
uv run pytest tests/test_blueprint_food_drink_dump_smoke.py -q
```
