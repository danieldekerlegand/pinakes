#!/usr/bin/env python
"""Reconcile the Glottolog languoid corpus against LinguaScrape's language lexicon.

Glottolog (`docs/sources-linguistic.md`) is the authoritative language-identity
source, so many languoids it ingests already exist in `lexicons/languages.tsv`. This
driver runs the **reconcile** step: it loads the deduplicated Language nodes built by
``culturescrape run jobs/glottolog.yml`` and classifies each against the existing
languages by a **glottocode-first, then ISO 639-3** cascade (matched / new /
ambiguous), so a downstream write-back adds only genuinely new languoids and never
duplicates a curated language.

The corpus build must have run first::

    uv run culturescrape run jobs/glottolog.yml     # acquire → normalize → stitch

Then::

    uv run python scripts/reconcile_glottolog.py

writes ``out/glottolog/reconciliation/{report.json,report.md}`` (gitignored) and
prints a one-line summary; commit the narrative summary in
``docs/glottolog-reconciliation.md``. The matching logic lives in
``culturescrape.schema.glottolog_reconcile`` (type-checked, unit-tested); this
script is only path-wiring + I/O.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from culturescrape.schema.glottolog_reconcile import (
    reconcile_glottolog_against_languages,
    render_markdown,
)

#: Repo root = two levels up from packages/culture-scrape/.
_PACKAGE_ROOT = Path(__file__).resolve().parent.parent
_REPO_ROOT = _PACKAGE_ROOT.parent.parent

DEFAULT_CORPUS_NODES = (
    _PACKAGE_ROOT / "out" / "glottolog" / "corpus" / "nodes" / "language.tsv"
)
DEFAULT_LEXICON = _REPO_ROOT / "lexicons" / "languages.tsv"
DEFAULT_OUT_DIR = _PACKAGE_ROOT / "out" / "glottolog" / "reconciliation"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-nodes", type=Path, default=DEFAULT_CORPUS_NODES)
    parser.add_argument("--lexicon", type=Path, default=DEFAULT_LEXICON)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    args = parser.parse_args(argv)

    if not args.corpus_nodes.is_file():
        print(
            f"error: corpus nodes not found at {args.corpus_nodes}\n"
            "run `uv run culturescrape run jobs/glottolog.yml` first.",
            file=sys.stderr,
        )
        return 1
    if not args.lexicon.is_file():
        print(f"error: lexicon not found at {args.lexicon}", file=sys.stderr)
        return 1

    summary = reconcile_glottolog_against_languages(args.corpus_nodes, args.lexicon)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "report.json").write_text(
        json.dumps(summary.to_dict(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    (args.out_dir / "report.md").write_text(
        render_markdown(summary), encoding="utf-8"
    )

    print(
        f"glottolog reconcile: ingested={summary.incoming_total} "
        f"existing={summary.existing_total} matched={summary.matched} "
        f"new={summary.new} ambiguous={summary.ambiguous} "
        f"union_distinct={summary.union_distinct}"
    )
    print(f"wrote {args.out_dir}/report.json + report.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
