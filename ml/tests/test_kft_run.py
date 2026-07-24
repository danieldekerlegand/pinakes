"""Run-output tests for the KFT provider (90-finetune-provider US-2).

What these hold:

* the **telemetry stream is real and well-formed** (KFT §6) — the trainer's own
  per-step log becomes ``{job, step, metrics, ts}`` events, the tier-4 adherence
  scores become the curve's two endpoints, every event has a distinct content
  address, and the terminal event carries the minted model + weight assets;
* the **stub emits no loss** — a fabricated curve is the thing §6 replaces, so
  CI's stream is step-accurate and loss-free, and says ``stub``;
* **§5.4 inheritance is stamped, not implied** — the model and every weight asset
  carry the run's ``local-only`` egress and union license class, and
  :func:`~pinakes_ml.kft_run.check_publishable` refuses to push them across the
  boundary;
* **assets are minted only for bytes that exist**, addressed by content, and
  linked with the KFT §5.3 export matrix's relations;
* the end-to-end ``pinakes-train-slm --stub --kft-job`` path writes both files.

Everything runs on committed files plus tmp dirs: no DVC corpus, no network, no
model, no heavy dependency.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from pinakes_ml import train_slm
from pinakes_ml.kft import DEFAULT_JOB_FIXTURE, JobRejected, admit
from pinakes_ml.kft_run import (
    ARTIFACT_ORDER,
    ARTIFACT_SPECS,
    DEFAULT_AGENT,
    KIND_TERMINAL,
    MEDIA_TYPE_GGUF,
    MEDIA_TYPE_SAFETENSORS,
    REL_DERIVED_FROM,
    REL_VARIANT_OF,
    ROLE_ADAPTER,
    ROLE_GGUF,
    ROLE_MERGED,
    TERMINAL_STATES,
    TelemetryEvent,
    build_provenance,
    check_publishable,
    content_digest,
    mint_model,
    mint_model_id,
    mint_run_outputs,
    mint_weight_assets,
    render_telemetry_jsonl,
    requested_variants,
    step_metrics,
    training_events,
    unsupported_exports,
)
from pinakes_ml.slm_finetune import (
    SlmPilotConfig,
    TrainOutcome,
    planned_steps,
    stub_log_history,
    stub_trainer,
)

_ML_ROOT = Path(__file__).resolve().parents[1]

#: A fixed emission timestamp — the minting core takes ``ts`` as a parameter so
#: a run record is byte-reproducible in a test (the CLI supplies the wall clock).
TS = "2026-07-23T00:00:00.000Z"


@pytest.fixture(scope="module")
def payload() -> dict[str, Any]:
    return json.loads(DEFAULT_JOB_FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture
def admitted(payload):
    return admit(payload)


@pytest.fixture
def summary(admitted) -> dict[str, Any]:
    """A run summary shaped exactly like the pipeline's, from the stub trainer."""
    records = [{"text": f"row {index}"} for index in range(6)]
    outcome = stub_trainer(admitted.config, records)
    return {
        "training": outcome.as_dict(),
        "scores": {
            "untuned": {"grounded": {"fullyValid": 0.0, "parseRate": 0.5}},
            "finetuned": {"grounded": {"fullyValid": 0.25, "parseRate": 1.0}},
        },
    }


# --- the training-telemetry stream (KFT §6) -------------------------------------


def test_the_stream_is_ordered_addressed_and_well_formed(admitted, summary) -> None:
    outputs = mint_run_outputs(admitted, summary, ts=TS)
    events = outputs.telemetry

    assert len(events) >= 3
    for event in events:
        # The §6 event shape, every field populated.
        wire = event.as_dict()
        assert wire["job"] == admitted.anchor.job
        assert wire["ts"] == TS
        assert isinstance(wire["step"], int)
        assert isinstance(wire["metrics"], dict)
        # Optionals this provider does not produce are OMITTED, never nulled.
        assert "checkpoint" not in wire and "samples" not in wire
    # Idempotent under redelivery: one address per event, none colliding.
    ids = [event.event_id for event in events]
    assert len(set(ids)) == len(ids)
    # The adherence curve runs forwards: untuned (step 0) → training → tuned.
    assert events[0].kind == "eval:untuned"
    assert events[-2].kind == "eval:finetuned"
    assert [e.step for e in events] == sorted(e.step for e in events)
    assert outputs.terminal is events[-1]


def test_the_terminal_event_carries_the_run_result(admitted, summary) -> None:
    outputs = mint_run_outputs(admitted, summary, ts=TS)
    terminal = outputs.terminal

    assert terminal.kind == KIND_TERMINAL
    assert terminal.state == "succeeded"
    result = dict(terminal.result or {})
    assert result["model"] == outputs.model.entity_id
    assert result["weights"] == [asset.asset_id for asset in outputs.assets]
    assert result["egress"] == "local-only"
    assert result["eval"] == summary["scores"]
    assert result["evalScenarios"] == list(admitted.job.eval_scenarios)


def test_the_stub_stream_is_step_accurate_and_loss_free(admitted, summary) -> None:
    """A stub trains nothing, so it reports no loss — §6 exists to kill that curve."""
    outputs = mint_run_outputs(admitted, summary, ts=TS)
    train = [e for e in outputs.telemetry if e.kind == "train"]

    assert train, "the stub still produces a stream"
    assert [e.step for e in train] == list(range(1, len(train) + 1))
    assert planned_steps(admitted.config, 6) == len(train)
    for event in train:
        assert set(event.metrics) == {"epoch", "lr"}
        assert "train_loss" not in event.metrics
    # The schedule is real arithmetic over the config, not a decorative ramp.
    assert train[-1].metrics["lr"] < train[0].metrics["lr"]
    assert dict(outputs.terminal.result or {})["stub"] is True


def test_a_real_trainer_log_becomes_the_kft_metric_names() -> None:
    outcome = TrainOutcome(
        adapter_dir="a",
        device="mps",
        num_train_records=4,
        train_loss=0.83,
        log_history=(
            {"loss": 1.2, "learning_rate": 2e-4, "grad_norm": 0.4, "epoch": 1.0,
             "step": 1},
            {"loss": 0.83, "learning_rate": 1.7e-4, "grad_norm": 0.3, "epoch": 2.0,
             "step": 2},
            {"train_runtime": 6.2, "step": 2},
        ),
    )
    events = training_events("cs:activity:x", outcome, ts=TS)

    assert [e.step for e in events] == [1, 2, 2]
    # trl spells them `loss`/`learning_rate`; KFT §6 spells them `train_loss`/`lr`.
    assert events[0].metrics == {
        "train_loss": 1.2, "lr": 2e-4, "grad_norm": 0.4, "epoch": 1.0,
    }
    # A key with no KFT name still travels — reported, never dropped.
    assert events[2].metrics == {"train_runtime": 6.2}
    assert step_metrics({"step": 3, "note": "text", "ok": True}) == {}


def test_the_stream_renders_as_jsonl(admitted, summary) -> None:
    outputs = mint_run_outputs(admitted, summary, ts=TS)
    lines = render_telemetry_jsonl(outputs.telemetry).splitlines()

    assert len(lines) == len(outputs.telemetry)
    assert [json.loads(line) for line in lines] == [
        e.as_dict() for e in outputs.telemetry
    ]


def test_a_nonterminal_completion_state_is_refused(admitted, summary) -> None:
    for state in TERMINAL_STATES:
        assert mint_run_outputs(admitted, summary, ts=TS, state=state)
    with pytest.raises(JobRejected) as excinfo:
        mint_run_outputs(admitted, summary, ts=TS, state="running")
    assert excinfo.value.code == "invalid-lifecycle-state"


# --- the minted model entity (KFT §5.1/§5.2) ------------------------------------


def test_the_model_is_minted_from_the_run_not_the_bytes(admitted) -> None:
    model = mint_model(admitted)

    # Minted, not content-addressed (FT-C): derived from the base entity + the
    # job's PROV activity, both of which exist before a single weight does.
    assert model.entity_id == mint_model_id(admitted)
    assert model.entity_id.startswith("pinakes:model:")
    assert admitted.job.slug in model.entity_id
    assert model.based_on == model.derived_from == "pinakes:model:qwen2.5-3b-instruct"
    assert model.modality == "text-generation"
    assert model.lineage_facts() == (
        f"based_on({model.entity_id}, {model.based_on}).",
        f"derived_from({model.entity_id}, {model.derived_from}).",
    )
    assert json.dumps(model.as_dict(), sort_keys=True)


def test_the_model_inherits_the_egress_gate_verdict(admitted) -> None:
    """KFT §5.4 (FT-A): §4.2 without this is half a gate."""
    model = mint_model(admitted)
    decision = admitted.egress

    assert model.egress == decision.effective == "local-only"
    assert model.local_only
    assert model.license_class == decision.license_class == "proprietary"
    assert model.licenses == decision.licenses
    assert model.tier == "synthetic"


def test_a_local_only_model_cannot_be_published_across_the_boundary(admitted) -> None:
    model = mint_model(admitted)

    # The local destinations the deliverable actually uses.
    check_publishable(model, "filesystem")
    check_publishable(model, "dvc-local")
    for destination in ("huggingface-hub", "kcb-registry", "dvc-remote", "who-knows"):
        with pytest.raises(JobRejected) as excinfo:
            check_publishable(model, destination)
        assert excinfo.value.code == "cross-boundary-publication"
        assert excinfo.value.detail["destination"] == destination
    # An unknown destination is refused, not waved through: for a gate that
    # protects private training data the safe default is refusal.


def test_the_prov_activity_pins_inputs_outputs_and_the_anchor(admitted) -> None:
    model = mint_model(admitted)
    record = build_provenance(admitted, model, ())

    assert record["activity"] == admitted.anchor.job
    assert record["agent"] == DEFAULT_AGENT
    assert record["used"] == list(admitted.anchor.used)
    assert admitted.job.base_model in record["used"]
    assert record["generated"] == [model.entity_id]
    # The reproducibility anchor lives HERE, on the run, because the weights
    # cannot carry it (FT-C).
    assert record["seed"] == admitted.job.seed
    assert record["config_hash"] == admitted.job.config_hash
    assert record["engine_config_hash"] == admitted.anchor.engine_config_hash
    assert record["egress"] == admitted.egress.as_dict()


# --- weight & export assets (KFT §5.3) ------------------------------------------


def _artifacts(tmp_path: Path) -> dict[str, Path]:
    adapter = tmp_path / "adapter"
    adapter.mkdir()
    (adapter / "adapter_model.safetensors").write_bytes(b"adapter-weights")
    (adapter / "adapter_config.json").write_text("{}", encoding="utf-8")
    merged = tmp_path / "merged"
    merged.mkdir()
    (merged / "model.safetensors").write_bytes(b"merged-weights")
    gguf = tmp_path / "slm-Q4_K_M.gguf"
    gguf.write_bytes(b"quantized-weights")
    return {ROLE_ADAPTER: adapter, ROLE_MERGED: merged, ROLE_GGUF: gguf}


def test_the_export_matrix_is_the_lineage_graph(admitted, tmp_path) -> None:
    model = mint_model(admitted)
    assets, pending = mint_weight_assets(admitted, model, _artifacts(tmp_path))

    assert pending == ()
    by_role = {asset.role: asset for asset in assets}
    assert [asset.role for asset in assets] == list(ARTIFACT_ORDER)
    # KFT §5.3, row by row.
    assert by_role[ROLE_ADAPTER].media_type == MEDIA_TYPE_SAFETENSORS
    assert by_role[ROLE_ADAPTER].relation == REL_DERIVED_FROM
    # pinakes holds no bytes for the BASE weights, so the adapter's lineage
    # points at the base ENTITY, whose external anchor resolves them (FT-G).
    assert by_role[ROLE_ADAPTER].derived_from == ("pinakes:model:qwen2.5-3b-instruct",)
    assert by_role[ROLE_MERGED].derived_from == (
        by_role[ROLE_ADAPTER].asset_id,
        "pinakes:model:qwen2.5-3b-instruct",
    )
    # A quantization is a VARIANT of the merged weights, not a new model.
    assert by_role[ROLE_GGUF].media_type == MEDIA_TYPE_GGUF
    assert by_role[ROLE_GGUF].relation == REL_VARIANT_OF
    assert by_role[ROLE_GGUF].derived_from == (by_role[ROLE_MERGED].asset_id,)
    assert by_role[ROLE_GGUF].variant == "Q4_K_M"


def test_every_asset_inherits_the_runs_egress_and_license(admitted, tmp_path) -> None:
    model = mint_model(admitted)
    assets, _ = mint_weight_assets(admitted, model, _artifacts(tmp_path))

    assert assets
    for asset in assets:
        # The §5.4 rule travels with the bytes — a recipient answers "may this
        # ship?" from the envelope, without re-deriving the corpus.
        assert asset.egress == "local-only"
        assert asset.license_class == "proprietary"
        assert asset.licenses == model.licenses
        assert asset.size_bytes > 0
        assert asset.asset_id.startswith("pinakes:asset:sha256-")
        assert asset.content_hash.startswith("sha256:")
        assert json.dumps(asset.as_dict(), sort_keys=True)


def test_an_asset_id_is_a_content_address(admitted, tmp_path) -> None:
    model = mint_model(admitted)
    artifacts = _artifacts(tmp_path)
    before, _ = mint_weight_assets(admitted, model, artifacts)
    # Same bytes → same ids (unlike the model, which cannot be content-addressed).
    assert [a.asset_id for a in mint_weight_assets(admitted, model, artifacts)[0]] == [
        a.asset_id for a in before
    ]

    (artifacts[ROLE_ADAPTER] / "adapter_model.safetensors").write_bytes(b"retrained")
    after, _ = mint_weight_assets(admitted, model, artifacts)
    assert after[0].asset_id != before[0].asset_id
    # A directory's address covers every member, so a new file moves it too.
    (artifacts[ROLE_ADAPTER] / "extra.bin").write_bytes(b"x")
    assert mint_weight_assets(admitted, model, artifacts)[0][0].asset_id != (
        after[0].asset_id
    )


def test_content_digest_addresses_files_and_trees(tmp_path) -> None:
    blob = tmp_path / "one.bin"
    blob.write_bytes(b"abc")
    sha, size = content_digest(blob)
    assert size == 3 and len(sha) == 64
    tree = tmp_path / "tree"
    tree.mkdir()
    (tree / "a.bin").write_bytes(b"ab")
    (tree / "b.bin").write_bytes(b"c")
    tree_sha, tree_size = content_digest(tree)
    assert tree_size == 3
    # A tree address is NOT the concatenation of its bytes — names count.
    assert tree_sha != sha


def test_an_unproduced_export_is_pending_never_invented(admitted, tmp_path) -> None:
    model = mint_model(admitted)
    artifacts = _artifacts(tmp_path)
    artifacts[ROLE_GGUF] = tmp_path / "never-converted.gguf"
    assets, pending = mint_weight_assets(admitted, model, artifacts)

    assert pending == (ROLE_GGUF,)
    assert ROLE_GGUF not in {asset.role for asset in assets}
    # A stub run has produced nothing at all — and mints nothing at all.
    assert mint_weight_assets(admitted, model, {}) == ((), ())


def test_the_requested_exports_are_read_off_the_job(admitted) -> None:
    assert requested_variants(admitted.job.export) == {
        ROLE_GGUF: "Q4_K_M",
        ROLE_ADAPTER: "",
    }
    assert unsupported_exports(admitted.job.export) == ()
    # An export leg this provider does not have is REPORTED, not silently absent.
    assert unsupported_exports(("onnx", "coreml", "gguf:Q8_0")) == ("onnx", "coreml")


def test_the_export_matrix_only_links_to_earlier_roles() -> None:
    """A lineage link may only name an asset already minted."""
    for index, role in enumerate(ARTIFACT_ORDER):
        _, _, sources = ARTIFACT_SPECS[role]
        for source in sources:
            assert source == "base" or source in ARTIFACT_ORDER[:index]


# --- the assembled record + the end-to-end CLI path ------------------------------


def test_the_run_record_is_json_serializable(admitted, summary, tmp_path) -> None:
    outputs = mint_run_outputs(
        admitted, summary, artifacts=_artifacts(tmp_path), ts=TS
    )
    record = outputs.as_dict()

    assert json.loads(json.dumps(record, sort_keys=True)) == record
    assert record["model"]["egress"] == "local-only"
    assert len(record["assets"]) == len(ARTIFACT_ORDER)
    assert record["provenance"]["generated"] == [
        outputs.model.entity_id,
        *(asset.asset_id for asset in outputs.assets),
    ]


def test_the_cli_runs_a_kft_job_end_to_end_on_the_stub(tmp_path, capsys) -> None:
    exit_code = train_slm.main(
        [
            "--stub",
            "--kft-job", str(DEFAULT_JOB_FIXTURE),
            "--output-dir", str(tmp_path),
            "--no-mlflow",
            "--no-doc",
        ]
    )
    assert exit_code == 0

    record = json.loads(
        (tmp_path / train_slm.RUN_RECORD_FILE).read_text(encoding="utf-8")
    )
    events = [
        json.loads(line)
        for line in (tmp_path / train_slm.TELEMETRY_FILE)
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    assert record["model"]["localOnly"] is True
    assert record["telemetry"] == events
    assert events[-1]["state"] == "succeeded"
    assert events[-1]["result"]["model"] == record["model"]["entityId"]
    # Nothing was converted, so nothing was minted — and it says which.
    assert record["pendingExports"] == list(ARTIFACT_ORDER)
    assert "kft model" in capsys.readouterr().out


def test_the_cli_refuses_a_cross_boundary_job_before_training(
    tmp_path, payload, capsys
) -> None:
    job = json.loads(json.dumps(payload))
    job["compute"]["class"] = "single-gpu-a100-80gb"
    job_path = tmp_path / "cloud-job.json"
    job_path.write_text(json.dumps(job), encoding="utf-8")

    exit_code = train_slm.main(
        ["--stub", "--kft-job", str(job_path), "--output-dir", str(tmp_path),
         "--no-mlflow", "--no-doc"]
    )

    assert exit_code == 2
    report = json.loads(capsys.readouterr().out)
    assert report["rejected"] is True
    assert report["code"] == "cross-boundary-compute"
    assert report["provider"] == "pinakes"
    # Refused BEFORE any compute: no run summary, no telemetry, no model.
    assert not (tmp_path / train_slm.SUMMARY_FILE).exists()
    assert not (tmp_path / train_slm.TELEMETRY_FILE).exists()


def test_the_cli_admission_is_host_independent(tmp_path) -> None:
    """The engine config hash must not move with the checkout (US-1's rule)."""
    worlds = [Path(train_slm.DEFAULT_WORLDS[0])]
    admitted = train_slm.admit_kft_job(DEFAULT_JOB_FIXTURE, worlds, [])
    assert not any(w.startswith("/") for w in admitted.config.worlds)
    assert train_slm.repo_relative(worlds[0]) in admitted.config.worlds


# --- the pipeline seam ----------------------------------------------------------


def test_the_stub_trainer_reports_the_schedule_it_would_have_run() -> None:
    config = SlmPilotConfig.from_dict(
        {
            "num_train_epochs": 2.0,
            "per_device_train_batch_size": 2,
            "gradient_accumulation_steps": 1,
            "logging_steps": 1,
            "warmup_ratio": 0.0,
        }
    )
    assert planned_steps(config, 4) == 4
    assert planned_steps(config, 0) == 0
    assert stub_log_history(config, 0) == ()

    history = stub_log_history(config, 4)
    assert [row["step"] for row in history] == [1, 2, 3, 4]
    assert history[-1]["epoch"] == config.num_train_epochs
    assert all("loss" not in row for row in history)
    # The outcome carries it, so the summary does, so the telemetry does.
    assert stub_trainer(config, [{"text": "x"}] * 4).log_history == history


def test_a_telemetry_event_defaults_are_the_spec_optionals() -> None:
    event = TelemetryEvent(job="cs:activity:x", step=7)
    assert event.event_id == "cs:activity:x#train:7"
    assert event.as_dict()["metrics"] == {}
    assert event.checkpoint is None and event.samples == ()


# --- the slim-env invariant (ml/CLAUDE.md) --------------------------------------


def test_importing_kft_run_pulls_in_no_heavy_stack() -> None:
    probe = (
        "import sys, pinakes_ml.kft_run;"
        "print([m for m in ('torch','trl','peft','transformers','datasets')"
        " if m in sys.modules])"
    )
    result = subprocess.run(
        [sys.executable, "-c", probe], capture_output=True, text=True, check=True
    )
    assert result.stdout.strip() == "[]", result.stdout
