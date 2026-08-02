"""Tests for the pluggable linker interface and pipeline."""

import copy
from collections.abc import Sequence

import pytest

from pinakes_engine.ontology import (
    Dimension,
    Edge,
    Linker,
    LinkerError,
    LinkerRegistry,
    Node,
    Pipeline,
    UnknownRelationTypeError,
    inferred_edge,
)


class PlaceLinker(Linker):
    """Stub geographic linker: LOCATED_IN from any node with a ``place_qid``."""

    name = "place"
    dimension = Dimension.GEOGRAPHIC

    def link(self, nodes: Sequence[Node], edges: Sequence[Edge]) -> list[Edge]:
        out: list[Edge] = []
        for node in nodes:
            place = node.get("place_qid")
            if isinstance(place, str) and place:
                out.append(
                    inferred_edge(str(node["csid"]), place, "LOCATED_IN", 0.9)
                )
        return out


class PeriodLinker(Linker):
    """Stub temporal linker: CONTEMPORARY_WITH between nodes sharing a period."""

    name = "period"
    dimension = Dimension.TEMPORAL

    def link(self, nodes: Sequence[Node], edges: Sequence[Edge]) -> list[Edge]:
        out: list[Edge] = []
        having_period = [n for n in nodes if n.get("period")]
        for left in having_period:
            for right in having_period:
                a, b = str(left["csid"]), str(right["csid"])
                if a < b and left["period"] == right["period"]:
                    out.append(
                        inferred_edge(a, b, "CONTEMPORARY_WITH", 0.5)
                    )
        return out


def _nodes() -> list[Node]:
    return [
        {"csid": "cs:dish:a", "name": "A", "place_qid": "Q1", "period": "Inca"},
        {"csid": "cs:dish:b", "name": "B", "place_qid": "", "period": "Inca"},
        {"csid": "cs:dish:c", "name": "C", "place_qid": "Q2", "period": ""},
    ]


def test_pipeline_runs_two_stub_linkers() -> None:
    nodes = _nodes()
    pipeline = Pipeline([PlaceLinker(), PeriodLinker()])

    result = pipeline.run(nodes, [])

    types = sorted(str(e[":TYPE"]) for e in result)
    # Two LOCATED_IN (a, c) and one CONTEMPORARY_WITH (a–b share "Inca").
    assert types == ["CONTEMPORARY_WITH", "LOCATED_IN", "LOCATED_IN"]


def test_inferred_edges_are_tagged_with_source_and_confidence() -> None:
    pipeline = Pipeline([PlaceLinker(), PeriodLinker()])

    result = pipeline.run(_nodes(), [])

    for edge in result:
        source = edge["source"]
        confidence = edge["confidence"]
        assert isinstance(source, str) and source.startswith("inferred:")
        assert isinstance(confidence, str)
        assert 0.0 <= float(confidence) <= 1.0

    by_type = {str(e[":TYPE"]): e for e in result}
    assert by_type["LOCATED_IN"]["source"] == "inferred:place"
    assert by_type["CONTEMPORARY_WITH"]["source"] == "inferred:period"


def test_pipeline_appends_to_existing_edges() -> None:
    existing: Edge = {
        ":START_ID": "cs:dish:a",
        ":END_ID": "Q9",
        ":TYPE": "ORIGINATES_FROM",
    }

    result = Pipeline([PlaceLinker()]).run(_nodes(), [existing])

    assert result[0] == existing  # the existing edge leads, unchanged
    assert sum(e[":TYPE"] == "LOCATED_IN" for e in result) == 2


def test_pipeline_never_mutates_source_rows() -> None:
    nodes = _nodes()
    edges: list[Edge] = [
        {":START_ID": "cs:dish:a", ":END_ID": "Q9", ":TYPE": "ORIGINATES_FROM"}
    ]
    nodes_before = copy.deepcopy(nodes)
    edges_before = copy.deepcopy(edges)

    Pipeline([PlaceLinker(), PeriodLinker()]).run(nodes, edges)

    assert nodes == nodes_before
    assert edges == edges_before  # the caller's edge list is untouched


def test_later_linker_sees_earlier_inferred_edges() -> None:
    seen: list[int] = []

    class CountingLinker(Linker):
        name = "counter"
        dimension = Dimension.STRUCTURAL

        def link(
            self, nodes: Sequence[Node], edges: Sequence[Edge]
        ) -> list[Edge]:
            seen.append(len(edges))
            return []

    Pipeline([PlaceLinker(), CountingLinker()]).run(_nodes(), [])

    # PlaceLinker infers 2 edges before CountingLinker runs.
    assert seen == [2]


def test_inferred_edge_validates_relation_type() -> None:
    with pytest.raises(UnknownRelationTypeError):
        inferred_edge("a", "b", "NOT_A_TYPE", 0.5)


def test_inferred_edge_rejects_out_of_range_confidence() -> None:
    with pytest.raises(LinkerError):
        inferred_edge("a", "b", "LOCATED_IN", 1.5)


def test_registry_register_get_and_by_dimension() -> None:
    registry = LinkerRegistry()
    place, period = PlaceLinker(), PeriodLinker()
    registry.register(place)
    registry.register(period)

    assert registry.get("place") is place
    assert registry.all() == (place, period)
    assert registry.by_dimension(Dimension.GEOGRAPHIC) == (place,)
    assert registry.by_dimension(Dimension.TEMPORAL) == (period,)
    assert registry.by_dimension(Dimension.LINGUISTIC) == ()


def test_registry_rejects_duplicate_and_unknown() -> None:
    registry = LinkerRegistry()
    registry.register(PlaceLinker())
    with pytest.raises(LinkerError):
        registry.register(PlaceLinker())
    with pytest.raises(LinkerError):
        registry.get("missing")


def test_pipeline_from_registry_orders_by_dimension() -> None:
    registry = LinkerRegistry()
    registry.register(PeriodLinker())  # temporal, registered first
    registry.register(PlaceLinker())  # geographic

    ordered = Pipeline.from_registry(
        registry, dimensions=[Dimension.GEOGRAPHIC, Dimension.TEMPORAL]
    )
    assert [linker.name for linker in ordered.linkers] == ["place", "period"]

    everything = Pipeline.from_registry(registry)
    assert [linker.name for linker in everything.linkers] == ["period", "place"]
