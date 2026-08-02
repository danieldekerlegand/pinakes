"""CLI: build the Insimul SLM datasets + committed manifest (insimul-bridge US-005).

Reproducer for the Bridge-4 dataset generators. Run from anywhere::

    uv run python -m pinakes_ml.export_insimul_datasets   # pinakes-export-insimul

Reads one or more ``CanonicalWorldExport`` files (plus, optionally, Insimul
``rules.jsonl`` rejection-sampling exports), writes three training datasets into
``ml/data/insimul/`` — git-ignored, **never committed**, because a
converted world is ``synthetic`` tier and proprietary-licensed — and writes the
deterministic manifest to ``ml/manifests/insimul-datasets-manifest.json``
(committed, snapshot-tested).

``--smoke`` (on by default) closes the loop the PRD asks for: the held-out
world's rule prompts are replayed through a deterministic mock model and scored
with the US-004 rule-adherence tier, and the summary rides in the manifest and
into MLflow. ``--check`` re-builds and exits non-zero on any drift from the
committed manifest (no writes) — the retraining-free gate.

Defaults build from the two committed fixture worlds (the Bridge-2 world at
``core/tests/fixtures/insimul/world-export.json`` and the
VESPACE-shaped world at ``ml/fixtures/insimul/world-export.json``) plus the
candidate export at ``ml/fixtures/insimul/rule-candidates.jsonl``, so the
committed manifest needs no corpus build. Point ``--world`` at real converted
worlds locally; the output tree is git-ignored and needs no re-pin.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pinakes_ml.insimul_datasets import (
    DEFAULT_EVAL_RATIO,
    DEFAULT_SEED,
    LORE_QA_FILE,
    RULE_PREFERENCE_FILE,
    RULE_SFT_FILE,
    Datasets,
    build_datasets,
    build_manifest,
    run_smoke,
    serialize_examples,
)

_ML_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = _ML_ROOT.parent

#: The two committed fixture worlds — one converted Bridge-2 world (rules,
#: truths, genealogy) and one VESPACE-shaped world (actions, no rules). Two
#: worlds is the minimum for a meaningful per-world held-out split.
DEFAULT_WORLDS = (
    _REPO_ROOT / "core" / "tests" / "fixtures" / "insimul" / "world-export.json",
    _ML_ROOT / "fixtures" / "insimul" / "world-export.json",
)
DEFAULT_CANDIDATES = (_ML_ROOT / "fixtures" / "insimul" / "rule-candidates.jsonl",)
DEFAULT_DATA_DIR = _ML_ROOT / "data" / "insimul"
DEFAULT_MANIFEST = _ML_ROOT / "manifests" / "insimul-datasets-manifest.json"


def write_datasets(data_dir: Path, datasets: Datasets) -> None:
    """Write the three JSONL datasets + the two per-world QA splits."""
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / RULE_SFT_FILE).write_text(
        serialize_examples(datasets.sft), encoding="utf-8"
    )
    (data_dir / RULE_PREFERENCE_FILE).write_text(
        serialize_examples(datasets.preferences), encoding="utf-8"
    )
    (data_dir / LORE_QA_FILE).write_text(
        serialize_examples(datasets.qa_examples), encoding="utf-8"
    )
    for name, part in datasets.splits.items():
        (data_dir / f"lore-qa-{name}.jsonl").write_text(
            serialize_examples(example for _, example in part), encoding="utf-8"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--world", type=Path, action="append", dest="worlds",
        help="A CanonicalWorldExport file (repeatable).",
    )
    parser.add_argument(
        "--candidates", type=Path, action="append", dest="candidates",
        help="An Insimul rules.jsonl candidate export (repeatable).",
    )
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--eval-ratio", type=float, default=DEFAULT_EVAL_RATIO)
    parser.add_argument(
        "--no-smoke", action="store_true",
        help="Skip the mock-model adherence smoke (default runs it).",
    )
    parser.add_argument(
        "--check", action="store_true",
        help="Verify the committed manifest matches a fresh build (no writes).",
    )
    parser.add_argument("--no-mlflow", action="store_true")
    args = parser.parse_args(argv)

    worlds = list(args.worlds or DEFAULT_WORLDS)
    candidates = list(
        args.candidates
        if args.candidates is not None
        else [p for p in DEFAULT_CANDIDATES if p.exists()]
    )
    for path in [*worlds, *candidates]:
        if not Path(path).exists():
            parser.error(f"input not found: {path}")

    datasets = build_datasets(
        worlds, candidates, seed=args.seed, eval_ratio=args.eval_ratio
    )
    smoke = None if args.no_smoke else run_smoke(datasets)
    manifest = build_manifest(
        datasets, seed=args.seed, eval_ratio=args.eval_ratio, smoke=smoke
    )
    manifest_text = json.dumps(manifest, indent=2, sort_keys=True) + "\n"

    if args.check:
        if (
            not args.manifest.exists()
            or args.manifest.read_text(encoding="utf-8") != manifest_text
        ):
            print(f"DRIFT  manifest drift: {args.manifest}")
            return 1
        print("PASS   insimul-datasets manifest in sync")
        return 0

    write_datasets(args.data_dir, datasets)
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(manifest_text, encoding="utf-8")

    files = manifest["files"]
    print(f"worlds     = {len(datasets.worlds)} "
          f"(held out: {', '.join(manifest['heldOutWorlds']) or 'none'})")
    print(f"rule sft   = {files[RULE_SFT_FILE]['count']} "
          f"({manifest['ruleSft']['kindCounts']})")
    print(f"preference = {files[RULE_PREFERENCE_FILE]['count']} "
          f"({manifest['preferences']['originCounts']})")
    print(f"lore qa    = {files[LORE_QA_FILE]['count']} "
          f"({manifest['loreQa']['kindCounts']})")
    print(f"tier       = {manifest['tier']} / {manifest['licenseClass']}")
    if smoke is not None:
        print(f"smoke      = {smoke['generations']} generations on "
              f"{smoke['worldId']}: parse {smoke['parseRate']:.3f} / "
              f"fully-valid {smoke['fullyValidRate']:.3f}")
    print(f"data     -> {args.data_dir}")
    print(f"manifest -> {args.manifest}")

    if not args.no_mlflow:
        _log_to_mlflow(manifest)
    return 0


def _log_to_mlflow(manifest: dict) -> None:
    import mlflow

    from pinakes_ml import start_run

    with start_run(run_name="insimul-datasets"):
        for key in ("datasetVersion", "analyzerVersion", "tier", "licenseClass"):
            mlflow.log_param(key, manifest[key])
        mlflow.log_param("heldOutWorlds", ",".join(manifest["heldOutWorlds"]))
        mlflow.log_metric("worlds", len(manifest["worlds"]))
        for name, info in manifest["files"].items():
            mlflow.log_param(f"sha256_{name}", info["sha256"])
            mlflow.log_metric(f"count_{name}", info["count"])
        for kind, value in manifest["ruleSft"]["kindCounts"].items():
            mlflow.log_metric(f"sft_{kind}", value)
        smoke = manifest.get("smoke")
        if smoke:
            mlflow.log_param("smokeWorld", smoke["worldId"])
            for key in (
                "generations", "parsed", "fullyValid",
                "parseRate", "fullyValidRate", "meanReachabilityCharitable",
            ):
                mlflow.log_metric(f"smoke_{key}", smoke[key])


if __name__ == "__main__":  # pragma: no cover - CLI entry
    raise SystemExit(main())
