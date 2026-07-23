"""Tests for the ``to-neo4j`` and ``from-neo4j`` CLI commands.

The turnkey import/export commands are exercised end-to-end through ``cli.main``.
``admin`` mode never touches a database. The ``loadcsv`` import and the
``from-neo4j`` export both talk to Neo4j, so a fake driver is substituted for the
real connection: ``cli`` import functions resolve ``connect`` from the neo4j
modules, which are monkeypatched to hand back the fake.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from culturescrape import cli
from culturescrape.neo4j import export as export_mod
from culturescrape.neo4j import load_csv as load_csv_mod
from culturescrape.neo4j.constraints import ENTITY_LABEL
from culturescrape.neo4j.export import EDGE_QUERY, NODE_QUERY
from culturescrape.schema.headers import (
    EdgeSchema,
    IdColumn,
    NodeSchema,
    PropertyColumn,
    PropertyType,
    StructuralColumn,
)
from culturescrape.schema.tsvio import read_rows, write_edge_rows, write_node_rows

_NODE = NodeSchema(
    (
        IdColumn("csid"),
        StructuralColumn(":LABEL"),
        PropertyColumn("name"),
        PropertyColumn("time_start", PropertyType.INT),
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
    """Write a minimal but valid nodes/ + edges/ dataset under *root*."""
    write_node_rows(
        root / "nodes" / "Dish.tsv",
        _NODE,
        [
            {
                "csid": "cs:dish:ceviche",
                ":LABEL": ["Dish"],
                "name": "Ceviche",
                "time_start": "1820",
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


class _RecordingSession:
    """Captures every ``run(cypher, **params)`` call, like a Bolt session."""

    def __init__(self, calls: list[tuple[str, dict[str, Any]]]) -> None:
        self._calls = calls

    def __enter__(self) -> _RecordingSession:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def run(self, cypher: str, **params: Any) -> None:
        self._calls.append((cypher, params))


class _ReplaySession:
    """Replays a per-query list of fixture records (the export read path)."""

    def __init__(self, results: dict[str, list[dict[str, Any]]]) -> None:
        self._results = results

    def __enter__(self) -> _ReplaySession:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def run(self, query: str, **params: Any) -> list[dict[str, Any]]:
        return self._results[query]


class _FakeDriver:
    def __init__(self, session: Any) -> None:
        self._session = session
        self.closed = False

    def session(self) -> Any:
        return self._session

    def close(self) -> None:
        self.closed = True


# --- to-neo4j: admin mode (no database) ------------------------------------


def test_to_neo4j_admin_writes_import_script(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    dataset = tmp_path / "data"
    _dataset(dataset)
    out = tmp_path / "import"

    exit_code = cli.main(
        ["to-neo4j", str(dataset), "--mode", "admin", "--out", str(out)]
    )

    assert exit_code == 0
    script = out / "neo4j-admin-import.sh"
    assert script.is_file()
    body = script.read_text(encoding="utf-8")
    assert "neo4j-admin" in body
    assert "wrote neo4j-admin import script" in capsys.readouterr().out


def test_to_neo4j_defaults_to_admin_mode(tmp_path: Path) -> None:
    dataset = tmp_path / "data"
    _dataset(dataset)

    exit_code = cli.main(["to-neo4j", str(dataset)])

    assert exit_code == 0
    # Default mode writes the admin script alongside the dataset.
    assert (dataset / "neo4j-admin-import.sh").is_file()


def test_to_neo4j_missing_directory_fails(tmp_path: Path) -> None:
    exit_code = cli.main(["to-neo4j", str(tmp_path / "nope")])
    assert exit_code == 2


def test_to_neo4j_admin_on_empty_dataset_fails(tmp_path: Path) -> None:
    (tmp_path / "nodes").mkdir()
    exit_code = cli.main(["to-neo4j", str(tmp_path)])
    assert exit_code == 2


# --- to-neo4j: loadcsv mode (mocked driver) --------------------------------


def test_to_neo4j_loadcsv_applies_constraints_then_loads(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    dataset = tmp_path / "data"
    _dataset(dataset)

    calls: list[tuple[str, dict[str, Any]]] = []
    driver = _FakeDriver(_RecordingSession(calls))
    monkeypatch.setattr(load_csv_mod, "connect", lambda *a, **k: driver)

    exit_code = cli.main(["to-neo4j", str(dataset), "--mode", "loadcsv"])

    assert exit_code == 0
    cyphers = [cypher for cypher, _ in calls]
    # Constraints/indexes are applied before the load lands.
    global_constraint = next(c for c in cyphers if "csid_unique IF NOT EXISTS" in c)
    per_label = next(c for c in cyphers if "csid_unique_Dish IF NOT EXISTS" in c)
    load = [c for c in cyphers if "LOAD CSV WITH HEADERS" in c]
    assert cyphers.index(global_constraint) < cyphers.index(load[0])
    assert cyphers.index(per_label) < cyphers.index(load[0])
    # One LOAD CSV statement per file (node before edge), each bound to $file.
    assert len(load) == 2
    assert all("file" in params for c, params in calls if "LOAD CSV" in c)
    # An owned driver is closed when the run completes.
    assert driver.closed is True
    out = capsys.readouterr().out
    assert "constraint/index statement(s)" in out
    assert "ran 2 LOAD CSV statement(s)" in out


def test_to_neo4j_loadcsv_no_constraints_skips_constraints(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    dataset = tmp_path / "data"
    _dataset(dataset)

    calls: list[tuple[str, dict[str, Any]]] = []
    driver = _FakeDriver(_RecordingSession(calls))
    monkeypatch.setattr(load_csv_mod, "connect", lambda *a, **k: driver)

    exit_code = cli.main(
        ["to-neo4j", str(dataset), "--mode", "loadcsv", "--no-constraints"]
    )

    assert exit_code == 0
    # Only the LOAD CSV statements run; no CREATE CONSTRAINT/INDEX.
    assert all("CREATE CONSTRAINT" not in c for c, _ in calls)
    assert all("CREATE INDEX" not in c for c, _ in calls)
    assert len(calls) == 2
    assert "applied 0 constraint/index statement(s)" in capsys.readouterr().out


def test_neo4j_counts_prints_node_and_edge_counts(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    from culturescrape.neo4j import counts as counts_mod
    from culturescrape.neo4j.counts import EDGE_COUNT_QUERY, NODE_COUNT_QUERY

    results = {
        NODE_COUNT_QUERY: [
            {"label": ENTITY_LABEL, "count": 3},
            {"label": "Dish", "count": 2},
            {"label": "Region", "count": 1},
        ],
        EDGE_COUNT_QUERY: [{"type": "ORIGINATES_FROM", "count": 4}],
    }
    driver = _FakeDriver(_ReplaySession(results))
    monkeypatch.setattr(counts_mod, "connect", lambda *a, **k: driver)

    exit_code = cli.main(["neo4j-counts"])

    assert exit_code == 0
    out = capsys.readouterr().out
    assert "node counts by label (total 3):" in out
    assert "Dish: 2" in out
    assert "edge counts by type (total 4):" in out
    assert "ORIGINATES_FROM: 4" in out
    assert driver.closed is True


# --- from-neo4j: export (mocked driver) ------------------------------------


def test_from_neo4j_exports_connected_db_to_tsv(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    results = {
        NODE_QUERY: [
            {
                "labels": ["Dish", ENTITY_LABEL],
                "props": {"csid": "cs:dish:ceviche", "name": "Ceviche"},
            }
        ],
        EDGE_QUERY: [
            {
                "start": "cs:dish:ceviche",
                "end": "cs:region:peru",
                "type": "ORIGINATES_FROM",
                "props": {"source": "wikidata"},
            }
        ],
    }
    driver = _FakeDriver(_ReplaySession(results))
    monkeypatch.setattr(export_mod, "connect", lambda *a, **k: driver)

    out = tmp_path / "out"
    exit_code = cli.main(["from-neo4j", "--out", str(out)])

    assert exit_code == 0
    _, (node_row,) = read_rows(out / "nodes" / "Dish.tsv")
    assert node_row["csid"] == "cs:dish:ceviche"
    _, (edge_row,) = read_rows(out / "edges" / "ORIGINATES_FROM.tsv")
    assert edge_row[":TYPE"] == "ORIGINATES_FROM"
    assert driver.closed is True
    assert "exported 1 node(s) and 1 edge(s)" in capsys.readouterr().out
