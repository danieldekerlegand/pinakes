"""The SLM pilot's frozen evaluation protocol (slm-pilot US-001).

Pure core for the Phase-D pilot's referee: freeze the eval set, freeze the metric
list and the comparison points, and **measure** the dataset volumes the verdict
rests on. Written and committed BEFORE any training run, so the bar cannot be
moved to fit a result — the discipline ``docs/slm-pilot-protocol.md`` records.

Three things live here, all deterministic (no wall-clock, no network, no model):

* :func:`build_eval_set` — the frozen eval set. One row per distinct rule-authoring
  prompt in the **held-out worlds** of the insimul-bridge US-005 datasets, carrying
  both prompt arms the US-003 ablation needs (grounded / vocabulary-stripped) and
  the reference completion the eval-set loss is measured against.
* :func:`measure_volumes` — the actual SFT / preference / eval counts, as measured.
* :func:`check_floors` — those counts against :data:`VOLUME_FLOORS`. A shortfall
  makes the pilot verdict ``insufficient-data``: a statement about the corpus, not
  a judgment about the model. US-006 reads this field, it does not re-derive it.

Same reproducible-artifact shape as the rest of ``ml/``: the bulk JSONL goes to the
DVC-tracked ``ml/data/slm-pilot/`` tree, the committed artifact is the manifest
(:func:`build_eval_manifest`), and both are a pure function of the fixture worlds.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass
from typing import Any

from pinakes_ml.insimul_datasets import (
    DATASET_VERSION,
    DEFAULT_EVAL_RATIO,
    DEFAULT_SEED,
    INSIMUL_LICENSE,
    INSIMUL_SOURCE,
    LICENSE_CLASS,
    SYNTHETIC_TIER,
    Datasets,
    RuleSftExample,
    serialize_examples,
)
from pinakes_ml.rule_adherence import ANALYZER_VERSION

#: Bumped when the frozen protocol changes — which, per the story, may only
#: happen BEFORE a training run.
PROTOCOL_VERSION = "1"

#: The pilot's task, in one line. Rule authoring (not lore QA) is the primary
#: task because the tier-4 adherence harness scores it objectively.
PILOT_TASK = "vocabulary-grounded Insimul Prolog rule authoring"

EVAL_SET_FILE = "rule-eval.jsonl"

#: The frozen metric list. Everything but ``evalLoss`` comes from the US-004
#: rule-adherence tier (``pinakes_ml.rule_adherence``); ``evalLoss`` is the
#: teacher-forced loss on the reference completions, which is why the eval set
#: carries them. No metric may be added to the headline after training.
FROZEN_METRICS: tuple[str, ...] = (
    "parseRate",
    "structuralValidity",
    "schemaValidity",
    "referentialIntegrity",
    "fullyValid",
    "reachabilityCharitable",
    "reachabilityStrict",
    "fireabilityIndex",
    "evalLoss",
)

#: Every headline number is reported for each of these. ``grounded-gemini`` is
#: the production path the pilot has to beat or match; ``deterministic-translator``
#: is the floor (Insimul's own non-LLM translator, where a rule is expressible in
#: it at all); the two ``finetuned-*`` rows are the US-003 grounding ablation.
COMPARISON_POINTS: tuple[str, ...] = (
    "deterministic-translator-floor",
    "untuned-qwen2.5-3b-instruct",
    "finetuned-qwen2.5-3b-instruct",
    "finetuned-qwen2.5-3b-instruct-ungrounded",
    "grounded-gemini",
)

#: PROVISIONAL volume floors — see ``docs/slm-pilot-protocol.md`` for the
#: rationale behind each number. Below any of them the pilot cannot distinguish
#: "the approach does not work" from "there was not enough data", so US-006's
#: verdict must read ``insufficient-data``.
VOLUME_FLOORS: dict[str, int] = {
    "ruleSftTrain": 500,
    "ruleSftTrainAccepted": 200,
    "evalPrompts": 100,
    "evalWorlds": 2,
}

VERDICT_SUFFICIENT = "sufficient"
VERDICT_INSUFFICIENT = "insufficient-data"

# --- the two prompt arms --------------------------------------------------------

#: The lines :func:`insimul_datasets.build_rule_prompt` emits as the vocabulary
#: grounding block — exactly what the ablation removes.
GROUNDING_LINE_PREFIXES: tuple[str, ...] = (
    "Intrinsic predicates (true at world creation):",
    "Action-producible predicates (some action effect can make these true):",
    "Entities you may name:",
)

_GROUNDED_CONSTRAINT = "Use only the predicates and entities listed above; "

#: What replaces it in the ungrounded arm — the instruction still has to ask for
#: Insimul's vocabulary, or the ablation measures "did it obey a different task"
#: instead of "did tuning internalise the vocabulary".
UNGROUNDED_CONSTRAINT = "Use Insimul's standard Prolog rule vocabulary; "


def strip_grounding_block(prompt: str) -> str:
    """The US-003 ablation arm: the same instruction, no vocabulary block.

    Drops the three listing lines and swaps the "listed above" constraint for one
    that still demands Insimul vocabulary. The world header and the authoring
    instruction survive — the ablation removes the *grounding*, not the task.
    Frozen here, before training, so the arm cannot be reshaped to fit a result.
    """
    kept = [
        line
        for line in prompt.splitlines()
        if not line.startswith(GROUNDING_LINE_PREFIXES)
    ]
    return "\n".join(
        line.replace(_GROUNDED_CONSTRAINT, UNGROUNDED_CONSTRAINT, 1)
        if line.startswith(_GROUNDED_CONSTRAINT)
        else line
        for line in kept
    )


# --- the frozen eval set --------------------------------------------------------


@dataclass(frozen=True)
class EvalPrompt:
    """One frozen eval prompt — flat and uniform, like every other JSONL here."""

    world_id: str
    rule_name: str
    prompt_id: str
    prompt: str  # the grounded arm — the production path
    prompt_ungrounded: str  # the US-003 ablation arm
    reference_completion: str  # "" when no accepted rule answers this prompt
    has_reference: bool
    label_source: str  # "declared" | "evaluated"
    reference_fully_valid: bool
    reference_reachability_charitable: float
    candidates: int  # SFT records that share this prompt
    tier: str
    license: str
    license_class: str
    source: str
    contract_version: str

    def _sort_key(self) -> tuple[Any, ...]:
        return (self.world_id, self.rule_name, self.prompt_id)

    def as_json_line(self) -> str:
        return json.dumps(asdict(self), sort_keys=True, ensure_ascii=False)


def _reference_order(example: RuleSftExample) -> tuple[Any, ...]:
    """Accepted first, then stable — which SFT record is a prompt's reference."""
    return (0 if example.accepted else 1, example.rule_name, example.completion)


def build_eval_set(datasets: Datasets) -> list[EvalPrompt]:
    """Freeze the held-out worlds' rule prompts as the pilot's eval set.

    The split is the US-005 **per-world** reservation: a world is a closed KB with
    its own vocabulary and rules, so only a whole-world hold-out makes an adherence
    score on it mean anything. Nothing held out ⇒ the eval set is deliberately
    EMPTY rather than drawn from a trained world; a *single*-world build holds that
    world out and so leaves nothing to train on. Either way the floor check reports
    the shortfall and the verdict is ``insufficient-data``, never a model judgment.
    """
    held = set(datasets.splits.held_out_worlds)
    groups: dict[str, list[RuleSftExample]] = {}
    for example in datasets.sft:
        if example.world_id in held:
            groups.setdefault(example.prompt_id, []).append(example)

    prompts: list[EvalPrompt] = []
    for prompt_id, records in groups.items():
        reference = sorted(records, key=_reference_order)[0]
        has_reference = reference.accepted
        prompts.append(
            EvalPrompt(
                world_id=reference.world_id,
                rule_name=reference.rule_name,
                prompt_id=prompt_id,
                prompt=reference.prompt,
                prompt_ungrounded=strip_grounding_block(reference.prompt),
                reference_completion=reference.completion if has_reference else "",
                has_reference=has_reference,
                label_source=reference.label_source,
                reference_fully_valid=has_reference and reference.fully_valid,
                reference_reachability_charitable=(
                    reference.reachability_charitable if has_reference else 0.0
                ),
                candidates=len(records),
                tier=SYNTHETIC_TIER,
                license=INSIMUL_LICENSE,
                license_class=LICENSE_CLASS,
                source=INSIMUL_SOURCE,
                contract_version=reference.contract_version,
            )
        )
    prompts.sort(key=lambda p: p._sort_key())
    return prompts


# --- volumes + the insufficient-data floor --------------------------------------


def measure_volumes(
    datasets: Datasets, eval_set: Sequence[EvalPrompt]
) -> dict[str, int]:
    """The actual dataset volumes, as measured — never as planned."""
    held = set(datasets.splits.held_out_worlds)
    train_sft = [e for e in datasets.sft if e.world_id not in held]
    return {
        "worlds": len(datasets.worlds),
        "evalWorlds": len(held),
        "evalPrompts": len(eval_set),
        "evalPromptsWithReference": sum(1 for p in eval_set if p.has_reference),
        "ruleSftTotal": len(datasets.sft),
        "ruleSftAccepted": sum(1 for e in datasets.sft if e.accepted),
        "ruleSftTrain": len(train_sft),
        "ruleSftTrainAccepted": sum(1 for e in train_sft if e.accepted),
        "ruleSftHeldOut": len(datasets.sft) - len(train_sft),
        "preferencePairs": len(datasets.preferences),
        "preferencePairsTrain": sum(
            1 for p in datasets.preferences if p.world_id not in held
        ),
        "loreQaTrain": len(datasets.splits.train),
        "loreQaEval": len(datasets.splits.eval),
    }


def check_floors(
    volumes: Mapping[str, int], floors: Mapping[str, int] | None = None
) -> dict[str, Any]:
    """Measured volumes vs the floors — the ``insufficient-data`` gate.

    A missing measurement counts as 0, so a renamed volume key fails loudly rather
    than silently passing the gate it no longer feeds.
    """
    resolved = dict(VOLUME_FLOORS if floors is None else floors)
    checks = {
        name: {
            "measured": int(volumes.get(name, 0)),
            "floor": floor,
            "meets": int(volumes.get(name, 0)) >= floor,
        }
        for name, floor in sorted(resolved.items())
    }
    shortfalls = sorted(name for name, check in checks.items() if not check["meets"])
    return {
        "checks": checks,
        "shortfalls": shortfalls,
        "verdict": VERDICT_INSUFFICIENT if shortfalls else VERDICT_SUFFICIENT,
    }


# --- the committed manifest -----------------------------------------------------


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _counter(values: Iterable[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return dict(sorted(counts.items()))


def build_eval_manifest(
    datasets: Datasets,
    eval_set: Sequence[EvalPrompt],
    *,
    seed: int = DEFAULT_SEED,
    eval_ratio: float = DEFAULT_EVAL_RATIO,
    floors: Mapping[str, int] | None = None,
) -> dict[str, Any]:
    """The committable snapshot of the frozen protocol.

    Machine-readable on purpose: the metric list and the comparison points ride in
    the manifest, so US-003 changing the headline metrics is a diff on a committed,
    snapshot-gated file rather than a quiet edit to a prose document.
    """
    volumes = measure_volumes(datasets, eval_set)
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "datasetVersion": DATASET_VERSION,
        "analyzerVersion": ANALYZER_VERSION,
        "task": PILOT_TASK,
        "seed": seed,
        "evalRatio": eval_ratio,
        "tier": SYNTHETIC_TIER,
        "license": INSIMUL_LICENSE,
        "licenseClass": LICENSE_CLASS,
        "source": INSIMUL_SOURCE,
        "metrics": list(FROZEN_METRICS),
        "comparisonPoints": list(COMPARISON_POINTS),
        "ablation": {
            "groundingLinePrefixes": list(GROUNDING_LINE_PREFIXES),
            "ungroundedConstraint": UNGROUNDED_CONSTRAINT,
        },
        "heldOutWorlds": list(datasets.splits.held_out_worlds),
        "files": {
            EVAL_SET_FILE: {
                "count": len(eval_set),
                "sha256": _sha256(serialize_examples(eval_set)),
            }
        },
        "evalSet": {
            "worldCounts": _counter(p.world_id for p in eval_set),
            "labelSourceCounts": _counter(p.label_source for p in eval_set),
            "withReference": sum(1 for p in eval_set if p.has_reference),
            "referenceFullyValid": sum(1 for p in eval_set if p.reference_fully_valid),
        },
        "volumes": volumes,
        "dataFloor": check_floors(volumes, floors),
    }
