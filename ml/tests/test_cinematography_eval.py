"""Unit + snapshot tests for the cinematography-adherence eval tier (US-005).

Unit tests exercise each rule on tiny hand-built shot configs. The snapshot tests are
the CI ratchet: the committed constraint vocab is byte-identical to the module, and the
committed adherence baseline equals a fresh eval of the committed shot fixture.
"""

from __future__ import annotations

import json

from pinakes_ml.cinematography_eval import (
    CONSTRAINT_VOCAB,
    SEVERITY_ERROR,
    SEVERITY_WARN,
    build_report,
    evaluate_shotlist,
)
from pinakes_ml.eval_cinematography import (
    DEFAULT_BASELINE,
    DEFAULT_SHOTS,
    DEFAULT_VOCAB,
    load_shots,
)


def _rules(shots, style=None):
    report = evaluate_shotlist(shots, style)
    return {(v.rule_id, v.severity) for v in report.violations}


def test_movement_equipment_compat_is_error() -> None:
    shots = [{"cinematography": {"camera_movement": "drone",
                                 "shot_size": "extreme_close_up"}}]
    assert ("movement_equipment_compat", SEVERITY_ERROR) in _rules(shots)
    assert evaluate_shotlist(shots).ok is False


def test_lens_shot_size_and_time_lighting_are_warnings() -> None:
    assert ("lens_shot_size_sanity", SEVERITY_WARN) in _rules(
        [{"lens": "telephoto", "shot_size": "extreme_wide_shot"}])
    assert ("time_lighting_consistency", SEVERITY_WARN) in _rules(
        [{"time_of_day": "night", "lighting": "natural"}])


def test_aspect_and_focal_rules() -> None:
    assert ("aspect_constraints", SEVERITY_WARN) in _rules(
        [{"lens": "anamorphic", "aspect": "16:9"}])
    # a focal length outside the lens family's range
    assert ("focal_lens_consistency", SEVERITY_WARN) in _rules(
        [{"lens": "wide", "focal_mm": 200}])
    # inside the range → no violation
    assert ("focal_lens_consistency", SEVERITY_WARN) not in _rules(
        [{"lens": "wide", "focal_mm": 24}])


def test_style_era_lock_is_error() -> None:
    style = {"name": "1920s", "forbidden": {"lens": ["anamorphic"]},
             "allowed": {"aspect": ["1.37:1", "4:3"]}}
    # forbidden value → error
    assert ("style_era_lock", SEVERITY_ERROR) in _rules(
        [{"lens": "anamorphic", "aspect": "1.37:1"}], style)
    # out-of-allowed value → error
    assert ("style_era_lock", SEVERITY_ERROR) in _rules(
        [{"lens": "normal", "aspect": "16:9"}], style)
    # compliant shot → no style error
    assert ("style_era_lock", SEVERITY_ERROR) not in _rules(
        [{"lens": "normal", "aspect": "4:3"}], style)


def test_scene_rules_need_the_list() -> None:
    # aspect uniformity: second shot breaks the first's aspect
    shots = [{"aspect": "1.37:1", "shot_size": "medium_shot"},
             {"aspect": "16:9", "shot_size": "medium_shot"}]
    assert ("scene_aspect_uniformity", SEVERITY_WARN) in _rules(shots)
    # size jump: extreme-wide hard-cut to extreme-close-up
    jump = [{"shot_size": "extreme_wide_shot"}, {"shot_size": "extreme_close_up"}]
    assert ("scene_size_jumps", SEVERITY_WARN) in _rules(jump)


def test_counts_by_rule_and_severity() -> None:
    shots = [{"cinematography": {"camera_movement": "drone",
                                 "shot_size": "extreme_close_up"}},
             {"lens": "telephoto", "shot_size": "extreme_wide_shot"}]
    report = evaluate_shotlist(shots)
    by_sev = report.counts_by_severity()
    assert by_sev[SEVERITY_ERROR] >= 1 and by_sev[SEVERITY_WARN] >= 1
    by_rule = report.counts_by_rule()
    # every known rule has a key (zeros included) so a clean list is legible
    assert set(by_rule) == set(CONSTRAINT_VOCAB["ruleSeverity"])
    assert by_rule["movement_equipment_compat"] == 1


def test_blockless_shots_not_checked() -> None:
    report = evaluate_shotlist([{"id": "s1"}, {"id": "s2"}])
    assert report.checked == 0
    assert report.violations == []


def test_report_is_deterministic() -> None:
    shots, style = load_shots(DEFAULT_SHOTS)
    assert build_report(shots, style) == build_report(shots, style)


# --- committed-artifact ratchet (CI gate) -------------------------------------


def test_committed_vocab_matches_module() -> None:
    committed = json.loads(DEFAULT_VOCAB.read_text(encoding="utf-8"))
    assert committed == CONSTRAINT_VOCAB


def test_committed_baseline_matches_fixture() -> None:
    committed = json.loads(DEFAULT_BASELINE.read_text(encoding="utf-8"))
    shots, style = load_shots(DEFAULT_SHOTS)
    assert build_report(shots, style) == committed
