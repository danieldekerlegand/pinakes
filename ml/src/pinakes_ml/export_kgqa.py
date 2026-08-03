"""CLI: build the multi-hop KG-grounded QA dataset + committed manifest (US-003).

Reproducer for the neurosymbolic roadmap Phase 5, US-003. Run from anywhere::

    uv run python -m pinakes_ml.export_kgqa

or via the console script::

    uv run pinakes-export-kgqa

Reads the git-ignored canonical export (``build/corpus/{nodes,edges}``),
writes two HF-datasets-compatible JSONL splits into ``ml/data/kgqa/``
(``train.jsonl`` + the held-out ``eval.jsonl``, both git-ignored),
and writes the deterministic manifest to ``ml/manifests/kgqa-manifest.json``
(committed to git, snapshot-tested). The whole build is a pure function of the
export + seed, so a byte-identical corpus is a git no-op on the manifest.

The ``eval.jsonl`` split is the **registered held-out KGQA eval split** the eval
harness (US-004) scores on — its path constants and loader (:data:`KGQA_EVAL_PATH`,
:func:`load_split`, :data:`REGISTERED_EVAL_SPLIT`) are the harness's import surface.

The data tree is a git-ignored build output — nothing to re-pin; commit only the
regenerated manifest.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pinakes_ml.kgqa import (
    DEFAULT_EVAL_RATIO,
    DEFAULT_MAX_PER_KIND,
    DEFAULT_SEED,
    QAExample,
    Splits,
    build_examples,
    build_manifest,
    serialize_examples,
    split_examples,
)

# ml/ workspace root and repo root, resolved from this file's location.
_ML_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = _ML_ROOT.parent

DEFAULT_EXPORT_DIR = _REPO_ROOT / "build" / "corpus"
DEFAULT_DATA_DIR = _ML_ROOT / "data" / "kgqa"
DEFAULT_MANIFEST = _ML_ROOT / "manifests" / "kgqa-manifest.json"

# --- eval-harness registration (US-004 import surface) -------------------------

KGQA_TRAIN_PATH = DEFAULT_DATA_DIR / "train.jsonl"
KGQA_EVAL_PATH = DEFAULT_DATA_DIR / "eval.jsonl"

#: The held-out KGQA eval split registered with the eval harness. US-004 loads
#: ``path`` (via :func:`load_split`) and reads ``manifestKey`` from the committed
#: manifest to know the expected example count + content hash.
REGISTERED_EVAL_SPLIT: dict[str, str] = {
    "name": "kgqa",
    "split": "eval",
    "path": str(KGQA_EVAL_PATH),
    "manifest": str(DEFAULT_MANIFEST),
    "manifestKey": "splits.eval",
}


def load_split(path: Path | str) -> list[dict]:
    """Load a KGQA JSONL split into a list of records (the harness loader)."""
    text = Path(path).read_text(encoding="utf-8")
    return [json.loads(line) for line in text.splitlines() if line]


def write_split(data_dir: Path, name: str, examples: list[QAExample]) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / f"{name}.jsonl").write_text(
        serialize_examples(examples), encoding="utf-8"
    )


def write_manifest(manifest_path: Path, manifest: dict) -> None:
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def build(
    export_dir: Path,
    *,
    seed: int = DEFAULT_SEED,
    eval_ratio: float = DEFAULT_EVAL_RATIO,
    max_per_kind: int = DEFAULT_MAX_PER_KIND,
) -> tuple[Splits, dict]:
    """Pure build: splits + manifest. No filesystem writes, no MLflow."""
    examples, stats = build_examples(export_dir, seed=seed, max_per_kind=max_per_kind)
    splits = split_examples(examples, seed=seed, eval_ratio=eval_ratio)
    manifest = build_manifest(
        examples, splits, stats, seed=seed, eval_ratio=eval_ratio
    )
    return splits, manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export-dir", type=Path, default=DEFAULT_EXPORT_DIR)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--eval-ratio", type=float, default=DEFAULT_EVAL_RATIO)
    parser.add_argument("--max-per-kind", type=int, default=DEFAULT_MAX_PER_KIND)
    parser.add_argument(
        "--no-mlflow",
        action="store_true",
        help="Skip MLflow logging (default logs the build as a run).",
    )
    args = parser.parse_args(argv)

    if not (args.export_dir / "nodes").exists():
        parser.error(
            f"export not found: {args.export_dir}\n"
            "The canonical export is a git-ignored build output — regenerate "
            "it with `npx tsx scripts/export-for-engine.ts` first."
        )

    splits, manifest = build(
        args.export_dir,
        seed=args.seed,
        eval_ratio=args.eval_ratio,
        max_per_kind=args.max_per_kind,
    )
    write_split(args.data_dir, "train", splits.train)
    write_split(args.data_dir, "eval", splits.eval)
    write_manifest(args.manifest, manifest)

    counts = manifest["counts"]
    split_meta = manifest["splits"]
    print(
        f"examples={counts['examples']} "
        f"(path={counts['path']} derivation={counts['derivation']})"
    )
    print(
        f"splits: train={split_meta['train']['examples']} "
        f"eval={split_meta['eval']['examples']} (held-out)"
    )
    print(f"data     -> {args.data_dir}/{{train,eval}}.jsonl")
    print(f"manifest -> {args.manifest}")

    if not args.no_mlflow:
        _log_to_mlflow(manifest)
    return 0


def _log_to_mlflow(manifest: dict) -> None:
    """Log the dataset build as an MLflow run so the dataset is traceable."""
    import mlflow

    from pinakes_ml import start_run

    counts = manifest["counts"]
    with start_run(run_name="kgqa-export"):
        mlflow.log_param("seed", manifest["seed"])
        mlflow.log_param("evalRatio", manifest["evalRatio"])
        mlflow.log_param("sha256", manifest["sha256"])
        for key, value in counts.items():
            mlflow.log_metric(f"count_{key}", value)
        for name, meta in manifest["splits"].items():
            mlflow.log_metric(f"split_{name}", meta["examples"])


if __name__ == "__main__":  # pragma: no cover - CLI entry
    raise SystemExit(main())
