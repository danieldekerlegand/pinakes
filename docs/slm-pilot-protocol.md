# SLM pilot — frozen evaluation protocol

**slm-pilot US-001.** The referee for the Phase-D pilot ([`INSIMUL_SYNC_PLAN.md`](../INSIMUL_SYNC_PLAN.md)
§6 Phase D): train a small model for Insimul lore consistency and Prolog-rule
adherence, and decide honestly whether the approach validates. This document and
its machine-readable half are written and committed **before any training run**,
so the bar cannot be moved to fit a result.

- Pure core: [`ml/src/pinakes_ml/slm_pilot.py`](../ml/src/pinakes_ml/slm_pilot.py)
- CLI: `cd ml && uv run pinakes-export-slm-eval` (`--check` is the freeze gate)
- Manifest (committed, snapshot-tested): [`ml/manifests/slm-pilot-eval-manifest.json`](../ml/manifests/slm-pilot-eval-manifest.json)
- Eval set (DVC tree, git-ignored, **synthetic tier / proprietary**): `ml/data/slm-pilot/rule-eval.jsonl`
- Coverage: [`ml/tests/test_slm_pilot.py`](../ml/tests/test_slm_pilot.py)

## ⚠️ What "frozen" means here

The metric list, the comparison points, the ablation arms and the volume floors
live in the **manifest**, not only in this prose — and a test asserts the committed
manifest equals a fresh build. So changing the headline metrics is a visible diff
on a gated file, not a quiet edit to a document.

The bar below is **PROVISIONAL and revisable — but only BEFORE the first US-003
training run.** After that run the bar is closed. US-006 may report that it was not
met and may propose a *different* bar for the production PRD; it may not retroactively
rewrite this one. If the numbers land ambiguously, that is the finding.

## 1. The task

**Vocabulary-grounded Insimul Prolog rule authoring**: given a world context and a
grounded instruction, emit ONE valid Prolog rule.

Rule authoring is the primary task rather than lore QA or dialogue because it has an
**objective referee** — the tier-4 rule-adherence harness
([`docs/rule-adherence-tier.md`](rule-adherence-tier.md)) scores a generated rule
against the world it was authored for with no reference answer required — and clear
comparison points (an untuned model, the production Gemini path, a deterministic
floor). Lore-consistency QA rides along as a secondary signal, not as the verdict.

The prompt is `insimul_datasets.build_rule_prompt`: a world header, the world's
**intrinsic** predicates, its **action-producible** predicates and its entity roster
(each sorted and budget-capped with an explicit `(+N more)`), then the instruction.
That intrinsic/producible separation is exactly what the reachability metric scores.

### The two prompt arms (the US-003 ablation)

Every eval row carries both, frozen now so neither can be reshaped after seeing a
score:

| Arm | Field | What it is |
| --- | --- | --- |
| **grounded** | `prompt` | the production path — the full vocabulary block |
| **ungrounded** | `prompt_ungrounded` | the three vocabulary lines removed; the closing constraint becomes *"Use Insimul's standard Prolog rule vocabulary; emit a single clause ending in a period."* |

The world header and the authoring instruction survive in both — the ablation removes
the *grounding*, not the task, or it would measure "did it obey a different question"
instead of "did tuning internalise the vocabulary". `slm_pilot.strip_grounding_block`
is the frozen derivation; it is idempotent and unit-tested against `build_rule_prompt`.

## 2. The frozen eval set

`ml/data/slm-pilot/rule-eval.jsonl` — one row per **distinct rule-authoring prompt in
the held-out worlds** of the insimul-bridge US-005 datasets, with the world context
recoverable from `world_id` + `contract_version` and the accepted rule as
`reference_completion` (the target the eval-set loss is measured against).

**The split is per WORLD, never per rule.** A world is a closed KB with its own
vocabulary and rules, so an entity- or rule-level split would leak a world's
predicates into training and make an adherence score on it meaningless
([`docs/insimul-datasets.md`](insimul-datasets.md) §"The per-world held-out split").
Two degenerate cases are handled explicitly rather than papered over: nothing held
out ⇒ an **empty** eval set (never one drawn from a trained world); a single-world
build holds that world out and so leaves **nothing to train on**. Either way the
volume floor (§5) fires.

### The pin

| What | Identity at freeze time |
| --- | --- |
| Eval set | `sha256 = e01cd8175823d5af64414cc4edd2e21369695a606f058197eed234960cbf5fb8` (in the manifest's `files` block) |
| Source rule-SFT | `sha256 = b53f348cb5af2ddd23c654f4ef5d540160907d4d06969f2494cf44f6cf442a73` ([`insimul-datasets-manifest.json`](../ml/manifests/insimul-datasets-manifest.json)) |
| Containing DVC tree | `ml/data.dvc` → `f20307afdace3832ac9a415db5f57699.dir` |

The content hashes are the real pin: the eval set is a pure function of the committed
fixture worlds plus the seed (`20260722`), so `pinakes-export-slm-eval --check`
reproduces it byte-for-byte with no DVC pull. The DVC md5 pins the tree the bulk data
lands in. Every US-003/004 run must log the eval-set sha256 to MLflow alongside its
config — a run that cannot name the eval set it scored is not a comparison point.

## 3. The metrics

Frozen as `metrics` in the manifest. The first eight come from the tier-4 harness
(`pinakes_ml.rule_adherence`; definitions in [`docs/rule-adherence-tier.md`](rule-adherence-tier.md)),
scored on generations for the eval prompts:

| Metric | What it answers |
| --- | --- |
| `parseRate` | did the model emit Prolog at all? |
| `structuralValidity` | five structural checks (atom budget, literal actor atoms, family-prefix predicates, opaque effect payloads, body-reaches-head) |
| `schemaValidity` | the predicate-invention rate, inverted — does every body goal name a key in the world's vocabulary? |
| `referentialIntegrity` | do the entity-position atoms resolve to real entities? |
| `fullyValid` | clean on all three — **the headline** |
| `reachabilityCharitable` | if we are generous about initial state, can the action set fill in the rest? |
| `reachabilityStrict` | the action-driven slice alone — exposes reliance on statuses no action produces |
| `fireabilityIndex` | reachability discounted by condition cost (λᵢ = 0.05, λₐ = 0.25) |
| `evalLoss` | teacher-forced loss on `reference_completion` — the only reference-based metric, and the only one comparable across checkpoints of the same model |

**`evalLoss` is not comparable across model families** (different tokenizers,
different reference distributions). It is a training-health signal; the adherence
rates are the verdict.

**Known floor — read this before interpreting any reachability number.** Today's
Bridge-2 world exports carry no `systems.actions` with Prolog `content`, so the
producibility index is empty and *every* action-derived condition scores dead. The
held-out world `w-laterre` scores `referenceFullyValid: 0` — its own shipped rules
score zero fully-valid. That is a **producer-side gap**, recorded in
`INSIMUL_SYNC_PLAN.md` §5.2, not a model failure. Absolute `fullyValid` numbers are
therefore near-meaningless until Insimul emits actions; the pilot leans on the
**relative** spread between comparison points measured on the identical eval set.

## 4. The comparison points

Frozen as `comparisonPoints`. Every headline metric is reported for each row, on the
identical eval set:

| Id | What it is | Status |
| --- | --- | --- |
| `deterministic-translator-floor` | Insimul's non-LLM rule translator, on the subset it can express at all | **not reachable from pinakes today** — see below |
| `untuned-qwen2.5-3b-instruct` | the base model, grounded prompt — "what does tuning buy?" | measurable locally |
| `finetuned-qwen2.5-3b-instruct` | US-003's tuned model, grounded prompt | the pilot's subject |
| `finetuned-qwen2.5-3b-instruct-ungrounded` | the same weights, ungrounded prompt — the §1 ablation | the pilot's subject |
| `grounded-gemini` | the production path: Gemini with the same vocabulary grounding | measurable locally (API) |

Qwen2.5-3B-Instruct is the baseline because Insimul's `scripts/setup-local-ai.sh`
already deploys that exact family as Q4_K_M GGUF via node-llama-cpp — the deployment
leg (US-004/005) is pre-proven, so the pilot tests the *training* hypothesis rather
than a deployment one. Qwen2.5-0.5B-Instruct is the pipeline-debug model (US-002)
and is never a comparison point.

**On the deterministic floor.** The VESPACE deterministic translator lives in the
Insimul repo, and at the time of writing the checkout at
`~/Development/workspace/insimul-platform` has been restructured — no
`insimul-server/.../vespace-rule-generation-e2e` tree is present, so the floor cannot
be measured from here. It is recorded as **`not-measured`, with this reason**, rather
than dropped from the protocol or substituted with a stand-in. Whoever runs US-003
either locates the translator and fills the row, or reports it as not-measured; the
`where applicable` in the story's wording is this, and it is a caveat on the verdict,
not a metric to quietly forget.

## 5. Dataset volumes, as measured — and the insufficient-data floor

Measured by `pinakes-export-slm-eval` over the committed fixture worlds, recorded in
the manifest's `volumes` block. **These are the actual numbers today, not targets:**

| Volume | Measured | Floor | Meets |
| --- | ---: | ---: | :---: |
| `ruleSftTrain` — SFT records outside the held-out worlds | **7** | 500 | ✗ |
| `ruleSftTrainAccepted` — of which accepted (the positive signal) | **3** | 200 | ✗ |
| `evalPrompts` — distinct held-out prompts | **2** | 100 | ✗ |
| `evalWorlds` — worlds held out | **1** | 2 | ✗ |
| `ruleSftTotal` | 19 | — | |
| `preferencePairs` (DPO stretch, not gating) | 14 | — | |
| `loreQaTrain` / `loreQaEval` | 4 / 11 | — | |

Verdict: **`insufficient-data`**.

### The rule this creates

> **If any floor is unmet, US-006's verdict must read *"insufficient data"* — not
> "the approach did not validate".** A model judgment made on 7 training records
> measures the corpus, not the method.

The pipeline stories (US-002 … US-005) still run: their deliverable is a *working
pipeline*, and a pipeline is proven by completing the loop, not by its scores. What
the floor forbids is converting those scores into a verdict about the approach.

### Where the floors come from

They are deliberately modest — this is a validity test, not a production run:

- **`ruleSftTrain` ≥ 500 / `ruleSftTrainAccepted` ≥ 200.** QLoRA on a 3B model
  reliably shifts output *format* on a few hundred examples; below ~200 positives a
  LoRA mostly memorises. 500 is the smallest number at which "the tuned model did not
  improve" is a statement about the method rather than about sample size.
- **`evalPrompts` ≥ 100.** At n = 2 the smallest reportable difference in a rate
  metric is 50 percentage points; at n = 100 it is 1pp, and a 10pp gap between two
  comparison points is outside the noise a binomial at that n produces. Below ~100
  the comparison table is decoration.
- **`evalWorlds` ≥ 2.** With one held-out world, every eval score is a fact about
  that world's vocabulary. Two is the minimum that distinguishes "the model learnt
  Insimul Prolog" from "the model learnt La Terre Basse".

Reaching them is a **Phase-C corpus problem, not a pilot problem**: it needs Insimul
to emit converted worlds at scale (and `systems.actions` with them — see §3). The
fixture corpus is two hand-authored worlds.

### The provisional success bar

Measured on the frozen eval set, all rows scored by the same tier-4 harness. **Only
evaluable once the floors are met**; below them the verdict is insufficient-data
regardless of the numbers.

1. **The gap-closing bar (primary).** The fine-tuned 3B closes **≥ 50%** of the gap
   between untuned-3B and grounded-Gemini on **both** `parseRate` and
   `schemaValidity`, with no regression worse than 2pp on `referentialIntegrity`.
   *Rationale:* the pilot's thesis is that a small tuned model can substitute for a
   frontier API call on this narrow task. Half the gap is not parity, but it is
   enough to justify a production PRD; less than half means the approach needs a
   different lever (more data, bigger model, DPO) and US-006 should say which.
2. **The tuning-did-something bar (necessary).** Fine-tuned 3B beats untuned 3B by
   **≥ 10pp absolute** on `fullyValid`. *Rationale:* if grounded prompting alone gets
   you there, the whole pilot is unnecessary — this is the cheapest possible
   falsification and it should be checked first.
3. **The quantization budget (US-004).** Q4_K_M under llama.cpp degrades `fullyValid`
   by **≤ 2pp** vs the HF stack on the same eval set. *Rationale:* Insimul deploys
   Q4_K_M; a model that only works unquantized has not been validated for the target
   runtime. Frozen here so US-004 cannot pick a threshold after seeing the drop.

The **ablation** (grounded vs ungrounded fine-tuned) is explicitly *not* part of the
bar — it is high-information either way. A small gap says tuning internalised the
vocabulary (the grounding block can shrink, saving context in Insimul); a large gap
says the grounding block must stay. Both are useful; neither is pass/fail.

## Reproducing

```sh
cd ml
uv run pinakes-export-slm-eval                # rebuild the eval set + manifest
uv run pinakes-export-slm-eval --check        # the freeze gate: no writes, exit 1 on drift
uv run pinakes-export-slm-eval \
  --world /path/to/world-a.json --world /path/to/world-b.json \
  --candidates /path/to/rules.jsonl           # real converted worlds
```

Defaults are the two committed fixture worlds `pinakes-export-insimul` uses, so the
committed manifest needs no DVC corpus and the snapshot test is a real CI gate. A
real-world build writes into the DVC-tracked `ml/data/slm-pilot/` tree — re-pin with
`uv run --project ml dvc add ml/data && dvc push` and commit `ml/data.dvc`, but keep
a non-fixture manifest out of git (it would describe worlds nobody else can pull).

The eval set is `synthetic` tier and `LicenseRef-Insimul-Proprietary`, like every
record it is drawn from: DVC only, never git, never an open-data release.
