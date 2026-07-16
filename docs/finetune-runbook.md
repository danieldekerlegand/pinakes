# QLoRA fine-tuning pipeline + rented-GPU runbook

NEUROSYMBOLIC_ROADMAP.md **Phase 5, US-005** — the last Phase-5.1 story. A
config-driven QLoRA pipeline that fine-tunes a small open causal-LM on the
deterministic training data generated earlier in the phase and scores the held-out
KGQA split **before and after** tuning through the existing tier-3 eval harness.

- **Pipeline (pure core + lazy heavy imports):** `ml/src/pinakes_ml/finetune.py`
- **CLI:** `uv run pinakes-finetune` (`ml/src/pinakes_ml/train_finetune.py`)
- **Committed configs:** `ml/configs/finetune-smoke.json` (local MPS/CPU smoke) and
  `ml/configs/finetune-gpu.json` (rented-GPU full run)
- **Inputs (DVC-tracked, git-ignored):** the US-002 verbalizations
  (`ml/data/verbalizations/verbalizations.jsonl`) + the US-003 QA train split
  (`ml/data/kgqa/train.jsonl`); evaluated on the held-out `ml/data/kgqa/eval.jsonl`
- **Outputs (git-ignored, `ml/artifacts/`):** the LoRA adapter + a `run-summary.json`;
  metrics also logged to MLflow (`ml/mlruns`)

## What the pipeline does

1. **Assemble** a single instruction-tuning corpus from the two source datasets
   (`assemble_dataset`): each verbalization becomes a *factual-recall* instruction
   ("state this fact as a sentence" → the verbalized statement); each QA row becomes
   a *grounded-reasoning* instruction (the question → the reasoning chain walked from
   its evidence, then `Answer: <name>`). Subsetting + interleave are seeded, so a
   given `(corpus, seed, limits)` yields the same rows in the same order.
2. **Score the base model** on the held-out KGQA split via the tier-3 scorer
   (`kgqa_eval.score_system`) — the *before* number.
3. **QLoRA-fine-tune** with `trl`'s `SFTTrainer` + a `peft` `LoraConfig`
   (`train_qlora`). 4-bit (`bitsandbytes`) is used only when `load_in_4bit` **and**
   CUDA are present; MPS/CPU fall back to an un-quantized LoRA.
4. **Score the tuned model** (base + adapter) on the same split — the *after* number
   — and write the before/after deltas to `run-summary.json` + MLflow.

The tuned/base models plug into the **same** `System` interface as the US-004
graph-retrieval baseline, so tier 3 measures them all the same way.

## The training stack is installed on demand (not in the lock)

`trl` / `peft` / `accelerate` (and `bitsandbytes` for CUDA 4-bit) are **not**
declared dependencies of the `ml/` workspace — same rationale as `scallopy` (see
`ml/pyproject.toml`): uv locks every extra into one universal lock, and the QLoRA
stack is platform-specific (`bitsandbytes` needs CUDA). The pipeline module imports
them lazily inside the training/generation functions, so `import pinakes_ml`
and the whole CI test suite work in the slim env. Install them into the venv before
a run:

```bash
cd ml
uv pip install trl peft accelerate       # + bitsandbytes on CUDA for 4-bit QLoRA
```

`pinakes_ml.finetune.require_finetune_deps()` raises a clear, actionable error
if they are missing.

## Local smoke (Mac MPS / CPU)

Proves the pipeline end-to-end on a tiny model (≤ ~1B params) and a small data
subset — no GPU rental needed. This is the operator step the story requires.

```bash
cd ml
uv pip install trl peft accelerate
uv run --project . dvc pull               # fetch the DVC-tracked datasets
uv run pinakes-finetune              # uses ml/configs/finetune-smoke.json
```

The smoke config trains `HuggingFaceTB/SmolLM2-135M-Instruct` on 128 verbalization
+ 128 QA rows for 1 epoch (un-quantized LoRA, auto device: MPS on Apple Silicon,
CPU elsewhere) and prints the before/after KGQA exact-match plus the adapter path.
On a small random-weights model a single epoch over ~256 rows will not move the
metric much — the smoke proves the *plumbing* (assemble → train → save adapter →
before/after eval), not convergence; a real run is the GPU procedure below.

> **CI never trains.** The `ml/**` CI runs only the pure-core unit tests
> (`ml/tests/test_finetune.py`: dataset assembly, prompt formatting, config
> round-trip, before/after scoring on fake systems, the dependency gate). Same
> stance as the PyKEEN baselines — full training is local/rented-GPU only.

## Rented-GPU full run (Modal / Lambda / RunPod)

The full fine-tune targets a rented GPU. `ml/configs/finetune-gpu.json` is the
starting point: a 1.5B instruct model, the **whole** verbalization + QA corpus
(`max_*: null`), 3 epochs, 4-bit QLoRA (`load_in_4bit: true`, `device: cuda`).

### Image

A CUDA image with the workspace + training stack. Sketch (`Dockerfile` or a Modal
image spec):

```dockerfile
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04
RUN pip install uv
WORKDIR /work
COPY ml/ ml/
RUN cd ml && uv sync --frozen \
 && uv pip install trl peft accelerate bitsandbytes
```

On **Modal**, mirror this with `modal.Image.debian_slim().pip_install(...)` and mount
the repo; on **Lambda/RunPod**, bake it into the instance's container or a `venv`.

### Data sync via DVC

Datasets are DVC-tracked (`ml/data.dvc`), not baked into git. On the GPU host:

```bash
cd ml
uv run --project . dvc pull               # pulls verbalizations + kgqa splits
# (configure the DVC remote first: the repo default remote is `localremote`
#  at repo-root `dvc-storage/`; for a rented host use an S3/GCS remote and
#  `dvc remote add`/`dvc push` from the dev machine, then `dvc pull` here)
```

The run records the corpus DVC md5 in MLflow, so the exact data version a checkpoint
was trained on is always recoverable.

### Launch

```bash
cd ml
uv pip install trl peft accelerate bitsandbytes
uv run pinakes-finetune --config configs/finetune-gpu.json
```

Outputs land in `ml/artifacts/finetune-gpu/` (adapter + `run-summary.json`); metrics
+ params go to MLflow. Pull the adapter back to the dev machine and, optionally,
`dvc add ml/artifacts/... && dvc push` to version it.

### Cost estimate (order-of-magnitude)

At the current corpus scale the assembled corpus is ~11k instruction rows
(9,084 verbalizations + 2,232 QA). A 1.5B QLoRA fine-tune for 3 epochs at this size
is minutes-to-low-tens-of-minutes on a single mid-range GPU:

| GPU (spot/on-demand) | ~$/hr | Est. wall-clock (3 epochs, ~11k rows, 1.5B QLoRA) | Est. cost |
|---|---|---|---|
| RunPod A4000 / L4 (16–24 GB) | ~$0.30–0.60 | ~15–30 min | **< $0.50** |
| Lambda / RunPod A100 40 GB | ~$1.10–1.50 | ~5–10 min | **< $0.50** |
| Modal (serverless A10G/L4) | per-second | ~15–25 min | **< $0.75** |

Numbers are indicative — verify current provider pricing. The dominant cost is
model/image cold-start, not the (small) training itself, so favour a provider with a
warm image cache or persistent volume for iteration.

### Resume

`trl`/`transformers` checkpoint into the `output_dir` each `save` interval. To
resume an interrupted run, point the trainer at the last checkpoint — the pipeline
saves to `config.output_dir` (`ml/artifacts/finetune-gpu/`), and
`SFTTrainer(...).train(resume_from_checkpoint=<dir>)` continues from it (add a
`--resume` flag wiring when a long run needs it). Because the data version is pinned
by DVC md5 and the seed is in the config, a resumed or re-launched run is
reproducible.

## Evaluation

Before/after tier-3 KGQA accuracy is produced by the run itself (in
`run-summary.json` + MLflow). To re-score any system against the held-out split with
the committed harness, see the tier-3 baseline in
[`docs/ml-baselines.md`](ml-baselines.md) and the dataset composition in
[`docs/kgqa-dataset.md`](kgqa-dataset.md). The three eval tiers (link-prediction /
logical-consistency / KGQA) are cross-linked from `docs/ml-baselines.md`.
