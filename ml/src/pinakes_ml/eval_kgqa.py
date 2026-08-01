"""CLI: score the held-out KGQA split (eval tier 3) + commit the baseline (US-004).

Reproducer for the neurosymbolic roadmap Phase 5, US-004. Run from ``ml/`` (needs
the DVC-tracked corpus + eval split — ``uv run --project ml dvc pull`` first)::

    uv run python -m pinakes_ml.eval_kgqa
    # or the console script:
    uv run pinakes-eval-kgqa

It loads the registered held-out split (:data:`~pinakes_ml.export_kgqa.
REGISTERED_EVAL_SPLIT`), builds the corpus graph from the canonical export, scores
the deterministic ``graph-retrieval`` + ``no-retrieval`` systems (exact / normalized
match + evidence grounding), runs the tier-2 logical-consistency checks over the
evidence each system produced, writes the byte-reproducible baseline to
``ml/manifests/kgqa-eval-baseline.json`` (committed, snapshot-tested), upserts the
tier-3 block into ``docs/ml-baselines.md`` (cross-linking the three tiers), and logs
the run to MLflow.

Everything is deterministic + network-free. The *live* baseline — the same retrieved
subgraphs answered by an off-the-shelf LLM through the existing Gemini proxy — is
local-only and documented in ``docs/kgqa-dataset.md``; it is never required for CI.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pinakes_ml.consistency import load_edge_constraints
from pinakes_ml.export_kgqa import KGQA_EVAL_PATH
from pinakes_ml.kgqa import build_graph
from pinakes_ml.kgqa_eval import (
    DEFAULT_RETRIEVAL_DEPTH,
    build_eval_report,
    default_systems,
    load_records,
    render_kgqa_section,
    upsert_marked_section,
)

# ml/ workspace root and repo root, resolved from this file's location.
_ML_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = _ML_ROOT.parent

DEFAULT_EXPORT_DIR = _REPO_ROOT / "export" / "culturescrape"
DEFAULT_EVAL_SPLIT = KGQA_EVAL_PATH
DEFAULT_BASELINE = _ML_ROOT / "manifests" / "kgqa-eval-baseline.json"
DEFAULT_DOC = _REPO_ROOT / "docs" / "ml-baselines.md"
DEFAULT_SCHEMA = _REPO_ROOT / "shared" / "canonical-schema.json"


def write_baseline(path: Path, report: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def write_doc(doc_path: Path, report: dict[str, object]) -> None:
    """Upsert the tier-3 block into the (existing) tier-1/2 baselines doc.

    If the doc is absent (a fresh checkout that has not run the tier-1 CLI) the
    section is written on its own so the tier-3 result is still committed.
    """
    existing = doc_path.read_text(encoding="utf-8") if doc_path.exists() else ""
    section = render_kgqa_section(report)
    doc_path.parent.mkdir(parents=True, exist_ok=True)
    doc_path.write_text(upsert_marked_section(existing, section), encoding="utf-8")


def build(
    export_dir: Path, eval_split: Path, schema: Path, *, depth: int
) -> dict[str, object]:
    """Pure build: load records + graph + constraints → the eval report."""
    records = load_records(eval_split)
    graph = build_graph(export_dir)
    constraints = load_edge_constraints(schema)
    systems = default_systems(graph, depth=depth)
    return build_eval_report(records, systems, constraints, depth=depth)


def _log_to_mlflow(report: dict[str, object]) -> None:
    import mlflow

    from pinakes_ml import start_run

    with start_run(run_name="kgqa-eval"):
        mlflow.log_param("split", report["split"])
        mlflow.log_param("retrievalDepth", report["retrievalDepth"])
        for name, sysrep in report["systems"].items():  # type: ignore[union-attr]
            metrics = sysrep["metrics"]
            safe = name.replace("-", "_")
            for key in (
                "accuracyExact",
                "accuracyNormalized",
                "groundingRate",
                "answerRate",
            ):
                mlflow.log_metric(f"{safe}_{key}", float(metrics[key]))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export-dir", type=Path, default=DEFAULT_EXPORT_DIR)
    parser.add_argument("--eval-split", type=Path, default=DEFAULT_EVAL_SPLIT)
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--doc", type=Path, default=DEFAULT_DOC)
    parser.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
    parser.add_argument("--depth", type=int, default=DEFAULT_RETRIEVAL_DEPTH)
    parser.add_argument("--no-mlflow", action="store_true")
    args = parser.parse_args(argv)

    if not (args.export_dir / "nodes").exists():
        parser.error(
            f"export not found: {args.export_dir}\n"
            "The canonical export is DVC-tracked — run "
            "`uv run --project ml dvc pull` (or regenerate it with "
            "`npx tsx scripts/export-for-culturescrape.ts`) first."
        )
    if not args.eval_split.exists():
        parser.error(
            f"eval split not found: {args.eval_split}\n"
            "It is DVC-tracked — run `uv run --project ml dvc pull` (or rebuild "
            "with `uv run pinakes-export-kgqa`) first."
        )

    report = build(args.export_dir, args.eval_split, args.schema, depth=args.depth)
    write_baseline(args.baseline, report)
    write_doc(args.doc, report)

    counts = report["counts"]  # type: ignore[index]
    print(f"held-out records={counts['records']} depth={report['retrievalDepth']}")
    for name in sorted(report["systems"]):  # type: ignore[union-attr]
        m = report["systems"][name]["metrics"]  # type: ignore[index]
        print(
            f"  {name:<15} exact={m['accuracyExact']:.4f} "
            f"norm={m['accuracyNormalized']:.4f} "
            f"grounded={m['groundingRate']:.4f} answered={m['answerRate']:.4f}"
        )
    print(f"baseline -> {args.baseline}")
    print(f"doc      -> {args.doc}")

    if not args.no_mlflow:
        _log_to_mlflow(report)
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entry
    raise SystemExit(main())
