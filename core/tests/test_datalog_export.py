"""Tests for the dataset → logic-program orchestration (T5-US-007)."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from culturescrape.datalog.export import (
    PROLOG_PROGRAM_NAME,
    DatalogExportError,
    Engine,
    collect_facts,
    engines_for_choice,
    export_dataset,
)
from culturescrape.datalog.souffle import SOUFFLE_PROGRAM_NAME

_FIXTURES = Path(__file__).parent / "fixtures" / "datalog"


def _dataset(root: Path) -> Path:
    (root / "nodes").mkdir(parents=True)
    (root / "edges").mkdir(parents=True)
    shutil.copy(_FIXTURES / "nodes.tsv", root / "nodes" / "nodes.tsv")
    shutil.copy(_FIXTURES / "edges.tsv", root / "edges" / "edges.tsv")
    return root


def test_engines_for_choice_expands_both() -> None:
    assert engines_for_choice("both") == (Engine.SWIPL, Engine.SOUFFLE)
    assert engines_for_choice("swipl") == (Engine.SWIPL,)
    assert engines_for_choice("souffle") == (Engine.SOUFFLE,)


def test_engines_for_choice_rejects_unknown() -> None:
    with pytest.raises(DatalogExportError):
        engines_for_choice("datomic")


def test_collect_facts_reads_nodes_then_edges(tmp_path: Path) -> None:
    facts = collect_facts(_dataset(tmp_path / "data"))
    # node/3 (entity-defining) facts precede any edge rel/3 facts.
    predicates = [fact.predicate for fact in facts]
    assert predicates.index("node") < predicates.index("rel")


def test_collect_facts_requires_node_files(tmp_path: Path) -> None:
    (tmp_path / "edges").mkdir(parents=True)
    with pytest.raises(DatalogExportError, match="no nodes"):
        collect_facts(tmp_path)


def test_export_returns_fact_count_and_program_paths(tmp_path: Path) -> None:
    dataset = _dataset(tmp_path / "data")
    out = tmp_path / "out"
    result = export_dataset(dataset, out, (Engine.SWIPL, Engine.SOUFFLE))

    assert result.fact_count == sum(1 for _ in collect_facts(dataset))
    assert result.programs[Engine.SWIPL] == out / PROLOG_PROGRAM_NAME
    assert result.programs[Engine.SOUFFLE] == out / SOUFFLE_PROGRAM_NAME


def test_export_rejects_empty_engine_set(tmp_path: Path) -> None:
    with pytest.raises(DatalogExportError, match="no engine"):
        export_dataset(_dataset(tmp_path / "data"), tmp_path / "out", ())


def test_load_hint_is_engine_specific(tmp_path: Path) -> None:
    out = tmp_path / "out"
    result = export_dataset(
        _dataset(tmp_path / "data"), out, (Engine.SWIPL, Engine.SOUFFLE)
    )
    assert result.load_hint(Engine.SWIPL) == f"swipl {out / PROLOG_PROGRAM_NAME}"
    assert result.load_hint(Engine.SOUFFLE) == (
        f"souffle {out / SOUFFLE_PROGRAM_NAME} -F {out} -D {out}"
    )
