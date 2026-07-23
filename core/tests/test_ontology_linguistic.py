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


def _cognate_set_nodes() -> list[Row]:
    """Four Lexibank wordforms in one cognate set (id in the ``extra`` overflow).

    The cognate-set id rides in ``extra`` — where it lands after ``build_corpus``
    re-reads the normalized TSV from disk — not as a top-level cell, so this pins
    that the linker reads it back out of the overflow.
    """
    import json

    return [
        {"csid": "cs:wordform:d", ":LABEL": ["Wordform"], "name": "five: rima",
         "extra": json.dumps({"cognateset": "five-1"})},
        {"csid": "cs:wordform:a", ":LABEL": ["Wordform"], "name": "five: lima",
         "extra": json.dumps({"cognateset": "five-1"})},
        {"csid": "cs:wordform:c", ":LABEL": ["Wordform"], "name": "five: lima",
         "extra": json.dumps({"cognateset": "five-1"})},
        {"csid": "cs:wordform:b", ":LABEL": ["Wordform"], "name": "five: lima",
         "extra": json.dumps({"cognateset": "five-1"})},
    ]


def test_cognate_set_emits_a_representative_star_not_a_clique() -> None:
    result = LinguisticLinker().link_linguistic(_cognate_set_nodes(), [])

    edges = _edge_index(result.edges)
    cognate = [k for k in edges if k[2] == "COGNATE_WITH"]
    # 4 members → a star of 3 edges (n-1), NOT the 6 of a clique.
    assert len(cognate) == 3
    # Every edge points at the lexicographically-first csid (the representative).
    assert all(end == "cs:wordform:a" for _start, end, _rel in cognate)
    assert {start for start, _e, _r in cognate} == {
        "cs:wordform:b", "cs:wordform:c", "cs:wordform:d"
    }
    assert float(str(edges[cognate[0]]["confidence"])) == pytest.approx(0.6)


def test_cognate_set_reads_a_direct_field_too() -> None:
    # A top-level `cognateset` cell (in-memory link stage) works as well as overflow.
    nodes: list[Row] = [
        {"csid": "cs:wordform:y", ":LABEL": ["Wordform"], "name": "hand: lima",
         "cognateset": "hand-1"},
        {"csid": "cs:wordform:x", ":LABEL": ["Wordform"], "name": "hand: liga",
         "cognateset": "hand-1"},
    ]
    result = LinguisticLinker().link_linguistic(nodes, [])

    assert _edge_index(result.edges).keys() == {
        ("cs:wordform:y", "cs:wordform:x", "COGNATE_WITH")
    }


def test_singleton_cognate_set_emits_no_edge() -> None:
    import json

    nodes: list[Row] = [
        {"csid": "cs:wordform:only", ":LABEL": ["Wordform"], "name": "two: bar",
         "extra": json.dumps({"cognateset": "two-9"})},
    ]
    result = LinguisticLinker().link_linguistic(nodes, [])

    assert result.edges == []


def test_no_cognateset_is_a_no_op_for_ordinary_corpora() -> None:
    # Nodes without a cognate-set id (any non-Lexibank corpus) get no cognate edges.
    result = LinguisticLinker().link_linguistic(_family_tree(), [])

    assert not any(e[":TYPE"] == "COGNATE_WITH" for e in result.edges)


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


# --- kaikki etymology relations (source-breadth US-004) --------------------


def _kaikki_node(csid: str, name: str, lang: str, relations: list[dict]) -> Row:
    """A wordform node carrying its kaikki etymology relations in `extra` overflow."""
    import json

    return {
        "csid": csid,
        ":LABEL": ["Wordform"],
        "name": name,
        "lang": lang,
        "extra": json.dumps({"etymology_relations": json.dumps(relations)}),
    }


def test_etymology_relations_emit_typed_edges_to_minted_terms() -> None:
    nodes = [
        _kaikki_node(
            "cs:wordform:beef", "beef", "en",
            [
                {"rel": "BORROWED_FROM", "lang": "fro", "term": "boef"},
                {"rel": "COGNATE_WITH", "lang": "fr", "term": "bœuf"},
            ],
        ),
    ]
    result = LinguisticLinker().link_linguistic(nodes, [])

    by_type = {str(e[":TYPE"]): e for e in result.edges}
    assert set(by_type) == {"BORROWED_FROM", "COGNATE_WITH"}
    # Each edge points at a minted Term node keyed by (lang, term).
    boef = mint_csid("term", name="boef", lang="fro")
    assert (str(by_type["BORROWED_FROM"][":START_ID"]),
            str(by_type["BORROWED_FROM"][":END_ID"])) == ("cs:wordform:beef", boef)
    created = {str(n["csid"]) for n in result.nodes}
    assert boef in created
    assert mint_csid("term", name="bœuf", lang="fr") in created


def test_same_etymon_from_two_forms_is_one_term_node() -> None:
    # Two forms deriving from the same (lang, term) reuse a single minted node.
    nodes = [
        _kaikki_node("cs:wordform:a", "amiko", "eo",
                     [{"rel": "DERIVED_FROM", "lang": "la", "term": "amīcus"}]),
        _kaikki_node("cs:wordform:b", "amiko2", "io",
                     [{"rel": "DERIVED_FROM", "lang": "la", "term": "amīcus"}]),
    ]
    result = LinguisticLinker().link_linguistic(nodes, [])

    amicus = mint_csid("term", name="amīcus", lang="la")
    derived = [e for e in result.edges if e[":TYPE"] == "DERIVED_FROM"]
    assert {str(e[":END_ID"]) for e in derived} == {amicus}
    assert [str(n["csid"]) for n in result.nodes].count(amicus) == 1


def test_etymology_relation_reuses_an_existing_term_endpoint() -> None:
    # A relation naming an existing (lang, term) node points at it, minting nothing.
    existing: Row = {
        "csid": "cs:term:existing", ":LABEL": [TERM_LABEL],
        "name": "boef", "lang": "fro",
    }
    node = _kaikki_node("cs:wordform:beef", "beef", "en",
                        [{"rel": "BORROWED_FROM", "lang": "fro", "term": "boef"}])
    result = LinguisticLinker().link_linguistic([existing, node], [])

    (edge,) = [e for e in result.edges if e[":TYPE"] == "BORROWED_FROM"]
    assert str(edge[":END_ID"]) == "cs:term:existing"
    assert result.nodes == []  # nothing minted


def test_no_etymology_cell_is_a_no_op() -> None:
    result = LinguisticLinker().link_linguistic(_family_tree(), [])
    assert not any(
        e[":TYPE"] in {"BORROWED_FROM", "DERIVED_FROM", "COGNATE_WITH"}
        for e in result.edges
    )
