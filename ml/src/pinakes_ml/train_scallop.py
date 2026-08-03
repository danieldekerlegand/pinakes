"""CLI: train the rule-guided link predictor, compare to the PyKEEN baseline.

Reproducer for Phase-5 US-003 (the Scallop pilot's core). Run from ``ml/`` (the
run is local-only — it needs the git-ignored embeddings/splits/queries)::

    uv run python -m pinakes_ml.train_scallop
    # or the console script:
    uv run pinakes-train-scallop

It loads the committed config (``ml/configs/scallop-pilot.json``), the frozen
PyKEEN entity embeddings, the triples splits, and the US-002 training queries;
trains the neural edge predicate end-to-end through the min-max ancestor rule
(:mod:`pinakes_ml.scallop_train`); evaluates filtered MRR/Hits@k on the
held-out ``test`` split; runs the pilot's top-1 predictions through the tier-2
logical-consistency checker; logs everything to MLflow; and upserts the
side-by-side comparison block into ``docs/ml-baselines.md`` (helped / hurt /
neutral verdict vs the pure-PyKEEN baseline). A run summary is written to the
git-ignored ``ml/artifacts/scallop-pilot/`` (reproducible from the config + the
data, so it is not committed — same stance as the QLoRA pipeline).

The equivalent scallopy ``minmaxprob`` program is emitted by
:func:`pinakes_ml.scallop_train.build_scl_program`; running it in real
scallopy is local-only (macOS/arm64 wheel — see ``docs/scallop-pilot.md``), and the
engine-free min-max reference the training loop uses is what produces the numbers
here on any host.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pinakes_ml.consistency import (
    evaluate_consistency,
    load_edge_constraints,
    parse_predictions,
    render_predictions,
)
from pinakes_ml.scallop_train import (
    Comparison,
    PilotConfig,
    base_edges,
    build_model,
    classify_effect,
    load_entity_index,
    load_queries,
    render_comparison_section,
    run_ranking,
    run_training,
    top_completions,
)
from pinakes_ml.scallop_train import (
    extract_marked_section as extract_pilot_section,
)
from pinakes_ml.scallop_train import (
    upsert_marked_section as upsert_pilot_section,
)

# ml/ workspace root and repo root, resolved from this file's location.
_ML_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = _ML_ROOT.parent

DEFAULT_CONFIG = _ML_ROOT / "configs" / "scallop-pilot.json"
DEFAULT_DOC = _REPO_ROOT / "docs" / "ml-baselines.md"
DEFAULT_SCHEMA = _REPO_ROOT / "contracts" / "canonical-schema.json"
DEFAULT_ARTIFACTS = _ML_ROOT / "artifacts" / "scallop-pilot"


def _known_edges(
    triples_dir: Path, entity_index: dict[str, int], relations: tuple[str, ...]
) -> set[tuple[str, int, int]]:
    """Every known-true target edge (train ∪ valid ∪ test) in index space.

    The filter set for filtered ranking — a candidate that is itself a known-true
    edge (other than the target) is removed so it does not push the target's rank
    down. Reads the combined ``triples.tsv`` so a split file being absent can't
    silently shrink it.
    """
    known: set[tuple[str, int, int]] = set()
    for t in parse_predictions(triples_dir / "triples.tsv"):
        if t.relation not in relations:
            continue
        h = entity_index.get(t.head)
        tl = entity_index.get(t.tail)
        if h is not None and tl is not None:
            known.add((t.relation, h, tl))
    return known


def _baseline_metrics(embeddings_dir: Path) -> dict[str, float]:
    """The pure-PyKEEN baseline metrics from the model's committed metadata sidecar."""
    meta = json.loads((embeddings_dir / "metadata.json").read_text(encoding="utf-8"))
    return {k: float(v) for k, v in meta["metrics"].items()}


def _log_to_mlflow(comparison: Comparison, config: PilotConfig) -> None:
    """Log the pilot run (params + both systems' metrics) to MLflow."""
    import mlflow

    from pinakes_ml import start_run

    with start_run(run_name="scallop-pilot"):
        mlflow.log_param("embeddings_model", config.embeddings_model)
        mlflow.log_param("hops", config.hops)
        mlflow.log_param("epochs", config.epochs)
        mlflow.log_param("seed", config.seed)
        mlflow.log_param("verdict", comparison.verdict)
        for key, value in comparison.rule_metrics.items():
            mlflow.log_metric(f"rule_{key.replace('@', '_at_')}", value)
        for key, value in comparison.baseline_metrics.items():
            mlflow.log_metric(f"baseline_{key.replace('@', '_at_')}", value)
        for key, value in (comparison.rule_consistency or {}).items():
            mlflow.log_metric(f"rule_consistency_{key}", value)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--doc", type=Path, default=DEFAULT_DOC)
    parser.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
    parser.add_argument("--artifacts-dir", type=Path, default=DEFAULT_ARTIFACTS)
    parser.add_argument("--epochs", type=int, default=None, help="override config")
    parser.add_argument("--no-mlflow", action="store_true")
    parser.add_argument(
        "--no-doc", action="store_true", help="skip the docs/ml-baselines.md upsert"
    )
    args = parser.parse_args(argv)

    config = PilotConfig.from_json(args.config).resolved(_ML_ROOT)
    if args.epochs is not None:
        config = PilotConfig.from_dict({**config.to_dict(), "epochs": args.epochs})

    embeddings_path = Path(config.embeddings_path)
    triples_dir = Path(config.triples_dir)
    if not embeddings_path.exists():
        parser.error(
            f"embeddings not found: {embeddings_path}\n"
            "They are a git-ignored build output — train the baselines "
            "with `uv run pinakes-train-baselines` first."
        )
    if not (triples_dir / "test.tsv").exists():
        parser.error(
            f"triples splits not found in {triples_dir} "
            "(git-ignored — rebuild it first)."
        )

    import numpy as np

    embeddings = np.load(embeddings_path)
    entity_index = load_entity_index(config.entities_path)
    train_triples = parse_predictions(triples_dir / "train.tsv")
    test_triples = [
        t
        for t in parse_predictions(triples_dir / "test.tsv")
        if t.relation in config.target_relations
    ]
    queries = load_queries(config.queries_path, entity_index, config.target_relations)
    base = base_edges(train_triples, entity_index)
    known = _known_edges(triples_dir, entity_index, config.target_relations)

    print(
        f"embeddings={config.embeddings_model} {embeddings.shape} "
        f"queries={len(queries)} test_targets={len(test_triples)} "
        f"base={ {r: len(p) for r, p in base.items() if r in config.target_relations} }"
    )

    # Rule-guided model (the neural predicate propagated through the ancestor rule).
    model = build_model(embeddings, config)
    report = run_training(model, queries, base, config, epochs=args.epochs)
    print(f"trained {len(report.losses)} epochs; final loss={report.losses[-1]:.4f}")
    metrics = run_ranking(
        model, test_triples, base, entity_index, config, known=known
    )
    rule_metrics = metrics.as_metrics()
    print(
        f"rule-guided: MRR={rule_metrics['mrr']:.4f} "
        f"Hits@1={rule_metrics['hits@1']:.4f} Hits@3={rule_metrics['hits@3']:.4f} "
        f"Hits@10={rule_metrics['hits@10']:.4f} ({metrics.num_ranks} ranks)"
    )

    # Ablation: the identical neural predicate with the rule turned off (no
    # transitive propagation at train OR eval), through the same harness — isolates
    # the rule's contribution without the cross-harness confound of PyKEEN's own eval.
    direct_config = PilotConfig.from_dict(
        {**config.to_dict(), "transitive_relations": []}
    )
    direct_model = build_model(embeddings, direct_config)
    run_training(direct_model, queries, base, direct_config, epochs=args.epochs)
    direct_metrics = run_ranking(
        direct_model, test_triples, base, entity_index, direct_config, known=known
    ).as_metrics()
    print(f"direct-only (rule OFF): MRR={direct_metrics['mrr']:.4f}")

    verdict = classify_effect(direct_metrics["mrr"], rule_metrics["mrr"])
    baseline_metrics = _baseline_metrics(embeddings_path.parent)
    print(
        f"baseline PyKEEN MRR={baseline_metrics['mrr']:.4f} -> "
        f"ablation verdict: rule guidance {verdict}"
    )

    # Tier-2 consistency ablation: both models' top-1 completions over the identical
    # target-relation prediction set (rule-off vs rule-on), so the rule's effect on
    # logical consistency is isolated the same way the metric ablation is.
    constraints = load_edge_constraints(args.schema)
    predictions = top_completions(model, test_triples, base, entity_index, config)
    rule_report = evaluate_consistency("rule-guided", predictions, constraints)
    direct_predictions = top_completions(
        direct_model, test_triples, base, entity_index, direct_config
    )
    direct_report = evaluate_consistency("direct-only", direct_predictions, constraints)
    print(
        f"tier-2 (rule): cycles={rule_report.counts['descentCycles']} "
        f"breaches={rule_report.counts['schemaTypeBreaches']} "
        f"asymmetry={rule_report.counts['asymmetryViolations']}"
    )

    comparison = Comparison(
        baseline_model=config.embeddings_model,
        baseline_metrics=baseline_metrics,
        direct_metrics=direct_metrics,
        rule_metrics=rule_metrics,
        verdict=verdict,
        direct_consistency=dict(direct_report.counts),
        rule_consistency=dict(rule_report.counts),
        num_ranks=metrics.num_ranks,
    )

    # Run summary (git-ignored — reproducible from config + the data tree).
    args.artifacts_dir.mkdir(parents=True, exist_ok=True)
    summary = {
        "config": config.to_dict(),
        "comparison": comparison.as_dict(),
        "losses": report.losses,
    }
    (args.artifacts_dir / "run-summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    (args.artifacts_dir / "predictions.tsv").write_text(
        render_predictions(predictions), encoding="utf-8"
    )
    print(f"run summary -> {args.artifacts_dir / 'run-summary.json'}")

    if not args.no_doc:
        section = render_comparison_section(comparison, config)
        existing = args.doc.read_text(encoding="utf-8") if args.doc.exists() else ""
        args.doc.parent.mkdir(parents=True, exist_ok=True)
        args.doc.write_text(upsert_pilot_section(existing, section), encoding="utf-8")
        print(f"comparison -> {args.doc}")

    if not args.no_mlflow:
        _log_to_mlflow(comparison, config)
    return 0


# Re-exported so a `train-baselines` doc rewrite can preserve the pilot block, the
# same cooperating-CLIs discipline as the KGQA tier-3 section.
__all__ = ["extract_pilot_section", "main", "upsert_pilot_section"]


if __name__ == "__main__":  # pragma: no cover - CLI entry
    raise SystemExit(main())
