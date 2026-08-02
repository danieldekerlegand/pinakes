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

from pinakes_engine.neo4j.constraints import (
    CSID_CONSTRAINT,
    ENTITY_LABEL,
    NAME_INDEX,
    SCRIPT_NAME,
    WIKIDATA_QID_INDEX,
    all_constraint_statements,
    apply_constraints,
    constraint_statements,
    dataset_node_labels,
    generate_constraints_script,
    label_constraint_statements,
)
from pinakes_engine.schema.headers import NodeSchema
from pinakes_engine.schema.tsvio import write_node_rows

EMPTY_ENV: dict[str, str] = {}


def _corpus(root: Path) -> Path:
    """Write a two-label node corpus (Language, ArchaeologicalCulture) under *root*."""
    schema = NodeSchema.canonical()
    write_node_rows(
        root / "nodes" / "language.tsv",
        schema,
        [{":LABEL": ["Language"], "csid": "cs:language:en", "name": "English"}],
    )
    write_node_rows(
        root / "nodes" / "archaeologicalculture.tsv",
        schema,
        [
            {
                ":LABEL": ["ArchaeologicalCulture"],
                "csid": "cs:archaeological-culture:yamnaya",
                "name": "Yamnaya",
            }
        ],
    )
    return root


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


def test_label_constraints_are_per_label_and_idempotent() -> None:
    statements = label_constraint_statements(["Language", "ArchaeologicalCulture"])
    # Two statements per label (csid uniqueness constraint + name index), sorted.
    assert statements == (
        "CREATE CONSTRAINT csid_unique_ArchaeologicalCulture IF NOT EXISTS\n"
        "FOR (n:ArchaeologicalCulture) REQUIRE n.csid IS UNIQUE;",
        "CREATE INDEX ArchaeologicalCulture_name IF NOT EXISTS\n"
        "FOR (n:ArchaeologicalCulture) ON (n.name);",
        "CREATE CONSTRAINT csid_unique_Language IF NOT EXISTS\n"
        "FOR (n:Language) REQUIRE n.csid IS UNIQUE;",
        "CREATE INDEX Language_name IF NOT EXISTS\n"
        "FOR (n:Language) ON (n.name);",
    )
    assert all("IF NOT EXISTS" in stmt for stmt in statements)


def test_label_constraints_dedupe_labels() -> None:
    assert label_constraint_statements(["Language", "Language"]) == (
        label_constraint_statements(["Language"])
    )


def test_dataset_node_labels_reads_label_cells(tmp_path: Path) -> None:
    corpus = _corpus(tmp_path / "corpus")
    assert dataset_node_labels(corpus) == ("ArchaeologicalCulture", "Language")


def test_all_constraint_statements_extends_global_with_per_label(
    tmp_path: Path,
) -> None:
    corpus = _corpus(tmp_path / "corpus")
    statements = all_constraint_statements(corpus)
    # The three global statements come first, unchanged.
    assert statements[:3] == constraint_statements()
    # Then the per-label ones for exactly the corpus's labels.
    assert statements[3:] == label_constraint_statements(
        ("ArchaeologicalCulture", "Language")
    )


def test_apply_constraints_accepts_explicit_statements() -> None:
    driver: Any = _FakeDriver()
    explicit = label_constraint_statements(["Language"])
    applied = apply_constraints(driver=driver, statements=explicit)
    assert applied == explicit
    assert driver.run_statements == list(explicit)


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
