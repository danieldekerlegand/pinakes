"""Tests for the experimental YAGO 4.5 evaluation prototype (rules-layer US-005).

The prototype backs a written evaluation (``docs/yago-evaluation.md``); these tests keep
its parsers, taxonomy mapping and SHACL translation honest, and pin the measured summary
to the committed report so the doc's numbers cannot silently drift.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pinakes_engine.experimental import yago
from pinakes_engine.experimental.yago import (
    BlankNode,
    Literal,
    YagoParseError,
    evaluate,
    extract_shapes,
    map_taxonomy,
    parse_ntriples,
    parse_turtle,
    translate_shapes,
)

REPORT_JSON = (
    Path(__file__).resolve().parent.parent / "docs" / "yago-evaluation-report.json"
)


# --- N-Triples parser --------------------------------------------------------


def test_parse_ntriples_iri_and_literal_objects() -> None:
    text = (
        "# comment\n"
        "\n"
        "<http://ex/a> <http://ex/p> <http://ex/b> .\n"
        '<http://ex/a> <http://ex/lex> "hello"@en .\n'
        '<http://ex/a> <http://ex/n> "1"^^<http://www.w3.org/2001/XMLSchema#gYear> .\n'
    )
    triples = parse_ntriples(text)
    assert len(triples) == 3
    assert triples[0].obj_is_literal is False
    assert triples[0].obj == "http://ex/b"
    assert triples[1].obj_is_literal is True
    assert triples[1].obj == "hello"
    assert triples[2].obj == "1"


def test_parse_ntriples_rejects_malformed_line() -> None:
    with pytest.raises(YagoParseError):
        parse_ntriples("this is not a triple\n")


# --- Turtle subset / SHACL parser --------------------------------------------


def test_parse_turtle_resolves_prefixes_and_blank_nodes() -> None:
    text = (
        "@prefix sh: <http://www.w3.org/ns/shacl#> .\n"
        "@prefix schema: <http://schema.org/> .\n"
        "schema:Place a sh:NodeShape ;\n"
        "    sh:targetClass schema:Place ;\n"
        "    sh:property [ sh:path schema:containedInPlace ; sh:maxCount 1 ] .\n"
    )
    statements = parse_turtle(text)
    assert len(statements) == 1
    subject, preds = statements[0]
    assert subject == "http://schema.org/Place"
    assert preds[yago.RDF_TYPE] == ["http://www.w3.org/ns/shacl#NodeShape"]
    prop = preds[yago.SH_PROPERTY][0]
    assert isinstance(prop, BlankNode)
    assert prop.predicates[yago.SH_PATH] == ["http://schema.org/containedInPlace"]
    assert prop.predicates[yago.SH_MAX_COUNT] == [Literal("1")]


def test_parse_turtle_handles_collections() -> None:
    text = (
        "@prefix sh: <http://www.w3.org/ns/shacl#> .\n"
        "@prefix schema: <http://schema.org/> .\n"
        "schema:X a sh:NodeShape ;\n"
        "    sh:property [ sh:path schema:author ;\n"
        "        sh:or ( [ sh:node schema:Org ] [ sh:node schema:Person ] ) ] .\n"
    )
    statements = parse_turtle(text)
    _, preds = statements[0]
    prop = preds[yago.SH_PROPERTY][0]
    assert isinstance(prop, BlankNode)
    assert yago.SH_OR in prop.predicates


def test_parse_turtle_unknown_prefix_raises() -> None:
    with pytest.raises(YagoParseError):
        parse_turtle("nope:Thing a nope:Shape .\n")


# --- taxonomy mapping --------------------------------------------------------


def test_map_taxonomy_classifies_edges_against_the_corpus() -> None:
    triples = parse_ntriples(yago.TAXONOMY_NT.read_text(encoding="utf-8"))
    mapping = map_taxonomy(triples)
    # schema:Place -> Q2221906 -> Place; schema:Person -> Q5 -> unmapped.
    assert mapping.class_to_label["http://schema.org/Place"] == "Place"
    assert "http://schema.org/Person" not in mapping.class_to_label
    by_status = {e.status for e in mapping.edges}
    assert {"redundant", "novel", "partial", "unmapped"} <= by_status
    # ArtMovement (Q968159 -> ArtTradition) subClassOf Culture is the novel edge.
    assert [f"{e.child_label}->{e.parent_label}" for e in mapping.novel_edges] == [
        "ArtTradition->Culture"
    ]


def test_map_taxonomy_redundant_edge_is_in_the_existing_artifact() -> None:
    triples = parse_ntriples(yago.TAXONOMY_NT.read_text(encoding="utf-8"))
    mapping = map_taxonomy(triples)
    redundant = {
        (e.child_label, e.parent_label)
        for e in mapping.edges
        if e.status == "redundant"
    }
    assert ("ArchaeologicalCulture", "Culture") in redundant


# --- SHACL → registry rules --------------------------------------------------


def test_translate_shapes_produces_typed_and_functional_rules() -> None:
    shapes = extract_shapes(parse_turtle(yago.SHAPES_TTL.read_text(encoding="utf-8")))
    triples = parse_ntriples(yago.TAXONOMY_NT.read_text(encoding="utf-8"))
    mapping = map_taxonomy(triples)
    translation = translate_shapes(shapes, mapping.class_to_label)
    heads = {rule.head for rule in translation.rules}
    assert heads == {
        "located_in_from_type_violation",
        "located_in_to_type_violation",
        "located_in_functional_violation",
    }
    # The to-type rule restates the schema's own to=Place constraint → redundant;
    # the from-type and functional rules are new to us.
    novelty = {rule.head: rule.novelty for rule in translation.rules}
    assert novelty["located_in_to_type_violation"] == "redundant"
    assert novelty["located_in_from_type_violation"] == "novel"
    assert novelty["located_in_functional_violation"] == "novel"


def test_translate_shapes_reports_every_untranslatable_shape() -> None:
    shapes = extract_shapes(parse_turtle(yago.SHAPES_TTL.read_text(encoding="utf-8")))
    triples = parse_ntriples(yago.TAXONOMY_NT.read_text(encoding="utf-8"))
    mapping = map_taxonomy(triples)
    translation = translate_shapes(shapes, mapping.class_to_label)
    reasons = {s.reason for s in translation.skipped}
    assert any("sh:or" in r for r in reasons)
    assert any("outside corpus edge vocabulary" in r for r in reasons)
    assert any("not in corpus" in r for r in reasons)


def test_translated_rule_clauses_are_souffle_only() -> None:
    shapes = extract_shapes(parse_turtle(yago.SHAPES_TTL.read_text(encoding="utf-8")))
    mapping = map_taxonomy(
        parse_ntriples(yago.TAXONOMY_NT.read_text(encoding="utf-8"))
    )
    translation = translate_shapes(shapes, mapping.class_to_label)
    for rule in translation.rules:
        row = rule.registry_row()
        assert row["clause_prolog"] == ""
        assert row["clause_souffle"].endswith(".")
        assert row["source"] == "yago-4.5"


# --- the committed report ----------------------------------------------------


def test_evaluate_matches_committed_report() -> None:
    """The evaluation summary is pinned to the committed report the doc cites."""
    committed = json.loads(REPORT_JSON.read_text(encoding="utf-8"))
    assert evaluate() == committed


def test_recommendation_is_partially_adopt() -> None:
    report = evaluate()
    assert report["recommendation"] == "partially-adopt"
