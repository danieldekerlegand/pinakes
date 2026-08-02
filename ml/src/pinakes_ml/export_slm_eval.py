"""CLI: freeze the SLM pilot's eval set + protocol manifest (slm-pilot US-001).

Reproducer for the pilot's referee. Run from anywhere::

    uv run python -m pinakes_ml.export_slm_eval    # pinakes-export-slm-eval

Rebuilds the insimul-bridge US-005 datasets, reserves the **held-out worlds'**
rule-authoring prompts as the frozen eval set, and writes:

* ``ml/data/slm-pilot/rule-eval.jsonl`` — the eval set (git-ignored tree,
  git-ignored, ``synthetic`` tier / proprietary: never committed);
* ``ml/manifests/slm-pilot-eval-manifest.json`` — the committed, snapshot-tested
  protocol manifest: the frozen metric list, the comparison points, the ablation
  arms, the measured volumes and the ``insufficient-data`` floor verdict.

``--check`` rebuilds and exits non-zero on any drift (no writes) — the gate that
makes "the protocol was frozen before training" a checkable claim rather than a
promise. The prose half is ``docs/slm-pilot-protocol.md``.

Defaults are the same two committed fixture worlds ``pinakes-export-insimul``
uses, so the committed manifest needs no corpus build. Point ``--world`` at real
converted worlds locally; the exit code then tells you whether the corpus clears
the volume floors.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pinakes_ml.export_insimul_datasets import DEFAULT_CANDIDATES, DEFAULT_WORLDS
from pinakes_ml.insimul_datasets import (
    DEFAULT_EVAL_RATIO,
    DEFAULT_SEED,
    build_datasets,
    serialize_examples,
)
from pinakes_ml.slm_pilot import (
    EVAL_SET_FILE,
    VERDICT_INSUFFICIENT,
    build_eval_manifest,
    build_eval_set,
)

_ML_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_DATA_DIR = _ML_ROOT / "data" / "slm-pilot"
DEFAULT_MANIFEST = _ML_ROOT / "manifests" / "slm-pilot-eval-manifest.json"


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
    eval_set = build_eval_set(datasets)
    manifest = build_eval_manifest(
        datasets, eval_set, seed=args.seed, eval_ratio=args.eval_ratio
    )
    manifest_text = json.dumps(manifest, indent=2, sort_keys=True) + "\n"

    if args.check:
        if (
            not args.manifest.exists()
            or args.manifest.read_text(encoding="utf-8") != manifest_text
        ):
            print(f"DRIFT  manifest drift: {args.manifest}")
            return 1
        print("PASS   slm-pilot eval manifest in sync")
        return 0

    args.data_dir.mkdir(parents=True, exist_ok=True)
    (args.data_dir / EVAL_SET_FILE).write_text(
        serialize_examples(eval_set), encoding="utf-8"
    )
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(manifest_text, encoding="utf-8")

    floor = manifest["dataFloor"]
    print(f"held out   = {', '.join(manifest['heldOutWorlds']) or 'none'}")
    print(f"eval set   = {len(eval_set)} prompts "
          f"({manifest['evalSet']['withReference']} with a reference completion)")
    volumes = manifest["volumes"]
    print(f"train sft  = {volumes['ruleSftTrain']} "
          f"({volumes['ruleSftTrainAccepted']} accepted)")
    print(f"verdict    = {floor['verdict']}")
    if floor["shortfalls"]:
        for name in floor["shortfalls"]:
            check = floor["checks"][name]
            print(f"  SHORT  {name}: {check['measured']} < {check['floor']}")
    print(f"data     -> {args.data_dir / EVAL_SET_FILE}")
    print(f"manifest -> {args.manifest}")

    if not args.no_mlflow:
        _log_to_mlflow(manifest)
    # A shortfall is a real finding, not an error: the artifacts are written and
    # the verdict is recorded. Exit 0 so the freeze is reproducible either way.
    if floor["verdict"] == VERDICT_INSUFFICIENT:
        print("NOTE   volumes below the floor — the pilot verdict must read "
              "'insufficient data' until the corpus grows (see US-006).")
    return 0


def _log_to_mlflow(manifest: dict) -> None:
    import mlflow

    from pinakes_ml import start_run

    with start_run(run_name="slm-pilot-eval"):
        for key in ("protocolVersion", "datasetVersion", "tier", "licenseClass"):
            mlflow.log_param(key, manifest[key])
        mlflow.log_param("heldOutWorlds", ",".join(manifest["heldOutWorlds"]))
        mlflow.log_param("verdict", manifest["dataFloor"]["verdict"])
        mlflow.log_param("metrics", ",".join(manifest["metrics"]))
        for name, info in manifest["files"].items():
            mlflow.log_param(f"sha256_{name}", info["sha256"])
            mlflow.log_metric(f"count_{name}", info["count"])
        for name, value in manifest["volumes"].items():
            mlflow.log_metric(f"volume_{name}", value)


if __name__ == "__main__":  # pragma: no cover - CLI entry
    raise SystemExit(main())
