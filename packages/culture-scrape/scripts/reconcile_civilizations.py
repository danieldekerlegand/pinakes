#!/usr/bin/env python
"""Reconcile the acquired civilizations corpus against LinguaScrape's lexicon.

The civilizations pilot (`docs/prd-linguascrape-deep-history-roadmap.md` §15) grows
the ``civilizations`` domain from the curated 89 toward 150+. This driver runs the
**reconcile** step of that pipeline: it loads the deduplicated Culture nodes built by
``culturescrape run jobs/civilizations.yml`` and classifies each against the existing
rows in ``lexicons/civilizations.tsv`` (matched / new / ambiguous), so the write-back
(LinguaScrape's ``scripts/import-from-culturescrape.ts``) adds only genuinely new
civilizations and never duplicates a curated one.

Acquisition (network) and the corpus build must have run first::

    uv run culturescrape run jobs/civilizations.yml     # acquire → normalize → stitch

Then::

    uv run python scripts/reconcile_civilizations.py

writes ``out/civilizations/reconciliation/{report.json,report.md}`` (gitignored) and
prints a one-line summary. The matching logic lives in
``culturescrape.schema.lexicon_reconcile`` (type-checked, unit-tested); this script
is only path-wiring + I/O.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from culturescrape.schema.lexicon_reconcile import (
    reconcile_corpus_against_lexicon,
    render_markdown,
)

#: Repo root = three levels up from this file (packages/culture-scrape/scripts/).
_PACKAGE_ROOT = Path(__file__).resolve().parent.parent
_REPO_ROOT = _PACKAGE_ROOT.parent.parent

_CORPUS = _PACKAGE_ROOT / "out" / "civilizations" / "corpus"
DEFAULT_CORPUS_NODES = _CORPUS / "nodes" / "culture.tsv"
DEFAULT_LEXICON = _REPO_ROOT / "lexicons" / "civilizations.tsv"
DEFAULT_OUT_DIR = _PACKAGE_ROOT / "out" / "civilizations" / "reconciliation"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-nodes", type=Path, default=DEFAULT_CORPUS_NODES)
    parser.add_argument("--lexicon", type=Path, default=DEFAULT_LEXICON)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    args = parser.parse_args(argv)

    if not args.corpus_nodes.is_file():
        print(
            f"error: corpus nodes not found at {args.corpus_nodes}\n"
            "run `uv run culturescrape run jobs/civilizations.yml` first.",
            file=sys.stderr,
        )
        return 1
    if not args.lexicon.is_file():
        print(f"error: lexicon not found at {args.lexicon}", file=sys.stderr)
        return 1

    _report, summary = reconcile_corpus_against_lexicon(
        args.corpus_nodes,
        args.lexicon,
        domain="civilizations",
        label="Culture",
        node_type="culture",
    )

    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "report.json").write_text(
        json.dumps(summary.to_dict(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    (args.out_dir / "report.md").write_text(render_markdown(summary), encoding="utf-8")

    print(
        f"civilizations reconcile: acquired={summary.incoming_total} "
        f"existing={summary.existing_total} matched={summary.matched} "
        f"new={summary.new} ambiguous={summary.ambiguous} "
        f"union_distinct={summary.union_distinct}"
    )
    print(f"wrote {args.out_dir}/report.json + report.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
