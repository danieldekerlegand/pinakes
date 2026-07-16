"""CLI: run the QLoRA fine-tuning pipeline + before/after KGQA eval (US-005).

Reproducer for NEUROSYMBOLIC_ROADMAP.md Phase 5, US-005. Run from ``ml/`` after
installing the (undeclared) training stack and pulling the DVC data::

    uv pip install trl peft accelerate      # + bitsandbytes on CUDA for 4-bit
    uv run --project . dvc pull             # fetch the DVC-tracked datasets
    uv run pinakes-finetune            # local smoke (tiny model, MPS/CPU)
    # or a specific config:
    uv run pinakes-finetune --config configs/finetune-gpu.json

It loads a committed JSON config (:class:`~pinakes_ml.finetune.FineTuneConfig`),
scores the held-out KGQA split with the **base** model, QLoRA-fine-tunes on the
assembled verbalization + QA corpus, scores the **tuned** model, writes a run
summary to the (git-ignored) output dir, and logs everything to MLflow. The full
run is local-only — CI never trains (the deps are absent and it downloads a model);
the pipeline's pure core is unit-tested on fixtures instead. See
``docs/finetune-runbook.md`` for the rented-GPU procedure.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pinakes_ml.finetune import (
    FineTuneConfig,
    before_after_report,
    evaluate_systems,
    require_finetune_deps,
    train_qlora,
)

# ml/ workspace root, resolved from this file's location (parents[2]).
_ML_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = _ML_ROOT / "configs" / "finetune-smoke.json"


def _load_eval_records(path: Path, limit: int | None) -> list[dict[str, object]]:
    from pinakes_ml.finetune import load_jsonl

    records = load_jsonl(path)
    return records[:limit] if limit is not None else records


def run(  # pragma: no cover - local-only
    config: FineTuneConfig, *, do_eval: bool = True
) -> dict[str, object]:
    """Score base -> train -> score tuned; return the run summary dict."""
    from pinakes_ml.finetune import HFCausalLMSystem

    require_finetune_deps()
    eval_records = _load_eval_records(
        Path(config.qa_eval_path), config.max_eval_samples
    )

    before: dict[str, object] = {}
    if do_eval:
        base_system = HFCausalLMSystem(
            config.base_model,
            device=config.device,
            max_new_tokens=config.max_new_tokens,
        )
        before = evaluate_systems(eval_records, {"base": base_system})["base"]

    result = train_qlora(config)

    after: dict[str, object] = {}
    report: dict[str, object] = {}
    if do_eval:
        tuned_system = HFCausalLMSystem(
            config.base_model,
            adapter_dir=result.adapter_dir,
            device=config.device,
            max_new_tokens=config.max_new_tokens,
        )
        after = evaluate_systems(eval_records, {"tuned": tuned_system})["tuned"]
        report = before_after_report(
            before, after, base_model=config.base_model, num_records=len(eval_records)
        )

    return {
        "config": config.to_dict(),
        "device": result.device,
        "numTrainRecords": result.num_train_records,
        "trainLoss": result.train_loss,
        "adapterDir": result.adapter_dir,
        "eval": report,
    }


def _log_to_mlflow(summary: dict[str, object]) -> None:  # pragma: no cover - local-only
    import mlflow

    from pinakes_ml import start_run

    config = summary["config"]  # type: ignore[index]
    with start_run(run_name="qlora-finetune"):
        params = (
            "base_model",
            "num_train_epochs",
            "learning_rate",
            "lora_r",
            "load_in_4bit",
        )
        for key in params:
            mlflow.log_param(key, config[key])  # type: ignore[index]
        mlflow.log_param("device", summary["device"])
        mlflow.log_metric("num_train_records", float(summary["numTrainRecords"]))
        if summary["trainLoss"] is not None:
            mlflow.log_metric("train_loss", float(summary["trainLoss"]))
        report = summary.get("eval") or {}
        if report:
            for phase in ("before", "after"):
                metrics = report[phase]  # type: ignore[index]
                for key in ("accuracyExact", "accuracyNormalized", "groundingRate"):
                    mlflow.log_metric(f"{phase}_{key}", float(metrics[key]))
            for key, value in report["delta"].items():  # type: ignore[index]
                mlflow.log_metric(f"delta_{key}", float(value))


def main(argv: list[str] | None = None) -> int:  # pragma: no cover - CLI entry
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument(
        "--base-dir",
        type=Path,
        default=_ML_ROOT,
        help="Base dir the config's paths resolve against (default: ml/).",
    )
    parser.add_argument("--output-dir", type=Path, default=None)
    parser.add_argument(
        "--no-eval", action="store_true", help="Skip before/after KGQA eval."
    )
    parser.add_argument("--no-mlflow", action="store_true")
    args = parser.parse_args(argv)

    config = FineTuneConfig.from_json(args.config).resolved(args.base_dir)
    if args.output_dir is not None:
        config = FineTuneConfig.from_dict(
            {**config.to_dict(), "output_dir": str(args.output_dir)}
        )

    summary = run(config, do_eval=not args.no_eval)

    out_path = Path(config.output_dir) / "run-summary.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    print(f"device={summary['device']} trainRecords={summary['numTrainRecords']}")
    report = summary.get("eval") or {}
    if report:
        b, a = report["before"], report["after"]  # type: ignore[index]
        print(
            f"KGQA exact  before={float(b['accuracyExact']):.4f} "
            f"after={float(a['accuracyExact']):.4f} "
            f"(delta {float(report['delta']['accuracyExact']):+.4f})"  # type: ignore[index]
        )
    print(f"adapter  -> {summary['adapterDir']}")
    print(f"summary  -> {out_path}")

    if not args.no_mlflow:
        _log_to_mlflow(summary)
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entry
    raise SystemExit(main())
