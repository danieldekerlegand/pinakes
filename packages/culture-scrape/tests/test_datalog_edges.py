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
    render_program,
    write_souffle_facts,
)
from culturescrape.schema.headers import EdgeSchema, render_edge_header
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


def test_confidence_is_projected_into_rel_conf() -> None:
    # The canonical `confidence` column is the source of the strength companion.
    row = _row(
        **{":START_ID": "cs:a:Q1", ":END_ID": "cs:b:Q2", ":TYPE": "BORROWED_FROM"},
        confidence="0.8",
    )
    (conf,) = [f for f in edge_facts(row) if f.predicate == "rel_conf"]
    assert conf.args == ("borrowed_from", "cs:a:Q1", "cs:b:Q2", 0.8)


def test_confidence_takes_precedence_over_weight() -> None:
    # When both are present, the canonical confidence wins over legacy weight.
    row = _row(
        **{":START_ID": "cs:a:Q1", ":END_ID": "cs:b:Q2", ":TYPE": "ADJACENT_TO"},
        weight="0.3",
        confidence="0.9",
    )
    (conf,) = [f for f in edge_facts(row) if f.predicate == "rel_conf"]
    assert conf.args == ("adjacent_to", "cs:a:Q1", "cs:b:Q2", 0.9)


def test_weight_is_fallback_when_confidence_blank() -> None:
    # A populated weight still projects when confidence is absent/blank.
    row = _row(
        **{":START_ID": "cs:a:Q1", ":END_ID": "cs:b:Q2", ":TYPE": "ADJACENT_TO"},
        weight="0.5",
        confidence="",
    )
    (conf,) = [f for f in edge_facts(row) if f.predicate == "rel_conf"]
    assert conf.args == ("adjacent_to", "cs:a:Q1", "cs:b:Q2", 0.5)


def test_blank_confidence_and_weight_emit_no_rel_conf() -> None:
    row = _row(
        **{":START_ID": "cs:a:Q1", ":END_ID": "cs:b:Q2", ":TYPE": "DERIVED_FROM"},
        weight="",
        confidence="",
    )
    assert not [f for f in edge_facts(row) if f.predicate == "rel_conf"]


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


def test_canonical_confidence_reaches_both_dialects(tmp_path: Path) -> None:
    """A canonical edge row with confidence 0.8 emits 0.8 in rel_conf/4 in
    BOTH the SWI-Prolog program and the Soufflé ``.facts`` (US-003 regression).

    The live corpus leaves ``weight`` blank and carries strength only on the
    canonical ``confidence`` column, so this guards against rel_conf/4 going
    empty at the export boundary again.
    """
    header = render_edge_header(EdgeSchema.canonical())
    # A canonical row: blank weight, confidence 0.8 (as the real corpus ships).
    row = "\t".join(
        {
            ":START_ID": "cs:language:arb",
            ":END_ID": "cs:language:eng",
            ":TYPE": "BORROWED_FROM",
            "weight:float": "",
            "source": "linguascrape",
            "source_url": "",
            "retrieved_at": "",
            "confidence:float": "0.8",
        }[cell]
        for cell in header.split("\t")
    )
    edges = tmp_path / "edges.tsv"
    edges.write_text(f"{header}\n{row}\n", encoding="utf-8")

    facts = edge_file_facts(edges)
    (conf,) = [f for f in facts if f.predicate == "rel_conf"]
    assert conf.args == ("borrowed_from", "cs:language:arb", "cs:language:eng", 0.8)

    # SWI-Prolog: the clause carries the confidence verbatim.
    assert (
        "rel_conf(borrowed_from, 'cs:language:arb', 'cs:language:eng', 0.8)."
        in render_program(facts)
    )

    # Soufflé: the rel_conf.facts row's last (float) cell is the confidence.
    facts_dir = tmp_path / "souffle"
    facts_dir.mkdir()
    write_souffle_facts(facts_dir, facts)
    rel_conf_lines = (
        (facts_dir / "rel_conf.facts").read_text(encoding="utf-8").splitlines()
    )
    assert rel_conf_lines == [
        "borrowed_from\tcs:language:arb\tcs:language:eng\t0.8"
    ]
