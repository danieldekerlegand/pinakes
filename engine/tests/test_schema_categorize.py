"""Tests for linking entities to their scraped category and type.

Node rows are produced through the real mapper (Tasklist 2) from a small fixture
category so the category/type nodes and the MEMBER_OF_CATEGORY / INSTANCE_OF
edges are exercised against rows shaped exactly as the pipeline emits them.
"""

import pytest

from pinakes_engine.acquire.categories import CategorySpec, SourceSpec
from pinakes_engine.acquire.records import Provenance, RawRecord
from pinakes_engine.schema import (
    CATEGORY_LABEL,
    INSTANCE_OF,
    MEMBER_OF_CATEGORY,
    SYNTHETIC_SOURCE,
    TYPE_LABEL,
    CategorizeError,
    Row,
    categorize_rows,
    category_node,
    map_records,
    mint_csid,
    type_node,
)


def _provenance(**overrides: object) -> Provenance:
    base: dict[str, object] = {
        "source": "wikidata",
        "source_url": "https://www.wikidata.org/wiki/Q12345",
        "source_query": "SELECT ?item WHERE { ... }",
        "retrieved_at": "2026-06-16T00:00:00+00:00",
        "confidence": 0.9,
    }
    base.update(overrides)
    return Provenance(**base)  # type: ignore[arg-type]


def _category(label: str = "Dish;CulturalArtifact") -> CategorySpec:
    return CategorySpec(
        id="peruvian-dishes",
        label=label,
        description="Every Peruvian dish",
        source=SourceSpec(type="wikidata-sparql", query="SELECT ..."),
        dimensions=("temporal", "geographic"),
    )


def _dish_rows(*names: str) -> list[Row]:
    records = [
        RawRecord(fields={"title": name, "lang": "es"}, provenance=_provenance())
        for name in names
    ]
    return map_records(records, _category())


def _edges_of(result_edges: list[Row], rel_type: str) -> list[Row]:
    return [e for e in result_edges if e[":TYPE"] == rel_type]


# --- edge counts match node counts -----------------------------------------


def test_edge_counts_equal_node_counts_for_a_category() -> None:
    rows = _dish_rows("Ceviche", "Lomo Saltado", "Aji de Gallina")
    result = categorize_rows(rows, _category())

    assert len(_edges_of(result.edges, MEMBER_OF_CATEGORY)) == len(rows)
    assert len(_edges_of(result.edges, INSTANCE_OF)) == len(rows)


def test_every_node_emits_one_edge_of_each_type() -> None:
    rows = _dish_rows("Ceviche", "Lomo Saltado")
    result = categorize_rows(rows, _category())

    for row in rows:
        csid = row["csid"]
        member = [
            e
            for e in _edges_of(result.edges, MEMBER_OF_CATEGORY)
            if e[":START_ID"] == csid
        ]
        instance = [
            e
            for e in _edges_of(result.edges, INSTANCE_OF)
            if e[":START_ID"] == csid
        ]
        assert len(member) == 1
        assert len(instance) == 1


# --- edges point at the category and type nodes ----------------------------


def test_member_edges_point_at_the_category_node() -> None:
    rows = _dish_rows("Ceviche", "Lomo Saltado")
    result = categorize_rows(rows, _category())

    cat_csid = mint_csid(CATEGORY_LABEL, name="peruvian-dishes")
    for edge in _edges_of(result.edges, MEMBER_OF_CATEGORY):
        assert edge[":END_ID"] == cat_csid


def test_instance_edges_point_at_the_type_node() -> None:
    rows = _dish_rows("Ceviche")
    result = categorize_rows(rows, _category())

    type_csid = mint_csid(TYPE_LABEL, name="Dish")
    (edge,) = _edges_of(result.edges, INSTANCE_OF)
    assert edge[":END_ID"] == type_csid


# --- nodes are created idempotently ----------------------------------------


def test_one_category_node_and_one_type_node_per_distinct_type() -> None:
    rows = _dish_rows("Ceviche", "Lomo Saltado", "Aji de Gallina")
    result = categorize_rows(rows, _category())

    labels = [node[":LABEL"] for node in result.nodes]
    assert labels.count([CATEGORY_LABEL]) == 1
    assert labels.count([TYPE_LABEL]) == 1
    assert len(result.nodes) == 2


def test_distinct_primary_labels_get_distinct_type_nodes() -> None:
    dish = _dish_rows("Ceviche")[0]
    drink_records = [RawRecord(fields={"title": "Pisco"}, provenance=_provenance())]
    drink = map_records(drink_records, _category(label="Drink"))[0]

    # Type comes from each row's own primary :LABEL, so two labels in one
    # category yield two distinct type nodes.
    result = categorize_rows([dish, drink], _category())
    type_nodes = [n for n in result.nodes if n[":LABEL"] == [TYPE_LABEL]]
    assert {n["name"] for n in type_nodes} == {"Dish", "Drink"}


def test_synthesized_nodes_are_idempotent() -> None:
    rows = _dish_rows("Ceviche", "Lomo Saltado")
    first = categorize_rows(rows, _category())
    second = categorize_rows(rows, _category())
    assert first.nodes == second.nodes
    assert first.edges == second.edges


def test_category_and_type_nodes_carry_identity_and_provenance() -> None:
    cat = category_node(_category())
    assert cat["csid"] == mint_csid(CATEGORY_LABEL, name="peruvian-dishes")
    assert cat[":LABEL"] == [CATEGORY_LABEL]
    assert cat["name"] == "peruvian-dishes"
    assert cat["description"] == "Every Peruvian dish"
    assert cat["source"] == SYNTHETIC_SOURCE

    tnode = type_node("Dish")
    assert tnode["csid"] == mint_csid(TYPE_LABEL, name="Dish")
    assert tnode[":LABEL"] == [TYPE_LABEL]
    assert tnode["name"] == "Dish"
    assert tnode["source"] == SYNTHETIC_SOURCE


# --- edges carry provenance from the source row ----------------------------


def test_edges_carry_source_row_provenance() -> None:
    rows = _dish_rows("Ceviche")
    result = categorize_rows(rows, _category())

    for edge in result.edges:
        assert edge["source"] == "wikidata"
        assert edge["source_url"] == "https://www.wikidata.org/wiki/Q12345"
        assert edge["retrieved_at"] == "2026-06-16T00:00:00+00:00"
        assert edge["confidence"] == "0.9"
        # source_query is node-only; the edge schema does not carry it.
        assert "source_query" not in edge


def test_edges_have_only_the_edge_structural_columns() -> None:
    rows = _dish_rows("Ceviche")
    result = categorize_rows(rows, _category())

    for edge in result.edges:
        assert set(edge) >= {":START_ID", ":END_ID", ":TYPE"}
        assert "csid" not in edge
        assert ":LABEL" not in edge


# --- error handling --------------------------------------------------------


def test_row_without_csid_is_rejected() -> None:
    with pytest.raises(CategorizeError, match="no csid"):
        categorize_rows([{":LABEL": ["Dish"], "name": "Ceviche"}], _category())


def test_row_without_primary_label_is_rejected() -> None:
    with pytest.raises(CategorizeError, match="no primary :LABEL"):
        categorize_rows([{"csid": "cs:dish:Q1", ":LABEL": []}], _category())


def test_empty_rows_yield_only_the_category_node() -> None:
    result = categorize_rows([], _category())
    assert [n[":LABEL"] for n in result.nodes] == [[CATEGORY_LABEL]]
    assert result.edges == []
