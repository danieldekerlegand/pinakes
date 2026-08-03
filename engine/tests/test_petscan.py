"""Tests for the PetScan source adapter.

A fake transport replays a recorded PetScan JSON fixture through the real cached
:class:`~pinakes_engine.acquire.http.HttpClient`, so the adapter's request shape,
page-to-record mapping, and provenance are exercised without live network.
"""

from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path

import pytest

from pinakes_engine.acquire import (
    CategorySpec,
    HttpClient,
    HttpResponse,
    PetScanAdapter,
    PetScanError,
    RawRecord,
    SourceSpec,
)
from pinakes_engine.acquire.petscan import PETSCAN_ENDPOINT

_FIXTURE = Path(__file__).parent / "fixtures" / "petscan" / "peruvian_dishes.json"
_PARAMS = {
    "language": "es",
    "project": "wikipedia",
    "categories": "Gastronomía de Perú",
    "depth": "2",
    "combination": "subset",
}
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


def _adapter(client: HttpClient) -> PetScanAdapter:
    return PetScanAdapter(client, now=lambda: _FIXED_NOW)


def _spec(params: dict[str, str] | None = None) -> CategorySpec:
    return CategorySpec(
        id="peruvian-dishes",
        label="Dish;CulturalArtifact",
        description="Every Peruvian dish",
        source=SourceSpec(
            type="petscan", params=_PARAMS if params is None else params
        ),
        dimensions=("geographic",),
    )


def _fixture_text() -> str:
    return _FIXTURE.read_text(encoding="utf-8")


def _fetch(tmp_path: Path) -> list[RawRecord]:
    """Run the adapter over the recorded fixture and return its records."""
    adapter = _adapter(_client(tmp_path, _FakeTransport(_fixture_text())))
    return list(adapter.fetch(_spec()))


def test_request_sends_petscan_params_and_json_format(tmp_path: Path) -> None:
    transport = _FakeTransport(_fixture_text())
    list(_adapter(_client(tmp_path, transport)).fetch(_spec()))

    method, url, params = transport.calls[0]
    assert method == "GET"
    assert url == PETSCAN_ENDPOINT
    assert params["categories"] == "Gastronomía de Perú"
    assert params["depth"] == "2"
    assert params["combination"] == "subset"
    assert params["format"] == "json"
    assert params["doit"] == "1"


def test_optional_wdqs_param_is_forwarded(tmp_path: Path) -> None:
    transport = _FakeTransport(_fixture_text())
    params = {**_PARAMS, "sparql": "SELECT ?item WHERE { ?item wdt:P17 wd:Q419 }"}
    list(_adapter(_client(tmp_path, transport)).fetch(_spec(params)))

    _, _, sent = transport.calls[0]
    assert sent["sparql"] == "SELECT ?item WHERE { ?item wdt:P17 wd:Q419 }"


def test_each_page_becomes_a_record(tmp_path: Path) -> None:
    assert len(_fetch(tmp_path)) == 2


def test_record_carries_title_pageid_and_qid(tmp_path: Path) -> None:
    first = _fetch(tmp_path)[0]
    assert first.fields["title"] == "Ceviche"
    assert first.fields["pageid"] == "207058"
    assert first.fields["namespace"] == "0"
    assert first.fields["qid"] == "Q207058"


def test_qid_omitted_when_absent(tmp_path: Path) -> None:
    second = _fetch(tmp_path)[1]
    assert second.fields["title"] == "Lomo saltado"
    assert second.fields["pageid"] == "2734670"
    assert "qid" not in second.fields  # no metadata.wikidata for this page


def test_provenance_points_at_page_and_query(tmp_path: Path) -> None:
    prov = _fetch(tmp_path)[0].provenance
    assert prov.source == "petscan"
    assert prov.source_url == "https://es.wikipedia.org/wiki/Ceviche"
    assert prov.source_query.startswith(PETSCAN_ENDPOINT)
    assert "categories=" in prov.source_query
    assert "format=json" in prov.source_query
    assert prov.retrieved_at == "2026-06-16T12:00:00+00:00"
    assert prov.confidence == 1.0


def test_page_url_encodes_spaces_as_underscores(tmp_path: Path) -> None:
    prov = _fetch(tmp_path)[1].provenance
    assert prov.source_url == "https://es.wikipedia.org/wiki/Lomo_saltado"


def test_second_fetch_is_served_from_cache(tmp_path: Path) -> None:
    transport = _FakeTransport(_fixture_text())
    adapter = _adapter(_client(tmp_path, transport))

    list(adapter.fetch(_spec()))
    list(adapter.fetch(_spec()))

    assert len(transport.calls) == 1  # second query served from disk cache


def test_missing_categories_and_sparql_raises(tmp_path: Path) -> None:
    adapter = _adapter(_client(tmp_path, _FakeTransport(_fixture_text())))
    with pytest.raises(PetScanError, match="no PetScan 'categories'"):
        list(adapter.fetch(_spec({"depth": "1"})))


def test_error_status_raises(tmp_path: Path) -> None:
    transport = _FakeTransport("upstream boom", status_code=500)
    adapter = PetScanAdapter(
        _client_no_retry(tmp_path, transport), now=lambda: _FIXED_NOW
    )
    with pytest.raises(PetScanError, match="status 500"):
        list(adapter.fetch(_spec()))


def test_non_json_body_raises(tmp_path: Path) -> None:
    transport = _FakeTransport("<html>not json</html>")
    adapter = _adapter(_client(tmp_path, transport))
    with pytest.raises(PetScanError, match="non-JSON"):
        list(adapter.fetch(_spec()))


def test_adapter_declares_registry_metadata() -> None:
    assert PetScanAdapter.name == "petscan"
    assert PetScanAdapter.source_type == "petscan"


def _client_no_retry(tmp_path: Path, transport: _FakeTransport) -> HttpClient:
    return HttpClient(
        cache_dir=tmp_path,
        min_interval=0.0,
        max_retries=0,
        transport=transport,
        sleep=lambda _: None,
    )
