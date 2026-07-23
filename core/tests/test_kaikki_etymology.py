"""The kaikki etymology-template → canonical edge mapping (source-breadth US-004).

``schema/kaikki_etymology.py`` is the pure bridge from Wiktionary's etymology-template
vocabulary to the canonical ontology edge ``:TYPE``s. These tests pin that the mapped
tokens produce the right directed relations, that the two arg layouts are read
correctly, and — critically — that every unmappable token (display helpers, ambiguous
calques, and the ``ncog`` **non**-cognate assertion) is skipped and reported, never
coerced onto an edge type.
"""

from __future__ import annotations

import pytest

from culturescrape.ontology.registry import is_registered
from culturescrape.schema.kaikki_etymology import (
    BORROWED_FROM,
    COGNATE_WITH,
    DERIVED_FROM,
    extract_relations,
    map_relation,
    parse_relations_cell,
    relations_cell,
)


@pytest.mark.parametrize(
    ("token", "expected"),
    [
        ("bor", BORROWED_FROM),
        ("lbor", BORROWED_FROM),
        ("slbor", BORROWED_FROM),
        ("borrowed", BORROWED_FROM),
        ("inh", DERIVED_FROM),
        ("inherited", DERIVED_FROM),
        ("der", DERIVED_FROM),
        ("cog", COGNATE_WITH),
        ("cognate", COGNATE_WITH),
    ],
)
def test_mapped_tokens_yield_registered_edge_types(token: str, expected: str) -> None:
    assert map_relation(token) == expected
    assert is_registered(expected)


@pytest.mark.parametrize("token", ["m", "l", "mention", "cal", "clq", "w", "q", "etyl"])
def test_display_and_ambiguous_tokens_are_unmappable(token: str) -> None:
    assert map_relation(token) is None


def test_ncog_is_not_mapped_to_cognate() -> None:
    # ``ncog``/``noncog`` assert two terms are NOT cognate — mapping them onto
    # COGNATE_WITH would invert the source's claim.
    assert map_relation("ncog") is None
    assert map_relation("noncog") is None


def test_display_variant_suffix_is_normalised() -> None:
    assert map_relation("inh+") == DERIVED_FROM
    assert map_relation("der+") == DERIVED_FROM


def test_extract_reads_source_layout_lang_and_term() -> None:
    entry = {
        "word": "amiko",
        "lang_code": "eo",
        "etymology_templates": [
            {"name": "der", "args": {"1": "eo", "2": "la", "3": "amīcus"}},
        ],
    }
    result = extract_relations(entry)
    assert not result.skipped_tokens
    (relation,) = result.relations
    assert relation.edge_type == DERIVED_FROM
    assert relation.target_lang == "la"
    assert relation.target_term == "amīcus"


def test_extract_reads_cognate_layout_lang_and_term() -> None:
    entry = {
        "word": "beef",
        "lang_code": "en",
        "etymology_templates": [{"name": "cog", "args": {"1": "fr", "2": "bœuf"}}],
    }
    (relation,) = extract_relations(entry).relations
    assert relation.edge_type == COGNATE_WITH
    assert relation.target_lang == "fr"
    assert relation.target_term == "bœuf"


def test_extract_skips_and_reports_unmappable_tokens() -> None:
    entry = {
        "word": "hierro",
        "lang_code": "es",
        "etymology_templates": [
            {"name": "inh", "args": {"1": "es", "2": "la", "3": "ferrum"}},
            {"name": "ncog", "args": {"1": "pt", "2": "ferro"}},
            {"name": "m", "args": {"1": "la", "2": "ferrum"}},
        ],
    }
    result = extract_relations(entry)
    assert [r.edge_type for r in result.relations] == [DERIVED_FROM]
    assert sorted(result.skipped_tokens) == ["m", "ncog"]


def test_recognised_token_without_target_term_is_skipped() -> None:
    entry = {
        "word": "x",
        "lang_code": "en",
        "etymology_templates": [{"name": "bor", "args": {"1": "en", "2": "la"}}],
    }
    result = extract_relations(entry)
    assert not result.relations
    assert result.skipped_tokens == ["bor"]


def test_entry_without_templates_yields_nothing() -> None:
    result = extract_relations({"word": "x", "lang_code": "en"})
    assert not result.relations and not result.skipped_tokens


def test_cell_round_trips_relations() -> None:
    entry = {
        "word": "amiko",
        "lang_code": "eo",
        "etymology_templates": [
            {"name": "der", "args": {"1": "eo", "2": "la", "3": "amīcus"}},
            {"name": "cog", "args": {"1": "fr", "2": "ami"}},
        ],
    }
    relations = extract_relations(entry).relations
    parsed = parse_relations_cell(relations_cell(relations))
    assert parsed == [
        {"rel": DERIVED_FROM, "lang": "la", "term": "amīcus"},
        {"rel": COGNATE_WITH, "lang": "fr", "term": "ami"},
    ]


def test_parse_cell_is_tolerant_and_guards_edge_type() -> None:
    assert parse_relations_cell("") == []
    assert parse_relations_cell("not json") == []
    assert parse_relations_cell('{"rel": "X"}') == []  # not a list
    # A non-canonical :TYPE or a blank term is dropped, never passed through.
    assert parse_relations_cell('[{"rel": "SPOKEN_IN", "term": "x"}]') == []
    assert parse_relations_cell('[{"rel": "COGNATE_WITH", "term": ""}]') == []
