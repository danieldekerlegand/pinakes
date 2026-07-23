"""The kaikki reconcile: edge volume + skipped tokens + language coverage (US-004).

``schema/kaikki_reconcile.py`` records what the acceptance asks for from the kaikki
etymology ingest: the edge volume by canonical ``:TYPE``, every etymology-template
token skipped as unmappable, and the per-language reconciliation against the language
lexicon. These tests drive the pure aggregation over the committed fixture extract.
"""

from __future__ import annotations

import json
from pathlib import Path

from culturescrape.schema.glottolog_reconcile import LexiconLanguage
from culturescrape.schema.kaikki_reconcile import (
    analyze_entries,
    build_kaikki_coverage,
)

_PACKAGE_ROOT = Path(__file__).resolve().parent.parent
_FIXTURE = _PACKAGE_ROOT / "tests" / "fixtures" / "kaikki" / "etymology.jsonl"


def _entries() -> list[dict]:
    return [
        json.loads(line)
        for line in _FIXTURE.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def test_analyze_entries_counts_edges_by_type() -> None:
    report = analyze_entries(_entries())
    assert report.total_entries == 6
    assert report.entries_with_edges == 6
    assert report.total_edges == 8
    assert report.edges_by_type == {
        "BORROWED_FROM": 2,
        "COGNATE_WITH": 2,
        "DERIVED_FROM": 4,
    }


def test_analyze_entries_reports_skipped_tokens() -> None:
    report = analyze_entries(_entries())
    # m (mention), l (link), and ncog (non-cognate) are unmappable and reported.
    assert report.unmappable_tokens == {"l": 1, "m": 1, "ncog": 1}
    assert report.total_unmappable == 3
    assert report.distinct_languages == 4


def test_build_coverage_reconciles_wordforms_by_iso(tmp_path: Path) -> None:
    # A tiny built wordform node file (the shape read_fact_nodes reads) + a lexicon
    # whose ISO 639-3 code matches one language — offline, no corpus build needed.
    nodes = tmp_path / "wordform.tsv"
    nodes.write_text(
        "csid:ID\t:LABEL\tname\tlang\tlanguage_code\tlicense\n"
        "cs:wordform:a\tWordform\tamiko\teo\t\tCC-BY-SA-3.0\n"
        "cs:wordform:b\tWordform\tbirdo\teo\t\tCC-BY-SA-3.0\n"
        "cs:wordform:c\tWordform\thierro\tspa\t\tCC-BY-SA-3.0\n",
        encoding="utf-8",
    )
    languages = [
        LexiconLanguage(
            csid="cs:language:spanish", name="Spanish", glottocode="", iso="spa"
        ),
    ]
    result = build_kaikki_coverage(nodes, _entries(), languages)

    cov = result.coverage
    # Two distinct languages among the wordforms (eo, spa); Spanish is matched.
    assert cov.distinct_languages == 2
    assert cov.reconciliation.matched == 1
    assert cov.reconciliation.new == 1
    assert "CC-BY-SA-3.0" in cov.facts_by_license
    # The etymology report rides alongside the language coverage.
    assert result.etymology.total_edges == 8
