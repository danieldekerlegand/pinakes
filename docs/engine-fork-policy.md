# pinakes-engine fork policy — one source of truth

**Status:** Canonical decision, 2026-07-12 (Phase 0 item 0.9 / US-009).
Updated 2026-07-23: the `packages/culture-scrape/` shell was retired and the engine is
now first-party pinakes code at `engine/` ([`docs/REMOVED_FEATURES.md`](./REMOVED_FEATURES.md)).
That **strengthens** this policy rather than changing it — there is no longer even a
"vendored copy" to re-sync.
**TL;DR:** `engine/` in this monorepo is the **single canonical copy**
of the pinakes-engine engine. The standalone `~/Development/culture-scrape` repo is
**diverged and behind** — it is **archived**, not synced. Do all Python engine work here.

## 1. Why there are two copies

pinakes-engine began as a standalone Python repo (`~/Development/culture-scrape`) and was
**vendored** into pinakes at `packages/culture-scrape/` so the two projects could
co-evolve without a package-publish round trip (see `docs/engine-integration.md`).
That copy carried **no nested `.git`** — it was an ordinary subtree of this
monorepo, so every commit to it landed in pinakes's history. That was the right call
for velocity, but it created the classic vendored-fork hazard: the vendored copy moved
ahead while the standalone repo stood still, and there was **no sync mechanism** to
reconcile them. A diverged fork of the core engine is pure risk — this document retires
that risk on paper and states the procedure.

The shell has since been retired outright: the engine moved to `engine/` as first-party
code, so "the vendored copy" is simply *pinakes's code* now. The divergence table in §3
is kept as the historical record of what the standalone repo lacks.

## 2. The decision

- **`engine/` is canonical.** All future Python engine changes
  (acquisition adapters, datalog/neo4j emitters, rules, materializer) land here and are
  reviewed + tested via this repo's toolchain (`uv run mypy src` / `uv run pytest` /
  `uv run ruff check .` from `engine/`, plus the `convergence-qa.yml`
  CI job).
- **The standalone `~/Development/culture-scrape` repo is archived, not merged back.**
  It is behind on every axis below and has no changes the vendored copy lacks that are
  worth recovering. Archiving (rather than a git-subtree re-sync) is chosen because:
  1. The divergence is **one-directional** — the vendored copy is strictly ahead; there
     is nothing to pull *from* the standalone repo.
  2. A live subtree link would re-open the two-way-sync hazard this policy exists to close.
  3. The standalone repo is **not present on the maintainer's machine** (verified
     2026-07-12) and is not referenced by any build, CI job, or Docker image here.

  Archive procedure (do once, when convenient — not required for correctness here since the
  repo is already absent): tag the standalone repo `archived-superseded-by-pinakes`,
  push the tag, and set its README to point at `engine/` as canonical, or
  simply move it to cold storage. **Do not delete history** — keep it as a provenance record
  of the pre-vendor era.

## 3. Enumerated divergence (vendored ahead of standalone)

The vendored copy is ahead by these pieces (audited 2026-07-11, roadmap §2 finding 9;
re-confirmed against the tree 2026-07-12). The standalone repo lacks all of them.

| Divergence | Where (in `engine/`) | What it is |
|---|---|---|
| **Engine-free materializer** | `src/pinakes_engine/datalog/materialize.py` | Naive-fixpoint Datalog evaluator (`materialize`/`summarize`) that computes the rules' derived extension **without** swipl/souffle — computed 1,044,372 derived tuples over the full corpus. Vendored-only. |
| **Neo4j counts helper** | `src/pinakes_engine/neo4j/counts.py` | Label/relationship-count reporting over the loaded graph. Vendored-only. |
| **2 extra inference rules** | `src/pinakes_engine/datalog/rules.py` | Standalone ships **5** rules; the vendored copy ships **7** (`RULES`). The two extra port pinakes's cross-domain logic: `same_region/2` (geographic correlation) and `genetic_linguistic_correlation/2` (the symbolic core of the genetic↔linguistic correlation). |
| **pinakes acquisition adapter** | `src/pinakes_engine/acquire/pinakes.py` | Reads a pinakes canonical export (`nodes/*.tsv` + `edges/*.tsv`) from disk and emits `RawRecord`s, making pinakes a first-class acquisition source alongside Wikidata/Getty/PetScan. Vendored-only. |
| **~20 modified modules** | across `src/pinakes_engine/` (~84 Python modules total) | Bug fixes + capabilities added while vendored — e.g. `datalog/edges.py` `rel_conf/4` confidence projection (US-003), `datalog/prolog.py` tabling of recursive closures for cyclic base relations (US-002), `datalog/souffle.py`/`run_souffle` output-dir fixes, plus adapter/schema tweaks. These are validated by this repo's CI and documented in `engine/docs/engine-validation.md`. |

**Nested-git note:** `engine/` has no `.git` (verified). Never
re-introduce one — a nested repo would silently detach these files from pinakes's
history and re-create the fork.

## 4. Working rule for future changes

- **Edit here.** Any pinakes-engine change is a normal commit in this monorepo under
  `engine/`. Do **not** touch `~/Development/culture-scrape`.
- **Never re-vendor from the standalone repo.** It is behind; copying from it would
  regress the divergence above.
- If a genuine third-party fork of pinakes-engine ever needs upstreaming, do it via an
  explicit `git subtree` split of `engine/` (one-directional export),
  reviewed like any other release — but that is out of scope until an external consumer
  exists.

## 5. Related docs

- `docs/engine-integration.md` — the integration design + live export snapshot.
- `engine/docs/engine-validation.md` — the first real-engine run + the
  fixes the vendored modules carry.
- Neurosymbolic roadmap, Phase 0 — the status table this policy closes (item 0.9).
