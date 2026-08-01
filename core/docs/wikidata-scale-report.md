# Wikidata dump path — scale report & go/no-go

**Date:** 2026-07-12 · **Branch:** `ralph/wikidata-dump-slice` ·
**Phase:** 3 of the neurosymbolic roadmap
(items 3.1, 3.2, 3.4, 3.6)

This is the written verdict — with the real numbers measured in US-003..US-006 —
on whether the bulk-dump ingest path is ready to build the larger blueprint
domains (architecture, ~719k entities) and, beyond them, the full ~1.16M-entity
blueprint library. It is a companion to the reproducible
[wikidata-dump-runbook.md](wikidata-dump-runbook.md); every number here is
sourced from that runbook's "Recorded build/run" tables (the API-composed
`--limit-per-class 200` reference slice: **5,691 entities**, 9.80 MB gz, dump
version `20260712`).

**TL;DR verdict — conditional GO.** The dump stack is proven correct and
memory-bounded end to end on real data (build → Neo4j → Datalog → incremental
upsert), but its acquire leg re-streams the *entire* slice once **per category**,
so pointing the current Python reader straight at the full ~90 GB dump is a
**NO-GO** until two named throughput/memory fixes land. The bounded,
pre-filtered path (blueprint members carved out of the dump with
`wikibase-dump-filter` before Python touches them) is a **GO** and is the
recommended next scale step.

---

## 1. Per-stage numbers (measured)

### US-003 — food-drink, single blueprint, offline

All 14 food-drink classes selected from the 5,691-entity slice on a warm index
(`docs/wikidata-dump-runbook.md` §"Recorded build … (US-003)"):

| stage | throughput | memory |
| --- | --- | --- |
| acquire (14 categories) | **972** members selected; **146.2 s CPU** / **~46 s wall** @ 4 workers | — |
| normalize (14 categories) | **2,943** node+edge rows; **5.3 s CPU** | — |
| stitch + link + export | inline; whole build **45.9 s wall** | — |
| corpus | **1,062 nodes / 2,655 edges**; largest component **99.91%** | **71 MB RSS** · 9.7 MB Python-object peak |
| Neo4j / Datalog | admin-import script + **15,702** Datalog facts | (streaming) |
| QA | all default gates pass (provenance 0.99, 0 dup, 0 dangling) | — |

Derived unit rates:
- **Reader (JSON parse):** 14 full slice passes × 5,691 = 79,674 entity-parses in
  146.2 s CPU → **≈ 545 entities/s per core**. This single number governs
  everything below — acquire is CPU-bound on `iter_entities` JSON decoding.
- **Normalize:** 2,943 rows / 5.3 s → ≈ 555 rows/s CPU (not the bottleneck).
- **Memory is flat in slice size** — the streaming reader + 50k-row flush buffer
  cap RAM; the 71 MB peak tracks the *corpus* held for stitch/export, not the
  slice.

### US-004 — language + myth-religion + pinakes merge, offline

17 dump categories from the same slice merged with the live pinakes export
(`docs/wikidata-dump-runbook.md` §"Recorded build … (US-004)"):

| stage | throughput | memory |
| --- | --- | --- |
| acquire — dump | **802** members across 17 categories; each full-scans the slice | — |
| acquire — pinakes export | **12,671** canonical rows ingested | — |
| stitch + QID-reconcile + link + export | **14** cross-type same-QID dups collapsed | — |
| merged corpus | **7,682 nodes / 5,283 edges**; largest component **14.79%** | **192 MB RSS** · 43.5 MB Python-object peak |
| whole build | **345 s wall** @ 4 workers | — |
| Neo4j | idempotent MERGE double-load (0 count movement) | — |
| Datalog | **55,132** facts | — |
| QA | all gates pass (0 dup after reconcile, 0 dangling) | — |

Two things the merge measures that a single blueprint does not:
- **17 slice passes** (one per dump category) × 5,691 ≈ 96,747 parses ≈ 178 s CPU
  of pure re-scanning — the same 545/s wall, and the reason US-004's wall (345 s)
  dwarfs US-003's (46 s) despite **fewer** dump members (802 vs 972). Adding a
  domain adds full passes, not incremental reads.
- **Stitch memory grows with corpus size.** 1,062 nodes → 71 MB (US-003);
  7,682 nodes → 192 MB (US-004). The corpus is held in memory for the
  stitch/reconcile/export; ~121 MB for +6,620 nodes ⇒ **≈ 18 KB/node** on top of
  a fixed baseline. This is the second scaling axis (see §3).

### US-006 — incremental upsert

Reference run (`docs/wikidata-dump-runbook.md` §"Recorded run … (US-006)"): a base
`dish` corpus (31 nodes / 51 edges), one real entity changed, upserted in
**~5.7 s** — corpus counts **unchanged** (QID-anchored in-place update). The cost
is **two full-slice fingerprint scans** (old + new), the same 545/s reader tax as
acquire.

---

## 2. Extrapolation

The single governing constant is the reader: **≈ 545 entities/s per core** to
parse dump JSON, and **acquire performs one full slice pass per wikidata-dump
category.** Everything below follows from `passes × entities × (1/545 s)` for CPU
and `≈ 18 KB × corpus_nodes` for stitch RAM.

### To the larger blueprint domains (bounded slices)

Assuming each domain is provisioned as its own bounded slice sized to its member
count (the Recipe A/B pattern), acquire CPU ≈ `categories × members / 545`:

| domain | members (roadmap) | categories (approx) | acquire CPU¹ | stitch RAM² |
| --- | ---: | ---: | ---: | ---: |
| food-drink (measured) | 972 built | 14 | 146 s | 71 MB |
| language + myth (measured) | 802 dump + 12.7k export | 17 | ~178 s scan | 192 MB |
| architecture | ~719,000 | ~10–15 | **~2.5–5 h** | **~13 GB** |
| full library | ~1,160,000 | ~100 (11+ domains) | **days if serial** | **~21 GB** |

¹ `categories × members / 545 / cores`. The architecture row assumes the slice
holds ~719k members and ~12 categories each scanning it once: 12 × 719k / 545 ≈
15,800 s CPU ≈ 4.4 h single-core (≈ 1.1 h at 4 workers). ² `18 KB × nodes`
extrapolated from the two measured points; the stitch holds the whole corpus.

**Reading:** architecture is *reachable* as a bounded slice but already pushes
stitch RAM into the 10 GB range and acquire into hours — the per-category
re-scan is the cost driver. The full library is **not** serially feasible without
the §3 fixes: ~100 categories re-scanning even a domain-sized slice is quadratic
in the wrong direction.

### To the full ~90 GB dump directly (current Python reader)

Wikidata's `latest-all.json.gz` is ~100M entities. At 545 entities/s a **single**
full pass ≈ **51 hours single-core** (≈ 13 h at 4 workers). The current acquire
does *one pass per category* — for even a 12-category domain that is **~600
core-hours per domain build**, and re-running it for another domain re-reads the
whole 100M-entity dump again. This is the **NO-GO**: the code is correct but the
access pattern (N full Python passes over the raw dump) is intractable at
full-dump scale. Memory stays bounded (the reader streams), so the blocker is
throughput, not RAM — but throughput fails by two orders of magnitude.

---

## 3. Named fixes for the next scale step

In priority order — each is a concrete, scoped change, not new research:

1. **Single grouped selection pass (acquire).** Today each `wikidata-dump`
   category calls `iter_entities` independently → N full passes. Fold all of a
   job's dump categories into **one** stream: read the slice once, route each
   entity to every category whose class-membership matches (the SQLite index
   already answers membership in O(1)). Turns `N × slice` into `1 × slice` and
   collapses the US-004-style 17-pass tax to a single pass. *Biggest win, lowest
   risk — the index and per-category selection already exist; only the driver
   loop changes.*

2. **Adopt `wikibase-dump-filter` as the ingest pre-filter (Recipe B).** Do **not**
   point the Python reader at the raw 100M-entity dump. Stream the full dump once
   through the compiled `wikibase-dump-filter` (`--claim P31:<blueprint class
   union>`), which emits only the ~1.16M matched entities in the same framing the
   reader accepts. Python then parses ~1.16M, not ~100M — a ~90× cut before the
   545/s tax applies. This is already documented as Recipe B in the runbook and is
   the recommended production ingest leg. **Verdict on the §3.3 evaluation below.**

3. **Streaming / on-disk stitch to bound corpus RAM.** The stitch+export holds the
   whole corpus in memory (~18 KB/node ⇒ ~21 GB at 1.16M nodes). Spill the
   node/edge tables to the on-disk SQLite the index already uses (or an
   append-only shard-per-type on disk), so stitch RAM is bounded by the working
   set, not the corpus. Depends on the roadmap's *scale-ready-conversion*
   streaming-emitter work.

4. **Stored fingerprint manifest for incremental diff (US-006).** The upsert
   re-scans *both* slices to fingerprint them (2 full passes). Persist the
   fingerprint map beside each slice (a `<slice>.fingerprints` sidecar written at
   build time) so a diff reads the old map instead of re-scanning the old dump —
   halves incremental cost and makes it O(new-slice) instead of O(old+new).

---

## 4. Verdict on KGTK / `wikibase-dump-filter` (roadmap item 3.3)

- **`wikibase-dump-filter` — ADOPT for the ingest pre-filter.** It is the right
  tool for fix #2: a single-purpose, fast, streaming `P31`-claim filter that
  preserves the exact `[`/entity/`]` framing our reader already consumes, so it
  drops in with zero adapter changes (Recipe B is already wired and documented).
  It reads the ~90 GB dump once off the wire and never persists it — matching the
  PRD's "never persists the full dump" constraint. Use it to carve each blueprint
  domain's member set out of the full dump before Python parses anything.

- **KGTK — do NOT adopt for the ingest leg now; keep as prior-art reference.**
  KGTK's value is its typed-edge TSV model and graph-analytics toolchain — which
  substantially overlaps what culture-scrape *already* has (canonical TSV export,
  Neo4j admin-import, Datalog projection, the reconcile cascade). Adopting KGTK as
  the ingest path would mean re-expressing our hydration profiles, QID-anchored
  csid identity, and QA gates in KGTK's model for no throughput win over fix #2 +
  fix #1. Its `import-wikidata` pass is itself a full-dump scan — it does not beat
  a compiled claim-filter for *pre-filtering*. Revisit KGTK only if we later need
  whole-dump graph analytics (centrality/paths over all 100M entities), which is
  out of scope for the blueprint-library goal. Recorded in
  [`docs/prior-art.md`](prior-art.md) as the closest external model to this layer.

- **qEndpoint (local SPARQL over the full dump)** — not needed for the blueprint
  build path; membership is answered by the SQLite index. Reconsider only if
  ad-hoc SPARQL over the full corpus becomes a requirement.

---

## 5. Go/no-go

| target | verdict | condition |
| --- | --- | --- |
| Bounded/pre-filtered domain slices (food-drink, language, myth-religion) | **GO** | proven end to end, offline, memory-bounded (US-003/004/006) |
| Architecture (~719k) as a pre-filtered slice | **GO, with fix #1 + fix #3** | acquire drops to a single pass; stitch RAM spilled to disk |
| Full ~1.16M-entity library | **GO, with fixes #1–#3** | pre-filter (fix #2) + single pass (fix #1) + streaming stitch (fix #3) |
| Point the current Python reader at the raw ~90 GB dump | **NO-GO** | N full Python passes ≈ 51 h each; must pre-filter (fix #2) first |

**Bottom line.** The correctness case is closed: real Wikidata data builds a
valid corpus, loads idempotently into Neo4j, projects to Datalog, answers a real
engine query, reconciles against curated lexicons without identity damage, and
upserts incrementally in place — all offline, all memory-bounded. The scale case
is a **throughput** problem with two named, low-risk fixes (single grouped acquire
pass; `wikibase-dump-filter` pre-filter) plus one memory fix (streaming stitch)
before the full library is feasible. Recommended next step:
implement fix #1, provision the architecture domain via Recipe B, and re-measure
against this report's extrapolation before committing to the full library.

---

## Sources

Every figure above is measured and recorded in
[wikidata-dump-runbook.md](wikidata-dump-runbook.md) (US-003/004/006 "Recorded
build/run" tables) and its companion
[wikidata-merge-reconciliation.md](wikidata-merge-reconciliation.md). The
reference slice, index, and built corpora are gitignored under
`core/out/`; this report and the runbook commit the
measurements, not the artifacts.
