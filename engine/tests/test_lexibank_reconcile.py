"""Tests for reconciling the Lexibank wordlist corpus against the language lexicon.

Network-free: the wordform corpus, its cognate edges, and the lexicon are tiny on-disk
fixtures written to ``tmp_path``. Covers the per-language roll-up + coverage counts
(forms / languages, by licence class), the cognacy coverage (cognate sets / cognated
forms / ``COGNATE_WITH`` edges read off the corpus), and the language-level
**glottocode-first, then ISO 639-3** reconciliation (a glottocode match, an ISO
fallback, and a genuinely new language).
"""

from __future__ import annotations

import json
from pathlib import Path

from pinakes_engine.schema.glottolog_reconcile import LexiconLanguage
from pinakes_engine.schema.lexibank_reconcile import (
    cognate_coverage,
    reconcile_lexibank_against_languages,
    render_markdown,
)

_NODE_HEADER = (
    "csid:ID\t:LABEL\tname\tlang\tlanguage_code\tsource\tconfidence:float\t"
    "license\textra"
)
_EDGE_HEADER = ":START_ID\t:END_ID\t:TYPE\tconfidence:float"


def _node(
    csid: str, name: str, iso: str, glottocode: str, cognateset: str,
    language_name: str, license_: str = "CC-BY-4.0",
) -> str:
    extra = json.dumps(
        {"Language_Name": language_name, "cognateset": cognateset},
        sort_keys=True,
    )
    return (
        f"{csid}\tWordform\t{name}\t{iso}\t{glottocode}\t"
        f"lexibank-abvd\t0.8\t{license_}\t{extra}"
    )


def _write(path: Path, header: str, rows: list[str]) -> Path:
    path.write_text("\n".join([header, *rows]) + "\n", encoding="utf-8")
    return path


def _corpus(tmp_path: Path) -> tuple[Path, Path]:
    nodes = _write(
        tmp_path / "wordform.tsv",
        _NODE_HEADER,
        [
            # Fijian: two forms, one cognate set (glottocode match in lexicon).
            _node("cs:wordform:fij-5", "five: lima", "fij", "fiji1243",
                  "five-1", "Fijian"),
            _node("cs:wordform:fij-2", "two: rua", "fij", "fiji1243",
                  "two-2", "Fijian"),
            # Hawaiian: shares the five-1 cognate set (glottocode match).
            _node("cs:wordform:haw-5", "five: lima", "haw", "hawa1245",
                  "five-1", "Hawaiian"),
            # Tagalog: no glottocode in the lexicon → ISO 639-3 fallback match.
            _node("cs:wordform:tgl-5", "five: lima", "tgl", "taga1270",
                  "five-1", "Tagalog"),
            # Testlang: neither glottocode nor ISO in the lexicon → new.
            _node("cs:wordform:xyz-2", "two: bar", "xyz", "zzzz9999",
                  "two-9", "Testlang"),
        ],
    )
    edges = _write(
        tmp_path / "cognate-with.tsv",
        _EDGE_HEADER,
        [
            "cs:wordform:haw-5\tcs:wordform:fij-5\tCOGNATE_WITH\t0.6",
            "cs:wordform:tgl-5\tcs:wordform:fij-5\tCOGNATE_WITH\t0.6",
        ],
    )
    return nodes, edges


def _lexicon(tmp_path: Path) -> Path:
    header = "csid:ID\t:LABEL\tname\tiso639_2\tglottocode"
    rows = [
        "cs:language:fij\tLanguage\tFijian\tfij\tfiji1243",
        "cs:language:haw\tLanguage\tHawaiian\thaw\thawa1245",
        "cs:language:tgl\tLanguage\tTagalog\ttgl\t",  # ISO only, no glottocode
    ]
    return _write(tmp_path / "languages.tsv", header, rows)


def test_cognate_coverage_counts_sets_forms_and_edges(tmp_path: Path) -> None:
    nodes, edges = _corpus(tmp_path)
    cov = cognate_coverage(nodes, edges)
    assert cov.cognate_sets == 3  # five-1, two-2, two-9
    assert cov.forms_with_cognateset == 5
    assert cov.cognate_edges == 2


def test_reconcile_rolls_up_per_language_and_matches(tmp_path: Path) -> None:
    nodes, edges = _corpus(tmp_path)
    result = reconcile_lexibank_against_languages(
        nodes, edges, _lexicon(tmp_path)
    )
    c = result.coverage
    r = c.reconciliation

    assert c.total_facts == 5
    assert c.distinct_languages == 4  # fij, haw, tgl, xyz
    assert c.facts_by_license == {"CC-BY-4.0": 5}
    assert result.cognates.cognate_edges == 2

    # Fijian + Hawaiian by glottocode, Tagalog by ISO fallback, Testlang is new.
    assert r.matched == 3
    assert r.new == 1
    assert r.ambiguous == 0
    tagalog = next(s for s in r.matched_samples if s.name == "Tagalog")
    assert tagalog.matched_csid is not None  # matched a lexicon row
    assert tagalog.confidence == 0.95  # ISO fallback tier (glottocode missed)
    fijian = next(s for s in r.matched_samples if s.name == "Fijian")
    assert fijian.confidence == 1.0  # glottocode tier
    assert {s.name for s in r.new_samples} == {"Testlang"}


def test_render_markdown_reports_cognacy_and_reconciliation(tmp_path: Path) -> None:
    nodes, edges = _corpus(tmp_path)
    md = render_markdown(
        reconcile_lexibank_against_languages(nodes, edges, _lexicon(tmp_path))
    )
    assert "# Lexibank wordlist coverage" in md
    assert "| cognate sets | 3 |" in md
    assert "| COGNATE_WITH edges | 2 |" in md
    assert "| forms — licence `CC-BY-4.0` | 5 |" in md
    assert "matched (already curated) | 3" in md


def test_missing_files_contribute_zero(tmp_path: Path) -> None:
    cov = cognate_coverage(tmp_path / "absent.tsv", tmp_path / "absent-edges.tsv")
    assert cov.cognate_sets == 0
    assert cov.forms_with_cognateset == 0
    assert cov.cognate_edges == 0


def test_reconcile_reads_the_lexiconlanguage_shape(tmp_path: Path) -> None:
    # Guard that the loader the reconciler shares still yields LexiconLanguage rows.
    from pinakes_engine.schema.glottolog_reconcile import read_language_lexicon

    langs = read_language_lexicon(_lexicon(tmp_path))
    assert langs and all(isinstance(row, LexiconLanguage) for row in langs)
