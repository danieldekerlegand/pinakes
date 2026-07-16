"""Offline MERGE double-load idempotency verifier (US-004).

:func:`verify_idempotent_load` replays the live load's MERGE semantics (nodes on
``csid``, edges on start/end/type) into an in-memory graph, loads twice, and
reports whether the second load changed the grouped counts — the offline proof
that a merged corpus loads into Neo4j idempotently, no server required.
"""

from __future__ import annotations

from pathlib import Path

from culturescrape.neo4j.merge_load import verify_idempotent_load
from culturescrape.schema.headers import EdgeSchema, NodeSchema
from culturescrape.schema.tsvio import write_edge_rows, write_node_rows

_FIXTURE = Path(__file__).parent / "fixtures" / "pinakes" / "export"


def test_committed_export_loads_idempotently() -> None:
    report = verify_idempotent_load(_FIXTURE)
    assert report.idempotent
    # Every node carries the shared Entity anchor, so its tally is the node total.
    assert report.counts.nodes_by_label["Entity"] == report.node_total
    assert report.node_total == 4
    assert report.edge_total == 1


def _write_dataset(root: Path, node_files: dict[str, list[dict]], edges: list[dict]):
    (root / "nodes").mkdir(parents=True)
    (root / "edges").mkdir(parents=True)
    for name, rows in node_files.items():
        write_node_rows(root / "nodes" / f"{name}.tsv", NodeSchema.canonical(), rows)
    write_edge_rows(root / "edges" / "edges.tsv", EdgeSchema.canonical(), edges)


def test_merge_collapses_a_shared_csid_across_files(tmp_path: Path) -> None:
    """Two files carrying the same csid MERGE to ONE node — the stitch guarantee.

    This is exactly what makes a language present in both the Wikidata dump and
    the pinakes export a single merged node rather than a duplicate.
    """
    shared = {"csid": "cs:language:q1", ":LABEL": ["Language"], "name": "Latin"}
    _write_dataset(
        tmp_path,
        node_files={
            "dump-language": [shared],
            "pinakes-language": [shared],  # same csid, different source file
            "other": [
                {"csid": "cs:deity:q2", ":LABEL": ["Concept"], "name": "Jupiter"}
            ],
        },
        edges=[
            {":START_ID": "cs:deity:q2", ":END_ID": "cs:language:q1", ":TYPE": "USES"},
            # A duplicate edge row — MERGE on (start,end,type) collapses it.
            {":START_ID": "cs:deity:q2", ":END_ID": "cs:language:q1", ":TYPE": "USES"},
        ],
    )

    report = verify_idempotent_load(tmp_path)

    assert report.idempotent
    # cs:language:q1 appears in two files but is one MERGEd node -> 2 nodes total.
    assert report.node_total == 2
    assert report.counts.nodes_by_label["Language"] == 1
    # The duplicate edge collapses on the MERGE key.
    assert report.edge_total == 1
    assert report.counts.edges_by_type["USES"] == 1
