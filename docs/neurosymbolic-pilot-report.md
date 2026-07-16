# Neurosymbolic pilot report — Scallop vs DeepProbLog

**NEUROSYMBOLIC_ROADMAP.md Phase 5 (row 5.4), US-004.** The go/no-go that closes the
`scallop-pilot` PRD and shapes the next one. It compares the two neurosymbolic
frameworks the roadmap named — **Scallop** (piloted end-to-end in US-001…US-003) and
**DeepProbLog** (exercised here) — on the *same* task, the *same* substrate, and
reports a clear recommendation.

- **Task:** rule-guided link prediction on `DESCENDS_FROM` — a neural edge scorer
  (over the frozen PyKEEN TransE embeddings) supplies soft edge probabilities, the
  corpus's recursive *ancestor* rule propagates them, loss is taken on the US-002
  training queries.
- **Scallop side:** `ml/src/pinakes_ml/scallop_train.py` (US-003), the
  `minmaxprob` provenance implemented engine-free + differentiable in torch. Results:
  [`docs/ml-baselines.md`](ml-baselines.md) (the `SCALLOP-PILOT` block).
- **DeepProbLog side:** `ml/src/pinakes_ml/deepproblog_pilot.py` +
  `pinakes-deepproblog` (US-004). DeepProbLog's inference **backend is ProbLog**;
  its neural annotated disjunctions only replace a fact's fixed probability with a
  network output, so the grounding + knowledge-compilation cost — the thing that
  decides feasibility — is ordinary ProbLog. `problog` is a declared `ml/` dependency,
  so the program the DeepProbLog model would compile runs here **for real**, and the
  scale ceiling is measured directly rather than asserted.

All numbers below were measured on this host (Linux, CPU, Python 3.11) at the current
corpus scale (1,342 `DESCENDS_FROM` train edges); reproduce with
`cd ml && uv run pinakes-deepproblog` (needs the DVC-tracked triples splits;
`uv run --project ml dvc pull` first) and `uv run pinakes-train-scallop` (US-003).

---

## 1. Does the task run in DeepProbLog?

**Yes, on a reduced subgraph — and the exact marginals are correct.** The acceptance
allows a documented reduced subset if scale forces it. `tractable_subgraph` carves a
small connected descent lineage (≤ 12 edges) out of the corpus; the annotated ProbLog
program (`render_problog_program`) compiles and evaluates its `ancestor/2` queries
exactly in **~17 ms**:

```
reduced run: 12 edges, 3 queries -> compiled=True (0.017s)
  ancestor(…q1474345, …q972472) = 0.360
  ancestor(…q1474345, …q208247) = 0.360
  ancestor(…q1474345, …q202165) = 0.216   (= 0.6 * 0.6, a two-hop chain)
```

The faithful DeepProbLog **neural-AD** program — where the fixed `0.6::edge(…)`
annotation is replaced by a network — is emitted verbatim by
`render_deepproblog_program` (the `.pl` counterpart of US-001's `build_scl_program`):

```prolog
nn(edge_net, [H, T]) :: edge(H, T).
ancestor(X, Y) :- edge(X, Y).
ancestor(X, Y) :- edge(X, Z), ancestor(Z, Y).
```

The `deepproblog` package itself (the neural-AD *training* loop) is **not** a declared
dependency — gated by `require_deepproblog_deps()` and `# pragma: no cover`, the same
stance US-003 took toward the macOS-only `scallopy` wheel. Per §3 it is not tractable
to run at full corpus scale anyway, which is the finding, not an omission.

## 2. Task metrics

| System | MRR | Hits@1 | Hits@10 | Source |
| --- | --- | --- | --- | --- |
| PyKEEN TransE (baseline floor) | 0.0071 | 0.0000 | 0.0111 | `docs/ml-baselines.md` |
| Neural predicate, rule OFF (ablation) | 0.0062 | 0.0000 | 0.0087 | US-003 |
| **Scallop** rule-guided (neural + ancestor) | 0.0060 | 0.0000 | 0.0087 | US-003 |
| **DeepProbLog** rule-guided, full corpus | — | — | — | intractable (§3) |

US-003's verdict was **neutral**: at the near-random corpus floor (Hits@1 = 0
everywhere) the rule neither helped nor hurt ranking, because the leakage-safe pair
split scatters descent chains across train/test so few held-out edges have a
train-only ancestor path to propagate along. **DeepProbLog cannot improve on this**: it
runs the *same* rule over the *same* soft edge probabilities, so its ranking signal is
bounded by the same structural fact — while paying the cost in §3 for an *exact* rather
than widest-path marginal (§4), a semantics difference that does not change which tail
outranks which. No full-corpus DeepProbLog metric is reported because a full training
run is not tractable here; the honest datum is the measured ceiling, not a fabricated
number.

## 3. Training speed & corpus-scale headroom

The two frameworks differ **architecturally**, and it dominates everything:

- **Scallop** propagates *all* queries in **one batched `minmaxprob` pass per epoch**
  (a tensor `scatter_reduce`, `minmax_widths`). Measured US-003 training: **40 epochs
  × 880 queries over the full corpus in 2.1 s total** (~53 ms/epoch), CPU.
- **DeepProbLog** knowledge-compiles **per training example** (each `Query` grounds and
  compiles its own arithmetic circuit). Measured exact ProbLog inference on the full
  1,342-edge corpus: **85 ms/query**, all queries compiling. Extrapolated to a US-002
  training run (880 queries × 40 epochs, no proof caching): **≈ 50 min/run** — about
  **1,400× slower** than Scallop, for no measured task gain.

Per-query cost also **grows with corpus size** even though the graph stays sparse
(proof counts ≤ 3): 11 ms/query at 25 base edges → 55 ms at 800 → 85 ms at 1,342, as
the grounder/compiler ranges over more base facts. See the regenerated probe table
below.

The deeper ceiling is **proof multiplicity**. ProbLog computes an *exact* marginal, so
a knowledge compiler must disjoin every distinct proof (simple path); circuit size
grows with the **number of paths**, which is exponential in a dense graph even when the
grounding stays compact. On a synthetic "ladder" (layers of width `W`, so
`W^(L-1)` paths) the exact compiler crosses its ceiling sharply:

| Paths per query | Exact compile |
| --- | --- |
| 243 (`L=6, W=3`) | ✓ 0.03 s |
| 256 (`L=5, W=4`) | ✗ **ceiling** (`dsharp` d-DNNF compiler crashes) |
| 1,024 (`L=6, W=4`) | ✗ ceiling |

**Today the corpus escapes this** — the `DESCENDS_FROM` graph is a *sparse forest*
(max 3 proofs/query), so per-query inference is tractable and the binding constraint is
throughput, not per-query hardness. But the corpus is designed to grow (Phase 3–4
data-population); as lineages accrue alternative paths and the descent graph densifies,
proof multiplicity — and thus DeepProbLog's exact-inference cost — grows super-linearly
toward that hard ceiling. Scallop's widest-path provenance is **O(edges × hops)** and
unaffected. The `DESCENDS_FROM` graph also already **contains cycles** (the same ones
the US-003 tier-2 consistency ratchet counts); a cyclic probabilistic `ancestor`
relation is the classic hard case for exact knowledge compilation.

## 4. Expressiveness

| Axis | ProbLog / DeepProbLog | Scallop (US-003) |
| --- | --- | --- |
| Probabilistic semantics | **Exact marginal** under Sato's distribution semantics — a **noisy-or over independent proofs**. Two disjoint paths `a→b→d` (0.9, 0.8) and `a→c→d` (0.5, 0.5): path products 0.72 and 0.25, so `P(anc(a,d)) = 1−(1−0.72)(1−0.25) = ` **0.79**. Principled but #P-hard. | **Widest-path bottleneck** (`minmaxprob`): a path's strength is its weakest edge (0.8 and 0.5); `max` over paths = **0.80**. A menu of provenances (`topkproofs`, `diffminmaxprob`, …), all differentiable + GPU-batched, none exact. |
| Same rule, different number | `P(anc(a,d)) = 0.79` | `Pr[anc(a,d)] = 0.80` |
| Negation | Stratified + probabilistic negation under the distribution semantics | Stratified negation (provenance-dependent) |
| Aggregation | Aggregates exist but interact awkwardly with the probability semantics | First-class aggregation (`count`, `sum`, `argmax`, …) integrated with provenance |
| Recursion | Native; but recursion × probability is where the exact-inference cost concentrates (§3) | Native; recursion under a semiring provenance stays a fixpoint tensor pass |

The semantics divergence is unit-tested against the real `problog` engine
(`test_problog_matches_two_path_noisy_or`): the two frameworks return **different
probabilities for the identical rule**. Neither is "more correct" — exact marginal vs
widest-path is a *modelling choice*. For link-prediction *ranking* (the task) it is
immaterial; it would matter for calibrated probabilistic QA, where ProbLog's exactness
is the draw.

## 5. Integration cost

| | Scallop | DeepProbLog / ProbLog |
| --- | --- | --- |
| Program syntax | `.scl` is closest to the existing Souffle export — US-001 translated **51/52** registry rules directly | Prolog; the ProbLog **emitter already exists** (Phase 2.3, `culturescrape/datalog/problog.py`) so facts + rules translate for free |
| Neural wiring | Tensor-native — the neural predicate is a `torch.nn.Module`; edge probs are a tensor fed straight into the provenance pass | Heavier — a DeepProbLog `Network` + per-example `Query` objects; probabilities cross the Python/engine boundary per example |
| Runtime deps | `scallopy` wheel is **macOS/arm64-only** (US-001/003 gated it) — but the `minmaxprob` semantics is reproduced **engine-free in torch** and runs on any host | `problog` **is declared and runs in CI**; but exact inference shells out to the external **`dsharp`** d-DNNF binary, which **segfaults** on dense/batched instances on this host, and the SDD alternative **`pysdd` is not installed**. `deepproblog` itself is undeclared (pins a conflicting torch/problog matrix) |
| In-process / GPU | Yes (PyTorch) | No — compilation is an external process; no GPU batching of inference |

Net: Scallop's integration is heavier at the *dependency* layer (a platform-locked
wheel) but its **semantics is trivially reproducible in torch**, which is exactly what
let US-003 train + evaluate on this Linux host. DeepProbLog's dependency is lighter to
*declare* (ProbLog is pure-Python-ish) but its exact-inference toolchain is **fragile
in practice** (fragile `dsharp`, absent `pysdd`) and does not batch or GPU-accelerate.

---

## 6. Recommendation for the next PRD

**Proceed with Scallop; do not adopt DeepProbLog as the training substrate.**

- **Framework: Scallop.** It is ~1,400× faster at the current corpus scale (§3), its
  provenance is O(edges × hops) so it *keeps* scaling as the corpus densifies, it is
  PyTorch-native and GPU-ready, and its `.scl` maps onto the existing rule registry.
  DeepProbLog's exact inference is 50 min/run today and heads toward a hard #P ceiling
  (~250 proofs/query) as lineages accrue alternative paths — for **no measured task
  gain** (both give the same neutral ranking; §2).
- **Keep DeepProbLog/ProbLog for bounded, high-value *exact* queries**, not training:
  probabilistic KGQA or confidence calibration over a *small selected subgraph* where
  exactness matters and proof counts are low. The ProbLog emitter (Phase 2.3) already
  supports this; the reduced-subset run in §1 is the template.
- **Task for the next PRD: Phase 5.5, the virtuous loop** — feed the trained Scallop
  edge-scorer's probabilities back onto `inferred:` edges, replacing constant
  confidences. This turns the pilot into a standing capability rather than a one-off
  metric. Pair it with a *denser* target relation than the leakage-scattered
  `DESCENDS_FROM` (e.g. `BORROWED_FROM` + geographic/linguistic correlation rules) so
  rule guidance has held-out ancestor paths to act on and the neutral result of US-003
  can be revisited on a task where the rule can actually move the metric.
- **Corpus / format changes it demands (canonical schema v1.2):**
  1. A first-class **learned-probability edge attribute** (distinct from the curated
     rubric `confidence`) so the virtuous loop can write scorer outputs back without
     clobbering provenance — mirror the `NON_WRITEBACK_FIELDS` discipline.
  2. A **reasoning-scope marker** on nodes/edges so an exact-inference (ProbLog) query
     can select a bounded, low-proof-count subgraph deterministically.
  3. Persisted **per-edge soft probabilities in the Scallop export** (US-001 currently
     interns boolean facts) so training does not recompute them each run.

---

<!-- The scale-probe table below is regenerated by `pinakes-deepproblog`; the
prose above is authored and preserved across regenerations. -->

<!-- DEEPPROBLOG-PROBE:START (generated by pinakes-deepproblog) -->

### Measured scale probe (regenerated by `pinakes-deepproblog`)

Directed `DESCENDS_FROM` graph contains a cycle: **yes** (a cyclic probabilistic `ancestor` relation is the pathological case for exact knowledge compilation). Each query is compiled on its own — DeepProbLog's per-example inference.

| Base edges | Multi-hop queries | Ground nodes | Max proofs / query | Per-query exact compile |
| --- | --- | --- | --- | --- |
| 25 | 7 | 17 | 2 | 7/7 ✓ ~0.010s |
| 50 | 20 | 77 | 2 | 20/20 ✓ ~0.013s |
| 100 | 20 | 105 | 3 | 20/20 ✓ ~0.017s |
| 200 | 20 | 105 | 3 | 20/20 ✓ ~0.023s |
| 400 | 20 | 105 | 3 | 20/20 ✓ ~0.034s |
| 800 | 20 | 105 | 3 | 20/20 ✓ ~0.056s |

At current corpus scale the descent graph is a **sparse forest** (few proofs per query), so *per-query* exact inference is tractable — the binding constraint is throughput (queries × epochs × per-query compile), not a single query's cost. Grounding stays compact while the proof count — and thus d-DNNF / SDD size — is what would explode on a denser graph (see the ladder in §Expressiveness). Contrast: US-003's Scallop `minmaxprob` pass closed the full-corpus `ancestor` relation (3,196 derived pairs) differentiably in one batched shot.

<!-- DEEPPROBLOG-PROBE:END -->
