"""Six-format byte parity for the embedded agora translation engine (pinakes:50 US-2).

:mod:`test_translation_lib` pins the *delegated* surfaces against their reference
emitters. This module is the wider, durable proof the migration hangs on: one
representative canonical fixture (``tests/fixtures/parity/``) rendered through the
engine into **checked-in goldens** for every one of the six canonical conversions
named in the pinakes:42 seam spec ---

===================  ==========================  ===============================
format               engine entry point          pre-migration Python reference
===================  ==========================  ===============================
canonical TSV        ``to_tsv``                  ``tsvio.write_node_rows`` /
                                                 ``write_edge_rows``
Neo4j (to-neo4j)     ``to_csv`` / ``to_cypher``  ``load_csv.node_cypher`` /
                                                 ``edge_cypher``
Neo4j (from-neo4j)   ``to_neo4j_export``         the same canonical TSV writers
SWI-Prolog           ``to_prolog``               ``prolog.write_program``
Soufflé Datalog      ``to_souffle``              ``souffle.write_souffle_program``
ProbLog              ``to_problog``              ``problog.write_problog_program``
===================  ==========================  ===============================

Two independent claims are asserted, and both are about *bytes*, never "it loads":

1. **engine == golden** --- the checked-in artifacts are what the engine emits
   today. Because the goldens are committed data rather than a value computed at
   test time, they survive the code moving: US-6 retires the culture-scrape shell
   and re-runs this module from the relocated package, so any behavioural drift
   introduced by the relocation shows up as a byte diff against files that were
   captured *before* it.
2. **reference emitter == golden** --- the hand-written Python emitters this
   migration replaces reproduce the very same bytes. That is the "the lib output
   equals the pre-migration output" assertion: the two claims share one golden, so
   engine and reference are pinned to each other through it.

``to_csv`` is the one conversion with no pre-migration counterpart --- pinakes-engine
never emitted comma-delimited CSV (``admin_import`` hands ``neo4j-admin`` the
original tab files) --- so claim 2 is met for it by decoding the CSV and asserting
it is cell-for-cell the canonical TSV, which is documented on that test.

Regenerating the goldens is deliberate and manual::

    PARITY_REGEN=1 uv run pytest tests/test_translation_parity.py

Only do that when a byte change is *intended*, and review the resulting diff --- it
is the record of what the corpus artifacts look like.
"""

from __future__ import annotations

import csv
import io
import os
import shutil
from pathlib import Path

import pytest

from pinakes_engine import translation
from pinakes_engine.datalog.export import (
    PROBLOG_PROGRAM_NAME,
    PROLOG_PROGRAM_NAME,
    collect_facts,
)
from pinakes_engine.datalog.problog import collect_problog_facts, write_problog_program
from pinakes_engine.datalog.prolog import write_program
from pinakes_engine.datalog.souffle import SOUFFLE_PROGRAM_NAME, write_souffle_program
from pinakes_engine.schema.headers import EdgeSchema, NodeSchema
from pinakes_engine.schema.tsvio import read_rows, write_edge_rows, write_node_rows

_FIXTURES = Path(__file__).parent / "fixtures" / "parity"
_GOLDEN = _FIXTURES / "golden"

#: Set to rewrite the goldens instead of asserting against them (see the module
#: docstring). Off in CI and in a normal run, so a drift is a failure, not a silent
#: rebaseline.
_REGEN = bool(os.environ.get("PARITY_REGEN"))

#: Every golden path prefix that must exist, one per canonical conversion. Pinned so
#: a format cannot be quietly dropped from the proof while the suite still passes.
_FORMATS = (
    "tsv",
    "neo4j-import",
    "neo4j-export",
    "datalog",
)


def _dataset(root: Path) -> Path:
    """Materialise the parity fixture as a ``nodes/`` + ``edges/`` dataset."""
    (root / "nodes").mkdir(parents=True)
    (root / "edges").mkdir(parents=True)
    shutil.copy(_FIXTURES / "nodes.tsv", root / "nodes" / "nodes.tsv")
    shutil.copy(_FIXTURES / "edges.tsv", root / "edges" / "edges.tsv")
    return root


def _fixture_rows() -> tuple[list[dict[str, str | list[str]]], ...]:
    """The fixture's node and edge rows, decoded by the lossless TSV reader."""
    _, node_rows = read_rows(_FIXTURES / "nodes.tsv")
    _, edge_rows = read_rows(_FIXTURES / "edges.tsv")
    return node_rows, edge_rows


def _render(tmp_path: Path) -> dict[str, str]:
    """Render the fixture through the engine into ``{golden-relpath: body}``.

    One function produces both the assertion targets and (under ``PARITY_REGEN``)
    the checked-in files, so the goldens can never describe a different render than
    the one the tests compare against.
    """
    node_rows, edge_rows = _fixture_rows()
    graph = translation.graph_json(node_rows, edge_rows)
    rendered: dict[str, str] = {}

    tsv = translation.to_tsv(graph)
    rendered["tsv/nodes.tsv"] = tsv["nodes"]
    rendered["tsv/edges.tsv"] = tsv["edges"]

    neo4j_csv = translation.to_csv(graph)
    rendered["neo4j-import/nodes.csv"] = neo4j_csv["nodes"]
    rendered["neo4j-import/edges.csv"] = neo4j_csv["edges"]
    rendered["neo4j-import/neo4j-load-csv.cypher"] = translation.to_cypher(graph)

    export = translation.to_neo4j_export(graph)
    for label, body in export["node_files"].items():
        rendered[f"neo4j-export/nodes/{label}.tsv"] = body
    for edge_type, body in export["edge_files"].items():
        rendered[f"neo4j-export/edges/{edge_type}.tsv"] = body

    facts = collect_facts(_dataset(tmp_path / "dataset"))
    logic = translation.dataset_datalog(facts.node_files, facts.edge_files)
    rendered[f"datalog/{PROLOG_PROGRAM_NAME}"] = logic["prolog"]
    rendered[f"datalog/{PROBLOG_PROGRAM_NAME}"] = logic["problog"]
    rendered[f"datalog/{SOUFFLE_PROGRAM_NAME}"] = logic["souffle"]["program"]
    for stem, body in logic["souffle"]["facts"].items():
        rendered[f"datalog/{stem}.facts"] = body
    return rendered


def _golden(relpath: str) -> str:
    """Read a checked-in golden, failing with a regeneration hint if it is absent."""
    path = _GOLDEN / relpath
    if not path.exists():
        pytest.fail(
            f"missing parity golden {relpath}; regenerate with "
            f"PARITY_REGEN=1 uv run pytest {Path(__file__).name}"
        )
    return path.read_text(encoding="utf-8")


def test_engine_matches_the_checked_in_goldens(tmp_path: Path) -> None:
    """Claim 1: the engine renders the committed bytes, for all six formats.

    Under ``PARITY_REGEN`` this writes the goldens instead of asserting.
    """
    rendered = _render(tmp_path)
    if _REGEN:  # pragma: no cover - maintenance path, never taken in a normal run
        if _GOLDEN.exists():
            shutil.rmtree(_GOLDEN)
        for relpath, body in rendered.items():
            path = _GOLDEN / relpath
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body, encoding="utf-8")
        pytest.skip(f"regenerated {len(rendered)} parity goldens")

    for relpath, body in sorted(rendered.items()):
        assert body == _golden(relpath), relpath

    committed = {
        str(path.relative_to(_GOLDEN))
        for path in _GOLDEN.rglob("*")
        if path.is_file()
    }
    assert committed == set(rendered), "golden set drifted from the rendered set"


def test_goldens_cover_every_canonical_format() -> None:
    """Each of the six conversions has committed goldens --- none silently dropped."""
    for prefix in _FORMATS:
        assert (_GOLDEN / prefix).is_dir(), prefix
        assert any((_GOLDEN / prefix).rglob("*")), prefix
    # The Neo4j row carries both directions and both to-neo4j artifacts.
    assert (_GOLDEN / "neo4j-import" / "neo4j-load-csv.cypher").is_file()
    assert (_GOLDEN / "neo4j-import" / "nodes.csv").is_file()
    assert (_GOLDEN / "neo4j-export" / "nodes").is_dir()
    assert (_GOLDEN / "neo4j-export" / "edges").is_dir()
    for name in (PROLOG_PROGRAM_NAME, SOUFFLE_PROGRAM_NAME, PROBLOG_PROGRAM_NAME):
        assert (_GOLDEN / "datalog" / name).is_file(), name


def test_reference_tsv_writers_reproduce_the_goldens(tmp_path: Path) -> None:
    """Claim 2, canonical TSV: the pre-migration writers emit the golden bytes."""
    node_rows, edge_rows = _fixture_rows()

    write_node_rows(tmp_path / "nodes.tsv", NodeSchema.canonical(), node_rows)
    write_edge_rows(tmp_path / "edges.tsv", EdgeSchema.canonical(), edge_rows)

    assert (tmp_path / "nodes.tsv").read_text(encoding="utf-8") == _golden(
        "tsv/nodes.tsv"
    )
    assert (tmp_path / "edges.tsv").read_text(encoding="utf-8") == _golden(
        "tsv/edges.tsv"
    )


def test_reference_tsv_writers_reproduce_the_export_shards(tmp_path: Path) -> None:
    """Claim 2, from-neo4j export: each shard is what the writers used to emit.

    ``neo4j/export.py`` used to shard the Bolt cursor itself and write each shard
    with the canonical writers; it now hands the whole graph to the engine. Sharding
    the fixture the same way the engine does (nodes on their alphabetically-first
    non-anchor label, edges on ``:TYPE``) reproduces the pre-migration artifacts.
    """
    node_rows, edge_rows = _fixture_rows()

    node_shards: dict[str, list[dict[str, str | list[str]]]] = {}
    for row in node_rows:
        labels = row[":LABEL"]
        assert not isinstance(labels, str)
        node_shards.setdefault(sorted(labels)[0], []).append(row)
    edge_shards: dict[str, list[dict[str, str | list[str]]]] = {}
    for row in edge_rows:
        edge_type = row[":TYPE"]
        assert isinstance(edge_type, str)
        edge_shards.setdefault(edge_type, []).append(row)

    for label, rows in node_shards.items():
        path = tmp_path / f"node-{label}.tsv"
        write_node_rows(path, NodeSchema.canonical(), rows)
        assert path.read_text(encoding="utf-8") == _golden(
            f"neo4j-export/nodes/{label}.tsv"
        ), label
    for edge_type, rows in edge_shards.items():
        path = tmp_path / f"edge-{edge_type}.tsv"
        write_edge_rows(path, EdgeSchema.canonical(), rows)
        assert path.read_text(encoding="utf-8") == _golden(
            f"neo4j-export/edges/{edge_type}.tsv"
        ), edge_type


def test_reference_emitters_reproduce_the_logic_program_goldens(
    tmp_path: Path,
) -> None:
    """Claim 2, SWI-Prolog / Soufflé / ProbLog: programs *and* every fact shard."""
    dataset = _dataset(tmp_path / "dataset")
    out = tmp_path / "reference"
    out.mkdir()
    facts = collect_facts(dataset)

    write_program(out / PROLOG_PROGRAM_NAME, facts, ())
    write_souffle_program(out, facts, ())
    write_problog_program(
        out / PROBLOG_PROGRAM_NAME, collect_problog_facts(dataset), ()
    )

    for name in (PROLOG_PROGRAM_NAME, SOUFFLE_PROGRAM_NAME, PROBLOG_PROGRAM_NAME):
        assert (out / name).read_text(encoding="utf-8") == _golden(
            f"datalog/{name}"
        ), name

    shards = {path.name for path in out.glob("*.facts")}
    golden_shards = {path.name for path in (_GOLDEN / "datalog").glob("*.facts")}
    assert shards == golden_shards
    for name in sorted(shards):
        assert (out / name).read_text(encoding="utf-8") == _golden(
            f"datalog/{name}"
        ), name


def test_reference_load_csv_statements_reproduce_the_cypher_golden() -> None:
    """Claim 2, to-neo4j: the golden's statements are ``load_csv``'s, byte for byte.

    The engine emits one self-contained script that binds ``$file`` to each shard's
    relative path, while ``load_csv`` binds an absolute ``file://`` URL at run time
    against a live driver --- different *delivery*, but the rendered statement body
    is the format conversion, and it is identical. Every ``LOAD CSV`` block in the
    golden must be one of the two reference bodies, so an engine-side change to the
    coercion, the property map or the APOC merge shape fails here.
    """
    from pinakes_engine.neo4j.load_csv import edge_cypher, node_cypher

    script = _golden("neo4j-import/neo4j-load-csv.cypher")
    reference = {
        node_cypher(NodeSchema.canonical()),
        edge_cypher(EdgeSchema.canonical()),
    }

    blocks = [
        block.strip() for block in script.split("\n\n") if ":param file" in block
    ]
    assert len(blocks) == 5, "expected one statement per fixture shard"
    for block in blocks:
        # Each block is ``// <kind>: <path>`` + the ``:param file => '...';``
        # binding + the statement; only the statement is the format conversion.
        body = block.split("\n", 2)[2]
        assert body in reference, body[:200]


def test_neo4j_import_csv_matches_the_canonical_tsv_cells() -> None:
    """Claim 2, to-neo4j CSV: cell-for-cell the canonical TSV.

    ``to_csv`` is the one conversion with no pre-migration Python counterpart ---
    ``admin_import`` passes ``neo4j-admin`` the original tab files
    (``--delimiter='\\t'``) and pinakes-engine never rendered a CSV document. So the
    reference is the canonical TSV itself: same header, same rows, same order, same
    escaped cell contents, differing only in the delimiter and CSV quoting. Decoding
    the CSV back to cells and comparing proves the conversion adds and loses nothing.
    """
    for name in ("nodes", "edges"):
        tsv_cells = [
            line.split("\t") for line in _golden(f"tsv/{name}.tsv").split("\n") if line
        ]
        csv_cells = list(csv.reader(io.StringIO(_golden(f"neo4j-import/{name}.csv"))))
        assert csv_cells == tsv_cells, name


def test_fixture_exercises_the_lossless_escapes_and_shard_fan_out() -> None:
    """The fixture stays representative --- a neutered fixture proves nothing.

    Guards the inputs the parity claim depends on: the escape set (tab, newline,
    backslash, an escaped multi-value ``;``), a multi-label node, an empty
    multi-value cell, sparse rows, and enough label/type variety to fan out into
    several export shards.
    """
    raw = (_FIXTURES / "nodes.tsv").read_text(encoding="utf-8")
    for escape in ("\\t", "\\n", "\\\\", "\\;"):
        assert escape in raw, escape

    node_rows, edge_rows = _fixture_rows()
    labels = [row[":LABEL"] for row in node_rows]
    assert any(not isinstance(cell, str) and len(cell) > 1 for cell in labels)
    assert any(row.get("aliases") == [] for row in node_rows)
    assert any("" in row.values() for row in node_rows)
    assert len({tuple(sorted(cell)) for cell in labels}) >= 3  # type: ignore[arg-type]
    assert len({row[":TYPE"] for row in edge_rows}) >= 2


def test_round_trip_skips_are_gated_only_on_external_binaries() -> None:
    """AC-4: no round-trip test may be skipped because the *lib* is unavailable.

    The engine is a hard dependency with a no-fallback guard
    (:data:`pinakes_engine.translation._MISSING`), so "the lib is missing" must never
    become a reason to skip a parity or round-trip test --- that would let the suite
    go green on a build where nothing was actually translated. Only the genuinely
    external solvers may gate a skip.
    """
    allowed = ("swipl", "souffle", "problog")
    suite = Path(__file__).parent
    modules = [
        "test_neo4j_roundtrip.py",
        "test_neo4j_export.py",
        "test_neo4j_load_csv.py",
        "test_datalog_equivalence.py",
        "test_datalog_souffle.py",
        "test_datalog_problog.py",
        "test_translation_lib.py",
        Path(__file__).name,
    ]
    for name in modules:
        source = (suite / name).read_text(encoding="utf-8")
        for line in source.splitlines():
            stripped = line.strip()
            if "skipif" not in stripped and "importorskip" not in stripped:
                continue
            if stripped.startswith("#") or stripped.startswith('"'):
                continue
            assert "translation" not in stripped, f"{name}: {stripped}"
            assert "agora" not in stripped, f"{name}: {stripped}"
    # And the reasons that do exist name only the external solvers.
    equivalence = (suite / "test_datalog_equivalence.py").read_text(encoding="utf-8")
    assert any(binary in equivalence for binary in allowed)
