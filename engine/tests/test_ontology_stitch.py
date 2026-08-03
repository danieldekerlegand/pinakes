"""Tests for cross-category entity stitching.

Two categories are normalized through the real pipeline
(:func:`pinakes_engine.schema.pipeline.normalize_records`) with one entity in
common, so the stitcher is exercised against per-category outputs shaped exactly
as the pipeline emits them.
"""

from pinakes_engine.acquire.categories import CategorySpec, SourceSpec
from pinakes_engine.acquire.records import Provenance, RawRecord
from pinakes_engine.ontology import (
    SharedEntity,
    render_report,
    stitch_categories,
)
from pinakes_engine.schema import (
    CATEGORY_LABEL,
    MEMBER_OF_CATEGORY,
    NormalizationResult,
    Row,
    mint_csid,
    normalize_records,
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


def _category(cat_id: str) -> CategorySpec:
    return CategorySpec(
        id=cat_id,
        label="Dish;CulturalArtifact",
        description=f"The {cat_id} category",
        source=SourceSpec(type="wikidata-sparql", query="SELECT ..."),
        dimensions=("temporal",),
    )


def _record(name: str, qid: str, **fields: str) -> RawRecord:
    base = {"title": name, "lang": "es", "wikidata_qid": qid}
    base.update(fields)
    return RawRecord(fields=base, provenance=_provenance())


def _normalize(cat_id: str, *records: RawRecord) -> NormalizationResult:
    return normalize_records(records, _category(cat_id))


# A dish present in both categories, plus one unique to each.
_SHARED = _record("Ceviche", "Q12345")
_PERU_ONLY = _record("Lomo Saltado", "Q23456")
_SEAFOOD_ONLY = _record("Tiradito", "Q34567")


def _two_categories() -> tuple[NormalizationResult, NormalizationResult]:
    peru = _normalize("peruvian-dishes", _SHARED, _PERU_ONLY)
    seafood = _normalize("seafood-dishes", _SHARED, _SEAFOOD_ONLY)
    return peru, seafood


def _nodes_with_csid(nodes: list[Row], csid: str) -> list[Row]:
    return [n for n in nodes if n.get("csid") == csid]


def _member_edges(edges: list[Row], start: str) -> list[Row]:
    return [
        e
        for e in edges
        if e[":TYPE"] == MEMBER_OF_CATEGORY and e[":START_ID"] == start
    ]


# --- the shared entity collapses to one node -------------------------------


def test_shared_entity_becomes_a_single_node() -> None:
    peru, seafood = _two_categories()
    result = stitch_categories([peru, seafood])

    shared_csid = mint_csid("Dish", qid="Q12345")
    assert len(_nodes_with_csid(result.nodes, shared_csid)) == 1


def test_unique_entities_survive_untouched() -> None:
    peru, seafood = _two_categories()
    result = stitch_categories([peru, seafood])

    for qid in ("Q23456", "Q34567"):
        assert len(_nodes_with_csid(result.nodes, mint_csid("Dish", qid=qid))) == 1


def test_no_duplicate_csids_in_output() -> None:
    peru, seafood = _two_categories()
    result = stitch_categories([peru, seafood])

    csids = [n["csid"] for n in result.nodes]
    assert len(csids) == len(set(csids))


def test_shared_type_node_collapses_across_categories() -> None:
    peru, seafood = _two_categories()
    result = stitch_categories([peru, seafood])

    type_csid = mint_csid("Type", name="Dish")
    assert len(_nodes_with_csid(result.nodes, type_csid)) == 1


# --- the shared entity keeps a MEMBER_OF_CATEGORY edge to each category -----


def test_shared_entity_keeps_an_edge_to_every_category() -> None:
    peru, seafood = _two_categories()
    result = stitch_categories([peru, seafood])

    shared_csid = mint_csid("Dish", qid="Q12345")
    members = _member_edges(result.edges, shared_csid)
    targets = {e[":END_ID"] for e in members}
    assert targets == {
        mint_csid(CATEGORY_LABEL, name="peruvian-dishes"),
        mint_csid(CATEGORY_LABEL, name="seafood-dishes"),
    }


def test_duplicate_structural_edges_collapse() -> None:
    peru, seafood = _two_categories()
    result = stitch_categories([peru, seafood])

    shared_csid = mint_csid("Dish", qid="Q12345")
    # INSTANCE_OF is identical from both categories, so only one survives.
    instance = [
        e
        for e in result.edges
        if e[":TYPE"] == "INSTANCE_OF" and e[":START_ID"] == shared_csid
    ]
    assert len(instance) == 1


# --- the report lists shared entities and their categories ------------------


def test_report_lists_only_cross_category_entities() -> None:
    peru, seafood = _two_categories()
    result = stitch_categories([peru, seafood])

    assert len(result.shared) == 1
    (shared,) = result.shared
    assert shared == SharedEntity(
        csid=mint_csid("Dish", qid="Q12345"),
        name="Ceviche",
        categories=["peruvian-dishes", "seafood-dishes"],
    )


def test_render_report_names_the_entity_and_its_categories() -> None:
    peru, seafood = _two_categories()
    result = stitch_categories([peru, seafood])

    text = render_report(result.shared)
    assert "Ceviche" in text
    assert "peruvian-dishes" in text
    assert "seafood-dishes" in text


def test_render_report_handles_no_shared_entities() -> None:
    assert render_report([]) == "No entities are shared across categories."


# --- merging reuses the resolution logic (aliases / provenance union) -------


def test_merged_node_unions_provenance_from_both_categories() -> None:
    peru = _normalize(
        "peruvian-dishes",
        _record("Ceviche", "Q12345", **{"source": "wikidata"}),
    )
    # Same entity, different source value, so the merge must union provenance.
    seafood_record = RawRecord(
        fields={"title": "Ceviche", "lang": "es", "wikidata_qid": "Q12345"},
        provenance=_provenance(source="petscan"),
    )
    seafood = normalize_records([seafood_record], _category("seafood-dishes"))
    result = stitch_categories([peru, seafood])

    shared_csid = mint_csid("Dish", qid="Q12345")
    (node,) = _nodes_with_csid(result.nodes, shared_csid)
    source = node["source"]
    assert isinstance(source, str)
    sources = source.split(";")
    assert "wikidata" in sources
    assert "petscan" in sources


# --- degenerate inputs ------------------------------------------------------


def test_single_category_has_no_shared_entities() -> None:
    peru = _normalize("peruvian-dishes", _SHARED, _PERU_ONLY)
    result = stitch_categories([peru])

    assert result.shared == []
    assert result.nodes == peru.nodes


def test_empty_input_yields_empty_result() -> None:
    result = stitch_categories([])
    assert result.nodes == []
    assert result.edges == []
    assert result.shared == []
