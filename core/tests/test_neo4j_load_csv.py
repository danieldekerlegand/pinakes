"""Tests for generating idempotent ``LOAD CSV`` Cypher from canonical TSV.

These never touch a live database: the Cypher is generated, emitted to a script,
and asserted on. Datasets are built with the real TSV writers so the headers
under test are exactly the ones the pipeline produces.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from culturescrape.neo4j.admin_import import AdminImportError
from culturescrape.neo4j.load_csv import (
    FIELD_TERMINATOR,
    FILE_PARAM,
    SCRIPT_NAME,
    build_statements,
    edge_cypher,
    generate_load_script,
    node_cypher,
)
from culturescrape.schema.headers import (
    EdgeSchema,
    IdColumn,
    NodeSchema,
    PropertyColumn,
    PropertyType,
    StructuralColumn,
)
from culturescrape.schema.tsvio import write_edge_rows, write_node_rows

_NODE = NodeSchema(
    (
        IdColumn("csid"),
        StructuralColumn(":LABEL"),
        PropertyColumn("name"),
        PropertyColumn("aliases"),
        PropertyColumn("time_start", PropertyType.INT),
        PropertyColumn("lat", PropertyType.FLOAT),
    )
)
_EDGE = EdgeSchema(
    (
        StructuralColumn(":START_ID"),
        StructuralColumn(":END_ID"),
        StructuralColumn(":TYPE"),
        PropertyColumn("weight", PropertyType.FLOAT),
    )
)


def _dataset(root: Path) -> None:
    """Write a small but realistic nodes/ + edges/ dataset under *root*."""
    write_node_rows(
        root / "nodes" / "Dish.tsv",
        _NODE,
        [
            {
                "csid": "cs:dish:ceviche",
                ":LABEL": ["Dish", "CulturalArtifact"],
                "name": "Ceviche",
                "aliases": ["cebiche", "seviche"],
                "time_start": "1820",
                "lat": "-12.04",
            }
        ],
    )
    write_edge_rows(
        root / "edges" / "ORIGINATES_FROM.tsv",
        _EDGE,
        [
            {
                ":START_ID": "cs:dish:ceviche",
                ":END_ID": "cs:region:peru",
                ":TYPE": "ORIGINATES_FROM",
                "weight": "0.9",
            }
        ],
    )


def test_node_cypher_merges_on_csid_not_create() -> None:
    cypher = node_cypher(_NODE)
    # Idempotent: a MERGE keyed on csid under the shared Entity label (so the
    # csid uniqueness constraint backs it), never a CREATE that would duplicate.
    assert "MERGE (n:Entity {`csid`: row.`csid:ID`})" in cypher
    assert "CREATE" not in cypher
    # The LOAD CSV prelude is parameterized and tab-terminated.
    assert f"LOAD CSV WITH HEADERS FROM ${FILE_PARAM} AS row" in cypher
    assert f"FIELDTERMINATOR '{FIELD_TERMINATOR}'" in cypher


def test_edge_cypher_merges_on_start_end_type_not_create() -> None:
    cypher = edge_cypher(_EDGE)
    # Relationships are merged on (:START_ID, :END_ID, :TYPE), never created.
    assert "apoc.merge.relationship(" in cypher
    assert "row.`:START_ID`" in cypher
    assert "row.`:END_ID`" in cypher
    assert "row.`:TYPE`" in cypher
    assert "CREATE" not in cypher
    assert f"FIELDTERMINATOR '{FIELD_TERMINATOR}'" in cypher


def test_typed_columns_are_coerced_per_header_suffix() -> None:
    node = node_cypher(_NODE)
    # int -> toInteger, float -> toFloat, plain string stays a raw cell read,
    # multi-value aliases is split back into a list.
    assert "`time_start`: toInteger(row.`time_start:int`)" in node
    assert "`lat`: toFloat(row.`lat:float`)" in node
    assert "`name`: row.`name`" in node
    assert "`aliases`: split(row.`aliases`, ';')" in node

    edge = edge_cypher(_EDGE)
    assert "`weight`: toFloat(row.`weight:float`)" in edge


def test_build_statements_orders_nodes_before_edges(tmp_path: Path) -> None:
    _dataset(tmp_path)
    statements = build_statements(tmp_path)

    kinds = [s.kind for s in statements]
    assert kinds == ["node", "edge"]
    node, edge = statements
    assert node.file.name == "Dish.tsv"
    assert edge.file.name == "ORIGINATES_FROM.tsv"
    # File URLs are absolute file:// URLs so the script runs from anywhere.
    assert node.file_url.startswith("file://")
    assert Path(node.file).is_absolute()


def test_script_is_emitted_and_parameterized(tmp_path: Path) -> None:
    _dataset(tmp_path)
    plan = generate_load_script(tmp_path)

    assert plan.script_path == tmp_path / SCRIPT_NAME
    text = plan.script_path.read_text(encoding="utf-8")
    # Each file is bound to $file before its statement; nodes precede edges.
    assert text.count(f":param {FILE_PARAM} =>") == 2
    assert text.index("Dish.tsv") < text.index("ORIGINATES_FROM.tsv")
    assert "Requires the APOC plugin" in text
    # The script as a whole stays idempotent: MERGE, never CREATE.
    assert "MERGE" in text
    assert "CREATE" not in text


def test_out_dir_keeps_script_out_of_the_source_tree(tmp_path: Path) -> None:
    src = tmp_path / "data"
    out = tmp_path / "build"
    _dataset(src)

    plan = generate_load_script(src, out_dir=out)

    assert plan.script_path == out / SCRIPT_NAME
    assert not (src / SCRIPT_NAME).exists()


def test_missing_nodes_directory_raises(tmp_path: Path) -> None:
    write_edge_rows(
        tmp_path / "edges" / "X.tsv",
        _EDGE,
        [{":START_ID": "a", ":END_ID": "b", ":TYPE": "X", "weight": "1.0"}],
    )
    with pytest.raises(AdminImportError, match="no nodes"):
        build_statements(tmp_path)


def test_invalid_header_raises(tmp_path: Path) -> None:
    nodes = tmp_path / "nodes"
    nodes.mkdir()
    # A node file missing the required :LABEL column is not a valid header.
    (nodes / "Bad.tsv").write_text("csid:ID\tname\nx\ty\n", encoding="utf-8")
    with pytest.raises(AdminImportError, match="not a valid neo4j-admin node"):
        build_statements(tmp_path)
