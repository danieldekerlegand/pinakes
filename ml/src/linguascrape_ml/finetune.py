"""QLoRA fine-tuning pipeline over the generated training data (US-005).

Reproducer for NEUROSYMBOLIC_ROADMAP.md Phase 5, US-005 — the final Phase-5.1
story. It consumes the two deterministic training datasets built earlier in the
phase:

* the **triple-verbalization** JSONL (US-002, ``ml/data/verbalizations/…``) —
  canonical facts in natural-language form, teaching factual recall; and
* the **multi-hop KG-grounded QA** JSONL (US-003, ``ml/data/kgqa/train.jsonl``) —
  question/reasoning-chain/answer triples, teaching grounded reasoning,

assembles them into a single instruction-tuning corpus, and QLoRA-fine-tunes a
small open causal-LM with ``trl`` + ``peft``. The held-out KGQA split
(``ml/data/kgqa/eval.jsonl``, US-003/US-004) is scored **before and after** tuning
through the existing tier-3 scorer (:mod:`linguascrape_ml.kgqa_eval`) so the run
reports whether tuning moved the needle.

Design mirrors the rest of the workspace (see ``ml/CLAUDE.md``):

* **A pure, dependency-light core** — dataset assembly (JSONL -> instruction
  records), the config dataclass, the prompt formatting, and the before/after
  *scoring* wiring are all pure functions of their inputs with **no heavy imports
  at module load**, so ``import linguascrape_ml.finetune`` works in the slim CI
  env and the core is unit-tested on tiny fixtures (no training in CI).
* **The heavy stack is imported lazily** inside the training/generation
  functions. ``trl``/``peft``/``accelerate`` are intentionally **not** declared
  dependencies (same rationale as ``scallopy`` in ``pyproject.toml`` — a universal
  lock must resolve every extra, and the QLoRA stack is platform-specific:
  ``bitsandbytes`` 4-bit needs CUDA, MPS/CPU use the un-quantized path). Install
  them into the venv when running a smoke/full train
  (``uv pip install trl peft accelerate``); :func:`require_finetune_deps` raises a
  clear message otherwise.

The thin CLI + MLflow logging live in :mod:`linguascrape_ml.train_qlora`; the
rented-GPU runbook is ``docs/finetune-runbook.md``.
"""

from __future__ import annotations

import json
import random
from collections.abc import Callable
from dataclasses import asdict, dataclass, fields
from pathlib import Path

from linguascrape_ml.kgqa_eval import (
    QARecord,
    SystemPrediction,
    score_system,
)

# One assembled training row: a uniform, flat, HF-datasets-compatible record. Every
# row carries the same string keys so ``datasets.load_dataset`` infers one schema.
InstructionRecord = dict[str, str]

# A ``System`` from the tier-3 scorer: maps a QA record to a prediction. The tuned
# and base models are wrapped as systems so the existing scorer measures them.
System = Callable[[QARecord], SystemPrediction]

# --- prompt formatting --------------------------------------------------------

INSTRUCTION_HEADER = "### Instruction:\n"
RESPONSE_HEADER = "\n\n### Response:\n"


def format_prompt(instruction: str) -> str:
    """The instruction half of a training row, ending at the response header.

    Generation feeds exactly this string to the model and reads what it writes
    after the response header, so training and inference share one template.
    """
    return f"{INSTRUCTION_HEADER}{instruction}{RESPONSE_HEADER}"


def format_training_text(instruction: str, response: str) -> str:
    """The full instruction + response training string (prompt + completion)."""
    return f"{format_prompt(instruction)}{response}"


def _humanize_relation(relation: str) -> str:
    """``DESCENDS_FROM`` -> ``descends from`` for readable reasoning steps."""
    return relation.replace("_", " ").strip().lower()


# --- instruction-record builders (pure) ---------------------------------------


def build_verbalization_instruction(record: dict[str, object]) -> InstructionRecord:
    """Turn one triple-verbalization row into a factual-recall instruction record.

    The instruction states the structured fact and asks for its natural-language
    form; the completion is the verbalized statement the generator already wrote.
    Deterministic and pure — no wall-clock, no RNG.
    """
    head_name = str(record.get("head_name", "")).strip()
    tail_name = str(record.get("tail_name", "")).strip()
    relation = str(record.get("relation", "")).strip()
    value = str(record.get("value", "")).strip()
    text = str(record.get("text", "")).strip()
    if record.get("kind") == "attribute":
        fact = f"{head_name} [{_humanize_relation(relation)}] = {value}"
    else:
        fact = f"{head_name} --{_humanize_relation(relation)}--> {tail_name}"
    instruction = (
        "State this knowledge-graph fact as a natural-language sentence:\n" + fact
    )
    return _record(instruction, text, source="verbalization")


def _reasoning_from_evidence(evidence: object) -> str:
    """A chain-of-reasoning string from a QA record's evidence edge list.

    The derivation *is* the answer's justification (US-003), so the completion
    walks each retrieved edge before stating the answer — teaching grounded,
    step-by-step reasoning rather than a bare fact.
    """
    parsed = json.loads(evidence) if isinstance(evidence, str) else evidence
    steps: list[str] = []
    for edge in parsed or []:
        head = str(edge.get("head_name", "")).strip()
        tail = str(edge.get("tail_name", "")).strip()
        rel = _humanize_relation(str(edge.get("relation", "")))
        if head and tail:
            steps.append(f"{head} {rel} {tail}.")
    return " ".join(steps)


def build_qa_instruction(record: QARecord) -> InstructionRecord:
    """Turn one multi-hop QA row into a grounded-reasoning instruction record.

    The instruction is the question; the completion states the reasoning chain
    (from the evidence) then the answer, so the model learns the derivation, not
    just the terminal fact. Deterministic and pure.
    """
    question = str(record.get("question", "")).strip()
    answer = str(record.get("answer", "")).strip()
    reasoning = _reasoning_from_evidence(record.get("evidence", "[]"))
    completion = (
        f"{reasoning} Answer: {answer}".strip() if reasoning else f"Answer: {answer}"
    )
    return _record(question, completion, source="qa")


def _record(instruction: str, completion: str, *, source: str) -> InstructionRecord:
    """Assemble one uniform instruction record (all values are strings)."""
    return {
        "prompt": format_prompt(instruction),
        "completion": completion,
        "text": format_training_text(instruction, completion),
        "source": source,
    }


def load_jsonl(path: Path | str) -> list[dict[str, object]]:
    """Load a JSONL file into a list of dict records (one per non-empty line)."""
    text = Path(path).read_text(encoding="utf-8")
    return [json.loads(line) for line in text.splitlines() if line]


def _subsample(
    records: list[dict[str, object]], limit: int | None, seed: int
) -> list[dict[str, object]]:
    """A deterministic subset of ``records`` (seeded sample), or all if no limit.

    Seeded so a given ``(corpus, limit, seed)`` always yields the same rows — the
    subset is reproducible even though it is not simply the file's head (which
    would be one attribute type only, since the JSONL is sorted).
    """
    if limit is None or limit >= len(records):
        return list(records)
    return random.Random(seed).sample(records, k=limit)


# --- config -------------------------------------------------------------------


@dataclass(frozen=True)
class FineTuneConfig:
    """Config-driven model / dataset / hyperparameters for one QLoRA run.

    Every knob the AC calls out is here so a run is fully described by a committed
    JSON config (``ml/configs/finetune-*.json``) — model, the two source datasets
    (referenced by path; their DVC hash is recorded at run time), and the LoRA +
    training hyperparameters. Frozen + round-trippable (``from_dict``/``to_dict``)
    so the config is itself a reproducible artifact.
    """

    # Model — a small open causal-LM (<= ~1B for the local MPS smoke).
    base_model: str = "HuggingFaceTB/SmolLM2-135M-Instruct"

    # Datasets (paths; resolved against a base dir by the CLI). The verbalization +
    # QA JSONL are the US-002/US-003 outputs; the eval split is the US-003/US-004
    # held-out KGQA split scored before/after.
    verbalizations_path: str = "data/verbalizations/verbalizations.jsonl"
    qa_train_path: str = "data/kgqa/train.jsonl"
    qa_eval_path: str = "data/kgqa/eval.jsonl"
    output_dir: str = "artifacts/finetune"

    # Subsetting — the local smoke trains on a small slice, not the whole corpus.
    max_verbalizations: int | None = 128
    max_qa: int | None = 128
    max_eval_samples: int | None = 64

    # Training hyperparameters.
    seed: int = 20260713
    num_train_epochs: float = 1.0
    learning_rate: float = 2e-4
    per_device_train_batch_size: int = 4
    gradient_accumulation_steps: int = 1
    max_seq_length: int = 512
    max_new_tokens: int = 48
    warmup_ratio: float = 0.03
    logging_steps: int = 5

    # LoRA / QLoRA adapter.
    lora_r: int = 16
    lora_alpha: int = 32
    lora_dropout: float = 0.05
    lora_target_modules: tuple[str, ...] = ("q_proj", "v_proj")
    # 4-bit quantization (QLoRA). CUDA-only (bitsandbytes); leave false for the
    # Mac/MPS + CPU smoke — the pipeline falls back to an un-quantized LoRA there.
    load_in_4bit: bool = False

    # Device override; None -> auto (cuda > mps > cpu).
    device: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> FineTuneConfig:
        """Build from a plain dict, rejecting unknown keys (catches config typos)."""
        known = {f.name for f in fields(cls)}
        unknown = set(data) - known
        if unknown:
            raise ValueError(f"unknown config keys: {sorted(unknown)}")
        payload = dict(data)
        modules = payload.get("lora_target_modules")
        if modules is not None:
            payload["lora_target_modules"] = tuple(modules)  # type: ignore[arg-type]
        return cls(**payload)  # type: ignore[arg-type]

    @classmethod
    def from_json(cls, path: Path | str) -> FineTuneConfig:
        """Load a committed JSON config file."""
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))

    def to_dict(self) -> dict[str, object]:
        """Serializable dict (tuple LoRA modules become a list for JSON)."""
        data = asdict(self)
        data["lora_target_modules"] = list(self.lora_target_modules)
        return data

    def resolved(self, base: Path) -> FineTuneConfig:
        """A copy with all dataset/output paths resolved against ``base`` (ml root)."""
        base = Path(base)

        def _abs(p: str) -> str:
            path = Path(p)
            return str(path if path.is_absolute() else (base / path))

        return FineTuneConfig.from_dict(
            {
                **self.to_dict(),
                "verbalizations_path": _abs(self.verbalizations_path),
                "qa_train_path": _abs(self.qa_train_path),
                "qa_eval_path": _abs(self.qa_eval_path),
                "output_dir": _abs(self.output_dir),
            }
        )


# --- dataset assembly (pure) --------------------------------------------------


def assemble_dataset(config: FineTuneConfig) -> list[InstructionRecord]:
    """Assemble the combined instruction corpus from the two source datasets.

    Verbalization + QA rows are each subsampled deterministically, converted to
    uniform instruction records, then interleaved with a seeded shuffle so a batch
    mixes recall and reasoning. Pure (reads files) and reproducible for a given
    ``(corpus, seed, limits)`` — the same rows in the same order every run.
    """
    verbalizations = _subsample(
        load_jsonl(config.verbalizations_path), config.max_verbalizations, config.seed
    )
    qa = _subsample(load_jsonl(config.qa_train_path), config.max_qa, config.seed + 1)
    records = [build_verbalization_instruction(r) for r in verbalizations]
    records += [build_qa_instruction(r) for r in qa]
    random.Random(config.seed + 2).shuffle(records)
    return records


# --- before/after scoring (pure over the systems) -----------------------------


def evaluate_systems(
    records: list[QARecord], systems: dict[str, System]
) -> dict[str, dict[str, object]]:
    """Score each named answering system on the KGQA records (tier-3 metrics).

    Reuses the US-004 :func:`~linguascrape_ml.kgqa_eval.score_system` so a
    fine-tuned LM plugs into the *same* eval harness as the graph-retrieval
    baseline. Pure w.r.t. the systems (which own any model closure), so tests can
    drive it with deterministic fake systems and assert the metrics.
    """
    out: dict[str, dict[str, object]] = {}
    for name in sorted(systems):
        predictions = [systems[name](record) for record in records]
        out[name] = score_system(records, predictions)
    return out


def before_after_report(
    before: dict[str, object],
    after: dict[str, object],
    *,
    base_model: str,
    num_records: int,
) -> dict[str, object]:
    """Structured before/after comparison + the metric deltas (pure)."""
    keys = ("accuracyExact", "accuracyNormalized", "groundingRate", "answerRate")
    delta = {k: round(float(after[k]) - float(before[k]), 6) for k in keys}
    return {
        "baseModel": base_model,
        "numEvalRecords": num_records,
        "before": before,
        "after": after,
        "delta": delta,
    }


# --- heavy-stack gate ---------------------------------------------------------

_FINETUNE_DEPS = ("trl", "peft")


def require_finetune_deps() -> None:
    """Raise a clear, actionable error if the QLoRA stack is not installed.

    ``trl``/``peft``/``accelerate`` are deliberately not declared dependencies (see
    the module docstring), so a training run must install them into the venv first.
    Called at the top of :func:`train_qlora`; runs in CI (where the deps are absent)
    to assert the message is helpful.
    """
    import importlib.util

    missing = [m for m in _FINETUNE_DEPS if importlib.util.find_spec(m) is None]
    if missing:
        raise ImportError(
            "QLoRA fine-tuning needs the (undeclared) training stack: "
            f"missing {missing}. Install it into the venv with "
            "`uv pip install trl peft accelerate` (add `bitsandbytes` for CUDA "
            "4-bit). See docs/finetune-runbook.md."
        )


def resolve_device(preferred: str | None = None) -> str:
    """Pick the training device: explicit override, else cuda > mps > cpu."""
    if preferred:
        return preferred
    import torch

    if torch.cuda.is_available():
        return "cuda"
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return "mps"
    return "cpu"


# --- training (lazy heavy imports; local-only, never run in CI) ---------------


@dataclass(frozen=True)
class FineTuneResult:
    """Where the trained adapter landed + the run's train metrics."""

    adapter_dir: str
    device: str
    num_train_records: int
    train_loss: float | None = None


def _lora_config(config: FineTuneConfig):  # pragma: no cover - needs peft
    from peft import LoraConfig

    return LoraConfig(
        r=config.lora_r,
        lora_alpha=config.lora_alpha,
        lora_dropout=config.lora_dropout,
        target_modules=list(config.lora_target_modules),
        bias="none",
        task_type="CAUSAL_LM",
    )


def _load_tokenizer(model_name: str):  # pragma: no cover - needs transformers
    from transformers import AutoTokenizer

    tok = AutoTokenizer.from_pretrained(model_name)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    return tok


def _load_base_model(config: FineTuneConfig, device: str):  # pragma: no cover - heavy
    import torch
    from transformers import AutoModelForCausalLM

    kwargs: dict[str, object] = {}
    if config.load_in_4bit and device == "cuda":
        from transformers import BitsAndBytesConfig

        kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
        )
    else:
        kwargs["torch_dtype"] = torch.float32
    model = AutoModelForCausalLM.from_pretrained(config.base_model, **kwargs)
    if device != "cuda":  # 4-bit models are placed by accelerate; move the rest
        model = model.to(device)
    return model


def train_qlora(config: FineTuneConfig) -> FineTuneResult:  # pragma: no cover - local
    """QLoRA-fine-tune ``config.base_model`` on the assembled instruction corpus.

    Lazily imports the training stack (``trl``/``peft``/``transformers``/
    ``datasets``), builds the LoRA adapter, trains with ``trl``'s ``SFTTrainer``,
    and saves the adapter to ``config.output_dir``. Never executed in CI (the deps
    are absent and it downloads a model); proven locally on the tiny smoke config.
    """
    require_finetune_deps()
    import datasets
    from trl import SFTConfig, SFTTrainer

    device = resolve_device(config.device)
    records = assemble_dataset(config)
    dataset = datasets.Dataset.from_list([{"text": r["text"]} for r in records])

    tokenizer = _load_tokenizer(config.base_model)
    model = _load_base_model(config, device)

    output_dir = Path(config.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    sft_config = SFTConfig(
        output_dir=str(output_dir),
        num_train_epochs=config.num_train_epochs,
        per_device_train_batch_size=config.per_device_train_batch_size,
        gradient_accumulation_steps=config.gradient_accumulation_steps,
        learning_rate=config.learning_rate,
        warmup_ratio=config.warmup_ratio,
        logging_steps=config.logging_steps,
        max_length=config.max_seq_length,
        seed=config.seed,
        report_to=[],
        dataset_text_field="text",
        # Device placement: CPU needs the explicit opt-in; MPS/CUDA are auto. Keep
        # fp32 (bf16/fp16 need CUDA) so the tiny-model smoke runs anywhere.
        use_cpu=(device == "cpu"),
        bf16=False,
        fp16=False,
    )
    trainer = SFTTrainer(
        model=model,
        args=sft_config,
        train_dataset=dataset,
        processing_class=tokenizer,
        peft_config=_lora_config(config),
    )
    train_output = trainer.train()
    trainer.save_model(str(output_dir))
    tokenizer.save_pretrained(str(output_dir))
    return FineTuneResult(
        adapter_dir=str(output_dir),
        device=device,
        num_train_records=len(records),
        train_loss=float(getattr(train_output, "training_loss", None) or 0.0),
    )


class HFCausalLMSystem:  # pragma: no cover - needs a real model, local-only
    """Wrap a HF causal-LM as a tier-3 answering :data:`System`.

    Generates an answer for each QA record with the shared prompt template and
    returns it as a :class:`SystemPrediction` so the base and tuned models are
    scored through the exact same harness as the deterministic baselines. Local-only
    (needs a loaded model); construction lazily imports transformers.
    """

    def __init__(
        self,
        model_name: str,
        *,
        adapter_dir: str | None = None,
        device: str | None = None,
        max_new_tokens: int = 48,
    ) -> None:
        import torch

        self._torch = torch
        self.device = resolve_device(device)
        self.max_new_tokens = max_new_tokens
        self.tokenizer = _load_tokenizer(model_name)
        from transformers import AutoModelForCausalLM

        model = AutoModelForCausalLM.from_pretrained(
            model_name, torch_dtype=torch.float32
        )
        if adapter_dir is not None:
            from peft import PeftModel

            model = PeftModel.from_pretrained(model, adapter_dir)
        self.model = model.to(self.device).eval()

    def __call__(self, record: QARecord) -> SystemPrediction:
        prompt = format_prompt(str(record.get("question", "")))
        inputs = self.tokenizer(prompt, return_tensors="pt").to(self.device)
        with self._torch.no_grad():
            generated = self.model.generate(
                **inputs,
                max_new_tokens=self.max_new_tokens,
                do_sample=False,
                pad_token_id=self.tokenizer.pad_token_id,
            )
        text = self.tokenizer.decode(
            generated[0][inputs["input_ids"].shape[1] :], skip_special_tokens=True
        )
        answer = _extract_answer(text)
        return SystemPrediction(answer=answer, evidence=[], answered=bool(answer))


def _extract_answer(generated: str) -> str:
    """Pull the answer out of a generated completion (``Answer: X`` or first line).

    Pure + tested: the QA completions end in ``Answer: <name>``, so prefer that;
    otherwise fall back to the first non-empty line of the generation.
    """
    marker = "Answer:"
    if marker in generated:
        return generated.split(marker)[-1].strip().splitlines()[0].strip()
    for line in generated.splitlines():
        if line.strip():
            return line.strip()
    return generated.strip()
