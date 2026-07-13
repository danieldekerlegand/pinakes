"""Tests for reconciling the Glottolog corpus against ``lexicons/languages.tsv``.

Network-free: both sides are tiny on-disk TSV fixtures written to ``tmp_path``.
Covers the two loaders (glottocode + ISO-from-overflow on the corpus side; csid
minting + code columns on the lexicon side) and, above all, the **glottocode-first,
then ISO 639-3** cascade — including the ISO fallback, ambiguity on a shared code,
and a genuinely new languoid.
"""

from __future__ import annotations

import json
from pathlib import Path

from culturescrape.schema.glottolog_reconcile import (
    GlottologNode,
    LexiconLanguage,
    read_glottolog_nodes,
    read_language_lexicon,
    reconcile_glottolog,
    reconcile_glottolog_against_languages,
    render_markdown,
)

_CORPUS_HEADER = (
    "csid:ID\t:LABEL\tname\tlanguage_code\tsource\tconfidence:float\tlicense\textra"
)


def _write(path: Path, header: str, rows: list[str]) -> Path:
    path.write_text("\n".join([header, *rows]) + "\n", encoding="utf-8")
    return path


def _corpus_row(csid: str, name: str, glottocode: str, iso: str = "") -> str:
    extra = json.dumps({"ISO639P3code": iso}) if iso else ""
    return f"{csid}\tLanguage\t{name}\t{glottocode}\tglottolog\t0.8\tCC-BY-4.0\t{extra}"


def test_read_glottolog_nodes_reads_glottocode_and_iso_from_overflow(
    tmp_path: Path,
) -> None:
    path = _write(
        tmp_path / "language.tsv",
        _CORPUS_HEADER,
        [
            _corpus_row("cs:language:mand", "Mandarin Chinese", "mand1415", "cmn"),
            _corpus_row("cs:language:sino", "Sino-Tibetan", "sino1245"),  # no ISO
        ],
    )
    nodes = read_glottolog_nodes(path)
    assert nodes[0] == GlottologNode(
        csid="cs:language:mand",
        name="Mandarin Chinese",
        glottocode="mand1415",
        iso="cmn",
    )
    assert nodes[1].iso == ""  # blank overflow ⇒ no ISO key


def test_matches_by_glottocode_first(tmp_path: Path) -> None:
    nodes = [GlottologNode("cs:language:mand", "Mandarin Chinese", "mand1415", "cmn")]
    languages = [LexiconLanguage("cs:language:cmn", "Mandarin", "mand1415", "cmn")]
    summary = reconcile_glottolog(nodes, languages)
    assert (summary.matched, summary.new, summary.ambiguous) == (1, 0, 0)
    assert summary.matched_samples[0].matched_csid == "cs:language:cmn"
    assert summary.matched_samples[0].confidence == 1.0


def test_falls_back_to_iso_when_the_lexicon_row_lacks_a_glottocode(
    tmp_path: Path,
) -> None:
    # The lexicon's Yue row carries no glottocode, only its ISO 639-3 code, so the
    # glottocode key misses and the cascade falls through to ISO.
    nodes = [GlottologNode("cs:language:yue", "Yue Chinese", "yuec1235", "yue")]
    languages = [LexiconLanguage("cs:language:yue", "Cantonese", "", "yue")]
    summary = reconcile_glottolog(nodes, languages)
    assert (summary.matched, summary.new, summary.ambiguous) == (1, 0, 0)
    assert summary.matched_samples[0].confidence == 0.95  # ISO tier


def test_shared_code_is_ambiguous_and_never_auto_merged(tmp_path: Path) -> None:
    nodes = [GlottologNode("cs:language:x", "Ambiguous Lect", "", "tot")]
    languages = [
        LexiconLanguage("cs:language:a", "Totonac A", "", "tot"),
        LexiconLanguage("cs:language:b", "Totonac B", "", "tot"),
    ]
    summary = reconcile_glottolog(nodes, languages)
    assert (summary.matched, summary.new, summary.ambiguous) == (0, 0, 1)


def test_new_when_neither_key_matches(tmp_path: Path) -> None:
    nodes = [GlottologNode("cs:language:new", "Beijing Mandarin", "beij1234", "")]
    languages = [LexiconLanguage("cs:language:cmn", "Mandarin", "mand1415", "cmn")]
    summary = reconcile_glottolog(nodes, languages)
    assert (summary.matched, summary.new, summary.ambiguous) == (0, 1, 0)
    assert summary.union_distinct == 2  # 1 existing + 1 new


def test_end_to_end_from_tsv_fixtures(tmp_path: Path) -> None:
    corpus = _write(
        tmp_path / "language.tsv",
        _CORPUS_HEADER,
        [
            _corpus_row("cs:language:mand", "Mandarin Chinese", "mand1415", "cmn"),
            _corpus_row("cs:language:yue", "Yue Chinese", "yuec1235", "yue"),
            _corpus_row("cs:language:sino", "Sino-Tibetan", "sino1245"),
        ],
    )
    lexicon = _write(
        tmp_path / "languages.tsv",
        "id\tname\tglottocode\tiso639_2",
        [
            "cmn\tMandarin\tmand1415\tcmn",  # glottocode match
            "yue\tCantonese\t\tyue",  # ISO fallback
        ],
    )
    summary = reconcile_glottolog_against_languages(corpus, lexicon)
    assert summary.incoming_total == 3
    assert summary.existing_total == 2
    assert (summary.matched, summary.new, summary.ambiguous) == (2, 1, 0)
    assert "glottocode first" in render_markdown(summary)


def test_read_language_lexicon_requires_a_name_column(tmp_path: Path) -> None:
    path = _write(tmp_path / "bad.tsv", "id\tglottocode", ["x\tmand1415"])
    try:
        read_language_lexicon(path)
    except ValueError as exc:
        assert "name" in str(exc)
    else:  # pragma: no cover - the call must raise
        raise AssertionError("expected a ValueError for a missing name column")
