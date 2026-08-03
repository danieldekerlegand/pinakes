"""Tests for mapping pinakes export records to canonical node/edge rows.

The pinakes adapter (``test_pinakes.py``) turns an export directory
into :class:`RawRecord`\\ s that already carry the shared canonical shape; this
module pins the *mapping* step that turns those records into canonical
:class:`Row`\\ s: the deterministic ``csid`` (QID-anchored, else anchored on the
stable ``pinakes_id`` so re-ingestion is idempotent and the id matches the
export's own ``cs:<type>:<id>``), the retained ``pinakes_id`` round-trip
alias, the canonical column mapping, and a TSV round-trip — driven over the
committed fixture export.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from pinakes_engine.acquire.categories import CategorySpec, SourceSpec
from pinakes_engine.acquire.pinakes import PinakesExportAdapter
from pinakes_engine.acquire.records import Provenance, RawRecord
from pinakes_engine.schema import (
    OVERFLOW_KEY,
    PINAKES_ID_KEY,
    MapperError,
    map_pinakes_edge,
    map_pinakes_node,
    map_pinakes_record,
    map_pinakes_records,
    pinakes_edge_schema,
    pinakes_node_schema,
    read_rows,
    write_edge_rows,
    write_node_rows,
)
from pinakes_engine.schema.pipeline import normalize_records
from pinakes_engine.schema.tsvio import Row

#: The committed fixture export (no coupling to a live filesystem path).
FIXTURE_EXPORT = Path(__file__).parent / "fixtures" / "pinakes" / "export"

_FIXED = datetime(2026, 1, 1, tzinfo=UTC)


def _fixture_records() -> list[RawRecord]:
    spec = CategorySpec(
        id="pinakes",
        label="Entity",
        description="the pinakes export",
        source=SourceSpec(type="dump", query=str(FIXTURE_EXPORT), params={}),
        dimensions=("linguistic",),
        links=(),
    )
    return list(PinakesExportAdapter(now=lambda: _FIXED).fetch(spec))


def _by_csid(rows: list[Row]) -> dict[str, Row]:
    return {row["csid"]: row for row in rows if "csid" in row}  # type: ignore[misc]


def _node(**fields: str) -> RawRecord:
    base = {":LABEL": "Language", "csid": "cs:language:aap", "name": "Arara"}
    base.update(fields)
    return RawRecord(fields=base, provenance=_provenance())


def _provenance(**overrides: object) -> Provenance:
    base: dict[str, object] = {
        "source": "pinakes",
        "source_url": "",
        "source_query": "",
        "retrieved_at": "2026-01-01T00:00:00+00:00",
        "confidence": 0.5,
    }
    base.update(overrides)
    return Provenance(**base)  # type: ignore[arg-type]


# --- identity: csid minting ------------------------------------------------


def test_alias_anchored_csid_matches_export() -> None:
    # No QID → the csid is anchored on pinakes_id and equals what the
    # export shipped in the csid:ID column (so its edges still resolve).
    row = map_pinakes_node(_node(pinakes_id="aap"))
    assert row["csid"] == "cs:language:aap"


def test_alias_anchored_csid_uses_kebab_type_from_shipped_csid() -> None:
    row = map_pinakes_node(
        _node(
            **{":LABEL": "ArchaeologicalCulture"},
            csid="cs:archaeological-culture:yamnaya",
            pinakes_id="yamnaya",
        )
    )
    assert row["csid"] == "cs:archaeological-culture:yamnaya"


def test_csid_derivation_is_idempotent() -> None:
    record = _node(pinakes_id="aap")
    first = map_pinakes_node(record)["csid"]
    second = map_pinakes_node(record)["csid"]
    assert first == second


def test_wikidata_qid_wins_over_alias() -> None:
    row = map_pinakes_node(_node(pinakes_id="aap", wikidata_qid="Q42"))
    assert row["csid"] == "cs:language:Q42"


def test_malformed_qid_falls_back_to_alias() -> None:
    row = map_pinakes_node(_node(pinakes_id="aap", wikidata_qid="not-a-qid"))
    assert row["csid"] == "cs:language:aap"


def test_type_falls_back_to_label_when_csid_absent() -> None:
    record = RawRecord(
        fields={":LABEL": "Language", "name": "Arara", "pinakes_id": "aap"},
        provenance=_provenance(),
    )
    assert map_pinakes_node(record)["csid"] == "cs:language:aap"


def test_node_without_qid_or_alias_raises() -> None:
    record = RawRecord(
        fields={":LABEL": "Language", "name": "Arara"}, provenance=_provenance()
    )
    with pytest.raises(MapperError):
        map_pinakes_node(record)


# --- alias round-trip & column mapping -------------------------------------


def test_pinakes_id_is_retained_as_alias() -> None:
    row = map_pinakes_node(_node(pinakes_id="aap"))
    assert row[PINAKES_ID_KEY] == "aap"


def test_canonical_columns_are_mapped() -> None:
    row = map_pinakes_node(
        _node(
            pinakes_id="aap",
            lang="m59",
            language_code="aap",
            script="Latin",
            description="a language",
        )
    )
    assert row[":LABEL"] == ["Language"]
    assert row["name"] == "Arara"
    assert row["language_code"] == "aap"
    assert row["script"] == "Latin"
    assert row["description"] == "a language"


def test_canonical_time_columns_are_carried_verbatim() -> None:
    row = map_pinakes_node(
        _node(pinakes_id="pie", time_start="-4500", time_end="-4000")
    )
    assert row["time_start"] == "-4500"
    assert row["time_end"] == "-4000"


def test_aliases_split_into_multi_value() -> None:
    row = map_pinakes_node(_node(pinakes_id="aap", aliases="Arara;Ugoroŋmo"))
    assert row["aliases"] == ["Arara", "Ugoroŋmo"]


def test_unknown_columns_go_to_overflow_not_lost() -> None:
    row = map_pinakes_node(_node(pinakes_id="aap", mystery="42"))
    assert OVERFLOW_KEY in row
    assert '"mystery": "42"' in str(row[OVERFLOW_KEY])


def test_shipped_csid_is_not_overflowed() -> None:
    # The csid:ID cell is consumed (re-minted), never duplicated into overflow.
    row = map_pinakes_node(_node(pinakes_id="aap"))
    assert OVERFLOW_KEY not in row


def test_provenance_is_carried() -> None:
    row = map_pinakes_node(_node(pinakes_id="aap"))
    assert row["source"] == "pinakes"
    assert row["confidence"] == "0.5"


# --- edges -----------------------------------------------------------------


def test_edge_maps_structural_and_provenance() -> None:
    record = RawRecord(
        fields={
            ":START_ID": "cs:language:aap",
            ":END_ID": "cs:language:pie",
            ":TYPE": "DESCENDS_FROM",
            "weight": "0.85",
            "time_start": "-4500",
            "pinakes_id": "aap->pie",
        },
        provenance=_provenance(confidence=0.85),
    )
    row = map_pinakes_edge(record)
    assert row[":START_ID"] == "cs:language:aap"
    assert row[":END_ID"] == "cs:language:pie"
    assert row[":TYPE"] == "DESCENDS_FROM"
    assert row["weight"] == "0.85"
    assert row["time_start"] == "-4500"
    assert row[PINAKES_ID_KEY] == "aap->pie"
    assert row["confidence"] == "0.85"
    assert "source_query" not in row  # edges carry no source_query column


def test_edge_missing_endpoint_raises() -> None:
    record = RawRecord(
        fields={
            ":START_ID": "cs:language:aap",
            ":END_ID": "",
            ":TYPE": "DESCENDS_FROM",
        },
        provenance=_provenance(),
    )
    with pytest.raises(MapperError):
        map_pinakes_edge(record)


# --- dispatch --------------------------------------------------------------


def test_record_dispatch_picks_node_vs_edge() -> None:
    node = map_pinakes_record(_node(pinakes_id="aap"))
    edge = map_pinakes_record(
        RawRecord(
            fields={
                ":START_ID": "cs:language:aap",
                ":END_ID": "cs:language:pie",
                ":TYPE": "DESCENDS_FROM",
            },
            provenance=_provenance(),
        )
    )
    assert ":LABEL" in node and "csid" in node
    assert ":TYPE" in edge and "csid" not in edge


def test_record_without_label_or_type_raises() -> None:
    record = RawRecord(fields={"name": "orphan"}, provenance=_provenance())
    with pytest.raises(MapperError):
        map_pinakes_record(record)


# --- fixture-driven end to end ---------------------------------------------


def test_fixture_export_maps_to_expected_csids() -> None:
    rows = map_pinakes_records(_fixture_records())
    nodes = _by_csid(rows)
    # csids minted here equal the ones the export shipped in the csid:ID column.
    assert "cs:language:aap" in nodes
    assert "cs:language:pie" in nodes
    assert "cs:archaeological-culture:bell-beaker" in nodes
    assert "cs:archaeological-culture:yamnaya" in nodes
    assert nodes["cs:language:aap"][PINAKES_ID_KEY] == "aap"


def test_fixture_edge_endpoints_resolve_to_mapped_nodes() -> None:
    rows = map_pinakes_records(_fixture_records())
    nodes = _by_csid(rows)
    edges = [row for row in rows if ":TYPE" in row]
    assert edges, "fixture has at least one edge"
    for edge in edges:
        assert edge[":START_ID"] in nodes
        assert edge[":END_ID"] in nodes


def test_fixture_nodes_round_trip_through_tsv(tmp_path: Path) -> None:
    rows = map_pinakes_records(_fixture_records())
    nodes = [row for row in rows if ":LABEL" in row]
    path = tmp_path / "language.tsv"
    write_node_rows(path, pinakes_node_schema(), nodes)
    _, back = read_rows(path)
    aap = next(row for row in back if row["csid"] == "cs:language:aap")
    assert aap[PINAKES_ID_KEY] == "aap"
    assert aap["language_code"] == "aap"


def test_fixture_edges_round_trip_through_tsv(tmp_path: Path) -> None:
    rows = map_pinakes_records(_fixture_records())
    edges = [row for row in rows if ":TYPE" in row]
    path = tmp_path / "descends_from.tsv"
    write_edge_rows(path, pinakes_edge_schema(), edges)
    _, back = read_rows(path)
    assert back[0][":TYPE"] == "DESCENDS_FROM"
    assert back[0][":START_ID"] == "cs:archaeological-culture:bell-beaker"


# --- normalize: dedup redirects edges off merged-away nodes -----------------


def _lingua_category() -> CategorySpec:
    """A category routed down the pinakes export normalize path."""
    return CategorySpec(
        id="pinakes-full",
        label="Entity",
        description="the live pinakes export",
        source=SourceSpec(
            type="dump", query="unused", params={"adapter": "pinakes-export"}
        ),
        dimensions=("linguistic",),
        links=(),
    )


def _lingua_record(fields: dict[str, str]) -> RawRecord:
    return RawRecord(fields=fields, provenance=_provenance())


def test_normalize_redirects_edges_off_merged_away_nodes() -> None:
    # Two Language rows name one real-world thing (same name), so dedup collapses
    # one csid; an edge that still points at the collapsed csid must be redirected
    # onto the survivor — not left dangling, which would fail schema validation
    # downstream (the live-corpus bug this guards against).
    records = [
        _lingua_record(
            {"csid": "cs:language:a", ":LABEL": "Language", "name": "Testish",
             "pinakes_id": "a"}
        ),
        _lingua_record(
            {"csid": "cs:language:b", ":LABEL": "Language", "name": "Testish",
             "pinakes_id": "b"}
        ),
        _lingua_record(
            {"csid": "cs:language:c", ":LABEL": "Language", "name": "Other",
             "pinakes_id": "c"}
        ),
        _lingua_record(
            {":START_ID": "cs:language:c", ":END_ID": "cs:language:b",
             ":TYPE": "BORROWED_FROM"}
        ),
    ]
    result = normalize_records(records, _lingua_category())

    surviving = {row["csid"] for row in result.nodes}
    assert len(result.nodes) == 2  # a and b collapsed into one survivor
    assert len(result.edges) == 1  # the edge survived (redirected, not dropped)
    edge = result.edges[0]
    assert edge[":START_ID"] in surviving
    assert edge[":END_ID"] in surviving  # was cs:language:b → now the survivor


def test_normalize_drops_edges_that_redirect_to_a_self_loop() -> None:
    # An edge between two rows that merge into ONE node says nothing once they are
    # the same node, so it is dropped rather than emitted as a self-loop.
    records = [
        _lingua_record(
            {"csid": "cs:language:a", ":LABEL": "Language", "name": "Testish",
             "pinakes_id": "a"}
        ),
        _lingua_record(
            {"csid": "cs:language:b", ":LABEL": "Language", "name": "Testish",
             "pinakes_id": "b"}
        ),
        _lingua_record(
            {":START_ID": "cs:language:a", ":END_ID": "cs:language:b",
             ":TYPE": "BORROWED_FROM"}
        ),
    ]
    result = normalize_records(records, _lingua_category())
    assert len(result.nodes) == 1
    assert result.edges == []
