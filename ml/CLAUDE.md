# `ml/` — neurosymbolic ML workspace (NEUROSYMBOLIC_ROADMAP.md Phase 2)

Separate uv workspace (Python 3.11), NOT the culture-scrape sidecar — keep
torch/pykeen OUT of the sidecar so its Docker image stays slim. Run checks FROM
`ml/`: `uv run ruff check .`, `uv run pytest`, import smoke
`uv run python -c 'import torch, pykeen, problog'`.

## Reproducible-artifact pattern (US-002, reused by US-003/005)

The shape every dataset/metric deliverable follows:

- **Pure core over an input dir** (`triples.py`): `load_* → transform → build_manifest`,
  no wall-clock / network / MLflow, so it is byte-reproducible and tests drive it
  with tiny temp-dir fixtures. Filesystem writes + MLflow live in a thin CLI
  (`export_triples.py`), runnable as `python -m pinakes_ml.<mod>` AND as a
  `[project.scripts]` console script (adding a script entry does NOT change
  `uv.lock` — CI's `uv sync --frozen` stays green).
- **Committed manifest = the snapshot** (`ml/manifests/*.json`): counts + content
  hashes + any analysis (e.g. leakage stats), `json.dumps(sort_keys=True)` +
  trailing newline. Deterministic (pinned seed, sorted output) so a byte-identical
  corpus is a git no-op. The bulk data goes to `ml/data/` (DVC-tracked, git-ignored);
  only the manifest is committed.
- **Two test tiers.** Fixture-based unit tests (CI-safe, since the DVC export is
  ABSENT in the `ml/**`-scoped CI) + a **live snapshot gate** guarded with
  `@pytest.mark.skipif(not <export_dir>.exists(), …)` that asserts the committed
  manifest equals a fresh build of the live corpus. Same ratchet shape as
  `docs/convergence-qa-baseline.json`; it runs locally, skips in CI.
- **GOTCHA — repo-root path from a test file:** `ml/tests/x.py` →
  `Path(__file__).resolve().parents[2]` is the repo root (parents[1] = `ml/`). From
  a `src/pinakes_ml/x.py` module it's `parents[2]` = `ml/` (repo root =
  `.parent`). Off-by-one here silently skips the live gate.
- **GOTCHA — build/regenerate the manifest against the CANONICAL DVC corpus, not a
  locally-drifted `export/culturescrape`.** A prior scale-up (QID backfill / dedupe) or an
  aborted `npx tsx scripts/export-for-culturescrape.ts` can leave `export/culturescrape`
  modified vs the committed `export/culturescrape.dvc` hash (`uv run --project ml dvc status
  export/culturescrape.dvc` shows "modified"). A committed manifest built on that drifted tree
  is NOT reproducible by anyone who `dvc pull`s the canonical corpus. Symptom: one live gate
  passes while a sibling fails against the SAME export (the sibling's manifest was regenerated
  on the drift). Fix before regenerating any manifest: `uv run --project ml dvc checkout
  --force export/culturescrape.dvc` (the extra `manifest.json`/`convergence/`/`reconciliation/`/
  `writeback/` files are gitignored scratch — `--force` is safe), then rebuild + `dvc add
  ml/data && dvc push`. Attribute-template selection hashes on `node.csid`, so a QID-driven
  csid change reshuffles a few `dated.*`/`located_at.*` counts (edge counts stay put — edges
  dedup on the csid triple, which is unchanged).

## Training-data generators (Phase 5 US-002; US-003 reuses the shape)

The LLM-training datasets follow the **same reproducible-artifact pattern** as the
triples exporter — a pure core + thin CLI + committed manifest snapshot + two test
tiers. Specifics for the verbalization generator (`verbalize.py` +
`export_verbalizations.py`, manifest `ml/manifests/verbalization-manifest.json`,
data `ml/data/verbalizations/verbalizations.jsonl`):

- **Reads BOTH `nodes/` and `edges/`** of `export/culturescrape/` — nodes give the
  human-readable `name` per csid (edges reference csids, never names) plus rich
  attributes. `load_nodes` builds a `csid → NodeInfo` map; parse **header-driven**.
- **HF-datasets-compatible JSONL = a FLAT, uniform record per line.** Every example
  (edge or attribute) has the *same* string keys (`text`/`kind`/`relation`/`head`/
  `head_name`/`tail`/`tail_name`/`value`/`template_id` + provenance + `license`), so
  `datasets.load_dataset("json", …)` infers one feature set. Don't nest heterogeneous
  objects — mixed nested shapes break HF schema inference. `json.dumps(sort_keys=True,
  ensure_ascii=False)` per line keeps unicode names readable + bytes reproducible.
- **Templates are hand-written per edge `:TYPE`** (`EDGE_TEMPLATES`); the typed edge
  vocabulary (14 relations) makes this tractable. One-or-more variants per type,
  selected deterministically by `sha256(seed + "head\trel\ttail") % len` — variety
  without a reroll. A **coverage test** asserts every non-`EXCLUDED_RELATIONS` edge
  type in `shared/canonical-schema.json` has a template (a new edge type without one
  fails CI). Reuse `triples.EXCLUDED_RELATIONS` — derived temporal relations are rules,
  never verbalized.
- **Dedup edges on `(head, relation, tail)`** (like triples — one row per supporting
  datum). Provenance for the kept example comes from the **lexicographically-first**
  supporting row (sort the rows, first-wins) so the choice is stable.
- **GOTCHA — null-placeholder attributes.** The export uses `(lat,lon)=(0,0)` ("null
  island") and `year 0` as blank sentinels (e.g. every language row carries them). The
  attribute verbalizer treats both as absent (`_parse_int` returns `None` for `0`;
  coords skipped when both are `0.0`) — otherwise you emit thousands of "located at
  0, 0" / bogus-date examples. Year formatting: `>0 ⇒ "N CE"`, `<0 ⇒ "N BCE"`.
- Edge-example count equals the triples count (2,267) by construction (same dedup);
  attribute examples add the dated/coordinate facts. Re-pin after regenerating:
  `dvc add ml/data && dvc push`, commit `ml/data.dvc` + the manifest together.

## Corpus facts (edges → triples)

- The triples dataset reads `export/culturescrape/edges/*.tsv` (one file per
  semantic relation, `neo4j-admin import` header: `:START_ID`/`:END_ID`/`:TYPE`).
  Parse **header-driven**, not by column position.
- **Derived temporal relations never enter training triples** — `CONTEMPORARY_WITH`,
  `PRECEDES`, `FOLLOWS` are Datalog rules materialized at query time
  (scale-ready-conversion T-SR-US-001), not stored edges. `PART_OF_PERIOD` stayed a
  stored structural edge (not excluded). See `EXCLUDED_RELATIONS` in `triples.py`.
- The export emits **one edge row per supporting datum** (a language-pair
  `COGNATE_WITH` recurs once per shared cognate word, differing only in
  `pinakes_id`); dedup on `(head, relation, tail)` for link prediction
  (5,836 rows → 2,267 triples today).
- **Leakage-safe splits group by unordered entity pair** `{head, tail}` so inverse
  (symmetric `COGNATE_WITH`/`SYNCRETIZED_WITH`), cross-relation, and reverse-direction
  duplicates never straddle train/valid/test.

## PyKEEN baselines (US-003)

- **Shared vocab id map is mandatory.** Load every split with `TriplesFactory.from_path(
  …, entity_to_id=, relation_to_id=)` built from the committed `entities.tsv`/
  `relations.tsv` (`load_label_to_id`). This makes the id space (a) cover entities that
  the leakage-safe pair split leaves only in valid/test, and (b) identical across models
  and reruns — the prerequisite for filtered eval AND for embeddings that stay row-aligned
  to `entities.tsv` index order. Never let each factory derive its own ids.
- **Reproducibility = `random_seed` (`BASELINE_SEED`) + CPU device.** PyKEEN's
  `random_seed` pins torch/numpy/python RNGs, so a rerun yields byte-identical metrics →
  `docs/ml-baselines.md` is a git no-op unless the corpus/hyperparameters change. The doc
  renderer (`render_baselines_doc`) is PURE (no wall-clock) and unit-tested; it records the
  corpus DVC md5 (`read_dvc_md5` parses `export/culturescrape.dvc`) + manifest/triples
  sha256 as "the version these metrics were measured on". Don't put the `ml/data` md5 in
  the doc — it's circular (adding the embeddings changes it after the doc is written).
- **torch/pykeen/numpy imported LAZILY inside functions** (module top stays light so
  `import pinakes_ml` doesn't pull the heavy stack). numpy is NOT a declared dep — it
  rides in transitively via torch/pykeen (same as pandas for `from_path`), so `uv.lock`
  is unchanged and CI's `uv sync --frozen` stays green.
- **CI smoke trains; full runs don't.** US-003's `test_baselines.py` runs a tiny in-memory
  1-epoch train (dim 2) that DOES execute in the `ml/**` CI (the "smoke-tested on a tiny
  fixture" acceptance) — distinct from the earlier "no training in CI" stance, which still
  holds for the *full* 100-epoch runs (local-only). The live gate (`load_split_factories`
  on the real splits) is `skipif not (ml/data/triples/train.tsv).exists()` → skips in CI.
- ComplEx/RotatE entity representations are genuinely `complex64`; `entity_embeddings`
  returns them as-is (`np.save` round-trips complex) and the dtype is recorded in each
  model's `metadata.json`. Embeddings land under `ml/data/embeddings/<model>/` — the same
  DVC-tracked `ml/data` tree, so re-pin with `dvc add ml/data && dvc push` after a run.

## Logical-consistency ratchet (US-005)

- **`consistency.py` is pure** (no torch — imports only `triples.Triple` + stdlib), so
  the CI ratchet recomputes violation counts from committed files without the heavy
  stack. Three checks: descent acyclicity (`DESCENDS_FROM` DAG via iterative Tarjan
  SCC — self-loops + SCC>1), canonical-schema `from`/`to` type breaches (endpoint node
  type read off the `cs:<node-type>:<id>` csid; an **empty** `from`/`to` list in
  `shared/canonical-schema.json` ⇒ unconstrained ⇒ `None` ⇒ that end is *not* checked),
  and antisymmetry (mutual/self on the descent+derivation relations;
  `COGNATE_WITH`/`SYNCRETIZED_WITH` are symmetric and excluded). Source the type
  constraints from the machine-readable schema — never hard-code them.
- **Predictions are committed to GIT, not DVC.** `ml/predictions/<model>.tsv` (top-`k`
  head+tail completions of each test query, default `k=1`) is small + reproducible, and
  being in git is what makes the ratchet a *real* CI gate (pure recompute over committed
  inputs — same shape as the TS `convergence-qa` gate over committed lexicons). Contrast
  with embeddings, which are large/binary → DVC. `ml/.gitignore` ignores `/data`, not
  `/predictions`, so predictions are tracked automatically.
- **Two CLIs, one doc writer.** `train-baselines` (local-only, has the trained models)
  generates predictions + writes the baseline + the unified `docs/ml-baselines.md`
  (metrics *and* consistency, so they're "reported together"). `check-consistency` is
  the pure ratchet: recompute vs `manifests/consistency-baseline.json`, exit 1 on any
  category exceeding baseline; `--write-baseline` is the retraining-free re-baseline
  escape hatch. Both derive the baseline from the same pure checks over identical
  committed predictions → identical bytes, so they never diverge.
- **`generate_predictions` needs the `PipelineResult`, not just embeddings** (PyKEEN
  `predict_target` scores through the full model). So `train_baselines` calls
  `run_pipeline` directly and builds the `BaselineOutcome` inline, rather than
  `train_baseline` (which discards the result). `testing.triples` is the labeled ndarray.
- **The committed-artifact ratchet test is the CI gate** — it recomputes over
  `ml/predictions/*.tsv` + the committed baseline + schema (all git-tracked, present in
  CI) AND asserts the baseline equals a fresh `build_baseline` over those predictions, so
  a hand-loosened baseline is caught. The `generate_predictions` live gate is
  `skipif ml/data absent` (skips in CI). Predictions + metrics are byte-reproducible
  (pinned seed, CPU) → a rerun is a git no-op; `ml/data`/embeddings are unchanged by
  US-005 (same training) so no DVC re-pin.

## KGQA evaluation — eval tier 3 (US-004)

`kgqa_eval.py` (pure) + `eval_kgqa.py` (thin CLI) score the held-out KGQA `eval`
split — the third eval tier alongside link-prediction metrics (tier 1) and logical
consistency (tier 2). Same reproducible-artifact shape: pure core + committed
snapshot (`ml/manifests/kgqa-eval-baseline.json`) + a live gate (`skipif` export /
`ml/data/kgqa/eval.jsonl` absent) asserting the baseline equals a fresh build.

- **Systems are pluggable + deterministic, so CI is network-free.** A `System` is
  `Callable[[QARecord], SystemPrediction]`. The committed baseline measures
  `GraphRetrievalSystem` (BFS a depth-bounded neighbourhood around the subject, then
  walk the gold reasoning chain **only through retrieved edges** — retrieval depth is
  the measured variable, so a chain deeper than `DEFAULT_RETRIEVAL_DEPTH=2` is
  answered wrong, an honest floor not an oracle) vs a `no-retrieval` control (restate
  the subject). The *live* off-the-shelf-LLM variant (Gemini proxy over the same
  retrieved subgraph) is local-only, documented in `docs/kgqa-dataset.md`, never in CI.
- **Metrics are integer-derived + rounded** (`round(x, 6)`) so the JSON snapshot is
  byte-stable across platforms: exact / normalized answer match + an evidence-grounding
  rate (is the answer a node the system retrieved?), overall + per-`kind`.
- **Tier-2 runs over the KGQA evidence.** `evidence_triples(predictions)` →
  `consistency.evaluate_consistency` records descent-cycle / schema-type /
  antisymmetry counts per system in the same baseline. The evidence is real corpus
  edges, so a nonzero `schemaTypeBreaches` (today 20 — `DESCENDS_FROM` among
  `writing-system` nodes the schema's `from`/`to` sets don't declare) is a genuine
  corpus/schema observation surfaced by the check, not a code bug. It is a committed
  snapshot, NOT the monotone `consistency-baseline.json` ratchet.
- **GOTCHA — the tier-3 doc block is co-owned.** `pinakes-eval-kgqa` upserts a
  marker-wrapped (`KGQA-EVAL:START/END`) tier-3 section into `docs/ml-baselines.md`
  (which `train_baselines` otherwise rewrites from scratch). `render_baselines_doc`
  takes an optional `kgqa_section` and `train_baselines` extracts + re-appends the
  existing block, so the two CLIs cooperate instead of clobbering. Regenerate with
  `uv run pinakes-eval-kgqa` after any corpus/eval-split change; the live gate
  fails on a stale baseline. No DVC re-pin (reads the existing split, writes no data).

## QLoRA fine-tuning pipeline (US-005)

`finetune.py` (pure core + lazy heavy imports) + `train_finetune.py` (thin CLI,
console script `pinakes-finetune`) consume the US-002 verbalization + US-003 QA
JSONL, QLoRA-fine-tune a small open causal-LM, and score the held-out KGQA split
**before/after** through the US-004 tier-3 scorer. Full runbook + GPU procedure:
[`docs/finetune-runbook.md`](../docs/finetune-runbook.md).

- **The heavy training stack is NOT a declared dependency** — same rule as
  `scallopy` (see `pyproject.toml`): `trl`/`peft`/`accelerate` (+`bitsandbytes` for
  CUDA 4-bit) are installed on demand (`uv pip install trl peft accelerate`), never in
  `uv.lock`. So **all heavy imports are lazy inside functions** — `import
  pinakes_ml.finetune` and the whole CI suite work in the slim env. Adding the
  `[project.scripts]` entry does NOT change `uv.lock`; CI's `uv sync --frozen` stays
  green. `require_finetune_deps()` raises an actionable install message when absent —
  and that test RUNS in CI (deps absent) but SKIPS locally (deps installed).
- **No training in CI, no committed metrics snapshot.** Training metrics/weights are
  NOT byte-reproducible across platforms (MPS vs CUDA float nondeterminism), so unlike
  the verbalization/kgqa/baseline manifests there is **no committed snapshot + live
  gate** here. CI tests only the **pure core** on fixtures (dataset assembly, prompt
  formatting, `FineTuneConfig` round-trip, the before/after scoring wiring with fake
  `System`s, the dep gate). The committed artifacts are the **configs**
  (`ml/configs/finetune-{smoke,gpu}.json`) + the runbook — not a numbers file.
- **Config-driven + frozen dataclass.** `FineTuneConfig` (model / dataset paths /
  LoRA + training hyperparameters) round-trips through JSON (`from_json`/`to_dict`),
  rejects unknown keys (catches config typos), and `.resolved(base)` makes the dataset
  paths absolute against the ml root. `lora_target_modules` is a tuple internally
  (frozen/hashable), a list on the wire.
- **Reuse the tier-3 `System` seam for before/after eval.** The base and tuned models
  are wrapped as `HFCausalLMSystem` (a `kgqa_eval.System = Callable[[QARecord],
  SystemPrediction]`) so they score through the EXACT harness as the US-004
  graph-retrieval baseline — `evaluate_systems` is pure w.r.t. the systems, so tests
  drive it with deterministic fake systems (perfect/blank) and assert the metrics.
- **GOTCHA — trl 1.x `SFTConfig`/`SFTTrainer` API.** `SFTTrainer` takes
  `processing_class=` (not `tokenizer=`) + `peft_config=`; `SFTConfig` takes
  `dataset_text_field` + `max_length` (not `max_seq_length`). CPU training needs
  `use_cpu=True` and `bf16=False/fp16=False` (bf16/fp16 need CUDA) or `SFTConfig`
  raises "Your setup doesn't support bf16/gpu". These live in `train_qlora` (all
  `# pragma: no cover` — local-only, never run in CI). The pipeline was proven
  end-to-end on `hf-internal-testing/tiny-random-LlamaForCausalLM` on CPU.
- **Datasets referenced by DVC hash, not re-pinned.** The pipeline READS the existing
  DVC-tracked `ml/data/{verbalizations,kgqa}` and writes only to the git-ignored
  `ml/artifacts/` (adapter + `run-summary.json`) + MLflow — so **no `dvc add ml/data`
  re-pin** (contrast US-002/003 which generate data). `ml/.gitignore` ignores
  `/artifacts`.

## Scallop context export + Horn-rule translation (Phase 5 US-001)

`scallop.py` (pure, stdlib-only) + `export_scallop.py` (thin CLI, console script
`pinakes-export-scallop`) load the corpus into Scallop: interned relation
CSVs, a `.scl` translation of the rules registry, and a gated scallopy smoke.
Full runbook: [`docs/scallop-pilot.md`](../docs/scallop-pilot.md).

- **The registry is the rule source, not `rules.py`.** Translate from the committed
  unified registry `core/.../datalog/rules_registry.tsv`
  (`clause_souffle` column — the most complete dialect, it carries the negation the
  Prolog column omits). Only `status == "active"` rows are emitted (governance).
- **Soufflé→Scallop is a surface rewrite:** upper-case vars → lower-case, `:-` → `=`,
  `,` → `and`, `!p` → `not p`, comparison guards pass through. The ONE translatability
  constraint is **every predicate literal is binary** (the same `ARITY == 2` the
  culture-scrape materializer imposes) — the lone offender `csid_uniqueness_violation`
  (reads arity-3 `node/3`) is **skipped + reported** in the manifest, never dropped.
  Today: 51 translated, 1 skipped.
- **`program.scl` is corpus-INDEPENDENT** (a pure function of the committed registry),
  so it is committed to git under `ml/scallop/` (NOT `ml/data`, which is gitignored)
  and CI-gated byte-for-byte against a fresh translation — a real test even without
  the DVC corpus. The manifest's *registry-derived* fields (translated/skipped ids)
  are likewise CI-gated; only its corpus counts need the `skipif`-export live gate.
- **`.scl` type inference:** base predicates (read in a body, never a rule head) get a
  `type name(String, String)` decl so a rule over an unpopulated relation compiles +
  answers empty (don't error); `time_start`/`time_end` are `(String, i32)` so the
  temporal comparison guards type-check. Entities stay `String` (self-describing +
  lets `instance_of(X, "Culture")` stay uniformly typed) — the interning to ints is a
  separate artifact for the CSV/tensor export.
- **GOTCHA — `scallopy` runs on macOS/arm64 ONLY** (its sole wheel is
  `cp39-macosx_11_0_arm64`; it does NOT resolve on Linux or Python 3.11). So the
  `--smoke` scallopy run is local-only + `require_scallop_deps`-gated + `# pragma:
  no cover`, exactly like the finetune training stack. The smoke's *logic* is still
  validated in CI via the engine-free `transitive_closure` reference derivation the
  smoke asserts equality against (`SMOKE_TARGETS`: `ancestor` + `influenced_transitively`).
- Re-pin `ml/data` (`dvc add ml/data && dvc push`) after regenerating — the interned
  relation CSVs live in the DVC-tracked `ml/data/scallop/` tree.

## Training-query generator — Scallop pilot US-002

`queries.py` (pure) + `export_queries.py` (thin CLI, console script
`pinakes-export-queries`) turn the triples splits into **training queries** for
the US-003 rule-guided loop: held-out positives + type-constrained negatives. Same
reproducible-artifact shape (pure core + committed manifest
`ml/manifests/training-queries-manifest.json` + DVC data `ml/data/queries/queries.jsonl`
+ live gate). Full runbook: [`docs/scallop-pilot.md`](../docs/scallop-pilot.md) §US-002.

- **Reads the triples DATASET, not the raw export.** Positives come from
  `ml/data/triples/<split>.tsv` (default `valid`), known-positives (the negative
  rejection set) from `triples.tsv`, train facts from `train.tsv` — all reused via
  `consistency.parse_predictions` (the split files ARE `head\trel\ttail`). This
  decouples US-002 from any `export/culturescrape` drift: the live gate is
  `skipif not (ml/data/triples/valid.tsv).exists()`, independent of the edge export.
- **Three-way split discipline** (why positives default to `valid`): `train` = base
  facts fed to Scallop; `valid` = training-query positives; `test` = US-003 eval.
  Keep them disjoint — never draw positives from `test`, or US-003's held-out eval is
  trained on. `--split` overrides but document the leakage implication if you do.
- **Type-constrained corruption reuses the schema, never hard-codes types.** The
  corruption pool for an end is entities whose `node_type_of(csid)` ∈ the relation's
  `from`/`to` set (`consistency.load_edge_constraints` over
  `shared/canonical-schema.json`); an empty set ⇒ `None` ⇒ unconstrained ⇒ all
  entities. Same csid-type source as the consistency ratchet — a schema change flows
  through both.
- **Leakage is filtered + self-checked.** A negative is rejected if it reconstructs
  the positive, duplicates an emitted negative, or is ANY known-true edge (train ∪
  valid ∪ test — stronger than the AC's "not a train fact"). The manifest's
  `leakage.negativesLeaking{TrainFacts,KnownPositives}` RECOMPUTE the invariant from
  the emitted queries (must be 0), so the snapshot gate catches a generator bug, not
  just trusts it. `insufficientPoolNegatives` counts dropped negatives (pool
  exhausted) — 0 at corpus scale; a shortfall is reported, never a type-wrong fake.
- **Self-loops are allowed negatives.** Corrupting `(h,t)`'s tail with `h` yields a
  self-loop `(h,h)` — genuinely false + type-well-formed, so it's kept (rare: 1/pool).
  Don't add a self-loop guard expecting it to change counts materially.
- Re-pin `ml/data` (`dvc add ml/data && dvc push`) after regenerating — the JSONL
  lives in the DVC-tracked `ml/data/queries/` tree.

## Rule-guided link prediction — Scallop pilot US-003

`scallop_train.py` (pure core, lazy torch) + `train_scallop.py` (thin CLI, console
script `pinakes-train-scallop`) are the pilot's core: a differentiable
rule-guided link predictor — a neural edge predicate over the frozen PyKEEN
embeddings + the *ancestor* transitive-closure rule under Scallop's `minmaxprob`
provenance. Full runbook: [`docs/scallop-pilot.md`](../docs/scallop-pilot.md) §US-003.

- **`minmax_widths` IS the `minmaxprob` semantics, computed engine-free.** The
  recursive `ancestor` rule under scallopy's `minmaxprob` provenance = the widest-path
  (bottleneck) reachability `Pr[ancestor(h,t)] = max-path of min-edge-prob`, which
  `minmax_widths` computes exactly as a bounded-hop, **differentiable** torch
  relaxation (`torch.minimum` + `scatter_reduce(reduce="amax")` both carry gradients).
  With all edge weights `1.0` it collapses to the boolean transitive closure — the
  test ties it back to US-001's `scallop.transitive_closure` oracle. Same "validate the
  logic engine-free" discipline US-001 used: the scallopy path (`run_scallop_ancestor`,
  `build_scl_program`) is local-only + `require_scallop_deps`-gated + `# pragma: no
  cover` (macOS/arm64 wheel), and the reference produces the numbers on any host.
- **torch/pykeen ARE the declared stack, so the CI smoke actually TRAINS.** Unlike
  scallopy (undeclared, macOS-only), torch runs in the `ml/**` CI — so
  `test_scallop_train.py` trains the whole loop on a fixture and asserts the loss
  drops + the rule gives transitive positives signal (the "loop smoke-tested on a
  fixture subset in CI" acceptance). Keep torch imports **lazy inside functions**
  anyway (no torch at module top) so `import pinakes_ml` stays light — the
  nn.Module is defined *inside* `build_model`, not at module scope.
- **The honest comparison is an ABLATION, not vs PyKEEN's evaluator.** Comparing the
  pilot's MRR to the committed PyKEEN number confounds a different scorer with a
  different evaluator (tie policy, filtering). So the verdict is rule-ON vs rule-OFF
  (`transitive_relations=[]`) through the SAME `run_ranking` harness; the PyKEEN row is
  shown only as the floor. Rank over the FULL entity vocab (`typed_candidates=False`)
  to match PyKEEN's protocol — typed pools are an easier task, never the headline.
- **No committed metrics snapshot + live gate** (same as the QLoRA pipeline): torch
  training numbers aren't byte-reproducible across platforms. Committed artifacts = the
  **config** (`ml/configs/scallop-pilot.json`) + the **comparison analysis** (the
  `SCALLOP-PILOT`-marked block in `docs/ml-baselines.md`, upserted like the KGQA tier-3
  block — `train_baselines` preserves it across its rewrite). Run summary goes to the
  git-ignored `ml/artifacts/scallop-pilot/`; **no `ml/data` re-pin** (reads existing
  DVC data, writes no data).
- **The result today is `neutral` — and that's a valid US-003 outcome.** At the
  near-random corpus floor (PyKEEN MRR ≈ 0.007, Hits@1 = 0) rule guidance is within
  noise: the leakage-safe pair split scatters descent-chain links across train/test, so
  few held-out edges have a `train`-only ancestor path to propagate along. The rule
  also RAISES tier-2 descent-cycle/antisymmetry counts (it concentrates top-1
  predictions on descent chains) — a real tradeoff the symbolic check surfaces. Report
  it honestly; US-004's DeepProbLog run weighs against it.

## DeepProbLog feasibility + Scallop comparison — pilot US-004

`deepproblog_pilot.py` (pure core, lazy problog) + `train_deepproblog.py` (thin CLI,
console script `pinakes-deepproblog`) close the pilot with the DeepProbLog-vs-Scallop
go/no-go. Full write-up + recommendation: [`docs/neurosymbolic-pilot-report.md`](../docs/neurosymbolic-pilot-report.md).

- **`problog` is DECLARED → the feasibility run happens in CI, unlike `scallopy`.**
  DeepProbLog's inference backend *is* ProbLog (its neural ADs only swap a fact's fixed
  probability for a network output), so the ProbLog program the DeepProbLog model would
  compile runs here for real and the scale ceiling is *measured*, not asserted. The
  `deepproblog` package itself (the neural-AD training loop) is the undeclared/gated
  piece (`require_deepproblog_deps` + `# pragma: no cover`) — same stance as `scallopy`.
- **Measure per-QUERY, not batched.** DeepProbLog knowledge-compiles per training
  example, so `scale_probe` compiles each query on its own. Two gotchas that shaped this:
  (1) the bundled **`dsharp` d-DNNF compiler segfaults** (raises `DSharpError`) when many
  queries are batched into ONE compilation on this Linux host, and `pysdd` (the SDD
  alternative) is NOT installed — so batching conflates a real limit with a toolchain
  bug. `evaluate_program` wraps the call with a `SIGALRM` timeout + broad except so a
  crash/timeout is *recorded as a ceiling*, never fatal. (2) The **exact-inference
  hardness driver is proof multiplicity** (`count_paths` = distinct simple paths =
  circuit size), NOT grounding size (which stays compact) — a pure, deterministic,
  CI-testable metric. Today the `DESCENDS_FROM` graph is a sparse forest (≤3 proofs/query)
  so per-query inference is tractable; the binding constraint is throughput.
- **The headline is a measured architectural gap, not a task-quality one.** Scallop's
  full 40-epoch/880-query training = one batched min-max pass per epoch = **2.1 s**;
  DeepProbLog's per-example exact compilation extrapolates to **~50 min** (85 ms/query ×
  880 × 40) — ~1,400× — for the SAME neutral ranking. Semantics differ (ProbLog = exact
  noisy-or marginal, 0.79 on the two-path fixture; Scallop = widest-path max, 0.80),
  unit-tested against the real `problog` engine. Recommendation: **Scallop** for training;
  DeepProbLog for bounded exact queries only.
- **The report is a committed DOCUMENT, not a byte-gated snapshot** (timing is
  nondeterministic). The deterministic parts (proof counts, ground nodes, compiled
  counts, marginals) are asserted via the pure functions in `test_deepproblog_pilot.py`.
  The CLI upserts a `DEEPPROBLOG-PROBE`-marked table into the report (idempotent, like the
  SCALLOP-PILOT block) — that block is in `neurosymbolic-pilot-report.md`, NOT
  `ml-baselines.md`, so it never interacts with `train_baselines`' rewrite. Run summary →
  git-ignored `ml/artifacts/deepproblog/`; **no `ml/data` re-pin** (reads existing splits).

## Edit-ops SLM datasets + cinematography adherence eval (analyzer-bridge US-005)

Bridge 3: convert Analyzer's training exhaust (`filmstudio.bridge.dataset_export` JSONL)
into `ml/` datasets + a third adherence eval. Feeds the edit-ops SLM pilot
(`docs/edit-ops-slm-pilot-scope.md`). Same reproducible-artifact shape as `verbalize.py`
(pure core + thin CLI + committed manifest), with two hard rules unique to this bridge:

- **Everything is `personal` tier — the PRD's PRIVACY INVARIANT.** The Analyzer exhaust
  describes the user's own media. `edit_ops_dataset.py` stamps `tier: "personal"` on every
  record + the manifest; the real datasets land in DVC-tracked `ml/data/edit-ops/`
  (git-ignored), NEVER committed. The **committed manifest is built from a SYNTHETIC,
  hand-written exhaust fixture** (`ml/fixtures/analyzer-exhaust/`) so no personal data enters
  git or CI (AC4) — the snapshot test builds from that fixture, so there is NO
  personal-corpus live gate (contrast verbalize/triples, whose corpus is open). A test
  asserts every fixture `run_id` is a `run-synth-*` id.
- **The verbalize/triples exporters must EXCLUDE personal-tier edge types.** `DEPICTS`/
  `MENTIONS` (from `asset`, US-003) are personal — they must never be verbalized into the
  OPEN training corpus. verbalize already skips any edge type without a template (so they're
  never emitted); the coverage gate `test_every_exported_edge_type_has_a_template` now skips
  asset-touching edges (`_is_personal_tier_edge`) so it doesn't DEMAND a template for them.
  Any future open-corpus generator over edges needs the same personal-tier exclusion.

Specifics:
- `edit_ops_dataset.py` reads `nl-edit.jsonl` (+ `preferences.jsonl`). The **retry paper
  trail** (`attempts`, Analyzer US-NE4) is the gold: each attempt with `dry_run.passed==false`
  is a **rejection-sampled negative**; a failed attempt paired with the next PASSING attempt
  (or the row's accepted `ops`) is an **error→fix correction** pair. The top-level validated
  `ops` is the **accepted** SFT positive. One flat, uniform SFT record shape across all three
  kinds (`chosen`/`rejected` are JSON op-batch strings, "" when N/A) — HF-datasets-compatible.
- `cinematography_eval.py` is PURE + self-contained (stdlib only, like `consistency.py`): it
  does NOT import Analyzer's `filmstudio` — the constraint vocabulary is **vendored as data**
  (`CONSTRAINT_VOCAB`, a faithful mirror of `cinematography_rules.DEFAULT_RULES` + its pairwise
  tables) and emitted to `ml/cinematography/constraint-vocab.json` (corpus-independent,
  committed to git NOT `ml/data`, CI-gated byte-for-byte against the module — same discipline
  as `ml/scallop/program.scl`). `build_report` counts violations by `rule_id` + `severity`
  over a shot-list fixture (`ml/fixtures/cinematography/shots.json`); the ratchet baseline is
  `ml/manifests/cinematography-adherence-baseline.json`. `pinakes-eval-cinematography --check`
  is the retraining-free gate. If Analyzer's `cinematography_rules.py` gains a rule/table row,
  re-mirror it here + bump `CONSTRAINT_VOCAB_VERSION` and regenerate both artifacts.
- CLIs: `pinakes-export-edit-ops`, `pinakes-eval-cinematography`. Both default to the
  synthetic/committed fixtures; point `--export-dir`/`--shots` at real inputs locally. No
  `ml/data` re-pin unless you actually build the real (personal) edit-ops datasets.

## Prolog rule adherence — eval tier 4, the VESPACE port (insimul-bridge US-004)

Bridge 4: `rule_adherence.py` (pure) + `eval_rule_adherence.py` (thin CLI,
`pinakes-eval-rule-adherence`) score **generated Prolog rules against the world
they were authored for** — parse rate, structural/schema/referential validity,
charitable+strict reachability, fireability. Metric definitions, the upstream
module-by-module provenance table, and the deliberate deviations:
[`docs/rule-adherence-tier.md`](../docs/rule-adherence-tier.md).

- **PURE + stdlib-only, no Insimul import** — the same discipline as
  `consistency.py` and `cinematography_eval.py`. What crosses the bridge is the
  *metric definitions* (from `insimul-server/server/__tests__/vespace-rule-generation-e2e/`),
  reimplemented and cited. That includes a hand-rolled Prolog parser: the tier
  must run in the slim `ml/` env with zero engine, exactly like `scallop.py`'s
  engine-free reference derivations.
- **The world context comes from a `CanonicalWorldExport`, not a corpus.**
  Intrinsic keys = the export's `prologKb` **facts** (bodyless clauses — the
  character-creation layer); producible keys = the effect terms in each action's
  Prolog `content` (`action_accept/3` etc. bodies) lowered through the upstream
  effect table. So the same evaluator works on any converted world without a
  companion VESPACE corpus. **GOTCHA — the US-003 fixture world exports no
  actions** (`systems.actions: []`), so *every* action-derived condition in it is
  dead and it scores 0% schema validity. That is an honest floor over converted
  worlds, asserted as such in `test_the_bridge_world_scores_end_to_end`; don't
  "fix" it here — Insimul has to emit actions with Prolog `content`.
- **Two committed artifacts, both fixture-driven so CI needs no DVC corpus**:
  `ml/manifests/rule-adherence-baseline.json` (the snapshot/ratchet, `--check` is
  the gate) and the `RULE-ADHERENCE`-marked tier-4 block in
  `docs/ml-baselines.md`. That block is **co-owned** — `train_baselines` extracts
  and re-appends it across its from-scratch doc rewrite, the same cooperating-CLIs
  discipline as the `KGQA-EVAL` and `SCALLOP-PILOT` blocks. A fourth marked block
  means `train_baselines` now preserves three.
- The fixture pair is `ml/fixtures/insimul/{world-export,generated-rules}.json` —
  a VESPACE-salon-shaped world plus eight rules, one per scored dimension,
  carrying the **known-dead** `married/2` / `trusts/3` / `esteems/3` set that
  Insimul's validation-2 findings report as the residual after vocabulary
  grounding. The baseline is the assertion that they score as expected.
- **Don't double-count one mistake.** Atoms the structural checks own (literal
  actor labels, opaque effect payloads) and all arguments of engine predicates
  (wrapper heads + effect terms — no slot of `rule_effect(_, C, occupation,
  salonniere)` names an entity) are skipped by the referential walk. Engine
  predicates are also excluded from the condition set: an effect payload is not
  something a rule has to satisfy.
- **Upstream bug not ported**: `insimul-prolog-parser.ts`'s `parseGoal` strips a
  trailing `)` after removing `\+`, mangling `\+ flattered(Y)` — contradicting its
  own docstring. This port unwraps only a redundant *outer* paren pair. If you
  diff the two implementations, that difference is deliberate.
- No `ml/data` re-pin (fixture-driven, writes no data); MLflow run name
  `rule-adherence`.

## Insimul SLM datasets — rule-SFT + lore QA (insimul-bridge US-005)

Bridge 4's training feed: `insimul_datasets.py` (pure, stdlib-only) +
`export_insimul_datasets.py` (thin CLI, `pinakes-export-insimul`) turn converted
worlds into `rule-sft.jsonl` / `rule-preferences.jsonl` / `lore-qa.jsonl` under
the DVC-tracked `ml/data/insimul/`, with a committed manifest
(`ml/manifests/insimul-datasets-manifest.json`, `--check` is the ratchet). Full
contract: [`docs/insimul-datasets.md`](../docs/insimul-datasets.md).

- **`synthetic` tier / `proprietary` class on every record and the manifest** —
  the same shape as Bridge 3's personal-tier invariant, one axis over. The data
  is DVC-only, never git; `test_every_record_is_synthetic_tier_and_proprietary`
  is the gate. Any new generator over converted worlds inherits this.
- **The committed manifest is fixture-built, so CI needs no DVC corpus.**
  Defaults are the two committed fixture worlds — the Bridge-2 one at
  `core/tests/fixtures/insimul/world-export.json` and the
  VESPACE one at `ml/fixtures/insimul/world-export.json` — plus
  `ml/fixtures/insimul/rule-candidates.jsonl` (a hand-authored Insimul
  rejection-sampling export: 7 candidates over 3 `promptId` groups, each with a
  4-layer `validatorReport`). **Two worlds is the minimum** — a per-world
  held-out split needs somewhere to hold *out*.
- **GOTCHA — `build_world_graph` reimplements the Bridge-2 adapter's node/edge
  projection**, because `ml/` is a separate uv workspace and cannot import
  `culturescrape`. The drift gate is a committed cross-check fixture
  `ml/fixtures/insimul/bridge-graph.json`, generated *by the adapter*.
  **Regenerate it after ANY change to `acquire/insimul.py`:**
  ```sh
  cd core && uv run python -c "
  import json, pathlib
  from culturescrape.acquire.insimul import read_world_export, world_records, world_edges
  ex = read_world_export('tests/fixtures/insimul/world-export.json')
  nodes = sorted({r.fields['csid']: r.fields.get('name','') for r in world_records(ex) if 'csid' in r.fields}.items())
  edges = sorted((e[':START_ID'], e[':TYPE'], e[':END_ID']) for e in world_edges(ex))
  pathlib.Path('../../ml/fixtures/insimul/bridge-graph.json').write_text(json.dumps({
    '_note': 'Generated by the culture-scrape Bridge-2 adapter — the cross-check for pinakes_ml.insimul_datasets.build_world_graph. Regenerate with the command in ml/CLAUDE.md.',
    'worldId': ex.world_id,
    'nodes': [{'csid': c, 'name': n} for c, n in nodes],
    'edges': [{'head': h, 'relation': r, 'tail': t} for h, r, t in edges],
  }, indent=2, sort_keys=True, ensure_ascii=False) + '\n', encoding='utf-8')"
  ```
- **The declared accept/reject label always beats the evaluator's verdict.** A
  world's own shipped rules are accepted by construction even though today's
  action-less exports make them score dead keys; the tier-4 scorecard rides along
  as a diagnostic (`defects`/`fully_valid`). Do NOT "fix" the floor here.
- **A synthesized negative must be verified worse.** `corrupt_rule` plants one of
  five defects and the pair is kept only when `_defects(spoiled) - _defects(clean)`
  is non-empty; inert and inapplicable attempts are *counted* in the manifest, not
  silently dropped.
- **`kgqa.path_examples` is now parameterised** (`statements=`/`questions=`) —
  that is how the open-corpus generator runs over a synthetic world's relation
  vocabulary rather than being forked. A relation with no template emits no
  question, so each caller owns a coverage test over its own edge types.
- **The rule-derivation matcher decides nothing it cannot check.** Comparisons,
  cuts and `\+` goals abort a derivation instead of being assumed true, and a
  rule with no witness is reported (`rulesWithoutDerivation`). `world_facts`
  projects WorldIR (gender / surname / occupation / terrain / residence /
  ownership) alongside the export's `prologKb` — without that projection almost
  no real rule body is derivable.
- **The split groups by WORLD, not by subject entity** (contrast `kgqa.
  split_examples`). A world is a closed KB with its own rules; an entity-level
  split leaks its vocabulary into training. At least one world is always held
  out when there are ≥2, even at `eval_ratio=0`.
- No `ml/data` re-pin for the fixture build (it writes to `ml/data/insimul/` but
  the committed artifact is the manifest); MLflow run name `insimul-datasets`.

## SLM pilot — the frozen eval protocol (slm-pilot US-001)

Phase D's referee: `slm_pilot.py` (pure) + `export_slm_eval.py` (thin CLI,
`pinakes-export-slm-eval`) freeze the eval set, the metric list, the comparison
points and the volume floors BEFORE any training run. Prose half + the success bar:
[`docs/slm-pilot-protocol.md`](../docs/slm-pilot-protocol.md).

- **The protocol is in the MANIFEST, not only the prose.** `metrics`,
  `comparisonPoints`, `ablation` and `dataFloor` ride in
  `ml/manifests/slm-pilot-eval-manifest.json`, which is snapshot-gated against a
  fresh fixture build — so US-003 changing the headline metrics is a visible diff on
  a gated file. `--check` is the freeze gate.
- **The eval set is the held-out worlds' rule prompts, deduped by `prompt_id`.**
  Corruption negatives share their accepted parent's `prompt_id`, so grouping by it
  gives one row per distinct *prompt*; the accepted record (sorted first) supplies
  `reference_completion`, the only reference-based metric's (`evalLoss`) target.
- **Both prompt arms are frozen up front.** `strip_grounding_block` derives the
  US-003 ablation's ungrounded arm from the grounded one (drop the three vocabulary
  listing lines, swap "listed above" for "Insimul's standard Prolog rule
  vocabulary") — idempotent, unit-tested against `build_rule_prompt`. If
  `build_rule_prompt`'s wording changes, `GROUNDING_LINE_PREFIXES` must change with
  it or the ablation silently stops stripping anything.
- **`check_floors` is the `insufficient-data` gate, and it is a FIELD, not a
  judgment call.** Today's fixture corpus is below every floor (7 train SFT records
  vs 500; 2 eval prompts vs 100), so `dataFloor.verdict == "insufficient-data"`.
  US-006 reads that field; it does not re-derive it. A missing volume key counts as
  0 so a rename fails the gate loudly instead of passing it.
- **A shortfall is exit 0, not an error** — the artifacts are still written and the
  verdict is recorded. The CLI prints a NOTE; the pipeline stories still run, because
  a pipeline is proven by completing the loop, not by its scores.
- Fixture-driven (the same two worlds as `pinakes-export-insimul`), so the committed
  manifest needs no DVC corpus; the eval JSONL lands in the DVC-tracked
  `ml/data/slm-pilot/` tree — **no re-pin for a fixture build**, same stance as the
  Insimul datasets. MLflow run name `slm-pilot-eval`.

## SLM pilot — the QLoRA training pipeline (slm-pilot US-002)

`slm_finetune.py` (pure core + lazy heavy imports) + `train_slm.py` (thin CLI,
`pinakes-train-slm`) are Phase D's workflow backbone: rule-SFT corpus → QLoRA
fine-tune → **tier-4 adherence** on the frozen eval set, both prompt arms, driven
by a committed JSON config. Runbook: [`docs/slm-pilot-runbook.md`](../docs/slm-pilot-runbook.md).

- **The QLoRA plumbing is REUSED from `finetune.py`, not reforked.**
  `require_finetune_deps` / `resolve_device` / `_lora_config` / `_load_tokenizer` /
  `_load_base_model` duck-type on any config exposing the same LoRA fields, which
  `SlmPilotConfig` does. What differs is the task: tier-4 rule adherence
  (`rule_adherence.evaluate_rule`) instead of tier-3 QA, and the US-001 **frozen**
  eval set instead of the KGQA split. If you touch the trl/peft call sites, touch
  them in `finetune.py` — both pipelines ride on them.
- **The datasets are rebuilt IN PROCESS, never read from `ml/data/`.** Same
  `build_datasets` + `build_eval_set`, same seed and per-world split as
  `pinakes-export-slm-eval` — so the run *reproduces* the frozen eval set and
  records `evalSetSha256` + `matchesFrozenEvalSet` against the committed manifest
  (the protocol's "a run that cannot name the eval set it scored is not a
  comparison point"). Consequence: a debug run works in a fresh worktree with **no
  `dvc pull`**, and it writes no data, so there is **no `ml/data` re-pin**.
- **The training seam is injectable, which is what makes the CI smoke real.**
  `run_pipeline(..., trainer=, model_factory=)` — pass `stub_trainer` +
  `stub_model_factory` (or the CLI's `--stub`) and the *identical* code path runs
  end to end with no model, no network and no undeclared dep. A stub run stamps
  `training.stub = true` and the CLI shouts, because its scores describe wiring.
- **ChatML is rendered PURELY, not by the tokenizer** (`render_chatml` /
  `format_inference_prompt`), so the exact prompt string is unit-testable in the
  slim env and is US-004's template contract. `format_training_text` is the
  inference prompt plus the assistant turn — a test asserts that identity, so
  training and inference cannot drift. A real run calls `chat_template_matches`
  and records `chatTemplateVerified` (`true` for Qwen2.5-Instruct). The system
  prompt says nothing about the world vocabulary — the grounding lives in the user
  turn, which is exactly what the ablation strips.
- **`extract_rule` refuses to coerce prose into a clause.** Fences and preamble are
  stripped and the clause is taken to its terminating period; a generation with no
  clause returns `""` and scores as a parse failure. Without this, `"I cannot
  help."` *parses* (the tier-4 parser accepts it as a one-atom clause) and a
  refusal would be scored as a well-formed rule.
- **No committed metrics snapshot, no `--check` gate** — same stance as the
  Phase-5 QLoRA pipeline and for the measured reason: two identical MPS
  invocations of the debug run produced different adherence rates. Committed
  artifacts are the config (`ml/configs/slm-pilot-*.json`), the runbook and the
  tests. The adapter + `run-summary.json` go to git-ignored `ml/artifacts/`; the
  *deliverable* model (US-004/005 GGUF bundle) is what earns a DVC pin.
- **Scores at the current corpus scale are not results.** 3 training records / 2
  eval prompts — `dataFloor.verdict == "insufficient-data"`. US-002's deliverable
  is that the loop closes, and it does (0.5B on MPS, ~6 s of training).

## SLM pilot — the 3B baseline + comparison table (slm-pilot US-003)

`slm_baseline.py` (pure, plus the networked `GeminiRuleModel`) turns N runs of the
US-002 pipeline into the pilot's **comparison table**: mean/min/max per stage, arm
and frozen metric, the ablation gap, the success bar's arithmetic, and the
`SLM-PILOT` block upserted into `docs/ml-baselines.md`. Config
`ml/configs/slm-pilot-3b.json`; runbook [`docs/slm-pilot-runbook.md`](../docs/slm-pilot-runbook.md).

- **Every number is a mean over repeats, never a single draw.** `config.repeats`
  reruns the whole train+score loop at the SAME seed; `bar.spreadAcrossRepeats` is
  the honesty check the doc block states in words ("any effect smaller than this
  is the platform"). The measured outcome at 3B: all three repeats gave
  *identical* rates and `evalLoss` moved only in the fourth decimal — so the
  US-002 0.5B nondeterminism is **not** universal, which is exactly the kind of
  thing you only learn by running the repeats.
- **A frozen comparison point is never dropped, only explained.**
  `build_comparison_table` emits one row per `slm_pilot.COMPARISON_POINTS` entry
  in that order; an unfillable row carries `status: "not-measured"` plus a reason
  (`NOT_MEASURED_REASONS`). Today both `deterministic-translator-floor` (absent
  from the Insimul checkout) and `grounded-gemini` (no API key) are unfilled —
  and because the primary bar is *a fraction of the untuned→Gemini gap*,
  `gap_closure` returns `None` rather than estimating it.
- **`dataFloor` is copied verbatim from the frozen manifest** (`read_data_floor`),
  never re-derived, and `bar_inputs` deliberately emits no verdict — the verdict
  is US-006's and it is gated on that field.
- **GOTCHA — release each stage's weights before loading the next.**
  `release_model` / `free_device_memory` in `slm_finetune.py`: the pipeline loads
  one model per stage (untuned → trainer → tuned) and each stays referenced by its
  frame until the call returns. Three fp32 3B copies are ~37 GB and do not fit in
  36 GB of unified memory; at 0.5B nobody noticed.
- **`docs/ml-baselines.md` is co-owned by FIVE CLIs now.** `train_baselines`
  rewrites the doc and re-appends `KGQA-EVAL`, `SCALLOP-PILOT`, `RULE-ADHERENCE`
  and `SLM-PILOT`. A sixth marked block must join that preserve list or a
  baselines re-run deletes it. A `--stub` run never writes the doc.
- No `ml/data` re-pin (the pipeline reads DVC-tracked trees and writes none);
  adapters + `baseline-report.json` stay in git-ignored `ml/artifacts/`; three
  MLflow runs per baseline, each naming the eval set it scored.

## SLM pilot — the GGUF deployment leg + prompt contract (slm-pilot US-004)

`slm_gguf.py` (pure core + lazy heavy imports) + `export_gguf.py` (thin CLI,
`pinakes-export-gguf`) close Phase D's deployment question: merge the US-003
adapter, convert to GGUF, quantize to **Q4_K_M** (Insimul's deployed quant), and
re-score the result with the tier-4 harness on the *same* frozen eval set.
Runbook: [`docs/slm-pilot-runbook.md`](../docs/slm-pilot-runbook.md) §US-004.
Interface: [`docs/slm-prompt-contract.md`](../docs/slm-prompt-contract.md).

- **The parity check holds everything but the runtime constant, and enforces it.**
  Same `RuleModel` seam, same `format_inference_prompt` string, greedy decoding on
  both sides, same tier-4 scorer — and the CLI **hard-fails** when the HF run
  summary's `evalSetSha256` differs from the eval set it rebuilt in process. Two
  columns on two eval sets is not a parity check.
- **The acceptability threshold was frozen by US-001, not chosen here.**
  `QUANT_BUDGET_METRIC`/`QUANT_BUDGET_PP`/`QUANT_BUDGET_ARM` mirror
  `docs/slm-pilot-protocol.md` §5 bar 3 (`fullyValid`, grounded arm, ≤ 2pp), and a
  test asserts the doc still states them. A missing column yields
  `not-measured`, never a pass.
- **The prompt contract is GENERATED from the pipeline's renderers, never
  transcribed.** `build_prompt_contract()` evaluates `format_inference_prompt` /
  `format_training_text` on a placeholder; `ml/manifests/slm-prompt-contract.json`
  is the committed snapshot and the pytest gate is a *real* CI gate (pure — no
  fixtures, no corpus, no llama.cpp). A diff there means the deployed prompt no
  longer matches the measured one ⇒ **bump `CONTRACT_VERSION`; it breaks Insimul**.
- **`ml/models` is its own DVC pointer (`ml/models.dvc`).** The deliverable GGUF is
  the first model artifact in the repo to earn a pin — but it must NOT go into
  `ml/data`, whose md5 the frozen protocol cites as the eval set's tree. Re-pin
  with `uv run --project ml dvc add ml/models && dvc push` after a conversion; the
  merged fp16 weights and the f16 GGUF stay in git-ignored `ml/artifacts/`.
- **GOTCHA — `sentencepiece` is required to convert a Qwen2 checkpoint** even
  though Qwen2 is BPE: `Qwen2Model.set_vocab` tries `_set_vocab_sentencepiece()`
  first and falls back to `_set_vocab_gpt2()` only on `FileNotFoundError`, so a
  missing module raises `ImportError` straight through the handler. Install it with
  `gguf`/`llama-cpp-python`; all three are undeclared (`uv pip install`), same
  stance as `trl`/`peft`.
- **GOTCHA — build only the `llama-quantize` cmake target.** `brew install
  llama.cpp` needs write access to `/opt/homebrew` that a locked-down machine will
  not have, and a full source build is minutes of compiling nobody needs.
- **`--contract-only` / `--dry-run` are the model-free smokes** (the role `--stub`
  plays for `pinakes-train-slm`) and `--check` is the contract freeze gate. The
  `SLM-QUANT` block is upserted into `docs/slm-pilot-report.md`, **not**
  `docs/ml-baselines.md` — so it stays outside `train_baselines`' five-block
  preserve list and US-006 writes its verdict around it.
- **No repeat machinery on this column, and that is measured:** two independent
  `--skip-convert` runs gave identical rates *and* identical `evalLoss` to six
  decimals. Greedy inference over a fixed GGUF is reproducible where the MPS
  training path was not.

## SLM pilot — the Insimul handoff bundle (slm-pilot US-005)

`slm_handoff.py` (pure) + `export_handoff.py` (thin CLI, `pinakes-export-handoff`)
close Phase D: they turn US-004's GGUF into a **self-describing bundle** —
`model-manifest.json`, `prompt-contract.json`, the frozen `rule-eval.jsonl` and
`LICENSE-NOTES.md`, all written **beside** the model in `ml/models/slm-pilot/` so
one `dvc pull ml/models` hands the recipient everything. Wiring instructions:
[`docs/slm-insimul-runbook.md`](../docs/slm-insimul-runbook.md).

- **This story assembles; it does not measure.** Every score in the manifest is
  copied from the US-003 baseline report and the US-004 parity report, and
  `dataFloor` rides along verbatim. Adding a new number here would be a
  measurement nobody's protocol authorized.
- **The bundle root IS `ml/models/slm-pilot`, not a sibling directory** — the
  1.9 GB binary is never copied twice, and the DVC pointer is the one US-004
  already created. Re-pin with `uv run --project ml dvc add ml/models && dvc push`
  after every rebuild; the manifest, the `SLM-HANDOFF` doc block and
  `ml/models.dvc` move together.
- **GOTCHA — the manifest cannot record its own tree's DVC md5.** It lives inside
  `ml/models`, so writing it changes the hash it would be claiming. Only
  `ml/data`'s md5 is recorded (the bundle is not in that tree); the authoritative
  models pin is the committed `ml/models.dvc`. Same circularity `train_baselines`
  avoids by keeping `ml/data`'s md5 out of the baselines doc.
- **`--check` has two tiers and the first one runs in CI.** It rebuilds the frozen
  eval set from the committed fixtures and compares it to the manifest's
  `evalSetSha256` (no DVC, no GGUF, no undeclared dep) — that is the gate for "the
  bundle's scores describe an eval set this repo no longer produces". Only when
  `ml/models` is materialised does it re-hash the files. `verify_bundle` is the
  pure half and is what the recipient effectively runs.
- **The eval set is REBUILT in process, never copied from `ml/data`** — same
  discipline as the training pipeline, and why the CLI works in a fresh worktree.
  The CLI also **hard-fails** when the parity report names a different
  `evalSetSha256` than the build reproduces.
- **Nothing machine-local ships.** `_config_summary` drops `output_dir` and
  relativises the resolved path fields against the `ml/` root; a test asserts no
  `/Users/` string survives into the manifest or the generated prose.
- **The license position is recorded, not inferred, and it is a finding.**
  `Qwen/Qwen2.5-3B-Instruct` is `license: other` / `license_name: qwen-research`
  — the **Qwen Research License, non-commercial** — and the fine-tuned GGUF
  inherits it. Most of the Qwen2.5 family is Apache-2.0; 3B and 72B are the
  exceptions (`Qwen2.5-1.5B-Instruct` is Apache-2.0, verified 2026-07-22). US-006
  owns what to do about it.
- **`RUNTIME_GAPS` is data, cited by file and symbol**, because the runbook's
  claims about Insimul's code must not drift from the doc block's. The one that
  voids every measured number is `chat-wrapper-rebuilds-the-prompt`:
  `LocalAIProvider.generate` concatenates the system prompt onto the user prompt
  and re-renders it through node-llama-cpp's chat wrapper, so the contract's exact
  string is not what reaches the model today.
- The `SLM-HANDOFF` block lives in `docs/slm-insimul-runbook.md`, outside
  `train_baselines`' preserve list — same reasoning as `SLM-QUANT`. No `ml/data`
  re-pin; MLflow run name `slm-handoff`.

## Edit-ops SLM pilot — the frozen eval protocol (edit-ops-slm-pilot US-001)

Bridge 3's referee and a structural clone of `slm_pilot.py`: `edit_ops_pilot.py`
(pure) + `export_edit_ops_eval.py` (thin CLI, `pinakes-export-edit-ops-eval`)
freeze the eval set, the metric list **and its oracles**, the comparison points,
the three prompt arms, the success bar and the volume floors BEFORE any training
run. Prose half: [`docs/edit-ops-slm-protocol.md`](../docs/edit-ops-slm-protocol.md).

- **The op vocabulary is VENDORED as data, never imported.** `OP_VOCAB` mirrors
  Analyzer's `filmstudio.edit_ops.op_vocabulary()`; `ml/edit-ops/op-vocab.json` is the
  committed, CI-gated rendering (same discipline as `ml/cinematography/
  constraint-vocab.json`). Re-mirror + bump `OP_VOCAB_VERSION` after any Analyzer op
  change, and regenerate. Dump the upstream table with:
  ```sh
  cd ~/Development/analyzer && uv run python -c "
  import json, filmstudio.agents          # import agents FIRST — see the gotcha below
  from filmstudio.edit_ops import op_vocabulary
  print(json.dumps(op_vocabulary(), indent=1, sort_keys=True))"
  ```
- **GOTCHA — `import filmstudio.edit_ops` alone raises a circular ImportError**
  (`edit_ops` → `agents.skill_json_edl_export` → `agents/__init__` →
  `skill_nl_edit` → `edit_ops`, partially initialised). Importing
  `filmstudio.agents` first resolves it. Upstream quirk, not ours.
- **Every metric names its ORACLE** (`METRIC_ORACLES`): `offline` (implemented
  here, runs in the slim env), `analyzer-apply-ops` / `analyzer-render-check` (Analyzer's
  deterministic gates, need the checkout), `reference`. The offline tier is
  *executable* (`score_case`/`aggregate_scores`), and the Analyzer tiers are
  deliberately ABSENT from its result dict — a placeholder would let a run report a
  dry-run rate it never measured.
- **`schemaValid` is NOT `dryRunPass`.** The offline checks are the pure slice of
  what `apply_ops` enforces (unknown ops, missing/mistyped/unknown params,
  unresolvable refs); `apply_ops` also rejects semantically impossible edits. Don't
  present one as the other.
- **Unknown is never a pass.** `BatchVerdict.refs_grounded` is `None` (not `False`)
  when the case has no usable timeline, and `aggregate_scores` omits a metric no
  case defines rather than emitting 0.0.
- **The exhaust records NO EDL** — `dataset_export._nl_edit_records` emits input
  paths, a clip *count* and the version. So exhaust-derived cases carry a
  `reconstructed: true` timeline, `has_timeline: false`, and the Analyzer oracles
  cannot score them. A producer-side gap, recorded in the protocol doc §3; don't
  "fix" it by pretending the reconstruction is a timeline.
- **The three prompt arms are built from PARTS, not stripped after the fact**
  (contrast `slm_pilot.strip_grounding_block`, which had to reverse another
  module's renderer): `grounded` / `no-vocab` (ops menu removed) / `no-grounding`
  (Inputs+Timeline tables removed). `build_edit_prompt` raises on an unknown arm.
- **The eval set is PERSONAL tier by contagion** — the hand-written stratum is
  synthetic, the exhaust stratum is personal, and the assembled set inherits the
  more restrictive label. DVC only, never git; a real (non-fixture) manifest also
  stays out of git because it names run ids.
- **The hand-written stratum is the coverage guarantee**: one case per op in
  `OP_SPECS` + six labelled refusal cases, all against one committed synthetic
  timeline. Its 12 reference batches were verified to dry-run clean through Analyzer's
  real `apply_ops` (the fixture needed a non-empty `outputs` list — `validate_edl`
  requires one — which is exactly the kind of thing only the real oracle tells you).
- **A malformed reference is FLAGGED, not patched.** `reference_schema_valid` rides
  on every case and `evalSet.referenceDefects` names the offenders; today that is
  the analyzer-bridge exhaust fixture's `trim_clip`-with-`in` row (declared: `in_point`).
- Fixture-driven, so the committed manifest needs no DVC corpus; the eval JSONL
  lands in the DVC-tracked `ml/data/edit-ops-pilot/` tree — **no re-pin for a
  fixture build** (and do NOT `dvc add ml/data` in a worktree where the tree was
  never pulled: you would pin a directory containing only the new file). MLflow run
  name `edit-ops-pilot-eval`.

## Edit-ops SLM pilot — the QLoRA training pipeline (edit-ops-slm-pilot US-002)

`edit_ops_finetune.py` (pure core + lazy heavy imports) + `train_edit_ops.py` (thin
CLI, `pinakes-train-edit-ops`) are Bridge 3's workflow backbone: edit-ops SFT corpus →
QLoRA fine-tune → the US-001 **offline referee** on the frozen eval set, all three
prompt arms, driven by a committed JSON config. Runbook:
[`docs/edit-ops-slm-runbook.md`](../docs/edit-ops-slm-runbook.md).

- **A structural clone of `slm_finetune.py`, and it REUSES rather than reforks.** The
  QLoRA plumbing comes from `finetune.py` (duck-typed on the config's LoRA fields) and
  `render_chatml` / `release_model` / `free_device_memory` come from `slm_finetune.py`
  — touch a trl/peft call site once and all three pipelines move. What differs is the
  referee (`edit_ops_pilot.score_case`, not the tier-4 rule scorer) and that there are
  **three** arms, not two.
- **The corpus + eval set are rebuilt IN PROCESS, never read from `ml/data/`** — same
  builder, seed and split as `pinakes-export-edit-ops-eval`, so the run *reproduces*
  the frozen eval set and records `evalSetSha256` + `matchesFrozenEvalSet`. A debug run
  therefore works in a fresh worktree with **no `dvc pull`**, writes no data, and needs
  **no `ml/data` re-pin**.
- **The Analyzer-oracle metrics are ABSENT from every score block, not zero.**
  `OFFLINE_METRICS` is derived from `METRIC_ORACLES`, and the summary carries a
  `metricsNotComputable` map naming `dryRunPass`/`renderCheckPass` and their oracles.
  A test asserts they never appear. Same rule as US-001: unknown is never a pass.
- **The training seam is injectable, which is what makes the CI smoke real.**
  `run_pipeline(..., trainer=, model_factory=)` — pass `stub_trainer` +
  `stub_model_factory` (or `--stub`) and the identical path runs with no model, no
  network, no undeclared dep. A stub run stamps `training.stub = true`.
- **The training target is the eval's surface form.** `render_completion` emits the
  canonicalised batch inside a ```json fence — what `extract_batch` parses first and
  what `exactBatchMatch` rewards. `load_grounding` re-reads the exhaust so a training
  prompt renders the same (reconstructed) tables an exhaust eval case does;
  `SftExample` alone carries only a clip count.
- **GOTCHA — `opNameValidity` gates `paramSchemaValidity` and `refGrounding`.**
  `validate_batch` skips the param/ref checks for an op it cannot resolve, so a batch
  of hallucinated ops scores 1.0 on both *vacuously* (visible in the `no-vocab` arm).
  `schemaValid`, the conjunction, is the honest headline; the components are
  diagnostics. Documented, not changed — the referee is frozen mid-pilot.
- **GOTCHA — Analyzer's `apply_ops` silently ignores UNKNOWN PARAMS.** It rejects unknown
  op names and unresolvable refs, but `trim_clip` with `in` (declared: `in_point`)
  applies cleanly, changes nothing and warns about nothing. So `dryRunPass` ⊅
  `paramSchemaValidity`: a batch can pass Analyzer's own gate while doing nothing that was
  asked. Measured 2026-07-22; the upstream fix is an Analyzer-side story, named not drafted.
- **The SFT builder cannot teach a refusal.** `edit_ops_dataset._sft_from_row` emits an
  `accepted` example only for a non-empty `ops`, so a row where Analyzer itself refused
  contributes no positive — and `refusalCorrectness` measured 0.000 at every stage and
  arm. A dataset-builder gap (analyzer-bridge US-005's frozen builder), not a model failure.
- **No committed metrics snapshot, no `--check` gate** — same stance as the two other
  QLoRA pipelines, and for the measured reason: across three draws at the same seed the
  untuned pass and `schemaValid` were identical, but `trainLoss`, `evalLoss` and
  `paramSchemaValidity` moved (the last by one case, 5.3pp — the resolution floor at
  n = 19). MPS *training* is the nondeterministic part. Committed: the config, the
  runbook, the tests. The adapter and `run-summary.json` go to git-ignored
  `ml/artifacts/`.
- **Scores at the current corpus scale are not results.** 1 training record / 19 eval
  cases — `dataFloor.verdict == "insufficient-data"`. US-002's deliverable is that the
  loop closes, and it does (0.5B on MPS, 191 s end to end, 4.1 s of training). MLflow
  run name `edit-ops-pilot-debug`.

## Edit-ops SLM pilot — the 3B baseline + the Analyzer-oracle tier (US-003)

`edit_ops_baseline.py` (pure, plus two subprocess bridges) turns N runs of the US-002
pipeline into the pilot's **comparison table** — and, unlike its Insimul sibling, it
fills the metrics the offline referee cannot answer. Config
`ml/configs/edit-ops-pilot-3b.json`; CLI `pinakes-train-edit-ops --report`; runbook
[`docs/edit-ops-slm-runbook.md`](../docs/edit-ops-slm-runbook.md) §US-003.

- **Analyzer crosses as a SUBPROCESS here, not an import.** `argos_dry_run` and
  `deterministic_floor_replies` write JSON into a temp file, run `uv run python -c
  <script>` with `cwd=<analyzer checkout>`, and read JSON back. That is how `dryRunPass`
  (the primary bar's metric) and the regex-tier floor get measured from `ml/`, whose
  venv has no `filmstudio`. Both scripts import `filmstudio.agents` FIRST — the
  `edit_ops` circular-import gotcha. Absent `--analyzer-dir`, both rows are
  `not-measured` **with a reason**; the metric never becomes a zero.
- **`dryRunPass`'s scoring convention was defined in US-003, not US-001** (which froze
  the metric and named its oracle but could not run it), so it is stated in
  `DRY_RUN_SCOPE` and printed into the doc block: dry-run-computable cases only
  (the exhaust records no EDL), refusal cases excluded (their right answer is the empty
  batch, which `apply_ops` rejects outright), a reply with no batch scores **False**,
  and the **raw** extracted ops are sent — not our canonicalised copy — so the number
  answers "would Analyzer's own gate have accepted this reply".
- **The oracle needs the raw replies, so the pipeline now records them.**
  `EditOpsPilotConfig.record_generations` (default on, `PIPELINE_VERSION = 2`) puts a
  `generations` block and `dataset.caseIds` in the run summary; `generations_by_case`
  keys replies by case id and returns `{}` on a length mismatch rather than a silently
  misaligned map. Scores are aggregates and cannot be un-aggregated back into batches.
- **A non-model comparison point is replayed through the IDENTICAL referee.**
  `ReplayModel`/`score_replies` feed the deterministic tier's batches through
  `score_cases`, so the floor row is measured by this harness rather than quoted from
  Analyzer's. The tier reads the instruction + EDL and never a prompt, so its row is
  recorded once, under the grounded arm.
- **Reuse, don't refork:** `slm_baseline.aggregate_repeats`/`aggregate_single` now take
  `metrics=`/`count_key=` and its `extract/upsert_marked_section` take the marks as
  parameters, so this module supplies its own frozen metric list and `EDIT-OPS-PILOT`
  marks instead of copying 200 lines. Defaults are unchanged for the Insimul pilot.
- **`docs/ml-baselines.md` is co-owned by SIX CLIs now** — `train_baselines` re-appends
  `KGQA-EVAL`, `SCALLOP-PILOT`, `RULE-ADHERENCE`, `SLM-PILOT` and now `EDIT-OPS-PILOT`.
  A seventh marked block must join that preserve list or a baselines re-run deletes it.
- **`--report` refuses to render a run whose `comparisonPoint` is not the 3B row**
  (`COMPARISON_SOURCES_INVERSE`): the stage→row map is the 3B baseline's, and the 0.5B
  run joins the table through `--debug-summary` as its own row (with a hard eval-set
  sha256 check — two columns on two eval sets is not a comparison).
- **`--from-summaries` re-renders the table from run summaries already on disk.** The
  table is cheap; the run is not. Use it to re-render after a doc-text change.
- No committed metrics snapshot and no `--check` gate (same stance as every other QLoRA
  pipeline here); the committed artifacts are the config, the runbook, the doc block
  and the tests. `baseline-report.json` + adapters stay in git-ignored `ml/artifacts/`.
- **Measured (3 repeats, MPS, 1,575 s, $0.00): the fine-tune is a NO-OP on the
  referee.** Every grounded-arm rate is identical untuned vs tuned (`schemaValid` 0.947,
  `dryRunPass` 1.000, `normalizedBatchMatch` 0.538); only `evalLoss` moved (0.645 →
  0.315), so the "tuning-did-something" bar reads **+0.0pp** and is not met. The coverage
  bar IS met (1.000 vs the regex floor's 0.083 = +1,100%) — *by the untuned model too*,
  so it grades Qwen2.5-3B + the prompt, not the tuning. The ablation contradicts the
  protocol's expectation on its vocabulary half: removing the op menu costs more
  (`schemaValid` −0.211, `opNameValidity` −0.158) than removing the timeline (−0.053),
  while `refGrounding` moves only for `no-grounding` (−0.143) — so the timeline half is
  confirmed and Analyzer must keep sending both blocks. 3B beats 0.5B by +57.9pp
  `schemaValid` for 2.5× wall clock. `dataFloor.verdict` is still `insufficient-data`;
  at 19 cases one case is 0.053 and one refusal case is 0.167 — the resolution floor.

## Edit-ops SLM pilot — the Ollama deployment leg + prompt contract (US-004)

`edit_ops_gguf.py` (pure core + a lazy HTTP client) + `export_edit_ops_gguf.py` (thin
CLI, `pinakes-export-edit-ops-gguf`) close Phase E's deployment question: merge the
US-003 adapter, convert to GGUF, quantize, register it with **Ollama** via a generated
`Modelfile`, and re-score it with the US-001 referee on the *same* frozen eval set.
Interface: [`docs/edit-ops-prompt-contract.md`](../docs/edit-ops-prompt-contract.md).
Results block: [`docs/edit-ops-slm-pilot-report.md`](../docs/edit-ops-slm-pilot-report.md).
Runbook: [`docs/edit-ops-slm-runbook.md`](../docs/edit-ops-slm-runbook.md) §US-004.

- **Ollama, not llama.cpp-in-process** (contrast `slm_gguf.py`, the Insimul sibling):
  Analyzer's `model_client` resolves `ollama/<model>` ids, so this is the runtime the
  model will actually live in and scoring anywhere else would grade a deployment
  nobody makes. The conversion half is **reused** from `slm_gguf` (`build_plan` /
  `convert_command` / `quantize_command` / `file_identity` / `merge_adapter` are
  runtime-agnostic; `parity_deltas` gained a `metrics=` parameter for this). What is
  new is everything downstream of the `.gguf`.
- **The parity column is scored through `raw: true`.** `OllamaEditModel.generate`
  POSTs `format_inference_prompt(...)` verbatim to `/api/generate`, bypassing
  server-side templating, so the served model sees the *same bytes* the HF column did.
  Analyzer will use the chat path instead — so the `Modelfile` `TEMPLATE` renders the
  identical string from `(.System, .Prompt)` and `render_template_probe` + a test
  assert that equality. Never trust an eyeballed Go template.
- **The budget is READ from `edit_ops_pilot.SUCCESS_BAR["quantBudget"]`, not restated**
  (contrast `slm_gguf.QUANT_BUDGET_PP`, which is a copy). One source of truth; a test
  also asserts the prose protocol still states the same number.
- **`escalation()` mechanises "record a Q8 comparison if degradation is material".**
  Material == the frozen bar was missed; an *unmeasured* budget escalates too. The
  second column reuses the merge and the f16 GGUF the first pass produced.
- **`budget_resolution()` is the honesty check the numbers needed.** A rate over *n*
  cases moves in steps of `100/n`, so at n = 19 the smallest non-zero degradation is
  5.3pp — already over the frozen ≤2pp bar. Without that field, `over-budget` reads as
  a measured five-point regression instead of "one case flipped".
- **`cross_quant_agreement()` is why two quants beat one.** Q8_0 is near-lossless
  relative to Q4_K_M; if both lose the *same* ground against fp32, the gap is not a
  precision effect. Measured: both −5.3pp on `schemaValid`, so it is the runtime/
  resolution, not the quant. `dryRunPass` is the only metric that separates them
  (Q8 1.000 = fp32 parity, Q4 0.917) — and it is Analyzer's own gate, so **Q8_0 is the
  one to deploy** on this evidence.
- **`evalLoss` is ABSENT from the served column, never borrowed.** Ollama's generate
  API exposes no logprobs; `OLLAMA_UNCOMPUTABLE` names the metric and the reason and
  the doc block prints it. Same rule as the `analyzer-*` oracles in US-002.
- **`--analyzer-dir` folds `dryRunPass` into BOTH columns — and the HF side must be
  merged BEFORE the served columns are built**, because every delta is computed
  against that dict. Merging it afterwards silently produced `—` deltas for the one
  metric Analyzer actually enforces.
- **`--contract-only` / `--dry-run` are the model-free smokes** and `--check` is the
  contract freeze gate (pure — no GGUF, no Ollama, no undeclared dep). The
  `EDIT-OPS-QUANT` block goes into `docs/edit-ops-slm-pilot-report.md`, **not**
  `docs/ml-baselines.md`, so it stays outside `train_baselines`' preserve list and
  US-006 writes its verdict around it.
- **The GGUF lands in `ml/models/edit-ops-pilot/` (git-ignored, under the existing
  `ml/models.dvc` pointer) — but do NOT `dvc add ml/models` in a Chief worktree.**
  Same trap as `ml/data`: the slm-pilot bundle that pointer describes is not
  materialised here, so a re-pin would replace it with a tree containing only the
  edit-ops files. Re-pin from a full checkout with `uv run --project ml dvc add
  ml/models && dvc push`.
- **Reproducible where the training path was not:** two independent `--skip-convert`
  runs produced identical rates on every arm and every metric. Greedy inference over a
  fixed GGUF does not have MPS training's nondeterminism. MLflow run name
  `edit-ops-pilot-quant-parity`.

## Edit-ops SLM pilot — the Analyzer handoff bundle (US-005)

`edit_ops_handoff.py` (pure, plus one read-only subprocess probe) +
`export_edit_ops_handoff.py` (thin CLI, `pinakes-export-edit-ops-handoff`) close
Phase E: they turn US-004's two GGUFs into a **self-describing bundle** —
`model-manifest.json`, `prompt-contract.json`, the frozen `edit-ops-eval.jsonl` and
`LICENSE-NOTES.md`, written **beside** the models in `ml/models/edit-ops-pilot/` so
one `dvc pull ml/models` hands the recipient everything. Wiring instructions:
[`docs/edit-ops-slm-analyzer-runbook.md`](../docs/edit-ops-slm-analyzer-runbook.md).

- **This story assembles; it does not measure.** Every score in the manifest is
  copied from the US-003 baseline report and the US-004 parity report, and
  `dataFloor` rides along verbatim. The ONE thing it measures is the prompt gap
  (below), which is about Analyzer, not about the model.
- **The bundle carries BOTH quantizations and their Modelfiles**, and
  `verify_bundle` hashes all four — a rewritten Modelfile silently changes the
  TEMPLATE and the decoding parameters every score assumes, so it is exactly as
  fatal as a rewritten GGUF. Contrast `slm_handoff`, whose manifest has a single
  `model`; the per-entry check loop is shared (`slm_handoff.verify_entries`) and
  `config_summary` is now parameterised on its path keys rather than forked.
- **The deploy quant is DERIVED, not typed.** `recommend_deploy` picks the highest
  `dryRunPass` on the grounded arm — Analyzer's own `apply_ops` gate, the metric the
  deployment is judged on — because US-004 measured that `schemaValid` cannot
  separate the quants. Today that resolves to **Q8_0**. With no `--analyzer-dir` the
  function returns the baseline quant and says *"this is a default, not a
  recommendation"*.
- **The Analyzer prompt gap is MEASURED, not asserted.** `argos_prompt_probe` renders
  Analyzer's real `skill_nl_edit._system_prompt` in the Analyzer checkout (subprocess,
  JSON in/out — the US-003 rule) and `prompt_gap` compares it block by block against
  the committed contract. Measured 2026-07-22: **every block is byte-identical, and
  the message split is not** — Analyzer sends the whole block as the SYSTEM turn with
  the bare instruction as the user turn, while the pilot measured a short system
  turn and the block in the USER turn. Same words, different prompt; say so.
- **`ARGOS_WIRING` is data, cited by file and symbol.** The one that voids the
  measured numbers is `prompt-is-sent-as-one-system-turn`; the one that surprises is
  `no-dedicated-nl-edit-model-setting` — `server._nl_edit_model` borrows the
  director/conform/editor model, so pointing NL editing at the pilot also points
  that agent's own work at it. A dedicated setting is an Analyzer-side story, named not
  drafted.
- **Personal tier is stamped everywhere** — manifest, README, doc block, license
  notes. Redistribution is barred TWICE (the base model's research license *and* the
  personal tier); they are not alternatives. The committed manifest is safe to
  commit only because it is fixture-built (`run-synth-*`).
- **`--check` has two tiers and the first runs in CI**: rebuild the frozen eval set
  from the committed fixtures and compare it to the manifest's `evalSetSha256` (no
  DVC, no GGUF, no Ollama), then — only when `ml/models` is materialised — re-hash
  every file. The eval set is REBUILT in process, never copied from `ml/data`, and
  the CLI hard-fails when the parity report names a different `evalSetSha256`.
- **The AC's "cross-link from both ARGOS_SYNC_PLAN mirrors" vs "no Analyzer repo files
  modified" is resolved as data.** The canonical mirror (`the media-bridge mapping spec`) is
  edited here; the Analyzer mirror (`analyzer/docs/LINGUASCRAPE_SYNC_PLAN.md` — the
  pre-rename name the file actually has) gets `mirror_patch()`, printed by
  `--dry-run` and referenced from the sequencing table. Provided, not applied.
- The `EDIT-OPS-HANDOFF` block lives in `docs/edit-ops-slm-analyzer-runbook.md`,
  outside `train_baselines`' preserve list — same reasoning as `EDIT-OPS-QUANT`. No
  `ml/data` re-pin; **do NOT `dvc add ml/models` in a Chief worktree** (same trap as
  everywhere else in this pilot). MLflow run name `edit-ops-handoff`.

## MLflow / DVC

- Always log via `pinakes_ml.start_run` (opts into `MLFLOW_ALLOW_FILE_STORE=true`
  — MLflow ≥3 refuses the file backend otherwise). Never `mlflow.set_tracking_uri` by
  hand. `mlruns/` is git-ignored; preserved metrics go to `docs/ml-baselines.md`.
- DVC is at the repo root; run it as `uv run --project ml dvc <cmd>`. After
  regenerating `ml/data`, `dvc add ml/data && dvc push` and commit the updated
  `ml/data.dvc`.
