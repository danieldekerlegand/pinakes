"""Tests for the shipped example Cypher queries and their linter.

The example queries (``cypher/*.cypher``) must run as-is against a graph this
package imports, so each one is checked to be non-empty, documented, and to
reference only the labels and relationship ``:TYPE`` tokens the schema defines
(:mod:`culturescrape.neo4j.queries`). No live database is required — the linter
stands in for a driver ``EXPLAIN``, as the acceptance criteria allow.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from culturescrape.neo4j.queries import (
    DEFINED_LABELS,
    DEFINED_TYPES,
    iter_queries,
    lint_query,
    node_labels,
    relationship_types,
)

#: The example queries the story requires, by filename.
EXPECTED_QUERIES = {
    "shortest-cultural-path.cypher",
    "contemporary-with.cypher",
    "originates-from-region.cypher",
    "language-family-tree.cypher",
}


def _queries() -> list[Path]:
    return iter_queries()


def test_all_required_queries_are_shipped() -> None:
    names = {path.name for path in _queries()}
    assert EXPECTED_QUERIES <= names


@pytest.mark.parametrize("path", _queries(), ids=lambda p: p.name)
def test_query_file_is_non_empty(path: Path) -> None:
    assert path.read_text(encoding="utf-8").strip(), f"{path.name} is empty"


@pytest.mark.parametrize("path", _queries(), ids=lambda p: p.name)
def test_query_has_explanatory_comment(path: Path) -> None:
    assert "//" in path.read_text(encoding="utf-8"), f"{path.name} is undocumented"


@pytest.mark.parametrize("path", _queries(), ids=lambda p: p.name)
def test_query_references_only_defined_labels_and_types(path: Path) -> None:
    query = path.read_text(encoding="utf-8")
    assert node_labels(query) <= DEFINED_LABELS
    assert relationship_types(query) <= DEFINED_TYPES


@pytest.mark.parametrize("path", _queries(), ids=lambda p: p.name)
def test_query_lints_clean(path: Path) -> None:
    problems = lint_query(path.read_text(encoding="utf-8"))
    assert problems == [], f"{path.name}: {problems}"


def test_linter_flags_an_undefined_label() -> None:
    problems = lint_query("// nope\nMATCH (n:Bogus) RETURN n;")
    assert any("undefined label :Bogus" in p for p in problems)


def test_linter_flags_an_undefined_relationship_type() -> None:
    problems = lint_query("// nope\nMATCH (a)-[:BOGUS_REL]->(b) RETURN a, b;")
    assert any("undefined relationship type :BOGUS_REL" in p for p in problems)


def test_linter_flags_a_missing_comment() -> None:
    assert "query has no explanatory comment" in lint_query("MATCH (n) RETURN n;")
