# Engine validation — first real-engine run over the real corpus

Phase 0, item 0.2 of the neurosymbolic roadmap
(story **US-002** of the `symbolic-engine-truth` PRD). Until this run, no logic
engine had *ever* executed the exports — all symbolic validation rested on the
engine-free Python fixpoint evaluator (`datalog/materialize.py`). This is the
record of the first time SWI-Prolog and Soufflé loaded and queried the real
pinakes corpus, what it cost, and what it surfaced.

## TL;DR

- The full-corpus `graph.pl` loads into `swipl` **directly** — no `.qlf`,
  sharding, or Souffle-only bulk path needed. The roadmap's "1.19 GB graph.pl"
  estimate does not hold for the current corpus: the real file is **2.9 MB**
  (35,378 clauses), loads in **~0.29 s** at **~40 MB** peak RSS. Item 0.2's
  mitigation clause is therefore **not required**.
- The **cross-engine equivalence harness agrees on all 7 derived relations, 0
  divergences** — including the two non-trivial non-empty closures, `ancestor`
  (3,085 tuples) and `influenced_transitively` (505 tuples).
- **This run surfaced (and this story fixes) a real Prolog non-termination bug:**
  naive SLD resolution of a transitive-closure rule loops forever when the base
  relation contains a cycle. Two independent cycles exist in the real corpus
  (`descends_from`, `influenced_by`), so `ancestor` and `influenced_transitively`
  never terminated in `swipl` before the fix. The fix is to **table** the
  recursive rule heads (see [Fix](#fix-table-the-recursive-closures) below).

## Environment

| | |
|---|---|
| Corpus | `build/corpus` (gitignored), from `docs/engine-export-manifest.json`: **6,667 nodes / 5,713 edges**, 17 node types, 7 edge types |
| Datalog export | `pinakes_engine to-datalog build/corpus --engine both --rules` → 35,191 projected facts; `graph.pl` (2.9 MB) + `graph.dl` (8.4 KB) + `*.facts` |
| SWI-Prolog | 10.0.2 (local, via nixpkgs). CI/sidecar ship 9.2.9 — tabling is standard in both 9.x and 10.x |
| Soufflé | 2.5 (local, via nixpkgs). CI/sidecar ship 2.4 |
| Rules attached | the 7-rule library (`datalog/rules.py`), via `--rules` |

Reproduce: install the engines (`docs/datalog.md` → "Installing the engines"; on
NixOS/any-nix, `nix build nixpkgs#swi-prolog nixpkgs#souffle`), build the export
(`npx tsx scripts/export-for-engine.ts` from the repo root), then
`pinakes_engine to-datalog ... --engine both --rules --out <dir>` and load/run as
below.

## Load + probe results

**Bare load** (`swipl -g true -t halt graph.pl`): wall **0.29 s**, peak child
RSS **~40 MB**, `swipl` post-load global stack ~11 KB. Loads clean (0 warnings).

**Shipped example queries** (`datalog/examples/*.pl`, run against the real
`graph.pl`): all execute without error. They return **0 rows** because each
anchors on a fixture csid (e.g. `cs:language:gaulish`, `cs:event:inca-expansion`)
that is not present in the real corpus — the examples target the bundled
`datalog/examples/dataset`, not the live graph. See the
[shortest-influence-chain finding](#finding-c-shortest-influence-chainpl-does-not-scale)
for the one that does *not* run clean.

**`ancestor/2` probe** — the transitive closure of `descends_from` over the
archaeological-culture lineage. Deepest anchor: `cs:archaeological-culture:saltovo-mayaki`
with **22 ancestors**, a coherent Indo-European chain reaching back through
`chernyakhov-culture → wielbark-culture → … → corded-ware-culture → yamnaya-culture`.
3,085 `ancestor` tuples total.

**`contemporary/2` probe**: 0 tuples — the corpus carries no `contemporary_with`
edges yet (the rule and its declaration are present and answer `false` cleanly,
rather than erroring).

## Cross-engine equivalence (the harness, real corpus)

`datalog/equivalence.py` extracts each derived relation's full extension from
both engines and diffs them tuple-by-tuple. Over the real corpus:

| Derived relation | swipl | souffle | agree |
|---|---:|---:|:---:|
| `ancestor` | 3,085 | 3,085 | ✅ |
| `influenced_transitively` | 505 | 505 | ✅ |
| `within_region` | 0 | 0 | ✅ |
| `contemporary` | 0 | 0 | ✅ |
| `component_of` | 0 | 0 | ✅ |
| `same_region` | 0 | 0 | ✅ |
| `genetic_linguistic_correlation` | 0 | 0 | ✅ |

**0 divergences.** The two empty-on-this-corpus-by-design closures
(`genetic_linguistic_correlation` — no genetics source; `within_region` /
`component_of` — no `located_in` / `part_of` edges yet) agree trivially; the two
**non-empty** closures, `ancestor` and `influenced_transitively`, satisfy item
0.2's "at least 2 derived relations" and agree exactly. This equivalence is only
achievable *after* the fix below — before it, the swipl side never terminated.

## The finding: naive SLD loops on cyclic base relations

Running the harness for the first time, the swipl enumeration of `ancestor`
**never returned** — it consumed >24 GB and ran indefinitely, while Soufflé
finished the same relation in 34 ms. Cause: a transitive-closure rule

```prolog
ancestor(X, Y) :- descends_from(X, Y).
ancestor(X, Y) :- descends_from(X, Z), ancestor(Z, Y).
```

evaluated by naive SLD resolution re-derives the same tuples endlessly when the
`descends_from` graph has a **cycle** — there is no memoization to notice the
fixpoint has been reached. Soufflé's bottom-up, set-valued (semi-naive)
evaluation dedups and terminates natively; SWI-Prolog's top-down evaluation does
not. The corpus has **two** such cycles:

### Finding A — `descends_from` data-error cycle (clovis ↔ folsom)

```
descends_from(clovis, folsom).   descends_from(folsom, clovis).
```

A mutual descent is impossible for a lineage — a culture cannot descend from its
own descendant. Archaeologically, **Clovis (~13 ka) predates Folsom (~12 ka)**;
Folsom descended from Clovis, so the `clovis → folsom` edge is the wrong one.
Both engines dutifully derive the resulting self-loops `ancestor(clovis, clovis)`
and `ancestor(folsom, folsom)` (they *agree*, so this is not an engine
divergence), but the tuples are spurious.

**Filed, not fixed here** (US-002 is the engine-run story; touching lexicon data
pulls in `export/reconciliation` snapshot regeneration). Fix in a data-hygiene
pass: drop the `clovis descends_from folsom` edge from its source lexicon
(`lexicons/cultural-lineages.tsv` / archaeological-culture lineage rows), leaving
`folsom descends_from clovis`.

### Finding B — `influenced_by` legitimate cycles (NOT a data error)

```
eng ↔ fra    arb ↔ heb    arb ↔ tur    eus ↔ spa    nah ↔ spa
```

These 5 mutual pairs are **correct**: linguistic influence is genuinely
bidirectional (English and French, Arabic and Hebrew/Turkish, Basque/Nahuatl and
Spanish have each influenced the other). Unlike descent, `influenced_by` is *not*
a DAG and never will be — so the closure `influenced_transitively` is inherently
cyclic and **cannot be made acyclic by data cleaning**. This is exactly why the
fix has to live in the engine layer, not the data.

## Fix: table the recursive closures

The Prolog emitter (`datalog/prolog.py`) now declares every **recursive** rule
head — `ancestor`, `within_region`, `influenced_transitively`, `component_of`
(the transitive closures, detected by `rules.is_recursive`) — with

```prolog
:- table ancestor/2.
```

instead of `:- dynamic` / `:- discontiguous`. SWI-Prolog's **tabling** (SLG
resolution) memoizes derived answers and computes the least fixpoint, so it
terminates on a cyclic base relation and returns exactly Soufflé's tuple set
(3,085 / 505, verified above). Properties of the fix:

- **Prolog-only.** Tabling is a `swipl` directive; the shared rule *clause text*
  and the Soufflé emitter are untouched (Soufflé already handles cycles). The
  "clause text byte-identical across dialects" invariant holds.
- **Not also dynamic.** A tabled predicate must not be `:- dynamic` (SWI forbids
  tabling a dynamic procedure), so tabled heads are excluded from the
  dynamic/discontiguous declarations. Base relations and non-recursive heads
  (`contemporary`, `same_region`, `genetic_linguistic_correlation`) stay
  `:- dynamic` so an unpopulated relation answers `false` instead of raising.
- **Regression-guarded.** `tests/test_datalog_rules.py` pins which heads are
  tabled vs dynamic; `tests/test_cli_datalog.py`'s well-formedness check accepts
  `:- table`; a `docs/datalog.md` doctest asserts `ancestor` is tabled and never
  dynamic.

This generalizes: any future recursive rule is tabled automatically by
`is_recursive`, so a new cyclic closure cannot silently reintroduce the hang.

### Finding C — `shortest-influence-chain.pl` does not scale

The shipped example `shortest-influence-chain.pl` uses its own local
`chain_path/3` predicate that enumerates **all** paths between two nodes. Over
the real, *cyclic* influence graph there are infinitely many paths (a walk can
loop), so it overflows the 1 GB stack (~10 s) rather than terminating. This
example is only safe on the acyclic bundled fixture; it is not a library rule, so
tabling the closures does not help it. **Filed** — a later pass should bound the
search depth or table `chain_path` with a visited set; it does not block the
equivalence result above.

## Status vs item 0.2 acceptance

- ✅ Full-corpus `graph.pl` regenerated (`--engine both --rules`), loaded into
  `swipl`, example queries + `ancestor/2` / `contemporary/2` probes run; wall
  time (0.29 s load) and peak memory (~40 MB) recorded.
- ✅ Equivalence harness run on the real corpus for 2 non-trivial derived
  relations (`ancestor`, `influenced_transitively`); **0 divergences** after the
  tabling fix.
- ✅ The 1.19 GB load-failure mitigation is **not needed** — the real corpus
  loads directly (documented above), and the non-termination failure mode that
  *did* surface is fixed here, not merely mitigated.
- ✅ Python checks pass (`uv run mypy src` / `uv run pytest` / `uv run ruff check
  .`); the full suite runs the engine-gated tests with 0 engine-availability
  skips when the engines are present.
