# SLM pilot — training-pipeline runbook

**slm-pilot US-002 (the pipeline) + US-003 (the 3B baseline) + US-004 (the GGUF
deployment leg).** How to run the Phase-D pipeline: rule-SFT corpus → QLoRA
fine-tune → tier-4 adherence score on the **frozen** eval set, both prompt arms →
GGUF handoff. The referee it answers to is
[`docs/slm-pilot-protocol.md`](slm-pilot-protocol.md); this document is the
operating manual.

- Pure core: [`ml/src/pinakes_ml/slm_finetune.py`](../ml/src/pinakes_ml/slm_finetune.py)
  + [`ml/src/pinakes_ml/slm_baseline.py`](../ml/src/pinakes_ml/slm_baseline.py)
  (US-003: repeat aggregation, the frozen comparison table, the doc block)
  + [`ml/src/pinakes_ml/slm_gguf.py`](../ml/src/pinakes_ml/slm_gguf.py)
  (US-004: the conversion plan, the parity arithmetic, the prompt contract)
- CLIs: `cd ml && uv run pinakes-train-slm` (`--stub` is the model-free smoke)
  and `uv run pinakes-export-gguf` (`--dry-run` / `--contract-only` are its
  model-free smokes)
- Configs (committed): [`slm-pilot-debug.json`](../ml/configs/slm-pilot-debug.json)
  (0.5B pipeline debug) · [`slm-pilot-3b.json`](../ml/configs/slm-pilot-3b.json)
  (the US-003 baseline)
- Coverage: [`ml/tests/test_slm_finetune.py`](../ml/tests/test_slm_finetune.py)
  + [`ml/tests/test_slm_baseline.py`](../ml/tests/test_slm_baseline.py)
  + [`ml/tests/test_slm_gguf.py`](../ml/tests/test_slm_gguf.py)
- Run output (git-ignored): `ml/artifacts/<run>/{[repeat-N/]adapter,run-summary.json}`,
  `baseline-report.json` and `parity-report.json`
- Deliverable model (DVC, `ml/models.dvc`): `ml/models/slm-pilot/<run>-Q4_K_M.gguf`
- Published results: the `SLM-PILOT` block in
  [`docs/ml-baselines.md`](ml-baselines.md) and the `SLM-QUANT` block in
  [`docs/slm-pilot-report.md`](slm-pilot-report.md), both upserted by their CLI
- Interface contract: [`docs/slm-prompt-contract.md`](slm-prompt-contract.md)

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

# 3. The US-003 baseline: Qwen2.5-3B-Instruct, 3 repeats, publishes the
#    SLM-PILOT block into docs/ml-baselines.md.
uv run pinakes-train-slm --config configs/slm-pilot-3b.json

# 4. A real converted corpus, and the grounded-Gemini comparison point.
uv run pinakes-train-slm --config configs/slm-pilot-3b.json \
  --world /path/to/world-a.json --world /path/to/world-b.json \
  --candidates /path/to/rules.jsonl
GEMINI_API_KEY=… uv run pinakes-train-slm --config configs/slm-pilot-3b.json \
  --gemini            # + uv pip install google-generativeai
```

Useful flags: `--no-untuned` skips the baseline pass (halves the wall clock, loses
the delta), `--repeats N` overrides the config's repeat count, `--output-dir`
relocates the adapter + summary, `--no-doc` skips the `docs/ml-baselines.md`
upsert (a `--stub` run never writes it), `--no-mlflow` skips tracking.

### Repeats, and why every number is a mean

US-002 measured that two identical MPS invocations of the same config at the same
seed produced **different** adherence rates on the 0.5B model. So a US-003 number
is never a single draw: `config.repeats` runs the whole train+score loop that many
times at the *same* seed, and the report carries mean / min / max / n per stage,
arm and metric. `bar.spreadAcrossRepeats` is the honesty check — **any effect
smaller than the spread is the platform, not the model**, and the doc block says
so in those words. Each repeat gets its own `repeat-N/` adapter and summary, so a
disagreeing draw can be inspected instead of overwritten.

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

> **US-004 turned this section into a committed interface.** The authoritative,
> machine-readable version is [`docs/slm-prompt-contract.md`](slm-prompt-contract.md)
> + `ml/manifests/slm-prompt-contract.json`; what follows is the training-side
> summary.

The model is prompted with **ChatML** — Qwen2.5-Instruct's own template — rendered
by a pure function (`render_chatml` / `format_inference_prompt`) rather than by the
tokenizer, so the exact string is unit-testable in the slim CI env and is what
Insimul's `LocalAIService` is handed:

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

## The measured 3B baseline run (US-003, 2026-07-22)

`Qwen/Qwen2.5-3B-Instruct`, `configs/slm-pilot-3b.json`, QLoRA on MPS,
**3 repeats** at seed `20260722`, 3 training records / 2 eval prompts, 12
optimizer steps per repeat (~14 s of training each), **191 s** wall clock for the
whole thing, **$0.00** — it ran locally, so the story's GPU-rental clause never
fired and there is no cost to record beyond the electricity. The numbers live in
the `SLM-PILOT` block of [`docs/ml-baselines.md`](ml-baselines.md) and in three
MLflow runs, each carrying `evalSetSha256`, `ruleSftSha256` and `datasetDvcMd5`.

> ⚠️ **`dataFloor.verdict == "insufficient-data"`.** Every caveat from the debug
> run still applies, and harder: at n = 2 eval prompts the only expressible rates
> are 0, 0.5 and 1. Nothing below is a verdict about the approach — US-006 reads
> the floor field, it does not re-derive it.

Three things the run *did* establish:

1. **The 3B leg of the pipeline works end to end**, unquantized, on a 36 GB
   Apple-Silicon machine, in three minutes — including the untuned baseline pass,
   both prompt arms and the eval-set loss. `chatTemplateVerified: true`,
   `matchesFrozenEvalSet: true`.
2. **At 3B the run was reproducible, unlike the 0.5B debug run.** All three
   repeats produced *identical* adherence rates; only `evalLoss` moved, and only
   in the fourth decimal (spread 0.001). The US-002 gotcha is not universal — but
   the repeat machinery is what turned that from an assumption into a measurement,
   so keep running it.
3. **Training moved the eval-set loss down hard** — 3.13 → 2.46 grounded, 3.06 →
   2.44 ungrounded. On three records that is memorisation, not generalisation;
   it is a training-health signal and nothing more.

And the two comparison points that could not be filled, recorded with their
reasons rather than dropped (the protocol froze the *list*, so a missing row is a
caveat on the verdict, not an absence):

| Row | Status | Why |
| --- | --- | --- |
| `deterministic-translator-floor` | not-measured | the VESPACE translator is absent from the current `insimul-platform` checkout (protocol §4) |
| `grounded-gemini` | not-measured | no `GEMINI_API_KEY` in this environment. `GeminiRuleModel` is implemented and scores through the identical harness — rerun with a key and `--gemini` to fill the row |

**The `grounded-gemini` gap is the one that matters.** The protocol's primary bar
is stated as a *fraction of the untuned→Gemini gap closed*; with the Gemini row
empty, `bar.gapClosedVsReference` is `null` by construction rather than estimated.
US-006 inherits that as a second caveat alongside the data floor.

### The ablation — did tuning internalise the vocabulary?

One extra generation pass, not a second pipeline. Fine-tuned weights, grounded
prompt minus the same weights on the vocabulary-stripped prompt:

| Metric | grounded − ungrounded |
| --- | ---: |
| `parseRate` | −0.500 |
| `schemaValidity` | +1.000 |
| `fullyValid` | +1.000 |
| `evalLoss` | +0.024 |

Read at this scale it says only that the two arms *behave differently*: with the
grounding block the tuned model emitted a schema-valid rule on the one prompt it
parsed; without it, it emitted parseable clauses over predicates no world
declares. That is the shape you would expect if the grounding block is doing the
work and tuning has not internalised the vocabulary — but it is one prompt per
cell. **Do not carry this into US-006 as a finding**; carry it as the measurement
the ablation machinery produces, ready to mean something at corpus scale.

## US-004 — the deployment leg: GGUF + the llama.cpp parity check

Insimul runs models through `node-llama-cpp` as **Q4_K_M GGUF**
(`scripts/setup-local-ai.sh` already deploys Qwen2.5-3B-Instruct that way). So the
pilot's model is only validated once it has survived that conversion *and been
re-measured under it*.

```
adapter ──merge──> fp16 HF weights ──convert_hf_to_gguf──> f16 GGUF
                                                             │
                                              llama-quantize │ Q4_K_M
                                                             ▼
        HF-stack scores (US-003 run summary) ◄── parity ──> llama.cpp scores
                                                    │
                                            the frozen ≤2pp budget
```

### The toolchain (undeclared, local-only — same stance as trl/peft)

```sh
git clone --depth 1 https://github.com/ggml-org/llama.cpp ~/llama.cpp
cd ~/llama.cpp && cmake -B build -DGGML_METAL=ON -DLLAMA_CURL=OFF \
  -DCMAKE_BUILD_TYPE=Release && cmake --build build --target llama-quantize -j 8
cd <repo>/ml && uv pip install llama-cpp-python gguf sentencepiece
```

Only the `llama-quantize` target is built — the full llama.cpp build is minutes of
compiling nobody needs here. Point elsewhere with `--llama-cpp-dir` or
`$LLAMA_CPP_DIR`.

### Running it

```sh
cd ml
uv run pinakes-export-gguf --contract-only   # the prompt contract (pure, no model)
uv run pinakes-export-gguf --check           # the contract freeze gate
uv run pinakes-export-gguf --dry-run         # the conversion plan + exact commands
uv run pinakes-export-gguf                   # merge -> GGUF -> Q4_K_M -> parity
uv run pinakes-export-gguf --skip-convert    # re-score an existing GGUF
```

Then re-pin the deliverable: `uv run --project ml dvc add ml/models && dvc push`,
and commit `ml/models.dvc`. **`ml/models` is its own DVC pointer, deliberately not
part of `ml/data`** — a 2 GB binary that changes with every checkpoint has no
business re-pinning the dataset tree, and `ml/data`'s pin is what the protocol
cites.

`--dry-run` and `--contract-only` need no adapter, no llama.cpp and no undeclared
dependency: they are the CI-safe smokes, the role `--stub` plays for
`pinakes-train-slm`.

### The parity check refuses to compare two eval sets

The CLI rebuilds the frozen eval set in process (same builder, seed and split as
the training pipeline) and **hard-fails** if the HF run summary it was pointed at
records a different `evalSetSha256`. Two columns measured on two eval sets is not
a parity check, and the protocol's "a run that cannot name the eval set it scored
is not a comparison point" rule matters twice as much when there are two columns.

Everything else is held constant on purpose: the same `RuleModel` seam, the same
`format_inference_prompt` string, greedy decoding on both sides
(`do_sample=False` vs `temperature=0`/`top_k=1`), the same tier-4 scorer. The only
variables are the runtime and the quantization.

### The measured conversion (2026-07-22)

`Qwen/Qwen2.5-3B-Instruct` + the US-003 `repeat-1` adapter. fp16 merge → 3.71 GB
f16 GGUF → **1.93 GB Q4_K_M** (5,886 MiB → 1,835 MiB, 4.99 bits/weight; 12 s of
quantization). End-to-end scoring pass: **60 s**, **$0.00** — local, so the GPU
rental clause never fired here either. Full table: the `SLM-QUANT` block in
[`docs/slm-pilot-report.md`](slm-pilot-report.md).

| Arm | `fullyValid` HF → llama.cpp | `evalLoss` HF → llama.cpp |
| --- | --- | --- |
| grounded | 1.000 → 1.000 (Δ 0.000) | 2.464 → 2.674 (Δ +0.210) |
| ungrounded | 0.000 → 0.500 (Δ +0.500) | 2.437 → 2.626 (Δ +0.189) |

The frozen budget (protocol §5 bar 3: `fullyValid` on the grounded arm may degrade
by ≤ 2pp) reads **within-budget at 0.0pp**. Three things to keep straight about
that:

1. **It is a machinery result, not a production clearance.**
   `dataFloor.verdict == "insufficient-data"` still governs — two eval prompts, so
   the only expressible rates are 0, 0.5 and 1, and "0.0pp degradation" is what a
   two-prompt sample can say at best. What US-004 actually establishes is that the
   deployment leg runs and is measured against a threshold nobody chose afterwards.
2. **`evalLoss` moved and that IS the quantization.** ~+0.20 nats on both arms is
   the honest signal in this run: it is a continuous metric, so unlike the rate
   metrics it can resolve a change at n = 2. The adherence rates surviving intact
   while the loss rises is exactly the expected shape for a 4-bit quant on a
   format-constrained task.
3. **The ungrounded arm's +0.5 `fullyValid` is not an improvement.** One prompt
   flipping is the smallest possible move on this eval set. Quantization does not
   make a model better; it made a coin land differently.

**llama.cpp scoring was byte-reproducible here** — two independent
`--skip-convert` runs produced identical rates *and* identical `evalLoss` to six
decimals. Unlike the MPS training path, greedy CPU/Metal inference over a fixed
GGUF gave no run-to-run spread, so this column needs no repeat machinery.

### The prompt-template contract

The third deliverable, and the one Insimul consumes:
[`docs/slm-prompt-contract.md`](slm-prompt-contract.md) + the committed,
snapshot-gated [`ml/manifests/slm-prompt-contract.json`](../ml/manifests/slm-prompt-contract.json).
It is **generated from the pipeline's own renderers**, never transcribed, so a
change to the training template fails the CI gate instead of silently making the
deployed prompt differ from the measured one. A diff there means bumping
`contractVersion` — a breaking change for Insimul's caller.

## What is and is not tracked

| Artifact | Where | Why |
| --- | --- | --- |
| config | `ml/configs/slm-pilot-*.json` (git) | the run's definition |
| eval set + rule-SFT | `ml/data/` (DVC) | bulk, synthetic tier / proprietary |
| adapter + run summary + baseline/parity report | `ml/artifacts/` (git-ignored, **not** DVC) | a throwaway adapter is fully reproducible from the config + the DVC-pinned data; DVC-tracking it would pin noise |
| merged fp16 weights + the f16 GGUF | `ml/artifacts/<run>/gguf/` (git-ignored, **not** DVC) | lossless intermediates, regenerable from the adapter in ~2 min |
| **the deliverable GGUF** | `ml/models/slm-pilot/` (DVC, `ml/models.dvc`) | this is the thing Insimul runs — a model artifact earns a pin, and it gets its own pointer so it never churns `ml/data` |
| the published comparison table | the `SLM-PILOT` block in `docs/ml-baselines.md` (git) | small, and being in git is what makes the result reviewable in a diff |
| the quantization parity table | the `SLM-QUANT` block in `docs/slm-pilot-report.md` (git) | same, and US-006 writes its verdict around that block |
| the prompt-template contract | `ml/manifests/slm-prompt-contract.json` (git) | the interface Insimul codes against; snapshot-gated so it cannot drift |

The training pipeline reads the existing DVC-tracked trees and writes no data, so
**no `dvc add ml/data` re-pin** is needed after a run. `pinakes-export-gguf` does
produce a tracked artifact — re-pin `ml/models` (only) after a conversion.

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
- **Each stage releases its weights before the next stage loads its own**
  (`release_model` / `free_device_memory`). The pipeline holds one model per
  stage (untuned → trainer → tuned) and each stays alive in its frame until the
  call returns — harmless at 0.5B, fatal at 3B, where three fp32 copies are
  ~37 GB and do not fit in a 36 GB unified-memory machine. Add a stage without
  releasing and the 3B run dies in swap.
- **`docs/ml-baselines.md` is now co-owned by five CLIs.** `pinakes-train-slm`
  upserts the `SLM-PILOT` block; `pinakes-train-baselines` rewrites the doc from
  scratch and re-appends it (alongside `KGQA-EVAL`, `SCALLOP-PILOT` and
  `RULE-ADHERENCE`). A new marked block must be added to that preserve list or a
  baselines re-run silently deletes it.
- **A `--stub` run never touches the doc.** Its scores describe wiring; publishing
  them into the comparison table would be the exact failure the protocol's
  "name the eval set you scored" rule exists to prevent.
- **`sentencepiece` is required to convert a Qwen2 checkpoint even though it is a
  BPE model.** `Qwen2Model.set_vocab` *tries* the sentencepiece path first and only
  falls back to the gpt2 path on `FileNotFoundError` — a missing module raises
  `ImportError` straight through the handler, so the conversion dies at "Set model
  tokenizer" with a misleading traceback. Install it alongside `gguf`.
- **`ml/models` has its own DVC pointer; never fold the GGUF into `ml/data`.**
  `ml/data.dvc`'s md5 is quoted by the frozen protocol as the tree the eval set
  lives in — re-pinning it for a model checkpoint would churn that citation on
  every conversion.
- **`brew install llama.cpp` may be a dead end** (it needs write permission on
  `/opt/homebrew` that a locked-down machine will not have). The source build of
  the single `llama-quantize` target above is the reliable path and takes about a
  minute.
- **The parity report's absolute paths stay in the JSON, not the doc.** The
  committed `SLM-QUANT` block records repo-relative provenance and omits
  `llamaCppDir` — `/Users/<someone>/…` is not provenance anyone else can act on.
