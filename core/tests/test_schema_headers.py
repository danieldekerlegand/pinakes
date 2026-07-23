"""Tests for typed node/edge headers (Neo4j-import compatible)."""

import pytest

from culturescrape.schema import (
    EdgeSchema,
    IdColumn,
    NodeSchema,
    PropertyColumn,
    PropertyType,
    SchemaError,
    StructuralColumn,
    parse_column,
    parse_edge_header,
    parse_node_header,
    render_edge_header,
    render_node_header,
)


def test_property_type_suffix() -> None:
    assert PropertyType.STRING.suffix == ""
    assert PropertyType.INT.suffix == ":int"
    assert PropertyType.FLOAT.suffix == ":float"


def test_column_headers() -> None:
    assert IdColumn("csid").header == "csid:ID"
    assert StructuralColumn(":LABEL").header == ":LABEL"
    assert PropertyColumn("name").header == "name"
    assert PropertyColumn("time_start", PropertyType.INT).header == "time_start:int"


@pytest.mark.parametrize(
    ("cell", "expected"),
    [
        ("csid:ID", IdColumn("csid")),
        (":ID", IdColumn("")),
        (":LABEL", StructuralColumn(":LABEL")),
        (":START_ID", StructuralColumn(":START_ID")),
        (":TYPE", StructuralColumn(":TYPE")),
        ("name", PropertyColumn("name")),
        ("lat:float", PropertyColumn("lat", PropertyType.FLOAT)),
        ("time_start:int", PropertyColumn("time_start", PropertyType.INT)),
    ],
)
def test_parse_column(cell: str, expected: object) -> None:
    assert parse_column(cell) == expected


@pytest.mark.parametrize(
    "cell",
    ["", "weight:bool", "ts:datetime", "named:LABEL"],
)
def test_parse_column_rejects(cell: str) -> None:
    with pytest.raises(SchemaError):
        parse_column(cell)


def test_node_header_round_trip() -> None:
    schema = NodeSchema.canonical()
    row = render_node_header(schema)
    assert row.split("\t")[:3] == ["csid:ID", ":LABEL", "name"]
    assert parse_node_header(row) == schema


def test_edge_header_round_trip() -> None:
    schema = EdgeSchema.canonical()
    row = render_edge_header(schema)
    assert row.split("\t")[:3] == [":START_ID", ":END_ID", ":TYPE"]
    assert parse_edge_header(row) == schema


def test_render_then_parse_minimal_node() -> None:
    schema = NodeSchema(
        (IdColumn("csid"), StructuralColumn(":LABEL"), PropertyColumn("name"))
    )
    assert parse_node_header(render_node_header(schema)) == schema


def test_typed_suffix_mismatch_rejected() -> None:
    # confidence is :float in the data model; :int must be rejected.
    with pytest.raises(SchemaError, match="confidence"):
        parse_node_header("csid:ID\t:LABEL\tname\tconfidence:int")
    with pytest.raises(SchemaError, match="time_start"):
        parse_node_header("csid:ID\t:LABEL\tname\ttime_start:float")
    with pytest.raises(SchemaError, match="weight"):
        parse_edge_header(":START_ID\t:END_ID\t:TYPE\tweight:int")


def test_node_requires_structural_columns() -> None:
    with pytest.raises(SchemaError, match=":ID"):
        parse_node_header(":LABEL\tname")
    with pytest.raises(SchemaError, match=":LABEL"):
        parse_node_header("csid:ID\tname")
    with pytest.raises(SchemaError, match="name"):
        parse_node_header("csid:ID\t:LABEL\tlang")


def test_node_rejects_edge_columns() -> None:
    with pytest.raises(SchemaError, match="edge"):
        parse_node_header("csid:ID\t:LABEL\tname\t:START_ID")


def test_edge_requires_structural_columns() -> None:
    with pytest.raises(SchemaError, match=":TYPE"):
        parse_edge_header(":START_ID\t:END_ID")


def test_edge_rejects_node_columns() -> None:
    with pytest.raises(SchemaError, match=":ID"):
        parse_edge_header(":START_ID\t:END_ID\t:TYPE\tcsid:ID")
    with pytest.raises(SchemaError, match=":LABEL"):
        parse_edge_header(":START_ID\t:END_ID\t:TYPE\t:LABEL")


def test_unknown_property_allowed_for_extensibility() -> None:
    # Unknown property names are not type-constrained by the data model.
    schema = parse_node_header("csid:ID\t:LABEL\tname\tspiciness:int")
    assert PropertyColumn("spiciness", PropertyType.INT) in schema.columns
