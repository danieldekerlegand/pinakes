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

The corpus is reconciled against the nearest overlapping Pinakes lexicon with
the offline cascade (`reconcile_corpus_against_lexicon`; language code → exact
`(name, type, region)` → fuzzy name, ambiguous rows **never** auto-merged):

| corpus (dish) vs curated | matched | new | ambiguous | union distinct |
| --- | --- | --- | --- | --- |
| 960 named dish nodes vs `lexicons/cuisines.tsv` (101 rows) | 0 | 960 | 0 | 1,061 |

The zero-match result is honest and expected: Pinakes curates **cuisines**
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

---

## Mid-size domains merged with the Pinakes corpus, offline (US-004)

US-003 proved a single blueprint (food-drink). US-004 is the next shape: **two**
mid-size dump domains (language, myth-religion) stitched **together** *and* merged
with the existing Pinakes convergence corpus, so a Wikidata entity
Pinakes already curates collapses to one node rather than duplicating. The
lever is `culturescrape merge`, which expands N blueprints in dump mode and
appends a `pinakes-export` category, writing the single job whose categories
`culturescrape run` then stitches (`orchestrate/merge.py`).

```bash
cd packages/culture-scrape
SLICE=$(pwd)/out/wikidata/wikidata-20260712-blueprint-slice.json.gz

# 1. Assemble the merged job: language + myth-religion (dump) + the live export.
uv run culturescrape merge blueprints/language.yml blueprints/myth-religion.yml \
  --dump  "$SLICE" \
  --index "$SLICE.index.sqlite3" \
  --hydrate default \
  --pinakes "$(cd ../.. && pwd)/export/culturescrape" \
  --out out/merged/categories \
  --job jobs/merged-dump.yml \
  --name merged-dump \
  --min-component-fraction 0.1 --min-provenance-completeness 0.0 \
  --force

# 2. Build the merged corpus offline (the dump + export adapters open no network).
uv run culturescrape run jobs/merged-dump.yml --workers 4

# 3. Prove the Neo4j load is idempotent (offline: MERGE double-load, no server).
uv run culturescrape neo4j-counts --dataset out/merged-dump/corpus
```

`merge` writes `reconcile_shared_qids: true` into the job — see **identity
preservation** below.

### Recorded build — reference slice (2026-07-12)

Language + myth-religion (17 dump categories) from the 5,691-entity slice, merged
with the live Pinakes export (`export/culturescrape`):

| stage | measurement |
| --- | --- |
| acquire — dump | **802** member entities across 17 categories; each category full-scans the whole slice |
| acquire — Pinakes export | **12,671** canonical rows ingested from `nodes/`+`edges/` |
| stitch + QID-reconcile + link + export | inline; **collapsed 14** cross-type same-QID duplicates |
| **merged corpus** | **7,682 nodes / 5,283 edges**; largest component **14.79%** (1,136/7,682) |
| whole build | **345 s wall** @ 4 workers |
| peak memory | **192 MB** RSS · **43.5 MB** Python-object peak (`tracemalloc`) — streaming, bounded by the Pinakes ingest, not the slice |
| Neo4j | `corpus-neo4j/neo4j-admin-import.sh` generated; **idempotent** (see below) |
| Datalog | **55,132** facts projected |
| QA | all corpus gates **pass** (0 duplicates after QID-reconcile, 0 dangling edges) |

**Relaxed floors (documented).** The merged corpus carries the same two overrides
as `jobs/pinakes-full.yml`: `min_provenance_completeness: 0.0` (Pinakes
rows carry the canonical `source` stamp but no external `source_url`; the
Pinakes provenance gate still enforces it) and `min_component_fraction: 0.1`.
The measured largest component is **14.79%** — the Pinakes corpus's own real
semantic connectivity is ~17% (`docs/convergence-build.md`), and the dump domains
attach to it only where a shared QID or a linker hub bridges them, so 0.1 is an
honest floor that still fails on a genuine collapse. This is a *stored*-graph
number; the derived temporal layer reconnects co-dated entities at query time.

### Identity preservation — one QID is one node

`csid` is `cs:<node-type>:<QID>`, so the *same* Wikidata entity typed differently
by two sources gets two csids and the per-`csid` stitch cannot merge them. The
reference merge surfaced **14** such cross-type duplicates in three shapes:

* deity typed `Concept;CulturalArtifact` by the myth-religion blueprint vs `Deity`
  by Pinakes (`cs:concept:Q146007` vs `cs:deity:Q146007` — Wadjet, Sobek, …);
* script typed `Language` by the language blueprint's writing-systems / alphabets
  categories vs `WritingSystem` by Pinakes (`cs:language:Q145625` vs
  `cs:writing-system:Q145625` — Glagolitic, Ol Chiki, …);
* a geographic **place hub** the linker mints for a QID Pinakes curates as a
  `Culture` (`cs:place:Q11767` vs `cs:culture:Q11767` — Mesopotamia, Babylonia).

`ontology.reconcile_qid.reconcile_shared_qids` (opt-in via the job's
`reconcile_shared_qids: true`, which `merge` sets) collapses same-QID nodes into
one — unioning their label sets and redirecting edges onto the survivor — so one
QID is one node. It is **QID-only** (nodes with no QID, or differing QIDs, are
untouched), so it never over-merges on a shared name. This drives the corpus
`duplicate rate` gate to 0; without it the build fails that gate at 0.002.

### Merged corpus — node/edge counts by label / :TYPE

The offline MERGE double-load (`neo4j-counts --dataset`) is **idempotent** — the
second load moves no count — and reports the grouped counts a live Neo4j would
answer after `neo4j-admin import`. Every node carries the `Entity` anchor, so its
tally (**7,682**) is the true node total; labels overlap because the QID-reconcile
unions them (`Concept`+`Deity`, `Language`+`WritingSystem`, `Culture`+`Place`).

Top node labels: `Entity` 7,682 · `Ingredient` 2,146 · `Language` 1,459 ·
`Place` 1,119 · `LanguageFamily` 544 · `Period` 446 · `Concept` 368 ·
`CulturalArtifact` 368 · `Culture` 302 · `ArchaeologicalCulture` 281 ·
`ArtTradition` 230 · `Deity` 228 · `WritingSystem` 113 · `Cuisine` 101 ·
`MigrationRoute` 100 · `MythMotif` 61 · `LiteraryTradition` 56 · `Battle` 49 ·
`TradeGood` 45 · `UrheimatHypothesis` 22 · `Religion` 20 · `Category` 17 ·
`Type` 2.

Edges by `:TYPE` (**5,283** total): `DESCENDS_FROM` 1,642 · `LOCATED_IN` 980 ·
`MEMBER_OF_CATEGORY` 802 · `INSTANCE_OF` 760 · `PART_OF_PERIOD` 498 ·
`VARIANT_OF` 242 · `INFLUENCED_BY` 102 · `PART_OF` 101 · `SPOKEN_IN` 66 ·
`BORROWED_FROM` 50 · `COGNATE_WITH` 27 · `DERIVED_FROM` 13. Of these, Pinakes
contributed the `DESCENDS_FROM`/`VARIANT_OF`/`INFLUENCED_BY`/`PART_OF`/
`BORROWED_FROM`/`COGNATE_WITH`/`DERIVED_FROM` families (the manifest's
`pinakes_edges_by_type`); `LOCATED_IN`/`INSTANCE_OF`/`MEMBER_OF_CATEGORY`/
`PART_OF_PERIOD`/`SPOKEN_IN` are minted by the dump acquisition + linkers.

### Reconciliation against curated lexicons

Full report: [wikidata-merge-reconciliation.md](wikidata-merge-reconciliation.md).

| corpus nodes vs curated lexicon | matched | new | ambiguous |
| --- | --- | --- | --- |
| 1,459 `language` nodes vs `lexicons/languages.tsv` (1,099 rows) | 97 | 1,362 | 0 |
| 221 `deity` nodes vs `lexicons/deities.tsv` (206 rows) | 198 | 23 | 0 |

Both domains reconcile with **0 ambiguous** — nothing is auto-merged. The
languages that overlap the curated set fold on (name, type, region) at 0.95; the
Wikidata-only minor languages stand as `new`. 198/221 deities match (the
Pinakes deities re-match their own rows and the Wikidata `Q178885` members
whose names align fold on).

### Verifying offline (skipif-gated)

`tests/test_blueprint_language_myth_dump_smoke.py` proves this path end to end
where a real slice is present: it merges a small language + myth subset with the
committed Pinakes fixture export, builds offline with an HTTP factory that
**raises**, and asserts the corpus validates, carries both sources' rows,
MERGE-loads idempotently, and reconciles. On a fresh checkout with no slice it is
skipped.

```bash
uv run pytest tests/test_blueprint_language_myth_dump_smoke.py -q
```

## Richer hydration — multi-value, qualifiers, references (US-005)

By default a `HydrationProfile` keeps only the **single best-rank** value per
field (preferred beats normal, deprecated dropped, first statement wins) — the
`wikidata-dump` parity behaviour. A `PropertyMapping` can now **opt in** to
aggregate everything an entity actually carries:

- `multi=True` — collect *every* distinct value across all ranked statements into
  the `;` multi-value encoding (deduped, best-rank first) instead of just the
  first. Combined with `qualifier=`/`reference=` it reads *every* qualifier /
  reference snak per statement, not only the first.
- `reference="P854"` — lift a statement's **citations** (here the *reference URL*
  snak) into a field, so the source backing a statement becomes provenance rather
  than being discarded.

The default profile is untouched (no mapping opts in), so a plain dump build is
byte-identical; only a profile that declares `multi`/`reference` changes.

### Upgraded profile — `language`, before/after field coverage

`LANGUAGE_PROFILE` keeps its single-value linker fields (`parent_qid`,
`place_qid`, `script` — the linkers resolve one each) and adds four opt-in rich
mappings that aggregate the full picture into overflow fields: `parent_qids`
(P279, multi), `spoken_in_qids` (P17, multi), `scripts` (P282, multi), and
`references` (P854 citations on the P279 classification statements).

Measured over the reference slice's **392 language members** (2026-07-12):

| field            | before | after | after w/ >1 value | total values |
|------------------|-------:|------:|------------------:|-------------:|
| `parent_qid`     |    230 |   230 |                 0 |          230 |
| `parent_qids`    |      0 |   230 |                54 |          297 |
| `place_qid`      |     52 |    52 |                 0 |           52 |
| `spoken_in_qids` |      0 |    52 |                21 |          113 |
| `script`         |     38 |    38 |                 0 |           38 |
| `scripts`        |      0 |    38 |                 6 |           46 |
| `references`     |      0 |    18 |                 — |           18 |

Net: the single-value read captured at most one value per parent/country/script
(320 in total); the richer profile recovers **136 previously-dropped values** (67
extra parents + 61 extra countries + 8 extra scripts) plus **18 citation URLs** —
without moving the linker-facing single-value fields. `aliases` is unchanged (385).

### Verifying offline (fixtures + skipif-gated real slice)

`tests/test_wikidata_hydration.py` covers rank order, multi-value dedup/order,
multi-qualifier, and reference extraction (single + multi + precedence) on
synthetic entities; `tests/test_wikidata_hydration_smoke.py` re-proves the
`language` upgrade on the real slice (asserts real multi-parent + real P854
citations fire) where one is present, and is skipped on a fresh checkout.

```bash
uv run pytest tests/test_wikidata_hydration.py tests/test_wikidata_hydration_smoke.py -q
```

## Incremental update — upsert a corpus from a fresher slice (US-006)

A living corpus must not be rebuilt from scratch when a handful of upstream entities
change. The Neo4j load is already `MERGE`-on-`csid` and `csid` is **QID-anchored**, so
re-exporting a changed entity lands it on the very node it already occupies — an
in-place update, never a duplicate. The only missing piece is knowing *which* entities
changed; the incremental path (`culturescrape sync-wikidata`) answers that by diffing
two slices keyed on QID, re-hydrating only the changed members, and proving the MERGE
stays idempotent — all offline, no live Neo4j.

The flow, keyed on QID throughout (`orchestrate/incremental.py`):

1. **Diff** the fresher slice against the one the corpus was built from
   (`acquire/wikidata_diff.py`). Each entity is reduced to a **content fingerprint** —
   a SHA-256 over exactly the parts the corpus reads (labels/descriptions/aliases/
   claims/sitelinks), deliberately excluding volatile revision metadata (`lastrevid`/
   `modified`/`pageid`) — so a no-op re-export of the *same* knowledge does **not**
   register as a change. Comparing the two fingerprint maps yields the added / changed
   / removed QIDs.
2. **Resolve** which of the job's `wikidata-dump` categories each changed QID belongs
   to (via the new slice's membership index, else a bounded scan), so every affected
   entity re-exports under the right label / dimensions / links.
3. **Re-hydrate & re-export** only those entities: a small *delta dump* holding just
   the changed members is carved from the new slice, the job is repointed at it (each
   category pinned to its changed members via the adapter's `ids` allowlist), and a
   *delta corpus* — the affected rows and nothing else — is rebuilt.
4. **Prove idempotency** offline: the delta MERGE-loads over the base corpus to a fixed
   point (`neo4j/merge_load.verify_upsert_load` — load base, apply delta, snapshot,
   apply delta again, assert the grouped counts by label / `:TYPE` did not move).

Each run appends an auditable line to `<output_root>/sync-log.jsonl` (watermark, the
added/changed/removed tallies, the categories rebuilt, whether the load was idempotent).
`--since` reuses the entity-granularity twin of the `--since` scheduling window: a sync
recorded within the window is skipped.

```bash
# Diff the fresher slice, re-hydrate only the changed dishes, prove idempotency.
# --old-dump is the slice the corpus was last built from; --new-dump the fresher one.
culturescrape sync-wikidata jobs/food-drink-dump.yml \
  --old-dump  "$PWD/out/wikidata/wikidata-20260712-blueprint-slice.json.gz" \
  --new-dump  "$PWD/out/wikidata/wikidata-20260801-blueprint-slice.json.gz" \
  --new-index "$PWD/out/wikidata/wikidata-20260801-blueprint-slice.json.gz.index.sqlite3" \
  --since 24h
# Exit 0 = idempotent (or skipped/no-op); exit 1 = the MERGE would duplicate.
```

The EventStreams (recentchange SSE) leg named in the roadmap is the same upsert with a
different change source — since `run_upsert` is keyed on QID and re-hydrates from a
*slice*, the SSE feed only needs to select which QIDs to re-slice; the dump-diff variant
above is the offline-provable path and the one wired into CLI + tests today.

### Recorded run — reference slice (2026-07-12)

Measured on the reference `--limit-per-class 200` slice (5,691 entities). A **base**
food-drink `dish` corpus (`Q746549`, transitive) built to **31 nodes / 51 edges** in
0.9 s. One real dish (`Q117803607`) had its English label edited into a synthesised
fresher slice; `sync-wikidata` then:

| stage                    | measurement                                             |
|--------------------------|---------------------------------------------------------|
| diff                     | 0 added, **1 changed**, 0 removed, 5,690 unchanged      |
| resolve                  | 1 QID → 1 category (`dishes`)                            |
| delta corpus             | 4 nodes / 3 edges (the dish + its linked place hubs)     |
| corpus after upsert      | 31 nodes / 51 edges — **unchanged counts** (in-place)    |
| idempotent (delta + upsert) | ✅ both — the second delta load moved nothing         |
| wall-clock               | ~5.7 s (dominated by the two full-slice fingerprint scans) |

The corpus node/edge counts are **identical** before and after the upsert: the changed
dish re-landed on its own QID-anchored `csid` rather than duplicating — the whole point.
The throughput cost is the two full passes over the slice to fingerprint it (US-007's
scale note): fine at slice scale, but a full-dump diff wants a stored fingerprint
manifest rather than re-scanning the old dump each time.

### Verifying offline (fixtures + skipif-gated real slice)

`tests/test_wikidata_diff.py` pins the fingerprint/diff contract on synthetic entities
(key-order independence, revision-metadata invariance, add/change/remove classification,
delta carving). `tests/test_orchestrate_incremental.py` drives the whole upsert on the
committed dump fixture — plan grading, member resolution, sync log, and a full offline
`run_upsert` that rebuilds exactly the changed/added entities and proves the MERGE stays
idempotent. `tests/test_blueprint_incremental_dump_smoke.py` re-proves it on the real
slice (edits one genuine dish's label, upserts, asserts a single-entity delta loads
idempotently) where one is present, and is skipped on a fresh checkout.

```bash
uv run pytest tests/test_wikidata_diff.py tests/test_orchestrate_incremental.py \
  tests/test_blueprint_incremental_dump_smoke.py -q
```
