"""Tests for exporting a Neo4j graph back to canonical TSV.

These never touch a live database: a fake driver replays fixture records (the
shape ``properties(n)`` / ``labels(n)`` / ``type(r)`` return over Bolt) and the
exported files are read back with the real TSV reader and asserted against the
canonical schema. Reading back through ``read_rows`` proves the files parse as
valid node/edge headers and recovers the typed values.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path
from typing import Any

import pytest

from pinakes_engine.neo4j.constraints import ENTITY_LABEL
from pinakes_engine.neo4j.export import (
    EDGE_QUERY,
    NODE_QUERY,
    Neo4jExportError,
    export_to_tsv,
)
from pinakes_engine.schema.headers import (
    EdgeSchema,
    NodeSchema,
    parse_edge_header,
    parse_node_header,
)
from pinakes_engine.schema.tsvio import read_rows

EMPTY_ENV: dict[str, str] = {}


class _FakeSession:
    """Replays a per-query list of fixture records, like a real cursor."""

    def __init__(self, results: dict[str, list[dict[str, Any]]]) -> None:
        self._results = results

    def __enter__(self) -> _FakeSession:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def run(self, query: str) -> list[dict[str, Any]]:
        return self._results[query]


class _FakeDriver:
    def __init__(self, results: dict[str, list[dict[str, Any]]]) -> None:
        self._results = results
        self.closed = False

    def session(self) -> _FakeSession:
        return _FakeSession(self._results)

    def close(self) -> None:
        self.closed = True


def _node_record(labels: list[str], **props: Any) -> dict[str, Any]:
    return {"labels": labels, "props": props}


def _edge_record(
    start: str, end: str, edge_type: str, **props: Any
) -> dict[str, Any]:
    return {"start": start, "end": end, "type": edge_type, "props": props}


def _driver_with(
    nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
) -> _FakeDriver:
    return _FakeDriver({NODE_QUERY: nodes, EDGE_QUERY: edges})


def test_nodes_grouped_by_label_with_canonical_header(tmp_path: Path) -> None:
    driver = _driver_with(
        nodes=[
            _node_record(
                ["Dish", "CulturalArtifact", ENTITY_LABEL],
                csid="cs:dish:ceviche",
                name="Ceviche",
                aliases=["cebiche", "seviche"],
                time_start=1820,
                lat=-12.04,
                confidence=0.9,
                source="wikidata",
            )
        ],
        edges=[],
    )

    result = export_to_tsv(tmp_path, driver=driver)

    # Grouped/named by the alphabetically-first non-Entity label.
    node_file = tmp_path / "nodes" / "CulturalArtifact.tsv"
    assert result.node_files == (node_file,)
    assert result.node_count == 1

    columns, rows = read_rows(node_file)
    # The file carries the full canonical header (parses as a node schema).
    assert NodeSchema(columns) == NodeSchema.canonical()
    parse_node_header(node_file.read_text(encoding="utf-8").splitlines()[0])
    # The Entity anchor is dropped; remaining labels are sorted in :LABEL.
    (row,) = rows
    assert row[":LABEL"] == ["CulturalArtifact", "Dish"]
    assert row["aliases"] == ["cebiche", "seviche"]


def test_typed_and_provenance_columns_survive_with_suffixes(
    tmp_path: Path,
) -> None:
    driver = _driver_with(
        nodes=[
            _node_record(
                ["Dish", ENTITY_LABEL],
                csid="cs:dish:ceviche",
                name="Ceviche",
                time_start=-50,
                lat=-12.04,
                lon=-77.04,
                confidence=0.95,
                source="wikidata",
                source_url="http://example/Q1",
                retrieved_at="2026-01-01T00:00:00Z",
            )
        ],
        edges=[],
    )

    export_to_tsv(tmp_path, driver=driver)

    header = (tmp_path / "nodes" / "Dish.tsv").read_text(
        encoding="utf-8"
    ).splitlines()[0]
    # Typed columns keep their suffixes; BCE years (negative ints) survive.
    assert "time_start:int" in header
    assert "lat:float" in header
    assert "confidence:float" in header
    columns, (row,) = read_rows(tmp_path / "nodes" / "Dish.tsv")
    assert row["time_start"] == "-50"
    assert row["lat"] == "-12.04"
    assert row["confidence"] == "0.95"
    # Provenance round-trips.
    assert row["source"] == "wikidata"
    assert row["retrieved_at"] == "2026-01-01T00:00:00Z"


def test_edges_grouped_by_type_with_canonical_header(tmp_path: Path) -> None:
    driver = _driver_with(
        nodes=[
            _node_record(["Place", ENTITY_LABEL], csid="cs:region:peru", name="Peru")
        ],
        edges=[
            _edge_record(
                "cs:dish:ceviche",
                "cs:region:peru",
                "ORIGINATES_FROM",
                weight=0.9,
                confidence=0.8,
                source="wikidata",
            )
        ],
    )

    result = export_to_tsv(tmp_path, driver=driver)

    edge_file = tmp_path / "edges" / "ORIGINATES_FROM.tsv"
    assert result.edge_files == (edge_file,)
    assert result.edge_count == 1

    columns, (row,) = read_rows(edge_file)
    assert EdgeSchema(columns) == EdgeSchema.canonical()
    parse_edge_header(edge_file.read_text(encoding="utf-8").splitlines()[0])
    assert row[":START_ID"] == "cs:dish:ceviche"
    assert row[":END_ID"] == "cs:region:peru"
    assert row[":TYPE"] == "ORIGINATES_FROM"
    assert row["weight"] == "0.9"


def test_rows_are_written_in_canonical_sort_order(tmp_path: Path) -> None:
    driver = _driver_with(
        nodes=[
            _node_record(["Dish", ENTITY_LABEL], csid="cs:dish:zucchini", name="Z"),
            _node_record(["Dish", ENTITY_LABEL], csid="cs:dish:apple", name="A"),
        ],
        edges=[
            _edge_record("cs:b", "cs:z", "PRECEDES", source="x"),
            _edge_record("cs:a", "cs:z", "PRECEDES", source="x"),
        ],
    )

    export_to_tsv(tmp_path, driver=driver)

    _, node_rows = read_rows(tmp_path / "nodes" / "Dish.tsv")
    assert [r["csid"] for r in node_rows] == ["cs:dish:apple", "cs:dish:zucchini"]
    _, edge_rows = read_rows(tmp_path / "edges" / "PRECEDES.tsv")
    assert [r[":START_ID"] for r in edge_rows] == ["cs:a", "cs:b"]


def test_node_without_type_label_raises(tmp_path: Path) -> None:
    driver = _driver_with(
        nodes=[_node_record([ENTITY_LABEL], csid="cs:orphan", name="X")],
        edges=[],
    )
    with pytest.raises(Neo4jExportError, match="no type label"):
        export_to_tsv(tmp_path, driver=driver)


def test_given_driver_is_left_open(tmp_path: Path) -> None:
    driver = _driver_with(nodes=[], edges=[])
    export_to_tsv(tmp_path, driver=driver)
    assert driver.closed is False


def test_connects_and_closes_when_no_driver(
    tmp_path: Path, monkeypatch: Any
) -> None:
    driver = _driver_with(
        nodes=[_node_record(["Dish", ENTITY_LABEL], csid="cs:dish:a", name="A")],
        edges=[],
    )

    class FakeGraphDatabase:
        @staticmethod
        def driver(uri: str, **kwargs: Any) -> _FakeDriver:
            return driver

    fake_module = types.ModuleType("neo4j")
    fake_module.GraphDatabase = FakeGraphDatabase  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "neo4j", fake_module)

    result = export_to_tsv(tmp_path, config={"password": "p"}, env=EMPTY_ENV)

    assert result.node_count == 1
    # An owned driver (opened from config) is closed before returning.
    assert driver.closed is True
