"""Tests for projecting edge TSV rows into facts (T5-US-003)."""

from __future__ import annotations

from pathlib import Path

import pytest

from culturescrape.datalog import (
    DatalogError,
    Fact,
    edge_facts,
    edge_file_facts,
    predicate_for_type,
)
from culturescrape.schema.tsvio import Row

FIXTURE = Path(__file__).parent / "fixtures" / "datalog" / "edges.tsv"


def test_fixture_file_maps_to_the_expected_fact_set() -> None:
    facts = set(edge_file_facts(FIXTURE))

    expected = {
        # LOCATED_IN with a weight -> generic + typed + rel_conf companion.
        Fact("rel", ("located_in", "cs:dish:Q42", "cs:place:Q123"), source="wikidata"),
        Fact("located_in", ("cs:dish:Q42", "cs:place:Q123"), source="wikidata"),
        Fact(
            "rel_conf",
            ("located_in", "cs:dish:Q42", "cs:place:Q123", 0.9),
            source="wikidata",
        ),
        # DERIVED_FROM without a weight -> no rel_conf companion.
        Fact("rel", ("derived_from", "cs:dish:Q99", "cs:dish:Q42"), source="wikidata"),
        Fact("derived_from", ("cs:dish:Q99", "cs:dish:Q42"), source="wikidata"),
        # ADJACENT_TO with a weight.
        Fact(
            "rel", ("adjacent_to", "cs:place:Q123", "cs:place:Q200"), source="pleiades"
        ),
        Fact("adjacent_to", ("cs:place:Q123", "cs:place:Q200"), source="pleiades"),
        Fact(
            "rel_conf",
            ("adjacent_to", "cs:place:Q123", "cs:place:Q200", 0.5),
            source="pleiades",
        ),
    }
    assert facts == expected


def _row(**values: str | list[str]) -> Row:
    return dict(values)


def test_predicate_for_type_lowercases() -> None:
    assert predicate_for_type("LOCATED_IN") == "located_in"
    assert predicate_for_type("DERIVED_FROM") == "derived_from"


def test_predicate_for_type_rejects_non_screaming_snake() -> None:
    for bad in ("located_in", "Located_In", "located in", "", "3WAY", ":TYPE"):
        with pytest.raises(DatalogError):
            predicate_for_type(bad)


def test_edge_emits_generic_and_typed_views_sharing_the_type_atom() -> None:
    row = _row(
        **{":START_ID": "cs:a:Q1", ":END_ID": "cs:b:Q2", ":TYPE": "LOCATED_IN"}
    )
    facts = edge_facts(row)
    rel = next(f for f in facts if f.predicate == "rel")
    typed = next(f for f in facts if f.predicate == "located_in")
    # The generic view's type atom is exactly the typed view's functor.
    assert rel.args == ("located_in", "cs:a:Q1", "cs:b:Q2")
    assert typed.args == ("cs:a:Q1", "cs:b:Q2")


def test_empty_weight_emits_no_rel_conf() -> None:
    row = _row(
        **{":START_ID": "cs:a:Q1", ":END_ID": "cs:b:Q2", ":TYPE": "DERIVED_FROM"},
        weight="",
    )
    assert not [f for f in edge_facts(row) if f.predicate == "rel_conf"]


def test_weight_is_exposed_via_a_rel_conf_companion() -> None:
    row = _row(
        **{":START_ID": "cs:a:Q1", ":END_ID": "cs:b:Q2", ":TYPE": "ADJACENT_TO"},
        weight="0.75",
    )
    (conf,) = [f for f in edge_facts(row) if f.predicate == "rel_conf"]
    assert conf.args == ("adjacent_to", "cs:a:Q1", "cs:b:Q2", 0.75)
    assert conf.render() == "rel_conf(adjacent_to, 'cs:a:Q1', 'cs:b:Q2', 0.75)."


def test_source_rides_along_as_provenance() -> None:
    row = _row(
        **{":START_ID": "cs:a:Q1", ":END_ID": "cs:b:Q2", ":TYPE": "LOCATED_IN"},
        source="wikidata",
    )
    assert all(f.source == "wikidata" for f in edge_facts(row))


def test_missing_endpoint_is_rejected() -> None:
    row = _row(**{":START_ID": "cs:a:Q1", ":END_ID": "", ":TYPE": "LOCATED_IN"})
    with pytest.raises(DatalogError):
        edge_facts(row)


def test_missing_type_is_rejected() -> None:
    row = _row(**{":START_ID": "cs:a:Q1", ":END_ID": "cs:b:Q2", ":TYPE": ""})
    with pytest.raises(DatalogError):
        edge_facts(row)
