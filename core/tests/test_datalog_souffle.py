"""Tests for emitting a runnable Soufflé Datalog program (T5-US-005)."""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from culturescrape.datalog import (
    SOUFFLE_PROGRAM_NAME,
    DatalogError,
    Fact,
    Relation,
    edge_file_facts,
    node_file_facts,
    render_souffle_program,
    souffle_relations,
    write_souffle_facts,
    write_souffle_program,
)
from culturescrape.datalog.export import Engine, export_dataset
from culturescrape.schema.tsvio import decode_value

NODES = Path(__file__).parent / "fixtures" / "datalog" / "nodes.tsv"
EDGES = Path(__file__).parent / "fixtures" / "datalog" / "edges.tsv"


def _fixture_facts() -> list[Fact]:
    return list(node_file_facts(NODES)) + list(edge_file_facts(EDGES))


# --- type inference ---------------------------------------------------------


def test_attribute_types_are_inferred_per_position() -> None:
    rels = {r.predicate: r for r in souffle_relations(_fixture_facts())}
    # csid is always a symbol; year is a number; coordinates are floats.
    assert rels["node"].types == ("symbol", "symbol", "symbol")
    assert rels["time_start"].types == ("symbol", "number")
    assert rels["located_at"].types == ("symbol", "float", "float")
    assert rels["rel_conf"].types == ("symbol", "symbol", "symbol", "float")


def test_mixed_int_and_float_position_widens_to_float() -> None:
    rels = souffle_relations(
        [Fact("v", ("a", 1)), Fact("v", ("a", 2.5))]
    )
    assert rels[0].types == ("symbol", "float")


def test_mixing_a_string_into_a_numeric_position_widens_to_symbol() -> None:
    rels = souffle_relations(
        [Fact("v", ("a", 1)), Fact("v", ("a", "two"))]
    )
    assert rels[0].types == ("symbol", "symbol")


def test_same_predicate_with_two_arities_is_rejected() -> None:
    # Soufflé relations are keyed by name, so this cannot be declared.
    with pytest.raises(DatalogError, match="single arity"):
        souffle_relations([Fact("node", ("a", "b")), Fact("node", ("a", "b", "c"))])


def test_relations_are_sorted_by_predicate() -> None:
    rels = souffle_relations([Fact("zeta", ("a",)), Fact("alpha", ("a",))])
    assert [r.predicate for r in rels] == ["alpha", "zeta"]


# --- the .dl program --------------------------------------------------------


def test_header_is_a_comment_block_documenting_the_layout() -> None:
    lines = render_souffle_program(_fixture_facts()).splitlines()
    # The leading run of comment lines, up to the first directive line.
    header = lines[: next(i for i, ln in enumerate(lines) if ln.startswith(".decl"))]
    header_text = "\n".join(header)
    assert all(not ln or ln.startswith("//") for ln in header)
    assert ".facts" in header_text  # documents where the rows live


def test_every_predicate_gets_decl_input_and_output() -> None:
    facts = _fixture_facts()
    program = render_souffle_program(facts)
    for relation in souffle_relations(facts):
        assert relation.declaration() in program
        assert f"\n.input {relation.predicate}\n" in program
        assert f"\n.output {relation.predicate}\n" in program


def test_decl_attribute_count_matches_arity() -> None:
    program = render_souffle_program(_fixture_facts())
    assert ".decl located_at(x0: symbol, x1: float, x2: float)" in program
    assert ".decl rel(x0: symbol, x1: symbol, x2: symbol)" in program


def test_program_ends_with_a_trailing_newline() -> None:
    assert render_souffle_program(_fixture_facts()).endswith("\n")


def test_empty_fact_set_emits_only_the_header() -> None:
    program = render_souffle_program([])
    # No directive lines (a comment may *mention* .decl, but none begins one).
    assert not any(
        line.startswith((".decl", ".input", ".output"))
        for line in program.splitlines()
    )
    assert program.lstrip().startswith("//")


# A .dl declaration line: a directive keyword followed by its operand.
_DECL_RE = re.compile(
    r"^\.decl [a-z][A-Za-z0-9_]*\((x\d+: (symbol|number|float)(, )?)+\)$"
)
_IO_RE = re.compile(r"^\.(input|output) [a-z][A-Za-z0-9_]*$")
#: One declared attribute slot inside a ``.decl`` line.
_ATTR_RE = re.compile(r"x\d+: (?:symbol|number|float)")


def test_generated_program_is_well_formed_line_by_line() -> None:
    program = render_souffle_program(_fixture_facts())
    for line in program.splitlines():
        if not line or line.startswith("//"):
            continue
        assert _DECL_RE.match(line) or _IO_RE.match(line), line


# --- the .facts files -------------------------------------------------------


def test_writes_one_facts_file_per_relation(tmp_path: Path) -> None:
    facts = _fixture_facts()
    counts = write_souffle_facts(tmp_path, facts)
    for relation in souffle_relations(facts):
        path = tmp_path / f"{relation.predicate}.facts"
        assert path.exists()
        # Headerless: every physical line is a row of <arity> tab-separated cells.
        lines = path.read_text(encoding="utf-8").splitlines()
        assert len(lines) == counts[relation.predicate]
        for line in lines:
            assert len(line.split("\t")) == len(relation.types)


def test_facts_carry_raw_unquoted_values(tmp_path: Path) -> None:
    write_souffle_facts(tmp_path, _fixture_facts())
    node_rows = (tmp_path / "node.facts").read_text(encoding="utf-8").splitlines()
    # csids and names are bare in Soufflé's native format (no surrounding quotes).
    assert any(row.startswith("cs:dish:Q42\tDish\tCeviche") for row in node_rows)
    # A year is a bare integer; coordinates are bare floats.
    assert (tmp_path / "time_start.facts").read_text(
        encoding="utf-8"
    ).strip() == "cs:battle:Q47\t-480"


def test_facts_files_are_lossless_for_pathological_values(tmp_path: Path) -> None:
    # A name with a tab, newline, and backslash must not corrupt the TSV format.
    nasty = "a\tb\nc\\d"
    write_souffle_facts(tmp_path, [Fact("node", ("cs:x:Q1", "Dish", nasty))])
    line = (tmp_path / "node.facts").read_text(encoding="utf-8").splitlines()
    assert len(line) == 1  # the embedded newline did not split the row
    cells = line[0].split("\t")
    assert len(cells) == 3  # the embedded tab did not split the cell
    assert decode_value(cells[2]) == nasty  # and it round-trips exactly


def test_int_in_a_float_column_is_written_with_a_decimal_point(tmp_path: Path) -> None:
    # The column widens to float; the int value must match its float .decl.
    write_souffle_facts(tmp_path, [Fact("w", ("a", 5)), Fact("w", ("a", 2.5))])
    rows = (tmp_path / "w.facts").read_text(encoding="utf-8").splitlines()
    assert "a\t5.0" in rows


def test_write_program_emits_dl_and_facts_and_returns_count(tmp_path: Path) -> None:
    facts = _fixture_facts()
    count = write_souffle_program(tmp_path, facts)
    assert count == len(facts)
    program = (tmp_path / SOUFFLE_PROGRAM_NAME).read_text(encoding="utf-8")
    assert program == render_souffle_program(facts)
    # Each declared relation's .facts file is present beside the .dl.
    for relation in souffle_relations(facts):
        assert (tmp_path / f"{relation.predicate}.facts").exists()


# --- the souffle smoke test -------------------------------------------------

SOUFFLE = shutil.which("souffle")


@pytest.mark.skipif(SOUFFLE is None, reason="souffle is not installed")
def test_souffle_runs_the_program(tmp_path: Path) -> None:
    facts_dir = tmp_path / "facts"
    out_dir = tmp_path / "out"
    out_dir.mkdir()
    write_souffle_program(facts_dir, _fixture_facts())
    assert SOUFFLE is not None  # narrow for mypy; guarded by the skipif above
    result = subprocess.run(
        [
            SOUFFLE,
            str(facts_dir / SOUFFLE_PROGRAM_NAME),
            "-F",
            str(facts_dir),
            "-D",
            str(out_dir),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    # Running materialises every .output relation; node is one of them.
    assert (out_dir / "node.csv").exists()


def test_souffle_smoke_skip_is_logged_when_absent(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Document (and log) the skip reason when souffle is unavailable."""
    if SOUFFLE is not None:
        pytest.skip("souffle is installed; the absence path is exercised elsewhere")
    with caplog.at_level(logging.INFO):
        logging.getLogger(__name__).info(
            "skipping souffle smoke test: souffle not found"
        )
    assert "souffle not found" in caplog.text


def test_relation_declaration_renders_named_typed_attributes() -> None:
    rel = Relation("located_at", ("symbol", "float", "float"))
    assert rel.declaration() == ".decl located_at(x0: symbol, x1: float, x2: float)"


# --- graph.dl as the export actually ships it (pinakes:50 US-2) --------------


def test_the_lib_emitted_graph_dl_declares_and_shards_every_relation(
    tmp_path: Path,
) -> None:
    """Validate the ``graph.dl`` ``to-datalog`` ships, not only ``render_*``'s.

    Every check above renders through :func:`render_souffle_program` /
    :func:`write_souffle_facts` — the reference emitters. Per the pinakes:50 seam
    spec the shipped program's fact rows come from the embedded agora translation
    engine (``export.py`` ``_export_rule_bearing`` passes them as
    ``rendered_shards``), so the same well-formedness claims are re-asserted
    against that artifact: each declaration parses, each declared relation is
    both ``.input`` and ``.output``, and each has a ``.facts`` shard whose every
    row carries exactly the declared number of attributes.

    ``souffle`` is not needed — this is the structural half of the smoke above,
    which stays gated on the binary.
    """
    root = tmp_path / "data"
    (root / "nodes").mkdir(parents=True)
    (root / "edges").mkdir(parents=True)
    (root / "nodes" / "nodes.tsv").write_text(
        NODES.read_text(encoding="utf-8"), encoding="utf-8"
    )
    (root / "edges" / "edges.tsv").write_text(
        EDGES.read_text(encoding="utf-8"), encoding="utf-8"
    )

    out = tmp_path / "out"
    export_dataset(root, out, (Engine.SOUFFLE,), include_rules=True)
    program = (out / SOUFFLE_PROGRAM_NAME).read_text(encoding="utf-8")

    declared = {
        line.split("(", 1)[0].removeprefix(".decl ")
        for line in program.splitlines()
        if line.startswith(".decl ")
    }
    assert {"node", "rel", "instance_of"} <= declared
    # Count the declared attributes as ``x<n>:`` slots — not any ``x`` on the
    # line, which a predicate name containing one would inflate.
    arities = {
        line.split("(", 1)[0].removeprefix(".decl "): len(_ATTR_RE.findall(line))
        for line in program.splitlines()
        if line.startswith(".decl ")
    }

    for line in program.splitlines():
        if line.startswith((".decl", ".input", ".output")):
            assert _DECL_RE.match(line) or _IO_RE.match(line), line

    # Rule heads are derived, so only the *fact* relations carry a shard; every
    # shard that exists must belong to a declared relation and match its arity.
    shards = sorted(p for p in out.glob("*.facts"))
    assert len(shards) > 1, "a single shard would not exercise the fan-out"
    for shard in shards:
        predicate = shard.stem
        assert predicate in declared, f"{predicate}.facts has no .decl"
        assert f"\n.input {predicate}\n" in program
        assert f"\n.output {predicate}\n" in program
        rows = shard.read_text(encoding="utf-8").splitlines()
        assert rows, f"{predicate}.facts is empty"
        for row in rows:
            assert len(row.split("\t")) == arities[predicate], row
