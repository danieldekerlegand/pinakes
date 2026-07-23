"""Tests for the temporal linker.

Since T-SR-US-001 the linker mints only ``PART_OF_PERIOD`` (and the deterministic
period nodes it links to). The pairwise ``CONTEMPORARY_WITH`` / ``PRECEDES`` /
``FOLLOWS`` edges it used to materialise are gone — those relations are now derived
on demand by the arithmetic Datalog rules over ``time_start`` / ``time_end`` (see
``tests/test_datalog_rules.py`` / ``tests/test_datalog_materialize.py``). So these
tests assert period minting is correct *and* that dated spans no longer emit edges.
"""

import copy

import pytest

from culturescrape.ontology import (
    DEFAULT_REGISTRY,
    PERIOD_LABEL,
    Dimension,
    TemporalLinker,
)
from culturescrape.schema.ids import mint_csid

Row = dict[str, str | list[str]]


def _edge_index(edges: list[Row]) -> dict[tuple[str, str, str], Row]:
    return {
        (str(e[":START_ID"]), str(e[":END_ID"]), str(e[":TYPE"])): e for e in edges
    }


def _node(csid: str, **cells: str | list[str]) -> Row:
    row: Row = {"csid": csid, ":LABEL": ["Dish"]}
    row.update(cells)
    return row


# --- dated spans no longer materialise pairwise temporal edges --------------


def test_overlapping_spans_emit_no_edges() -> None:
    # Two overlapping dated entities used to yield CONTEMPORARY_WITH; now nothing
    # is emitted — the overlap is answered by the contemporary/2 rule at query time.
    nodes = [
        _node("cs:dish:a", time_start="1500", time_end="1600"),
        _node("cs:dish:b", time_start="1550", time_end="1650"),
    ]
    result = TemporalLinker().link_temporal(nodes, [])
    assert result.edges == []


def test_disjoint_spans_emit_no_edges() -> None:
    # Disjoint spans used to yield PRECEDES/FOLLOWS; now nothing is emitted.
    nodes = [
        _node("cs:dish:early", time_start="1400", time_end="1450"),
        _node("cs:dish:late", time_start="1500", time_end="1550"),
    ]
    result = TemporalLinker().link_temporal(nodes, [])
    assert result.edges == []


def test_spans_without_periods_produce_nothing() -> None:
    nodes = [
        _node("cs:dish:a", time_start="1500", time_end="1600"),
        _node("cs:dish:b"),  # no temporal info at all
    ]
    result = TemporalLinker().link_temporal(nodes, [])
    assert result.edges == []
    assert result.periods == []


# --- PART_OF_PERIOD minting (the linker's remaining job) ---------------------


def test_part_of_period_creates_period_node_idempotently() -> None:
    nodes = [
        _node("cs:dish:a", period="Baroque"),
        _node("cs:dish:b", period="Baroque"),
    ]
    result = TemporalLinker().link_temporal(nodes, [])

    period_csid = mint_csid("period", name="Baroque")
    # One period node despite two entities referencing it.
    assert [p["csid"] for p in result.periods] == [period_csid]
    created = result.periods[0]
    assert created[":LABEL"] == [PERIOD_LABEL]
    assert created["name"] == "Baroque"

    edges = _edge_index(result.edges)
    assert ("cs:dish:a", period_csid, "PART_OF_PERIOD") in edges
    assert ("cs:dish:b", period_csid, "PART_OF_PERIOD") in edges
    # PART_OF_PERIOD is the only relation the linker emits now.
    assert {str(e[":TYPE"]) for e in result.edges} == {"PART_OF_PERIOD"}


def test_part_of_period_confidence_is_configurable() -> None:
    nodes = [_node("cs:dish:a", period="Baroque")]
    result = TemporalLinker(period_confidence=0.5).link_temporal(nodes, [])
    edge = result.edges[0]
    assert float(str(edge["confidence"])) == pytest.approx(0.5)


def test_part_of_period_reuses_existing_period_node() -> None:
    period_csid = mint_csid("period", name="Inca")
    nodes: list[Row] = [
        _node("cs:dish:a", period="Inca"),
        {"csid": period_csid, ":LABEL": [PERIOD_LABEL], "name": "Inca"},
    ]
    result = TemporalLinker().link_temporal(nodes, [])

    # The period already exists, so none is created, but the edge is still made.
    assert result.periods == []
    assert ("cs:dish:a", period_csid, "PART_OF_PERIOD") in _edge_index(result.edges)


def test_does_not_duplicate_existing_period_edge() -> None:
    period_csid = mint_csid("period", name="Baroque")
    existing: Row = {
        ":START_ID": "cs:dish:a",
        ":END_ID": period_csid,
        ":TYPE": "PART_OF_PERIOD",
    }
    nodes = [_node("cs:dish:a", period="Baroque")]
    result = TemporalLinker().link_temporal(nodes, [existing])

    # The period node is still minted, but the edge is not re-emitted.
    assert [p["csid"] for p in result.periods] == [period_csid]
    assert result.edges == []


def test_link_returns_edges_only_and_never_mutates_inputs() -> None:
    nodes = [
        _node("cs:dish:a", time_start="1500", time_end="1600", period="Baroque"),
        _node("cs:dish:b", time_start="1550", time_end="1650"),
    ]
    edges: list[Row] = []
    before = copy.deepcopy(nodes)

    out = TemporalLinker().link(nodes, edges)

    assert isinstance(out, list)
    assert all(":TYPE" in e for e in out)
    # Only the PART_OF_PERIOD edge for the entity carrying a period.
    assert {str(e[":TYPE"]) for e in out} == {"PART_OF_PERIOD"}
    assert nodes == before  # inputs untouched


def test_registered_in_default_registry() -> None:
    linker = DEFAULT_REGISTRY.get("temporal")
    assert isinstance(linker, TemporalLinker)
    assert linker.dimension is Dimension.TEMPORAL
