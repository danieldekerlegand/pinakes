"""MLflow tracking wiring for the ``ml/`` workspace.

Every ml/ script logs to a **local file backend** by default (no server, no DB)
so runs are reproducible and self-contained on the dev machine and in CI. The
tracking store lives at ``ml/mlruns`` unless ``MLFLOW_TRACKING_URI`` is set in
the environment (which always wins, e.g. to point at a shared server).

Usage in a training/eval script::

    from linguascrape_ml import start_run

    with start_run(run_name="transe-baseline") as run:
        mlflow.log_param("model", "TransE")
        mlflow.log_metric("mrr", 0.31)

``start_run`` configures the tracking URI and experiment before opening the run,
so a caller never has to touch ``mlflow.set_tracking_uri`` directly.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Iterator

if TYPE_CHECKING:  # pragma: no cover - typing only
    from mlflow import ActiveRun

# Default experiment all Phase-2 baselines log under, so the local MLflow UI
# groups them together.
DEFAULT_EXPERIMENT = "linguascrape-baselines"

# The ml/ workspace root (the directory containing this package's parents).
_ML_ROOT = Path(__file__).resolve().parents[2]


def default_tracking_uri() -> str:
    """File-backend tracking URI under ``ml/mlruns`` (absolute, so cwd-agnostic)."""
    return (_ML_ROOT / "mlruns").resolve().as_uri()


def tracking_uri() -> str:
    """Resolve the tracking URI: ``MLFLOW_TRACKING_URI`` if set, else the file backend."""
    return os.environ.get("MLFLOW_TRACKING_URI") or default_tracking_uri()


def configure_tracking(experiment: str = DEFAULT_EXPERIMENT) -> str:
    """Point MLflow at the resolved tracking URI + experiment. Returns the URI."""
    import mlflow

    uri = tracking_uri()
    mlflow.set_tracking_uri(uri)
    mlflow.set_experiment(experiment)
    return uri


@contextmanager
def start_run(
    run_name: str | None = None,
    experiment: str = DEFAULT_EXPERIMENT,
) -> Iterator["ActiveRun"]:
    """Configure tracking + open an MLflow run as a context manager."""
    import mlflow

    configure_tracking(experiment)
    with mlflow.start_run(run_name=run_name) as run:
        yield run
