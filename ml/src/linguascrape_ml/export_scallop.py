"""CLI: export the Scallop context + translate the Horn rules, and (locally) smoke it.

Reproducer for Phase-5 US-001. Run from anywhere::

    uv run python -m linguascrape_ml.export_scallop            # build artifacts
    uv run linguascrape-export-scallop                         # console script
    uv run python -m linguascrape_ml.export_scallop --smoke    # + real scallopy run

The default build is a **pure function** of the canonical edge export + the
committed rules registry (:mod:`linguascrape_ml.scallop`). It writes:

* ``ml/data/scallop/relations/<rel>.csv`` — interned integer ``head_id,tail_id``
  fact tables (one per relation), DVC-tracked / git-ignored;
* ``ml/data/scallop/symbols.tsv`` — the deterministic ``id<TAB>csid`` interning;
* ``ml/scallop/program.scl`` — the translated Scallop program (committed;
  corpus-independent, so CI checks it byte-for-byte against a fresh registry
  translation);
* ``ml/manifests/scallop-export-manifest.json`` — the committed, snapshot-tested
  manifest (counts + translated/skipped rules + the smoke reference derivations).

``--smoke`` additionally loads the program into ``scallopy`` and answers
``ancestor/2`` and ``influenced_transitively/2`` over the real corpus, asserting
agreement with the engine-free reference derivation
(:func:`linguascrape_ml.scallop.reference_derivations`). ``scallopy`` is a heavy,
**undeclared** dependency (its only published wheel is macOS/arm64), so this path
is local-only and gated by :func:`require_scallop_deps` — see
``docs/scallop-pilot.md``.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from linguascrape_ml.scallop import (
    SMOKE_TARGETS,
    TranslatedRule,
    build_manifest,
    build_scl,
    intern_symbols,
    load_registry,
    load_relations,
    reference_derivations,
    translate_registry,
)

# ml/ workspace root and repo root, resolved from this file's location.
_ML_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = _ML_ROOT.parent

DEFAULT_EDGES_DIR = _REPO_ROOT / "export" / "culturescrape" / "edges"
DEFAULT_REGISTRY = (
    _REPO_ROOT
    / "packages"
    / "culture-scrape"
    / "src"
    / "culturescrape"
    / "datalog"
    / "rules_registry.tsv"
)
DEFAULT_DATA_DIR = _ML_ROOT / "data" / "scallop"
DEFAULT_PROGRAM = _ML_ROOT / "scallop" / "program.scl"
DEFAULT_MANIFEST = _ML_ROOT / "manifests" / "scallop-export-manifest.json"

#: Dependencies the actual scallopy smoke run needs (undeclared — install on a
#: compatible interpreter with ``uv pip install scallopy``).
_SCALLOP_DEPS = ("scallopy",)


def require_scallop_deps() -> None:
    """Raise a clear, actionable error if ``scallopy`` is not installed.

    ``scallopy`` is deliberately not a declared dependency (see ``pyproject.toml``):
    its only published wheel (0.1.0) targets macOS/arm64 + CPython 3.9, so it does
    not resolve on this workspace's Linux / Python 3.11. Called at the top of
    :func:`run_smoke`; runs in CI (where the dep is absent) to assert the message
    is helpful.
    """
    import importlib.util

    missing = [m for m in _SCALLOP_DEPS if importlib.util.find_spec(m) is None]
    if missing:
        raise ImportError(
            f"The scallopy smoke run needs the (undeclared) neurosymbolic stack: "
            f"missing {missing}. Install it into the venv with `uv pip install "
            "scallopy` on a compatible interpreter (the published wheel is "
            "macOS/arm64 + CPython 3.9). See docs/scallop-pilot.md. The pure "
            "export + translation do not need it."
        )


def build(
    edges_dir: Path, registry_path: Path
) -> tuple[dict, dict, list, str, dict]:
    """Pure build: load corpus + registry → intern, translate, manifest.

    Returns ``(relations, symbols, translated, program_scl, manifest)``. No
    filesystem writes, no scallopy, no MLflow.
    """
    relations = load_relations(edges_dir)
    symbols = intern_symbols(relations)
    translation = translate_registry(load_registry(registry_path))
    program_scl = build_scl(translation.translated)
    manifest = build_manifest(relations, symbols, translation, program_scl)
    return relations, symbols, translation.translated, program_scl, manifest


def write_context(
    data_dir: Path,
    relations: dict[str, list[tuple[str, str]]],
    symbols: dict[str, int],
) -> None:
    """Write the interned relation CSVs + the symbol table under *data_dir*."""
    relations_dir = data_dir / "relations"
    relations_dir.mkdir(parents=True, exist_ok=True)
    for rel, pairs in sorted(relations.items()):
        rows = ["head_id,tail_id"]
        rows += [f"{symbols[head]},{symbols[tail]}" for head, tail in pairs]
        (relations_dir / f"{rel}.csv").write_text(
            "\n".join(rows) + "\n", encoding="utf-8"
        )
    symbol_rows = [
        f"{idx}\t{sym}" for sym, idx in sorted(symbols.items(), key=lambda kv: kv[1])
    ]
    (data_dir / "symbols.tsv").write_text(
        ("\n".join(symbol_rows) + "\n") if symbol_rows else "", encoding="utf-8"
    )


def write_program(program_path: Path, program_scl: str) -> None:
    """Write the committed Scallop program."""
    program_path.parent.mkdir(parents=True, exist_ok=True)
    program_path.write_text(program_scl, encoding="utf-8")


def write_manifest(manifest_path: Path, manifest: dict) -> None:
    """Write the committed export manifest (stable JSON, trailing newline)."""
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def run_smoke(
    relations: dict[str, list[tuple[str, str]]],
    translated: list[TranslatedRule],
) -> dict[str, dict]:  # pragma: no cover - local-only (scallopy is macOS/arm64)
    """Load the program into scallopy, answer the smoke queries, spot-check them.

    For each :data:`SMOKE_TARGETS` head, adds the base relations it reads (with the
    real corpus facts), adds the translated rule, runs Scallop, and asserts the
    derived extension equals :func:`reference_derivations`. Returns a per-head
    ``{scallop, reference, agree}`` summary. Raises ``AssertionError`` on any
    disagreement — the acceptance's "spot-checked against the engine output".
    """
    require_scallop_deps()
    import scallopy

    by_head = {t.head: t for t in translated}
    reference = reference_derivations(relations)
    summary: dict[str, dict] = {}

    for head, bases in SMOKE_TARGETS.items():
        rule = by_head.get(head)
        if rule is None:
            raise AssertionError(f"no translated rule for smoke target {head!r}")

        ctx = scallopy.ScallopContext()
        for base in bases:
            ctx.add_relation(base, (str, str))
            ctx.add_facts(base, list(relations.get(base, [])))
        for clause in rule.rules:
            ctx.add_rule(clause)
        ctx.run()

        derived = {(h, t) for (h, t) in ctx.relation(head)}
        expected = reference[head]
        agree = derived == expected
        summary[head] = {
            "scallop": len(derived),
            "reference": len(expected),
            "agree": agree,
        }
        if not agree:
            missing = sorted(expected - derived)[:5]
            extra = sorted(derived - expected)[:5]
            raise AssertionError(
                f"scallopy {head}/2 disagrees with the reference derivation: "
                f"scallop={len(derived)} reference={len(expected)} "
                f"missing≈{missing} extra≈{extra}"
            )
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--edges-dir", type=Path, default=DEFAULT_EDGES_DIR)
    parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--program", type=Path, default=DEFAULT_PROGRAM)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="After building, run the real scallopy smoke (needs scallopy; local).",
    )
    args = parser.parse_args(argv)

    if not args.registry.exists():
        parser.error(f"rules registry not found: {args.registry}")
    if not args.edges_dir.exists():
        parser.error(
            f"edges dir not found: {args.edges_dir}\n"
            "The canonical export is DVC-tracked — run "
            "`uv run --project ml dvc pull` (or regenerate it with "
            "`npx tsx scripts/export-for-culturescrape.ts`) first."
        )

    relations, symbols, translated, program_scl, manifest = build(
        args.edges_dir, args.registry
    )
    write_context(args.data_dir, relations, symbols)
    write_program(args.program, program_scl)
    write_manifest(args.manifest, manifest)

    counts = manifest["counts"]
    print(
        f"symbols={counts['symbols']} relations={counts['relations']} "
        f"facts={counts['facts']} rules(translated={counts['rulesTranslated']} "
        f"skipped={counts['rulesSkipped']})"
    )
    for rule_id, reason in (
        (s["ruleId"], s["reason"]) for s in manifest["skippedRules"]
    ):
        print(f"  skipped {rule_id}: {reason}")
    print(f"context  -> {args.data_dir}")
    print(f"program  -> {args.program}")
    print(f"manifest -> {args.manifest}")

    if args.smoke:
        summary = run_smoke(relations, translated)
        for head, stats in summary.items():
            mark = "OK" if stats["agree"] else "MISMATCH"
            print(f"  smoke {head}/2: scallop={stats['scallop']} "
                  f"reference={stats['reference']} [{mark}]")

    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entry
    raise SystemExit(main())
