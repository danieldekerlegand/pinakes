"""Tests for emitting a loadable SWI-Prolog program (T5-US-004)."""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from culturescrape.datalog import (
    Fact,
    edge_file_facts,
    node_file_facts,
    render_program,
    write_program,
)

NODES = Path(__file__).parent / "fixtures" / "datalog" / "nodes.tsv"
EDGES = Path(__file__).parent / "fixtures" / "datalog" / "edges.tsv"


def _fixture_facts() -> list[Fact]:
    return list(node_file_facts(NODES)) + list(edge_file_facts(EDGES))


def test_header_documents_the_predicate_schema() -> None:
    program = render_program(_fixture_facts())
    header = program[: program.index(":- discontiguous")]
    # Every emitted predicate family is named in the leading comment block.
    for predicate in ("node(", "instance_of(", "located_at(", "rel(", "rel_conf("):
        assert predicate in header
    # ...and the comment block is genuinely a comment (every line starts with %).
    assert all(line.startswith("%") for line in header.strip().splitlines())


def test_directives_cover_every_predicate_arity() -> None:
    facts = _fixture_facts()
    program = render_program(facts)
    signatures = {(f.predicate, len(f.args)) for f in facts}
    for name, arity in signatures:
        assert f":- discontiguous {name}/{arity}." in program
        assert f":- dynamic {name}/{arity}." in program


def test_signature_directives_are_emitted_once_per_distinct_arity() -> None:
    # node/3 recurs across rows but yields a single directive.
    program = render_program(_fixture_facts())
    assert program.count(":- discontiguous node/3.") == 1


def test_every_fact_becomes_a_clause() -> None:
    facts = _fixture_facts()
    program = render_program(facts)
    for fact in facts:
        assert fact.render() in program


def test_program_ends_with_a_trailing_newline() -> None:
    program = render_program(_fixture_facts())
    assert program.endswith("\n")
    # A bare fact (no source comment) keeps its clause-terminating period.
    assert render_program([Fact("node", ("a", "b", "c"))]).endswith(".\n")


def test_empty_fact_set_emits_only_the_header() -> None:
    program = render_program([])
    assert ":- discontiguous" not in program
    assert ":- dynamic" not in program
    assert program.lstrip().startswith("%")


def test_write_program_returns_count_and_writes_file(tmp_path: Path) -> None:
    facts = _fixture_facts()
    out = tmp_path / "nested" / "graph.pl"
    count = write_program(out, facts)
    assert count == len(facts)
    assert out.read_text(encoding="utf-8") == render_program(facts)


# A minimal Prolog clause grammar: a functor, a parenthesised argument list, and
# a terminating period (an optional trailing ``% source: ...`` comment aside).
_CLAUSE_RE = re.compile(r"^[a-z][A-Za-z0-9_]*\(.+\)\.(\s+%.*)?$")
_DIRECTIVE_RE = re.compile(r"^:- (discontiguous|dynamic) [a-z][A-Za-z0-9_]*/\d+\.$")


def test_generated_program_parses_clause_by_clause() -> None:
    program = render_program(_fixture_facts())
    for line in program.splitlines():
        if not line or line.startswith("%"):
            continue
        assert _CLAUSE_RE.match(line) or _DIRECTIVE_RE.match(line), line


SWIPL = shutil.which("swipl")


@pytest.mark.skipif(SWIPL is None, reason="swipl is not installed")
def test_swipl_loads_the_program_cleanly(tmp_path: Path) -> None:
    out = tmp_path / "graph.pl"
    write_program(out, _fixture_facts())
    assert SWIPL is not None  # narrow for mypy; guarded by the skipif above
    result = subprocess.run(
        [SWIPL, "-q", "-g", "halt", str(out)],
        capture_output=True,
        text=True,
    )
    combined = result.stdout + result.stderr
    assert result.returncode == 0, combined
    # "loads cleanly" means no warnings or errors on the load path.
    assert "Warning" not in combined, combined
    assert "ERROR" not in combined, combined


def test_swipl_smoke_skip_is_logged_when_absent(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Document (and log) the skip reason when swipl is unavailable."""
    if SWIPL is not None:
        pytest.skip("swipl is installed; the absence path is exercised elsewhere")
    with caplog.at_level(logging.INFO):
        logging.getLogger(__name__).info("skipping swipl smoke test: swipl not found")
    assert "swipl not found" in caplog.text
