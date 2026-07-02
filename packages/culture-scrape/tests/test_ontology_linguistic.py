"""Tests for the linguistic linker.

Covers a connected DESCENDS_FROM family chain (by QID and by language code),
SPOKEN_IN place links, BORROWED_FROM gated on derivation mode, and COGNATE_WITH
between terms that share an etymon.
"""

import copy

import pytest

from culturescrape.ontology import (
    DEFAULT_REGISTRY,
    LANGUAGE_LABEL,
    TERM_LABEL,
    Dimension,
    LinguisticLinker,
)
from culturescrape.ontology.geographic import PLACE_LABEL
from culturescrape.schema.ids import mint_csid

Row = dict[str, str | list[str]]


def _edge_index(edges: list[Row]) -> dict[tuple[str, str, str], Row]:
    return {
        (str(e[":START_ID"]), str(e[":END_ID"]), str(e[":TYPE"])): e for e in edges
    }


def _family_tree() -> list[Row]:
    """A language-family tree whose parent pointers form a descent chain.

    Spanish -> Latin -> Proto-Italic -> Proto-Indo-European, each language
    naming its ancestor by Wikidata QID (the US-005 source's ``subclass of``).
    """
    return [
        {"csid": "cs:language:Q1321", ":LABEL": [LANGUAGE_LABEL], "name": "Spanish",
         "wikidata_qid": "Q1321", "parent_qid": "Q397"},
        {"csid": "cs:language:Q397", ":LABEL": [LANGUAGE_LABEL], "name": "Latin",
         "wikidata_qid": "Q397", "parent_qid": "Q35958"},
        {"csid": "cs:language:Q35958", ":LABEL": [LANGUAGE_LABEL],
         "name": "Proto-Italic", "wikidata_qid": "Q35958", "parent_qid": "Q19860"},
        {"csid": "cs:language:Q19860", ":LABEL": [LANGUAGE_LABEL],
         "name": "Proto-Indo-European", "wikidata_qid": "Q19860"},
    ]


def test_family_tree_produces_connected_descends_from_chain() -> None:
    result = LinguisticLinker().link_linguistic(_family_tree(), [])

    edges = _edge_index(result.edges)
    chain = [
        ("cs:language:Q1321", "cs:language:Q397"),
        ("cs:language:Q397", "cs:language:Q35958"),
        ("cs:language:Q35958", "cs:language:Q19860"),
    ]
    for start, end in chain:
        assert (start, end, "DESCENDS_FROM") in edges
        assert float(str(edges[(start, end, "DESCENDS_FROM")]["confidence"])) == (
            pytest.approx(0.9)
        )

    # The chain is connected: following DESCENDS_FROM from the leaf reaches the
    # root, visiting every language exactly once.
    successor = {start: end for start, end, _ in edges}
    visited = ["cs:language:Q1321"]
    while visited[-1] in successor:
        visited.append(successor[visited[-1]])
    assert visited == [
        "cs:language:Q1321",
        "cs:language:Q397",
        "cs:language:Q35958",
        "cs:language:Q19860",
    ]


def test_descends_from_creates_missing_ancestor_node() -> None:
    nodes: list[Row] = [
        {"csid": "cs:language:Q1321", ":LABEL": [LANGUAGE_LABEL], "name": "Spanish",
         "wikidata_qid": "Q1321", "parent_qid": "Q397"},
    ]
    result = LinguisticLinker().link_linguistic(nodes, [])

    ancestor_csid = mint_csid("language", qid="Q397")
    created = {str(n["csid"]): n for n in result.nodes}
    assert ancestor_csid in created
    assert created[ancestor_csid][":LABEL"] == [LANGUAGE_LABEL]
    assert ("cs:language:Q1321", ancestor_csid, "DESCENDS_FROM") in _edge_index(
        result.edges
    )


def test_descends_from_by_language_code() -> None:
    nodes: list[Row] = [
        # Glottolog-style codes (the next US-005 source) instead of QIDs.
        {"csid": "cs:language:spa", ":LABEL": [LANGUAGE_LABEL], "name": "Spanish",
         "language_code": "spa", "parent_code": "lat"},
        {"csid": "cs:language:lat", ":LABEL": [LANGUAGE_LABEL], "name": "Latin",
         "language_code": "lat"},
    ]
    result = LinguisticLinker().link_linguistic(nodes, [])

    assert ("cs:language:spa", "cs:language:lat", "DESCENDS_FROM") in _edge_index(
        result.edges
    )
    # Latin already exists, so no node is created for it.
    assert all(n["csid"] != "cs:language:lat" for n in result.nodes)


def test_spoken_in_links_language_to_places() -> None:
    nodes: list[Row] = [
        {"csid": "cs:language:Q1321", ":LABEL": [LANGUAGE_LABEL], "name": "Spanish",
         "wikidata_qid": "Q1321", "place_qid": ["Q29", "Q419"]},
        {"csid": "cs:place:Q29", ":LABEL": [PLACE_LABEL], "name": "Spain",
         "wikidata_qid": "Q29"},
    ]
    result = LinguisticLinker().link_linguistic(nodes, [])

    edges = _edge_index(result.edges)
    edge = edges[("cs:language:Q1321", "cs:place:Q29", "SPOKEN_IN")]
    assert float(str(edge["confidence"])) == pytest.approx(0.85)
    # Peru has no pre-existing place node, so one is created and linked.
    peru = mint_csid("place", qid="Q419")
    assert ("cs:language:Q1321", peru, "SPOKEN_IN") in edges
    assert any(n["csid"] == peru and n[":LABEL"] == [PLACE_LABEL] for n in result.nodes)


def test_borrowed_from_only_when_mode_marks_a_borrowing() -> None:
    nodes: list[Row] = [
        {"csid": "cs:term:alcohol", ":LABEL": [TERM_LABEL], "name": "alcohol",
         "etymon_qid": "Q888", "derivation_mode": "borrowing"},
        # Inherited, not borrowed -> no BORROWED_FROM edge.
        {"csid": "cs:term:father", ":LABEL": [TERM_LABEL], "name": "father",
         "etymon_qid": "Q999", "derivation_mode": "inheritance"},
    ]
    result = LinguisticLinker().link_linguistic(nodes, [])

    etymon = mint_csid("term", qid="Q888")
    edges = _edge_index(result.edges)
    assert ("cs:term:alcohol", etymon, "BORROWED_FROM") in edges
    assert not any(
        e[":TYPE"] == "BORROWED_FROM" and e[":START_ID"] == "cs:term:father"
        for e in result.edges
    )


def test_cognate_with_between_terms_sharing_an_etymon() -> None:
    nodes: list[Row] = [
        {"csid": "cs:term:padre", ":LABEL": [TERM_LABEL], "name": "padre",
         "etymon_qid": "Q777"},
        {"csid": "cs:term:pere", ":LABEL": [TERM_LABEL], "name": "père",
         "etymon_qid": "Q777"},
        {"csid": "cs:term:vater", ":LABEL": [TERM_LABEL], "name": "Vater",
         "etymon_qid": "Q777"},
    ]
    result = LinguisticLinker().link_linguistic(nodes, [])

    edges = _edge_index(result.edges)
    edge = edges[("cs:term:padre", "cs:term:pere", "COGNATE_WITH")]
    assert float(str(edge["confidence"])) == pytest.approx(0.6)
    assert ("cs:term:padre", "cs:term:vater", "COGNATE_WITH") in edges
    assert ("cs:term:pere", "cs:term:vater", "COGNATE_WITH") in edges
    # Symmetric edge is emitted once, in csid order (no reverse duplicate).
    assert ("cs:term:pere", "cs:term:padre", "COGNATE_WITH") not in edges


def test_does_not_duplicate_existing_edges() -> None:
    existing: Row = {
        ":START_ID": "cs:language:Q1321",
        ":END_ID": "cs:language:Q397",
        ":TYPE": "DESCENDS_FROM",
    }
    result = LinguisticLinker().link_linguistic(_family_tree(), [existing])

    matches = [
        e
        for e in result.edges
        if (e[":START_ID"], e[":END_ID"], e[":TYPE"])
        == ("cs:language:Q1321", "cs:language:Q397", "DESCENDS_FROM")
    ]
    assert matches == []


def test_link_returns_edges_only_and_never_mutates_inputs() -> None:
    nodes = _family_tree()
    edges: list[Row] = []
    before = copy.deepcopy(nodes)

    out = LinguisticLinker().link(nodes, edges)

    assert isinstance(out, list)
    assert all(":TYPE" in e for e in out)
    assert nodes == before  # inputs untouched


def test_registered_in_default_registry() -> None:
    linker = DEFAULT_REGISTRY.get("linguistic")
    assert isinstance(linker, LinguisticLinker)
    assert linker.dimension is Dimension.LINGUISTIC
