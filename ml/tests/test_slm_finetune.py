"""Unit + pipeline-smoke tests for the SLM pilot's QLoRA pipeline (US-002).

Three things these tests exist to hold:

* the **pipeline smoke runs in CI** — :func:`~pinakes_ml.slm_finetune.run_pipeline`
  executes the whole loop (score untuned → train → score tuned, both prompt arms)
  against the stub trainer/model, so a break in the wiring fails here rather than
  three hours into a rented-GPU run. No model, no network, no undeclared deps;
* the **protocol link** — the eval set the pipeline rebuilds must be byte-identical
  to the one US-001 froze (`slm-pilot-eval-manifest.json`), and every key in
  ``FROZEN_METRICS`` must appear in every score block. A pipeline that quietly
  scores a different set, or drops a headline metric, fails;
* the **hold-out invariant** — no training record may come from a held-out world.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pinakes_ml.export_insimul_datasets import DEFAULT_CANDIDATES, DEFAULT_WORLDS
from pinakes_ml.export_slm_eval import DEFAULT_MANIFEST
from pinakes_ml.insimul_datasets import build_datasets
from pinakes_ml.rule_adherence import RuleCandidate, WorldContext, evaluate_rule
from pinakes_ml.slm_finetune import (
    ARM_GROUNDED,
    ARM_UNGROUNDED,
    ARMS,
    IM_END,
    PIPELINE_VERSION,
    STUB_FALLBACK_RULE,
    PilotData,
    SlmPilotConfig,
    aggregate_rows,
    build_pilot_data,
    build_train_records,
    extract_rule,
    format_inference_prompt,
    format_training_text,
    metric_deltas,
    prompt_for_arm,
    render_chatml,
    run_pipeline,
    score_generations,
    stub_model_factory,
    stub_trainer,
)
from pinakes_ml.slm_pilot import FROZEN_METRICS, PROTOCOL_VERSION, build_eval_set
from pinakes_ml.train_slm import eval_set_matches_manifest, main

_ML_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def datasets():
    return build_datasets(DEFAULT_WORLDS, DEFAULT_CANDIDATES)


@pytest.fixture(scope="module")
def config() -> SlmPilotConfig:
    return SlmPilotConfig.from_json(_ML_ROOT / "configs" / "slm-pilot-debug.json")


@pytest.fixture(scope="module")
def pilot_data(config) -> PilotData:
    return build_pilot_data(config, DEFAULT_WORLDS, DEFAULT_CANDIDATES)


# --- prompt rendering -----------------------------------------------------------


def test_training_text_is_the_inference_prompt_plus_the_assistant_turn() -> None:
    prompt, completion = "author a rule", "greets(X) :- friendly(X)."
    assert format_training_text(prompt, completion) == (
        format_inference_prompt(prompt) + completion + IM_END + "\n"
    )


def test_chatml_rendering_is_role_delimited() -> None:
    rendered = render_chatml(
        [{"role": "user", "content": "hi"}], add_generation_prompt=True
    )
    assert rendered == "<|im_start|>user\nhi<|im_end|>\n<|im_start|>assistant\n"
    assert render_chatml([{"role": "user", "content": "hi"}]).endswith(IM_END + "\n")


def test_the_inference_prompt_carries_the_world_context_verbatim() -> None:
    # The grounding block is the ablation's subject: the system turn must not
    # restate the vocabulary, or stripping the user turn would not remove it.
    prompt = "World w-x\nIntrinsic predicates (true at world creation): trait/2"
    assert prompt in format_inference_prompt(prompt)


def test_prompt_arms_select_the_frozen_fields(pilot_data) -> None:
    row = pilot_data.eval_set[0]
    assert prompt_for_arm(row, ARM_GROUNDED) == row.prompt
    assert prompt_for_arm(row, ARM_UNGROUNDED) == row.prompt_ungrounded
    with pytest.raises(ValueError, match="unknown prompt arm"):
        prompt_for_arm(row, "vibes")


# --- config ---------------------------------------------------------------------


def test_config_round_trips_through_json(config) -> None:
    assert SlmPilotConfig.from_dict(config.to_dict()) == config
    assert isinstance(config.to_dict()["lora_target_modules"], list)
    assert isinstance(config.lora_target_modules, tuple)


def test_config_rejects_unknown_keys(config) -> None:
    with pytest.raises(ValueError, match="unknown config keys"):
        SlmPilotConfig.from_dict({**config.to_dict(), "lora_rank": 8})


def test_config_rejects_an_invented_prompt_arm(config) -> None:
    with pytest.raises(ValueError, match="unknown prompt arm"):
        SlmPilotConfig.from_dict({**config.to_dict(), "arms": ["grounded", "vibes"]})


def test_the_debug_config_names_the_pipeline_debug_model(config) -> None:
    # US-001 froze Qwen2.5-3B-Instruct as the baseline and 0.5B as the *debug*
    # model — the debug config must never masquerade as a comparison point.
    assert config.base_model == "Qwen/Qwen2.5-0.5B-Instruct"
    assert tuple(config.arms) == ARMS


def test_resolved_splits_repo_relative_from_ml_relative(config) -> None:
    resolved = SlmPilotConfig.from_dict(
        {**config.to_dict(), "worlds": ["packages/x/world.json"]}
    ).resolved(_ML_ROOT)
    assert resolved.worlds == (str(_ML_ROOT.parent / "packages/x/world.json"),)
    assert resolved.output_dir == str(_ML_ROOT / config.output_dir)


# --- dataset assembly -----------------------------------------------------------


def test_training_never_sees_a_held_out_world(datasets, config) -> None:
    held = set(datasets.splits.held_out_worlds)
    assert held, "the fixture build must hold a world out"
    records = build_train_records(datasets, config)
    assert records
    assert {r["world_id"] for r in records}.isdisjoint(held)


def test_accepted_only_is_the_sft_default(datasets, config) -> None:
    accepted = build_train_records(datasets, config)
    assert {r["kind"] for r in accepted} == {"accepted"}
    everything = build_train_records(
        datasets, SlmPilotConfig.from_dict({**config.to_dict(), "accepted_only": False})
    )
    assert len(everything) > len(accepted)
    assert "rejected" in {r["kind"] for r in everything}


def test_record_assembly_is_deterministic_and_capped(datasets, config) -> None:
    assert build_train_records(datasets, config) == build_train_records(
        datasets, config
    )
    capped = build_train_records(
        datasets,
        SlmPilotConfig.from_dict({**config.to_dict(), "max_train_records": 2}),
    )
    assert len(capped) == 2


def test_every_training_record_is_flat_and_uniform(datasets, config) -> None:
    records = build_train_records(datasets, config)
    keys = {"prompt", "completion", "text", "world_id", "rule_name", "kind"}
    for record in records:
        assert set(record) == keys
        assert all(isinstance(v, str) for v in record.values())
        assert record["text"] == format_training_text(
            record["prompt"], record["completion"]
        )


def test_the_rebuilt_eval_set_is_the_one_us001_froze(pilot_data) -> None:
    manifest = json.loads(DEFAULT_MANIFEST.read_text(encoding="utf-8"))
    frozen = manifest["files"]["rule-eval.jsonl"]
    assert pilot_data.eval_sha256 == frozen["sha256"]
    assert pilot_data.eval_prompts_total == frozen["count"]
    assert eval_set_matches_manifest(DEFAULT_MANIFEST, pilot_data.eval_sha256) is True
    assert eval_set_matches_manifest(DEFAULT_MANIFEST, "deadbeef") is False


def test_capping_the_eval_set_does_not_move_the_frozen_hash(
    config, datasets
) -> None:
    capped = build_pilot_data(
        SlmPilotConfig.from_dict({**config.to_dict(), "max_eval_prompts": 1}),
        DEFAULT_WORLDS,
        DEFAULT_CANDIDATES,
    )
    assert len(capped.eval_set) == 1
    assert capped.eval_prompts_total == len(build_eval_set(datasets))
    manifest = json.loads(DEFAULT_MANIFEST.read_text(encoding="utf-8"))
    assert capped.eval_sha256 == manifest["files"]["rule-eval.jsonl"]["sha256"]


# --- reading a rule back out of a generation ------------------------------------


def test_extract_rule_strips_fences_and_prose() -> None:
    generated = (
        "Sure! Here is the rule:\n```prolog\n"
        "child_surname(C) :- parent_of(P, C).\n```\nHope that helps!"
    )
    assert extract_rule(generated) == "child_surname(C) :- parent_of(P, C)."


def test_extract_rule_keeps_a_multi_line_clause() -> None:
    generated = "greets(X, Y) :-\n    friendly(X),\n    present(Y).\ntrailing prose"
    assert extract_rule(generated) == (
        "greets(X, Y) :-\n    friendly(X),\n    present(Y)."
    )


@pytest.mark.parametrize(
    "generated",
    [
        "",
        "I cannot help with that.",
        "As an AI language model I am unable to author Prolog.",
        "greets(X) :- friendly(X)",  # never terminated
    ],
)
def test_extract_rule_refuses_to_coerce_a_non_rule(generated: str) -> None:
    # Prose that happens to end in a period WOULD parse as a bogus clause, so a
    # generation with no clause must come back empty and score as a parse failure.
    assert extract_rule(generated) == ""


def test_a_refusal_scores_as_a_parse_failure(pilot_data) -> None:
    scores = score_generations(
        pilot_data.eval_set,
        ["I cannot help with that."] * len(pilot_data.eval_set),
        pilot_data.world_contexts,
    )
    assert scores["parseRate"] == 0.0
    assert scores["parsed"] == 0
    assert scores["fullyValid"] == 0.0


# --- scoring --------------------------------------------------------------------


def _row(content: str) -> object:
    context = WorldContext(
        world_id="w",
        contract_version="1",
        intrinsic_keys=frozenset({"friendly/1"}),
    )
    return evaluate_rule(RuleCandidate("r", content), context)


def test_every_frozen_metric_is_reported(pilot_data) -> None:
    scores = score_generations(
        pilot_data.eval_set,
        [row.reference_completion for row in pilot_data.eval_set],
        pilot_data.world_contexts,
        eval_loss=0.5,
    )
    assert set(FROZEN_METRICS) <= set(scores)
    assert scores["evalLoss"] == 0.5


def test_validity_rates_are_over_parsed_rows_not_all_rows() -> None:
    rows = [_row("greets(X) :- friendly(X)."), _row("")]
    scores = aggregate_rows(rows)
    assert scores["parseRate"] == 0.5
    # One of two generations parsed, and it is schema-valid: 1/1, not 1/2. An
    # unparsed generation is already counted once, by the parse rate.
    assert scores["schemaValidity"] == 1.0
    assert scores["prompts"] == 2 and scores["parsed"] == 1


def test_aggregating_nothing_does_not_divide_by_zero() -> None:
    scores = aggregate_rows([])
    assert scores["parseRate"] == 0.0
    assert scores["evalLoss"] is None


def test_metric_deltas_cover_the_numeric_frozen_metrics() -> None:
    before = {"parseRate": 0.5, "fullyValid": 0.0, "evalLoss": None}
    after = {"parseRate": 0.75, "fullyValid": 0.25, "evalLoss": 1.5}
    deltas = metric_deltas(before, after)
    assert deltas["parseRate"] == 0.25
    assert deltas["fullyValid"] == 0.25
    assert "evalLoss" not in deltas  # not numeric on both sides


# --- the pipeline smoke (the AC's stub run, in CI) ------------------------------


def test_the_pipeline_runs_end_to_end_against_the_stub(config, pilot_data) -> None:
    summary = run_pipeline(
        config,
        pilot_data,
        trainer=stub_trainer,
        model_factory=stub_model_factory(pilot_data.eval_set),
        dataset_hash="abc123",
        matches_frozen_eval_set=True,
    )

    assert summary["pipelineVersion"] == PIPELINE_VERSION
    assert summary["protocolVersion"] == PROTOCOL_VERSION
    assert set(summary["scores"]) == {"untuned", "finetuned"}
    for arms in summary["scores"].values():
        assert set(arms) == set(ARMS)
        for scores in arms.values():
            assert set(FROZEN_METRICS) <= set(scores)
            assert scores["prompts"] == len(pilot_data.eval_set)
    assert set(summary["deltas"]) == set(ARMS)
    assert summary["dataset"]["evalSetSha256"] == pilot_data.eval_sha256
    assert summary["dataset"]["contentHash"] == "abc123"
    assert summary["training"]["numTrainRecords"] == len(pilot_data.train_records)
    # A stub run must be self-identifying — its scores describe wiring, not a model.
    assert summary["training"]["stub"] is True


def test_the_untuned_pass_is_skippable(config, pilot_data) -> None:
    summary = run_pipeline(
        SlmPilotConfig.from_dict({**config.to_dict(), "score_untuned": False}),
        pilot_data,
        trainer=stub_trainer,
        model_factory=stub_model_factory(pilot_data.eval_set),
    )
    assert set(summary["scores"]) == {"finetuned"}
    assert summary["deltas"] == {}


def test_the_stub_exercises_both_scoring_paths(pilot_data) -> None:
    factory = stub_model_factory(pilot_data.eval_set)
    untuned, tuned = factory(None, None), factory(None, "adapter")  # type: ignore[arg-type]
    prompt = prompt_for_arm(pilot_data.eval_set[0], ARM_GROUNDED)
    # The tuned stub emits a fenced rule (extraction path); the untuned one emits
    # prose plus a predicate no world declares (schema-invalid path).
    assert extract_rule(tuned.generate(prompt)).endswith(".")
    assert "unknown_predicate" in untuned.generate(prompt)
    assert extract_rule(untuned.generate("no reference")).startswith(
        "untuned_" + STUB_FALLBACK_RULE.split("(", 1)[0]
    )


def test_the_cli_stub_run_writes_a_summary(tmp_path: Path) -> None:
    assert (
        main(["--stub", "--no-mlflow", "--output-dir", str(tmp_path)]) == 0
    )
    summary = json.loads((tmp_path / "run-summary.json").read_text(encoding="utf-8"))
    assert summary["dataset"]["matchesFrozenEvalSet"] is True
    assert summary["training"]["stub"] is True
    assert summary["config"]["output_dir"] == str(tmp_path)
