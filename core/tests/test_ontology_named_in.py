"""Tests for the ``NAMED_IN`` naming linker."""

from __future__ import annotations

from culturescrape.ontology import (
    DEFAULT_REGISTRY,
    Dimension,
    Pipeline,
)
from culturescrape.ontology.named_in import NAMED_IN_FIELD, NamedInLinker
from culturescrape.schema.tsvio import Row

_PROVENANCE: dict[str, str] = {
    "source": "wikidata",
    "source_url": "https://www.wikidata.org/wiki/",
    "retrieved_at": "2026-06-16T00:00:00+00:00",
    "confidence": "1.0",
}


def _entity(csid: str, langs: list[str]) -> Row:
    return {
        "csid": csid,
        ":LABEL": ["Dish"],
        "name": "x",
        NAMED_IN_FIELD: langs,
        **_PROVENANCE,
    }


def test_named_in_emits_one_edge_per_attested_language() -> None:
    result = NamedInLinker().link_named([_entity("cs:dish:Q1", ["en", "es"])], [])
    pairs = {(e[":START_ID"], e[":END_ID"], e[":TYPE"]) for e in result.edges}
    assert pairs == {
        ("cs:dish:Q1", "cs:language:lang-en", "NAMED_IN"),
        ("cs:dish:Q1", "cs:language:lang-es", "NAMED_IN"),
    }
    # The two languages are minted as Language nodes at the linguistic linker's
    # id scheme so the two linkers' languages coincide.
    created = {n["csid"]: n for n in result.nodes}
    assert set(created) == {"cs:language:lang-en", "cs:language:lang-es"}
    assert created["cs:language:lang-en"][":LABEL"] == ["Language"]
    assert created["cs:language:lang-en"]["language_code"] == "en"


def test_named_in_reuses_an_existing_language_node() -> None:
    existing: Row = {
        "csid": "cs:language:custom-en",
        ":LABEL": ["Language"],
        "name": "English",
        "language_code": "en",
        **_PROVENANCE,
    }
    result = NamedInLinker().link_named(
        [existing, _entity("cs:dish:Q1", ["en"])], []
    )
    # The edge points at the pre-existing language; no new language is minted.
    assert result.edges[0][":END_ID"] == "cs:language:custom-en"
    assert result.nodes == []


def test_named_in_is_inert_without_the_field() -> None:
    node: Row = {"csid": "cs:dish:Q1", ":LABEL": ["Dish"], "name": "x", **_PROVENANCE}
    result = NamedInLinker().link_named([node], [])
    assert result.edges == []
    assert result.nodes == []


def test_named_in_does_not_duplicate_an_existing_edge() -> None:
    existing_edge: Row = {
        ":START_ID": "cs:dish:Q1",
        ":END_ID": "cs:language:lang-en",
        ":TYPE": "NAMED_IN",
    }
    result = NamedInLinker().link_named(
        [_entity("cs:dish:Q1", ["en"])], [existing_edge]
    )
    assert result.edges == []


def test_named_in_registered_in_the_linguistic_dimension() -> None:
    linkers = DEFAULT_REGISTRY.by_dimension(Dimension.LINGUISTIC)
    assert "named_in" in {linker.name for linker in linkers}
    # It runs after the linguistic linker so it reuses the languages that one mints.
    order = [linker.name for linker in Pipeline.from_registry(
        DEFAULT_REGISTRY, [Dimension.LINGUISTIC]
    ).linkers]
    assert order.index("named_in") > order.index("linguistic")
