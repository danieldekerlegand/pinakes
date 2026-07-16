"""Pinakes edges as first-class canonical edges in the linker (US-004).

The mapper (``test_pinakes_mapper.py``) turns a Pinakes export edge
into a canonical edge row; this module pins the two things that make such an edge
*participate* in the shared graph:

* its ``:TYPE`` is translated to the canonical ontology vocabulary
  (:data:`PINAKES_EDGE_TYPE_MAP`) — five tokens map to themselves, the three
  Pinakes-specific ones fold onto a registered canonical type, and an
  unknown token is rejected rather than passed through un-canonicalised; and
* the mapped edge, carrying its time range / confidence / provenance, flows
  through the linker :class:`~culturescrape.ontology.run` pipeline unchanged and
  is reported by :func:`pinakes_edges_by_type` — driven over the committed
  fixture export.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from culturescrape.acquire.categories import CategorySpec, SourceSpec
from culturescrape.acquire.pinakes import PinakesExportAdapter
from culturescrape.acquire.records import Provenance, RawRecord
from culturescrape.ontology import (
    edges_by_type_for_source,
    is_registered,
    pinakes_edges_by_type,
    run_linkers,
    select_linkers,
)
from culturescrape.ontology.linker import Edge
from culturescrape.schema import (
    PINAKES_EDGE_TYPE_MAP,
    MapperError,
    map_pinakes_edge,
    map_pinakes_records,
)
from culturescrape.schema.tsvio import Row

#: The committed fixture export (no coupling to a live filesystem path).
FIXTURE_EXPORT = Path(__file__).parent / "fixtures" / "pinakes" / "export"

_FIXED = datetime(2026, 1, 1, tzinfo=UTC)


def _fixture_rows() -> tuple[list[Row], list[Edge]]:
    spec = CategorySpec(
        id="pinakes",
        label="Entity",
        description="the Pinakes export",
        source=SourceSpec(type="dump", query=str(FIXTURE_EXPORT), params={}),
        dimensions=("linguistic",),
        links=(),
    )
    records = list(PinakesExportAdapter(now=lambda: _FIXED).fetch(spec))
    rows = map_pinakes_records(records)
    nodes = [row for row in rows if ":LABEL" in row]
    edges = [row for row in rows if ":TYPE" in row]
    return nodes, edges


def _edge_record(rel_type: str, **fields: str) -> RawRecord:
    base = {
        ":START_ID": "cs:culture:a",
        ":END_ID": "cs:culture:b",
        ":TYPE": rel_type,
    }
    base.update(fields)
    return RawRecord(
        fields=base,
        provenance=Provenance(
            source="pinakes",
            source_url="",
            source_query="",
            retrieved_at="2026-01-01T00:00:00+00:00",
            confidence=0.7,
        ),
    )


# --- :TYPE translation to the canonical vocabulary --------------------------


def test_edge_type_map_values_are_registered() -> None:
    """Every canonical target is a real registered ontology ``:TYPE``."""
    for token, canonical in PINAKES_EDGE_TYPE_MAP.items():
        assert is_registered(canonical), f"{token} -> {canonical} not registered"


def test_identity_tokens_pass_through() -> None:
    row = map_pinakes_edge(_edge_record("COGNATE_WITH"))
    assert row[":TYPE"] == "COGNATE_WITH"


def test_absorbed_into_folds_onto_part_of() -> None:
    row = map_pinakes_edge(_edge_record("ABSORBED_INTO"))
    assert row[":TYPE"] == "PART_OF"


def test_syncretized_with_folds_onto_variant_of() -> None:
    row = map_pinakes_edge(_edge_record("SYNCRETIZED_WITH"))
    assert row[":TYPE"] == "VARIANT_OF"


def test_split_from_folds_onto_descends_from() -> None:
    row = map_pinakes_edge(_edge_record("SPLIT_FROM"))
    assert row[":TYPE"] == "DESCENDS_FROM"


def test_unknown_edge_type_is_rejected() -> None:
    with pytest.raises(MapperError, match="unknown Pinakes edge :TYPE"):
        map_pinakes_edge(_edge_record("MADE_UP_TYPE"))


def test_time_range_confidence_and_provenance_ride_through() -> None:
    record = _edge_record(
        "ABSORBED_INTO",
        weight="0.9",
        time_start="-2000",
        time_end="-1500",
        pinakes_id="a->b",
    )
    row = map_pinakes_edge(record)
    assert row[":TYPE"] == "PART_OF"  # canonicalised
    assert row["time_start"] == "-2000"
    assert row["time_end"] == "-1500"
    assert row["confidence"] == "0.7"
    assert row["source"] == "pinakes"
    assert row["pinakes_id"] == "a->b"


# --- feeding the edges through the linker pipeline --------------------------


def test_fixture_edges_load_and_link() -> None:
    nodes, edges = _fixture_rows()
    assert edges, "fixture has at least one edge"

    run = run_linkers(nodes, edges, select_linkers())

    # The Pinakes edge survives the pipeline as a canonical edge...
    descends = [
        edge
        for edge in run.edges
        if edge.get(":TYPE") == "DESCENDS_FROM"
        and edge.get("source") == "pinakes"
    ]
    assert len(descends) == 1
    assert descends[0][":START_ID"] == "cs:archaeological-culture:bell-beaker"
    assert descends[0][":END_ID"] == "cs:archaeological-culture:yamnaya"
    assert descends[0]["confidence"] == "0.85"
    # ...and the pipeline ran over it without dropping any input edge.
    assert run.report.output_edges >= run.report.input_edges == len(edges)


def test_metrics_report_pinakes_edges_by_type() -> None:
    nodes, edges = _fixture_rows()
    run = run_linkers(nodes, edges, select_linkers())
    # Counts only the Pinakes-origin edges, by canonical :TYPE.
    assert pinakes_edges_by_type(run.edges) == {"DESCENDS_FROM": 1}


def test_edges_by_type_for_source_excludes_other_sources() -> None:
    edges: list[Edge] = [
        {":TYPE": "DESCENDS_FROM", "source": "pinakes"},
        {":TYPE": "DESCENDS_FROM", "source": "pinakes"},
        {":TYPE": "CONTEMPORARY_WITH", "source": "inferred:temporal"},
        {":TYPE": "LOCATED_IN", "source": "wikidata"},
    ]
    assert pinakes_edges_by_type(edges) == {"DESCENDS_FROM": 2}
    assert edges_by_type_for_source(edges, "wikidata") == {"LOCATED_IN": 1}
