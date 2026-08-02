"""Unit tests for the 3B baseline's comparison table (slm-pilot US-003).

What these tests exist to hold:

* **a frozen comparison point is never dropped.** The table always has one row
  per :data:`~pinakes_ml.slm_pilot.COMPARISON_POINTS` entry, in that order; an
  unmeasurable row carries a *reason*, not an absence;
* **a number is never a single draw.** Repeats aggregate to mean/min/max/n, and
  the doc shows the range whenever the repeats disagreed — the answer to US-002's
  measured finding that two identical MPS runs differ at a pinned seed;
* **no verdict is smuggled into the measurement story.** ``dataFloor`` is copied
  verbatim from the frozen manifest and ``gap_closure`` refuses to invent a ratio
  when the reference row is missing or not above the baseline.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pinakes_ml.slm_baseline import (
    DOC_MARK_END,
    DOC_MARK_START,
    HEADLINE_METRICS,
    NOT_MEASURED_REASONS,
    STAGE_FINETUNED,
    STAGE_GEMINI,
    STAGE_UNTUNED,
    ablation_gaps,
    aggregate_repeats,
    aggregate_single,
    aggregate_values,
    bar_inputs,
    build_baseline_report,
    build_comparison_table,
    extract_marked_section,
    gap_closure,
    gemini_api_key,
    mean_of,
    render_baseline_section,
    spread_of,
    upsert_marked_section,
)
from pinakes_ml.slm_finetune import ARM_GROUNDED, ARM_UNGROUNDED, SlmPilotConfig
from pinakes_ml.slm_pilot import COMPARISON_POINTS, FROZEN_METRICS
from pinakes_ml.train_slm import main, read_data_floor

_ML_ROOT = Path(__file__).resolve().parents[1]


def _scores(parse: float, schema: float, loss: float | None = 1.0) -> dict:
    """One arm's frozen metric block, filled enough to aggregate."""
    block = {metric: 0.0 for metric in FROZEN_METRICS}
    block.update(
        {"prompts": 2, "parsed": 2, "parseRate": parse, "schemaValidity": schema,
         "fullyValid": schema, "evalLoss": loss}
    )
    return block


def _summary(parse: float, schema: float, loss: float | None = 1.0) -> dict:
    return {
        "runName": "slm-pilot-3b",
        "baseModel": "Qwen/Qwen2.5-3B-Instruct",
        "config": {"seed": 20260722},
        "dataset": {
            "evalSetSha256": "abc123def456789",
            "matchesFrozenEvalSet": True,
            "evalPromptsScored": 2,
            "trainRecords": 3,
            "heldOutWorlds": ["w-laterre"],
            "contentHash": "f20307af.dir",
        },
        "training": {"stub": False, "device": "mps", "trainLoss": 0.5,
                     "trainRuntimeSeconds": 6.0},
        "chatTemplateVerified": True,
        "scores": {
            STAGE_UNTUNED: {
                ARM_GROUNDED: _scores(0.5, 0.0, 2.8),
                ARM_UNGROUNDED: _scores(1.0, 0.0, 2.9),
            },
            STAGE_FINETUNED: {
                ARM_GROUNDED: _scores(parse, schema, loss),
                ARM_UNGROUNDED: _scores(parse / 2, 0.0, loss),
            },
        },
    }


@pytest.fixture
def summaries() -> list[dict]:
    """Two repeats that DISAGREE — the case the aggregation exists for."""
    return [_summary(1.0, 1.0, 2.5), _summary(0.5, 0.0, 2.6)]


# --- aggregation ----------------------------------------------------------------


def test_aggregate_values_reports_mean_min_max_n() -> None:
    assert aggregate_values([1.0, 0.0, 0.5]) == {
        "mean": 0.5, "min": 0.0, "max": 1.0, "n": 3
    }


def test_a_missing_draw_is_dropped_not_counted_as_zero() -> None:
    # evalLoss is None when a stage has no reference completions; averaging it
    # in as 0.0 would invent a suspiciously good loss.
    assert aggregate_values([2.0, None]) == {"mean": 2.0, "min": 2.0, "max": 2.0,
                                             "n": 1}
    assert aggregate_values([None, None]) is None
    assert aggregate_values([]) is None


def test_repeats_aggregate_every_frozen_metric(summaries) -> None:
    aggregated = aggregate_repeats(summaries)
    for stage in (STAGE_UNTUNED, STAGE_FINETUNED):
        for arm in (ARM_GROUNDED, ARM_UNGROUNDED):
            block = aggregated[stage][arm]
            assert block["repeats"] == 2
            assert set(FROZEN_METRICS) <= set(block)


def test_the_spread_across_repeats_is_reported(summaries) -> None:
    aggregated = aggregate_repeats(summaries)
    assert mean_of(aggregated, STAGE_FINETUNED, ARM_GROUNDED, "parseRate") == 0.75
    # 1.00 on one draw, 0.50 on the other, at the SAME seed — the platform's
    # nondeterminism, and the reason a lone draw is not a result.
    assert spread_of(aggregated, STAGE_FINETUNED, ARM_GROUNDED, "parseRate") == 0.5
    assert mean_of(aggregated, "nope", ARM_GROUNDED, "parseRate") is None


def test_a_single_pass_aggregates_as_one_draw() -> None:
    aggregated = aggregate_single({ARM_GROUNDED: _scores(1.0, 1.0, None)})
    assert aggregated[ARM_GROUNDED]["repeats"] == 1
    assert aggregated[ARM_GROUNDED]["parseRate"] == {
        "mean": 1.0, "min": 1.0, "max": 1.0, "n": 1
    }
    # Gemini exposes no teacher-forced loss — absent, not zero.
    assert aggregated[ARM_GROUNDED]["evalLoss"] is None


# --- the frozen comparison table ------------------------------------------------


def test_the_table_has_every_frozen_comparison_point_in_order(summaries) -> None:
    rows = build_comparison_table(aggregate_repeats(summaries))
    assert [row["id"] for row in rows] == list(COMPARISON_POINTS)


def test_an_unmeasurable_point_carries_a_reason_not_an_absence(summaries) -> None:
    rows = {r["id"]: r for r in build_comparison_table(aggregate_repeats(summaries))}
    floor = rows["deterministic-translator-floor"]
    assert floor["status"] == "not-measured"
    assert "insimul-platform" in floor["reason"]
    gemini = rows["grounded-gemini"]
    assert gemini["status"] == "not-measured"
    assert "GEMINI_API_KEY" in gemini["reason"]
    assert rows["untuned-qwen2.5-3b-instruct"]["status"] == "measured"


def test_a_measured_gemini_row_fills_the_production_path(summaries) -> None:
    aggregated = aggregate_repeats(summaries)
    aggregated[STAGE_GEMINI] = aggregate_single({ARM_GROUNDED: _scores(1.0, 1.0, None)})
    rows = {r["id"]: r for r in build_comparison_table(aggregated, reasons={})}
    assert rows["grounded-gemini"]["status"] == "measured"
    assert rows["grounded-gemini"]["metrics"]["schemaValidity"]["mean"] == 1.0


def test_a_point_with_no_reason_still_says_it_was_not_measured(summaries) -> None:
    rows = {r["id"]: r for r in build_comparison_table(aggregate_repeats(summaries),
                                                      reasons={})}
    assert rows["grounded-gemini"]["reason"] == "not measured by this run"


# --- the ablation + the bar's arithmetic ----------------------------------------


def test_the_ablation_is_grounded_minus_ungrounded_on_tuned_weights(
    summaries,
) -> None:
    gaps = ablation_gaps(aggregate_repeats(summaries))
    # grounded mean 0.75, ungrounded mean 0.375.
    assert gaps["parseRate"] == 0.375
    assert set(gaps) <= set(FROZEN_METRICS)


def test_gap_closure_is_the_fraction_of_the_reference_gap_closed() -> None:
    assert gap_closure(0.2, 0.6, 1.0) == 0.5
    assert gap_closure(0.2, 1.0, 1.0) == 1.0


@pytest.mark.parametrize(
    "args",
    [(None, 0.6, 1.0), (0.2, None, 1.0), (0.2, 0.6, None), (0.5, 0.6, 0.5),
     (0.9, 0.95, 0.4)],
)
def test_gap_closure_refuses_to_invent_a_ratio(args) -> None:
    # No reference row, or a reference that is not above the baseline — "closing
    # the gap" is undefined and reporting a number would manufacture a result.
    assert gap_closure(*args) is None


def test_the_bar_reports_inputs_and_no_verdict(summaries) -> None:
    bar = bar_inputs(aggregate_repeats(summaries))
    assert bar["gapClosedVsReference"] == {"parseRate": None, "schemaValidity": None}
    assert bar["tuningDelta"]["parseRate"] == 0.25  # untuned 0.50 → tuned mean 0.75
    assert bar["spreadAcrossRepeats"]["parseRate"] == 0.5
    assert "verdict" not in bar


# --- the report -----------------------------------------------------------------


def test_the_report_copies_the_frozen_data_floor_verbatim(summaries) -> None:
    floor = read_data_floor(_ML_ROOT / "manifests" / "slm-pilot-eval-manifest.json")
    report = build_baseline_report(summaries, data_floor=floor)
    assert report["dataFloor"] == floor
    # US-001 measured this; US-003 forwards it and does not re-derive it.
    assert report["dataFloor"]["verdict"] == "insufficient-data"
    assert report["repeats"] == 2
    assert report["training"]["trainLossPerRepeat"] == [0.5, 0.5]
    assert report["cost"]["usd"] == 0.0


def test_a_report_needs_at_least_one_run() -> None:
    with pytest.raises(ValueError, match="at least one run summary"):
        build_baseline_report([])


def test_the_report_carries_a_measured_gemini_stage(summaries) -> None:
    report = build_baseline_report(
        summaries,
        extra_stages={STAGE_GEMINI: {ARM_GROUNDED: _scores(1.0, 1.0, None)}},
        reasons={},
    )
    gemini = {r["id"]: r for r in report["comparison"]}["grounded-gemini"]
    assert gemini["status"] == "measured"
    assert report["bar"]["gapClosedVsReference"]["schemaValidity"] == 0.5


# --- the doc block --------------------------------------------------------------


@pytest.fixture
def section(summaries) -> str:
    floor = read_data_floor(_ML_ROOT / "manifests" / "slm-pilot-eval-manifest.json")
    return render_baseline_section(
        build_baseline_report(summaries, data_floor=floor, wall_clock_seconds=12.5)
    )


def test_the_doc_block_names_every_comparison_point(section: str) -> None:
    assert section.startswith(DOC_MARK_START)
    assert section.rstrip().endswith(DOC_MARK_END)
    for point in COMPARISON_POINTS:
        assert f"`{point}`" in section
    for metric in HEADLINE_METRICS:
        assert metric in section


def test_the_doc_block_shouts_the_insufficient_data_floor(section: str) -> None:
    assert "insufficient-data" in section
    assert "US-006" in section


def test_the_doc_block_shows_the_range_when_repeats_disagree(section: str) -> None:
    assert "0.750 (0.500–1.000)" in section
    assert "float nondeterminism" in section


def test_the_doc_block_explains_every_unmeasured_row(section: str) -> None:
    for reason in NOT_MEASURED_REASONS.values():
        assert reason.split(" ")[0] in section
    assert "never dropped" in section


def test_upserting_the_block_is_idempotent_and_keeps_the_rest(section: str) -> None:
    doc = "# baselines\n\nsome prose\n"
    once = upsert_marked_section(doc, section)
    assert once == upsert_marked_section(once, section)
    assert "some prose" in once
    assert extract_marked_section(once) == section.rstrip("\n")
    assert extract_marked_section(doc) is None
    assert upsert_marked_section(doc, "") == doc


def test_the_block_coexists_with_the_other_marked_sections(section: str) -> None:
    # docs/ml-baselines.md is co-owned by four CLIs; a fifth marker must not
    # disturb the blocks train_baselines preserves.
    from pinakes_ml.rule_adherence import extract_marked_section as extract_tier4

    doc = (_ML_ROOT.parent / "docs" / "ml-baselines.md").read_text(encoding="utf-8")
    tier4 = extract_tier4(doc)
    merged = upsert_marked_section(doc, section)
    assert extract_tier4(merged) == tier4
    assert extract_marked_section(merged) == section.rstrip("\n")


# --- config + CLI ---------------------------------------------------------------


def test_the_3b_config_is_the_frozen_baseline_model_and_split() -> None:
    config = SlmPilotConfig.from_json(_ML_ROOT / "configs" / "slm-pilot-3b.json")
    assert config.base_model == "Qwen/Qwen2.5-3B-Instruct"
    # A different seed or ratio scores a different split — not a comparison point.
    assert (config.seed, config.eval_ratio) == (20260722, 0.25)
    assert config.repeats > 1, "a single MPS draw is not a US-003 number"


def test_the_cli_writes_a_baseline_report_over_repeats(tmp_path: Path) -> None:
    doc = tmp_path / "ml-baselines.md"
    doc.write_text("# baselines\n", encoding="utf-8")
    assert main(["--stub", "--no-mlflow", "--repeats", "2",
                 "--output-dir", str(tmp_path), "--doc", str(doc)]) == 0
    report = json.loads((tmp_path / "baseline-report.json").read_text(encoding="utf-8"))
    assert report["repeats"] == 2
    assert report["stub"] is True
    assert (tmp_path / "repeat-1" / "run-summary.json").exists()
    assert (tmp_path / "repeat-2" / "run-summary.json").exists()
    # A stub run must never publish its (meaningless) scores to the doc.
    assert doc.read_text(encoding="utf-8") == "# baselines\n"


def test_gemini_is_recorded_as_not_requested_without_the_flag(
    tmp_path: Path,
) -> None:
    assert main(["--stub", "--no-mlflow", "--output-dir", str(tmp_path),
                 "--no-doc"]) == 0
    report = json.loads((tmp_path / "baseline-report.json").read_text(encoding="utf-8"))
    row = {r["id"]: r for r in report["comparison"]}["grounded-gemini"]
    assert row["status"] == "not-measured"
    assert "not requested" in row["reason"]


def test_the_gemini_key_comes_from_either_env_var(monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    assert gemini_api_key() == ""
    monkeypatch.setenv("GOOGLE_API_KEY", "k")
    assert gemini_api_key() == "k"


def test_read_data_floor_tolerates_a_missing_manifest(tmp_path: Path) -> None:
    assert read_data_floor(tmp_path / "nope.json") is None
    absent = tmp_path / "m.json"
    absent.write_text("{}", encoding="utf-8")
    assert read_data_floor(absent) is None
