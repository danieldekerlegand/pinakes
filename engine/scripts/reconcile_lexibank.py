#!/usr/bin/env python
"""Reconcile the Lexibank wordlist corpus to the language lexicon + report cognacy.

A Lexibank CLDF wordlist (category ``lexibank-abvd.yml``, job ``jobs/lexibank.yml``)
is ingested as language-keyed **Wordform** attribute facts, with cognate sets linked
into ``COGNATE_WITH`` representative stars. This driver runs the **reconcile** step:
it loads the built wordform nodes, rolls them up per language, classifies each
distinct language against ``data/source/lexicons/languages.tsv`` by a
**glottocode-first, then
ISO 639-3** cascade, and records coverage — forms / distinct languages, by licence
class, cognate sets / forms-with-cognacy / ``COGNATE_WITH`` edges, matched / new /
ambiguous languages.

The corpus build must have run first::

    uv run pinakes_engine run jobs/lexibank.yml     # acquire → normalize → link

Then::

    uv run python scripts/reconcile_lexibank.py

writes ``out/lexibank/reconciliation/{report.json,report.md}`` (gitignored) and prints
a one-line summary; commit the narrative summary in
``docs/lexibank-reconciliation.md``. The matching logic lives in
``pinakes_engine.schema.lexibank_reconcile`` (type-checked, unit-tested); this script
is only path-wiring + I/O.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from pinakes_engine.schema.lexibank_reconcile import (
    COGNATE_EDGE_FILE,
    reconcile_lexibank_against_languages,
    render_markdown,
)

#: Repo root = two levels up from core/.
_PACKAGE_ROOT = Path(__file__).resolve().parent.parent
_REPO_ROOT = _PACKAGE_ROOT.parent

_CORPUS = _PACKAGE_ROOT / "out" / "lexibank" / "corpus"
DEFAULT_NODES = _CORPUS / "nodes" / "wordform.tsv"
DEFAULT_EDGES = _CORPUS / "edges" / COGNATE_EDGE_FILE
DEFAULT_LEXICON = _REPO_ROOT / "data" / "source" / "lexicons" / "languages.tsv"
DEFAULT_OUT_DIR = _PACKAGE_ROOT / "out" / "lexibank" / "reconciliation"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--nodes", type=Path, default=DEFAULT_NODES)
    parser.add_argument("--edges", type=Path, default=DEFAULT_EDGES)
    parser.add_argument("--lexicon", type=Path, default=DEFAULT_LEXICON)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    args = parser.parse_args(argv)

    if not args.nodes.is_file():
        print(
            f"error: no wordform node file at {args.nodes}\n"
            "run `uv run pinakes_engine run jobs/lexibank.yml` first.",
            file=sys.stderr,
        )
        return 1
    if not args.lexicon.is_file():
        print(f"error: lexicon not found at {args.lexicon}", file=sys.stderr)
        return 1

    result = reconcile_lexibank_against_languages(
        args.nodes, args.edges, args.lexicon
    )

    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "report.json").write_text(
        json.dumps(result.to_dict(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    (args.out_dir / "report.md").write_text(
        render_markdown(result), encoding="utf-8"
    )

    c = result.coverage
    r = c.reconciliation
    g = result.cognates
    print(
        f"lexibank reconcile: forms={c.total_facts} "
        f"languages={c.distinct_languages} "
        f"cognate_sets={g.cognate_sets} cognate_edges={g.cognate_edges} "
        f"matched={r.matched} new={r.new} ambiguous={r.ambiguous} "
        f"licenses={','.join(c.licenses)}"
    )
    print(f"wrote {args.out_dir}/report.json + report.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
