"""Tests for reconciling WALS / PHOIBLE facts against ``lexicons/languages.tsv``.

Network-free: both sides are tiny on-disk TSV fixtures written to ``tmp_path``. Covers
the fact-node loader (glottocode from ``language_code``, ISO from ``lang``, licence,
``Language_Name`` from the overflow), the per-language roll-up + coverage counts (facts
/ languages by node type and by licence class), and the language-level
**glottocode-first, then ISO 639-3** reconciliation — the ISO fallback and a new
language included.
"""

from __future__ import annotations

import json
from pathlib import Path

from pinakes_engine.acquire.categories import load_category
from pinakes_engine.acquire.factory import build_adapter
from pinakes_engine.acquire.http import HttpClient
from pinakes_engine.schema.glottolog_reconcile import LexiconLanguage
from pinakes_engine.schema.typology_reconcile import (
    FactNode,
    build_coverage,
    distinct_language_nodes,
    read_fact_nodes,
    reconcile_typology_against_languages,
    render_markdown,
)

#: Package root (categories/ + tests/fixtures/ resolve against it, as pytest's CWD).
_PACKAGE_ROOT = Path(__file__).resolve().parent.parent


def test_committed_categories_stamp_the_expected_spdx_license(tmp_path: Path) -> None:
    """The WALS / PHOIBLE category specs stamp their SPDX licence on every record.

    Proves AC2 at the source: a share-alike PHOIBLE row carries ``CC-BY-SA-3.0`` and a
    WALS row ``CC-BY-4.0``, so the packaged corpus is queryable by licence class. Runs
    the tabular-dump adapter offline over the committed fixture slices.
    """
    for name, expected in (("wals", "CC-BY-4.0"), ("phoible", "CC-BY-SA-3.0")):
        spec = load_category(_PACKAGE_ROOT / "inputs" / "categories" / f"{name}.yml")
        adapter = build_adapter(
            spec, http_factory=lambda: HttpClient(cache_dir=tmp_path)
        )
        records = list(adapter.fetch(spec))
        assert records, f"{name} fixture yielded no records"
        assert {r.provenance.license for r in records} == {expected}
        assert {r.provenance.source for r in records} == {name}
        # The glottocode reaches language_code and the ISO 639-3 code reaches lang.
        assert all(r.fields.get("language_code") for r in records)
        assert all(r.fields.get("lang") for r in records)


_CORPUS_HEADER = (
    "csid:ID\t:LABEL\tname\tlang\tlanguage_code\tsource\tconfidence:float\t"
    "license\textra"
)


def _write(path: Path, header: str, rows: list[str]) -> Path:
    path.write_text("\n".join([header, *rows]) + "\n", encoding="utf-8")
    return path


def _fact_row(
    csid: str,
    label: str,
    name: str,
    iso: str,
    glottocode: str,
    license_: str,
    language_name: str = "",
) -> str:
    extra = json.dumps({"Language_Name": language_name}) if language_name else ""
    return (
        f"{csid}\t{label}\t{name}\t{iso}\t{glottocode}\t"
        f"{'wals' if label == 'Typology' else 'phoible'}\t0.8\t{license_}\t{extra}"
    )


def test_read_fact_nodes_reads_codes_license_and_name(tmp_path: Path) -> None:
    path = _write(
        tmp_path / "typology.tsv",
        _CORPUS_HEADER,
        [
            _fact_row(
                "cs:typology:eng-svo",
                "Typology",
                "English: Order of Subject, Object and Verb",
                "eng",
                "stan1293",
                "CC-BY-4.0",
                language_name="English",
            ),
        ],
    )
    facts = read_fact_nodes(path, node_type="typology")
    assert facts[0] == FactNode(
        csid="cs:typology:eng-svo",
        name="English: Order of Subject, Object and Verb",
        glottocode="stan1293",
        iso="eng",
        license="CC-BY-4.0",
        node_type="typology",
        language_name="English",
    )


def test_read_fact_nodes_missing_file_is_empty(tmp_path: Path) -> None:
    assert read_fact_nodes(tmp_path / "absent.tsv", node_type="phoneme") == []


def test_distinct_language_nodes_dedupes_by_glottocode_across_types() -> None:
    facts = [
        FactNode("a", "SVO", "stan1293", "eng", "CC-BY-4.0", "typology", "English"),
        FactNode("b", "m", "stan1293", "eng", "CC-BY-SA-3.0", "phoneme", "English"),
        FactNode("c", "k", "hawa1245", "haw", "CC-BY-SA-3.0", "phoneme", "Hawaiian"),
    ]
    langs = distinct_language_nodes(facts)
    assert [n.glottocode for n in langs] == ["stan1293", "hawa1245"]


def test_build_coverage_counts_and_reconciles(tmp_path: Path) -> None:
    facts = [
        # Two WALS + one PHOIBLE fact on English (one distinct language).
        FactNode("a", "SVO", "stan1293", "eng", "CC-BY-4.0", "typology", "English"),
        FactNode("b", "Tone", "stan1293", "eng", "CC-BY-4.0", "typology", "English"),
        FactNode("c", "m", "stan1293", "eng", "CC-BY-SA-3.0", "phoneme", "English"),
        # Swahili: glottocode absent from lexicon, ISO 639-3 present ⇒ ISO fallback.
        FactNode("d", "b", "swah1253", "swa", "CC-BY-SA-3.0", "phoneme", "Swahili"),
        # Pirahã: neither key in the lexicon ⇒ new.
        FactNode("e", "p", "pira1253", "myp", "CC-BY-SA-3.0", "phoneme", "Pirahã"),
    ]
    languages = [
        LexiconLanguage("cs:language:eng", "English", "stan1293", "eng"),
        LexiconLanguage("cs:language:swa", "Swahili", "", "swa"),  # ISO only
    ]
    coverage = build_coverage(facts, languages, domain="typology")

    assert coverage.total_facts == 5
    assert coverage.distinct_languages == 3
    assert coverage.facts_by_type == {"phoneme": 3, "typology": 2}
    assert coverage.languages_by_type == {"phoneme": 3, "typology": 1}
    assert coverage.facts_by_license == {"CC-BY-4.0": 2, "CC-BY-SA-3.0": 3}
    assert coverage.licenses == ["CC-BY-4.0", "CC-BY-SA-3.0"]

    r = coverage.reconciliation
    assert r.domain == "typology"
    assert (r.matched, r.new, r.ambiguous) == (2, 1, 0)  # English + Swahili; Pirahã new
    # Swahili matched on the ISO tier (0.95), English on the glottocode tier (1.0).
    by_name = {s.name: s.confidence for s in r.matched_samples}
    assert by_name["Swahili"] == 0.95
    assert by_name["English"] == 1.0


def test_render_markdown_reports_coverage_and_licenses(tmp_path: Path) -> None:
    facts = [
        FactNode("a", "SVO", "stan1293", "eng", "CC-BY-4.0", "typology", "English"),
        FactNode("b", "m", "stan1293", "eng", "CC-BY-SA-3.0", "phoneme", "English"),
    ]
    languages = [LexiconLanguage("cs:language:eng", "English", "stan1293", "eng")]
    md = render_markdown(build_coverage(facts, languages))
    assert "total facts | 2" in md
    assert "CC-BY-SA-3.0" in md
    assert "matched (already curated) | 1" in md


def test_end_to_end_from_tsv_fixtures(tmp_path: Path) -> None:
    nodes_dir = tmp_path / "nodes"
    nodes_dir.mkdir()
    _write(
        nodes_dir / "typology.tsv",
        _CORPUS_HEADER,
        [
            _fact_row(
                "cs:typology:eng-svo", "Typology", "English: order", "eng",
                "stan1293", "CC-BY-4.0", "English",
            ),
        ],
    )
    _write(
        nodes_dir / "phoneme.tsv",
        _CORPUS_HEADER,
        [
            _fact_row(
                "cs:phoneme:haw-k", "Phoneme", "k", "haw", "hawa1245",
                "CC-BY-SA-3.0", "Hawaiian",
            ),
        ],
    )
    _write(
        tmp_path / "languages.tsv",
        "id\tname\tglottocode\tiso639_2",
        ["eng\tEnglish\tstan1293\teng", "haw\tHawaiian\thawa1245\thaw"],
    )
    coverage = reconcile_typology_against_languages(
        {
            "typology": nodes_dir / "typology.tsv",
            "phoneme": nodes_dir / "phoneme.tsv",
        },
        tmp_path / "languages.tsv",
    )
    assert coverage.total_facts == 2
    assert coverage.distinct_languages == 2
    assert coverage.reconciliation.matched == 2
    assert coverage.facts_by_license == {"CC-BY-4.0": 1, "CC-BY-SA-3.0": 1}
