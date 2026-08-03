"""Tests for deriving a ``neo4j-admin`` bulk-import command from canonical TSV.

These never touch a live database: the command is generated, emitted to a
script, and asserted on. Datasets are built with the real TSV writers so the
headers under test are exactly the ones the pipeline produces.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from pinakes_engine.neo4j.admin_import import (
    ARRAY_DELIMITER,
    SCRIPT_NAME,
    AdminImportError,
    discover_dataset,
    generate_import_script,
)
from pinakes_engine.schema.headers import (
    EdgeSchema,
    IdColumn,
    NodeSchema,
    PropertyColumn,
    StructuralColumn,
)
from pinakes_engine.schema.tsvio import write_edge_rows, write_node_rows

_NODE_WITH_ALIASES = NodeSchema(
    (
        IdColumn("csid"),
        StructuralColumn(":LABEL"),
        PropertyColumn("name"),
        PropertyColumn("aliases"),
    )
)
_NODE_PLAIN = NodeSchema(
    (IdColumn("csid"), StructuralColumn(":LABEL"), PropertyColumn("name"))
)
_EDGE = EdgeSchema(
    (
        StructuralColumn(":START_ID"),
        StructuralColumn(":END_ID"),
        StructuralColumn(":TYPE"),
    )
)


def _dataset(root: Path) -> None:
    """Write a small but realistic nodes/ + edges/ dataset under *root*."""
    write_node_rows(
        root / "nodes" / "Dish.tsv",
        _NODE_WITH_ALIASES,
        [{"csid": "cs:dish:ceviche", ":LABEL": ["Dish"], "name": "Ceviche",
          "aliases": ["cebiche", "seviche"]}],
    )
    write_node_rows(
        root / "nodes" / "Region.tsv",
        _NODE_PLAIN,
        [{"csid": "cs:region:peru", ":LABEL": ["Region"], "name": "Peru"}],
    )
    write_edge_rows(
        root / "edges" / "ORIGINATES_FROM.tsv",
        _EDGE,
        [{":START_ID": "cs:dish:ceviche", ":END_ID": "cs:region:peru",
          ":TYPE": "ORIGINATES_FROM"}],
    )


def test_command_references_every_file_with_correct_flags(tmp_path: Path) -> None:
    _dataset(tmp_path)
    plan = generate_import_script(tmp_path)

    cmd = plan.command
    assert cmd[:5] == ("neo4j-admin", "database", "import", "full", "neo4j")
    assert "--delimiter=\\t" in cmd
    assert f"--array-delimiter={ARRAY_DELIMITER}" in cmd
    assert "--overwrite-destination" in cmd

    # Every node file is referenced once via --nodes, every edge via --relationships.
    node_flags = [a for a in cmd if a.startswith("--nodes=")]
    edge_flags = [a for a in cmd if a.startswith("--relationships=")]
    assert len(node_flags) == 2
    assert len(edge_flags) == 1
    assert {Path(a.removeprefix("--nodes=")).name for a in node_flags} == {
        "Dish.tsv",
        "Region.tsv",
    }
    assert Path(edge_flags[0].removeprefix("--relationships=")).name == (
        "ORIGINATES_FROM.tsv"
    )
    # All referenced paths are absolute so the script runs from any directory.
    for flag in (*node_flags, *edge_flags):
        assert Path(flag.split("=", 1)[1]).is_absolute()


def test_multivalue_property_is_transformed_into_an_array(tmp_path: Path) -> None:
    _dataset(tmp_path)
    original = (tmp_path / "nodes" / "Dish.tsv").read_text(encoding="utf-8")

    plan = generate_import_script(tmp_path)

    # The aliases column gains the :string[] type in a transformed copy...
    assert len(plan.transformed) == 1
    copy = plan.transformed[0]
    assert copy.read_text(encoding="utf-8").splitlines()[0].endswith("aliases:string[]")
    # ...the command references the copy, not the original Dish.tsv...
    assert f"--nodes={copy}" in plan.command
    original_path = (tmp_path / "nodes" / "Dish.tsv").resolve()
    assert f"--nodes={original_path}" not in plan.command
    # ...and the original file is left untouched.
    assert (tmp_path / "nodes" / "Dish.tsv").read_text(encoding="utf-8") == original


def test_plain_node_and_edge_files_are_referenced_directly(tmp_path: Path) -> None:
    _dataset(tmp_path)
    plan = generate_import_script(tmp_path)

    region = (tmp_path / "nodes" / "Region.tsv").resolve()
    edge = (tmp_path / "edges" / "ORIGINATES_FROM.tsv").resolve()
    assert f"--nodes={region}" in plan.command
    assert f"--relationships={edge}" in plan.command
    assert region not in plan.transformed
    assert edge not in plan.transformed


def test_script_is_emitted_and_runnable(tmp_path: Path) -> None:
    _dataset(tmp_path)
    plan = generate_import_script(tmp_path)

    assert plan.script_path == tmp_path / SCRIPT_NAME
    text = plan.script_path.read_text(encoding="utf-8")
    assert text.startswith("#!/usr/bin/env bash")
    assert "neo4j-admin database import full neo4j" in text
    assert "'--delimiter=\\t'" in text
    assert "'--array-delimiter=;'" in text
    # The script is marked executable; generation never needed a live DB.
    assert plan.script_path.stat().st_mode & 0o100


def test_out_dir_keeps_copies_and_script_out_of_the_source_tree(
    tmp_path: Path,
) -> None:
    src = tmp_path / "data"
    out = tmp_path / "build"
    _dataset(src)

    plan = generate_import_script(src, out_dir=out)

    assert plan.script_path == out / SCRIPT_NAME
    assert plan.transformed[0].is_relative_to(out)
    assert not (src / SCRIPT_NAME).exists()


def test_custom_database_name(tmp_path: Path) -> None:
    _dataset(tmp_path)
    plan = generate_import_script(tmp_path, database="culture")
    assert plan.database == "culture"
    assert plan.command[4] == "culture"


def test_missing_nodes_directory_raises(tmp_path: Path) -> None:
    write_edge_rows(
        tmp_path / "edges" / "X.tsv",
        _EDGE,
        [{":START_ID": "a", ":END_ID": "b", ":TYPE": "X"}],
    )
    with pytest.raises(AdminImportError, match="no nodes"):
        discover_dataset(tmp_path)


def test_non_directory_raises(tmp_path: Path) -> None:
    missing = tmp_path / "nope"
    with pytest.raises(AdminImportError, match="not a directory"):
        discover_dataset(missing)


def test_invalid_header_raises(tmp_path: Path) -> None:
    nodes = tmp_path / "nodes"
    nodes.mkdir()
    # A node file missing the required :LABEL column is not a valid header.
    (nodes / "Bad.tsv").write_text("csid:ID\tname\nx\ty\n", encoding="utf-8")
    with pytest.raises(AdminImportError, match="not a valid neo4j-admin node"):
        generate_import_script(tmp_path)
