"""CLI: build the triple-verbalization JSONL dataset + committed manifest.

Reproducer for US-002 (neurosymbolic roadmap Phase 5). Run from anywhere::

    uv run python -m pinakes_ml.export_verbalizations

or via the console script::

    uv run pinakes-export-verbalizations

Reads the DVC-tracked canonical export (``export/culturescrape/{nodes,edges}``),
writes the HF-datasets-compatible JSONL into ``ml/data/verbalizations/`` (DVC-
tracked, git-ignored), and writes the deterministic manifest to
``ml/manifests/verbalization-manifest.json`` (committed to git, snapshot-tested).
The whole build is a pure function of the export + seed, so a byte-identical
corpus is a git no-op on the manifest.

After running, re-pin the data with ``dvc add ml/data`` and commit the updated
``ml/data.dvc`` alongside the manifest.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pinakes_ml.verbalize import (
    DEFAULT_SEED,
    Example,
    build_examples,
    build_manifest,
    serialize_examples,
)

# ml/ workspace root and repo root, resolved from this file's location.
_ML_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = _ML_ROOT.parent

DEFAULT_EXPORT_DIR = _REPO_ROOT / "export" / "culturescrape"
DEFAULT_DATA_DIR = _ML_ROOT / "data" / "verbalizations"
DEFAULT_MANIFEST = _ML_ROOT / "manifests" / "verbalization-manifest.json"


def write_dataset(data_dir: Path, examples: list[Example]) -> None:
    """Emit the JSONL dataset (one record per line, trailing newline)."""
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "verbalizations.jsonl").write_text(
        serialize_examples(examples), encoding="utf-8"
    )


def write_manifest(manifest_path: Path, manifest: dict) -> None:
    """Write the committed manifest (stable JSON, trailing newline)."""
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def build(
    export_dir: Path, *, seed: int = DEFAULT_SEED
) -> tuple[list[Example], dict]:
    """Pure build: examples + manifest. No filesystem writes, no MLflow."""
    examples, skipped = build_examples(export_dir, seed=seed)
    manifest = build_manifest(examples, skipped, seed=seed)
    return examples, manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export-dir", type=Path, default=DEFAULT_EXPORT_DIR)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument(
        "--no-mlflow",
        action="store_true",
        help="Skip MLflow logging (default logs the build as a run).",
    )
    args = parser.parse_args(argv)

    if not (args.export_dir / "nodes").exists():
        parser.error(
            f"export not found: {args.export_dir}\n"
            "The canonical export is DVC-tracked — run "
            "`uv run --project ml dvc pull` (or regenerate it with "
            "`npx tsx scripts/export-for-culturescrape.ts`) first."
        )

    examples, manifest = build(args.export_dir, seed=args.seed)
    write_dataset(args.data_dir, examples)
    write_manifest(args.manifest, manifest)

    counts = manifest["counts"]
    print(
        f"examples={counts['examples']} "
        f"(edges={counts['edges']} attributes={counts['attributes']})"
    )
    print(f"data     -> {args.data_dir / 'verbalizations.jsonl'}")
    print(f"manifest -> {args.manifest}")

    if not args.no_mlflow:
        _log_to_mlflow(manifest)
    return 0


def _log_to_mlflow(manifest: dict) -> None:
    """Log the dataset build as an MLflow run so the dataset is traceable."""
    import mlflow

    from pinakes_ml import start_run

    counts = manifest["counts"]
    with start_run(run_name="verbalizations-export"):
        mlflow.log_param("seed", manifest["seed"])
        mlflow.log_param("sha256", manifest["sha256"])
        for key, value in counts.items():
            mlflow.log_metric(f"count_{key}", value)
        for relation, value in manifest["edgeCounts"].items():
            mlflow.log_metric(f"edge_{relation}", value)


if __name__ == "__main__":  # pragma: no cover - CLI entry
    raise SystemExit(main())
