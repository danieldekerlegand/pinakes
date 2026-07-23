#!/usr/bin/env python
"""Reconcile the WALS / PHOIBLE typology & phonology facts to the language lexicon.

WALS structural features and PHOIBLE phoneme inventories are ingested (categories
``wals.yml`` / ``phoible.yml``, job ``jobs/typology.yml``) as language-keyed attribute
facts. This driver runs the **reconcile** step: it loads the built fact nodes and rolls
them up per language, classifying each distinct language against
``lexicons/languages.tsv`` by a **glottocode-first, then ISO 639-3** cascade, and
records the coverage (facts / languages by node type and by licence class, matched /
new / ambiguous languages).

The corpus build must have run first::

    uv run culturescrape run jobs/typology.yml     # acquire → normalize → stitch

Then::

    uv run python scripts/reconcile_typology.py

writes ``out/typology/reconciliation/{report.json,report.md}`` (gitignored) and prints
a one-line summary; commit the narrative summary in
``docs/wals-phoible-reconciliation.md``. The matching logic lives in
``culturescrape.schema.typology_reconcile`` (type-checked, unit-tested); this script is
only path-wiring + I/O.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from culturescrape.schema.typology_reconcile import (
    reconcile_typology_against_languages,
    render_markdown,
)

#: Repo root = two levels up from core/.
_PACKAGE_ROOT = Path(__file__).resolve().parent.parent
_REPO_ROOT = _PACKAGE_ROOT.parent

_CORPUS_NODES = _PACKAGE_ROOT / "out" / "typology" / "corpus" / "nodes"
#: Built fact node files by node type (WALS → typology, PHOIBLE → phoneme).
DEFAULT_NODE_FILES = {
    "typology": _CORPUS_NODES / "typology.tsv",
    "phoneme": _CORPUS_NODES / "phoneme.tsv",
}
DEFAULT_LEXICON = _REPO_ROOT / "lexicons" / "languages.tsv"
DEFAULT_OUT_DIR = _PACKAGE_ROOT / "out" / "typology" / "reconciliation"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-nodes", type=Path, default=_CORPUS_NODES)
    parser.add_argument("--lexicon", type=Path, default=DEFAULT_LEXICON)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    args = parser.parse_args(argv)

    node_files = {
        "typology": args.corpus_nodes / "typology.tsv",
        "phoneme": args.corpus_nodes / "phoneme.tsv",
    }
    if not any(path.is_file() for path in node_files.values()):
        print(
            f"error: no fact node files found under {args.corpus_nodes}\n"
            "run `uv run culturescrape run jobs/typology.yml` first.",
            file=sys.stderr,
        )
        return 1
    if not args.lexicon.is_file():
        print(f"error: lexicon not found at {args.lexicon}", file=sys.stderr)
        return 1

    coverage = reconcile_typology_against_languages(node_files, args.lexicon)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "report.json").write_text(
        json.dumps(coverage.to_dict(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    (args.out_dir / "report.md").write_text(
        render_markdown(coverage), encoding="utf-8"
    )

    r = coverage.reconciliation
    print(
        f"typology reconcile: facts={coverage.total_facts} "
        f"languages={coverage.distinct_languages} "
        f"matched={r.matched} new={r.new} ambiguous={r.ambiguous} "
        f"licenses={','.join(coverage.licenses)}"
    )
    print(f"wrote {args.out_dir}/report.json + report.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
