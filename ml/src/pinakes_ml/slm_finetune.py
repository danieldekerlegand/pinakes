"""Config-driven QLoRA pipeline for the SLM pilot (slm-pilot US-002).

The workflow backbone Phase D runs on: **rule-SFT dataset → QLoRA fine-tune →
tier-4 adherence score on the FROZEN eval set**, driven entirely by a committed
JSON config. US-002 proves the loop on the cheap debug model
(``Qwen2.5-0.5B-Instruct``); US-003 points the same pipeline at the 3B baseline by
swapping the config.

What is deliberately different from the earlier :mod:`pinakes_ml.finetune`
(Phase-5 US-005, verbalization + KGQA over the open corpus):

* the task is **rule authoring**, so the eval harness is the tier-4 adherence
  scorer (:mod:`pinakes_ml.rule_adherence`), not the tier-3 QA scorer;
* the eval set is the **frozen** one (:mod:`pinakes_ml.slm_pilot`) — rebuilt in
  process from the same committed fixture worlds, and its sha256 is recorded on
  every run, because "a run that cannot name the eval set it scored is not a
  comparison point" (``docs/slm-pilot-protocol.md`` §2);
* every score is reported **per prompt arm** (grounded / ungrounded), so US-003's
  grounding ablation is one extra pass rather than a second pipeline.

The QLoRA plumbing itself is reused wholesale from :mod:`pinakes_ml.finetune`
(:func:`~pinakes_ml.finetune.require_finetune_deps`,
:func:`~pinakes_ml.finetune.resolve_device`, the LoRA/tokenizer/base-model
loaders) — those helpers duck-type on any config exposing the same LoRA fields,
which :class:`SlmPilotConfig` does.

Shape, per ``ml/CLAUDE.md``: a **pure core** (config, dataset assembly, prompt
rendering, rule extraction, scoring, the run summary) with **no heavy imports at
module load**, plus lazily-imported training/generation that never runs in CI.
The training seam is injectable (:data:`Trainer` / :data:`ModelFactory`), so the
whole pipeline runs end-to-end in CI against :class:`StubRuleModel` — the AC's
"tiny model stub" smoke — while a real run swaps in :func:`train_qlora` and
:class:`HFRuleModel`.

Runbook: ``docs/slm-pilot-runbook.md``. CLI: :mod:`pinakes_ml.train_slm`.
"""

from __future__ import annotations

import hashlib
import json
import random
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, fields
from pathlib import Path
from typing import Any, Protocol

from pinakes_ml.insimul_datasets import (
    DEFAULT_EVAL_RATIO,
    DEFAULT_SEED,
    Datasets,
    RuleSftExample,
    build_datasets,
    serialize_examples,
)
from pinakes_ml.rule_adherence import (
    RuleCandidate,
    RuleRow,
    WorldContext,
    evaluate_rule,
)
from pinakes_ml.slm_pilot import (
    FROZEN_METRICS,
    PROTOCOL_VERSION,
    EvalPrompt,
    build_eval_set,
)

#: Bumped when the pipeline's contract changes (prompt rendering, record shape,
#: the summary schema) — a run summary from a different version is not directly
#: comparable with this one.
PIPELINE_VERSION = "1"

#: One assembled training row: flat, uniform, all-string values (the same
#: HF-datasets-compatible discipline every JSONL in ``ml/`` follows).
InstructionRecord = dict[str, str]

# --- the two prompt arms --------------------------------------------------------

ARM_GROUNDED = "grounded"
ARM_UNGROUNDED = "ungrounded"

#: Both arms of the US-003 ablation, frozen by US-001. Every score is reported
#: per arm; a run may narrow ``config.arms`` but may not invent a third.
ARMS: tuple[str, ...] = (ARM_GROUNDED, ARM_UNGROUNDED)


def prompt_for_arm(row: EvalPrompt, arm: str) -> str:
    """The eval row's prompt for ``arm`` — both were frozen by US-001."""
    if arm == ARM_GROUNDED:
        return row.prompt
    if arm == ARM_UNGROUNDED:
        return row.prompt_ungrounded
    raise ValueError(f"unknown prompt arm: {arm!r} (expected one of {list(ARMS)})")


# --- prompt rendering (ChatML) --------------------------------------------------
#
# Qwen2.5-Instruct's chat template IS ChatML, so it is rendered here as a pure
# function rather than through a tokenizer — which keeps training-text assembly
# unit-testable in the slim CI env AND gives US-004 an exact string contract to
# hand Insimul's LocalAIService. :func:`chat_template_matches` is the drift
# tripwire: a real run asserts the tokenizer produces byte-identical text.

IM_START = "<|im_start|>"
IM_END = "<|im_end|>"

#: The system turn every training row and every generation share. Kept short and
#: format-focused: the world vocabulary lives in the user turn (that is what the
#: grounding ablation removes), so the system prompt must not restate it.
RULE_SYSTEM_PROMPT = (
    "You are Insimul's rule author. Answer with exactly one Prolog rule: a "
    "single clause terminated by a period. Output only the rule — no prose, no "
    "explanation, no code fences."
)


def build_messages(prompt: str) -> list[dict[str, str]]:
    """The chat messages for one authoring prompt (system + user)."""
    return [
        {"role": "system", "content": RULE_SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]


def render_chatml(
    messages: Sequence[Mapping[str, str]], *, add_generation_prompt: bool = False
) -> str:
    """Render chat messages as ChatML — Qwen2.5-Instruct's own template."""
    rendered = "".join(
        f"{IM_START}{m['role']}\n{m['content']}{IM_END}\n" for m in messages
    )
    return f"{rendered}{IM_START}assistant\n" if add_generation_prompt else rendered


def format_inference_prompt(prompt: str) -> str:
    """Exactly what the model is fed at generation time."""
    return render_chatml(build_messages(prompt), add_generation_prompt=True)


def format_training_text(prompt: str, completion: str) -> str:
    """The full training string — the inference prompt plus the assistant turn.

    Training and inference share one template by construction: this is
    :func:`format_inference_prompt` with the completion and its turn terminator
    appended, and a test asserts that identity.
    """
    return f"{format_inference_prompt(prompt)}{completion}{IM_END}\n"


def chat_template_matches(tokenizer: Any, prompt: str) -> bool:  # pragma: no cover
    """Does the tokenizer's chat template equal :func:`format_inference_prompt`?

    Local-only (needs a real tokenizer). Recorded on every run so a base model
    whose template is not ChatML is visible in the summary rather than silently
    mis-prompted.
    """
    rendered = tokenizer.apply_chat_template(
        build_messages(prompt), tokenize=False, add_generation_prompt=True
    )
    return str(rendered) == format_inference_prompt(prompt)


# --- config ---------------------------------------------------------------------


@dataclass(frozen=True)
class SlmPilotConfig:
    """Everything one pilot run is: model, data provenance, LoRA, seed.

    Frozen + round-trippable (:meth:`from_dict` / :meth:`to_dict`), rejecting
    unknown keys so a config typo fails loudly. The committed configs live in
    ``ml/configs/slm-pilot-*.json``; the run summary embeds the resolved config
    verbatim, so a run is reproducible from the summary alone.
    """

    # Model + run identity.
    base_model: str = "Qwen/Qwen2.5-0.5B-Instruct"
    run_name: str = "slm-pilot-debug"

    # Dataset provenance. Empty ``worlds``/``candidates`` mean "the committed
    # fixture worlds" (resolved by the CLI), so a debug run needs no DVC pull;
    # a real run points them at converted worlds. The datasets are DERIVED from
    # these deterministically — same builder, same seed, same split as
    # ``pinakes-export-slm-eval`` — so the frozen eval set is reproduced, never
    # re-derived differently.
    worlds: tuple[str, ...] = ()
    candidates: tuple[str, ...] = ()
    #: The DVC pointer whose md5 pins the tree the datasets land in (recorded).
    dvc_file: str = "data.dvc"
    #: The frozen protocol manifest the run cross-checks its eval set against.
    eval_manifest: str = "manifests/slm-pilot-eval-manifest.json"
    output_dir: str = "artifacts/slm-pilot-debug"

    # Split + subsetting. ``seed``/``eval_ratio`` MUST match the frozen protocol
    # or the run scores a different split; the CLI checks the resulting sha256.
    seed: int = DEFAULT_SEED
    eval_ratio: float = DEFAULT_EVAL_RATIO
    #: Train on accepted rules only — the corruption negatives are DPO material
    #: (US-006 decides), not SFT targets.
    accepted_only: bool = True
    max_train_records: int | None = None
    max_eval_prompts: int | None = None
    arms: tuple[str, ...] = ARMS
    #: Score the untuned base model first — the "what did tuning buy?" row.
    score_untuned: bool = True

    # Training hyperparameters.
    num_train_epochs: float = 3.0
    learning_rate: float = 2e-4
    per_device_train_batch_size: int = 2
    gradient_accumulation_steps: int = 1
    max_seq_length: int = 1024
    max_new_tokens: int = 96
    warmup_ratio: float = 0.03
    logging_steps: int = 1

    # LoRA / QLoRA adapter. ``load_in_4bit`` is CUDA-only (bitsandbytes); the
    # Mac/MPS debug run uses the un-quantized LoRA path.
    lora_r: int = 16
    lora_alpha: int = 32
    lora_dropout: float = 0.05
    lora_target_modules: tuple[str, ...] = ("q_proj", "k_proj", "v_proj", "o_proj")
    load_in_4bit: bool = False

    #: Device override; None -> auto (cuda > mps > cpu).
    device: str | None = None

    _TUPLE_FIELDS = ("worlds", "candidates", "arms", "lora_target_modules")

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> SlmPilotConfig:
        """Build from a plain dict, rejecting unknown keys (catches typos)."""
        known = {f.name for f in fields(cls)}
        unknown = set(data) - known
        if unknown:
            raise ValueError(f"unknown config keys: {sorted(unknown)}")
        payload = dict(data)
        for name in cls._TUPLE_FIELDS:
            if payload.get(name) is not None:
                payload[name] = tuple(payload[name])  # type: ignore[arg-type]
        config = cls(**payload)  # type: ignore[arg-type]
        for arm in config.arms:
            prompt_for_arm(_ARM_PROBE, arm)  # raises on an invented arm
        return config

    @classmethod
    def from_json(cls, path: Path | str) -> SlmPilotConfig:
        """Load a committed JSON config file."""
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))

    def to_dict(self) -> dict[str, Any]:
        """JSON-serializable dict (tuples become lists)."""
        data = asdict(self)
        for name in self._TUPLE_FIELDS:
            data[name] = list(getattr(self, name))
        return data

    def resolved(self, ml_root: Path | str) -> SlmPilotConfig:
        """Absolute paths: ``ml/``-relative for outputs, repo-relative for worlds.

        World/candidate exports live outside ``ml/`` (one fixture is under
        ``packages/culture-scrape/``), so they resolve against the repo root;
        everything the pipeline writes or reads inside the workspace resolves
        against ``ml/``.
        """
        ml_root = Path(ml_root)
        repo_root = ml_root.parent

        def _abs(base: Path, value: str) -> str:
            path = Path(value)
            return str(path if path.is_absolute() else (base / path))

        return SlmPilotConfig.from_dict(
            {
                **self.to_dict(),
                "worlds": [_abs(repo_root, p) for p in self.worlds],
                "candidates": [_abs(repo_root, p) for p in self.candidates],
                "dvc_file": _abs(ml_root, self.dvc_file),
                "eval_manifest": _abs(ml_root, self.eval_manifest),
                "output_dir": _abs(ml_root, self.output_dir),
            }
        )


#: A throwaway row used only to validate ``config.arms`` at construction time.
_ARM_PROBE = EvalPrompt(
    world_id="", rule_name="", prompt_id="", prompt="", prompt_ungrounded="",
    reference_completion="", has_reference=False, label_source="",
    reference_fully_valid=False, reference_reachability_charitable=0.0,
    candidates=0, tier="", license="", license_class="", source="",
    contract_version="",
)


# --- dataset assembly (pure) ----------------------------------------------------


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def instruction_record(example: RuleSftExample) -> InstructionRecord:
    """One rule-SFT row as a training record (pure, all-string values)."""
    completion = example.completion.strip()
    return {
        "prompt": example.prompt,
        "completion": completion,
        "text": format_training_text(example.prompt, completion),
        "world_id": example.world_id,
        "rule_name": example.rule_name,
        "kind": example.kind,
    }


def build_train_records(
    datasets: Datasets, config: SlmPilotConfig
) -> list[InstructionRecord]:
    """The SFT corpus: the NON-held-out worlds' rule prompts, in a seeded order.

    The held-out worlds are excluded by construction — they are the frozen eval
    set, and training on them would make every adherence score meaningless. A
    seeded subsample (not the file head, which is world-sorted) keeps a debug
    slice representative; a seeded shuffle keeps batches mixed.
    """
    held = set(datasets.splits.held_out_worlds)
    rows = [e for e in datasets.sft if e.world_id not in held]
    if config.accepted_only:
        rows = [e for e in rows if e.accepted]
    limit = config.max_train_records
    if limit is not None and limit < len(rows):
        rows = random.Random(config.seed).sample(rows, k=limit)
    records = [instruction_record(e) for e in rows]
    random.Random(config.seed + 2).shuffle(records)
    return records


@dataclass(frozen=True)
class PilotData:
    """The datasets one run consumes, plus the hashes that identify them."""

    datasets: Datasets
    #: The frozen eval set, possibly truncated for a debug run.
    eval_set: tuple[EvalPrompt, ...]
    train_records: tuple[InstructionRecord, ...]
    #: sha256 of the FULL frozen eval set (never the truncated slice) — the pin
    #: that must match ``slm-pilot-eval-manifest.json``.
    eval_sha256: str
    #: sha256 of the rule-SFT dataset — matches ``insimul-datasets-manifest.json``.
    sft_sha256: str
    eval_prompts_total: int

    @property
    def held_out_worlds(self) -> tuple[str, ...]:
        return tuple(self.datasets.splits.held_out_worlds)

    @property
    def world_contexts(self) -> dict[str, WorldContext]:
        return {wid: world.context for wid, world in self.datasets.worlds.items()}


def build_pilot_data(
    config: SlmPilotConfig,
    world_paths: Sequence[Path | str],
    candidate_paths: Sequence[Path | str] = (),
) -> PilotData:
    """Rebuild the datasets + the frozen eval set for one run (deterministic).

    Same builder, seed and split as ``pinakes-export-slm-eval``, so the eval set
    is *reproduced* rather than re-derived — and the recorded sha256 proves it.
    Rebuilding in process (instead of reading ``ml/data/slm-pilot/``) is what
    lets the debug run work in a fresh worktree with no DVC pull.
    """
    datasets = build_datasets(
        world_paths, candidate_paths, seed=config.seed, eval_ratio=config.eval_ratio
    )
    full_eval = build_eval_set(datasets)
    eval_set = full_eval
    if config.max_eval_prompts is not None:
        eval_set = full_eval[: config.max_eval_prompts]
    return PilotData(
        datasets=datasets,
        eval_set=tuple(eval_set),
        train_records=tuple(build_train_records(datasets, config)),
        eval_sha256=_sha256(serialize_examples(full_eval)),
        sft_sha256=_sha256(serialize_examples(datasets.sft)),
        eval_prompts_total=len(full_eval),
    )


# --- reading a rule back out of a generation (pure) -----------------------------

_FENCE_RE = re.compile(r"^\s*```[A-Za-z]*\s*$", re.MULTILINE)
#: A Prolog clause starts with a lowercase functor immediately followed by "(".
_CLAUSE_START_RE = re.compile(r"^[a-z][A-Za-z0-9_]*\s*\(")


def extract_rule(text: str) -> str:
    """Pull the single Prolog clause out of a raw generation.

    Small models wrap answers in prose and code fences even when told not to.
    Scoring that wrapper as the rule would measure formatting, not authoring —
    so fences are stripped, lines before the first clause-shaped line are
    dropped, and the clause is taken up to its terminating period.

    Returns ``""`` when the generation contains no clause at all; the caller
    scores that as a parse failure, which is exactly what it is. Prose is never
    coerced into a clause (``"I cannot help."`` would otherwise *parse*).
    """
    body = _FENCE_RE.sub("", text).replace("```", "")
    lines = body.splitlines()
    start = next(
        (i for i, line in enumerate(lines) if _CLAUSE_START_RE.match(line.strip())),
        None,
    )
    if start is None:
        return ""
    kept: list[str] = []
    for line in lines[start:]:
        kept.append(line.rstrip())
        if kept[-1].rstrip().endswith("."):
            break
    clause = "\n".join(kept).strip()
    return clause if clause.endswith(".") else ""


# --- scoring (pure) -------------------------------------------------------------


def _mean(values: Sequence[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def aggregate_rows(
    rows: Sequence[RuleRow], *, eval_loss: float | None = None
) -> dict[str, Any]:
    """The frozen metric block for a set of scored generations.

    Rates follow :meth:`~pinakes_ml.rule_adherence.AdherenceReport.rates` — parse
    rate over *all* generations, the validity rates over the *parsed* ones (an
    unparsed generation cannot be schema-invalid, it is already counted once) —
    and the reachability metrics are means over parsed rows. Every key in
    :data:`~pinakes_ml.slm_pilot.FROZEN_METRICS` is present, which a test asserts.
    """
    parsed = [r for r in rows if r.parsed]
    total = len(rows) or 1
    n_parsed = len(parsed) or 1
    fully_valid = sum(
        1
        for r in parsed
        if r.structurally_valid and r.schema_valid and r.referentially_valid
    )
    return {
        "prompts": len(rows),
        "parsed": len(parsed),
        "parseRate": round(len(parsed) / total, 6),
        "structuralValidity": round(
            sum(1 for r in parsed if r.structurally_valid) / n_parsed, 6
        ),
        "schemaValidity": round(
            sum(1 for r in parsed if r.schema_valid) / n_parsed, 6
        ),
        "referentialIntegrity": round(
            sum(1 for r in parsed if r.referentially_valid) / n_parsed, 6
        ),
        "fullyValid": round(fully_valid / n_parsed, 6),
        "reachabilityCharitable": round(
            _mean([r.reachability_charitable for r in parsed]), 6
        ),
        "reachabilityStrict": round(
            _mean([r.reachability_strict for r in parsed]), 6
        ),
        "fireabilityIndex": round(_mean([r.fireability_index for r in parsed]), 6),
        "evalLoss": eval_loss,
    }


def score_generations(
    eval_set: Sequence[EvalPrompt],
    generations: Sequence[str],
    worlds: Mapping[str, WorldContext],
    *,
    eval_loss: float | None = None,
) -> dict[str, Any]:
    """Score one generation per eval prompt against ITS world's vocabulary.

    Each prompt is scored against the world it was authored for — the tier-4
    contract. Pure: the generations are given, so tests drive this with fixed
    strings and no model.
    """
    rows = [
        evaluate_rule(
            RuleCandidate(row.rule_name, extract_rule(text), True),
            worlds[row.world_id],
        )
        for row, text in zip(eval_set, generations, strict=True)
    ]
    return aggregate_rows(rows, eval_loss=eval_loss)


def metric_deltas(
    before: Mapping[str, Any], after: Mapping[str, Any]
) -> dict[str, float]:
    """After-minus-before for every numeric frozen metric both rows carry."""
    deltas: dict[str, float] = {}
    for key in FROZEN_METRICS:
        lhs, rhs = before.get(key), after.get(key)
        if isinstance(lhs, int | float) and isinstance(rhs, int | float):
            deltas[key] = round(float(rhs) - float(lhs), 6)
    return deltas


# --- the pipeline ---------------------------------------------------------------


@dataclass(frozen=True)
class TrainOutcome:
    """Where the adapter landed + what the training run reported."""

    adapter_dir: str
    device: str
    num_train_records: int
    train_loss: float | None = None
    train_runtime_seconds: float | None = None
    stub: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "adapterDir": self.adapter_dir,
            "device": self.device,
            "numTrainRecords": self.num_train_records,
            "trainLoss": self.train_loss,
            "trainRuntimeSeconds": self.train_runtime_seconds,
            "stub": self.stub,
        }


class RuleModel(Protocol):
    """The model seam: author a rule for a prompt, and score reference loss."""

    def generate(self, prompt: str) -> str:  # pragma: no cover - protocol
        ...

    def eval_loss(
        self, pairs: Sequence[tuple[str, str]]
    ) -> float | None:  # pragma: no cover - protocol
        ...


Trainer = Callable[[SlmPilotConfig, Sequence[InstructionRecord]], TrainOutcome]
ModelFactory = Callable[[SlmPilotConfig, str | None], RuleModel]


def score_model(
    model: RuleModel,
    eval_set: Sequence[EvalPrompt],
    worlds: Mapping[str, WorldContext],
    arms: Sequence[str] = ARMS,
) -> dict[str, dict[str, Any]]:
    """Score one model on every prompt arm — the ablation is a second pass."""
    scores: dict[str, dict[str, Any]] = {}
    for arm in arms:
        prompts = [prompt_for_arm(row, arm) for row in eval_set]
        generations = [model.generate(p) for p in prompts]
        pairs = [
            (prompt, row.reference_completion)
            for prompt, row in zip(prompts, eval_set, strict=True)
            if row.has_reference
        ]
        scores[arm] = score_generations(
            eval_set,
            generations,
            worlds,
            eval_loss=model.eval_loss(pairs) if pairs else None,
        )
    return scores


def build_run_summary(
    config: SlmPilotConfig,
    data: PilotData,
    outcome: TrainOutcome,
    stages: Mapping[str, Mapping[str, Any]],
    *,
    dataset_dvc_md5: str = "",
    matches_frozen_eval_set: bool | None = None,
    chat_template_verified: bool | None = None,
) -> dict[str, Any]:
    """The committable run summary — pure, and the MLflow payload's source.

    Deliberately self-describing: config, dataset identity (both content hashes
    plus the DVC md5), the training outcome and every arm's scores, so the
    summary alone answers "what was trained on what, and scored against which
    eval set".
    """
    deltas = {
        arm: metric_deltas(stages["untuned"][arm], stages["finetuned"][arm])
        for arm in sorted(stages.get("finetuned", {}))
        if "untuned" in stages and arm in stages["untuned"]
    }
    return {
        "pipelineVersion": PIPELINE_VERSION,
        "protocolVersion": PROTOCOL_VERSION,
        "runName": config.run_name,
        "baseModel": config.base_model,
        "config": config.to_dict(),
        "dataset": {
            "evalSetSha256": data.eval_sha256,
            "ruleSftSha256": data.sft_sha256,
            "dvcMd5": dataset_dvc_md5,
            "matchesFrozenEvalSet": matches_frozen_eval_set,
            "heldOutWorlds": list(data.held_out_worlds),
            "trainRecords": len(data.train_records),
            "evalPromptsTotal": data.eval_prompts_total,
            "evalPromptsScored": len(data.eval_set),
        },
        "training": outcome.as_dict(),
        "chatTemplateVerified": chat_template_verified,
        "scores": {stage: dict(arms) for stage, arms in sorted(stages.items())},
        "deltas": deltas,
    }


def run_pipeline(
    config: SlmPilotConfig,
    data: PilotData,
    *,
    trainer: Trainer,
    model_factory: ModelFactory,
    dataset_dvc_md5: str = "",
    matches_frozen_eval_set: bool | None = None,
) -> dict[str, Any]:
    """score(untuned) → train → score(tuned): the whole loop, in one pure-ish call.

    "Pure-ish" because the effects live entirely behind the two injected seams.
    That is what makes the CI smoke real: pass :func:`stub_trainer` and
    :func:`stub_model_factory` and the identical code path runs end-to-end with
    no model, no network and no undeclared dependency.
    """
    worlds = data.world_contexts
    stages: dict[str, dict[str, Any]] = {}
    chat_verified: bool | None = None
    if config.score_untuned:
        base = model_factory(config, None)
        stages["untuned"] = score_model(base, data.eval_set, worlds, config.arms)
        chat_verified = getattr(base, "chat_template_verified", None)
    outcome = trainer(config, data.train_records)
    tuned = model_factory(config, outcome.adapter_dir)
    stages["finetuned"] = score_model(tuned, data.eval_set, worlds, config.arms)
    if chat_verified is None:
        chat_verified = getattr(tuned, "chat_template_verified", None)
    return build_run_summary(
        config,
        data,
        outcome,
        stages,
        dataset_dvc_md5=dataset_dvc_md5,
        matches_frozen_eval_set=matches_frozen_eval_set,
        chat_template_verified=chat_verified,
    )


# --- the CI stub (no model, no network, no undeclared deps) ---------------------

#: What the stub emits when it has no reference for a prompt — a syntactically
#: valid clause over invented predicates, so the scorer exercises its
#: parse-success / schema-invalid path rather than only the failure path.
STUB_FALLBACK_RULE = "stub_rule(X) :- stub_condition(X, stub_value)."


class StubRuleModel:
    """Deterministic offline stand-in for a real causal LM — CI's "tiny stub".

    It is a **pipeline** fixture, never a result: the tuned instance echoes the
    eval row's reference completion (wrapped in the prose + fences a small model
    really does emit, so :func:`extract_rule` is exercised) and the untuned one
    mangles it. Any summary it produces carries ``training.stub == true`` and the
    CLI shouts about it — scores from a stub are meaningless by construction.
    """

    def __init__(
        self, references: Mapping[str, str], *, tuned: bool, loss: float = 1.0
    ) -> None:
        self._references = dict(references)
        self.tuned = tuned
        self._loss = loss
        self.chat_template_verified: bool | None = None

    def generate(self, prompt: str) -> str:
        reference = self._references.get(prompt) or STUB_FALLBACK_RULE
        if self.tuned:
            return f"```prolog\n{reference}\n```"
        # The untuned arm: prose, then a clause naming a predicate no world has.
        return (
            "Sure! Here is a rule for that world:\n"
            f"untuned_{reference.split('(', 1)[0]}(X) :- unknown_predicate(X).\n"
            "Let me know if you would like another."
        )

    def eval_loss(self, pairs: Sequence[tuple[str, str]]) -> float | None:
        return round(self._loss / (2.0 if self.tuned else 1.0), 6) if pairs else None


def stub_model_factory(
    eval_set: Sequence[EvalPrompt], *, loss: float = 1.0
) -> ModelFactory:
    """A :data:`ModelFactory` over :class:`StubRuleModel`, keyed by both arms."""
    references = {
        prompt_for_arm(row, arm): row.reference_completion
        for row in eval_set
        for arm in ARMS
        if row.has_reference
    }

    def factory(config: SlmPilotConfig, adapter_dir: str | None) -> RuleModel:
        return StubRuleModel(references, tuned=adapter_dir is not None, loss=loss)

    return factory


def stub_trainer(
    config: SlmPilotConfig, records: Sequence[InstructionRecord]
) -> TrainOutcome:
    """A :data:`Trainer` that trains nothing — the CI smoke's training seam."""
    return TrainOutcome(
        adapter_dir=str(Path(config.output_dir) / "stub-adapter"),
        device="stub",
        num_train_records=len(records),
        stub=True,
    )


# --- the real training stack (lazy imports; local/GPU-only, never in CI) --------


def train_qlora(
    config: SlmPilotConfig, records: Sequence[InstructionRecord]
) -> TrainOutcome:  # pragma: no cover - local-only, undeclared deps
    """QLoRA-fine-tune ``config.base_model`` on the assembled rule-SFT corpus.

    Reuses the Phase-5 US-005 loaders (they duck-type on this config's LoRA
    fields) so there is one place that knows the trl/peft API quirks. Never runs
    in CI: the deps are undeclared and it downloads a model.
    """
    from pinakes_ml.finetune import (
        _load_base_model,
        _load_tokenizer,
        _lora_config,
        require_finetune_deps,
        resolve_device,
    )

    require_finetune_deps()
    import datasets as hf_datasets
    from trl import SFTConfig, SFTTrainer

    device = resolve_device(config.device)
    dataset = hf_datasets.Dataset.from_list([{"text": r["text"]} for r in records])
    tokenizer = _load_tokenizer(config.base_model)
    model = _load_base_model(config, device)

    adapter_dir = Path(config.output_dir) / "adapter"
    adapter_dir.mkdir(parents=True, exist_ok=True)
    sft_config = SFTConfig(
        output_dir=str(adapter_dir),
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
        # CPU needs the explicit opt-in; bf16/fp16 need CUDA, so the Mac debug
        # run stays fp32 (see ml/CLAUDE.md, the trl 1.x gotcha).
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
    trainer.save_model(str(adapter_dir))
    tokenizer.save_pretrained(str(adapter_dir))
    metrics = getattr(train_output, "metrics", None) or {}
    return TrainOutcome(
        adapter_dir=str(adapter_dir),
        device=device,
        num_train_records=len(records),
        train_loss=float(getattr(train_output, "training_loss", None) or 0.0),
        train_runtime_seconds=(
            float(metrics["train_runtime"]) if "train_runtime" in metrics else None
        ),
    )


class HFRuleModel:  # pragma: no cover - needs a real model, local-only
    """A Hugging Face causal LM behind the :class:`RuleModel` seam.

    Greedy decoding (``do_sample=False``) so a run is reproducible, and the
    tokenizer's chat template is checked against :func:`format_inference_prompt`
    at construction — the string contract US-004 hands to Insimul.
    """

    def __init__(self, config: SlmPilotConfig, adapter_dir: str | None = None) -> None:
        import torch

        from pinakes_ml.finetune import _load_tokenizer, resolve_device

        self._torch = torch
        self.device = resolve_device(config.device)
        self.max_new_tokens = config.max_new_tokens
        self.tokenizer = _load_tokenizer(config.base_model)
        self.chat_template_verified = chat_template_matches(self.tokenizer, "probe")

        from transformers import AutoModelForCausalLM

        model = AutoModelForCausalLM.from_pretrained(
            config.base_model, torch_dtype=torch.float32
        )
        if adapter_dir is not None:
            from peft import PeftModel

            model = PeftModel.from_pretrained(model, adapter_dir)
        self.model = model.to(self.device).eval()

    def generate(self, prompt: str) -> str:
        inputs = self.tokenizer(
            format_inference_prompt(prompt), return_tensors="pt"
        ).to(self.device)
        with self._torch.no_grad():
            generated = self.model.generate(
                **inputs,
                max_new_tokens=self.max_new_tokens,
                do_sample=False,
                pad_token_id=self.tokenizer.pad_token_id,
            )
        return self.tokenizer.decode(
            generated[0][inputs["input_ids"].shape[1] :], skip_special_tokens=True
        )

    def eval_loss(self, pairs: Sequence[tuple[str, str]]) -> float | None:
        """Teacher-forced mean loss on the reference completions.

        Prompt tokens are masked out (-100), so this is the loss on the rule the
        model was supposed to author, not on the world context it was given.
        """
        torch = self._torch
        losses: list[float] = []
        for prompt, reference in pairs:
            prompt_text = format_inference_prompt(prompt)
            full = format_training_text(prompt, reference)
            prompt_ids = self.tokenizer(prompt_text, return_tensors="pt")["input_ids"]
            encoded = self.tokenizer(full, return_tensors="pt").to(self.device)
            labels = encoded["input_ids"].clone()
            labels[:, : prompt_ids.shape[1]] = -100
            with torch.no_grad():
                out = self.model(**encoded, labels=labels)
            losses.append(float(out.loss))
        return round(sum(losses) / len(losses), 6) if losses else None


def hf_model_factory(
    config: SlmPilotConfig, adapter_dir: str | None
) -> RuleModel:  # pragma: no cover - local-only
    """The production :data:`ModelFactory` — a real HF model per stage."""
    return HFRuleModel(config, adapter_dir)
