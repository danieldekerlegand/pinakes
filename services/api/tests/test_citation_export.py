"""The Python twin of `server/services/citation-export.test.ts`, case for case.

`server/services/citation-export.ts` is kept as the graded spec — nothing in
`server/` calls it any more — and this file is what says the two implementations
agree. Same reasoning as `test_contribution_auth.py` next to `api-auth.ts`: a
port of a *pure* module is only trustworthy if it is held to the same suite.

A handful of cases are additions rather than translations. They are the ones
where JavaScript and Python differ in a way the TypeScript author never had to
think about — non-ASCII in a JSON document, and the exact trailing-year regex —
so an agreement that holds by accident would go unnoticed.
"""

from __future__ import annotations

import json

from pinakes.collab.citations import (
    CITATION_FORMATS,
    DATASET_PUBLISHER,
    CitableEntity,
    entity_to_bibtex,
    entity_to_csl_items,
    entity_to_csl_json,
    entity_to_ris,
    is_citation_format,
    parse_entity_sources,
    parse_source_string,
    record_cite_key,
    render_citation,
)

MINOAN = CitableEntity(
    entity_type="culture-profile",
    id="minoan",
    name="Minoan Civilization",
    sources=["Evans 1921", "Archaeological evidence"],
    year=-2000,
    region="Crete",
    url="https://example.test/culture-profile/minoan",
)


# ── parse_entity_sources ─────────────────────────────────────────────────────


def test_a_real_list_passes_through_trimmed_and_without_blanks() -> None:
    assert parse_entity_sources([" Evans 1921 ", "", "Cauvin 2000"]) == [
        "Evans 1921",
        "Cauvin 2000",
    ]


def test_a_json_array_cell_is_parsed() -> None:
    assert parse_entity_sources('["Hesiod Theogony","Homer Iliad"]') == [
        "Hesiod Theogony",
        "Homer Iliad",
    ]


def test_a_plain_string_is_one_source() -> None:
    assert parse_entity_sources("Homer Iliad") == ["Homer Iliad"]


def test_nothing_citable_is_no_sources() -> None:
    assert parse_entity_sources(None) == []
    assert parse_entity_sources("") == []
    assert parse_entity_sources("[]") == []
    assert parse_entity_sources(42) == []


def test_a_cell_that_looks_like_an_array_and_is_not_is_kept_whole() -> None:
    """Never drop a source. A malformed cell is still evidence of one."""
    assert parse_entity_sources("[Evans 1921") == ["[Evans 1921"]


# ── parse_source_string ──────────────────────────────────────────────────────


def test_a_trailing_year_splits_into_author_and_year() -> None:
    parsed = parse_source_string("Kuijt 2002")
    assert parsed.author == "Kuijt"
    assert parsed.year == 2002
    assert parsed.title == "Kuijt"


def test_a_url_is_recovered_and_the_title_stays_the_raw_text() -> None:
    parsed = parse_source_string("See https://doi.org/10.1000/xyz for details")
    assert parsed.url == "https://doi.org/10.1000/xyz"
    assert parsed.author is None
    assert parsed.title == "See https://doi.org/10.1000/xyz for details"


def test_a_small_trailing_number_is_not_a_year() -> None:
    parsed = parse_source_string("Site 12")
    assert parsed.year is None
    assert parsed.title == "Site 12"


def test_an_implausible_four_digit_year_is_not_a_year() -> None:
    assert parse_source_string("Sherds 8000").year is None


def test_a_parenthesised_year_is_read_and_the_punctuation_trimmed() -> None:
    parsed = parse_source_string("Renfrew, (1987)")
    assert parsed.year == 1987
    assert parsed.author == "Renfrew"


def test_a_year_with_no_author_before_it_leaves_the_title_whole() -> None:
    parsed = parse_source_string("1921")
    assert parsed.year is None  # no leading separator, so not a trailing year
    assert parsed.title == "1921"


# ── BibTeX ───────────────────────────────────────────────────────────────────


def test_bibtex_emits_a_record_entry_plus_one_per_source() -> None:
    bib = entity_to_bibtex(MINOAN)
    assert f"@misc{{{record_cite_key(MINOAN)}," in bib
    assert "title = {Minoan Civilization}" in bib
    assert f"howpublished = {{{DATASET_PUBLISHER}}}" in bib
    assert "year = {-2000}" in bib
    assert "url = {https://example.test/culture-profile/minoan}" in bib
    assert "@misc{minoan-evans-1921," in bib
    assert "author = {Evans}" in bib
    assert "year = {1921}" in bib
    assert "title = {Archaeological evidence}" in bib
    assert bib.count("@misc{") == 3


def test_an_entity_with_no_sources_still_cites_its_own_record() -> None:
    bare = CitableEntity(entity_type="deity", id="zeus", name="Zeus")
    bib = entity_to_bibtex(bare)
    assert bib.count("@misc{") == 1
    assert "@misc{pinakes-deity-zeus," in bib
    assert "title = {Zeus}" in bib


def test_colliding_source_keys_get_distinct_suffixes() -> None:
    duplicated = CitableEntity(
        entity_type="civilization",
        id="x",
        name="X",
        sources=["Smith 1990", "Smith 1990"],
    )
    bib = entity_to_bibtex(duplicated)
    assert "@misc{x-smith-1990," in bib
    assert "@misc{x-smith-1990-2," in bib


def test_tex_specials_are_escaped_and_stray_braces_dropped() -> None:
    tricky = CitableEntity(
        entity_type="culture-profile",
        id="y",
        name="Trade & Craft {Guild} 50% #1",
    )
    assert "Trade \\& Craft Guild 50\\% \\#1" in entity_to_bibtex(tricky)


# ── RIS ──────────────────────────────────────────────────────────────────────


def test_ris_emits_a_data_record_then_a_gen_record_per_source() -> None:
    ris = entity_to_ris(MINOAN)
    assert "TY  - DATA" in ris
    assert "TI  - Minoan Civilization" in ris
    assert "PY  - -2000" in ris
    assert "TY  - GEN" in ris
    assert "AU  - Evans" in ris
    assert ris.count("ER  - ") == 3


# ── CSL-JSON ─────────────────────────────────────────────────────────────────


def test_csl_items_carry_structured_fields() -> None:
    items = entity_to_csl_items(MINOAN)
    assert items[0]["type"] == "dataset"
    assert items[0]["title"] == "Minoan Civilization"
    assert items[0]["issued"] == {"date-parts": [[-2000]]}
    assert items[1]["author"] == [{"family": "Evans"}]
    assert items[1]["issued"] == {"date-parts": [[1921]]}
    assert len(json.loads(entity_to_csl_json(MINOAN))) == 3


def test_non_ascii_is_written_literally_not_escaped() -> None:
    """`JSON.stringify` does not escape non-ASCII and `json.dumps` does by
    default. Half this corpus is not ASCII, so the two documents would differ
    byte for byte on most real entities."""
    site = CitableEntity(
        entity_type="archaeological-site", id="catalhoyuk", name="Çatalhöyük"
    )
    assert '"title": "Çatalhöyük"' in entity_to_csl_json(site)


# ── render_citation ──────────────────────────────────────────────────────────


def test_the_three_formats_are_what_is_offered() -> None:
    assert list(CITATION_FORMATS) == ["bibtex", "ris", "csljson"]
    assert is_citation_format("bibtex") is True
    assert is_citation_format("mla") is False


def test_each_format_names_its_own_file_and_type() -> None:
    assert render_citation(MINOAN, "bibtex").filename == "minoan.bib"
    assert render_citation(MINOAN, "ris").filename == "minoan.ris"
    csl = render_citation(MINOAN, "csljson")
    assert csl.filename == "minoan.json"
    assert "csl+json" in csl.content_type
    assert csl.content == entity_to_csl_json(MINOAN)


def test_an_unsluggable_id_falls_back_through_name_to_a_constant() -> None:
    unnamed = CitableEntity(entity_type="deity", id="???", name="")
    assert render_citation(unnamed, "bibtex").filename == "citation.bib"
    assert record_cite_key(unnamed) == "pinakes-deity"
