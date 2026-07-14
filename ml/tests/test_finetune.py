"""Tests for the QLoRA fine-tuning pipeline core (US-005).

CI-safe by construction: every test drives the **pure** parts of
``linguascrape_ml.finetune`` (dataset assembly, prompt formatting, config
round-trip, before/after scoring wiring) on tiny in-line fixtures. No model is
loaded and nothing is trained (the ``trl``/``peft`` stack is intentionally absent
in CI — :func:`require_finetune_deps` is asserted to fail there). The live
end-to-end smoke (tiny model on MPS/CPU) is local-only per the runbook.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from linguascrape_ml.finetune import (
    INSTRUCTION_HEADER,
    RESPONSE_HEADER,
    FineTuneConfig,
    assemble_dataset,
    before_after_report,
    build_qa_instruction,
    build_verbalization_instruction,
    evaluate_systems,
    format_prompt,
    format_training_text,
    require_finetune_deps,
    resolve_device,
)
from linguascrape_ml.kgqa_eval import SystemPrediction
from linguascrape_ml.train_finetune import DEFAULT_CONFIG

_ML_ROOT = Path(__file__).resolve().parents[1]
_CONFIG_DIR = _ML_ROOT / "configs"

# --- fixtures -----------------------------------------------------------------

_VERBALIZATION = {
    "head": "cs:archaeological-culture:Q1",
    "head_name": "Merimde culture",
    "kind": "attribute",
    "relation": "DATED",
    "tail": "",
    "tail_name": "",
    "value": "4800 BCE to 4300 BCE",
    "text": "Merimde culture is dated to around 4800 BCE to 4300 BCE.",
}
_VERBALIZATION_EDGE = {
    "head": "cs:language:eng",
    "head_name": "English",
    "kind": "edge",
    "relation": "DESCENDS_FROM",
    "tail": "cs:language:ang",
    "tail_name": "Old English",
    "value": "",
    "text": "English descends from Old English.",
}
_QA = {
    "question": "What is the earliest ancestor of Yarmukian culture?",
    "answer": "Natufian culture",
    "kind": "derivation",
    "evidence": json.dumps(
        [
            {
                "head_name": "Yarmukian culture",
                "relation": "DESCENDS_FROM",
                "tail_name": "Khiamian",
                "head": "a",
                "tail": "b",
            },
            {
                "head_name": "Khiamian",
                "relation": "DESCENDS_FROM",
                "tail_name": "Natufian culture",
                "head": "b",
                "tail": "c",
            },
        ]
    ),
}


# --- prompt formatting --------------------------------------------------------


def test_format_prompt_and_training_text_share_template() -> None:
    prompt = format_prompt("Q?")
    assert prompt.startswith(INSTRUCTION_HEADER)
    assert prompt.endswith(RESPONSE_HEADER)
    full = format_training_text("Q?", "A.")
    assert full == prompt + "A."


# --- instruction-record builders ----------------------------------------------


def test_verbalization_attribute_instruction() -> None:
    rec = build_verbalization_instruction(_VERBALIZATION)
    assert set(rec) == {"prompt", "completion", "text", "source"}
    assert rec["source"] == "verbalization"
    assert rec["completion"] == _VERBALIZATION["text"]
    # attribute facts render as `name [relation] = value`
    assert "Merimde culture [dated] = 4800 BCE to 4300 BCE" in rec["prompt"]
    assert rec["text"] == rec["prompt"] + rec["completion"]


def test_verbalization_edge_instruction() -> None:
    rec = build_verbalization_instruction(_VERBALIZATION_EDGE)
    assert "English --descends from--> Old English" in rec["prompt"]
    assert rec["completion"] == "English descends from Old English."


def test_qa_instruction_walks_reasoning_then_answer() -> None:
    rec = build_qa_instruction(_QA)
    assert rec["source"] == "qa"
    assert rec["prompt"] == format_prompt(_QA["question"])
    # the completion states each grounded step then the answer
    assert "Yarmukian culture descends from Khiamian." in rec["completion"]
    assert "Khiamian descends from Natufian culture." in rec["completion"]
    assert rec["completion"].strip().endswith("Answer: Natufian culture")


def test_qa_instruction_without_evidence_still_answers() -> None:
    rec = build_qa_instruction({"question": "Q?", "answer": "X", "evidence": "[]"})
    assert rec["completion"] == "Answer: X"


def test_all_records_have_uniform_string_keys() -> None:
    records = [
        build_verbalization_instruction(_VERBALIZATION),
        build_verbalization_instruction(_VERBALIZATION_EDGE),
        build_qa_instruction(_QA),
    ]
    keys = {frozenset(r) for r in records}
    assert keys == {frozenset({"prompt", "completion", "text", "source"})}
    assert all(isinstance(v, str) for r in records for v in r.values())


# --- dataset assembly ---------------------------------------------------------


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(json.dumps(r, sort_keys=True) for r in rows) + "\n", encoding="utf-8"
    )


def _tiny_config(tmp_path: Path, **overrides: object) -> FineTuneConfig:
    verb = tmp_path / "verb.jsonl"
    qa = tmp_path / "qa.jsonl"
    _write_jsonl(verb, [_VERBALIZATION, _VERBALIZATION_EDGE] * 5)
    _write_jsonl(qa, [_QA] * 5)
    base = {
        "verbalizations_path": str(verb),
        "qa_train_path": str(qa),
        "qa_eval_path": str(qa),
        "output_dir": str(tmp_path / "out"),
        "max_verbalizations": None,
        "max_qa": None,
        **overrides,
    }
    return FineTuneConfig.from_dict({**FineTuneConfig().to_dict(), **base})


def test_assemble_dataset_combines_both_sources(tmp_path: Path) -> None:
    records = assemble_dataset(_tiny_config(tmp_path))
    assert len(records) == 15  # 10 verbalization + 5 qa
    sources = {r["source"] for r in records}
    assert sources == {"verbalization", "qa"}


def test_assemble_dataset_is_deterministic(tmp_path: Path) -> None:
    config = _tiny_config(tmp_path)
    assert assemble_dataset(config) == assemble_dataset(config)


def test_assemble_dataset_respects_limits(tmp_path: Path) -> None:
    records = assemble_dataset(
        _tiny_config(tmp_path, max_verbalizations=3, max_qa=2)
    )
    assert len(records) == 5
    assert sum(r["source"] == "verbalization" for r in records) == 3
    assert sum(r["source"] == "qa" for r in records) == 2


# --- config -------------------------------------------------------------------


def test_config_round_trips_through_dict() -> None:
    config = FineTuneConfig()
    assert FineTuneConfig.from_dict(config.to_dict()) == config
    # lora modules survive as a tuple internally, list on the wire
    assert isinstance(config.to_dict()["lora_target_modules"], list)
    assert isinstance(config.lora_target_modules, tuple)


def test_config_rejects_unknown_keys() -> None:
    with pytest.raises(ValueError, match="unknown config keys"):
        FineTuneConfig.from_dict({"nonsense": 1})


def test_config_resolved_makes_paths_absolute(tmp_path: Path) -> None:
    config = FineTuneConfig().resolved(tmp_path)
    assert Path(config.verbalizations_path).is_absolute()
    assert Path(config.output_dir).is_absolute()
    assert config.verbalizations_path.startswith(str(tmp_path))


@pytest.mark.parametrize("name", ["finetune-smoke.json", "finetune-gpu.json"])
def test_committed_configs_load(name: str) -> None:
    config = FineTuneConfig.from_json(_CONFIG_DIR / name)
    assert config.base_model
    assert config.verbalizations_path.endswith("verbalizations.jsonl")
    assert config.qa_eval_path.endswith("eval.jsonl")


def test_smoke_config_is_the_cli_default_and_small() -> None:
    assert DEFAULT_CONFIG == _CONFIG_DIR / "finetune-smoke.json"
    config = FineTuneConfig.from_json(DEFAULT_CONFIG)
    # a genuine local smoke: tiny subset, not the whole corpus
    assert config.max_verbalizations is not None and config.max_verbalizations <= 512
    assert config.max_qa is not None and config.max_qa <= 512
    assert not config.load_in_4bit  # MPS/CPU smoke uses the un-quantized path


# --- before/after scoring wiring ----------------------------------------------


def _perfect_system(record: dict[str, object]) -> SystemPrediction:
    return SystemPrediction(answer=str(record["answer"]), evidence=[], answered=True)


def _wrong_system(record: dict[str, object]) -> SystemPrediction:
    return SystemPrediction(answer="", evidence=[], answered=False)


def test_evaluate_systems_scores_each_system() -> None:
    records = [dict(_QA), dict(_QA)]
    out = evaluate_systems(records, {"tuned": _perfect_system, "base": _wrong_system})
    assert out["tuned"]["accuracyExact"] == 1.0
    assert out["base"]["accuracyExact"] == 0.0


def test_before_after_report_computes_deltas() -> None:
    records = [dict(_QA), dict(_QA)]
    before = evaluate_systems(records, {"base": _wrong_system})["base"]
    after = evaluate_systems(records, {"tuned": _perfect_system})["tuned"]
    report = before_after_report(before, after, base_model="tiny", num_records=2)
    assert report["baseModel"] == "tiny"
    assert report["numEvalRecords"] == 2
    assert report["delta"]["accuracyExact"] == 1.0


# --- dependency gate + device -------------------------------------------------


def test_require_finetune_deps_raises_when_stack_absent() -> None:
    """In the slim CI env trl/peft are absent — the gate must say how to install."""
    if all(importlib.util.find_spec(m) is not None for m in ("trl", "peft")):
        pytest.skip("training stack installed locally; the gate is a no-op")
    with pytest.raises(ImportError, match="uv pip install trl peft accelerate"):
        require_finetune_deps()


def test_resolve_device_prefers_override_and_returns_valid() -> None:
    assert resolve_device("cpu") == "cpu"
    assert resolve_device() in {"cuda", "mps", "cpu"}


def test_extract_answer_prefers_marker_then_first_line() -> None:
    from linguascrape_ml.finetune import _extract_answer

    got = _extract_answer("blah blah Answer: Natufian culture\nmore")
    assert got == "Natufian culture"
    assert _extract_answer("Old English\nsomething else") == "Old English"
    assert _extract_answer("   ") == ""
