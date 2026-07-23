"""Byte-parity for the embedded agora translation engine (pinakes:50 US-1).

culture-scrape delegates its rules-free logic-program *rendering* to the agora
translation engine (``agora:60-translation-engine-rust``, embedded in-process via
its ``translation_py`` PyO3 bindings) instead of hand-writing the emitters. That
swap is only legitimate if it is **lossless**, so these tests pin the engine's
output against the reference Python emitters — the same fixture dataset rendered
both ways must be byte-for-byte identical, not merely "loads without error".

The reference emitters (``datalog/prolog.py``'s ``write_program``,
``datalog/souffle.py``'s ``write_souffle_program``, ``datalog/problog.py``'s
``write_problog_program``) are still the rule-bearing path, so they remain the
authoritative comparison for the engine-rendered base programs.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from culturescrape import translation
from culturescrape.datalog.export import (
    PROBLOG_PROGRAM_NAME,
    PROLOG_PROGRAM_NAME,
    Engine,
    collect_facts,
    export_dataset,
)
from culturescrape.datalog.problog import collect_problog_facts, write_problog_program
from culturescrape.datalog.prolog import write_program
from culturescrape.datalog.souffle import SOUFFLE_PROGRAM_NAME, write_souffle_program
from culturescrape.schema.headers import EdgeSchema, NodeSchema
from culturescrape.schema.tsvio import read_rows, write_edge_rows, write_node_rows

_FIXTURES = Path(__file__).parent / "fixtures" / "datalog"


def _dataset(root: Path) -> Path:
    """Materialise the shared datalog fixture as a ``nodes/``+``edges/`` dataset.

    The fixture is rewritten through the canonical TSV writers rather than copied,
    so the dataset carries the canonical sort order (``csid`` for nodes;
    ``:START_ID, :END_ID, :TYPE`` for edges) every corpus the pipeline builds
    already has. That matters for parity: the engine canonicalises row order while
    the reference projector preserves file order, so the two agree exactly on a
    canonically-written dataset — see
    :func:`test_engine_canonicalises_row_order`.
    """
    (root / "nodes").mkdir(parents=True)
    (root / "edges").mkdir(parents=True)
    node_columns, node_rows = read_rows(_FIXTURES / "nodes.tsv")
    edge_columns, edge_rows = read_rows(_FIXTURES / "edges.tsv")
    write_node_rows(root / "nodes" / "nodes.tsv", NodeSchema(node_columns), node_rows)
    write_edge_rows(root / "edges" / "edges.tsv", EdgeSchema(edge_columns), edge_rows)
    return root


def _reference(dataset: Path, out: Path) -> dict[str, str]:
    """Render the fixture with the reference Python emitters (no rules).

    Returns the program bodies keyed by filename, plus every per-relation
    ``.facts`` shard, exactly as the streaming writers put them on disk.
    """
    facts = collect_facts(dataset)
    out.mkdir(parents=True, exist_ok=True)
    write_program(out / PROLOG_PROGRAM_NAME, facts, ())
    write_souffle_program(out, facts, ())
    write_problog_program(
        out / PROBLOG_PROGRAM_NAME, collect_problog_facts(dataset), ()
    )
    rendered = {
        path.name: path.read_text(encoding="utf-8")
        for path in sorted(out.glob("*.facts"))
    }
    for name in (PROLOG_PROGRAM_NAME, SOUFFLE_PROGRAM_NAME, PROBLOG_PROGRAM_NAME):
        rendered[name] = (out / name).read_text(encoding="utf-8")
    return rendered


def test_engine_renders_the_reference_bytes(tmp_path: Path) -> None:
    """The engine's programs are byte-identical to the reference emitters'."""
    dataset = _dataset(tmp_path / "data")
    reference = _reference(dataset, tmp_path / "reference")
    facts = collect_facts(dataset)

    engine = translation.dataset_datalog(facts.node_files, facts.edge_files)

    assert engine["prolog"] == reference[PROLOG_PROGRAM_NAME]
    assert engine["problog"] == reference[PROBLOG_PROGRAM_NAME]
    assert engine["souffle"]["program"] == reference[SOUFFLE_PROGRAM_NAME]


def test_engine_renders_the_reference_fact_shards(tmp_path: Path) -> None:
    """Every Soufflé ``.facts`` shard matches the reference, name for name."""
    dataset = _dataset(tmp_path / "data")
    reference = _reference(dataset, tmp_path / "reference")
    facts = collect_facts(dataset)

    shards = translation.dataset_datalog(facts.node_files, facts.edge_files)[
        "souffle"
    ]["facts"]

    expected = {
        name: body for name, body in reference.items() if name.endswith(".facts")
    }
    assert {f"{stem}.facts" for stem in shards} == set(expected)
    for stem, body in shards.items():
        assert body == expected[f"{stem}.facts"], stem


def test_engine_fact_count_matches_the_reference(tmp_path: Path) -> None:
    """``fact_count`` is the projected-fact count the reference emitters report."""
    dataset = _dataset(tmp_path / "data")
    facts = collect_facts(dataset)
    expected = write_program(tmp_path / "ref.pl", facts, ())

    engine = translation.dataset_datalog(facts.node_files, facts.edge_files)

    assert engine["fact_count"] == expected


def test_export_dataset_writes_the_canonical_filenames(tmp_path: Path) -> None:
    """The engine-backed export keeps ``to-datalog``'s output contract."""
    dataset = _dataset(tmp_path / "data")
    out = tmp_path / "out"

    result = export_dataset(
        dataset, out, (Engine.SWIPL, Engine.SOUFFLE, Engine.PROBLOG)
    )

    assert (out / PROLOG_PROGRAM_NAME).exists()
    assert (out / SOUFFLE_PROGRAM_NAME).exists()
    assert (out / PROBLOG_PROGRAM_NAME).exists()
    assert sorted(out.glob("*.facts"))
    assert result.fact_count > 0
    assert result.programs[Engine.SWIPL] == out / PROLOG_PROGRAM_NAME


def test_engine_canonicalises_row_order(tmp_path: Path) -> None:
    """The engine sorts rows canonically; the reference preserves file order.

    This is the one behavioural difference between the two renderers, and it is
    benign: every dataset the pipeline writes goes through
    :func:`~culturescrape.schema.tsvio.write_node_rows` /
    :func:`~culturescrape.schema.tsvio.write_edge_rows`, which sort into exactly
    the order the engine imposes — so on a real corpus the two agree byte for
    byte (the parity tests above). Only a hand-authored, unsorted dataset can tell
    them apart, and there the engine's output is the canonical one. Pinned here so
    the normalisation is a recorded property, not a surprise.
    """
    raw = tmp_path / "raw"
    (raw / "nodes").mkdir(parents=True)
    (raw / "edges").mkdir(parents=True)
    shutil.copy(_FIXTURES / "nodes.tsv", raw / "nodes" / "nodes.tsv")
    shutil.copy(_FIXTURES / "edges.tsv", raw / "edges" / "edges.tsv")
    facts = collect_facts(raw)

    shards = translation.dataset_datalog(facts.node_files, facts.edge_files)[
        "souffle"
    ]["facts"]

    csids = [line.split("\t")[0] for line in shards["node"].splitlines()]
    assert csids == sorted(csids)


def test_missing_engine_names_the_upstream_task() -> None:
    """An absent engine fails loudly, naming agora:60 — never a silent fallback."""
    message = translation._MISSING
    assert "agora:60-translation-engine-rust" in message
    assert "translation_py" in message
    assert "no fallback" in message.lower()
