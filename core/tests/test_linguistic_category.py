"""The shipped linguistic category spec must load and stay tied to the ontology.

``categories/indo-european-languages.yml`` is the ingestible linguistic source
chosen in ``docs/sources-linguistic.md`` (Wikidata's language-family tree). These
tests pin that it parses against the loader, requests the linguistic dimension,
and mints only edges the relationship-type registry actually defines — so the
spec cannot drift away from the ontology it depends on.
"""

from pathlib import Path

from culturescrape.acquire import CategorySpec, load_category
from culturescrape.ontology import lookup

_SPEC_PATH = (
    Path(__file__).resolve().parent.parent
    / "inputs" / "categories"
    / "indo-european-languages.yml"
)


def _spec() -> CategorySpec:
    return load_category(_SPEC_PATH)


def test_linguistic_category_loads() -> None:
    spec = _spec()

    assert isinstance(spec, CategorySpec)
    assert spec.id == "indo-european-languages"
    assert spec.source.type == "wikidata-sparql"
    assert "linguistic" in spec.dimensions


def test_query_targets_the_language_family_tree() -> None:
    # The runnable demonstration query must keep using the verified Wikidata
    # subclass-of chain rooted at Indo-European (see docs/sources-linguistic.md).
    query = _spec().source.query or ""

    assert "wdt:P279" in query  # subclass of = DESCENDS_FROM expression
    assert "wd:Q19860" in query  # Indo-European family root


def test_links_are_registered_linguistic_edges() -> None:
    spec = _spec()

    assert spec.links, "the linguistic category must mint at least one edge"
    for link in spec.links:
        rel = lookup(link.type)  # raises if the :TYPE is not in the registry
        assert link.to == rel.range
    assert any(link.type == "DESCENDS_FROM" for link in spec.links)
