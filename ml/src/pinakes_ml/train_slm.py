"""CLI: run the SLM pilot's QLoRA pipeline end to end (slm-pilot US-002).

Reproducer for the Phase-D workflow backbone. From ``ml/``::

    uv run pinakes-train-slm --stub                       # the pipeline smoke
    uv pip install trl peft accelerate                    # the undeclared stack
    uv run pinakes-train-slm                              # the 0.5B debug run
    uv run pinakes-train-slm --config configs/slm-pilot-3b.json
    uv run pinakes-train-slm --stub --kft-job fixtures/kft/finetune-job.json

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

``--kft-job`` runs the same pipeline as a **KFT capability provider**
(90-finetune-provider): the manifest is admitted through :mod:`pinakes_ml.kft`
(specialization + the §4.2 egress gate — a refused job prints its report and
exits 2, having committed no compute), and on completion the run mints its KFT §5
model/weight records and §6 training-telemetry stream next to the run summary
(:mod:`pinakes_ml.kft_run`).

Runbook: ``docs/slm-pilot-runbook.md``. Protocol: ``docs/slm-pilot-protocol.md``.
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import UTC, datetime
from pathlib import Path

from pinakes_ml.export_insimul_datasets import DEFAULT_CANDIDATES, DEFAULT_WORLDS
from pinakes_ml.kft import AdmittedJob, JobRejected, admit
from pinakes_ml.kft_run import (
    ROLE_ADAPTER,
    ROLE_GGUF,
    ROLE_MERGED,
    mint_run_outputs,
    render_telemetry_jsonl,
)
from pinakes_ml.slm_baseline import (
    DEFAULT_GEMINI_MODEL,
    NOT_MEASURED_REASONS,
    STAGE_GEMINI,
    build_baseline_report,
    gemini_api_key,
    render_baseline_section,
    upsert_marked_section,
)
from pinakes_ml.slm_finetune import (
    ARM_GROUNDED,
    SlmPilotConfig,
    build_pilot_data,
    run_pipeline,
    score_model,
    stub_model_factory,
    stub_trainer,
)
from pinakes_ml.slm_gguf import MODEL_SUBDIR, MODELS_DIRNAME, build_plan

_ML_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = _ML_ROOT / "configs" / "slm-pilot-debug.json"
DEFAULT_DOC = _ML_ROOT.parent / "docs" / "ml-baselines.md"

SUMMARY_FILE = "run-summary.json"
REPORT_FILE = "baseline-report.json"
#: The KFT §6 training-telemetry stream and the §5 run record, written beside the
#: run summary in the git-ignored output dir. ``--kft-job`` only.
TELEMETRY_FILE = "kft-telemetry.jsonl"
RUN_RECORD_FILE = "kft-run.json"


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


def _utc_now() -> str:
    """The emission timestamp for a telemetry event (KFT §6 ``ts``).

    The only wall clock in the KFT path, and it lives in the CLI — the minting
    core takes ``ts`` as a parameter so the record stays reproducible in tests.
    """
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def repo_relative(path: Path) -> str:
    """A repo-root-relative spelling of ``path`` when it is inside the checkout.

    Admission hashes the **unresolved** config (``kft.engine_config_hash``), so
    two hosts admitting one job must agree — which they only do if the world
    paths that go into it are checkout-relative rather than ``/Users/…``.
    """
    try:
        return str(path.resolve().relative_to(_ML_ROOT.parent))
    except ValueError:  # pragma: no cover - a world outside the checkout
        return str(path)


def admit_kft_job(
    job_path: Path, worlds: list[Path], candidates: list[Path]
) -> AdmittedJob:
    """Admit a KFT finetune job → the pipeline config it becomes (KFT §3/§4)."""
    payload = json.loads(job_path.read_text(encoding="utf-8"))
    return admit(
        payload,
        worlds=[repo_relative(p) for p in worlds],
        candidates=[repo_relative(p) for p in candidates],
    )


def write_kft_outputs(
    admitted: AdmittedJob, summary: dict, config: SlmPilotConfig, *, ts: str
) -> dict:
    """Mint the run's KFT §5 record + §6 telemetry beside the run summary.

    The GGUF/merged paths come from :func:`pinakes_ml.slm_gguf.build_plan` — the
    same layout ``pinakes-export-gguf`` writes — so an asset is minted for the
    deliverable the deployment leg actually produces, and the roles it has not
    produced yet are reported as pending rather than invented.

    ``config`` is the run's *effective* config (CLI overrides applied), which is
    why it is passed rather than read off ``admitted``.
    """
    output_dir = Path(config.output_dir)
    plan = build_plan(
        config.base_model,
        summary["training"]["adapterDir"],
        output_dir,
        _ML_ROOT / MODELS_DIRNAME / MODEL_SUBDIR,
        run_name=config.run_name,
    )
    outputs = mint_run_outputs(
        admitted,
        summary,
        artifacts={
            ROLE_ADAPTER: plan.adapter_dir,
            ROLE_MERGED: plan.merged_dir,
            ROLE_GGUF: plan.quantized_gguf,
        },
        ts=ts,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / TELEMETRY_FILE).write_text(
        render_telemetry_jsonl(outputs.telemetry), encoding="utf-8"
    )
    record = outputs.as_dict()
    (output_dir / RUN_RECORD_FILE).write_text(
        json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"kft model  = {outputs.model.entity_id}")
    print(
        f"kft egress = {outputs.model.egress} / {outputs.model.license_class} "
        f"({len(outputs.assets)} weight asset(s), "
        f"pending {', '.join(outputs.pending_exports) or 'none'})"
    )
    print(f"telemetry -> {output_dir / TELEMETRY_FILE}")
    print(f"kft run   -> {output_dir / RUN_RECORD_FILE}")
    return record


def read_data_floor(manifest_path: Path) -> dict | None:
    """The frozen protocol's ``dataFloor`` block, copied forward verbatim.

    US-001's rule: the sufficiency verdict is a *field*, not a judgment call, and
    a downstream story reads it rather than re-deriving it.
    """
    if not manifest_path.exists():
        return None
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    floor = manifest.get("dataFloor")
    return dict(floor) if isinstance(floor, dict) else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument(
        "--kft-job", type=Path, default=None,
        help="A KFT finetune-job manifest (koine/schemas/finetune-job.schema.json). "
             "Admitted through pinakes_ml.kft INSTEAD of --config; a refused job "
             "prints its report and exits 2. Emits the §6 telemetry stream and "
             "the §5 run record beside the run summary.",
    )
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
    parser.add_argument(
        "--repeats", type=int, default=None,
        help="Train+score this many times at the SAME seed (default: the "
             "config's). The spread across repeats is the platform's float "
             "nondeterminism — report it, never a single draw.",
    )
    parser.add_argument(
        "--gemini", action="store_true",
        help="Also score the grounded-Gemini comparison point (needs "
             "GEMINI_API_KEY and google-generativeai; costs API calls).",
    )
    parser.add_argument("--gemini-model", default=DEFAULT_GEMINI_MODEL)
    parser.add_argument(
        "--doc", type=Path, default=DEFAULT_DOC,
        help="Markdown doc the SLM-PILOT comparison block is upserted into.",
    )
    parser.add_argument(
        "--no-doc", action="store_true", help="Skip the docs/ml-baselines.md upsert."
    )
    parser.add_argument("--no-mlflow", action="store_true")
    args = parser.parse_args(argv)

    admitted: AdmittedJob | None = None
    if args.kft_job is not None:
        # The job manifest names its own worlds only by KGP pack id (KFT §4.1),
        # so the data-plane inputs still come from the CLI's defaults; admission
        # decides everything else.
        job_worlds = [Path(p) for p in (args.worlds or DEFAULT_WORLDS)]
        job_candidates = [
            Path(p)
            for p in (args.candidates or [p for p in DEFAULT_CANDIDATES if p.exists()])
        ]
        try:
            admitted = admit_kft_job(args.kft_job, job_worlds, job_candidates)
        except JobRejected as exc:
            print(json.dumps(exc.report, indent=2, sort_keys=True))
            return 2
        admitted = admitted.resolved(args.base_dir)
        config = admitted.config
        for ignored in admitted.ignored_hyperparams:
            print(f"NOTE  hyperparam not implemented by this engine: {ignored}")
    else:
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

    dvc_md5 = read_dvc_md5(Path(config.dvc_file))
    repeats = max(1, args.repeats if args.repeats is not None else config.repeats)
    started = time.monotonic()
    summaries = []
    for index in range(1, repeats + 1):
        run_config = config
        if repeats > 1:
            # One adapter + summary per repeat, so a disagreeing draw can be
            # inspected rather than overwritten by the next one.
            run_config = SlmPilotConfig.from_dict(
                {
                    **config.to_dict(),
                    "output_dir": str(Path(config.output_dir) / f"repeat-{index}"),
                }
            )
        summary = run_pipeline(
            run_config,
            data,
            trainer=trainer,
            model_factory=model_factory,
            dataset_dvc_md5=dvc_md5,
            matches_frozen_eval_set=matches,
        )
        out_path = Path(run_config.output_dir) / SUMMARY_FILE
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(
            json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        if repeats > 1:
            print(f"--- repeat {index}/{repeats}")
        _print_report(summary, out_path)
        summaries.append(summary)
        if admitted is not None:
            write_kft_outputs(admitted, summary, run_config, ts=_utc_now())
        if not args.no_mlflow:
            _log_to_mlflow(summary)

    extra_stages, reasons = _score_gemini(args, data)
    report = build_baseline_report(
        summaries,
        extra_stages=extra_stages,
        data_floor=read_data_floor(Path(config.eval_manifest)),
        wall_clock_seconds=round(time.monotonic() - started, 3),
        reasons=reasons,
    )
    report_path = Path(config.output_dir) / REPORT_FILE
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"report   -> {report_path}")
    _write_doc(args, report)
    return 0


def _score_gemini(args, data) -> tuple[dict, dict]:
    """The ``grounded-gemini`` row — measured when possible, explained when not.

    A frozen comparison point is never dropped: without ``--gemini`` (or without
    a key) the row keeps its ``not-measured`` reason and the report says so.
    """
    reasons = dict(NOT_MEASURED_REASONS)
    if not args.gemini:
        reasons["grounded-gemini"] = (
            "not requested — rerun with `pinakes-train-slm --gemini` and a "
            "GEMINI_API_KEY to fill this row."
        )
        return {}, reasons
    if not gemini_api_key():
        print(f"NOTE  grounded-gemini: {reasons['grounded-gemini']}")
        return {}, reasons
    from pinakes_ml.slm_baseline import GeminiRuleModel  # pragma: no cover

    model = GeminiRuleModel(args.gemini_model)  # pragma: no cover
    scores = score_model(  # pragma: no cover
        model, data.eval_set, data.world_contexts, (ARM_GROUNDED,)
    )
    reasons.pop("grounded-gemini", None)  # pragma: no cover
    return {STAGE_GEMINI: scores}, reasons  # pragma: no cover


def _write_doc(args, report: dict) -> None:
    """Upsert the SLM-PILOT block — never from a stub run."""
    if args.no_doc:
        return
    if report["stub"]:
        print("NOTE  stub run — docs/ml-baselines.md not touched.")
        return
    existing = args.doc.read_text(encoding="utf-8") if args.doc.exists() else ""
    args.doc.parent.mkdir(parents=True, exist_ok=True)
    args.doc.write_text(
        upsert_marked_section(existing, render_baseline_section(report)),
        encoding="utf-8",
    )
    print(f"doc      -> {args.doc}")


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
