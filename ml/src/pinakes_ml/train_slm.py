"""CLI: run the SLM pilot's QLoRA pipeline end to end (slm-pilot US-002).

Reproducer for the Phase-D workflow backbone. From ``ml/``::

    uv run pinakes-train-slm --stub                       # the pipeline smoke
    uv pip install trl peft accelerate                    # the undeclared stack
    uv run pinakes-train-slm                              # the 0.5B debug run
    uv run pinakes-train-slm --config configs/slm-pilot-3b.json

It loads a committed JSON config (:class:`~pinakes_ml.slm_finetune.SlmPilotConfig`),
rebuilds the rule-SFT corpus and the **frozen** eval set deterministically from the
world exports, cross-checks the eval set's sha256 against the committed protocol
manifest, scores the untuned model on both prompt arms, QLoRA-fine-tunes, scores
the tuned model, writes a run summary to the git-ignored output dir, and logs
config + dataset hashes + every metric to MLflow.

``--stub`` swaps in :func:`~pinakes_ml.slm_finetune.stub_trainer` and
:func:`~pinakes_ml.slm_finetune.stub_model_factory`: the identical pipeline runs
with no model, no network and no undeclared dependency. That is the CI smoke —
and the scores it produces are meaningless by construction (the summary says so).

Runbook: ``docs/slm-pilot-runbook.md``. Protocol: ``docs/slm-pilot-protocol.md``.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pinakes_ml.export_insimul_datasets import DEFAULT_CANDIDATES, DEFAULT_WORLDS
from pinakes_ml.slm_finetune import (
    SlmPilotConfig,
    build_pilot_data,
    run_pipeline,
    stub_model_factory,
    stub_trainer,
)

_ML_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = _ML_ROOT / "configs" / "slm-pilot-debug.json"

SUMMARY_FILE = "run-summary.json"


def read_dvc_md5(dvc_path: Path) -> str:
    """The tracked md5 out of a ``.dvc`` pointer, or ``""`` when unavailable.

    Reuses the parser :mod:`pinakes_ml.train_baselines` already ships (imported
    lazily — that module pulls the heavy embedding stack).
    """
    if not dvc_path.exists():
        return ""
    try:
        from pinakes_ml.train_baselines import read_dvc_md5 as _read

        return _read(dvc_path)
    except Exception:  # pragma: no cover - a malformed pointer is not fatal
        return ""


def eval_set_matches_manifest(manifest_path: Path, sha256: str) -> bool | None:
    """Does the rebuilt eval set equal the frozen one? ``None`` if unknowable.

    The protocol's rule is that "a run that cannot name the eval set it scored is
    not a comparison point" — so this is recorded on every run rather than
    assumed. A real-corpus run legitimately answers ``False``: it scored a
    different (larger) eval set than the committed fixture manifest describes.
    """
    if not manifest_path.exists():
        return None
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    files = manifest.get("files") or {}
    hashes = {info.get("sha256") for info in files.values() if isinstance(info, dict)}
    return sha256 in hashes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument(
        "--base-dir", type=Path, default=_ML_ROOT,
        help="Base dir the config's paths resolve against (default: ml/).",
    )
    parser.add_argument(
        "--world", type=Path, action="append", dest="worlds",
        help="A CanonicalWorldExport file (repeatable; overrides the config).",
    )
    parser.add_argument(
        "--candidates", type=Path, action="append", dest="candidates",
        help="An Insimul rules.jsonl candidate export (repeatable).",
    )
    parser.add_argument("--output-dir", type=Path, default=None)
    parser.add_argument(
        "--stub", action="store_true",
        help="Run the pipeline against the deterministic stub model (no train).",
    )
    parser.add_argument(
        "--no-untuned", action="store_true",
        help="Skip the untuned baseline pass (faster; loses the delta).",
    )
    parser.add_argument("--no-mlflow", action="store_true")
    args = parser.parse_args(argv)

    config = SlmPilotConfig.from_json(args.config).resolved(args.base_dir)
    overrides: dict[str, object] = {}
    if args.output_dir is not None:
        overrides["output_dir"] = str(args.output_dir)
    if args.no_untuned:
        overrides["score_untuned"] = False
    if overrides:
        config = SlmPilotConfig.from_dict({**config.to_dict(), **overrides})

    worlds = [Path(p) for p in (args.worlds or config.worlds or DEFAULT_WORLDS)]
    candidates = [
        Path(p)
        for p in (
            args.candidates
            or config.candidates
            or [p for p in DEFAULT_CANDIDATES if p.exists()]
        )
    ]
    for path in [*worlds, *candidates]:
        if not path.exists():
            parser.error(f"input not found: {path}")

    data = build_pilot_data(config, worlds, candidates)
    if not data.eval_set:
        parser.error(
            "the frozen eval set is empty — nothing was held out. Pass two or "
            "more worlds (see docs/slm-pilot-protocol.md §2)."
        )

    matches = eval_set_matches_manifest(Path(config.eval_manifest), data.eval_sha256)
    if args.stub:
        trainer = stub_trainer
        model_factory = stub_model_factory(data.eval_set)
    else:  # pragma: no cover - local-only, needs the undeclared training stack
        from pinakes_ml.slm_finetune import hf_model_factory, train_qlora

        trainer = train_qlora
        model_factory = hf_model_factory

    summary = run_pipeline(
        config,
        data,
        trainer=trainer,
        model_factory=model_factory,
        dataset_dvc_md5=read_dvc_md5(Path(config.dvc_file)),
        matches_frozen_eval_set=matches,
    )

    out_path = Path(config.output_dir) / SUMMARY_FILE
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    _print_report(summary, out_path)

    if not args.no_mlflow:
        _log_to_mlflow(summary)
    return 0


def _print_report(summary: dict, out_path: Path) -> None:
    dataset = summary["dataset"]
    training = summary["training"]
    print(f"model      = {summary['baseModel']}  (device {training['device']})")
    print(f"train      = {dataset['trainRecords']} records, "
          f"held out {', '.join(dataset['heldOutWorlds']) or 'none'}")
    print(f"eval set   = {dataset['evalPromptsScored']}/"
          f"{dataset['evalPromptsTotal']} prompts, "
          f"sha256 {dataset['evalSetSha256'][:12]}… "
          f"(frozen: {dataset['matchesFrozenEvalSet']})")
    for stage in ("untuned", "finetuned"):
        for arm, scores in sorted(summary["scores"].get(stage, {}).items()):
            print(f"  {stage:<10} {arm:<11} parse={scores['parseRate']:.3f} "
                  f"schema={scores['schemaValidity']:.3f} "
                  f"fullyValid={scores['fullyValid']:.3f} "
                  f"loss={scores['evalLoss']}")
    for arm, deltas in sorted(summary["deltas"].items()):
        print(f"  delta      {arm:<11} parse={deltas['parseRate']:+.3f} "
              f"fullyValid={deltas['fullyValid']:+.3f}")
    if training["stub"]:
        print("WARNING  stub run — these scores describe the PIPELINE, not a model.")
    print(f"summary  -> {out_path}")


def _log_to_mlflow(summary: dict) -> None:
    import mlflow

    from pinakes_ml import start_run

    config = summary["config"]
    dataset = summary["dataset"]
    with start_run(run_name=summary["runName"]):
        mlflow.log_param("pipelineVersion", summary["pipelineVersion"])
        mlflow.log_param("protocolVersion", summary["protocolVersion"])
        for key in (
            "base_model", "seed", "num_train_epochs", "learning_rate",
            "lora_r", "lora_alpha", "load_in_4bit", "accepted_only",
        ):
            mlflow.log_param(key, config[key])
        mlflow.log_param("arms", ",".join(config["arms"]))
        # The dataset identity — the protocol's hard requirement: every run must
        # name the eval set it scored and the corpus it trained on.
        mlflow.log_param("evalSetSha256", dataset["evalSetSha256"])
        mlflow.log_param("ruleSftSha256", dataset["ruleSftSha256"])
        mlflow.log_param("datasetDvcMd5", dataset["dvcMd5"])
        mlflow.log_param("matchesFrozenEvalSet", dataset["matchesFrozenEvalSet"])
        mlflow.log_param("heldOutWorlds", ",".join(dataset["heldOutWorlds"]))
        mlflow.log_param("stub", summary["training"]["stub"])
        mlflow.log_metric("trainRecords", float(dataset["trainRecords"]))
        mlflow.log_metric("evalPromptsScored", float(dataset["evalPromptsScored"]))
        if summary["training"]["trainLoss"] is not None:
            mlflow.log_metric("trainLoss", float(summary["training"]["trainLoss"]))
        for stage, arms in summary["scores"].items():
            for arm, scores in arms.items():
                for key, value in scores.items():
                    if isinstance(value, int | float):
                        mlflow.log_metric(f"{stage}_{arm}_{key}", float(value))
        for arm, deltas in summary["deltas"].items():
            for key, value in deltas.items():
                mlflow.log_metric(f"delta_{arm}_{key}", float(value))


if __name__ == "__main__":  # pragma: no cover - CLI entry
    raise SystemExit(main())
