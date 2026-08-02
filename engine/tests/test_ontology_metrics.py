"""Tests for graph connectivity metrics.

A small, hand-checked fixture graph (six nodes in three components, three edges
across two dimensions) exercises every metric, and the same rows are round-tripped
through real ``nodes/`` / ``edges/`` TSV files to cover the dataset reader and the
``pinakes_engine metrics`` CLI command.
"""

import json
from pathlib import Path

import pytest

from pinakes_engine.cli import main
from pinakes_engine.ontology import (
    UNKNOWN_DIMENSION,
    compute_metrics,
    metrics_for_dataset,
    read_dataset,
    render_summary,
    to_json,
)
from pinakes_engine.schema.headers import EdgeSchema, NodeSchema
from pinakes_engine.schema.tsvio import Row, write_edge_rows, write_node_rows

# Six nodes in three components: {a,b,c} via two geographic edges, {d,e} via one
# temporal edge, and the isolated {f}.
_NODE_CSIDS = ("a", "b", "c", "d", "e", "f")
_EDGES = (
    ("a", "b", "LOCATED_IN"),
    ("b", "c", "LOCATED_IN"),
    ("d", "e", "CONTEMPORARY_WITH"),
)


def _node(csid: str) -> Row:
    return {
        "csid": csid,
        ":LABEL": ["entity"],
        "name": csid.upper(),
        "source": "test",
        "source_url": "https://example.org",
        "retrieved_at": "2026-06-16T00:00:00+00:00",
        "confidence": "1.0",
    }


def _edge(start: str, end: str, rel_type: str) -> Row:
    return {
        ":START_ID": start,
        ":END_ID": end,
        ":TYPE": rel_type,
        "source": "test",
        "source_url": "https://example.org",
        "retrieved_at": "2026-06-16T00:00:00+00:00",
        "confidence": "1.0",
    }


def _fixture() -> tuple[list[Row], list[Row]]:
    nodes = [_node(c) for c in _NODE_CSIDS]
    edges = [_edge(*e) for e in _EDGES]
    return nodes, edges


# --- the counts -------------------------------------------------------------


def test_node_and_edge_counts() -> None:
    metrics = compute_metrics(*_fixture())
    assert metrics.node_count == 6
    assert metrics.edge_count == 3
    assert metrics.edges_per_node == 0.5


def test_empty_graph_has_zero_density() -> None:
    metrics = compute_metrics([], [])
    assert metrics.node_count == 0
    assert metrics.edge_count == 0
    assert metrics.edges_per_node == 0.0
    assert metrics.component_count == 0
    assert metrics.largest_component_size == 0
    assert metrics.largest_component_fraction == 0.0


# --- connected components ---------------------------------------------------


def test_component_count_and_largest_fraction() -> None:
    metrics = compute_metrics(*_fixture())
    assert metrics.component_count == 3
    assert metrics.largest_component_size == 3
    assert metrics.largest_component_fraction == 0.5


def test_fully_linked_graph_is_one_component() -> None:
    nodes = [_node(c) for c in _NODE_CSIDS]
    edges = [
        _edge(a, b, "CONTEMPORARY_WITH")
        for a, b in zip(_NODE_CSIDS[:-1], _NODE_CSIDS[1:], strict=True)
    ]
    metrics = compute_metrics(nodes, edges)
    assert metrics.component_count == 1
    assert metrics.largest_component_fraction == 1.0


def test_direction_is_ignored_for_components() -> None:
    # b->a and b->c still merge {a,b,c} despite the reversed direction.
    nodes = [_node(c) for c in ("a", "b", "c")]
    edges = [_edge("b", "a", "LOCATED_IN"), _edge("b", "c", "LOCATED_IN")]
    metrics = compute_metrics(nodes, edges)
    assert metrics.component_count == 1


def test_edge_to_unknown_node_does_not_create_a_phantom() -> None:
    nodes = [_node("a")]
    edges = [_edge("a", "ghost", "LOCATED_IN")]
    metrics = compute_metrics(nodes, edges)
    assert metrics.node_count == 1
    assert metrics.component_count == 1
    assert metrics.edge_count == 1


# --- breakdowns -------------------------------------------------------------


def test_edges_by_dimension() -> None:
    metrics = compute_metrics(*_fixture())
    assert metrics.edges_by_dimension == {"geographic": 2, "temporal": 1}


def test_edges_by_type() -> None:
    metrics = compute_metrics(*_fixture())
    assert metrics.edges_by_type == {"CONTEMPORARY_WITH": 1, "LOCATED_IN": 2}


def test_unregistered_type_buckets_under_unknown() -> None:
    nodes = [_node("a"), _node("b")]
    edges = [_edge("a", "b", "MADE_UP_TYPE")]
    metrics = compute_metrics(nodes, edges)
    assert metrics.edges_by_dimension == {UNKNOWN_DIMENSION: 1}
    assert metrics.edges_by_type == {"MADE_UP_TYPE": 1}


# --- reading a dataset directory --------------------------------------------


def test_read_dataset_round_trips_through_tsv(tmp_path: Path) -> None:
    nodes, edges = _fixture()
    write_node_rows(tmp_path / "nodes" / "entity.tsv", NodeSchema.canonical(), nodes)
    write_edge_rows(tmp_path / "edges" / "links.tsv", EdgeSchema.canonical(), edges)

    read_nodes, read_edges = read_dataset(tmp_path)
    assert len(read_nodes) == 6
    assert len(read_edges) == 3

    metrics = metrics_for_dataset(tmp_path)
    assert metrics.component_count == 3
    assert metrics.edges_by_type == {"CONTEMPORARY_WITH": 1, "LOCATED_IN": 2}


# --- serialization ----------------------------------------------------------


def test_to_json_is_parseable_and_complete() -> None:
    metrics = compute_metrics(*_fixture())
    payload = json.loads(to_json(metrics))
    assert payload["node_count"] == 6
    assert payload["edge_count"] == 3
    assert payload["component_count"] == 3
    assert payload["largest_component_fraction"] == 0.5
    assert payload["edges_by_dimension"] == {"geographic": 2, "temporal": 1}


def test_render_summary_mentions_the_headline_numbers() -> None:
    summary = render_summary(compute_metrics(*_fixture()))
    assert "nodes: 6" in summary
    assert "edges: 3" in summary
    assert "components: 3" in summary
    assert "geographic=2" in summary


# --- the CLI ----------------------------------------------------------------


def test_metrics_cli_writes_json_and_prints_summary(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    nodes, edges = _fixture()
    write_node_rows(tmp_path / "nodes" / "entity.tsv", NodeSchema.canonical(), nodes)
    write_edge_rows(tmp_path / "edges" / "links.tsv", EdgeSchema.canonical(), edges)
    out = tmp_path / "metrics.json"

    code = main(["metrics", str(tmp_path), "--out", str(out)])
    assert code == 0

    payload = json.loads(out.read_text(encoding="utf-8"))
    assert payload["node_count"] == 6
    assert payload["component_count"] == 3

    printed = capsys.readouterr().out
    assert "nodes: 6" in printed
    assert str(out) in printed


def test_metrics_cli_rejects_a_missing_directory(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code = main(["metrics", str(tmp_path / "nope")])
    assert code == 2
    assert "not a directory" in capsys.readouterr().err
