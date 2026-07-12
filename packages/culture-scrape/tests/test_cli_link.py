"""Tests for the ``culturescrape link`` command and its orchestration."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from culturescrape import cli
from culturescrape.ontology import (
    DEFAULT_REGISTRY,
    Dimension,
    run_linkers,
    select_linkers,
)
from culturescrape.schema.mapper import node_schema
from culturescrape.schema.tsvio import Row, write_node_rows

_PROVENANCE: dict[str, str] = {
    "source": "wikidata",
    "source_url": "https://www.wikidata.org/wiki/",
    "retrieved_at": "2026-06-16T00:00:00+00:00",
    "confidence": "0.95",
}


def _dish(csid: str, name: str, qid: str, **extra: str) -> Row:
    return {
        "csid": csid,
        ":LABEL": ["Dish"],
        "name": name,
        "wikidata_qid": qid,
        "place_qid": "Q100",
        "period": "Colonial",
        **_PROVENANCE,
        **extra,
    }


def _linkable_nodes() -> list[Row]:
    """Nodes that exercise every dimension's inference at once."""
    return [
        # Two dishes in the same place with overlapping spans; the second derives
        # from the first (genetic) and shares its period (temporal).
        _dish(
            "cs:dish:Q1",
            "Ceviche",
            "Q1",
            time_start="1500",
            time_end="1600",
        ),
        _dish(
            "cs:dish:Q2",
            "Tiradito",
            "Q2",
            time_start="1550",
            time_end="1650",
            derived_from_qid="Q1",
        ),
        # A language with a parent (linguistic) spoken in the shared place.
        {
            "csid": "cs:language:Q5",
            ":LABEL": ["Language"],
            "name": "Spanish",
            "wikidata_qid": "Q5",
            "language_code": "spa",
            "parent_qid": "Q6",
            "place_qid": "Q100",
            **_PROVENANCE,
        },
    ]


def _write_dataset(directory: Path) -> None:
    write_node_rows(
        directory / "nodes" / "entity.tsv", node_schema(), _linkable_nodes()
    )


def test_link_increases_edges_and_validates(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = tmp_path / "canonical"
    out = tmp_path / "linked"
    _write_dataset(source)

    exit_code = cli.main(
        [
            "link",
            str(source),
            "--dimensions",
            "temporal,geographic,linguistic,genetic",
            "--out",
            str(out),
        ]
    )

    assert exit_code == 0
    captured = capsys.readouterr().out
    assert "0 -> " in captured  # input had no edges; linking added some

    # Augmented edge files exist for inferences the canonical schema can drive:
    # geographic (place_qid), temporal (period → PART_OF_PERIOD), linguistic
    # (SPOKEN_IN). Pairwise CONTEMPORARY_WITH/PRECEDES/FOLLOWS are no longer
    # materialised (T-SR-US-001) — they are derived on demand by the Datalog
    # rules over time_start/time_end — so no contemporary-with.tsv is written.
    assert (out / "edges" / "located-in.tsv").is_file()
    assert not (out / "edges" / "contemporary-with.tsv").exists()
    assert (out / "edges" / "part-of-period.tsv").is_file()
    assert (out / "edges" / "spoken-in.tsv").is_file()

    # The created place / period nodes were written, so the whole augmented
    # directory passes schema validation.
    assert (out / "nodes" / "place.tsv").is_file()
    assert (out / "nodes" / "period.tsv").is_file()
    assert cli.main(["validate", str(out)]) == 0

    metrics = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    assert metrics["edge_count"] > 0
    assert set(metrics["edges_by_dimension"]) >= {
        "geographic",
        "temporal",
    }


def test_link_only_selected_dimension_runs(tmp_path: Path) -> None:
    source = tmp_path / "canonical"
    out = tmp_path / "linked"
    _write_dataset(source)

    assert cli.main(
        ["link", str(source), "--dimensions", "geographic", "--out", str(out)]
    ) == 0

    # Only the geographic linker ran: its LOCATED_IN edge is present, but the
    # temporal linker's PART_OF_PERIOD is not.
    assert (out / "edges" / "located-in.tsv").is_file()
    assert not (out / "edges" / "part-of-period.tsv").exists()


def test_link_unknown_dimension_errors(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = tmp_path / "canonical"
    _write_dataset(source)
    exit_code = cli.main(
        [
            "link",
            str(source),
            "--dimensions",
            "astrological",
            "--out",
            str(tmp_path / "o"),
        ]
    )
    assert exit_code == 2
    assert "unknown dimension" in capsys.readouterr().err


def test_link_missing_directory_errors(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert cli.main(["link", str(tmp_path / "nope"), "--out", str(tmp_path / "o")]) == 2
    assert "not a directory" in capsys.readouterr().err


def test_link_empty_dataset_errors(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = tmp_path / "empty"
    source.mkdir()
    assert cli.main(["link", str(source), "--out", str(tmp_path / "o")]) == 2
    assert "no node TSV" in capsys.readouterr().err


def test_run_linkers_merges_created_and_updated_nodes() -> None:
    linkers = select_linkers(
        [Dimension.GEOGRAPHIC, Dimension.GENETIC], DEFAULT_REGISTRY
    )
    run = run_linkers(_linkable_nodes(), [], linkers)

    # Geographic minted a place node (new csid) and genetic rewrote the deriving
    # dish in place (same csid -> replacement, not a duplicate).
    csids = [node["csid"] for node in run.nodes]
    assert len(csids) == len(set(csids)), "no duplicate csids after merge"
    assert run.report.created_nodes >= 1
    assert run.report.inferred_edges == len(run.edges)

    derived = next(n for n in run.nodes if n["csid"] == "cs:dish:Q2")
    assert derived["derived_from_csid"] == "cs:dish:Q1"


def test_run_linkers_does_not_mutate_inputs() -> None:
    nodes = _linkable_nodes()
    before = [dict(node) for node in nodes]
    run_linkers(nodes, [], select_linkers([Dimension.GENETIC], DEFAULT_REGISTRY))
    assert nodes == before
