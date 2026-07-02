"""Tests for generating and applying the Neo4j ``csid`` schema constraints.

Cypher generation never touches a live database. Applying is exercised against a
fake driver (passed in directly) and against a *mocked* ``neo4j`` module injected
into ``sys.modules``, so the optional driver extra need not be installed.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path
from typing import Any

from culturescrape.neo4j.constraints import (
    CSID_CONSTRAINT,
    ENTITY_LABEL,
    NAME_INDEX,
    SCRIPT_NAME,
    WIKIDATA_QID_INDEX,
    apply_constraints,
    constraint_statements,
    generate_constraints_script,
)

EMPTY_ENV: dict[str, str] = {}


def test_csid_constraint_is_unique_and_idempotent() -> None:
    constraint = constraint_statements()[0]
    assert f"CREATE CONSTRAINT {CSID_CONSTRAINT} IF NOT EXISTS" in constraint
    assert f"FOR (n:{ENTITY_LABEL}) REQUIRE n.csid IS UNIQUE" in constraint


def test_indexes_cover_wikidata_qid_and_name() -> None:
    statements = constraint_statements()
    joined = "\n".join(statements)
    assert (
        f"CREATE INDEX {WIKIDATA_QID_INDEX} IF NOT EXISTS\n"
        f"FOR (n:{ENTITY_LABEL}) ON (n.wikidata_qid)" in joined
    )
    assert (
        f"CREATE INDEX {NAME_INDEX} IF NOT EXISTS\n"
        f"FOR (n:{ENTITY_LABEL}) ON (n.name)" in joined
    )
    # Every statement is idempotent.
    assert all("IF NOT EXISTS" in stmt for stmt in statements)


def test_script_is_emitted_and_runnable(tmp_path: Path) -> None:
    script = generate_constraints_script(tmp_path)

    assert script == tmp_path / SCRIPT_NAME
    text = script.read_text(encoding="utf-8")
    assert f"cypher-shell -f {SCRIPT_NAME}" in text
    # All three statements land in the script, constraint before indexes.
    assert text.index("CREATE CONSTRAINT") < text.index("CREATE INDEX")
    assert text.count("CREATE INDEX") == 2


def test_out_dir_is_created(tmp_path: Path) -> None:
    out = tmp_path / "build" / "cypher"
    script = generate_constraints_script(out)
    assert script.exists()
    assert script.parent == out


class _FakeSession:
    def __init__(self, sink: list[str]) -> None:
        self._sink = sink

    def __enter__(self) -> _FakeSession:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def run(self, statement: str) -> None:
        self._sink.append(statement)


class _FakeDriver:
    def __init__(self) -> None:
        self.run_statements: list[str] = []
        self.closed = False

    def session(self) -> _FakeSession:
        return _FakeSession(self.run_statements)

    def close(self) -> None:
        self.closed = True


def test_apply_constraints_runs_each_statement_against_given_driver() -> None:
    driver = _FakeDriver()
    applied = apply_constraints(driver=driver)

    assert applied == constraint_statements()
    assert driver.run_statements == list(constraint_statements())
    # A caller-supplied driver is left open for the caller to manage.
    assert driver.closed is False


def test_apply_constraints_connects_and_closes_when_no_driver(
    monkeypatch: Any,
) -> None:
    driver = _FakeDriver()

    class FakeGraphDatabase:
        @staticmethod
        def driver(uri: str, **kwargs: Any) -> _FakeDriver:
            return driver

    fake_module = types.ModuleType("neo4j")
    fake_module.GraphDatabase = FakeGraphDatabase  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "neo4j", fake_module)

    applied = apply_constraints({"password": "p"}, env=EMPTY_ENV)

    assert applied == constraint_statements()
    assert driver.run_statements == list(constraint_statements())
    # An owned driver (opened from config) is closed before returning.
    assert driver.closed is True
