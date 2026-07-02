"""Tests for the raw-wikitext source adapter.

A fake transport replays a recorded MediaWiki ``action=parse`` fixture — whose
wikitext holds both a ``wikitable`` and an ``Infobox food`` — through the real
cached :class:`~culturescrape.acquire.http.HttpClient`, so the adapter's request
shape, table/template extraction, and provenance are exercised without live
network.
"""

from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path

import pytest

from culturescrape.acquire import (
    CategorySpec,
    HttpClient,
    HttpResponse,
    RawRecord,
    SourceSpec,
    WikitextAdapter,
    WikitextError,
)

_FIXTURE = (
    Path(__file__).parent / "fixtures" / "wikitext" / "peruvian_dishes.json"
)
_PARAMS = {
    "language": "en",
    "project": "wikipedia",
    "template": "Infobox food",
}
_PAGE = "List of Peruvian dishes"
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


def _client_no_retry(tmp_path: Path, transport: _FakeTransport) -> HttpClient:
    return HttpClient(
        cache_dir=tmp_path,
        min_interval=0.0,
        max_retries=0,
        transport=transport,
        sleep=lambda _: None,
    )


def _adapter(client: HttpClient) -> WikitextAdapter:
    return WikitextAdapter(client, now=lambda: _FIXED_NOW)


def _spec(
    params: dict[str, str] | None = None, query: str | None = _PAGE
) -> CategorySpec:
    return CategorySpec(
        id="peruvian-dishes",
        label="Dish;CulturalArtifact",
        description="Every Peruvian dish",
        source=SourceSpec(
            type="wikitext",
            query=query,
            params=_PARAMS if params is None else params,
        ),
        dimensions=("geographic",),
    )


def _fixture_text() -> str:
    return _FIXTURE.read_text(encoding="utf-8")


def _fetch(
    tmp_path: Path, spec: CategorySpec | None = None
) -> list[RawRecord]:
    adapter = _adapter(_client(tmp_path, _FakeTransport(_fixture_text())))
    return list(adapter.fetch(spec if spec is not None else _spec()))


def test_request_asks_api_for_page_wikitext(tmp_path: Path) -> None:
    transport = _FakeTransport(_fixture_text())
    list(_adapter(_client(tmp_path, transport)).fetch(_spec()))

    method, url, params = transport.calls[0]
    assert method == "GET"
    assert url == "https://en.wikipedia.org/w/api.php"
    assert params["action"] == "parse"
    assert params["page"] == _PAGE
    assert params["prop"] == "wikitext"
    assert params["format"] == "json"
    assert params["formatversion"] == "2"


def test_table_rows_become_records_keyed_by_header(tmp_path: Path) -> None:
    table_rows = [
        r for r in _fetch(tmp_path) if "Dish" in r.fields
    ]
    assert len(table_rows) == 3
    assert table_rows[0].fields == {
        "Dish": "Ceviche",
        "Region": "Lima",
        "Year": "1820",
    }
    assert table_rows[1].fields["Dish"] == "Lomo saltado"
    assert table_rows[2].fields["Region"] == "Cusco"


def test_cell_attributes_are_stripped(tmp_path: Path) -> None:
    # The first row's Region cell carries a ``style="..."`` attribute prefix.
    first = next(r for r in _fetch(tmp_path) if r.fields.get("Dish") == "Ceviche")
    assert first.fields["Region"] == "Lima"


def test_named_template_becomes_a_record(tmp_path: Path) -> None:
    infobox = next(r for r in _fetch(tmp_path) if "course" in r.fields)
    assert infobox.fields == {
        "name": "Ceviche",
        "country": "Peru",
        "region": "Lima",
        "course": "Appetizer",
        "main_ingredient": "Fish, lime, onion",
    }


def test_template_omitted_when_not_requested(tmp_path: Path) -> None:
    records = _fetch(tmp_path, _spec({"language": "en", "project": "wikipedia"}))
    assert all("course" not in r.fields for r in records)
    assert len(records) == 3  # table rows only


def test_provenance_points_at_page_and_query(tmp_path: Path) -> None:
    prov = _fetch(tmp_path)[0].provenance
    assert prov.source == "wikitext"
    assert prov.source_url == (
        "https://en.wikipedia.org/wiki/List_of_Peruvian_dishes"
    )
    assert prov.source_query == _PAGE
    assert prov.retrieved_at == "2026-06-16T12:00:00+00:00"
    assert prov.confidence == 1.0


def test_page_title_may_come_from_params(tmp_path: Path) -> None:
    spec = _spec(
        {"page": _PAGE, "language": "en", "project": "wikipedia"}, query=None
    )
    records = _fetch(tmp_path, spec)
    assert records[0].provenance.source_query == _PAGE


def test_second_fetch_is_served_from_cache(tmp_path: Path) -> None:
    transport = _FakeTransport(_fixture_text())
    adapter = _adapter(_client(tmp_path, transport))

    list(adapter.fetch(_spec()))
    list(adapter.fetch(_spec()))

    assert len(transport.calls) == 1  # second fetch served from disk cache


def test_missing_page_title_raises(tmp_path: Path) -> None:
    adapter = _adapter(_client(tmp_path, _FakeTransport(_fixture_text())))
    with pytest.raises(WikitextError, match="no page title"):
        list(adapter.fetch(_spec({}, query=None)))


def test_api_error_body_raises(tmp_path: Path) -> None:
    body = '{"error": {"code": "missingtitle", "info": "no such page"}}'
    adapter = _adapter(_client(tmp_path, _FakeTransport(body)))
    with pytest.raises(WikitextError, match="no such page"):
        list(adapter.fetch(_spec()))


def test_error_status_raises(tmp_path: Path) -> None:
    transport = _FakeTransport("upstream boom", status_code=500)
    adapter = WikitextAdapter(
        _client_no_retry(tmp_path, transport), now=lambda: _FIXED_NOW
    )
    with pytest.raises(WikitextError, match="status 500"):
        list(adapter.fetch(_spec()))


def test_non_json_body_raises(tmp_path: Path) -> None:
    adapter = _adapter(_client(tmp_path, _FakeTransport("<html>nope</html>")))
    with pytest.raises(WikitextError, match="non-JSON"):
        list(adapter.fetch(_spec()))


def test_adapter_declares_registry_metadata() -> None:
    assert WikitextAdapter.name == "wikitext"
    assert WikitextAdapter.source_type == "wikitext"
