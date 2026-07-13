"""Shared-QID collapse across differently-typed nodes (US-004).

:func:`reconcile_shared_qids` fixes the identity damage a merged corpus surfaces:
the same Wikidata QID minted under two node types (``cs:concept:Q…`` vs
``cs:deity:Q…``) is one entity and must collapse to one node, its labels unioned
and its edges redirected — while nodes with no QID, or with different QIDs, stay
untouched.
"""

from __future__ import annotations

from culturescrape.ontology.linker import Edge, Node
from culturescrape.ontology.reconcile_qid import reconcile_shared_qids


def _node(csid: str, label: str, name: str, qid: str = "") -> Node:
    node: Node = {"csid": csid, ":LABEL": [label], "name": name}
    if qid:
        node["wikidata_qid"] = qid
    return node


def _edge(start: str, end: str, etype: str) -> Edge:
    return {":START_ID": start, ":END_ID": end, ":TYPE": etype}


def test_same_qid_across_types_collapses_to_one_node() -> None:
    nodes = [
        _node("cs:concept:Q146007", "Concept", "Wadjet", "Q146007"),
        _node("cs:deity:Q146007", "Deity", "Wadjet", "Q146007"),
        _node("cs:place:Q99", "Place", "Egypt", "Q99"),
    ]
    result = reconcile_shared_qids(nodes, [])

    assert result.collapsed == 1
    assert len(result.nodes) == 2  # the two Wadjet rows became one
    wadjet = next(n for n in result.nodes if _scalar(n, "name") == "Wadjet")
    # The survivor unions both type labels (one QID, both roles).
    labels = wadjet.get(":LABEL")
    assert isinstance(labels, list)
    assert {"Concept", "Deity"} <= set(labels)


def test_edges_redirect_onto_the_survivor() -> None:
    nodes = [
        _node("cs:concept:Q1", "Concept", "A", "Q1"),
        _node("cs:deity:Q1", "Deity", "A", "Q1"),
        _node("cs:place:Q2", "Place", "B", "Q2"),
    ]
    # An edge pointing at whichever csid loses the merge must be redirected, not
    # dropped; an edge that becomes a self-loop after the collapse is dropped.
    edges = [
        _edge("cs:place:Q2", "cs:concept:Q1", "ORIGINATES_FROM"),
        _edge("cs:place:Q2", "cs:deity:Q1", "ORIGINATES_FROM"),
        _edge("cs:concept:Q1", "cs:deity:Q1", "SAME_AS"),  # -> self-loop, dropped
    ]
    result = reconcile_shared_qids(nodes, edges)

    survivor = next(
        n["csid"] for n in result.nodes if _scalar(n, "name") == "A"
    )
    origin = [e for e in result.edges if _scalar(e, ":TYPE") == "ORIGINATES_FROM"]
    # Both ORIGINATES_FROM edges now point at the single survivor; the duplicate
    # collapses on (start, end, type) is left to the caller — here both survive as
    # distinct rows only if endpoints differ, so assert they all target survivor.
    assert origin
    assert all(_scalar(e, ":END_ID") == survivor for e in origin)
    # The self-loop is gone.
    assert not any(_scalar(e, ":TYPE") == "SAME_AS" for e in result.edges)


def test_nodes_without_qid_or_with_different_qids_are_untouched() -> None:
    nodes = [
        _node("cs:culture:babylon", "Culture", "Babylon"),  # no QID
        _node("cs:culture:sumer", "Culture", "Sumer"),  # no QID, same-ish name
        _node("cs:deity:Q1", "Deity", "X", "Q1"),
        _node("cs:deity:Q2", "Deity", "Y", "Q2"),  # different QID
    ]
    result = reconcile_shared_qids(nodes, [])
    assert result.collapsed == 0
    assert len(result.nodes) == 4


def _scalar(row: Node | Edge, key: str) -> str:
    value = row.get(key)
    return value.strip() if isinstance(value, str) else ""
