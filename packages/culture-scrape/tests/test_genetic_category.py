"""The shipped genetic category spec must load and stay tied to the ontology.

``categories/derived-cocktails.yml`` is the ingestible genetic (cultural-lineage,
not biological) source chosen in ``docs/sources-genetic.md`` (Wikidata's
``based on`` / P144 derivation links). These tests pin that it parses against the
loader, requests the genetic dimension, keeps the verified derivation query, and
mints only edges the relationship-type registry actually defines — so the spec
cannot drift away from the ontology it depends on.
"""

from pathlib import Path

from culturescrape.acquire import CategorySpec, load_category
from culturescrape.ontology import lookup

_SPEC_PATH = (
    Path(__file__).resolve().parent.parent
    / "categories"
    / "derived-cocktails.yml"
)


def _spec() -> CategorySpec:
    return load_category(_SPEC_PATH)


def test_genetic_category_loads() -> None:
    spec = _spec()

    assert isinstance(spec, CategorySpec)
    assert spec.id == "derived-cocktails"
    assert spec.source.type == "wikidata-sparql"
    assert "genetic" in spec.dimensions


def test_query_pulls_derivation_edges() -> None:
    # The runnable demonstration query must keep using the verified Wikidata
    # `based on` derivation property (see docs/sources-genetic.md).
    query = _spec().source.query or ""

    assert "wdt:P144" in query  # based on = DERIVED_FROM expression
    assert "wd:Q134768" in query  # cocktail


def test_links_are_registered_genetic_edges() -> None:
    spec = _spec()

    assert spec.links, "the genetic category must mint at least one edge"
    for link in spec.links:
        rel = lookup(link.type)  # raises if the :TYPE is not in the registry
        assert link.to == rel.range
    assert any(link.type == "DERIVED_FROM" for link in spec.links)
