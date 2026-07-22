"""Unit tests for the Insimul handoff bundle (slm-pilot US-005).

What these tests exist to hold:

* **a bundle can be re-verified by whoever receives it.** ``verify_bundle``
  catches a missing file, a rewritten file and a truncated one — if it did not,
  shipping the eval set and the hashes would be decoration;
* **the bundle names an eval set this repo still reproduces.** ``--check``'s
  hash tier is fixture-driven, so it is a real CI gate and it fires when the
  bundled ``evalSetSha256`` stops matching a fresh build;
* **nothing machine-local ships.** No absolute path, no operator's home
  directory, in the manifest or in the generated prose;
* **the Insimul-facing settings are derived, not transcribed.** The environment
  block and the decoding settings are functions of the manifest and the frozen
  prompt contract, so they cannot drift from what was measured;
* **the license position is recorded, not inferred.** The pilot's base model is
  under the non-commercial Qwen Research License; the bundle says so in a place
  its consumer cannot miss.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pinakes_ml.export_handoff import main
from pinakes_ml.slm_finetune import RULE_SYSTEM_PROMPT
from pinakes_ml.slm_gguf import CONTRACT_VERSION, build_prompt_contract
from pinakes_ml.slm_handoff import (
    BASE_MODEL_LICENSE,
    BUNDLE_EVAL_FILE,
    BUNDLE_SIDECAR_FILES,
    BUNDLE_VERSION,
    CONTRACT_FILE,
    DATA_PROVENANCE,
    DOC_MARK_END,
    DOC_MARK_START,
    IN_GAME_CHECKLIST,
    LICENSE_FILE,
    MODEL_MANIFEST_FILE,
    README_FILE,
    RUNTIME_GAPS,
    build_model_manifest,
    bundle_entry,
    bundle_inventory,
    extract_marked_section,
    insimul_env_block,
    insimul_generation_settings,
    render_bundle_readme,
    render_handoff_section,
    render_license_notes,
    strip_base,
    upsert_marked_section,
    verify_bundle,
)

_ML_ROOT = Path(__file__).resolve().parents[1]
_REPO_ROOT = _ML_ROOT.parent

RUNBOOK = _REPO_ROOT / "docs" / "slm-insimul-runbook.md"
COMMITTED_MANIFEST = _ML_ROOT / "manifests" / "slm-handoff-manifest.json"
CONFIG_3B = _ML_ROOT / "configs" / "slm-pilot-3b.json"


# --- fixtures -------------------------------------------------------------------


@pytest.fixture
def parity() -> dict:
    """A US-004-shaped parity report, small enough to read in the test."""
    return {
        "plan": {"baseModel": "Qwen/Qwen2.5-3B-Instruct", "quant": "Q4_K_M"},
        "artifact": {
            "path": "/somewhere/ml/models/slm-pilot/pilot-Q4_K_M.gguf",
            "exists": True,
            "sizeBytes": 1929902400,
            "sha256": "a" * 64,
        },
        "dataset": {
            "evalSetSha256": "b" * 64,
            "ruleSftSha256": "c" * 64,
            "matchesFrozenEvalSet": True,
            "evalPromptsScored": 2,
            "heldOutWorlds": ["w-laterre"],
        },
        "dataFloor": {"verdict": "insufficient-data", "shortfalls": ["evalPrompts"]},
        "hfSource": "ml/artifacts/slm-pilot-3b/repeat-1/run-summary.json",
        "scores": {
            "hf": {"grounded": {"fullyValid": 1.0, "evalLoss": 2.46}},
            "gguf": {"grounded": {"fullyValid": 1.0, "evalLoss": 2.67}},
        },
        "deltas": {"grounded": {"fullyValid": 0.0, "evalLoss": 0.21}},
        "budget": {
            "metric": "fullyValid",
            "arm": "grounded",
            "allowedPp": 2.0,
            "observedPp": 0.0,
            "verdict": "within-budget",
        },
        "runtime": {"nCtx": 4096, "quant": "Q4_K_M"},
    }


@pytest.fixture
def baseline() -> dict:
    return {
        "runName": "slm-pilot-3b",
        "repeats": 3,
        "stub": False,
        "chatTemplateVerified": True,
        "ablation": {"schemaValidity": 1.0},
        "config": {
            "base_model": "Qwen/Qwen2.5-3B-Instruct",
            "seed": 20260722,
            "lora_r": 16,
            "output_dir": "/Users/someone/ml/artifacts/slm-pilot-3b",
            "dvc_file": "/Users/someone/ml/data.dvc",
            "eval_manifest": "/Users/someone/ml/manifests/slm-pilot-eval-manifest.json",
            "worlds": ["/Users/someone/ml/fixtures/insimul/world-export.json"],
        },
    }


@pytest.fixture
def manifest(parity: dict, baseline: dict) -> dict:
    return build_model_manifest(
        parity,
        baseline=baseline,
        contract=build_prompt_contract(),
        dataset_dvc_md5="f2030000.dir",
        context_size=4096,
        ml_root="/Users/someone/ml",
    )


def _write_bundle(root: Path, manifest: dict) -> dict:
    """Materialise a bundle on disk and return the manifest with its inventory."""
    root.mkdir(parents=True, exist_ok=True)
    (root / manifest["model"]["file"]).write_bytes(b"gguf-bytes")
    (root / CONTRACT_FILE).write_text("{}", encoding="utf-8")
    (root / BUNDLE_EVAL_FILE).write_text('{"prompt_id": "p1"}\n', encoding="utf-8")
    (root / LICENSE_FILE).write_text(render_license_notes(manifest), encoding="utf-8")
    (root / README_FILE).write_text(render_bundle_readme(manifest), encoding="utf-8")
    filled = dict(manifest)
    filled["model"] = {
        **manifest["model"],
        **{
            key: bundle_entry(root, manifest["model"]["file"])[key]
            for key in ("sha256", "sizeBytes")
        },
    }
    filled["files"] = bundle_inventory(root, BUNDLE_SIDECAR_FILES)
    (root / MODEL_MANIFEST_FILE).write_text(
        json.dumps(filled, indent=2, sort_keys=True), encoding="utf-8"
    )
    return filled


# --- the manifest ---------------------------------------------------------------


def test_the_manifest_carries_provenance_scores_contract_and_license(manifest):
    assert manifest["bundleVersion"] == BUNDLE_VERSION
    assert manifest["model"]["baseModel"] == "Qwen/Qwen2.5-3B-Instruct"
    assert manifest["model"]["file"] == "pilot-Q4_K_M.gguf"
    assert manifest["model"]["sha256"] == "a" * 64
    assert manifest["training"]["config"]["seed"] == 20260722
    assert manifest["dataset"]["evalSetSha256"] == "b" * 64
    assert manifest["dataset"]["evalSetFile"] == BUNDLE_EVAL_FILE
    assert manifest["scores"]["hf"]["grounded"]["fullyValid"] == 1.0
    assert manifest["scores"]["quantizationBudget"]["verdict"] == "within-budget"
    assert manifest["promptContract"]["systemPrompt"] == RULE_SYSTEM_PROMPT
    assert manifest["license"]["baseModel"]["licenseId"] == "qwen-research"
    assert manifest["license"]["trainingData"]["tier"] == "synthetic"


def test_the_data_floor_verdict_rides_along_with_the_scores(manifest):
    # Every pilot artifact carries it, for the same reason: a bundle of scores
    # without the sufficiency verdict reads as a clearance.
    assert manifest["dataFloor"]["verdict"] == "insufficient-data"


def test_the_manifest_ships_no_machine_local_paths(manifest):
    blob = json.dumps(manifest)
    assert "/Users/someone" not in blob
    assert "/somewhere" not in blob
    config = manifest["training"]["config"]
    assert config["dvc_file"] == "data.dvc"
    assert config["eval_manifest"] == "manifests/slm-pilot-eval-manifest.json"
    assert config["worlds"] == ["fixtures/insimul/world-export.json"]
    # output_dir is where one operator's adapter landed; it is not reproducibility.
    assert "output_dir" not in config


@pytest.mark.parametrize(
    ("value", "base", "expected"),
    [
        ("/a/b/c.json", "/a", "b/c.json"),
        ("/a/b/c.json", "/a/", "b/c.json"),
        ("/other/c.json", "/a", "/other/c.json"),
        ("relative.json", "/a", "relative.json"),
        ("/a/b/c.json", "", "/a/b/c.json"),
    ],
)
def test_strip_base_only_relativises_paths_under_the_base(value, base, expected):
    assert strip_base(value, base) == expected


def test_a_missing_baseline_report_does_not_break_the_manifest(parity):
    built = build_model_manifest(parity, contract=build_prompt_contract())
    assert built["training"]["config"] == {}
    assert built["model"]["baseModel"] == "Qwen/Qwen2.5-3B-Instruct"
    assert built["contractVersion"] == CONTRACT_VERSION


# --- the derived Insimul settings -----------------------------------------------


def test_the_environment_block_is_derived_from_the_manifest(manifest):
    env = insimul_env_block(manifest, models_dir="/opt/insimul/models")
    assert env["AI_PROVIDER"] == "local"
    assert env["LOCAL_MODEL_PATH"] == "/opt/insimul/models/pilot-Q4_K_M.gguf"
    # The provider resolves a bare name as `models/<name>.gguf`, so the stem is
    # the name — not the filename.
    assert env["LOCAL_MODEL_NAME"] == "pilot-Q4_K_M"
    assert env["LOCAL_CONTEXT_SIZE"] == "4096"


def test_the_generation_settings_are_the_contracts_own(manifest):
    contract = build_prompt_contract()
    settings = insimul_generation_settings(contract)
    assert settings["temperature"] == contract["generation"]["temperature"] == 0.0
    assert settings["topK"] == 1
    assert settings["maxTokens"] == contract["generation"]["maxNewTokens"]
    assert settings["stop"] == list(contract["generation"]["stop"])
    # And the manifest embeds exactly those, so the doc block cannot drift.
    assert manifest["promptContract"]["generation"] == settings


def test_every_runtime_gap_names_a_file_and_a_required_change():
    assert len(RUNTIME_GAPS) >= 4
    for gap in RUNTIME_GAPS:
        assert gap["where"].endswith(".ts"), gap["id"]
        assert gap["symbol"] and gap["today"] and gap["required"], gap["id"]
    ids = {gap["id"] for gap in RUNTIME_GAPS}
    # The one that voids every measured number if it is not closed.
    assert "chat-wrapper-rebuilds-the-prompt" in ids


def test_the_in_game_checklist_covers_the_acceptance_criterion():
    joined = " ".join(item["step"] + " " + item["detail"] for item in IN_GAME_CHECKLIST)
    assert "test world" in joined  # generate rules in a test world
    assert "validator" in joined  # run the validator gate
    assert "Gemini" in joined  # compare acceptance rate vs Gemini
    for item in IN_GAME_CHECKLIST:
        assert item["step"] and item["detail"]


# --- verification ---------------------------------------------------------------


def test_verify_bundle_is_clean_on_a_freshly_written_bundle(tmp_path, manifest):
    filled = _write_bundle(tmp_path / "bundle", manifest)
    assert verify_bundle(filled, tmp_path / "bundle") == ()


@pytest.mark.parametrize("victim", [CONTRACT_FILE, BUNDLE_EVAL_FILE, README_FILE])
def test_verify_bundle_catches_a_rewritten_file(tmp_path, manifest, victim):
    root = tmp_path / "bundle"
    filled = _write_bundle(root, manifest)
    (root / victim).write_text("tampered", encoding="utf-8")
    problems = verify_bundle(filled, root)
    assert any(victim in problem for problem in problems)


def test_verify_bundle_catches_a_missing_model_and_a_missing_manifest(
    tmp_path, manifest
):
    root = tmp_path / "bundle"
    filled = _write_bundle(root, manifest)
    (root / filled["model"]["file"]).unlink()
    (root / MODEL_MANIFEST_FILE).unlink()
    problems = verify_bundle(filled, root)
    assert any(filled["model"]["file"] in problem for problem in problems)
    assert any(MODEL_MANIFEST_FILE in problem for problem in problems)


def test_verify_bundle_reports_everything_missing_when_nothing_was_pulled(
    tmp_path, manifest
):
    filled = _write_bundle(tmp_path / "bundle", manifest)
    problems = verify_bundle(filled, tmp_path / "empty")
    # model + manifest + every sidecar
    assert len(problems) == len(BUNDLE_SIDECAR_FILES) + 2


# --- the shipped prose ----------------------------------------------------------


def test_the_license_notes_lead_with_the_non_commercial_restriction(manifest):
    notes = render_license_notes(manifest)
    assert "Qwen Research License Agreement" in notes
    assert "PROHIBITED" in notes
    assert BASE_MODEL_LICENSE["requiredNotice"] in notes
    assert "Built with Qwen" in notes
    assert DATA_PROVENANCE["redistribution"] in notes
    assert "/Users/" not in notes


def test_the_bundle_readme_lists_every_file_and_the_floor(manifest):
    readme = render_bundle_readme(manifest)
    for name in (MODEL_MANIFEST_FILE, *BUNDLE_SIDECAR_FILES):
        assert f"`{name}`" in readme
    assert manifest["model"]["file"] in readme
    assert "insufficient-data" in readme
    assert "/Users/" not in readme


def test_the_doc_block_is_marked_and_idempotent(manifest):
    section = render_handoff_section(manifest)
    assert section.startswith(DOC_MARK_START)
    assert section.rstrip().endswith(DOC_MARK_END)
    doc = "# runbook\n\nprose\n"
    once = upsert_marked_section(doc, section)
    assert upsert_marked_section(once, section) == once
    assert extract_marked_section(once) == section.rstrip("\n")
    assert "prose" in once


def test_the_doc_block_carries_the_env_block_gaps_and_checklist(manifest):
    section = render_handoff_section(manifest)
    for key in insimul_env_block(manifest):
        assert key in section
    for gap in RUNTIME_GAPS:
        assert gap["id"] in section
    for item in IN_GAME_CHECKLIST:
        assert item["step"] in section
    assert "within-budget" in section
    assert "insufficient-data" in section


# --- the committed artifacts ----------------------------------------------------


def test_the_committed_runbook_hosts_the_generated_block():
    text = RUNBOOK.read_text(encoding="utf-8")
    assert extract_marked_section(text) is not None
    # The prose half owns the parts a generator cannot state.
    assert "Qwen Research License" in text
    assert "no Insimul repo file" in text


def test_the_committed_manifest_describes_the_shipped_bundle():
    committed = json.loads(COMMITTED_MANIFEST.read_text(encoding="utf-8"))
    assert committed["bundleVersion"] == BUNDLE_VERSION
    assert committed["contractVersion"] == CONTRACT_VERSION
    assert committed["promptContract"]["systemPrompt"] == RULE_SYSTEM_PROMPT
    assert committed["license"]["baseModel"]["licenseId"] == "qwen-research"
    assert [entry["name"] for entry in committed["files"]] == list(
        BUNDLE_SIDECAR_FILES
    )
    assert "/Users/" not in json.dumps(committed)


def test_check_gates_on_the_bundled_eval_set_reproducing(capsys):
    """The CI-safe tier: fixture-driven, no DVC pull, no GGUF."""
    assert main(["--check", "--config", str(CONFIG_3B), "--no-mlflow"]) == 0
    out = capsys.readouterr().out
    assert "eval set reproduces" in out


def test_check_fails_when_the_bundled_eval_set_no_longer_reproduces(
    tmp_path, capsys
):
    committed = json.loads(COMMITTED_MANIFEST.read_text(encoding="utf-8"))
    committed["dataset"]["evalSetSha256"] = "0" * 64
    stale = tmp_path / "stale-manifest.json"
    stale.write_text(json.dumps(committed), encoding="utf-8")
    assert main(
        ["--check", "--config", str(CONFIG_3B), "--manifest", str(stale),
         "--bundle-dir", str(tmp_path / "absent"), "--no-mlflow"]
    ) == 1
    assert "DRIFT" in capsys.readouterr().out


def test_check_reports_a_missing_manifest_rather_than_passing(tmp_path, capsys):
    assert main(
        ["--check", "--config", str(CONFIG_3B),
         "--manifest", str(tmp_path / "nope.json"), "--no-mlflow"]
    ) == 1
    assert "MISSING" in capsys.readouterr().out


def test_dry_run_writes_nothing(tmp_path, capsys):
    bundle = tmp_path / "bundle"
    assert main(
        ["--dry-run", "--config", str(CONFIG_3B), "--bundle-dir", str(bundle),
         "--no-mlflow"]
    ) == 0
    assert not bundle.exists()
    assert "dry run" in capsys.readouterr().out


def test_the_cli_assembles_a_bundle_that_verifies(tmp_path, parity, baseline):
    """The end-to-end shape, model-free: assemble, then re-verify."""
    work = tmp_path / "work"
    (work / "artifacts").mkdir(parents=True)
    parity_path = work / "artifacts" / "parity-report.json"
    baseline_path = work / "artifacts" / "baseline-report.json"
    # The eval set the fixture worlds actually build — the CLI refuses a parity
    # report that names a different one, which is the point of the check.
    from pinakes_ml.export_handoff import _eval_set_text  # noqa: PLC0415
    from pinakes_ml.slm_finetune import SlmPilotConfig  # noqa: PLC0415

    config = SlmPilotConfig.from_json(CONFIG_3B).resolved(_ML_ROOT)
    import argparse  # noqa: PLC0415

    _, eval_sha256 = _eval_set_text(config, argparse.ArgumentParser())
    parity["dataset"]["evalSetSha256"] = eval_sha256
    parity_path.write_text(json.dumps(parity), encoding="utf-8")
    baseline_path.write_text(json.dumps(baseline), encoding="utf-8")

    bundle = tmp_path / "bundle"
    manifest_path = tmp_path / "manifest.json"
    argv = [
        "--config", str(CONFIG_3B), "--bundle-dir", str(bundle),
        "--parity", str(parity_path), "--baseline", str(baseline_path),
        "--manifest", str(manifest_path), "--no-doc", "--no-mlflow",
    ]
    assert main(argv) == 0
    for name in (MODEL_MANIFEST_FILE, *BUNDLE_SIDECAR_FILES):
        assert (bundle / name).exists(), name
    built = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert built["dataset"]["evalSetSha256"] == eval_sha256
    # The GGUF is not materialised here, so it is the only thing missing.
    problems = verify_bundle(built, bundle)
    assert problems == (f"missing: {built['model']['file']}",)


def test_the_cli_refuses_a_parity_report_from_a_different_eval_set(
    tmp_path, parity, baseline
):
    work = tmp_path / "work"
    work.mkdir()
    parity["dataset"]["evalSetSha256"] = "d" * 64
    (work / "parity.json").write_text(json.dumps(parity), encoding="utf-8")
    (work / "baseline.json").write_text(json.dumps(baseline), encoding="utf-8")
    with pytest.raises(SystemExit, match="different eval set"):
        main([
            "--config", str(CONFIG_3B), "--bundle-dir", str(tmp_path / "bundle"),
            "--parity", str(work / "parity.json"),
            "--baseline", str(work / "baseline.json"),
            "--manifest", str(tmp_path / "m.json"), "--no-doc", "--no-mlflow",
        ])


def test_the_cli_explains_itself_when_the_parity_report_is_absent(tmp_path):
    with pytest.raises(SystemExit, match="pinakes-export-gguf"):
        main([
            "--config", str(CONFIG_3B), "--bundle-dir", str(tmp_path / "bundle"),
            "--parity", str(tmp_path / "nope.json"),
            "--manifest", str(tmp_path / "m.json"), "--no-doc", "--no-mlflow",
        ])
