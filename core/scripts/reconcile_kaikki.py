#!/usr/bin/env python
"""Reconcile the kaikki.org Wiktionary etymology corpus to the language lexicon.

kaikki entries are ingested (category ``kaikki.yml``, job ``jobs/kaikki.yml``) as
language-keyed **Wordform** nodes, and the linguistic linker turns each entry's
etymology relations into ``BORROWED_FROM`` / ``DERIVED_FROM`` / ``COGNATE_WITH``
edges. This driver runs the **reconcile** step: it loads the built wordform nodes and
rolls them up per language, classifying each distinct language against
``lexicons/languages.tsv`` by the ISO 639-3 join, and re-reads the source extract to
report the edge volume by ``:TYPE`` plus the etymology-template tokens skipped as
unmappable.

The corpus build must have run first::

    uv run culturescrape run jobs/kaikki.yml     # acquire → normalize → stitch → link

Then::

    uv run python scripts/reconcile_kaikki.py

writes ``out/kaikki/reconciliation/{report.json,report.md}`` (gitignored) and prints a
one-line summary; commit the narrative summary in ``docs/kaikki-reconciliation.md``.
The matching + tallying logic lives in ``culturescrape.schema.kaikki_reconcile``
(type-checked, unit-tested); this script is only path-wiring + I/O.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from culturescrape.schema.kaikki_reconcile import (
    reconcile_kaikki_against_languages,
    render_markdown,
)

#: Repo root = two levels up from core/.
_PACKAGE_ROOT = Path(__file__).resolve().parent.parent
_REPO_ROOT = _PACKAGE_ROOT.parent

DEFAULT_WORDFORM_NODES = (
    _PACKAGE_ROOT / "out" / "kaikki" / "corpus" / "nodes" / "wordform.tsv"
)
#: The source extract the category ingests (committed fixture slice by default).
DEFAULT_EXTRACT = _PACKAGE_ROOT / "tests" / "fixtures" / "kaikki" / "etymology.jsonl"
DEFAULT_LEXICON = _REPO_ROOT / "lexicons" / "languages.tsv"
DEFAULT_OUT_DIR = _PACKAGE_ROOT / "out" / "kaikki" / "reconciliation"


def load_entries(path: Path) -> Iterator[dict[str, Any]]:
    """Yield one entry dict per non-blank JSONL line of the source extract."""
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        entry = json.loads(stripped)
        if isinstance(entry, dict):
            yield entry


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wordform-nodes", type=Path, default=DEFAULT_WORDFORM_NODES)
    parser.add_argument("--extract", type=Path, default=DEFAULT_EXTRACT)
    parser.add_argument("--lexicon", type=Path, default=DEFAULT_LEXICON)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    args = parser.parse_args(argv)

    if not args.wordform_nodes.is_file():
        print(
            f"error: no wordform node file at {args.wordform_nodes}\n"
            "run `uv run culturescrape run jobs/kaikki.yml` first.",
            file=sys.stderr,
        )
        return 1
    if not args.extract.is_file():
        print(f"error: source extract not found at {args.extract}", file=sys.stderr)
        return 1
    if not args.lexicon.is_file():
        print(f"error: lexicon not found at {args.lexicon}", file=sys.stderr)
        return 1

    coverage = reconcile_kaikki_against_languages(
        args.wordform_nodes, load_entries(args.extract), args.lexicon
    )

    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "report.json").write_text(
        json.dumps(coverage.to_dict(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    (args.out_dir / "report.md").write_text(
        render_markdown(coverage), encoding="utf-8"
    )

    e = coverage.etymology
    r = coverage.coverage.reconciliation
    print(
        f"kaikki reconcile: {e.total_edges} edges "
        f"({', '.join(f'{k}={v}' for k, v in e.edges_by_type.items())}); "
        f"{e.total_unmappable} unmappable token(s) skipped; "
        f"languages {r.matched} matched / {r.new} new / {r.ambiguous} ambiguous "
        f"-> {args.out_dir}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
