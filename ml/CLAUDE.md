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
  (`export_triples.py`), runnable as `python -m linguascrape_ml.<mod>` AND as a
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
  a `src/linguascrape_ml/x.py` module it's `parents[2]` = `ml/` (repo root =
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
  `linguascrape_id`); dedup on `(head, relation, tail)` for link prediction
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
  `import linguascrape_ml` doesn't pull the heavy stack). numpy is NOT a declared dep — it
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
- **GOTCHA — the tier-3 doc block is co-owned.** `linguascrape-eval-kgqa` upserts a
  marker-wrapped (`KGQA-EVAL:START/END`) tier-3 section into `docs/ml-baselines.md`
  (which `train_baselines` otherwise rewrites from scratch). `render_baselines_doc`
  takes an optional `kgqa_section` and `train_baselines` extracts + re-appends the
  existing block, so the two CLIs cooperate instead of clobbering. Regenerate with
  `uv run linguascrape-eval-kgqa` after any corpus/eval-split change; the live gate
  fails on a stale baseline. No DVC re-pin (reads the existing split, writes no data).

## QLoRA fine-tuning pipeline (US-005)

`finetune.py` (pure core + lazy heavy imports) + `train_finetune.py` (thin CLI,
console script `linguascrape-finetune`) consume the US-002 verbalization + US-003 QA
JSONL, QLoRA-fine-tune a small open causal-LM, and score the held-out KGQA split
**before/after** through the US-004 tier-3 scorer. Full runbook + GPU procedure:
[`docs/finetune-runbook.md`](../docs/finetune-runbook.md).

- **The heavy training stack is NOT a declared dependency** — same rule as
  `scallopy` (see `pyproject.toml`): `trl`/`peft`/`accelerate` (+`bitsandbytes` for
  CUDA 4-bit) are installed on demand (`uv pip install trl peft accelerate`), never in
  `uv.lock`. So **all heavy imports are lazy inside functions** — `import
  linguascrape_ml.finetune` and the whole CI suite work in the slim env. Adding the
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
`linguascrape-export-scallop`) load the corpus into Scallop: interned relation
CSVs, a `.scl` translation of the rules registry, and a gated scallopy smoke.
Full runbook: [`docs/scallop-pilot.md`](../docs/scallop-pilot.md).

- **The registry is the rule source, not `rules.py`.** Translate from the committed
  unified registry `packages/culture-scrape/.../datalog/rules_registry.tsv`
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

## MLflow / DVC

- Always log via `linguascrape_ml.start_run` (opts into `MLFLOW_ALLOW_FILE_STORE=true`
  — MLflow ≥3 refuses the file backend otherwise). Never `mlflow.set_tracking_uri` by
  hand. `mlruns/` is git-ignored; preserved metrics go to `docs/ml-baselines.md`.
- DVC is at the repo root; run it as `uv run --project ml dvc <cmd>`. After
  regenerating `ml/data`, `dvc add ml/data && dvc push` and commit the updated
  `ml/data.dvc`.
