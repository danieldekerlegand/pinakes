"""CLI: build the triples dataset + committed split manifest, log the run to MLflow.

Reproducer for US-002. Run from anywhere::

    uv run python -m pinakes_ml.export_triples

or via the console script::

    uv run pinakes-export-triples

Reads the git-ignored canonical edge export, writes the PyKEEN-native triples +
splits + vocab into ``ml/data/triples/`` (git-ignored), and writes
the deterministic split manifest to ``ml/manifests/triples-split-manifest.json``
(committed to git, snapshot-tested). The whole build is a pure function of the
edges + seed, so a byte-identical corpus is a git no-op on the manifest.

The data tree is a git-ignored build output — nothing to re-pin; commit only the
regenerated manifest.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pinakes_ml.triples import (
    DEFAULT_RATIOS,
    DEFAULT_SEED,
    Splits,
    build_manifest,
    entity_vocab,
    load_triples,
    relation_vocab,
    split_triples,
)

# ml/ workspace root and repo root, resolved from this file's location.
_ML_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = _ML_ROOT.parent

DEFAULT_EDGES_DIR = _REPO_ROOT / "export" / "culturescrape" / "edges"
DEFAULT_DATA_DIR = _ML_ROOT / "data" / "triples"
DEFAULT_MANIFEST = _ML_ROOT / "manifests" / "triples-split-manifest.json"


def _write_lines(path: Path, lines: list[str]) -> None:
    """Write a trailing-newline text file (empty file if no lines)."""
    body = ("\n".join(lines) + "\n") if lines else ""
    path.write_text(body, encoding="utf-8")


def write_dataset(
    data_dir: Path,
    triples: list,
    splits: Splits,
) -> None:
    """Emit triples.tsv, {train,valid,test}.tsv, entities.tsv, relations.tsv."""
    data_dir.mkdir(parents=True, exist_ok=True)
    _write_lines(data_dir / "triples.tsv", [t.as_row() for t in triples])
    for name, part in splits.items():
        _write_lines(data_dir / f"{name}.tsv", [t.as_row() for t in part])
    # Vocab files: index<TAB>label, index = position in the sorted vocab.
    _write_lines(
        data_dir / "entities.tsv",
        [f"{i}\t{e}" for i, e in enumerate(entity_vocab(triples))],
    )
    _write_lines(
        data_dir / "relations.tsv",
        [f"{i}\t{r}" for i, r in enumerate(relation_vocab(triples))],
    )


def write_manifest(manifest_path: Path, manifest: dict) -> None:
    """Write the committed split manifest (stable JSON, trailing newline)."""
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def build(
    edges_dir: Path,
    *,
    seed: int = DEFAULT_SEED,
    ratios: tuple[float, float, float] = DEFAULT_RATIOS,
) -> tuple[list, Splits, dict]:
    """Pure build: load → split → manifest. No filesystem writes, no MLflow."""
    triples = load_triples(edges_dir)
    splits = split_triples(triples, seed=seed, ratios=ratios)
    manifest = build_manifest(triples, splits, seed=seed, ratios=ratios)
    return triples, splits, manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--edges-dir", type=Path, default=DEFAULT_EDGES_DIR)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument(
        "--no-mlflow",
        action="store_true",
        help="Skip MLflow logging (default logs the build as a run).",
    )
    args = parser.parse_args(argv)

    if not args.edges_dir.exists():
        parser.error(
            f"edges dir not found: {args.edges_dir}\n"
            "The canonical export is a git-ignored build output — regenerate "
            "it with `npx tsx scripts/export-for-culturescrape.ts` first."
        )

    triples, splits, manifest = build(args.edges_dir, seed=args.seed)
    write_dataset(args.data_dir, triples, splits)
    write_manifest(args.manifest, manifest)

    counts = manifest["counts"]
    print(
        f"triples={counts['triples']} entities={counts['entities']} "
        f"relations={counts['relations']} "
        f"(train={len(splits.train)} valid={len(splits.valid)} test={len(splits.test)})"
    )
    print(f"data   -> {args.data_dir}")
    print(f"manifest -> {args.manifest}")

    if not args.no_mlflow:
        _log_to_mlflow(manifest)
    return 0


def _log_to_mlflow(manifest: dict) -> None:
    """Log the dataset build as an MLflow run so the split is traceable."""
    import mlflow

    from pinakes_ml import start_run

    counts = manifest["counts"]
    with start_run(run_name="triples-export"):
        mlflow.log_param("seed", manifest["seed"])
        mlflow.log_param("excluded_relations", ",".join(manifest["excludedRelations"]))
        mlflow.log_param("triples_sha256", manifest["triplesSha256"])
        for key, value in counts.items():
            mlflow.log_metric(f"count_{key}", value)
        for name, meta in manifest["splits"].items():
            mlflow.log_metric(f"split_{name}", meta["triples"])


if __name__ == "__main__":  # pragma: no cover - CLI entry
    raise SystemExit(main())
