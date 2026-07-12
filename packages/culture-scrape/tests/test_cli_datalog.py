"""Tests for the ``to-datalog`` CLI command (T5-US-007).

The turnkey export is exercised end-to-end through ``cli.main``: it discovers a
``nodes/`` + ``edges/`` dataset, projects it, and writes a logic program for the
selected engine(s). The generated ``.pl``/``.dl`` is re-checked here against the
same well-formedness shape the per-engine emitter tests assert, so the command
is verified to produce a loadable program (not merely a file).
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

import pytest

from culturescrape import cli
from culturescrape.datalog.export import PROLOG_PROGRAM_NAME
from culturescrape.datalog.souffle import SOUFFLE_PROGRAM_NAME

_FIXTURES = Path(__file__).parent / "fixtures" / "datalog"

# A Prolog clause or directive, mirroring tests/test_datalog_prolog.py.
# A fact (`pred(...).`) or a rule (`head(...) :- body.`); the body may end in a
# comparison literal (`Ex >= Sy.`) rather than a parenthesised goal, so the line
# is only required to start with a functor application and end with a period.
_CLAUSE_RE = re.compile(r"^[a-z][A-Za-z0-9_]*\(.*\.(\s+%.*)?$")
_DIRECTIVE_RE = re.compile(
    r"^:- (discontiguous|dynamic|table) [a-z][A-Za-z0-9_]*/\d+\.$"
)
# A Soufflé declaration / I/O directive, mirroring tests/test_datalog_souffle.py.
_DECL_RE = re.compile(
    r"^\.decl [a-z][A-Za-z0-9_]*\((x\d+: (symbol|number|float)(, )?)+\)$"
)
_IO_RE = re.compile(r"^\.(input|output) [a-z][A-Za-z0-9_]*$")


def _dataset(root: Path) -> None:
    """Lay out the datalog fixture as a nodes/ + edges/ dataset under *root*."""
    (root / "nodes").mkdir(parents=True)
    (root / "edges").mkdir(parents=True)
    shutil.copy(_FIXTURES / "nodes.tsv", root / "nodes" / "nodes.tsv")
    shutil.copy(_FIXTURES / "edges.tsv", root / "edges" / "edges.tsv")


def _assert_prolog_well_formed(path: Path) -> None:
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("%"):
            continue
        assert _CLAUSE_RE.match(line) or _DIRECTIVE_RE.match(line), line


def _assert_souffle_well_formed(path: Path) -> None:
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("//"):
            continue
        if line.startswith("."):
            assert _DECL_RE.match(line) or _IO_RE.match(line), line
        else:  # a rule clause (present only with --rules)
            assert line.rstrip().endswith("."), line


def test_swipl_writes_a_well_formed_program(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    dataset = tmp_path / "data"
    _dataset(dataset)
    out = tmp_path / "datalog"

    code = cli.main(
        ["to-datalog", str(dataset), "--engine", "swipl", "--out", str(out)]
    )

    assert code == 0
    program = out / PROLOG_PROGRAM_NAME
    assert program.is_file()
    _assert_prolog_well_formed(program)
    stdout = capsys.readouterr().out
    assert "projected" in stdout
    assert f"swipl {program}" in stdout


def test_souffle_writes_program_and_facts(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    dataset = tmp_path / "data"
    _dataset(dataset)
    out = tmp_path / "datalog"

    code = cli.main(
        ["to-datalog", str(dataset), "--engine", "souffle", "--out", str(out)]
    )

    assert code == 0
    program = out / SOUFFLE_PROGRAM_NAME
    assert program.is_file()
    _assert_souffle_well_formed(program)
    # The fact rows live in sibling .facts files.
    assert list(out.glob("*.facts"))
    stdout = capsys.readouterr().out
    assert f"souffle {program}" in stdout


def test_both_writes_each_engine(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    dataset = tmp_path / "data"
    _dataset(dataset)
    out = tmp_path / "datalog"

    code = cli.main(["to-datalog", str(dataset), "--engine", "both", "--out", str(out)])

    assert code == 0
    pl = out / PROLOG_PROGRAM_NAME
    dl = out / SOUFFLE_PROGRAM_NAME
    assert pl.is_file() and dl.is_file()
    _assert_prolog_well_formed(pl)
    _assert_souffle_well_formed(dl)


def test_defaults_to_both_engines(tmp_path: Path) -> None:
    dataset = tmp_path / "data"
    _dataset(dataset)
    out = tmp_path / "datalog"

    code = cli.main(["to-datalog", str(dataset), "--out", str(out)])

    assert code == 0
    assert (out / PROLOG_PROGRAM_NAME).is_file()
    assert (out / SOUFFLE_PROGRAM_NAME).is_file()


def test_rules_flag_attaches_inference_library(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    dataset = tmp_path / "data"
    _dataset(dataset)
    out = tmp_path / "datalog"

    code = cli.main(
        ["to-datalog", str(dataset), "--engine", "both", "--rules", "--out", str(out)]
    )

    assert code == 0
    pl = (out / PROLOG_PROGRAM_NAME).read_text(encoding="utf-8")
    dl = (out / SOUFFLE_PROGRAM_NAME).read_text(encoding="utf-8")
    # A derived relation defined only by the rule library appears in both.
    assert "ancestor(X, Y) :- descends_from(X, Y)." in pl
    assert "ancestor(X, Y) :- descends_from(X, Y)." in dl
    assert "with rules" in capsys.readouterr().out
    _assert_prolog_well_formed(out / PROLOG_PROGRAM_NAME)
    _assert_souffle_well_formed(out / SOUFFLE_PROGRAM_NAME)


def test_without_rules_omits_inference_library(tmp_path: Path) -> None:
    dataset = tmp_path / "data"
    _dataset(dataset)
    out = tmp_path / "datalog"

    cli.main(["to-datalog", str(dataset), "--engine", "swipl", "--out", str(out)])

    assert "ancestor" not in (out / PROLOG_PROGRAM_NAME).read_text(encoding="utf-8")


def test_missing_directory_fails(tmp_path: Path) -> None:
    code = cli.main(
        ["to-datalog", str(tmp_path / "nope"), "--out", str(tmp_path / "o")]
    )
    assert code == 2


def test_dataset_without_nodes_fails(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    dataset = tmp_path / "data"
    (dataset / "edges").mkdir(parents=True)

    code = cli.main(["to-datalog", str(dataset), "--out", str(tmp_path / "o")])

    assert code == 2
    assert "no nodes" in capsys.readouterr().err


# --- datalog-materialize ----------------------------------------------------


def test_materialize_prints_base_and_derived_counts(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    dataset = tmp_path / "data"
    _dataset(dataset)

    code = cli.main(["datalog-materialize", str(dataset)])

    assert code == 0
    stdout = capsys.readouterr().out
    assert "base relations read" in stdout
    assert "derived relations (total" in stdout


def test_materialize_writes_a_manifest(tmp_path: Path) -> None:
    dataset = tmp_path / "data"
    _dataset(dataset)
    manifest = tmp_path / "out" / "materialization.json"

    code = cli.main(["datalog-materialize", str(dataset), "--json", str(manifest)])

    assert code == 0
    body = json.loads(manifest.read_text(encoding="utf-8"))
    assert set(body) == {"base_relations", "derived_relations", "derived_total"}
    # Every rule head is materialised (present in the derived section).
    from culturescrape.datalog.rules import RULES

    assert {rule.name for rule in RULES} <= set(body["derived_relations"])
    assert body["derived_total"] == sum(body["derived_relations"].values())


def test_materialize_missing_directory_fails(tmp_path: Path) -> None:
    code = cli.main(["datalog-materialize", str(tmp_path / "nope")])
    assert code == 2
