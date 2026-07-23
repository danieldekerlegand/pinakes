"""The kaikki category + JSONL adapter ingest wordforms with etymology edges (US-004).

``categories/kaikki.yml`` folds a kaikki.org Wiktionary extract into the corpus via the
dedicated ``kaikki`` JSONL adapter. These tests pin that the category parses, that the
adapter stamps the per-record CC-BY-SA licence + provenance and lifts the head word /
language code / etymology-relations cell, that it never touches the network, and that
mapping + linking the committed fixture yields the canonical BORROWED_FROM /
DERIVED_FROM / COGNATE_WITH edges to the source-side terms.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from culturescrape.acquire.categories import load_category
from culturescrape.acquire.factory import build_adapter
from culturescrape.acquire.http import HttpClient
from culturescrape.acquire.kaikki import (
    ETYMOLOGY_RELATIONS_FIELD,
    KaikkiAdapter,
    KaikkiError,
)
from culturescrape.ontology import lookup
from culturescrape.ontology.linguistic import LinguisticLinker
from culturescrape.schema.mapper import map_records

_PACKAGE_ROOT = Path(__file__).resolve().parent.parent
_SPEC_PATH = _PACKAGE_ROOT / "categories" / "kaikki.yml"
_FIXTURE = _PACKAGE_ROOT / "tests" / "fixtures" / "kaikki" / "etymology.jsonl"

_FIXED_NOW = datetime(2026, 7, 13, tzinfo=UTC)


def _spec():
    return load_category(_SPEC_PATH)


def test_category_loads_and_requests_the_linguistic_dimension() -> None:
    spec = _spec()
    assert spec.id == "kaikki"
    assert spec.label == "Wordform"
    assert spec.source.type == "dump"
    assert spec.source.params["adapter"] == "kaikki"
    assert "linguistic" in spec.dimensions


def test_links_are_registered_edges_matching_their_range() -> None:
    types = set()
    for link in _spec().links:
        rel = lookup(link.type)  # raises if the :TYPE is not registered
        assert link.to == rel.range
        types.add(link.type)
    assert types == {"BORROWED_FROM", "DERIVED_FROM", "COGNATE_WITH"}


def test_factory_selects_the_kaikki_adapter() -> None:
    adapter = build_adapter(_spec(), http_factory=_raise_on_network)
    assert isinstance(adapter, KaikkiAdapter)


def test_adapter_stamps_license_and_lifts_fields() -> None:
    spec = _spec()
    adapter = KaikkiAdapter(now=lambda: _FIXED_NOW)
    records = list(adapter.fetch(spec))

    assert records, "fixture yielded no records"
    assert {r.provenance.license for r in records} == {"CC-BY-SA-3.0"}
    assert {r.provenance.source for r in records} == {"kaikki"}
    assert {r.provenance.retrieved_at for r in records} == {_FIXED_NOW.isoformat()}
    assert all(r.fields.get("name") for r in records)
    assert all(r.fields.get("lang") for r in records)
    # Most entries carry etymology relations (the whole point of the ingest).
    assert any(r.fields.get(ETYMOLOGY_RELATIONS_FIELD) for r in records)


def test_adapter_never_touches_the_network() -> None:
    # A dump adapter must resolve entirely from local disk.
    adapter = build_adapter(_spec(), http_factory=_raise_on_network)
    assert list(adapter.fetch(_spec()))


def test_fixture_maps_to_wordform_nodes_with_etymology_edges() -> None:
    spec = _spec()
    adapter = KaikkiAdapter(now=lambda: _FIXED_NOW)
    nodes = map_records(list(adapter.fetch(spec)), spec)

    assert nodes and all(n[":LABEL"] == ["Wordform"] for n in nodes)
    # The relations cell lands in the overflow (unmapped), not a top-level column, so
    # it survives the normalize → disk → link round-trip build_corpus runs.
    assert all(ETYMOLOGY_RELATIONS_FIELD not in n for n in nodes)

    edges = LinguisticLinker().link_linguistic(nodes, []).edges
    by_type: dict[str, int] = {}
    for edge in edges:
        by_type[edge[":TYPE"]] = by_type.get(edge[":TYPE"], 0) + 1
    assert by_type["BORROWED_FROM"] == 2
    assert by_type["DERIVED_FROM"] == 4
    assert by_type["COGNATE_WITH"] == 2


def _raise_on_network() -> HttpClient:
    raise AssertionError("kaikki is a dump adapter; it must not build an HttpClient")


def test_reading_a_missing_extract_raises() -> None:
    spec = _spec()
    object.__setattr__(spec.source, "query", "does/not/exist.jsonl")
    with pytest.raises(KaikkiError):
        list(KaikkiAdapter().fetch(spec))


def test_malformed_jsonl_line_raises(tmp_path: Path) -> None:
    bad = tmp_path / "bad.jsonl"
    bad.write_text('{"word": "ok", "lang_code": "en"}\nnot json\n', encoding="utf-8")
    spec = _spec()
    object.__setattr__(spec.source, "query", str(bad))
    with pytest.raises(KaikkiError):
        list(KaikkiAdapter().fetch(spec))
