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


def test_neo4j_export_renders_the_reference_tsv_bytes(tmp_path: Path) -> None:
    """``to_neo4j_export`` equals the canonical TSV writers, shard for shard.

    ``neo4j/export.py`` used to shard the cursor's rows itself and write each
    shard with :func:`~culturescrape.schema.tsvio.write_node_rows` /
    :func:`~culturescrape.schema.tsvio.write_edge_rows`; it now hands the whole
    canonical graph to the engine. Those writers are still the reference
    implementation, so rendering the same rows both ways is the pre- vs
    post-migration comparison — and it must be bytes, not shape.
    """
    dataset = _dataset(tmp_path / "dataset")
    _, node_rows = read_rows(dataset / "nodes" / "nodes.tsv")
    _, edge_rows = read_rows(dataset / "edges" / "edges.tsv")
    # ``neo4j/export.py`` sorts each node's labels before handing them over (its
    # ``_node_row`` drops the Entity anchor and sorts the rest), so the production
    # path never feeds an unsorted ``:LABEL`` cell. Match it here — an unsorted
    # cell is the one input the two renderers disagree on, pinned separately by
    # :func:`test_engine_canonicalises_the_label_cell`.
    for row in node_rows:
        labels = row[":LABEL"]
        assert not isinstance(labels, str)
        row[":LABEL"] = sorted(labels)

    rendered = translation.to_neo4j_export(translation.graph_json(node_rows, edge_rows))
    assert rendered["node_count"] == len(node_rows)
    assert rendered["edge_count"] == len(edge_rows)

    # The engine shards nodes on their primary (alphabetically first, non-Entity)
    # label and edges on ``:TYPE`` — reproduce that grouping to drive the writers.
    reference = tmp_path / "reference"
    reference.mkdir()
    node_shards: dict[str, list[dict[str, str | list[str]]]] = {}
    for row in node_rows:
        labels = row[":LABEL"]
        assert not isinstance(labels, str)
        node_shards.setdefault(labels[0], []).append(row)
    edge_shards: dict[str, list[dict[str, str | list[str]]]] = {}
    for row in edge_rows:
        edge_type = row[":TYPE"]
        assert isinstance(edge_type, str)
        edge_shards.setdefault(edge_type, []).append(row)

    assert set(rendered["node_files"]) == set(node_shards)
    assert set(rendered["edge_files"]) == set(edge_shards)

    for label, rows in node_shards.items():
        path = reference / f"{label}.tsv"
        write_node_rows(path, NodeSchema.canonical(), rows)
        assert rendered["node_files"][label] == path.read_text(encoding="utf-8")
    for edge_type, rows in edge_shards.items():
        path = reference / f"{edge_type}.tsv"
        write_edge_rows(path, EdgeSchema.canonical(), rows)
        assert rendered["edge_files"][edge_type] == path.read_text(encoding="utf-8")


def test_engine_canonicalises_the_label_cell(tmp_path: Path) -> None:
    """The engine sorts a node's ``:LABEL`` cell; the TSV writer preserves it.

    The second behavioural difference between the two renderers, and benign for
    the same reason as the row order: ``neo4j/export.py`` sorts the labels it
    reads off the cursor, so the delegated path only ever hands the engine an
    already-sorted cell. A hand-authored file can carry an unsorted one, and
    there the engine's output is the canonical one. Recorded rather than hidden.
    """
    row: dict[str, str | list[str]] = {
        "csid": "cs:dish:Q42",
        ":LABEL": ["Dish", "CulturalArtifact"],
        "name": "Ceviche",
    }
    rendered = translation.to_neo4j_export(translation.graph_json([row], []))

    # Sharded on the sorted-first label, and the cell itself comes back sorted.
    assert set(rendered["node_files"]) == {"CulturalArtifact"}
    shard = rendered["node_files"]["CulturalArtifact"]
    assert shard.splitlines()[1].split("\t")[1] == "CulturalArtifact;Dish"

    reference = tmp_path / "Dish.tsv"
    write_node_rows(reference, NodeSchema.canonical(), [row])
    assert reference.read_text(encoding="utf-8").splitlines()[1].split("\t")[1] == (
        "Dish;CulturalArtifact"
    )


def test_missing_engine_names_the_upstream_task() -> None:
    """An absent engine fails loudly, naming agora:60 — never a silent fallback."""
    message = translation._MISSING
    assert "agora:60-translation-engine-rust" in message
    assert "translation_py" in message
    assert "no fallback" in message.lower()
