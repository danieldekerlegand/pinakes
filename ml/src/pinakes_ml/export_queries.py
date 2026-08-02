"""CLI: build the training-query dataset + committed manifest, log to MLflow.

Reproducer for US-002 of the Scallop pilot. Run from anywhere::

    uv run python -m pinakes_ml.export_queries

or via the console script::

    uv run pinakes-export-queries

Reads the git-ignored triples splits (``ml/data/triples/{train,valid,test}.tsv`` +
``triples.tsv`` — themselves built by :mod:`pinakes_ml.export_triples`), draws
the target-relation positives from the held-out split (default ``valid``), generates
type-constrained negatives, and writes ``ml/data/queries/queries.jsonl``
(git-ignored) plus the deterministic manifest
``ml/manifests/training-queries-manifest.json`` (committed, snapshot-tested). The
whole build is a pure function of the splits + seed, so a byte-identical corpus is a
git no-op on the manifest.

The data tree is a git-ignored build output — nothing to re-pin; commit only the
regenerated manifest.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pinakes_ml.consistency import load_edge_constraints, parse_predictions
from pinakes_ml.queries import (
    DEFAULT_NEGATIVE_RATIO,
    DEFAULT_SEED,
    DEFAULT_SPLIT,
    TARGET_RELATIONS,
    Query,
    build_manifest,
    corruption_pool,
    entity_types,
    generate_queries,
    serialize_queries,
)
from pinakes_ml.triples import Triple

# ml/ workspace root and repo root, resolved from this file's location.
_ML_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = _ML_ROOT.parent

DEFAULT_TRIPLES_DIR = _ML_ROOT / "data" / "triples"
DEFAULT_DATA_DIR = _ML_ROOT / "data" / "queries"
DEFAULT_MANIFEST = _ML_ROOT / "manifests" / "training-queries-manifest.json"
DEFAULT_SCHEMA = _REPO_ROOT / "shared" / "canonical-schema.json"


def _target(triples: list[Triple]) -> list[Triple]:
    """Keep only the pilot's target-relation triples."""
    return [t for t in triples if t.relation in TARGET_RELATIONS]


def build(
    triples_dir: Path,
    schema_path: Path,
    *,
    split: str = DEFAULT_SPLIT,
    negative_ratio: int = DEFAULT_NEGATIVE_RATIO,
    seed: int = DEFAULT_SEED,
) -> tuple[list[Query], dict]:
    """Pure build: load splits → generate queries → manifest. No writes, no MLflow.

    ``known_positives`` (the filtered negative-rejection set) is the union of *every*
    split's target-relation triples; ``train_positives`` is the ``train`` subset — so
    the manifest can assert no negative leaks a train fact (AC2) *and* the stronger
    filtered invariant that no negative is any known-true edge.
    """
    all_triples = parse_predictions(triples_dir / "triples.tsv")
    positives = _target(parse_predictions(triples_dir / f"{split}.tsv"))
    train_positives = set(_target(parse_predictions(triples_dir / "train.tsv")))
    known_positives = set(_target(all_triples))

    types_by_entity = entity_types(all_triples)
    constraints = load_edge_constraints(schema_path)

    queries, stats = generate_queries(
        positives,
        known_positives=known_positives,
        types_by_entity=types_by_entity,
        constraints=constraints,
        negative_ratio=negative_ratio,
        seed=seed,
    )

    pool_sizes: dict[str, dict[str, int]] = {}
    for rel in TARGET_RELATIONS:
        from_types, to_types = constraints.get(rel, (None, None))
        pool_sizes[rel] = {
            "from": len(corruption_pool(types_by_entity, from_types)),
            "to": len(corruption_pool(types_by_entity, to_types)),
        }

    manifest = build_manifest(
        queries,
        stats,
        known_positives=known_positives,
        train_positives=train_positives,
        constraints=constraints,
        pool_sizes=pool_sizes,
        seed=seed,
        split=split,
        negative_ratio=negative_ratio,
    )
    return queries, manifest


def write_dataset(data_dir: Path, queries: list[Query]) -> None:
    """Emit the queries JSONL (deterministic, trailing newline)."""
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "queries.jsonl").write_text(
        serialize_queries(queries), encoding="utf-8"
    )


def write_manifest(manifest_path: Path, manifest: dict) -> None:
    """Write the committed manifest (stable JSON, trailing newline)."""
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--triples-dir", type=Path, default=DEFAULT_TRIPLES_DIR)
    parser.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument(
        "--split",
        default=DEFAULT_SPLIT,
        help="held-out split the positives are drawn from (default: valid).",
    )
    parser.add_argument("--negative-ratio", type=int, default=DEFAULT_NEGATIVE_RATIO)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument(
        "--no-mlflow",
        action="store_true",
        help="Skip MLflow logging (default logs the build as a run).",
    )
    args = parser.parse_args(argv)

    split_file = args.triples_dir / f"{args.split}.tsv"
    if not split_file.exists():
        parser.error(
            f"triples split not found: {split_file}\n"
            "The triples dataset is a git-ignored build output — build it "
            "with `uv run pinakes-export-triples` first."
        )

    queries, manifest = build(
        args.triples_dir,
        args.schema,
        split=args.split,
        negative_ratio=args.negative_ratio,
        seed=args.seed,
    )
    write_dataset(args.data_dir, queries)
    write_manifest(args.manifest, manifest)

    counts = manifest["counts"]
    leak = manifest["leakage"]
    print(
        f"queries={counts['queries']} "
        f"(positives={counts['positives']} negatives={counts['negatives']}) "
        f"from split={args.split!r} ratio={args.negative_ratio}"
    )
    print(
        f"leakage: collisionsRejected={leak['collisionsRejected']} "
        f"insufficientPool={leak['insufficientPoolNegatives']} "
        f"negativesLeakingTrainFacts={leak['negativesLeakingTrainFacts']}"
    )
    print(f"data     -> {args.data_dir / 'queries.jsonl'}")
    print(f"manifest -> {args.manifest}")

    if not args.no_mlflow:
        _log_to_mlflow(manifest)
    return 0


def _log_to_mlflow(manifest: dict) -> None:
    """Log the query-dataset build as an MLflow run so the signal is traceable."""
    import mlflow

    from pinakes_ml import start_run

    counts = manifest["counts"]
    with start_run(run_name="training-queries-export"):
        mlflow.log_param("seed", manifest["seed"])
        mlflow.log_param("source_split", manifest["sourceSplit"])
        mlflow.log_param("negative_ratio", manifest["negativeRatio"])
        mlflow.log_param("queries_sha256", manifest["queriesSha256"])
        for key, value in counts.items():
            mlflow.log_metric(f"count_{key}", value)
        for key, value in manifest["leakage"].items():
            mlflow.log_metric(f"leakage_{key}", value)


if __name__ == "__main__":  # pragma: no cover - CLI entry
    raise SystemExit(main())
