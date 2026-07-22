"""Unit tests for the GGUF deployment leg (slm-pilot US-004).

What these tests exist to hold:

* **the prompt contract cannot drift from what the model was trained on.** The
  committed ``ml/manifests/slm-prompt-contract.json`` is a pure function of the
  pipeline's own renderers, so the snapshot gate here is a real CI gate — and it
  is the tripwire for "Insimul is now sending a different string than the one we
  measured";
* **the quantization budget was frozen, not chosen.** ``QUANT_BUDGET_*`` mirrors
  ``docs/slm-pilot-protocol.md`` §5 bar 3, and a missing column is reported as
  ``not-measured`` rather than passing the gate by default;
* **a parity check compares two columns on ONE eval set.** The CLI refuses an HF
  summary whose ``evalSetSha256`` differs from the eval set it rebuilt;
* **the CI-safe smokes stay model-free.** ``--contract-only`` / ``--dry-run``
  touch no weights, no llama.cpp and no undeclared dependency.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pinakes_ml.export_gguf import (
    _hf_scores,
    _resolve_adapter,
    main,
    render_contract,
)
from pinakes_ml.slm_baseline import DOC_MARK_START as SLM_PILOT_MARK_START
from pinakes_ml.slm_finetune import (
    ARM_GROUNDED,
    ARM_UNGROUNDED,
    RULE_SYSTEM_PROMPT,
    SlmPilotConfig,
    format_inference_prompt,
    format_training_text,
)
from pinakes_ml.slm_gguf import (
    CONVERTER_NAME,
    DEFAULT_QUANT,
    DOC_MARK_END,
    DOC_MARK_START,
    QUANT_BUDGET_ARM,
    QUANT_BUDGET_METRIC,
    QUANT_BUDGET_PP,
    QUANTIZER_NAME,
    RULE_SLOT,
    USER_PROMPT_SLOT,
    VERDICT_OVER,
    VERDICT_UNMEASURED,
    VERDICT_WITHIN,
    build_parity_report,
    build_plan,
    build_prompt_contract,
    convert_command,
    extract_marked_section,
    file_identity,
    find_converter,
    find_quantizer,
    llama_cpp_dir,
    model_stem,
    parity_deltas,
    quant_budget,
    quantize_command,
    render_parity_section,
    require_llama_cpp_tools,
    upsert_marked_section,
)
from pinakes_ml.slm_pilot import FROZEN_METRICS, GROUNDING_LINE_PREFIXES

_ML_ROOT = Path(__file__).resolve().parents[1]
_REPO_ROOT = _ML_ROOT.parent
CONTRACT_FILE = _ML_ROOT / "manifests" / "slm-prompt-contract.json"
PROTOCOL_DOC = _REPO_ROOT / "docs" / "slm-pilot-protocol.md"


def _scores(**overrides: float | None) -> dict:
    """One arm's frozen metric block, filled enough to diff."""
    block: dict[str, float | None] = {metric: 0.0 for metric in FROZEN_METRICS}
    block.update({"prompts": 2, "parsed": 2, "evalLoss": 2.0})
    block.update(overrides)
    return block


@pytest.fixture
def plan(tmp_path: Path):
    return build_plan(
        "Qwen/Qwen2.5-3B-Instruct",
        tmp_path / "adapter",
        tmp_path / "work",
        tmp_path / "models",
        run_name="slm-pilot-3b",
    )


# --- the prompt-template contract ------------------------------------------------


def test_the_committed_contract_matches_a_fresh_build() -> None:
    """The freeze gate. A diff here is a breaking change for Insimul."""
    assert CONTRACT_FILE.exists(), "run `uv run pinakes-export-gguf --contract-only`"
    assert CONTRACT_FILE.read_text(encoding="utf-8") == render_contract()


def test_the_contract_templates_are_the_pipeline_renderers_verbatim() -> None:
    """Transcribing the strings by hand is exactly how a contract goes stale."""
    contract = build_prompt_contract()
    assert contract["inferencePromptTemplate"] == format_inference_prompt(
        USER_PROMPT_SLOT
    )
    assert contract["trainingTextTemplate"] == format_training_text(
        USER_PROMPT_SLOT, RULE_SLOT
    )
    assert contract["systemPrompt"] == RULE_SYSTEM_PROMPT


def test_substituting_the_slot_reproduces_a_real_inference_prompt() -> None:
    """The template is usable as a template, not just as documentation."""
    contract = build_prompt_contract()
    filled = contract["inferencePromptTemplate"].replace(
        USER_PROMPT_SLOT, "Author a rule for La Terre Basse."
    )
    assert filled == format_inference_prompt("Author a rule for La Terre Basse.")


def test_the_contract_system_prompt_carries_no_world_vocabulary() -> None:
    """The grounding lives in the user turn — that is what the ablation strips."""
    contract = build_prompt_contract()
    for prefix in GROUNDING_LINE_PREFIXES:
        assert prefix not in contract["systemPrompt"]
    assert contract["userPrompt"]["production"] == ARM_GROUNDED
    assert set(contract["userPrompt"]["arms"]) == {ARM_GROUNDED, ARM_UNGROUNDED}


def test_the_contract_decoding_is_greedy_and_terminated() -> None:
    """Insimul must decode the way the parity column was scored, or it is void."""
    generation = build_prompt_contract()["generation"]
    assert generation["temperature"] == 0.0
    assert generation["topK"] == 1
    assert build_prompt_contract()["chatTemplate"]["imEnd"] in generation["stop"]


def test_the_contract_manifest_is_json_serializable_and_sorted() -> None:
    text = render_contract()
    assert text.endswith("\n")
    assert json.loads(text) == build_prompt_contract()


# --- the conversion plan ---------------------------------------------------------


def test_the_deliverable_lands_in_the_models_tree_not_the_data_tree(plan) -> None:
    """A 2 GB binary gets its own DVC pointer; intermediates stay git-ignored."""
    assert plan.quantized_gguf.parent.name == "models"
    assert plan.quantized_gguf.name == f"{model_stem('slm-pilot-3b')}.gguf"
    assert plan.merged_dir.parent.name == "work"
    assert plan.f16_gguf.parent.name == "work"


def test_the_commands_name_the_planned_paths(plan) -> None:
    convert = convert_command("python", "/tmp/convert_hf_to_gguf.py", plan)
    assert convert[2] == str(plan.merged_dir)
    assert convert[-3:] == [str(plan.f16_gguf), "--outtype", "f16"][-3:]
    assert "--outfile" in convert
    quantize = quantize_command("/tmp/llama-quantize", plan)
    assert quantize == [
        "/tmp/llama-quantize",
        str(plan.f16_gguf),
        str(plan.quantized_gguf),
        DEFAULT_QUANT,
    ]


def test_the_quant_is_in_the_deliverable_filename() -> None:
    """Insimul's models directory holds several GGUFs; the quant must be visible."""
    assert model_stem("slm-pilot-3b", "Q5_K_M") == "slm-pilot-3b-Q5_K_M"


def test_file_identity_of_a_missing_artifact_is_absent_not_empty(tmp_path) -> None:
    identity = file_identity(tmp_path / "nope.gguf")
    assert identity["exists"] is False and identity["sha256"] == ""
    produced = tmp_path / "yes.gguf"
    produced.write_bytes(b"gguf")
    assert file_identity(produced)["sizeBytes"] == 4


# --- locating the toolchain ------------------------------------------------------


def test_the_toolchain_root_prefers_the_flag_then_the_env(monkeypatch) -> None:
    monkeypatch.setenv("LLAMA_CPP_DIR", "/env/llama.cpp")
    assert llama_cpp_dir("/flag/llama.cpp") == Path("/flag/llama.cpp")
    assert llama_cpp_dir() == Path("/env/llama.cpp")


def test_the_quantizer_is_found_in_the_cmake_build_dir(tmp_path: Path) -> None:
    binary = tmp_path / "build" / "bin" / QUANTIZER_NAME
    binary.parent.mkdir(parents=True)
    binary.write_text("#!/bin/sh\n")
    binary.chmod(0o755)
    assert find_quantizer(tmp_path) == binary
    (tmp_path / CONVERTER_NAME).write_text("# converter\n")
    assert find_converter(tmp_path) is not None


def test_a_missing_tool_is_named_with_an_install_recipe(tmp_path: Path) -> None:
    """The dependency is genuinely optional, so its absence must be actionable."""
    with pytest.raises(SystemExit) as excinfo:
        require_llama_cpp_tools(tmp_path)
    message = str(excinfo.value)
    assert CONVERTER_NAME in message and QUANTIZER_NAME in message
    assert "git clone" in message and "llama-cpp-python" in message


# --- the parity arithmetic -------------------------------------------------------


def test_deltas_cover_only_metrics_both_columns_carry() -> None:
    """An invented zero would read as "no degradation" when it means "unknown"."""
    hf = {ARM_GROUNDED: _scores(parseRate=1.0, evalLoss=2.0)}
    gguf = {ARM_GROUNDED: _scores(parseRate=0.5, evalLoss=None)}
    deltas = parity_deltas(hf, gguf)
    assert deltas[ARM_GROUNDED]["parseRate"] == -0.5
    assert "evalLoss" not in deltas[ARM_GROUNDED]


def test_deltas_skip_an_arm_only_one_column_scored() -> None:
    hf = {ARM_GROUNDED: _scores(), ARM_UNGROUNDED: _scores()}
    gguf = {ARM_GROUNDED: _scores()}
    assert set(parity_deltas(hf, gguf)) == {ARM_GROUNDED}


def test_degradation_is_positive_when_the_quant_scored_worse() -> None:
    """``observedPp`` reads the same way the protocol states the bar."""
    hf = {ARM_GROUNDED: _scores(fullyValid=1.0)}
    gguf = {ARM_GROUNDED: _scores(fullyValid=0.95)}
    budget = quant_budget(hf, gguf)
    assert budget["observedPp"] == pytest.approx(5.0)
    assert budget["withinBudget"] is False and budget["verdict"] == VERDICT_OVER


def test_a_quant_inside_the_budget_passes() -> None:
    hf = {ARM_GROUNDED: _scores(fullyValid=1.0)}
    gguf = {ARM_GROUNDED: _scores(fullyValid=0.99)}
    assert quant_budget(hf, gguf)["verdict"] == VERDICT_WITHIN


def test_a_quant_that_scored_higher_is_a_negative_degradation() -> None:
    """Not clamped to zero: at this eval-set size that is noise worth seeing."""
    hf = {ARM_GROUNDED: _scores(fullyValid=0.5)}
    gguf = {ARM_GROUNDED: _scores(fullyValid=1.0)}
    budget = quant_budget(hf, gguf)
    assert budget["observedPp"] == pytest.approx(-50.0)
    assert budget["verdict"] == VERDICT_WITHIN


def test_a_missing_column_is_not_measured_never_a_pass() -> None:
    budget = quant_budget({ARM_GROUNDED: _scores()}, {})
    assert budget["verdict"] == VERDICT_UNMEASURED
    assert budget["withinBudget"] is None and budget["observedPp"] is None


def test_the_budget_mirrors_the_frozen_protocol() -> None:
    """The threshold was written before training; this is the tripwire on it."""
    assert (QUANT_BUDGET_METRIC, QUANT_BUDGET_PP, QUANT_BUDGET_ARM) == (
        "fullyValid", 2.0, ARM_GROUNDED
    )
    protocol = PROTOCOL_DOC.read_text(encoding="utf-8")
    assert "quantization budget" in protocol.lower()
    assert "`fullyValid`" in protocol and "2pp" in protocol


# --- the report + the doc block --------------------------------------------------


def test_the_report_copies_the_data_floor_verbatim(plan) -> None:
    """US-004 does not re-derive the sufficiency verdict — US-001 owns it."""
    floor = {"verdict": "insufficient-data", "shortfalls": ["evalPrompts"]}
    report = build_parity_report(
        plan,
        {ARM_GROUNDED: _scores(fullyValid=1.0)},
        {ARM_GROUNDED: _scores(fullyValid=1.0)},
        data_floor=floor,
    )
    assert report["dataFloor"] == floor
    assert report["budget"]["verdict"] == VERDICT_WITHIN


def test_the_report_records_which_bytes_were_scored(plan) -> None:
    report = build_parity_report(plan, {}, {})
    assert report["artifact"]["path"] == str(plan.quantized_gguf)
    assert report["plan"]["quant"] == DEFAULT_QUANT


def test_the_doc_block_is_marker_wrapped_and_idempotent(plan) -> None:
    report = build_parity_report(
        plan,
        {ARM_GROUNDED: _scores(fullyValid=1.0, parseRate=1.0)},
        {ARM_GROUNDED: _scores(fullyValid=0.5, parseRate=1.0)},
    )
    section = render_parity_section(report)
    assert section.startswith(DOC_MARK_START)
    assert section.rstrip().endswith(DOC_MARK_END)
    once = upsert_marked_section("# Doc\n", section)
    assert upsert_marked_section(once, section) == once
    assert extract_marked_section(once) is not None
    assert "Δ (gguf − hf)" in section and "-0.500" in section


def test_the_doc_block_warns_when_the_corpus_is_below_the_floor(plan) -> None:
    report = build_parity_report(
        plan,
        {ARM_GROUNDED: _scores()},
        {ARM_GROUNDED: _scores()},
        data_floor={"verdict": "insufficient-data"},
    )
    assert "insufficient-data" in render_parity_section(report)


def test_the_parity_markers_do_not_collide_with_the_baseline_block() -> None:
    """Two co-owned marked blocks; a shared marker would clobber one of them."""
    assert DOC_MARK_START != SLM_PILOT_MARK_START
    assert "SLM-QUANT" in DOC_MARK_START


def test_upsert_appends_when_the_block_is_absent(plan) -> None:
    section = render_parity_section(build_parity_report(plan, {}, {}))
    assert upsert_marked_section("", section).strip().startswith(DOC_MARK_START)


# --- the CLI ---------------------------------------------------------------------


def test_contract_only_writes_the_manifest_and_stops(tmp_path, monkeypatch, capsys):
    target = tmp_path / "manifests" / "slm-prompt-contract.json"
    monkeypatch.setattr("pinakes_ml.export_gguf.CONTRACT_PATH", target)
    assert main(["--contract-only"]) == 0
    assert target.read_text(encoding="utf-8") == render_contract()
    assert "contract ->" in capsys.readouterr().out


def test_the_check_gate_fails_on_a_drifted_contract(tmp_path, monkeypatch, capsys):
    target = tmp_path / "slm-prompt-contract.json"
    monkeypatch.setattr("pinakes_ml.export_gguf.CONTRACT_PATH", target)
    target.write_text("{}\n", encoding="utf-8")
    assert main(["--check"]) == 1
    assert "DRIFT" in capsys.readouterr().out
    target.write_text(render_contract(), encoding="utf-8")
    assert main(["--check"]) == 0


def test_the_dry_run_prints_both_commands_and_writes_no_model(
    tmp_path, monkeypatch, capsys
):
    """The CI-safe smoke: no adapter, no llama.cpp, no undeclared dependency."""
    monkeypatch.setattr(
        "pinakes_ml.export_gguf.CONTRACT_PATH", tmp_path / "contract.json"
    )
    models = tmp_path / "models"
    assert main(["--dry-run", "--models-dir", str(models), "--work-dir",
                 str(tmp_path / "work")]) == 0
    out = capsys.readouterr().out
    assert CONVERTER_NAME in out and QUANTIZER_NAME in out and DEFAULT_QUANT in out
    assert not models.exists()


def test_the_cli_refuses_an_hf_column_scored_on_another_eval_set(tmp_path: Path):
    """Two columns on two eval sets is not a parity check."""
    summary = tmp_path / "run-summary.json"
    summary.write_text(
        json.dumps({"dataset": {"evalSetSha256": "deadbeef"}, "scores": {}}),
        encoding="utf-8",
    )
    with pytest.raises(SystemExit) as excinfo:
        _hf_scores(summary, "cafef00d")
    assert "not a parity check" in str(excinfo.value)


def test_a_summary_without_finetuned_scores_is_refused(tmp_path: Path):
    summary = tmp_path / "run-summary.json"
    summary.write_text(
        json.dumps({"dataset": {"evalSetSha256": "abc"}, "scores": {"untuned": {}}}),
        encoding="utf-8",
    )
    with pytest.raises(SystemExit):
        _hf_scores(summary, "abc")
    assert _hf_scores(
        _write_ok_summary(tmp_path, "abc"), "abc"
    )[0]["grounded"]["parseRate"] == 1.0


def _write_ok_summary(tmp_path: Path, sha: str) -> Path:
    path = tmp_path / "ok-summary.json"
    path.write_text(
        json.dumps(
            {
                "dataset": {"evalSetSha256": sha},
                "scores": {"finetuned": {"grounded": {"parseRate": 1.0}}},
            }
        ),
        encoding="utf-8",
    )
    return path


def test_a_missing_summary_points_at_the_baseline_run(tmp_path: Path):
    with pytest.raises(SystemExit) as excinfo:
        _hf_scores(tmp_path / "absent.json", "abc")
    assert "pinakes-train-slm" in str(excinfo.value)


def test_the_adapter_defaults_to_repeat_one_then_the_flat_run_dir(tmp_path: Path):
    """A repeated US-003 run writes repeat-N/adapter; a single run writes adapter."""
    config = SlmPilotConfig(output_dir=str(tmp_path / "run"))
    assert _resolve_adapter(config, None) == tmp_path / "run" / "adapter"
    flat = tmp_path / "run" / "adapter"
    flat.mkdir(parents=True)
    assert _resolve_adapter(config, None) == flat
    repeat = tmp_path / "run" / "repeat-1" / "adapter"
    repeat.mkdir(parents=True)
    assert _resolve_adapter(config, None) == repeat
    assert _resolve_adapter(config, tmp_path / "elsewhere") == tmp_path / "elsewhere"
