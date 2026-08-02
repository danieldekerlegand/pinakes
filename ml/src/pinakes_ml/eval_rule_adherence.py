"""CLI: the Prolog rule-adherence eval tier — the VESPACE port (US-004).

Reproducer for the fourth eval tier. Run from anywhere::

    uv run python -m pinakes_ml.eval_rule_adherence   # pinakes-eval-rule-adherence

Reads a ``CanonicalWorldExport`` (the world context: vocabulary + entity snapshot
+ action set) and a candidate rule set, scores the rules with
:mod:`pinakes_ml.rule_adherence`, and writes two committed, byte-reproducible
artifacts:

* ``ml/manifests/rule-adherence-baseline.json`` — the full report (validity
  rates, reachability/fireability stats, dead-condition table, per-rule rows).
  A snapshot: a fresh eval of the committed fixtures must equal it.
* the ``RULE-ADHERENCE``-marked tier-4 section of ``docs/ml-baselines.md``,
  upserted like the tier-3 KGQA block so the cooperating CLIs never clobber
  each other.

``--check`` re-evaluates and exits non-zero on any drift from the committed
baseline (no writes) — the retraining-free gate an operator can run by hand.
Point ``--world`` at a real converted world (e.g. the bridge-2 fixture at
``engine/tests/fixtures/insimul/world-export.json``) and
``--rules`` at that world's own export to score a generated world in place.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pinakes_ml.rule_adherence import (
    DEFAULT_ACTION_LAMBDA,
    DEFAULT_INTRINSIC_LAMBDA,
    build_report,
    load_rules,
    load_world_context,
    render_adherence_section,
    upsert_marked_section,
)

_ML_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = _ML_ROOT.parent

DEFAULT_WORLD = _ML_ROOT / "fixtures" / "insimul" / "world-export.json"
DEFAULT_RULES = _ML_ROOT / "fixtures" / "insimul" / "generated-rules.json"
DEFAULT_BASELINE = _ML_ROOT / "manifests" / "rule-adherence-baseline.json"
DEFAULT_DOC = _REPO_ROOT / "docs" / "ml-baselines.md"


def _dump(obj: dict) -> str:
    return json.dumps(obj, indent=2, sort_keys=True) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--world", type=Path, default=DEFAULT_WORLD)
    parser.add_argument("--rules", type=Path, default=DEFAULT_RULES)
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--doc", type=Path, default=DEFAULT_DOC)
    parser.add_argument(
        "--intrinsic-lambda", type=float, default=DEFAULT_INTRINSIC_LAMBDA
    )
    parser.add_argument("--action-lambda", type=float, default=DEFAULT_ACTION_LAMBDA)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify the committed baseline matches a fresh eval.",
    )
    parser.add_argument("--no-doc", action="store_true")
    parser.add_argument("--no-mlflow", action="store_true")
    args = parser.parse_args(argv)

    context = load_world_context(args.world)
    rules = load_rules(args.rules)
    report = build_report(
        rules,
        context,
        intrinsic_lambda=args.intrinsic_lambda,
        action_lambda=args.action_lambda,
    )
    baseline_text = _dump(report)

    if args.check:
        if (
            not args.baseline.exists()
            or args.baseline.read_text(encoding="utf-8") != baseline_text
        ):
            print(f"DRIFT  baseline drift: {args.baseline}")
            return 1
        print("PASS   rule-adherence baseline in sync")
        return 0

    args.baseline.parent.mkdir(parents=True, exist_ok=True)
    args.baseline.write_text(baseline_text, encoding="utf-8")

    counts, rates = report["counts"], report["rates"]
    reach = report["reachability"]
    print(f"world      = {context.world_id} ({context.action_count} actions)")
    print(f"rules      = {counts['rules']} ({counts['parsed']} parsed)")
    print(
        "validity   = "
        f"structural {rates['structuralValidity']:.3f} / "
        f"schema {rates['schemaValidity']:.3f} / "
        f"referential {rates['referentialIntegrity']:.3f}"
    )
    print(
        "reachable  = "
        f"charitable {reach['charitable']['mean']:.3f} / "
        f"strict {reach['strict']['mean']:.3f} / "
        f"fireability {reach['fireability']['mean']:.3f}"
    )
    print(f"baseline   -> {args.baseline}")

    if not args.no_doc:
        existing = args.doc.read_text(encoding="utf-8") if args.doc.exists() else ""
        section = render_adherence_section(report)
        args.doc.parent.mkdir(parents=True, exist_ok=True)
        args.doc.write_text(
            upsert_marked_section(existing, section), encoding="utf-8"
        )
        print(f"tier-4 doc -> {args.doc}")

    if not args.no_mlflow:
        _log_to_mlflow(report)
    return 0


def _log_to_mlflow(report: dict) -> None:
    import mlflow

    from pinakes_ml import start_run

    with start_run(run_name="rule-adherence"):
        mlflow.log_param("analyzerVersion", report["analyzerVersion"])
        mlflow.log_param("worldId", report["world"]["worldId"])
        mlflow.log_param("contractVersion", report["world"]["contractVersion"])
        for name, value in report["lambdas"].items():
            mlflow.log_param(f"lambda_{name}", value)
        for name, value in report["counts"].items():
            mlflow.log_metric(f"count_{name}", value)
        for name, value in report["rates"].items():
            mlflow.log_metric(f"rate_{name}", value)
        reach = report["reachability"]
        for key in ("charitable", "strict", "fireability"):
            for stat, value in reach[key].items():
                mlflow.log_metric(f"{key}_{stat}", value)
        for key in (
            "totalConditions",
            "meanConditionsPerRule",
            "medianConditionsPerRule",
            "fullyReachableRules",
            "rulesWithDeadConditions",
            "fullyDeadActionSlice",
        ):
            mlflow.log_metric(key, reach[key])


if __name__ == "__main__":  # pragma: no cover - CLI entry
    raise SystemExit(main())
