"""CLI: assemble the Insimul handoff bundle (slm-pilot US-005).

Phase D's loop closure. From ``ml/``::

    uv run pinakes-export-handoff --dry-run   # the bundle plan, touches nothing
    uv run pinakes-export-handoff             # assemble the bundle + the runbook block
    uv run pinakes-export-handoff --check     # re-verify a materialised bundle

It reads the artifacts the earlier stories already produced — the US-004 parity
report (which carries the GGUF's identity, both score columns, the dataset hashes
and the frozen budget), the US-003 baseline report (the training config and the
grounding ablation) and the committed prompt contract — and writes the small
files that turn a 1.9 GB binary into something someone else can run:
``model-manifest.json``, ``prompt-contract.json``, the frozen eval set,
``LICENSE-NOTES.md`` and a bundle ``README.md``, all beside the GGUF in
``ml/models/slm-pilot/`` so one copy of ``ml/models`` delivers the lot.

**The eval set is rebuilt in process**, never copied out of ``ml/data`` — the
same builder, seed and split the training pipeline uses — so the bundle works in
a fresh worktree with no model build, and its sha256 is by construction the one
every score in the manifest was measured on.

``--check`` is the re-verification gate and it runs in CI: it rebuilds the eval
set and compares it to the committed manifest's ``evalSetSha256`` (a real gate,
fixture-driven, no corpus build needed), then — only if the bundle tree is actually
materialised — re-hashes every file against the manifest's inventory.

Runbook: ``docs/slm-insimul-runbook.md``.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from pinakes_ml.export_insimul_datasets import DEFAULT_CANDIDATES, DEFAULT_WORLDS
from pinakes_ml.slm_finetune import SlmPilotConfig, build_pilot_data
from pinakes_ml.slm_gguf import MODEL_SUBDIR, MODELS_DIRNAME
from pinakes_ml.slm_handoff import (
    BUNDLE_EVAL_FILE,
    BUNDLE_SIDECAR_FILES,
    CONTRACT_FILE,
    LICENSE_FILE,
    MODEL_MANIFEST_FILE,
    README_FILE,
    build_model_manifest,
    bundle_entry,
    bundle_inventory,
    render_bundle_readme,
    render_handoff_section,
    render_license_notes,
    upsert_marked_section,
    verify_bundle,
)
from pinakes_ml.slm_pilot import build_eval_set
from pinakes_ml.train_slm import hash_data_tree

_ML_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = _ML_ROOT / "configs" / "slm-pilot-3b.json"
CONTRACT_SOURCE = _ML_ROOT / "manifests" / "slm-prompt-contract.json"
MANIFEST_PATH = _ML_ROOT / "manifests" / "slm-handoff-manifest.json"
DEFAULT_DOC = _ML_ROOT.parent / "docs" / "slm-insimul-runbook.md"

PARITY_FILE = "parity-report.json"
BASELINE_FILE = "baseline-report.json"

#: The context the parity column was scored at, and therefore the only context
#: size the bundle's numbers describe.
DEFAULT_CONTEXT_SIZE = 4096

#: node-llama-cpp's own default (the provider maps ``-1`` to "let it decide").
DEFAULT_GPU_LAYERS = "auto"


def _read_json(path: Path, label: str, *, required: bool = True) -> dict:
    if not path.exists():
        if required:
            raise SystemExit(
                f"no {label} at {path}. Run the earlier stories first "
                "(`uv run pinakes-train-slm --config configs/slm-pilot-3b.json` "
                "then `uv run pinakes-export-gguf`)."
            )
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _eval_set_text(
    config: SlmPilotConfig, parser: argparse.ArgumentParser
) -> tuple[str, str]:
    """The frozen eval set's JSONL + sha256, rebuilt exactly as a run rebuilds it."""
    from pinakes_ml.insimul_datasets import serialize_examples

    worlds = [Path(p) for p in (config.worlds or DEFAULT_WORLDS)]
    candidates = [
        Path(p)
        for p in (config.candidates or [p for p in DEFAULT_CANDIDATES if p.exists()])
    ]
    for path in [*worlds, *candidates]:
        if not path.exists():
            parser.error(f"input not found: {path}")
    data = build_pilot_data(config, worlds, candidates)
    if not data.eval_set:
        parser.error("the frozen eval set is empty — pass two or more worlds.")
    # The FULL frozen eval set travels, not a run's possibly-truncated slice:
    # the bundle exists so the recipient can re-verify the protocol, and the
    # protocol's eval set is the untruncated one.
    full = build_eval_set(data.datasets)
    return serialize_examples(full), data.eval_sha256


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--base-dir", type=Path, default=_ML_ROOT)
    parser.add_argument(
        "--bundle-dir", type=Path, default=None,
        help=f"The bundle root (default: ml/{MODELS_DIRNAME}/{MODEL_SUBDIR}).",
    )
    parser.add_argument(
        "--parity", type=Path, default=None,
        help="The US-004 parity report (default: the config run's).",
    )
    parser.add_argument(
        "--baseline", type=Path, default=None,
        help="The US-003 baseline report (default: the config run's).",
    )
    parser.add_argument("--contract", type=Path, default=CONTRACT_SOURCE)
    parser.add_argument("--manifest", type=Path, default=MANIFEST_PATH)
    parser.add_argument("--doc", type=Path, default=DEFAULT_DOC)
    parser.add_argument("--no-doc", action="store_true")
    parser.add_argument("--no-mlflow", action="store_true")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print the bundle plan and stop; writes nothing.",
    )
    parser.add_argument(
        "--check", action="store_true",
        help="Re-verify: the committed manifest's eval-set hash against a fresh "
             "build, then (if materialised) every bundle file against its sha256.",
    )
    args = parser.parse_args(argv)

    config = SlmPilotConfig.from_json(args.config).resolved(args.base_dir)
    bundle_dir = args.bundle_dir or (
        Path(args.base_dir) / MODELS_DIRNAME / MODEL_SUBDIR
    )

    if args.check:
        return _check(args, config, bundle_dir, parser)

    if args.dry_run:
        print(json.dumps(
            {
                "bundleDir": str(bundle_dir),
                "files": [MODEL_MANIFEST_FILE, *BUNDLE_SIDECAR_FILES],
                "parity": str(args.parity or Path(config.output_dir) / PARITY_FILE),
                "baseline": str(
                    args.baseline or Path(config.output_dir) / BASELINE_FILE
                ),
                "contract": str(args.contract),
                "manifest": str(args.manifest),
            },
            indent=2, sort_keys=True,
        ))
        print("dry run — nothing written.")
        return 0

    parity = _read_json(
        args.parity or Path(config.output_dir) / PARITY_FILE, "parity report"
    )
    baseline = _read_json(
        args.baseline or Path(config.output_dir) / BASELINE_FILE,
        "baseline report", required=False,
    )
    contract = _read_json(args.contract, "prompt contract")

    eval_text, eval_sha256 = _eval_set_text(config, parser)
    recorded = (parity.get("dataset") or {}).get("evalSetSha256", "")
    if recorded and recorded != eval_sha256:
        raise SystemExit(
            "the parity report scored a different eval set than this build "
            f"reproduces ({recorded[:12]}… vs {eval_sha256[:12]}…). Bundling a "
            "model with an eval set it was not measured on defeats the point of "
            "shipping one — rerun the pipeline with this config."
        )

    bundle_dir.mkdir(parents=True, exist_ok=True)
    (bundle_dir / BUNDLE_EVAL_FILE).write_text(eval_text, encoding="utf-8")
    shutil.copyfile(args.contract, bundle_dir / CONTRACT_FILE)

    gguf_name = Path(str((parity.get("artifact") or {}).get("path", ""))).name
    gguf = bundle_entry(bundle_dir, gguf_name) if gguf_name else None
    if gguf is not None and not gguf["exists"]:
        # Not fatal: the manifest still records the identity the parity check
        # measured, and `--check` will report the file as missing. A worktree
        # without a materialised `ml/models` tree is the common case.
        print(f"NOTE     {gguf_name} is not materialised here — recording the "
              "identity from the parity report; rebuild `ml/models` to verify.")
        gguf = None

    manifest = build_model_manifest(
        parity,
        baseline=baseline,
        contract=contract,
        gguf=gguf,
        dataset_hash=hash_data_tree(Path(args.base_dir) / config.data_dir),
        context_size=DEFAULT_CONTEXT_SIZE,
        gpu_layers=DEFAULT_GPU_LAYERS,
        ml_root=str(Path(args.base_dir).resolve()),
    )
    # The prose is generated from the manifest, then the manifest is rebuilt with
    # the finished inventory — so every sha256 in it describes the bytes that
    # actually shipped, including the files written moments ago.
    (bundle_dir / LICENSE_FILE).write_text(
        render_license_notes(manifest), encoding="utf-8"
    )
    (bundle_dir / README_FILE).write_text(
        render_bundle_readme(manifest), encoding="utf-8"
    )
    manifest["files"] = bundle_inventory(bundle_dir, BUNDLE_SIDECAR_FILES)
    # ensure_ascii=False, like the prompt contract: this manifest is read by a
    # human on the receiving side, and escaped em-dashes make it unreadable.
    manifest_text = (
        json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    )
    (bundle_dir / MODEL_MANIFEST_FILE).write_text(manifest_text, encoding="utf-8")
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(manifest_text, encoding="utf-8")

    _print_bundle(manifest, bundle_dir, args.manifest)
    if not args.no_doc:
        _write_doc(args.doc, manifest)
    if not args.no_mlflow:  # pragma: no cover - local-only
        _log_to_mlflow(manifest)
    return 0


def _check(
    args: argparse.Namespace,
    config: SlmPilotConfig,
    bundle_dir: Path,
    parser: argparse.ArgumentParser,
) -> int:
    """The re-verification gate. Two tiers: the hash gate always runs, the
    file gate runs when the bundle is materialised."""
    if not args.manifest.exists():
        print(f"MISSING  {args.manifest} — run `pinakes-export-handoff` first.")
        return 1
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    _, eval_sha256 = _eval_set_text(config, parser)
    recorded = (manifest.get("dataset") or {}).get("evalSetSha256", "")
    if recorded != eval_sha256:
        print(
            f"DRIFT    the bundled eval set ({recorded[:12]}…) is no longer what "
            f"this repo builds ({eval_sha256[:12]}…). The bundle's scores "
            "describe an eval set nobody can reproduce — rebuild it."
        )
        return 1
    print(f"ok       eval set reproduces: {eval_sha256[:12]}…")
    if not bundle_dir.exists():
        print(f"NOTE     {bundle_dir} is not materialised (rebuild it "
              "to verify the files themselves) — hashes NOT checked.")
        return 0
    problems = verify_bundle(manifest, bundle_dir)
    for problem in problems:
        print(f"FAIL     {problem}")
    if problems:
        return 1
    print(f"ok       the model + {len(manifest.get('files') or ())} sidecar "
          "files match the manifest")
    return 0


def _print_bundle(manifest: dict, bundle_dir: Path, manifest_path: Path) -> None:
    model = manifest["model"]
    size = model.get("sizeBytes") or 0
    print(f"bundle   -> {bundle_dir}")
    print(f"model    = {model['file']} ({size / 1e9:.2f} GB) "
          f"sha256 {str(model['sha256'])[:12]}…")
    for entry in manifest["files"]:
        state = "ok" if entry["exists"] else "MISSING"
        print(f"  {state:<8} {entry['name']}")
    floor = (manifest.get("dataFloor") or {}).get("verdict")
    if floor:
        print(f"dataFloor= {floor} — the bundle is the deliverable; its scores "
              "are machinery, not a clearance.")
    print(f"manifest -> {manifest_path}")


def _write_doc(doc: Path, manifest: dict) -> None:
    if not doc.exists():
        print(f"NOTE     {doc} does not exist — the generated block needs the "
              "hand-written runbook around it; skipping.")
        return
    doc.write_text(
        upsert_marked_section(
            doc.read_text(encoding="utf-8"), render_handoff_section(manifest)
        ),
        encoding="utf-8",
    )
    print(f"doc      -> {doc}")


def _log_to_mlflow(manifest: dict) -> None:  # pragma: no cover - local-only
    import mlflow

    from pinakes_ml import start_run

    dataset = manifest["dataset"]
    with start_run(run_name="slm-handoff"):
        mlflow.log_param("bundleVersion", manifest["bundleVersion"])
        mlflow.log_param("contractVersion", manifest["contractVersion"])
        mlflow.log_param("protocolVersion", manifest["protocolVersion"])
        mlflow.log_param("baseModel", manifest["model"]["baseModel"])
        mlflow.log_param("ggufSha256", manifest["model"]["sha256"])
        mlflow.log_param("evalSetSha256", dataset.get("evalSetSha256", ""))
        mlflow.log_param("dataHash", dataset.get("dataHash", ""))
        mlflow.log_param(
            "baseModelLicense", manifest["license"]["baseModel"]["licenseId"]
        )
        mlflow.log_param(
            "dataFloorVerdict", (manifest.get("dataFloor") or {}).get("verdict", "")
        )


if __name__ == "__main__":  # pragma: no cover - CLI entry
    raise SystemExit(main())
