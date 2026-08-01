# Scallop context export + Horn-rule translation

Neurosymbolic roadmap **Phase 5, US-001** (roadmap row 5.4) — the first step of
the neurosymbolic pilot. Loads the canonical corpus into
[Scallop](https://scallop-lang.org) as its differentiable-logic substrate: the
relations become Scallop fact tables, the provenanced Horn-rule registry is
translated to a `.scl` program, and a scallopy smoke run proves the round trip.

- **Pure core (engine-free):** `ml/src/pinakes_ml/scallop.py`
- **CLI:** `uv run pinakes-export-scallop`
  (`ml/src/pinakes_ml/export_scallop.py`)
- **Inputs:** the DVC-tracked canonical edge export
  (`export/culturescrape/edges/*.tsv`) + the committed rules registry
  (`core/src/culturescrape/datalog/rules_registry.tsv`)
- **Committed artifacts:** the translated program `ml/scallop/program.scl` and the
  snapshot manifest `ml/manifests/scallop-export-manifest.json`
- **DVC-tracked artifacts (git-ignored):** the interned relation CSVs +
  symbol table under `ml/data/scallop/`

## What the export produces

```
uv run pinakes-export-scallop
```

1. **Interned relations.** Every edge `:TYPE` becomes a lower-cased binary
   predicate (`DESCENDS_FROM` → `descends_from`); the deduplicated `(head, tail)`
   pairs are written as **interned integer** CSVs
   (`ml/data/scallop/relations/<rel>.csv`, `head_id,tail_id`) against a
   deterministic `csid → int` symbol table (`ml/data/scallop/symbols.tsv`, sorted
   vocab → index). Interning is byte-reproducible: a byte-identical corpus yields
   the same ids.
2. **Translated program.** The registry Horn rules are translated to Scallop
   `rel` clauses in `ml/scallop/program.scl` — a pure function of the committed
   registry, so it is committed to git and CI-checked against a fresh translation.
3. **Manifest.** `ml/manifests/scallop-export-manifest.json` records the interning
   / relation counts, the translated + skipped rule ids, and the smoke reference
   derivations (below). Deterministic (no wall-clock) → a corpus/registry change is
   what moves it.

Today's corpus: **8 relations / 2,267 facts / 2,057 symbols**, **51 rules
translated, 1 skipped**.

## How the translation works

A pure Horn clause — a head and positive predicate literals over *variables*, plus
comparison guards (`<`, `>=`, `!=`, …) and stratified negation — is expressible
identically in Soufflé and Scallop; only the surface syntax differs:

| Soufflé (registry `clause_souffle`)        | Scallop (`.scl`)                          |
| ------------------------------------------ | ----------------------------------------- |
| `ancestor(X, Y) :- descends_from(X, Y).`   | `rel ancestor(x, y) = descends_from(x, y)` |
| `… :- descends_from(X, Z), ancestor(Z, Y).`| `rel ancestor(x, y) = descends_from(x, z) and ancestor(z, y)` |
| `… , !from_ok_x(X, Y).`                    | `… and not from_ok_x(x, y)`               |
| `… , Ex < Sy.`                             | `… and ex < sy`                           |

Upper-case variables → lower-case, `:-` → `=`, `,` → `and`, `!p` → `not p`. The
registry stores the **Soufflé** clause text (the most complete dialect — it carries
the negation the Prolog column omits), so we translate from that column.

**The one translatability constraint is `every predicate literal must be binary`** —
exactly the constraint culture-scrape's own materializer imposes
(`datalog/rules.py` `ARITY == 2`). The single registry rule that breaks it,
`csid_uniqueness_violation` (reads the arity-3 `node/3`), is **skipped and reported**
in the manifest's `skippedRules`, never silently dropped. Non-`active` rules are
dropped by governance (status), not counted as translation failures.

Base predicates a rule reads but no corpus edge populates (`instance_of`,
`subclass_of`, `time_start`, …) are declared `type …` in the `.scl` so a body over
an unpopulated relation compiles and answers empty rather than erroring — the same
"a rule over an absent base relation answers false, not an error" stance as the
Prolog/ProbLog emitters. The temporal dimension predicates `time_start`/`time_end`
are typed `(String, i32)` so the arithmetic guards type-check.

## The scallopy smoke run — and why it is local-only here

```
uv run pinakes-export-scallop --smoke
```

Loads the program into `scallopy`, answers **`ancestor/2`** and the cross-domain
**`influenced_transitively/2`** (the closure of `derived_from ∪ influenced_by`)
over the real corpus, and asserts the derived extensions equal the **engine-free
reference derivation** (`scallop.reference_derivations`, a naive-fixpoint transitive
closure with the same semantics as culture-scrape's materializer). Today's
reference: `ancestor` = **3,196** derived pairs from 1,683 `descends_from` facts;
`influenced_transitively` = **510** from 115 facts. A disagreement raises
`AssertionError` — this is the acceptance's "spot-checked against the
materializer/engine output for agreement".

> **GOTCHA — `scallopy` does not install on this host.** Its only published wheel
> (`scallopy==0.1.0`) targets **macOS/arm64 + CPython 3.9**; it does not resolve on
> Linux or on this workspace's Python 3.11 (`pyproject.toml` documents why it is an
> undeclared dependency). So `--smoke` is a **local-only** path on a compatible Mac,
> gated by `require_scallop_deps()` (which runs in CI, where the dep is absent, to
> assert the error message is actionable). Install it with
> `uv pip install scallopy` on a compatible interpreter. The pure export +
> translation — and the reference derivation the smoke checks against — need none of
> this and run everywhere, so the smoke's *logic* is validated in CI without the
> engine.

## Tests

- **Fixture unit tests** (CI-safe): corpus loading, interning, clause/registry
  translation (recursion, comparison, negation, string constants, the non-binary
  skip), program emission, the reference derivation, and the `require_scallop_deps`
  gate — `ml/tests/test_scallop.py`.
- **Committed-artifact gate** (CI-safe, corpus-independent): `ml/scallop/program.scl`
  and the manifest's translated/skipped rule lists must equal a fresh translation of
  the *real* registry — a hand-edited program or a registry drift fails CI.
- **Live reproducibility gate** (`skipif` the DVC export is absent → skips in CI):
  the committed manifest must equal a fresh build of the live corpus + registry.

## Regenerating

After a corpus change (re-exported edges) or a registry change (new/edited rule),
re-run `uv run pinakes-export-scallop`, then re-pin the data
(`uv run --project ml dvc add ml/data && uv run --project ml dvc push`) and commit
`ml/data.dvc` alongside the updated `ml/scallop/program.scl` +
`ml/manifests/scallop-export-manifest.json`.

---

# Training-query generator (US-002)

Neurosymbolic roadmap **Phase 5, US-002** — the supervised signal the US-003
rule-guided link-prediction loop trains on. Emits **training queries**: held-out
positive edges paired with **type-constrained negatives** (head/tail corruptions
restricted to schema-compatible node types, so they are hard yet false).

- **Pure core:** `ml/src/pinakes_ml/queries.py`
- **CLI:** `uv run pinakes-export-queries`
  (`ml/src/pinakes_ml/export_queries.py`)
- **Inputs:** the DVC-tracked triples splits (`ml/data/triples/{train,valid,test}.tsv`
  + `triples.tsv`, built by `pinakes-export-triples`) + the machine-readable
  edge `from`/`to` type constraints in `shared/canonical-schema.json`
- **Committed artifact:** the snapshot manifest
  `ml/manifests/training-queries-manifest.json`
- **DVC-tracked artifact (git-ignored):** `ml/data/queries/queries.jsonl`

## Target relations and the three-way split

The pilot targets **`DESCENDS_FROM`** and **`BORROWED_FROM`** (`TARGET_RELATIONS`) —
both populated and type-constrained on each end. Positives are drawn from a
**held-out** split (default `valid`), giving a clean separation that US-003 relies
on:

| split   | role                                                            |
| ------- | --------------------------------------------------------------- |
| `train` | observed base facts fed to the Scallop program                  |
| `valid` | training-query **positives** (this generator's supervised signal) |
| `test`  | reserved for the US-003 held-out link-prediction evaluation     |

Because `train` (base facts) and `test` (eval) are both distinct from the positive
source, a positive is never an observed base fact and the evaluation split is never
trained on. `--split` overrides the source; `--negative-ratio` (default 4) and
`--seed` control the negatives.

## Type-constrained negatives

For each positive `(h, r, t)` the generator emits `negative_ratio` negatives,
alternating the corrupted end (tail, head, tail, …). The replacement is sampled from
the **type-compatible pool** for that end — entities whose node type (read off the
`cs:<node-type>:<id>` csid) is in the relation's `from`/`to` set in
`shared/canonical-schema.json` (reusing `consistency.load_edge_constraints`). So a
`BORROWED_FROM` negative stays language→language; a `DESCENDS_FROM` negative stays
within {language, language-family, culture, archaeological-culture}. An unconstrained
end (empty `from`/`to`) draws from all entities.

A draw that reconstructs the positive, duplicates an already-emitted negative, or
lands on **any** known-true edge (the *filtered* setting — train ∪ valid ∪ test) is
rejected and resampled, so **no negative is a real edge**. The manifest's `leakage`
block records this: `negativesLeakingTrainFacts` and `negativesLeakingKnownPositives`
recompute the invariant from the emitted queries (both must be `0`), `collisionsRejected`
counts resamples, and `insufficientPoolNegatives` counts any negative dropped because
the type pool was exhausted (never at corpus scale — a shortfall is reported, not
faked). Today: **176 positives → 704 negatives (880 queries)** from `valid`, `0`
train-fact leakage.

## Output format

`queries.jsonl` is a flat, uniform record per line (HF-`datasets`-compatible schema):
`relation`, `head`, `tail`, `label` (1 positive / 0 negative), `corrupted`
(`""`/`head`/`tail`), `head_type`, `tail_type`, and `source` (the positive's
`head\trel\ttail` row — every negative shares its parent positive's `source`, so
US-003 groups a positive with its negatives on that key).

## Tests

- **Fixture unit tests** (CI-safe): entity typing, type-filtered pools, type-respecting
  corruption, no-known-positive-leakage, positive-reconstruction guard, ratio/side
  alternation, determinism + seed sensitivity, pool-exhaustion reporting, manifest
  leakage counts, flat-JSONL uniformity — `ml/tests/test_queries.py`.
- **Live reproducibility gate** (`skipif` the DVC splits are absent → skips in CI):
  the committed manifest must equal a fresh build of the live triples splits.

## Regenerating

After a triples-split change (re-run `pinakes-export-triples`) or a schema
constraint change, re-run `uv run pinakes-export-queries`, then re-pin the data
(`uv run --project ml dvc add ml/data && uv run --project ml dvc push`) and commit
`ml/data.dvc` alongside the updated `ml/manifests/training-queries-manifest.json`.

---

# Rule-guided link prediction (US-003)

Neurosymbolic roadmap **Phase 5, US-003** — the pilot's core: a **differentiable
rule-guided link predictor**. A neural edge predicate over the frozen PyKEEN
embeddings supplies soft edge probabilities, and the corpus's *ancestor*
transitive-closure rule propagates that evidence through the graph before the loss
is taken.

- **Pure core:** `ml/src/pinakes_ml/scallop_train.py`
- **CLI:** `uv run pinakes-train-scallop`
  (`ml/src/pinakes_ml/train_scallop.py`)
- **Config (committed):** `ml/configs/scallop-pilot.json`
- **Inputs (DVC-tracked):** the PyKEEN entity embeddings
  (`ml/data/embeddings/<model>/entity_embeddings.npy`, US-003 baselines), the triples
  splits (`ml/data/triples/`), and the US-002 training queries
  (`ml/data/queries/queries.jsonl`)
- **Outputs:** the comparison block in `docs/ml-baselines.md`
  (`SCALLOP-PILOT` markers) + a git-ignored run summary in `ml/artifacts/scallop-pilot/`

## The model

For a candidate edge `(h, r, t)`:

1. **Neural predicate** — `p_direct = σ(MLP_r([h; t; h⊙t; |h−t|]))` over the frozen
   embeddings (per target relation). This is the *soft edge probability* the pilot
   needs; it also weights the observed `train` base facts of `r`.
2. **Symbolic propagation** — the ancestor rule
   `ancestor(x, y) = descends_from(x, y); descends_from(x, z) and ancestor(z, y)`
   under Scallop's **`minmaxprob`** provenance: `Pr[ancestor(h, t)] = max over paths
   of (min edge probability along the path)` — the exact bottleneck-/widest-path
   semantics.
3. **Rule-guided score** — `score = max(p_direct, Pr[ancestor(h, t)])` (a two-body
   rule under min-max-prob *is* the max of its bodies). BCE against the US-002 query
   labels; gradients flow through the rule layer into the neural predicate.

`BORROWED_FROM` has no logically-sound transitive rule (borrowing is not a
genealogy), so it is scored by the neural predicate alone — reported honestly rather
than propagated through an unsound rule.

`minmax_widths` is the **engine-free, differentiable** implementation of the
`minmaxprob` extension (a bounded-hop widest-path relaxation, `torch.minimum` +
`scatter_reduce` amax — both carry gradients). With every edge probability set to
`1.0` it collapses to the plain boolean transitive closure, so a test ties it back to
the US-001 engine-free `scallop.transitive_closure` oracle.

## Why the scallopy program is expressed but run engine-free

The equivalent scallopy program is emitted by `build_scl_program` (and run by
`run_scallop_ancestor` under `provenance="minmaxprob"`):

```
rel ancestor_descends_from(x, y) = descends_from(x, y)
rel ancestor_descends_from(x, y) = descends_from(x, z) and ancestor_descends_from(z, y)
```

As documented for US-001, **`scallopy` installs only on macOS/arm64 + CPython 3.9**,
so the scallopy path is local-only + `require_scallop_deps`-gated + `# pragma: no
cover`. The `minmaxprob` semantics is what `minmax_widths` computes exactly, so the
engine-free reference produces the pilot's numbers on any host and a local test
asserts the two agree — the same "validate the logic engine-free" discipline US-001
used for the boolean smoke.

## Evaluation & the honest comparison

Filtered MRR/Hits@k on the held-out `test` split (**full entity vocabulary**, matching
PyKEEN's evaluator) plus the tier-2 logical-consistency checks
(`pinakes_ml.consistency`) over the model's top-1 completions.

The headline verdict is an **ablation** — the identical neural predicate with the
rule ON vs OFF, through the *same* harness — which isolates the rule's contribution
without the cross-harness confound of comparing to PyKEEN's own evaluator. The
committed pure-PyKEEN row is shown as the floor the acceptance asks the side-by-side
against.

**Result at current corpus scale (TransE embeddings, seed 20260713):** the corpus is
tiny and very sparse and the PyKEEN floor is already near-random (MRR ≈ 0.007,
Hits@1 = 0), so the ablation is **neutral** — rule-guided MRR ≈ 0.0060 vs the
direct-only ablation ≈ 0.0062 (within noise). Two honest observations:

- The leakage-safe pair split puts most descent *chains'* links on different sides of
  train/test, so few held-out `descends_from` edges are reachable through `train`-only
  ancestor paths — the rule rarely has a multi-hop path to propagate along. Rule
  guidance needs a denser corpus (or a split that keeps chains intact) to pay off.
- The rule *raises* tier-2 descent-cycle / antisymmetry violations (it concentrates
  top-1 predictions onto descent chains, so more mutual/cyclic pairs surface) — a real
  tradeoff the symbolic check makes visible, not a code bug.

This is a working, reproducible neurosymbolic loop with an honest **negative/neutral**
result — an acceptable US-003 outcome per the PRD; the DeepProbLog feasibility run
(US-004) and the go/no-go report weigh it against the alternative.

## Tests

- **Fixture unit tests** (CI-safe, torch runs in the `ml/**` CI): the min-max
  semantics (boolean-closure reduction, bottleneck-of-best-path, gradient flow,
  empty graph), query/base-edge loading, the end-to-end training loop (loss
  decreases; the rule gives transitive positives signal), filtered ranking, the
  helped/hurt/neutral verdict, the `.scl` emission, the config round-trip, and the
  idempotent doc upsert — `ml/tests/test_scallop_train.py`.
- No committed metrics snapshot + live gate (unlike the verbalization/kgqa/baseline
  manifests): torch training metrics are not byte-reproducible across platforms, so
  the committed artifacts are the **config** + the **comparison analysis** (this
  section + the `docs/ml-baselines.md` block), the same stance as the QLoRA pipeline.

## Regenerating

Run `cd ml && uv run pinakes-train-scallop` (needs the DVC-tracked embeddings +
splits + queries; `uv run --project ml dvc pull` first). It upserts the
`SCALLOP-PILOT` block in `docs/ml-baselines.md` and writes the git-ignored run
summary. No `ml/data` re-pin (it reads the existing DVC data, writes only to
`ml/artifacts/`). A `pinakes-train-baselines` re-run preserves this block (the
same cooperating-CLIs discipline as the KGQA tier-3 section).
