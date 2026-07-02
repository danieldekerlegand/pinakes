"""Tests for the temporal linker.

Covers CONTEMPORARY_WITH overlap, PRECEDES/FOLLOWS ordering, idempotent
PART_OF_PERIOD period creation, and the shared-facet explosion guard.
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


def test_contemporary_with_for_overlapping_spans() -> None:
    nodes = [
        _node("cs:dish:a", time_start="1500", time_end="1600"),
        _node("cs:dish:b", time_start="1550", time_end="1650"),
    ]
    result = TemporalLinker().link_temporal(nodes, [])

    edges = _edge_index(result.edges)
    # Symmetric -> a single csid-ordered edge.
    edge = edges[("cs:dish:a", "cs:dish:b", "CONTEMPORARY_WITH")]
    assert float(str(edge["confidence"])) == pytest.approx(0.7)
    assert ("cs:dish:b", "cs:dish:a", "CONTEMPORARY_WITH") not in edges


def test_overlap_threshold_suppresses_weak_overlap() -> None:
    # Spans overlap by 5 years (1600..1605); a 10-year threshold rejects them.
    nodes = [
        _node("cs:dish:a", time_start="1500", time_end="1605"),
        _node("cs:dish:b", time_start="1600", time_end="1700"),
    ]
    result = TemporalLinker(min_overlap_years=10).link_temporal(nodes, [])

    # Below threshold but not disjoint -> no edge at all.
    assert result.edges == []


def test_instant_node_uses_single_bound() -> None:
    nodes = [
        _node("cs:dish:a", time_start="1500", time_end="1600"),
        _node("cs:event:x", time_start="1550"),  # instant at 1550
    ]
    result = TemporalLinker().link_temporal(nodes, [])

    assert ("cs:dish:a", "cs:event:x", "CONTEMPORARY_WITH") in _edge_index(
        result.edges
    )


def test_precedes_and_follows_for_disjoint_spans() -> None:
    nodes = [
        _node("cs:dish:early", time_start="1400", time_end="1450"),
        _node("cs:dish:late", time_start="1500", time_end="1550"),
    ]
    result = TemporalLinker().link_temporal(nodes, [])

    edges = _edge_index(result.edges)
    assert ("cs:dish:early", "cs:dish:late", "PRECEDES") in edges
    assert ("cs:dish:late", "cs:dish:early", "FOLLOWS") in edges
    assert float(str(edges[("cs:dish:early", "cs:dish:late", "PRECEDES")][
        "confidence"
    ])) == pytest.approx(0.8)
    # Disjoint pairs are not also contemporary.
    assert not any(e[":TYPE"] == "CONTEMPORARY_WITH" for e in result.edges)


def test_ordering_direction_independent_of_input_order() -> None:
    # Later entity listed first; the earlier one must still PRECEDE.
    nodes = [
        _node("cs:dish:late", time_start="1500", time_end="1550"),
        _node("cs:dish:early", time_start="1400", time_end="1450"),
    ]
    result = TemporalLinker().link_temporal(nodes, [])

    edges = _edge_index(result.edges)
    assert ("cs:dish:early", "cs:dish:late", "PRECEDES") in edges
    assert ("cs:dish:late", "cs:dish:early", "PRECEDES") not in edges


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


def test_facet_guard_blocks_cross_facet_comparison() -> None:
    # Same overlapping span, different labels -> different facet -> no edge.
    nodes: list[Row] = [
        {"csid": "cs:dish:a", ":LABEL": ["Dish"], "time_start": "1500",
         "time_end": "1600"},
        {"csid": "cs:battle:b", ":LABEL": ["Battle"], "time_start": "1550",
         "time_end": "1650"},
    ]
    result = TemporalLinker().link_temporal(nodes, [])
    assert result.edges == []


def test_widen_compares_across_facets() -> None:
    nodes: list[Row] = [
        {"csid": "cs:dish:a", ":LABEL": ["Dish"], "time_start": "1500",
         "time_end": "1600"},
        {"csid": "cs:battle:b", ":LABEL": ["Battle"], "time_start": "1550",
         "time_end": "1650"},
    ]
    result = TemporalLinker(widen=True).link_temporal(nodes, [])

    # Symmetric edge is csid-ordered (cs:battle:b sorts before cs:dish:a).
    assert ("cs:battle:b", "cs:dish:a", "CONTEMPORARY_WITH") in _edge_index(
        result.edges
    )


def test_facet_groups_by_place_when_labels_match() -> None:
    nodes = [
        _node("cs:dish:a", place_qid="Q419", time_start="1500", time_end="1600"),
        _node("cs:dish:b", place_qid="Q419", time_start="1550", time_end="1650"),
        _node("cs:dish:c", place_qid="Q155", time_start="1550", time_end="1650"),
    ]
    result = TemporalLinker().link_temporal(nodes, [])

    edges = _edge_index(result.edges)
    # a and b share Peru; c is in a different place facet.
    assert ("cs:dish:a", "cs:dish:b", "CONTEMPORARY_WITH") in edges
    assert not any(e[":END_ID"] == "cs:dish:c" for e in result.edges)


def test_nodes_without_spans_are_skipped() -> None:
    nodes = [
        _node("cs:dish:a", time_start="1500", time_end="1600"),
        _node("cs:dish:b"),  # no temporal info
    ]
    result = TemporalLinker().link_temporal(nodes, [])
    assert result.edges == []


def test_does_not_duplicate_existing_edges() -> None:
    existing: Row = {
        ":START_ID": "cs:dish:b",
        ":END_ID": "cs:dish:a",
        ":TYPE": "CONTEMPORARY_WITH",
    }
    nodes = [
        _node("cs:dish:a", time_start="1500", time_end="1600"),
        _node("cs:dish:b", time_start="1550", time_end="1650"),
    ]
    result = TemporalLinker().link_temporal(nodes, [existing])

    # The reverse orientation already exists; the symmetric edge is not re-emitted.
    assert not any(e[":TYPE"] == "CONTEMPORARY_WITH" for e in result.edges)


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
    assert nodes == before  # inputs untouched


def test_reversed_span_is_normalised() -> None:
    # time_start after time_end -> normalised to (1500, 1600), overlaps b.
    nodes = [
        _node("cs:dish:a", time_start="1600", time_end="1500"),
        _node("cs:dish:b", time_start="1550", time_end="1650"),
    ]
    result = TemporalLinker().link_temporal(nodes, [])
    assert ("cs:dish:a", "cs:dish:b", "CONTEMPORARY_WITH") in _edge_index(
        result.edges
    )


def test_negative_years_bce_order() -> None:
    nodes = [
        _node("cs:dish:bce", time_start="-200", time_end="-100"),
        _node("cs:dish:ce", time_start="100", time_end="200"),
    ]
    result = TemporalLinker().link_temporal(nodes, [])
    assert ("cs:dish:bce", "cs:dish:ce", "PRECEDES") in _edge_index(result.edges)


def test_registered_in_default_registry() -> None:
    linker = DEFAULT_REGISTRY.get("temporal")
    assert isinstance(linker, TemporalLinker)
    assert linker.dimension is Dimension.TEMPORAL


def test_negative_overlap_threshold_rejected() -> None:
    with pytest.raises(ValueError):
        TemporalLinker(min_overlap_years=-1)
