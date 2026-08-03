"""Tests for the Wikidata SPARQL source adapter.

A fake transport replays a recorded SPARQL JSON fixture through the real cached
:class:`~pinakes_engine.acquire.http.HttpClient`, so the adapter's request shape,
binding-to-record mapping, and provenance are exercised without live network.
"""

from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path

import pytest

from pinakes_engine.acquire import (
    CategorySpec,
    HttpClient,
    HttpResponse,
    RawRecord,
    SourceSpec,
    WikidataSparqlAdapter,
    WikidataSparqlError,
)
from pinakes_engine.acquire.wikidata import WIKIDATA_SPARQL_ENDPOINT

_FIXTURE = Path(__file__).parent / "fixtures" / "sparql" / "peruvian_dishes.json"
_QUERY = (
    "SELECT ?item ?itemLabel ?image WHERE {\n"
    "  ?item wdt:P31 wd:Q746549 .\n"
    '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }\n'
    "}"
)
_FIXED_NOW = datetime(2026, 6, 16, 12, 0, 0, tzinfo=UTC)


class _FakeTransport:
    """Transport that returns a fixed body and records the calls made."""

    def __init__(self, body: str, status_code: int = 200) -> None:
        self._body = body
        self._status_code = status_code
        self.calls: list[tuple[str, str, dict[str, str]]] = []

    def request(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, str] | None,
        headers: Mapping[str, str],
        timeout: float,
    ) -> HttpResponse:
        self.calls.append((method, url, dict(params or {})))
        return HttpResponse(
            url=url, status_code=self._status_code, text=self._body, headers={}
        )


def _client(tmp_path: Path, transport: _FakeTransport) -> HttpClient:
    return HttpClient(
        cache_dir=tmp_path,
        min_interval=0.0,
        transport=transport,
        sleep=lambda _: None,
    )


def _adapter(client: HttpClient) -> WikidataSparqlAdapter:
    return WikidataSparqlAdapter(client, now=lambda: _FIXED_NOW)


def _spec(query: str | None = _QUERY) -> CategorySpec:
    return CategorySpec(
        id="peruvian-dishes",
        label="Dish;CulturalArtifact",
        description="Every Peruvian dish",
        source=SourceSpec(type="wikidata-sparql", query=query),
        dimensions=("geographic",),
    )


def _fixture_text() -> str:
    return _FIXTURE.read_text(encoding="utf-8")


def _fetch(tmp_path: Path) -> list[RawRecord]:
    """Run the adapter over the recorded fixture and return its records."""
    adapter = _adapter(_client(tmp_path, _FakeTransport(_fixture_text())))
    return list(adapter.fetch(_spec()))


def test_request_sends_query_and_json_format(tmp_path: Path) -> None:
    transport = _FakeTransport(_fixture_text())
    list(_adapter(_client(tmp_path, transport)).fetch(_spec()))

    method, url, params = transport.calls[0]
    assert method == "GET"
    assert url == WIKIDATA_SPARQL_ENDPOINT
    assert params == {"query": _QUERY, "format": "json"}


def test_each_binding_becomes_a_record(tmp_path: Path) -> None:
    assert len(_fetch(tmp_path)) == 2


def test_record_preserves_qid_and_selected_variables(tmp_path: Path) -> None:
    first = _fetch(tmp_path)[0]
    assert first.fields["qid"] == "Q207058"
    assert first.fields["item"] == "http://www.wikidata.org/entity/Q207058"
    assert first.fields["itemLabel"] == "ceviche"
    assert "image" in first.fields


def test_unbound_optional_variable_is_omitted(tmp_path: Path) -> None:
    second = _fetch(tmp_path)[1]
    assert second.fields["qid"] == "Q2734670"
    assert second.fields["itemLabel"] == "lomo saltado"
    assert "image" not in second.fields  # OPTIONAL was unbound for this row


def test_provenance_points_at_item_and_query(tmp_path: Path) -> None:
    prov = _fetch(tmp_path)[0].provenance
    assert prov.source == "wikidata"
    assert prov.source_url == "http://www.wikidata.org/entity/Q207058"
    assert prov.source_query == _QUERY
    assert prov.retrieved_at == "2026-06-16T12:00:00+00:00"
    assert prov.confidence == 1.0


def test_second_fetch_is_served_from_cache(tmp_path: Path) -> None:
    transport = _FakeTransport(_fixture_text())
    adapter = _adapter(_client(tmp_path, transport))

    list(adapter.fetch(_spec()))
    list(adapter.fetch(_spec()))

    assert len(transport.calls) == 1  # second query served from disk cache


def test_missing_query_raises(tmp_path: Path) -> None:
    adapter = _adapter(_client(tmp_path, _FakeTransport(_fixture_text())))
    with pytest.raises(WikidataSparqlError, match="no source.query"):
        list(adapter.fetch(_spec(query=None)))


def test_error_status_raises(tmp_path: Path) -> None:
    transport = _FakeTransport("upstream boom", status_code=500)
    adapter = WikidataSparqlAdapter(
        _client_no_retry(tmp_path, transport), now=lambda: _FIXED_NOW
    )
    with pytest.raises(WikidataSparqlError, match="status 500"):
        list(adapter.fetch(_spec()))


def test_non_json_body_raises(tmp_path: Path) -> None:
    transport = _FakeTransport("<html>not json</html>")
    adapter = _adapter(_client(tmp_path, transport))
    with pytest.raises(WikidataSparqlError, match="non-JSON"):
        list(adapter.fetch(_spec()))


def test_adapter_declares_registry_metadata() -> None:
    assert WikidataSparqlAdapter.name == "wikidata-sparql"
    assert WikidataSparqlAdapter.source_type == "wikidata-sparql"


def _client_no_retry(tmp_path: Path, transport: _FakeTransport) -> HttpClient:
    return HttpClient(
        cache_dir=tmp_path,
        min_interval=0.0,
        max_retries=0,
        transport=transport,
        sleep=lambda _: None,
    )
