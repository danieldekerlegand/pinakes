# `ml/` — neurosymbolic ML workspace (roadmap Phase 2)

Separate uv workspace (Python 3.11), NOT the culture-scrape sidecar — keep
torch/pykeen OUT of the sidecar so its Docker image stays slim. Run checks FROM
`ml/`: `uv run ruff check .`, `uv run pytest`, import smoke
`uv run python -c 'import torch, pykeen, problog'`.

> **DVC IS GONE** (flatten Phase 0 — `docs/artifact-versioning.md`). This file was
> written while it existed and still mentions it in ~60 places, all of them stale:
> there is no `dvc` in the venv, no `.dvc/` at the repo root, no `*.dvc` pointers
> and no remote. Read every "re-pin with `dvc add … && dvc push`" as **"nothing to
> do — the tree is git-ignored"**, every "`dvc pull` first" as **"build/regenerate
> the tree first"**, and every "DVC-tracked" as **"git-ignored, regenerable"**.
> Recorded DVC md5s (in `docs/ml-baselines.md`, manifests, run metadata) are
> provenance labels now — they identify which build a number came from, but
> nothing can fetch that tree.

## The canonical corpus is the agora lib's output — but the lib is NOT a dep

Since pinakes:50 US-1 the canonical node/edge TSV `ml/` reads is rendered by the
embedded agora translation engine (`agora:60-translation-engine-rust`), not by
hand-written Python emitters. **Do not add the extension to this workspace.** It is
a macOS/arm64 abi3 wheel vendored under `core/vendor/`; declaring it would churn
`ml/uv.lock` and break `uv sync --frozen` on Linux CI — the same stance
`pyproject.toml` already takes on `scallopy`.

The tie to the engine is `tests/test_lib_export.py`, which drives the real loaders
(`triples` / `verbalize` / `scallop`) over the engine's **committed output**,
`core/tests/fixtures/parity/golden/neo4j-export/{nodes,edges}/*.tsv` — captured
from `translation.to_neo4j_export` and byte-pinned by
`core/tests/test_translation_parity.py` against both the engine and the
pre-migration emitters. Reading a git-tracked file out of `core/` is the
established cross-workspace move here (`export_insimul_datasets.DEFAULT_WORLDS[0]`
does it too). The fixture is deliberately hostile — escaped tab / newline /
backslash, a multi-label node, an empty multi-value cell, a negative year — so
"the loaders survive the engine's escaping" is a claim with teeth. It runs in CI
(no DVC, no wheel); the live `export/culturescrape` gates are unaffected.

- **The loaders are header-*driven* but the names they look up are literals.**
  `triples._START_COL`/`_END_COL`/`_TYPE_COL` and `verbalize`'s `_NODE_*`/`_EDGE_*`/
  `_PROV_*` are asserted to be columns `shared/canonical-schema.json` declares, so a
  renamed column fails loudly instead of silently reading blanks.
- **GOTCHA — a stale repo-root-relative path is a permanent SKIP, not a failure.**
  Every live gate is `skipif not <path>.exists()`, so a path that stops resolving
  makes the gate vanish and the suite stays green. This bit for real: when the
  Python package moved to `core/`, `export_scallop.DEFAULT_REGISTRY` and
  `export_insimul_datasets.DEFAULT_WORLDS[0]` still pointed at
  `packages/culture-scrape/`, silently killing both `test_scallop.py`
  committed-artifact gates. `test_every_git_tracked_default_path_resolves` now
  asserts every repo-root-anchored default that names a *committed* file exists, and
  that none points back into the retired shell. **Diff the skip count after any
  relocation** — it went 10 → 8 when these were repaired.

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

## Prolog rule adherence — eval tier 4, the VESPACE port (insimul-bridge US-004)

Bridge 4: `rule_adherence.py` (pure) + `eval_rule_adherence.py` (thin CLI,
`pinakes-eval-rule-adherence`) score **generated Prolog rules against the world
they were authored for** — parse rate, structural/schema/referential validity,
charitable+strict reachability, fireability. Metric definitions, the upstream
module-by-module provenance table, and the deliberate deviations:
[`docs/rule-adherence-tier.md`](../docs/rule-adherence-tier.md).

- **PURE + stdlib-only, no Insimul import** — the same discipline as
  `consistency.py`. What crosses the bridge is the
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

## KFT finetune-job admission — `ml/` as a specialized provider (90 US-1)

`kft.py` (pure, stdlib + the sibling pure modules only) is the adapter between the
ecosystem contract (`koine/specs/fine-tuning.md`, KFT 0.3.0 +
`koine/schemas/finetune-job.schema.json`) and this workspace's existing trainer:
a job manifest in, a frozen `SlmPilotConfig` + a `RunAnchor` out. It contains **no
training logic** — `slm_finetune.py` is still the sole pipeline.

- **Pinakes is the NARROW leg of a multi-provider program (KFT §9, FT-K).** It
  admits `text-generation × {sft, lora, qlora}` over the knowledge plane and
  nothing else; agora hosts the general trainer. Refusals are graded and each has
  its own code, because a router reads them differently: `unknown-modality` /
  `incompatible-modality-method` mean the *pair is nonsense* (checked against the
  vendored KFT §3.1 table), while `unsupported-modality` / `unsupported-method` /
  `unsupported-dataset-plane` mean "legitimate job, wrong provider" and name agora
  in the message. Don't collapse them into one error.
- **A base model is an ENTITY, never a coordinate string (KFT §5.1, FT-G).** A job
  names `pinakes:model:…`; the Hub coordinate is read off that entity's external
  anchor in the committed registry `ml/configs/kft-base-models.json`, which also
  carries the base's own license class + egress (KFT §4.2/§4.3 need both — FT-B).
  An `hf:model:…` string in a job is *refused*, not resolved. Add a row before
  pointing a config at a new base; `test_kft.py` asserts every committed
  `configs/slm-pilot-*.json` base is anchored.
- **The RUN is the reproducibility anchor, not the weights (KFT §5.2, FT-C).** GPU
  nondeterminism is exactly the reason there is no committed metrics snapshot here
  (see the QLoRA sections above), so `seed` + `config_hash` + the pinned input ids
  ride on `RunAnchor`. `engine_config_hash` hashes the **unresolved** (ml-relative)
  `SlmPilotConfig`, so two hosts admitting one job agree; `AdmittedJob.resolved()`
  absolutizes paths afterwards and leaves the anchor alone. Keep path resolution on
  `SlmPilotConfig.resolved(base)` — admission must not mint absolute paths.
- **`hyperparams` is permissive by contract (KFT §9), so an unimplemented key is
  REPORTED, not dropped** — `AdmittedJob.ignored_hyperparams` (dotted names, e.g.
  `lora.bias`), the same discipline `scallop.py` uses for untranslatable rules. A
  *mistyped* key is a rejection (`invalid-hyperparam`). Everything the schema
  declares `additionalProperties: false` on (top level, `dataset`, `compute`) is
  rejected on an unknown key — a typo'd key trains something other than what the
  job's author wrote.
- **`method == "qlora"` means 4-bit**, unless `hyperparams.load_in_4bit` says
  otherwise — which a `local-mps` job MUST, bitsandbytes being CUDA-only. The
  committed fixture `ml/fixtures/kft/finetune-job.json` is the golden positive and
  pins it off for that reason.
- Fixture-driven and committed-file-only: admission runs in the slim CI env with no
  DVC corpus, no network and no model. `test_importing_kft_pulls_in_no_heavy_stack`
  re-asserts the no-heavy-import rule in a **subprocess** (the stack may already be
  loaded by a sibling test in-session). No `ml/data` re-pin, no `uv.lock` churn.

## KFT run outputs — telemetry, egress, minted model/weights (90 US-2)

The other half of the provider: `kft.check_egress` (the §4.2 gate, applied inside
`admit`) plus `kft_run.py` (pure) — the §6 training-telemetry stream, the tuned
model as a minted KINP entity, and the adapter/merged/GGUF artifacts as KMI
assets. Driven by `pinakes-train-slm --kft-job <manifest>` (`--stub` works, so the
whole path runs in CI); outputs land beside the run summary as `kft-telemetry.jsonl`
+ `kft-run.json` in the git-ignored `ml/artifacts/kft/<job-slug>/`.

- **Pinakes is a LOCAL-ONLY executor by DATA, not by config.** koine's
  `policy/trust-tiers.json` calls `synthetic` and `personal` *containment-gated*,
  and every corpus this workspace trains on is one of the two — so
  `TIER_EGRESS` maps them to `local-only`, the effective class folds in the
  **base model's** own egress (FT-B), and a cross-boundary `compute.class` is
  refused with a report before any compute. Four graded codes, and they mean
  different things: `cross-boundary-compute` (the gate fired),
  `egress-assertion-violated` (the job claimed `exportable`; §4.2 says verify,
  don't trust), `unsupported-compute-class` ("right job, wrong provider" — pinakes
  owns no cloud placement at all, so this one names agora), and
  `unknown-tier`/`unresolved-license`/`missing-dataset-header` (the inputs can't
  be classified — KGP §7/§7.1 forbid defaulting either, so it is a refusal, never
  a guess).
- **`LICENSE_CLASSES` is a mirror of koine's `policy/license-classes.json`**, and
  an id outside it is *rejected* rather than bucketed. The one addition is
  `non-commercial` (Qwen Research is neither attribution nor owner-scoped
  proprietary); it is documented in `configs/kft-base-models.json` and belongs
  upstream — propose it in koine rather than adding a sixth local class. US-1
  originally wrote `permissive` for Apache-2.0; that was drift from koine's
  `attribution` and is fixed.
- **§5.4 inheritance is STAMPED on the outputs, not implied.** The minted model
  and every weight asset carry the run's effective egress + union license class,
  so a recipient answers "may this ship?" from the envelope without re-deriving
  the corpus. `check_publishable(model, destination)` is the enforcement, and an
  **unknown destination is refused** — for a gate whose failure mode is
  exfiltrating private training data the safe default is no.
- **The model id is minted from the RUN; asset ids are content addresses.** GPU
  nondeterminism rules out content-addressing weights (FT-C), so
  `mint_model_id` derives `pinakes:model:<base>-<job-slug>` from the base entity +
  the job's PROV activity. Assets go the other way: `pinakes:asset:sha256-…` over
  the bytes (a directory gets a tree address over its sorted member hashes).
  **An artifact that does not exist yet is `pendingExports`, never a placeholder
  id** — a stub run mints zero assets and says so.
- **The GGUF/merged paths come from `slm_gguf.build_plan`**, the same layout
  `pinakes-export-gguf` writes, so the §5.3 export matrix (adapter
  `media:derived_from` the base ENTITY — pinakes holds no base bytes — merged
  `derived_from` adapter+base, GGUF `media:variant_of` merged) describes the
  deliverable the deployment leg actually produces.
- **The stub emits a step-accurate, LOSS-FREE stream.** `stub_log_history`
  computes the steps/epochs/warmup-LR the config schedules — real arithmetic —
  and reports no loss, because a fabricated loss curve is precisely what KFT §6
  exists to replace. A real run's curve is trl's own `trainer.state.log_history`,
  now carried on `TrainOutcome.log_history` (`loss`→`train_loss`,
  `learning_rate`→`lr`; anything else numeric passes through).
- **GOTCHA — §6 addresses an event by `job`+`step`, which assumes one event per
  step.** This pipeline emits a training row, an `eval:<stage>` row (the tier-4
  adherence curve's two endpoints) and a terminal row, and the last two share the
  final step. So `event_id` is `<job>#<kind>:<step>`; without the kind,
  "idempotent under redelivery" would coalesce three different events. Propose the
  clarification upstream.
- **No wall clock in the core**: every `ts` is a parameter (`train_slm._utc_now`
  is the only clock), so a run record is byte-reproducible in a test. Still no
  committed metrics snapshot — training numbers stay non-reproducible. No
  `ml/data` re-pin, no `uv.lock` churn.

## MLflow

- Always log via `pinakes_ml.start_run` (opts into `MLFLOW_ALLOW_FILE_STORE=true`
  — MLflow ≥3 refuses the file backend otherwise). Never `mlflow.set_tracking_uri` by
  hand. `mlruns/` is git-ignored; preserved metrics go to `docs/ml-baselines.md`.
- **No artifact versioning.** `ml/data`, `ml/artifacts` and `ml/models` are plain
  git-ignored build outputs — regenerate them, never re-pin them. See
  `docs/artifact-versioning.md` (and the DVC banner at the top of this file).
