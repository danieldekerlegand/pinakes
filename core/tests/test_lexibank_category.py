"""The Lexibank ABVD category spec loads, stamps provenance, and feeds the linker.

``categories/lexibank-abvd.yml`` folds a Lexibank CLDF wordlist into the corpus with
no new adapter code (source-breadth US-003). These tests pin that it parses, that the
tabular-dump adapter stamps ABVD's per-record ``CC-BY-4.0`` licence and lifts the
glottocode / ISO / cognate-set cells the reconciler and linker read, and that mapping
+ linking the committed fixture yields ``COGNATE_WITH`` cognate stars — the whole
category-only path, offline.
"""

from __future__ import annotations

from pathlib import Path

from culturescrape.acquire.categories import load_category
from culturescrape.acquire.factory import build_adapter
from culturescrape.acquire.http import HttpClient
from culturescrape.ontology import lookup
from culturescrape.ontology.linguistic import LinguisticLinker
from culturescrape.schema.mapper import map_records

_PACKAGE_ROOT = Path(__file__).resolve().parent.parent
_SPEC_PATH = _PACKAGE_ROOT / "inputs" / "categories" / "lexibank-abvd.yml"


def _spec():
    return load_category(_SPEC_PATH)


def test_category_loads_and_requests_the_linguistic_dimension() -> None:
    spec = _spec()
    assert spec.id == "lexibank-abvd"
    assert spec.label == "Wordform"
    assert spec.source.type == "dump"
    assert spec.source.params["adapter"] == "tabular-dump"
    assert "linguistic" in spec.dimensions


def test_links_are_registered_cognate_edges() -> None:
    for link in _spec().links:
        rel = lookup(link.type)  # raises if the :TYPE is not registered
        assert link.to == rel.range
    assert any(link.type == "COGNATE_WITH" for link in _spec().links)


def test_adapter_stamps_license_and_lifts_reconcile_keys(tmp_path: Path) -> None:
    spec = _spec()
    adapter = build_adapter(spec, http_factory=lambda: HttpClient(cache_dir=tmp_path))
    records = list(adapter.fetch(spec))

    assert records, "fixture yielded no records"
    assert {r.provenance.license for r in records} == {"CC-BY-4.0"}
    assert {r.provenance.source for r in records} == {"lexibank-abvd"}
    # The glottocode reaches language_code, the ISO 639-3 code reaches lang, and the
    # cognate-set id rides through under `cognateset`.
    assert all(r.fields.get("language_code") for r in records)
    assert all(r.fields.get("lang") for r in records)
    assert any(r.fields.get("cognateset") for r in records)


def test_fixture_maps_to_wordform_nodes_with_cognate_stars(tmp_path: Path) -> None:
    spec = _spec()
    adapter = build_adapter(spec, http_factory=lambda: HttpClient(cache_dir=tmp_path))
    nodes = map_records(list(adapter.fetch(spec)), spec)

    assert nodes and all(n[":LABEL"] == ["Wordform"] for n in nodes)
    # The cognate-set id lands in the overflow (an unmapped cell), not a top-level
    # column — so it survives the normalize→disk→link round-trip build_corpus runs.
    assert all("cognateset" not in n for n in nodes)

    edges = LinguisticLinker().link_linguistic(nodes, []).edges
    cognate = [e for e in edges if e[":TYPE"] == "COGNATE_WITH"]
    # five-1 (4 members → 3 edges) + two-2 (3 members → 2 edges) = 5; singletons none.
    assert len(cognate) == 5
