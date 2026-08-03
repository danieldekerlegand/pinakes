"""Tests for projecting node TSV rows into facts (T5-US-002)."""

from __future__ import annotations

from pathlib import Path

import pytest

from pinakes_engine.datalog import (
    DatalogError,
    Dialect,
    Fact,
    node_facts,
    node_file_facts,
)
from pinakes_engine.schema.headers import (
    IdColumn,
    PropertyColumn,
    PropertyType,
    StructuralColumn,
)
from pinakes_engine.schema.tsvio import Row

FIXTURE = Path(__file__).parent / "fixtures" / "datalog" / "nodes.tsv"


def test_fixture_file_maps_to_the_expected_fact_set() -> None:
    facts = set(node_file_facts(FIXTURE))

    expected = {
        # cs:dish:Q42 — multi-label, lat/lon pair, language; empty cols skipped.
        Fact("node", ("cs:dish:Q42", "Dish", "Ceviche"), source="wikidata"),
        Fact("instance_of", ("cs:dish:Q42", "Dish"), source="wikidata"),
        Fact("instance_of", ("cs:dish:Q42", "CulturalArtifact"), source="wikidata"),
        Fact("source", ("cs:dish:Q42", "wikidata"), source="wikidata"),
        Fact("located_at", ("cs:dish:Q42", -12.04, -77.04), source="wikidata"),
        Fact("language_code", ("cs:dish:Q42", "spa"), source="wikidata"),
        # cs:battle:Q47 — BCE year (int), named period; no coords/language.
        Fact(
            "node",
            ("cs:battle:Q47", "Battle", "Battle of Thermopylae"),
            source="petscan",
        ),
        Fact("instance_of", ("cs:battle:Q47", "Battle"), source="petscan"),
        Fact("source", ("cs:battle:Q47", "petscan"), source="petscan"),
        Fact("time_start", ("cs:battle:Q47", -480), source="petscan"),
        Fact("part_of_period", ("cs:battle:Q47", "Antiquity"), source="petscan"),
        # cs:dish:Q99 — derived_from edge pointer; lone lat (no lon) is dropped.
        Fact("node", ("cs:dish:Q99", "Dish", "Tiradito"), source="wikidata"),
        Fact("instance_of", ("cs:dish:Q99", "Dish"), source="wikidata"),
        Fact("source", ("cs:dish:Q99", "wikidata"), source="wikidata"),
        Fact("language_code", ("cs:dish:Q99", "spa"), source="wikidata"),
        Fact("derived_from", ("cs:dish:Q99", "cs:dish:Q42"), source="wikidata"),
    }
    assert facts == expected


def _row(**values: str | list[str]) -> Row:
    return dict(values)


COLUMNS = (
    IdColumn("csid"),
    StructuralColumn(":LABEL"),
    PropertyColumn("name"),
    PropertyColumn("time_start", PropertyType.INT),
    PropertyColumn("lat", PropertyType.FLOAT),
    PropertyColumn("lon", PropertyType.FLOAT),
    PropertyColumn("language_code"),
    PropertyColumn("source"),
)


def test_empty_columns_emit_no_fact() -> None:
    row = _row(
        csid="cs:dish:Q1",
        **{":LABEL": ["Dish"]},
        name="X",
        time_start="",
        lat="",
        lon="",
        language_code="",
        source="wikidata",
    )
    facts = node_facts(COLUMNS, row)
    assert facts == [
        Fact("node", ("cs:dish:Q1", "Dish", "X"), source="wikidata"),
        Fact("instance_of", ("cs:dish:Q1", "Dish"), source="wikidata"),
        Fact("source", ("cs:dish:Q1", "wikidata"), source="wikidata"),
    ]


def test_int_column_renders_as_a_bare_numeric_literal() -> None:
    row = _row(csid="cs:b:Q1", **{":LABEL": ["Battle"]}, name="X", time_start="-480")
    (time_fact,) = [f for f in node_facts(COLUMNS, row) if f.predicate == "time_start"]
    assert time_fact.args == ("cs:b:Q1", -480)
    assert time_fact.render() == "time_start('cs:b:Q1', -480)."


def test_lat_and_lon_combine_into_located_at() -> None:
    row = _row(csid="cs:p:Q1", **{":LABEL": ["Place"]}, name="X", lat="1.5", lon="-2.5")
    (geo,) = [f for f in node_facts(COLUMNS, row) if f.predicate == "located_at"]
    assert geo.args == ("cs:p:Q1", 1.5, -2.5)


def test_lone_coordinate_emits_no_located_at() -> None:
    row = _row(csid="cs:p:Q1", **{":LABEL": ["Place"]}, name="X", lat="1.5", lon="")
    assert not [f for f in node_facts(COLUMNS, row) if f.predicate == "located_at"]


def test_every_label_yields_an_instance_of_fact() -> None:
    row = _row(csid="cs:d:Q1", **{":LABEL": ["Dish", "CulturalArtifact"]}, name="X")
    facts = node_facts(COLUMNS, row)
    labels = {f.args[1] for f in facts if f.predicate == "instance_of"}
    assert labels == {"Dish", "CulturalArtifact"}


def test_node_uses_the_primary_label_as_its_type() -> None:
    row = _row(csid="cs:d:Q1", **{":LABEL": ["Dish", "CulturalArtifact"]}, name="X")
    (node,) = [f for f in node_facts(COLUMNS, row) if f.predicate == "node"]
    assert node.args == ("cs:d:Q1", "Dish", "X")


def test_csid_is_carried_verbatim_and_quoted_reversibly() -> None:
    row = _row(csid="cs:dish:Q42", **{":LABEL": ["Dish"]}, name="Ceviche")
    (node,) = [f for f in node_facts(COLUMNS, row) if f.predicate == "node"]
    # The csid survives byte-for-byte as the first argument...
    assert node.args[0] == "cs:dish:Q42"
    # ...and renders to a deterministic quoted atom in each dialect.
    assert node.render() == "node('cs:dish:Q42', 'Dish', 'Ceviche')."
    assert node.render(Dialect.DATALOG) == 'node("cs:dish:Q42", "Dish", "Ceviche").'


def test_source_is_projected_as_a_queryable_fact() -> None:
    # The provenance is a queryable source/2 fact keyed by csid, not only a comment.
    row = _row(csid="cs:d:Q1", **{":LABEL": ["Dish"]}, name="X", source="wikidata")
    (prov,) = [f for f in node_facts(COLUMNS, row) if f.predicate == "source"]
    assert prov.args == ("cs:d:Q1", "wikidata")
    # The queryable fact still carries the provenance comment (arity stays 2).
    assert prov.render() == "source('cs:d:Q1', wikidata).  % source: wikidata"


def test_blank_source_emits_no_source_fact() -> None:
    row = _row(csid="cs:d:Q1", **{":LABEL": ["Dish"]}, name="X", source="")
    assert not [f for f in node_facts(COLUMNS, row) if f.predicate == "source"]


def test_a_node_without_labels_is_rejected() -> None:
    row = _row(csid="cs:d:Q1", **{":LABEL": []}, name="X")
    with pytest.raises(DatalogError):
        node_facts(COLUMNS, row)
