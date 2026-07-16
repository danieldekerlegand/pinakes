"""CLI: DeepProbLog feasibility run — the ProbLog scale ceiling + Scallop comparison.

Reproducer for Phase-5 US-004 (the neurosymbolic pilot's go/no-go). Run from ``ml/``::

    uv run python -m pinakes_ml.train_deepproblog
    # or the console script:
    uv run pinakes-deepproblog

It loads the committed config (``ml/configs/deepproblog-pilot.json``) and the
``DESCENDS_FROM`` base facts (the triples ``train`` split), then:

* runs the same rule-guided link-prediction task through the **DeepProbLog / ProbLog**
  stack on a *reduced tractable subgraph* (the task genuinely runs — exact marginals);
* sweeps corpus subset sizes and records where exact knowledge compilation ceils out
  (:func:`~pinakes_ml.deepproblog_pilot.scale_probe`) — the scale ceiling,
  measured;
* upserts the measured scale-probe table into the hand-authored comparison report
  ``docs/neurosymbolic-pilot-report.md`` (marker-wrapped, so the prose analysis is
  preserved), and writes a run summary to the git-ignored ``ml/artifacts/deepproblog/``.

``problog`` is a declared dependency, so the feasibility run happens here on any host.
The neural-AD DeepProbLog training loop itself (``deepproblog`` package) is undeclared
and gated (:func:`~pinakes_ml.deepproblog_pilot.require_deepproblog_deps`), the
same stance as US-003's macOS-only ``scallopy`` backend — and per the measured ceiling
it is not tractable at full corpus scale anyway.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pinakes_ml.consistency import parse_predictions
from pinakes_ml.deepproblog_pilot import (
    FeasibilityConfig,
    evaluate_program,
    has_cycle,
    proof_multiplicity,
    reachable_multihop_pairs,
    render_deepproblog_program,
    render_probe_table,
    render_problog_program,
    scale_probe,
    tractable_subgraph,
    upsert_marked_section,
)

_ML_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = _ML_ROOT.parent

DEFAULT_CONFIG = _ML_ROOT / "configs" / "deepproblog-pilot.json"
DEFAULT_REPORT = _REPO_ROOT / "docs" / "neurosymbolic-pilot-report.md"
DEFAULT_ARTIFACTS = _ML_ROOT / "artifacts" / "deepproblog"


def _base_pairs(triples_dir: Path, relation: str) -> list[tuple[str, str]]:
    """The relation's ``train`` base facts as ordered ``(head, tail)`` pairs."""
    return [
        (t.head, t.tail)
        for t in parse_predictions(triples_dir / "train.tsv")
        if t.relation == relation
    ]


def _reduced_run(
    base_pairs: list[tuple[str, str]], config: FeasibilityConfig
) -> dict[str, object]:
    """Run the task in the ProbLog engine on a tractable reduced subgraph.

    Demonstrates the "same task (or a documented reduced subset) runs in DeepProbLog"
    acceptance: build a small connected descent subgraph, feed the annotated ProbLog
    program to the exact engine, and report the query marginals it computes.
    """
    edges = tractable_subgraph(base_pairs, max_edges=config.reduced_max_edges)
    queries = reachable_multihop_pairs(edges, limit=3)
    program = render_problog_program(edges, config.default_edge_prob, queries)
    result = evaluate_program(program, timeout=config.eval_timeout)
    return {
        "edges": len(edges),
        "queries": len(queries),
        "compiled": result.ok,
        "seconds": round(result.seconds, 4),
        "error": result.error,
        "marginals": result.marginals,
    }


def _log_to_mlflow(summary: dict[str, object], config: FeasibilityConfig) -> None:
    """Log the feasibility run (params + ceiling summary) to MLflow."""
    import mlflow

    from pinakes_ml import start_run

    points = summary["scaleProbe"]
    assert isinstance(points, list)
    fully_compiled = max(
        (p["num_edges"] for p in points if p["queries_compiled"] == p["num_queries"]),
        default=0,
    )
    with start_run(run_name="deepproblog-feasibility"):
        mlflow.log_param("target_relation", config.target_relation)
        mlflow.log_param("proof_cap", config.proof_cap)
        mlflow.log_metric("largest_fully_compiled_edges", fully_compiled)
        mlflow.log_metric("total_base_edges", int(summary["totalBaseEdges"]))  # type: ignore[arg-type]
        mlflow.log_metric("full_corpus_max_proofs", int(summary["fullCorpusMaxProofs"]))  # type: ignore[arg-type]
        reduced = summary["reducedRun"]
        assert isinstance(reduced, dict)
        mlflow.log_metric("reduced_run_compiled", int(bool(reduced["compiled"])))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--artifacts-dir", type=Path, default=DEFAULT_ARTIFACTS)
    parser.add_argument("--no-mlflow", action="store_true")
    parser.add_argument(
        "--no-doc", action="store_true", help="skip the report probe-table upsert"
    )
    args = parser.parse_args(argv)

    config = FeasibilityConfig.from_json(args.config).resolved(_ML_ROOT)
    triples_dir = Path(config.triples_dir)
    if not (triples_dir / "train.tsv").exists():
        parser.error(
            f"triples splits not found in {triples_dir} (DVC-tracked; "
            "`uv run --project ml dvc pull`)."
        )

    base_pairs = _base_pairs(triples_dir, config.target_relation)
    cyclic = has_cycle(base_pairs)
    print(
        f"target={config.target_relation} base_edges={len(base_pairs)} "
        f"has_cycle={cyclic}"
    )

    # 1) The task genuinely runs in the ProbLog engine on a reduced subgraph.
    reduced = _reduced_run(base_pairs, config)
    print(
        f"reduced run: {reduced['edges']} edges, {reduced['queries']} queries -> "
        f"compiled={reduced['compiled']} ({reduced['seconds']}s) "
        f"marginals={reduced['marginals']}"
    )

    # 2) The scale ceiling, measured.
    points = scale_probe(base_pairs, config)
    for p in points:
        print(
            f"  N={p.num_edges:5d} queries={p.num_queries:2d} "
            f"ground={p.ground_nodes:5d} max_proofs={p.max_proof_multiplicity:6d} "
            f"compiled={p.queries_compiled}/{p.num_queries} "
            f"avg={p.avg_query_seconds:.4f}s"
            + (f" err={p.error}" if p.error else "")
        )

    # Full-corpus proof-multiplicity spot check (the hardness driver).
    full_queries = reachable_multihop_pairs(base_pairs, limit=config.queries_per_size)
    full_mult = proof_multiplicity(base_pairs, full_queries, cap=config.proof_cap)
    max_full = max(full_mult.values(), default=0)
    print(f"full-corpus max proofs/query (cap {config.proof_cap}): {max_full}")

    summary: dict[str, object] = {
        "config": config.to_dict(),
        "totalBaseEdges": len(base_pairs),
        "hasCycle": cyclic,
        "reducedRun": reduced,
        "scaleProbe": [p.as_dict() for p in points],
        "fullCorpusMaxProofs": max_full,
        "deepproblogProgram": render_deepproblog_program(),
    }

    args.artifacts_dir.mkdir(parents=True, exist_ok=True)
    (args.artifacts_dir / "run-summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"run summary -> {args.artifacts_dir / 'run-summary.json'}")

    if not args.no_doc:
        table = render_probe_table(points, has_cycle=cyclic)
        existing = (
            args.report.read_text(encoding="utf-8") if args.report.exists() else ""
        )
        if existing:
            args.report.write_text(
                upsert_marked_section(existing, table), encoding="utf-8"
            )
            print(f"probe table -> {args.report}")
        else:
            print(
                f"report {args.report} not found — commit the authored report first; "
                "the probe table upserts into its DEEPPROBLOG-PROBE marker block."
            )

    if not args.no_mlflow:
        _log_to_mlflow(summary, config)
    return 0


__all__ = ["main"]


if __name__ == "__main__":  # pragma: no cover - CLI entry
    raise SystemExit(main())
