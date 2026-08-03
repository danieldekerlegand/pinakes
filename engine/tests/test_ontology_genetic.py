"""Tests for the genetic (cultural-lineage) linker.

Covers DERIVED_FROM from Wikidata ``based on`` (P144) references, INFLUENCED_BY
(P737) and symmetric VARIANT_OF (P279) edges, the skip-and-count of references
whose endpoint is outside the node set, and the denormalized ``derived_from_csid``
convenience column for the single-primary-ancestor case.
"""

import copy
import logging

import pytest

from pinakes_engine.ontology import (
    DEFAULT_REGISTRY,
    DERIVED_FROM_COLUMN,
    Dimension,
    GeneticLinker,
    Pipeline,
)

Row = dict[str, str | list[str]]


def _edge_index(edges: list[Row]) -> dict[tuple[str, str, str], Row]:
    return {
        (str(e[":START_ID"]), str(e[":END_ID"]), str(e[":TYPE"])): e for e in edges
    }


def _cocktails() -> list[Row]:
    """Cocktails carrying ``based on`` / ``influenced by`` / ``variant of`` refs.

    The Martinez is based on (DERIVED_FROM) the Manhattan; the Vodka Martini is a
    variant of the Martini and influenced by the Martinez. The Manhattan references
    a basis (Q-an-uncatalogued-drink) that is *not* in the node set, so that edge is
    skipped. Every reference is by Wikidata QID, the US-007 source form.
    """
    return [
        {"csid": "cs:drink:Q608721", ":LABEL": ["Cocktail"], "name": "Manhattan",
         "wikidata_qid": "Q608721", "derived_from_qid": "Q99999999"},
        {"csid": "cs:drink:Q1063786", ":LABEL": ["Cocktail"], "name": "Martinez",
         "wikidata_qid": "Q1063786", "derived_from_qid": "Q608721"},
        {"csid": "cs:drink:Q1135painting", ":LABEL": ["Cocktail"], "name": "Martini",
         "wikidata_qid": "Q11135"},
        {"csid": "cs:drink:Q1394301", ":LABEL": ["Cocktail"], "name": "Vodka Martini",
         "wikidata_qid": "Q1394301", "variant_of_qid": "Q11135",
         "influenced_by_qid": "Q1063786"},
    ]


def test_based_on_reference_becomes_derived_from_edge() -> None:
    result = GeneticLinker().link_genetic(_cocktails(), [])

    edges = _edge_index(result.edges)
    assert ("cs:drink:Q1063786", "cs:drink:Q608721", "DERIVED_FROM") in edges
    assert float(
        str(edges[("cs:drink:Q1063786", "cs:drink:Q608721", "DERIVED_FROM")][
            "confidence"
        ])
    ) == 0.9


def test_influenced_by_and_variant_edges() -> None:
    result = GeneticLinker().link_genetic(_cocktails(), [])

    edges = _edge_index(result.edges)
    assert ("cs:drink:Q1394301", "cs:drink:Q1063786", "INFLUENCED_BY") in edges
    # VARIANT_OF is symmetric: emitted once, in csid order.
    assert ("cs:drink:Q1135painting", "cs:drink:Q1394301", "VARIANT_OF") in edges
    assert ("cs:drink:Q1394301", "cs:drink:Q1135painting", "VARIANT_OF") not in edges


def test_reference_outside_node_set_is_skipped_and_counted(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.INFO, logger="pinakes_engine.ontology.genetic"):
        result = GeneticLinker().link_genetic(_cocktails(), [])

    # The Manhattan's basis (Q99999999) is not a node, so no DERIVED_FROM edge for
    # it exists and the miss is counted and logged.
    assert result.skipped == 1
    assert all(e[":START_ID"] != "cs:drink:Q608721" for e in result.edges)
    assert any("skipped 1" in record.getMessage() for record in caplog.records)


def test_single_primary_ancestor_is_denormalized() -> None:
    result = GeneticLinker().link_genetic(_cocktails(), [])

    updated = {str(n["csid"]): n for n in result.nodes}
    # Martinez has exactly one resolved ancestor -> denormalized pointer set.
    assert updated["cs:drink:Q1063786"][DERIVED_FROM_COLUMN] == "cs:drink:Q608721"
    # Manhattan's only ancestor was skipped, so it gains no pointer (not updated).
    assert "cs:drink:Q608721" not in updated


def test_multiple_ancestors_are_not_denormalized() -> None:
    nodes: list[Row] = [
        {"csid": "cs:a", ":LABEL": ["Dish"], "wikidata_qid": "Q1"},
        {"csid": "cs:b", ":LABEL": ["Dish"], "wikidata_qid": "Q2"},
        {"csid": "cs:c", ":LABEL": ["Dish"], "wikidata_qid": "Q3",
         "derived_from_qid": ["Q1", "Q2"]},
    ]

    result = GeneticLinker().link_genetic(nodes, [])

    edges = _edge_index(result.edges)
    assert ("cs:c", "cs:a", "DERIVED_FROM") in edges
    assert ("cs:c", "cs:b", "DERIVED_FROM") in edges
    # Two ancestors = no single primary, so no node carries a denormalized pointer.
    assert result.nodes == []


def test_existing_derived_from_csid_is_left_untouched() -> None:
    nodes: list[Row] = [
        {"csid": "cs:parent", ":LABEL": ["Dish"], "wikidata_qid": "Q1"},
        {"csid": "cs:child", ":LABEL": ["Dish"], "wikidata_qid": "Q2",
         "derived_from_qid": "Q1", DERIVED_FROM_COLUMN: "cs:other"},
    ]

    result = GeneticLinker().link_genetic(nodes, [])

    # The reference still maps to an edge...
    assert ("cs:child", "cs:parent", "DERIVED_FROM") in _edge_index(result.edges)
    # ...but an authoritative existing pointer is not overwritten (node untouched).
    assert result.nodes == []


def test_inputs_are_not_mutated() -> None:
    nodes = _cocktails()
    snapshot = copy.deepcopy(nodes)

    GeneticLinker().link_genetic(nodes, [])

    assert nodes == snapshot


def test_csid_reference_resolves_without_a_qid() -> None:
    nodes: list[Row] = [
        {"csid": "cs:parent", ":LABEL": ["Dish"]},
        {"csid": "cs:child", ":LABEL": ["Dish"], "derived_from_qid": "cs:parent"},
    ]

    result = GeneticLinker().link_genetic(nodes, [])

    edges = _edge_index(result.edges)
    assert ("cs:child", "cs:parent", "DERIVED_FROM") in edges
    assert result.skipped == 0


def test_link_returns_only_edges_for_the_pipeline() -> None:
    edges = GeneticLinker().link(_cocktails(), [])

    assert all(":TYPE" in e for e in edges)
    assert {str(e[":TYPE"]) for e in edges} <= {
        "DERIVED_FROM",
        "INFLUENCED_BY",
        "VARIANT_OF",
    }


def test_registered_default_linker_runs_in_the_pipeline() -> None:
    linker = DEFAULT_REGISTRY.by_dimension(Dimension.GENETIC)
    assert any(isinstance(rel, GeneticLinker) for rel in linker)

    pipeline = Pipeline.from_registry(DEFAULT_REGISTRY, [Dimension.GENETIC])
    result = pipeline.run(_cocktails(), [])

    inferred = [e for e in result if e.get("source") == "inferred:genetic"]
    assert any(str(e[":TYPE"]) == "DERIVED_FROM" for e in inferred)
