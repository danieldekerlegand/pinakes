"""CLI: the cinematography-adherence eval tier (analyzer-bridge US-005).

Reproducer for the third adherence eval tier. Run from anywhere::

    uv run python -m pinakes_ml.eval_cinematography   # pinakes-eval-cinematography

Reads a shot-list fixture (``{style?, shots:[...]}``), evaluates it against the vendored
Analyzer cinematography constraint vocabulary, and writes two committed, byte-reproducible
artifacts:

* ``ml/cinematography/constraint-vocab.json`` — the vocabulary itself
  (corpus-independent; CI-gated byte-for-byte against the ``CONSTRAINT_VOCAB`` module).
* ``ml/manifests/cinematography-adherence-baseline.json`` — the adherence report
  (violation counts by rule + severity) over the committed shot fixture. A ratchet
  snapshot: a fresh eval of the fixture must equal it (gate in the test module).

``--check`` re-evaluates and exits non-zero on any drift from the committed
baseline/vocab (no writes) — the retraining-free gate an operator can run by hand.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pinakes_ml.cinematography_eval import CONSTRAINT_VOCAB, build_report

_ML_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_SHOTS = _ML_ROOT / "fixtures" / "cinematography" / "shots.json"
DEFAULT_VOCAB = _ML_ROOT / "cinematography" / "constraint-vocab.json"
DEFAULT_BASELINE = _ML_ROOT / "manifests" / "cinematography-adherence-baseline.json"


def load_shots(shots_path: Path) -> tuple[list[dict], dict | None]:
    """Read a shot-list fixture → ``(shots, style)``."""
    data = json.loads(shots_path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return data, None
    shots = data.get("shots") if isinstance(data.get("shots"), list) else []
    style = data.get("style") if isinstance(data.get("style"), dict) else None
    return shots, style


def _dump(obj: dict) -> str:
    return json.dumps(obj, indent=2, sort_keys=True) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shots", type=Path, default=DEFAULT_SHOTS)
    parser.add_argument("--vocab", type=Path, default=DEFAULT_VOCAB)
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--check", action="store_true",
                        help="Verify committed vocab/baseline match a fresh eval.")
    parser.add_argument("--no-mlflow", action="store_true")
    args = parser.parse_args(argv)

    shots, style = load_shots(args.shots)
    report = build_report(shots, style)
    vocab_text = _dump(CONSTRAINT_VOCAB)
    baseline_text = _dump(report)

    if args.check:
        problems = []
        if (not args.vocab.exists()
                or args.vocab.read_text(encoding="utf-8") != vocab_text):
            problems.append(f"vocab drift: {args.vocab}")
        if (not args.baseline.exists()
                or args.baseline.read_text(encoding="utf-8") != baseline_text):
            problems.append(f"baseline drift: {args.baseline}")
        if problems:
            for p in problems:
                print(f"DRIFT  {p}")
            return 1
        print("PASS   cinematography-adherence vocab + baseline in sync")
        return 0

    args.vocab.parent.mkdir(parents=True, exist_ok=True)
    args.baseline.parent.mkdir(parents=True, exist_ok=True)
    args.vocab.write_text(vocab_text, encoding="utf-8")
    args.baseline.write_text(baseline_text, encoding="utf-8")

    print(f"checked  = {report['checked']} shots")
    print(f"total    = {report['total']} violations {report['countsBySeverity']}")
    print(f"by rule  = {report['countsByRule']}")
    print(f"vocab    -> {args.vocab}")
    print(f"baseline -> {args.baseline}")

    if not args.no_mlflow:
        _log_to_mlflow(report)
    return 0


def _log_to_mlflow(report: dict) -> None:
    import mlflow

    from pinakes_ml import start_run

    with start_run(run_name="cinematography-adherence"):
        mlflow.log_param("vocabVersion", report["vocabVersion"])
        mlflow.log_metric("checked", report["checked"])
        mlflow.log_metric("total_violations", report["total"])
        for sev, value in report["countsBySeverity"].items():
            mlflow.log_metric(f"severity_{sev}", value)
        for rule, value in report["countsByRule"].items():
            mlflow.log_metric(f"rule_{rule}", value)


if __name__ == "__main__":  # pragma: no cover - CLI entry
    raise SystemExit(main())
