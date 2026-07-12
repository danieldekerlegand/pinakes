"""CLI: train the PyKEEN baselines, log metrics to MLflow, commit the metrics doc.

Reproducer for US-003. Run from ``ml/`` (full runs are local-only — CPU/MPS)::

    uv run python -m linguascrape_ml.train_baselines
    # or the console script:
    uv run linguascrape-train-baselines

For each model it trains reproducibly on the committed splits, extracts MRR +
Hits@{1,3,10}, logs an MLflow run (metrics + the exact corpus/split hashes), saves
the trained entity embeddings under ``ml/data/embeddings/<model>/`` (DVC-tracked),
and rewrites the committed ``docs/ml-baselines.md``.

After running, re-pin the embeddings with ``dvc add ml/data && dvc push`` and commit
the updated ``ml/data.dvc`` alongside the regenerated doc.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from linguascrape_ml.baselines import (
    BASELINE_SEED,
    DEFAULT_EMBEDDING_DIM,
    DEFAULT_MODELS,
    DEFAULT_NUM_EPOCHS,
    BaselineOutcome,
    load_split_factories,
    render_baselines_doc,
    train_baseline,
)

# ml/ workspace root and repo root, resolved from this file's location.
_ML_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = _ML_ROOT.parent

DEFAULT_DATA_DIR = _ML_ROOT / "data" / "triples"
DEFAULT_EMBEDDINGS_DIR = _ML_ROOT / "data" / "embeddings"
DEFAULT_MANIFEST = _ML_ROOT / "manifests" / "triples-split-manifest.json"
DEFAULT_DOC = _REPO_ROOT / "docs" / "ml-baselines.md"
_EXPORT_DVC = _REPO_ROOT / "export" / "culturescrape.dvc"


def read_dvc_md5(dvc_path: Path) -> str:
    """First ``md5:`` value in a ``.dvc`` pointer (the tracked content hash).

    A ``.dvc`` file is small YAML; the ``outs[0].md5`` line pins the exact bytes of
    the tracked build output, which is precisely "the corpus version this metric was
    measured on". Returns ``"unknown"`` if the pointer is absent (e.g. a fresh
    checkout before ``dvc pull``) so the doc still renders.
    """
    if not dvc_path.exists():
        return "unknown"
    # The pointer line is ``- md5: <hash>.dir``; match the ``md5:`` key anywhere
    # (the sibling ``hash: md5`` line has no trailing colon, so it can't match).
    match = re.search(r"md5:\s*(\S+)", dvc_path.read_text(encoding="utf-8"))
    return match.group(1) if match else "unknown"


def sha256_file(path: Path) -> str:
    """Hex sha256 of a file's bytes."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save_embeddings(embeddings_dir: Path, outcome: BaselineOutcome, meta: dict) -> Path:
    """Write ``<embeddings_dir>/<model>/entity_embeddings.npy`` + ``metadata.json``.

    The ``.npy`` matrix is row-aligned to ``entities.tsv`` index order; the metadata
    (deterministic — no wall-clock) records the model/dims/dtype/corpus hash so a
    consumer can reuse the vectors without re-deriving anything.
    """
    import numpy as np

    model_dir = embeddings_dir / outcome.model.lower()
    model_dir.mkdir(parents=True, exist_ok=True)
    np.save(model_dir / "entity_embeddings.npy", outcome.embeddings)

    metadata = {
        "model": outcome.model,
        "embedding_dim": outcome.embedding_dim,
        "num_epochs": outcome.num_epochs,
        "seed": outcome.seed,
        "device": outcome.device,
        "shape": list(outcome.embeddings_shape),
        "dtype": outcome.embeddings_dtype,
        "entities_order": "ml/data/triples/entities.tsv (index order)",
        "metrics": outcome.metrics,
        **meta,
    }
    (model_dir / "metadata.json").write_text(
        json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return model_dir


def _log_to_mlflow(outcome: BaselineOutcome, meta: dict) -> None:
    """Log one baseline run (params + the committed metrics) to MLflow."""
    import mlflow

    from linguascrape_ml import start_run

    with start_run(run_name=f"{outcome.model.lower()}-baseline"):
        mlflow.log_param("model", outcome.model)
        mlflow.log_param("embedding_dim", outcome.embedding_dim)
        mlflow.log_param("num_epochs", outcome.num_epochs)
        mlflow.log_param("seed", outcome.seed)
        mlflow.log_param("device", outcome.device)
        mlflow.log_param("corpus_md5", meta["corpus_md5"])
        mlflow.log_param("triples_sha256", meta["triples_sha256"])
        mlflow.log_param("manifest_sha256", meta["manifest_sha256"])
        for key, value in outcome.metrics.items():
            # MLflow metric names can't contain '@' — normalise hits@k -> hits_at_k.
            mlflow.log_metric(key.replace("@", "_at_"), value)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--embeddings-dir", type=Path, default=DEFAULT_EMBEDDINGS_DIR)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--doc", type=Path, default=DEFAULT_DOC)
    parser.add_argument(
        "--models",
        nargs="+",
        default=list(DEFAULT_MODELS),
        help="Models to train (default: TransE ComplEx RotatE).",
    )
    parser.add_argument("--embedding-dim", type=int, default=DEFAULT_EMBEDDING_DIM)
    parser.add_argument("--num-epochs", type=int, default=DEFAULT_NUM_EPOCHS)
    parser.add_argument("--seed", type=int, default=BASELINE_SEED)
    parser.add_argument(
        "--device",
        default="cpu",
        help="torch device ('cpu', 'mps', 'cuda'); default cpu for reproducibility.",
    )
    parser.add_argument("--no-mlflow", action="store_true")
    args = parser.parse_args(argv)

    if not (args.data_dir / "train.tsv").exists():
        parser.error(
            f"triples splits not found in {args.data_dir}\n"
            "They are DVC-tracked — run `uv run --project ml dvc pull` (or rebuild "
            "with `uv run linguascrape-export-triples`) first."
        )

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    meta = {
        "corpus_md5": read_dvc_md5(_EXPORT_DVC),
        "manifest_sha256": sha256_file(args.manifest),
        "triples_sha256": manifest["triplesSha256"],
    }

    training, validation, testing = load_split_factories(args.data_dir)

    outcomes: list[BaselineOutcome] = []
    for model in args.models:
        print(f"training {model} (dim={args.embedding_dim}, epochs={args.num_epochs}, "
              f"device={args.device}) …")
        outcome = train_baseline(
            model,
            training,
            validation,
            testing,
            seed=args.seed,
            embedding_dim=args.embedding_dim,
            num_epochs=args.num_epochs,
            device=args.device,
        )
        outcomes.append(outcome)
        model_dir = save_embeddings(args.embeddings_dir, outcome, meta)
        m = outcome.metrics
        print(f"  MRR={m['mrr']:.4f} Hits@1={m['hits@1']:.4f} "
              f"Hits@3={m['hits@3']:.4f} Hits@10={m['hits@10']:.4f}")
        print(f"  embeddings -> {model_dir}")
        if not args.no_mlflow:
            _log_to_mlflow(outcome, meta)

    doc = render_baselines_doc(
        outcomes,
        corpus_md5=meta["corpus_md5"],
        manifest_sha256=meta["manifest_sha256"],
        triples_sha256=meta["triples_sha256"],
        counts=manifest["counts"],
        split_counts={
            n: manifest["splits"][n]["triples"] for n in ("train", "valid", "test")
        },
    )
    args.doc.parent.mkdir(parents=True, exist_ok=True)
    args.doc.write_text(doc, encoding="utf-8")
    print(f"metrics doc -> {args.doc}")
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entry
    raise SystemExit(main())
