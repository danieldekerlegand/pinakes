"""Unit + snapshot tests for the SLM pilot's frozen eval protocol (slm-pilot US-001).

The story's whole point is that the protocol is frozen BEFORE training, so these
tests are the freeze:

* the **committed-manifest snapshot** — a fresh build of the fixture worlds must
  equal ``ml/manifests/slm-pilot-eval-manifest.json`` byte for byte, so the metric
  list, the comparison points, the ablation arms and the volume floors cannot move
  without a visible diff;
* the **hold-out invariant** — no eval prompt may come from a training world;
* the **insufficient-data floor** — today's fixture corpus is far below it, and the
  manifest says so in a field US-006 reads rather than re-derives;
* the **containment invariant** — every eval row is synthetic tier and
  proprietary-licensed, like the datasets it is drawn from.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from pathlib import Path

import pytest

from pinakes_ml.export_insimul_datasets import DEFAULT_CANDIDATES, DEFAULT_WORLDS
from pinakes_ml.export_slm_eval import DEFAULT_MANIFEST, main
from pinakes_ml.insimul_datasets import (
    INSIMUL_LICENSE,
    LICENSE_CLASS,
    SYNTHETIC_TIER,
    build_datasets,
    build_rule_prompt,
    serialize_examples,
)
from pinakes_ml.slm_pilot import (
    COMPARISON_POINTS,
    EVAL_SET_FILE,
    FROZEN_METRICS,
    GROUNDING_LINE_PREFIXES,
    UNGROUNDED_CONSTRAINT,
    VERDICT_INSUFFICIENT,
    VERDICT_SUFFICIENT,
    VOLUME_FLOORS,
    build_eval_manifest,
    build_eval_set,
    check_floors,
    measure_volumes,
    strip_grounding_block,
)


@pytest.fixture(scope="module")
def datasets():
    return build_datasets(DEFAULT_WORLDS, DEFAULT_CANDIDATES)


@pytest.fixture(scope="module")
def eval_set(datasets):
    return build_eval_set(datasets)


# --- the two prompt arms --------------------------------------------------------


def test_stripping_the_grounding_block_leaves_the_task_intact(datasets) -> None:
    world = datasets.worlds["w-laterre"]
    grounded = build_rule_prompt(world, rule_name="child_inherits_surname")
    ungrounded = strip_grounding_block(grounded)

    assert not any(
        line.startswith(GROUNDING_LINE_PREFIXES) for line in ungrounded.splitlines()
    )
    # The world header + the authoring instruction survive: the ablation removes
    # the grounding, not the task.
    assert ungrounded.splitlines()[0] == grounded.splitlines()[0]
    assert "Write ONE Prolog rule named `child_inherits_surname`" in ungrounded
    assert ungrounded.endswith(
        UNGROUNDED_CONSTRAINT + "emit a single clause ending in a period."
    )
    assert "listed above" not in ungrounded


def test_stripping_is_idempotent(datasets) -> None:
    world = datasets.worlds["w-laterre"]
    once = strip_grounding_block(build_rule_prompt(world, rule_name="r"))
    assert strip_grounding_block(once) == once


# --- the frozen eval set --------------------------------------------------------


def test_eval_prompts_come_only_from_held_out_worlds(datasets, eval_set) -> None:
    held = set(datasets.splits.held_out_worlds)
    assert held, "the fixture build must hold a world out"
    assert {p.world_id for p in eval_set} <= held


def test_eval_set_has_one_row_per_distinct_prompt(datasets, eval_set) -> None:
    held = set(datasets.splits.held_out_worlds)
    expected = {e.prompt_id for e in datasets.sft if e.world_id in held}
    assert {p.prompt_id for p in eval_set} == expected
    assert len({p.prompt_id for p in eval_set}) == len(eval_set)


def test_the_reference_completion_is_the_accepted_rule(datasets, eval_set) -> None:
    accepted = {
        e.prompt_id: e for e in datasets.sft if e.accepted
    }
    for prompt in eval_set:
        if prompt.has_reference:
            assert prompt.reference_completion == accepted[prompt.prompt_id].completion
        else:
            assert prompt.reference_completion == ""


def test_every_eval_row_carries_both_arms(eval_set) -> None:
    for prompt in eval_set:
        assert prompt.prompt_ungrounded == strip_grounding_block(prompt.prompt)
        assert prompt.prompt_ungrounded != prompt.prompt


def test_every_eval_row_is_synthetic_tier_and_proprietary(eval_set) -> None:
    for prompt in eval_set:
        assert prompt.tier == SYNTHETIC_TIER
        assert prompt.license == INSIMUL_LICENSE
        assert prompt.license_class == LICENSE_CLASS


def test_a_single_world_build_leaves_nothing_to_train_on() -> None:
    """One world ⇒ it IS the hold-out, so training is empty and the floor says so."""
    single = build_datasets([DEFAULT_WORLDS[1]], DEFAULT_CANDIDATES)
    assert single.splits.held_out_worlds == ("w-vespace-fixture",)
    volumes = measure_volumes(single, build_eval_set(single))
    assert volumes["ruleSftTrain"] == 0
    floor = check_floors(volumes)
    assert floor["verdict"] == VERDICT_INSUFFICIENT
    assert {"evalWorlds", "ruleSftTrain"} <= set(floor["shortfalls"])


def test_no_hold_out_yields_an_empty_eval_set(datasets) -> None:
    """Nothing held out ⇒ an EMPTY eval set, never one drawn from a trained world."""
    stripped = replace(
        datasets, splits=replace(datasets.splits, held_out_worlds=())
    )
    assert build_eval_set(stripped) == []


# --- volumes + the insufficient-data floor --------------------------------------


def test_volumes_partition_the_sft_corpus(datasets, eval_set) -> None:
    volumes = measure_volumes(datasets, eval_set)
    assert volumes["ruleSftTrain"] + volumes["ruleSftHeldOut"] == volumes[
        "ruleSftTotal"
    ]
    assert volumes["ruleSftTotal"] == len(datasets.sft)
    assert volumes["evalWorlds"] == len(datasets.splits.held_out_worlds)


def test_the_fixture_corpus_is_below_every_floor(datasets, eval_set) -> None:
    """The honest US-001 finding: today's corpus cannot support a model verdict."""
    floor = check_floors(measure_volumes(datasets, eval_set))
    assert floor["verdict"] == VERDICT_INSUFFICIENT
    assert sorted(floor["shortfalls"]) == sorted(VOLUME_FLOORS)


def test_a_corpus_clearing_the_floors_reads_sufficient() -> None:
    volumes = {name: floor for name, floor in VOLUME_FLOORS.items()}
    assert check_floors(volumes)["verdict"] == VERDICT_SUFFICIENT


def test_a_missing_volume_key_fails_the_floor_rather_than_passing_it() -> None:
    floor = check_floors({})
    assert floor["verdict"] == VERDICT_INSUFFICIENT
    assert all(check["measured"] == 0 for check in floor["checks"].values())


# --- the committed snapshot -----------------------------------------------------


def test_the_manifest_freezes_the_metrics_and_comparison_points(
    datasets, eval_set
) -> None:
    manifest = build_eval_manifest(datasets, eval_set)
    assert manifest["metrics"] == list(FROZEN_METRICS)
    assert manifest["comparisonPoints"] == list(COMPARISON_POINTS)
    # The ablation's two arms and the production/floor comparisons are all named.
    assert "finetuned-qwen2.5-3b-instruct-ungrounded" in manifest["comparisonPoints"]
    assert "grounded-gemini" in manifest["comparisonPoints"]
    assert "deterministic-translator-floor" in manifest["comparisonPoints"]


def test_the_build_is_deterministic() -> None:
    first = build_datasets(DEFAULT_WORLDS, DEFAULT_CANDIDATES)
    second = build_datasets(DEFAULT_WORLDS, DEFAULT_CANDIDATES)
    assert build_eval_manifest(first, build_eval_set(first)) == build_eval_manifest(
        second, build_eval_set(second)
    )


def test_committed_manifest_matches_a_fresh_build(datasets, eval_set) -> None:
    """The freeze gate — the committed protocol IS a fresh build of the fixtures."""
    manifest = build_eval_manifest(datasets, eval_set)
    committed = json.loads(DEFAULT_MANIFEST.read_text(encoding="utf-8"))
    assert manifest == committed


def test_manifest_hash_matches_the_written_eval_set(datasets, eval_set) -> None:
    manifest = build_eval_manifest(datasets, eval_set)
    body = serialize_examples(eval_set)
    assert (
        hashlib.sha256(body.encode("utf-8")).hexdigest()
        == manifest["files"][EVAL_SET_FILE]["sha256"]
    )


# --- the CLI --------------------------------------------------------------------


def test_cli_check_passes_against_the_committed_manifest(capsys) -> None:
    assert main(["--check", "--no-mlflow"]) == 0
    assert "PASS" in capsys.readouterr().out


def test_cli_check_fails_on_drift(tmp_path: Path) -> None:
    stale = tmp_path / "manifest.json"
    stale.write_text('{"protocolVersion": "0"}\n', encoding="utf-8")
    assert main(["--check", "--no-mlflow", "--manifest", str(stale)]) == 1


def test_cli_writes_the_eval_set_and_manifest(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    manifest_path = tmp_path / "manifest.json"
    assert (
        main(
            [
                "--no-mlflow",
                "--data-dir", str(data_dir),
                "--manifest", str(manifest_path),
            ]
        )
        == 0
    )
    written = json.loads(manifest_path.read_text(encoding="utf-8"))
    rows = (data_dir / EVAL_SET_FILE).read_text(encoding="utf-8").splitlines()
    assert len(rows) == written["files"][EVAL_SET_FILE]["count"]
    assert all(json.loads(row)["tier"] == SYNTHETIC_TIER for row in rows)
