# SLM pilot — training-pipeline runbook

**slm-pilot US-002.** How to run the Phase-D pipeline: rule-SFT corpus → QLoRA
fine-tune → tier-4 adherence score on the **frozen** eval set, both prompt arms.
The referee it answers to is [`docs/slm-pilot-protocol.md`](slm-pilot-protocol.md);
this document is the operating manual.

- Pure core: [`ml/src/pinakes_ml/slm_finetune.py`](../ml/src/pinakes_ml/slm_finetune.py)
- CLI: `cd ml && uv run pinakes-train-slm` (`--stub` is the model-free smoke)
- Config (committed): [`ml/configs/slm-pilot-debug.json`](../ml/configs/slm-pilot-debug.json)
- Coverage: [`ml/tests/test_slm_finetune.py`](../ml/tests/test_slm_finetune.py)
- Run output (git-ignored): `ml/artifacts/slm-pilot-debug/{adapter,run-summary.json}`

## What the pipeline does

```
world exports ──build_datasets──> rule-SFT ──(hold-out split)──> train records
                     │                                              │
                     └──build_eval_set──> FROZEN eval set           │
                                              │                     ▼
                        score(untuned) ◄──────┼───────────── QLoRA fine-tune
                        score(finetuned) ◄────┘                     │
                                              ▼                     ▼
                              tier-4 adherence, per arm       adapter + summary
```

Three properties worth knowing before you read a number out of it:

1. **The datasets are rebuilt in process, not read from `ml/data/`.** Same builder,
   same seed, same per-world split as `pinakes-export-slm-eval` — so the eval set is
   *reproduced*, and the run records its sha256 plus a `matchesFrozenEvalSet` verdict
   against the committed manifest. The protocol's rule is that a run which cannot
   name the eval set it scored is not a comparison point; this is how it is enforced
   rather than promised. A side benefit: a debug run needs **no `dvc pull`**.
2. **Training never sees a held-out world** — the split is applied before assembly,
   and a test asserts it.
3. **Both prompt arms are scored on every pass.** US-003's grounding ablation is one
   extra generation loop here, not a second pipeline.

## Running it

```sh
cd ml

# 1. The model-free pipeline smoke — no downloads, no undeclared deps. This is
#    what CI runs; use it to check wiring after any change.
uv run pinakes-train-slm --stub --no-mlflow

# 2. The real debug run. The training stack is deliberately NOT in uv.lock
#    (see ml/CLAUDE.md), so install it into the venv first.
uv pip install trl peft accelerate      # + bitsandbytes on CUDA for 4-bit
uv run pinakes-train-slm                # configs/slm-pilot-debug.json

# 3. A different config / a real converted corpus.
uv run pinakes-train-slm --config configs/slm-pilot-3b.json \
  --world /path/to/world-a.json --world /path/to/world-b.json \
  --candidates /path/to/rules.jsonl
```

Useful flags: `--no-untuned` skips the baseline pass (halves the wall clock, loses
the delta), `--output-dir` relocates the adapter + summary, `--no-mlflow` skips
tracking.

### The config

Everything a run is lives in one committed JSON file
(`SlmPilotConfig`): base model, the world/candidate exports the datasets derive
from, the DVC pointer whose md5 is recorded, the split seed + eval ratio, the LoRA
hyperparameters, and the prompt arms. Unknown keys are rejected (a typo fails
loudly) and an invented prompt arm is rejected (the two arms were frozen by US-001).
The resolved config is embedded verbatim in the run summary, so a run is
reproducible from its summary alone.

`seed` and `eval_ratio` **must** match the frozen protocol (`20260722` / `0.25`) or
the run scores a different split — which is not forbidden, but shows up as
`matchesFrozenEvalSet: false` and disqualifies the run as a comparison point.

### What gets logged

Every run writes `run-summary.json` and one MLflow run
(`pinakes_ml.start_run`, run name = `config.run_name`) carrying:

| Kind | Contents |
| --- | --- |
| params | pipeline + protocol version, base model, seed, epochs, LR, LoRA r/α, 4-bit, arms, `stub` |
| params (identity) | `evalSetSha256`, `ruleSftSha256`, `datasetDvcMd5`, `matchesFrozenEvalSet`, `heldOutWorlds` |
| metrics | train records / eval prompts, train loss, and every frozen metric as `<stage>_<arm>_<metric>` plus `delta_<arm>_<metric>` |

## The prompt-template contract

The model is prompted with **ChatML** — Qwen2.5-Instruct's own template — rendered
by a pure function (`render_chatml` / `format_inference_prompt`) rather than by the
tokenizer, so the exact string is unit-testable in the slim CI env and is available
to hand to Insimul's `LocalAIService` in US-004:

```
<|im_start|>system
{RULE_SYSTEM_PROMPT}<|im_end|>
<|im_start|>user
{the frozen eval prompt — grounded or ungrounded}<|im_end|>
<|im_start|>assistant
{the rule}<|im_end|>
```

Training text is exactly the inference prompt plus the assistant turn (a test
asserts that identity), so training and inference cannot drift apart. Every real
run calls `chat_template_matches` and records `chatTemplateVerified` in the summary
— for `Qwen2.5-0.5B-Instruct` it is `true`. **The system prompt deliberately says
nothing about the world's vocabulary**: the grounding lives in the user turn,
because that is what the ablation removes.

### Reading a rule back out of a generation

Small instruct models wrap answers in prose and code fences however firmly you ask
them not to. `extract_rule` strips fences, drops everything before the first
clause-shaped line, and takes the clause up to its terminating period. A generation
with no clause at all comes back empty and is scored as a **parse failure**, which
is what it is — prose is never coerced into a clause (`"I cannot help."` would
otherwise parse as a bogus one-atom clause).

## The measured debug run (2026-07-22)

`Qwen2.5-0.5B-Instruct`, `configs/slm-pilot-debug.json`, MPS (Apple Silicon),
3 training records / 2 eval prompts, 12 optimizer steps, **5.9 s** of training and
well under a minute end to end.

| Stage / arm | parse | schema | fullyValid | evalLoss |
| --- | ---: | ---: | ---: | ---: |
| untuned / grounded | 0.50 | 0.00 | 0.00 | 2.79 |
| untuned / ungrounded | 1.00 | 0.50 | 0.50 | 2.87 |
| finetuned / grounded | 0.50–1.00 | 1.00 | 1.00 | 2.50 |
| finetuned / ungrounded | 0.00–0.50 | 0.00 | 0.00 | 2.60 |

> ⚠️ **These numbers are not a result and must never be quoted as one.** They are
> the evidence that *the loop closes* — dataset → train → adherence score on the
> frozen eval set — which is US-002's entire deliverable. At n = 2 eval prompts the
> smallest expressible difference in any rate is 50 percentage points, and the
> corpus is far below every volume floor (`dataFloor.verdict == "insufficient-data"`,
> [protocol §5](slm-pilot-protocol.md#5-dataset-volumes-as-measured--and-the-insufficient-data-floor)).
> The one signal with any content is `evalLoss`, which fell on both arms — training
> health, not adherence.

**Two identical invocations gave different adherence rates** (the ranges above).
Neither the training nor the generation is byte-reproducible on MPS even with the
seed pinned — the same float-nondeterminism caveat `ml/CLAUDE.md` already records
for the Phase-5 QLoRA pipeline. That is *why* there is no committed metrics
snapshot for this pipeline and no `--check` gate: the committed artifacts are the
**config**, the **runbook** and the **tests**, never a numbers file. US-003 must
report a mean over repeats or a fixed-seed CPU run, not a single MPS draw.

## What is and is not tracked

| Artifact | Where | Why |
| --- | --- | --- |
| config | `ml/configs/slm-pilot-*.json` (git) | the run's definition |
| eval set + rule-SFT | `ml/data/` (DVC) | bulk, synthetic tier / proprietary |
| adapter + run summary | `ml/artifacts/` (git-ignored, **not** DVC) | a throwaway debug adapter is fully reproducible from the config + the DVC-pinned data; DVC-tracking it would pin noise |
| the pilot's deliverable model | US-004/005 | the merged 3B weights and the GGUF handoff bundle **are** DVC-tracked — that is where a model artifact earns a pin |

The pipeline reads the existing DVC-tracked trees and writes no data, so **no
`dvc add ml/data` re-pin** is needed after a run.

## Gotchas

- **`trl`/`peft`/`accelerate` are not in `uv.lock`** and must not be added: the lock
  is universal and the QLoRA stack is platform-specific (`bitsandbytes` 4-bit needs
  CUDA). `require_finetune_deps()` raises an actionable message when they are
  missing. Installing them with `uv pip install` does not change `uv.lock`, and
  `uv run` will not prune them.
- **`load_in_4bit` is CUDA-only.** The debug config leaves it `false`; MPS/CPU take
  the un-quantized LoRA path. `bf16`/`fp16` likewise need CUDA — the trainer pins
  fp32 and sets `use_cpu` when the device resolves to CPU.
- **A single-world build has an empty eval set** (nothing is held out to score) and
  the CLI refuses to run rather than reporting a vacuous 0/0. Pass two or more
  worlds.
- **The 0.5B model is the pipeline-debug model, never a comparison point.** The
  frozen comparison table names `untuned-qwen2.5-3b-instruct` and the two
  fine-tuned 3B rows; a 0.5B number does not belong in it.
