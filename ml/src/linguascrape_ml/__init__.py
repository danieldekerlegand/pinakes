"""LinguaScrape ML / neurosymbolic workspace.

Phase 2 of ``NEUROSYMBOLIC_ROADMAP.md``: the first fact->model loop
(triples export, PyKEEN baselines, ProbLog emitter, consistency ratchet)
built on the current corpus scale so later corpus growth is measurable.

Reproducibility is enforced structurally: pinned seeds, committed split
manifests, DVC-tracked datasets, and MLflow-logged runs.
"""

from linguascrape_ml.baselines import (
    BASELINE_SEED,
    DEFAULT_MODELS,
    METRIC_KEYS,
    BaselineOutcome,
    load_split_factories,
    render_baselines_doc,
    train_baseline,
)
from linguascrape_ml.tracking import (
    DEFAULT_EXPERIMENT,
    default_tracking_uri,
    start_run,
    tracking_uri,
)
from linguascrape_ml.triples import (
    EXCLUDED_RELATIONS,
    Triple,
    build_manifest,
    load_triples,
    split_triples,
)

__all__ = [
    "BASELINE_SEED",
    "DEFAULT_EXPERIMENT",
    "DEFAULT_MODELS",
    "EXCLUDED_RELATIONS",
    "METRIC_KEYS",
    "BaselineOutcome",
    "Triple",
    "build_manifest",
    "default_tracking_uri",
    "load_split_factories",
    "load_triples",
    "render_baselines_doc",
    "split_triples",
    "start_run",
    "tracking_uri",
    "train_baseline",
    "__version__",
]

__version__ = "0.1.0"
