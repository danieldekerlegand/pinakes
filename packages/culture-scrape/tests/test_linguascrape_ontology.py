"""LinguaScrape edges as first-class canonical edges in the linker (US-004).

The mapper (``test_linguascrape_mapper.py``) turns a LinguaScrape export edge
into a canonical edge row; this module pins the two things that make such an edge
*participate* in the shared graph:

* its ``:TYPE`` is translated to the canonical ontology vocabulary
  (:data:`LINGUASCRAPE_EDGE_TYPE_MAP`) — five tokens map to themselves, the three
  LinguaScrape-specific ones fold onto a registered canonical type, and an
  unknown token is rejected rather than passed through un-canonicalised; and
* the mapped edge, carrying its time range / confidence / provenance, flows
  through the linker :class:`~culturescrape.ontology.run` pipeline unchanged and
  is reported by :func:`linguascrape_edges_by_type` — driven over the committed
  fixture export.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from culturescrape.acquire.categories import CategorySpec, SourceSpec
from culturescrape.acquire.linguascrape import LinguaScrapeExportAdapter
from culturescrape.acquire.records import Provenance, RawRecord
from culturescrape.ontology import (
    edges_by_type_for_source,
    is_registered,
    linguascrape_edges_by_type,
    run_linkers,
    select_linkers,
)
from culturescrape.ontology.linker import Edge
from culturescrape.schema import (
    LINGUASCRAPE_EDGE_TYPE_MAP,
    MapperError,
    map_linguascrape_edge,
    map_linguascrape_records,
)
from culturescrape.schema.tsvio import Row

#: The committed fixture export (no coupling to a live filesystem path).
FIXTURE_EXPORT = Path(__file__).parent / "fixtures" / "linguascrape" / "export"

_FIXED = datetime(2026, 1, 1, tzinfo=UTC)


def _fixture_rows() -> tuple[list[Row], list[Edge]]:
    spec = CategorySpec(
        id="linguascrape",
        label="Entity",
        description="the LinguaScrape export",
        source=SourceSpec(type="dump", query=str(FIXTURE_EXPORT), params={}),
        dimensions=("linguistic",),
        links=(),
    )
    records = list(LinguaScrapeExportAdapter(now=lambda: _FIXED).fetch(spec))
    rows = map_linguascrape_records(records)
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
            source="linguascrape",
            source_url="",
            source_query="",
            retrieved_at="2026-01-01T00:00:00+00:00",
            confidence=0.7,
        ),
    )


# --- :TYPE translation to the canonical vocabulary --------------------------


def test_edge_type_map_values_are_registered() -> None:
    """Every canonical target is a real registered ontology ``:TYPE``."""
    for token, canonical in LINGUASCRAPE_EDGE_TYPE_MAP.items():
        assert is_registered(canonical), f"{token} -> {canonical} not registered"


def test_identity_tokens_pass_through() -> None:
    row = map_linguascrape_edge(_edge_record("COGNATE_WITH"))
    assert row[":TYPE"] == "COGNATE_WITH"


def test_absorbed_into_folds_onto_part_of() -> None:
    row = map_linguascrape_edge(_edge_record("ABSORBED_INTO"))
    assert row[":TYPE"] == "PART_OF"


def test_syncretized_with_folds_onto_variant_of() -> None:
    row = map_linguascrape_edge(_edge_record("SYNCRETIZED_WITH"))
    assert row[":TYPE"] == "VARIANT_OF"


def test_split_from_folds_onto_descends_from() -> None:
    row = map_linguascrape_edge(_edge_record("SPLIT_FROM"))
    assert row[":TYPE"] == "DESCENDS_FROM"


def test_unknown_edge_type_is_rejected() -> None:
    with pytest.raises(MapperError, match="unknown LinguaScrape edge :TYPE"):
        map_linguascrape_edge(_edge_record("MADE_UP_TYPE"))


def test_time_range_confidence_and_provenance_ride_through() -> None:
    record = _edge_record(
        "ABSORBED_INTO",
        weight="0.9",
        time_start="-2000",
        time_end="-1500",
        linguascrape_id="a->b",
    )
    row = map_linguascrape_edge(record)
    assert row[":TYPE"] == "PART_OF"  # canonicalised
    assert row["time_start"] == "-2000"
    assert row["time_end"] == "-1500"
    assert row["confidence"] == "0.7"
    assert row["source"] == "linguascrape"
    assert row["linguascrape_id"] == "a->b"


# --- feeding the edges through the linker pipeline --------------------------


def test_fixture_edges_load_and_link() -> None:
    nodes, edges = _fixture_rows()
    assert edges, "fixture has at least one edge"

    run = run_linkers(nodes, edges, select_linkers())

    # The LinguaScrape edge survives the pipeline as a canonical edge...
    descends = [
        edge
        for edge in run.edges
        if edge.get(":TYPE") == "DESCENDS_FROM"
        and edge.get("source") == "linguascrape"
    ]
    assert len(descends) == 1
    assert descends[0][":START_ID"] == "cs:archaeological-culture:bell-beaker"
    assert descends[0][":END_ID"] == "cs:archaeological-culture:yamnaya"
    assert descends[0]["confidence"] == "0.85"
    # ...and the pipeline ran over it without dropping any input edge.
    assert run.report.output_edges >= run.report.input_edges == len(edges)


def test_metrics_report_linguascrape_edges_by_type() -> None:
    nodes, edges = _fixture_rows()
    run = run_linkers(nodes, edges, select_linkers())
    # Counts only the LinguaScrape-origin edges, by canonical :TYPE.
    assert linguascrape_edges_by_type(run.edges) == {"DESCENDS_FROM": 1}


def test_edges_by_type_for_source_excludes_other_sources() -> None:
    edges: list[Edge] = [
        {":TYPE": "DESCENDS_FROM", "source": "linguascrape"},
        {":TYPE": "DESCENDS_FROM", "source": "linguascrape"},
        {":TYPE": "CONTEMPORARY_WITH", "source": "inferred:temporal"},
        {":TYPE": "LOCATED_IN", "source": "wikidata"},
    ]
    assert linguascrape_edges_by_type(edges) == {"DESCENDS_FROM": 2}
    assert edges_by_type_for_source(edges, "wikidata") == {"LOCATED_IN": 1}
