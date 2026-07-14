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
    generate_predictions,
    load_split_factories,
    render_baselines_doc,
    train_baseline,
)
from linguascrape_ml.consistency import (
    ANTISYMMETRIC_RELATIONS,
    DESCENT_RELATION,
    SYMMETRIC_RELATIONS,
    ConsistencyReport,
    build_baseline,
    compare_to_baseline,
    evaluate_consistency,
    load_edge_constraints,
    parse_predictions,
    render_predictions,
)
from linguascrape_ml.finetune import (
    FineTuneConfig,
    FineTuneResult,
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
from linguascrape_ml.kgqa import (
    QAExample,
    apply_polish,
    build_graph,
    split_examples,
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
from linguascrape_ml.verbalize import (
    ATTRIBUTE_TEMPLATES,
    EDGE_TEMPLATES,
    Example,
    NodeInfo,
    build_examples,
    load_edge_rows,
    load_nodes,
    serialize_examples,
)

__all__ = [
    "ANTISYMMETRIC_RELATIONS",
    "ATTRIBUTE_TEMPLATES",
    "BASELINE_SEED",
    "DEFAULT_EXPERIMENT",
    "DEFAULT_MODELS",
    "DESCENT_RELATION",
    "EDGE_TEMPLATES",
    "EXCLUDED_RELATIONS",
    "METRIC_KEYS",
    "SYMMETRIC_RELATIONS",
    "BaselineOutcome",
    "ConsistencyReport",
    "Example",
    "FineTuneConfig",
    "FineTuneResult",
    "NodeInfo",
    "QAExample",
    "Triple",
    "apply_polish",
    "assemble_dataset",
    "before_after_report",
    "build_baseline",
    "build_examples",
    "build_graph",
    "build_manifest",
    "build_qa_instruction",
    "build_verbalization_instruction",
    "compare_to_baseline",
    "default_tracking_uri",
    "evaluate_consistency",
    "evaluate_systems",
    "format_prompt",
    "format_training_text",
    "generate_predictions",
    "load_edge_constraints",
    "load_edge_rows",
    "load_nodes",
    "load_split_factories",
    "load_triples",
    "parse_predictions",
    "render_baselines_doc",
    "render_predictions",
    "require_finetune_deps",
    "resolve_device",
    "serialize_examples",
    "split_examples",
    "split_triples",
    "start_run",
    "tracking_uri",
    "train_baseline",
    "__version__",
]

__version__ = "0.1.0"
