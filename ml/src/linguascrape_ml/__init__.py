"""LinguaScrape ML / neurosymbolic workspace.

Phase 2 of ``NEUROSYMBOLIC_ROADMAP.md``: the first fact->model loop
(triples export, PyKEEN baselines, ProbLog emitter, consistency ratchet)
built on the current corpus scale so later corpus growth is measurable.

Reproducibility is enforced structurally: pinned seeds, committed split
manifests, DVC-tracked datasets, and MLflow-logged runs.
"""

from linguascrape_ml.tracking import (
    DEFAULT_EXPERIMENT,
    default_tracking_uri,
    start_run,
    tracking_uri,
)

__all__ = [
    "DEFAULT_EXPERIMENT",
    "default_tracking_uri",
    "start_run",
    "tracking_uri",
    "__version__",
]

__version__ = "0.1.0"
