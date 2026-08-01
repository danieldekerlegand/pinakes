"""Smoke tests for the ml/ workspace — imports + MLflow file backend.

Deliberately import-only / tiny: no model training runs in CI (that is
local-only per the neurosymbolic roadmap Phase 2). These assert the environment
is wired correctly and the tracking helper actually writes to the file backend.
"""

from __future__ import annotations

from pathlib import Path

import mlflow

from pinakes_ml import (
    DEFAULT_EXPERIMENT,
    default_tracking_uri,
    start_run,
    tracking_uri,
)


def test_core_ml_stack_imports() -> None:
    """The CI-smoke trio (torch/pykeen/problog) plus the HF + tracking stack import."""
    import datasets  # noqa: F401
    import problog  # noqa: F401
    import pykeen  # noqa: F401
    import sentence_transformers  # noqa: F401
    import torch  # noqa: F401

    # torch always exposes a device selector; MPS only on Apple, CPU everywhere.
    assert torch.device("cpu").type == "cpu"


def test_tracking_uri_prefers_env(monkeypatch) -> None:
    monkeypatch.setenv("MLFLOW_TRACKING_URI", "file:/tmp/custom-mlruns")
    assert tracking_uri() == "file:/tmp/custom-mlruns"
    monkeypatch.delenv("MLFLOW_TRACKING_URI", raising=False)
    assert tracking_uri() == default_tracking_uri()


def test_default_tracking_uri_points_into_ml_workspace() -> None:
    uri = default_tracking_uri()
    assert uri.startswith("file:")
    assert uri.endswith("/mlruns")


def test_start_run_logs_to_file_backend(tmp_path: Path, monkeypatch) -> None:
    """A run started via the helper lands params/metrics in a local file store."""
    store = tmp_path / "mlruns"
    monkeypatch.setenv("MLFLOW_TRACKING_URI", store.as_uri())

    with start_run(run_name="smoke") as run:
        mlflow.log_param("model", "smoke-test")
        mlflow.log_metric("value", 1.0)
        run_id = run.info.run_id

    assert store.exists()
    fetched = mlflow.get_run(run_id)
    assert fetched.data.params["model"] == "smoke-test"
    assert fetched.data.metrics["value"] == 1.0
    assert mlflow.get_experiment(fetched.info.experiment_id).name == DEFAULT_EXPERIMENT
