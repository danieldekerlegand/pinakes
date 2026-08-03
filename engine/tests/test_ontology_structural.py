"""Tests for the structural composition linker.

Covers PART_OF from Wikidata ``part of`` (P361) references, USES (P2283) edges,
the skip-and-count of references whose endpoint is outside the node set, resolving
a reference by ``csid`` instead of a QID, the registered-default pipeline run, and
that the new structural :TYPEs validate and bucket under the structural dimension.
"""

import copy
import logging

import pytest

from pinakes_engine.ontology import (
    DEFAULT_REGISTRY,
    Dimension,
    Pipeline,
    StructuralLinker,
    compute_metrics,
    validate_type,
)

Row = dict[str, str | list[str]]


def _edge_index(edges: list[Row]) -> dict[tuple[str, str, str], Row]:
    return {
        (str(e[":START_ID"]), str(e[":END_ID"]), str(e[":TYPE"])): e for e in edges
    }


def _machines() -> list[Row]:
    """Inventions/components carrying ``part of`` / ``uses`` references.

    The piston is part of (PART_OF) the engine, the engine part of the car; the
    car uses (USES) the wheel. The engine also references a containing whole
    (Q-uncatalogued) that is *not* in the node set, so that edge is skipped. Every
    reference is by Wikidata QID, the source form.
    """
    return [
        {"csid": "cs:part:Q11", ":LABEL": ["Component"], "name": "piston",
         "wikidata_qid": "Q11", "part_of_qid": "Q12"},
        {"csid": "cs:part:Q12", ":LABEL": ["Component"], "name": "engine",
         "wikidata_qid": "Q12", "part_of_qid": ["Q13", "Q99999999"]},
        {"csid": "cs:part:Q13", ":LABEL": ["Invention"], "name": "car",
         "wikidata_qid": "Q13", "uses_qid": "Q14"},
        {"csid": "cs:part:Q14", ":LABEL": ["Component"], "name": "wheel",
         "wikidata_qid": "Q14"},
    ]


def test_part_of_reference_becomes_part_of_edge() -> None:
    result = StructuralLinker().link_structural(_machines(), [])

    edges = _edge_index(result.edges)
    assert ("cs:part:Q11", "cs:part:Q12", "PART_OF") in edges
    assert ("cs:part:Q12", "cs:part:Q13", "PART_OF") in edges
    assert float(
        str(edges[("cs:part:Q11", "cs:part:Q12", "PART_OF")]["confidence"])
    ) == 0.9


def test_uses_reference_becomes_uses_edge() -> None:
    result = StructuralLinker().link_structural(_machines(), [])

    edges = _edge_index(result.edges)
    assert ("cs:part:Q13", "cs:part:Q14", "USES") in edges
    assert float(
        str(edges[("cs:part:Q13", "cs:part:Q14", "USES")]["confidence"])
    ) == 0.85


def test_reference_outside_node_set_is_skipped_and_counted(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.INFO, logger="pinakes_engine.ontology.structural"):
        result = StructuralLinker().link_structural(_machines(), [])

    # The engine's second whole (Q99999999) is not a node, so no PART_OF edge for
    # it exists and the miss is counted and logged.
    assert result.skipped == 1
    assert all(e[":END_ID"] != "cs:part:Q99999999" for e in result.edges)
    assert any("skipped 1" in record.getMessage() for record in caplog.records)


def test_csid_reference_resolves_without_a_qid() -> None:
    nodes: list[Row] = [
        {"csid": "cs:whole", ":LABEL": ["Invention"]},
        {"csid": "cs:part", ":LABEL": ["Component"], "part_of_qid": "cs:whole"},
    ]

    result = StructuralLinker().link_structural(nodes, [])

    edges = _edge_index(result.edges)
    assert ("cs:part", "cs:whole", "PART_OF") in edges
    assert result.skipped == 0


def test_inputs_are_not_mutated() -> None:
    nodes = _machines()
    snapshot = copy.deepcopy(nodes)

    StructuralLinker().link_structural(nodes, [])

    assert nodes == snapshot


def test_link_returns_only_edges_for_the_pipeline() -> None:
    edges = StructuralLinker().link(_machines(), [])

    assert all(":TYPE" in e for e in edges)
    assert {str(e[":TYPE"]) for e in edges} <= {"PART_OF", "USES"}


def test_registered_default_linker_runs_in_the_pipeline() -> None:
    linkers = DEFAULT_REGISTRY.by_dimension(Dimension.STRUCTURAL)
    assert any(isinstance(rel, StructuralLinker) for rel in linkers)

    pipeline = Pipeline.from_registry(DEFAULT_REGISTRY, [Dimension.STRUCTURAL])
    result = pipeline.run(_machines(), [])

    inferred = [e for e in result if e.get("source") == "inferred:structural"]
    assert any(str(e[":TYPE"]) == "PART_OF" for e in inferred)
    assert any(str(e[":TYPE"]) == "USES" for e in inferred)


def test_new_types_validate_and_bucket_under_structural() -> None:
    # validate_type accepts the new types, returning the registered relation.
    assert validate_type("PART_OF").dimension is Dimension.STRUCTURAL
    assert validate_type("USES").dimension is Dimension.STRUCTURAL

    nodes = _machines()
    edges = StructuralLinker().link(nodes, [])
    metrics = compute_metrics(nodes, edges)

    # Every inferred structural edge is counted under the structural dimension,
    # never the UNKNOWN bucket.
    assert metrics.edges_by_dimension.get("structural") == len(edges)
    assert "unknown" not in metrics.edges_by_dimension
    assert metrics.edges_by_type.get("PART_OF")
    assert metrics.edges_by_type.get("USES")
