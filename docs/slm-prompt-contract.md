# SLM pilot — the prompt-template contract

**slm-pilot US-004.** The exact strings Insimul's `LocalAIService` must send to the
fine-tuned rule-authoring model, and the exact way it must read the answer back.
This is the interface half of the Phase-D handoff: get any of it wrong and the
adherence numbers in [`docs/slm-pilot-report.md`](slm-pilot-report.md) describe a
model that is not the one running.

- Machine-readable half (committed, snapshot-gated): [`ml/manifests/slm-prompt-contract.json`](../ml/manifests/slm-prompt-contract.json)
- Pure core: [`ml/src/pinakes_ml/slm_gguf.py`](../ml/src/pinakes_ml/slm_gguf.py) (`build_prompt_contract`)
- CLI: `cd ml && uv run pinakes-export-gguf --contract-only` (`--check` is the freeze gate)
- Coverage: [`ml/tests/test_slm_gguf.py`](../ml/tests/test_slm_gguf.py)
- Wiring runbook (US-005): `docs/slm-insimul-runbook.md`

> **The manifest is generated from the pipeline's own renderers, never transcribed.**
> `inferencePromptTemplate` *is* `slm_finetune.format_inference_prompt`, evaluated on
> a placeholder. A CI test asserts the committed file equals a fresh build, so the
> contract cannot quietly drift away from the string the model was trained on. If
> that test fails, the training template changed and **`contractVersion` must be
> bumped — it is a breaking change for Insimul**, not a formatting nit.

## 1. The chat template

**ChatML** — Qwen2.5-Instruct's own template, and the reason
[`slm_finetune.render_chatml`](../ml/src/pinakes_ml/slm_finetune.py) renders it as a
pure function rather than calling the tokenizer: the string is then unit-testable
in the slim env *and* quotable here. Every real training run calls
`chat_template_matches` and records `chatTemplateVerified` in its summary; for
Qwen2.5-3B-Instruct it is `true`, i.e. the tokenizer produces this byte-for-byte.

```
<|im_start|>system
{systemPrompt}<|im_end|>
<|im_start|>user
{the rule-authoring prompt}<|im_end|>
<|im_start|>assistant
```

The assistant turn is left **open** (no trailing `<|im_end|>`) — that prefix is the
generation prompt. Training text is exactly this plus `{rule}<|im_end|>\n`, and a
test asserts that identity, so training and inference cannot drift apart.

node-llama-cpp's ChatML wrapper produces this shape, but **send the strings below
explicitly rather than relying on wrapper defaults**: the system prompt and the stop
set are part of what was measured, and a wrapper upgrade that changes either
invalidates the parity numbers.

## 2. The system prompt

```
You are Insimul's rule author. Answer with exactly one Prolog rule: a single clause
terminated by a period. Output only the rule — no prose, no explanation, no code fences.
```

(One line, no wrapping — take it verbatim from `systemPrompt` in the manifest.)

**It deliberately says nothing about the world's vocabulary.** The grounding lives
in the *user* turn, because that is exactly what the US-003 ablation strips; moving
any of it into the system prompt would make the ablation measure something else.

## 3. The user turn — and which arm to send

The user turn is built by `insimul_datasets.build_rule_prompt`: a world header, the
world's **intrinsic** predicates, its **action-producible** predicates, its entity
roster (each sorted and budget-capped with an explicit `(+N more)`), then the
authoring instruction.

| Arm | What it is | Send it? |
| --- | --- | --- |
| `grounded` | the full vocabulary block — the production path | **yes** |
| `ungrounded` | the three vocabulary lines removed, the closing constraint swapped for *"Use Insimul's standard Prolog rule vocabulary; …"* | no — it is the US-003 ablation arm |

The three lines that constitute the grounding block (`groundedLinePrefixes` in the
manifest) are:

```
Intrinsic predicates (true at world creation):
Action-producible predicates (some action effect can make these true):
Entities you may name:
```

**Keep the grounding block.** The US-003 ablation measured a large grounded−ungrounded
gap on `schemaValidity` and `fullyValid`, i.e. the block is doing the work and tuning
has not internalised the vocabulary — though at two eval prompts that is a
measurement, not a finding ([runbook](slm-pilot-runbook.md#the-ablation--did-tuning-internalise-the-vocabulary)).
Revisit only when the corpus clears the volume floor.

## 4. Decoding

```json
{"temperature": 0.0, "topK": 1, "topP": 1.0, "maxNewTokens": 96,
 "stop": ["<|im_end|>", "<|endoftext|>"]}
```

Greedy, because that is how both parity columns were scored (`do_sample=False` on
the HF side, `temperature=0` / `top_k=1` under llama.cpp). **Sampling voids the
measured numbers** — a rule is a structured artifact scored pass/fail by a
validator, not prose that benefits from variety. 96 new tokens is comfortably above
every reference completion in the corpus; raise it only with a re-measurement.

## 5. Reading the answer back

Small instruct models wrap answers in prose and code fences however firmly you ask
them not to, so the response is **extracted, then gated** — never used raw.

1. **Extract** (`slm_finetune.extract_rule`): strip code fences, drop everything
   before the first clause-shaped line (`^[a-z]\w*\s*\(`), take the clause up to its
   terminating period.
2. **A generation with no clause-shaped line is a PARSE FAILURE.** Reject it; do not
   coerce it. This matters more than it looks: the tier-4 parser accepts
   `"I cannot help."` as a well-formed one-atom clause, so a refusal that is not
   caught here scores — and *deploys* — as a valid rule.
3. **Gate every surviving rule through the tier-4 validator**
   (`pinakes-eval-rule-adherence`, [`docs/rule-adherence-tier.md`](rule-adherence-tier.md))
   against the world it was authored for, before writing it into that world. The
   pilot's numbers are an *acceptance rate under that gate*, not a promise that the
   gate is unnecessary.

## 6. Versioning

| Field | Meaning |
| --- | --- |
| `contractVersion` | these strings. A bump breaks Insimul's caller. |
| `pipelineVersion` | the training pipeline's contract (prompt rendering, record shape, summary schema) |
| `protocolVersion` | the frozen evaluation protocol ([`docs/slm-pilot-protocol.md`](slm-pilot-protocol.md)) |

Regenerate with `uv run pinakes-export-gguf --contract-only`; verify with
`uv run pinakes-export-gguf --check` (exit 1 on drift). The same check runs as a
pytest snapshot gate, so it is enforced in CI without llama.cpp present.
