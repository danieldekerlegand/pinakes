"""Tests for the generic HTML-scraping (last-resort) source adapter.

A fake transport routes ``robots.txt`` and the target page through the real
cached :class:`~pinakes_engine.acquire.http.HttpClient`, replaying a recorded HTML
fixture so the adapter's selector extraction, robots handling, caching, and
provenance are exercised without live network.
"""

from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path

import pytest

from pinakes_engine.acquire import (
    DEFAULT_HTML_CONFIDENCE,
    CategorySpec,
    HtmlScrapeAdapter,
    HtmlScrapeError,
    HttpClient,
    HttpResponse,
    RawRecord,
    SourceSpec,
)

_FIXTURE = Path(__file__).parent / "fixtures" / "html" / "peruvian_dishes.html"
_URL = "https://almanac.example/peru"
_ROBOTS_URL = "https://almanac.example/robots.txt"
_ALLOW_ALL_ROBOTS = "User-agent: *\nDisallow:\n"
_DISALLOW_ALL_ROBOTS = "User-agent: *\nDisallow: /\n"
_FIXED_NOW = datetime(2026, 6, 16, 12, 0, 0, tzinfo=UTC)

_CSS_PARAMS = {
    "url": _URL,
    "selector_type": "css",
    "row_selector": "tr.dish",
    "field.name": "td.name",
    "field.region": "td.region",
    "field.year": "td.year",
}


class _FakeTransport:
    """Transport returning a per-URL body, recording the calls made."""

    def __init__(self, bodies: dict[str, tuple[str, int]]) -> None:
        self._bodies = bodies
        self.calls: list[tuple[str, str]] = []

    def request(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, str] | None,
        headers: Mapping[str, str],
        timeout: float,
    ) -> HttpResponse:
        self.calls.append((method, url))
        body, status = self._bodies.get(url, ("not found", 404))
        return HttpResponse(url=url, status_code=status, text=body, headers={})


def _fixture_text() -> str:
    return _FIXTURE.read_text(encoding="utf-8")


def _bodies(
    *, robots: tuple[str, int] = (_ALLOW_ALL_ROBOTS, 200),
    page: tuple[str, int] | None = None,
) -> dict[str, tuple[str, int]]:
    return {
        _ROBOTS_URL: robots,
        _URL: page if page is not None else (_fixture_text(), 200),
    }


def _client(tmp_path: Path, transport: _FakeTransport) -> HttpClient:
    return HttpClient(
        cache_dir=tmp_path,
        min_interval=0.0,
        max_retries=0,
        transport=transport,
        sleep=lambda _: None,
    )


def _adapter(client: HttpClient) -> HtmlScrapeAdapter:
    return HtmlScrapeAdapter(client, now=lambda: _FIXED_NOW)


def _spec(params: dict[str, str] | None = None) -> CategorySpec:
    return CategorySpec(
        id="peruvian-dishes",
        label="Dish;CulturalArtifact",
        description="Every Peruvian dish",
        source=SourceSpec(
            type="http",
            query=None,
            params=_CSS_PARAMS if params is None else params,
        ),
        dimensions=("geographic",),
    )


def _fetch(
    tmp_path: Path,
    spec: CategorySpec | None = None,
    *,
    bodies: dict[str, tuple[str, int]] | None = None,
) -> list[RawRecord]:
    transport = _FakeTransport(bodies if bodies is not None else _bodies())
    adapter = _adapter(_client(tmp_path, transport))
    return list(adapter.fetch(spec if spec is not None else _spec()))


def test_rows_become_records_keyed_by_field_selectors(tmp_path: Path) -> None:
    records = _fetch(tmp_path)
    assert len(records) == 3
    assert records[0].fields == {
        "name": "Ceviche",
        "region": "Lima",
        "year": "1820",
    }
    assert records[1].fields["name"] == "Lomo saltado"
    assert records[2].fields["region"] == "Arequipa"


def test_xpath_selectors_supported(tmp_path: Path) -> None:
    params = {
        "url": _URL,
        "selector_type": "xpath",
        "row_selector": "//tr[@class='dish']",
        "field.name": "td[@class='name']/text()",
        "field.region": "td[@class='region']",
    }
    records = _fetch(tmp_path, _spec(params))
    assert [r.fields["name"] for r in records] == [
        "Ceviche",
        "Lomo saltado",
        "Rocoto relleno",
    ]
    assert records[0].fields["region"] == "Lima"


def test_provenance_is_best_effort_http(tmp_path: Path) -> None:
    prov = _fetch(tmp_path)[0].provenance
    assert prov.source == "http"
    assert prov.source_url == _URL
    assert prov.source_query == "tr.dish"
    assert prov.retrieved_at == "2026-06-16T12:00:00+00:00"
    assert prov.confidence == DEFAULT_HTML_CONFIDENCE
    assert prov.confidence < 1.0  # deliberately low: scraping is brittle


def test_robots_checked_before_page_is_fetched(tmp_path: Path) -> None:
    transport = _FakeTransport(_bodies())
    list(_adapter(_client(tmp_path, transport)).fetch(_spec()))

    assert transport.calls[0] == ("GET", _ROBOTS_URL)
    assert transport.calls[1] == ("GET", _URL)


def test_disallowed_url_raises_and_is_not_fetched(tmp_path: Path) -> None:
    transport = _FakeTransport(_bodies(robots=(_DISALLOW_ALL_ROBOTS, 200)))
    adapter = _adapter(_client(tmp_path, transport))
    with pytest.raises(HtmlScrapeError, match="robots.txt disallows"):
        list(adapter.fetch(_spec()))
    assert all(url != _URL for _, url in transport.calls)


def test_missing_robots_allows_fetch(tmp_path: Path) -> None:
    records = _fetch(tmp_path, bodies=_bodies(robots=("", 404)))
    assert len(records) == 3


def test_server_error_robots_blocks_fetch(tmp_path: Path) -> None:
    transport = _FakeTransport(_bodies(robots=("boom", 503)))
    adapter = _adapter(_client(tmp_path, transport))
    with pytest.raises(HtmlScrapeError, match="robots.txt disallows"):
        list(adapter.fetch(_spec()))


def test_second_fetch_is_served_from_cache(tmp_path: Path) -> None:
    transport = _FakeTransport(_bodies())
    adapter = _adapter(_client(tmp_path, transport))

    list(adapter.fetch(_spec()))
    list(adapter.fetch(_spec()))

    # robots.txt + page fetched once each; the repeat is served from disk.
    assert transport.calls == [("GET", _ROBOTS_URL), ("GET", _URL)]


def test_url_may_come_from_query(tmp_path: Path) -> None:
    params = {k: v for k, v in _CSS_PARAMS.items() if k != "url"}
    spec = CategorySpec(
        id="peruvian-dishes",
        label="Dish",
        description="Every Peruvian dish",
        source=SourceSpec(type="http", query=_URL, params=params),
        dimensions=("geographic",),
    )
    assert len(_fetch(tmp_path, spec)) == 3


def test_missing_url_raises(tmp_path: Path) -> None:
    params = {k: v for k, v in _CSS_PARAMS.items() if k != "url"}
    with pytest.raises(HtmlScrapeError, match="no page URL"):
        _fetch(tmp_path, _spec(params))


def test_missing_row_selector_raises(tmp_path: Path) -> None:
    params = {k: v for k, v in _CSS_PARAMS.items() if k != "row_selector"}
    with pytest.raises(HtmlScrapeError, match="no 'row_selector'"):
        _fetch(tmp_path, _spec(params))


def test_no_field_selectors_raises(tmp_path: Path) -> None:
    params = {
        "url": _URL,
        "row_selector": "tr.dish",
    }
    with pytest.raises(HtmlScrapeError, match="no 'field.<name>'"):
        _fetch(tmp_path, _spec(params))


def test_invalid_selector_type_raises(tmp_path: Path) -> None:
    params = {**_CSS_PARAMS, "selector_type": "regex"}
    with pytest.raises(HtmlScrapeError, match="unsupported selector_type"):
        _fetch(tmp_path, _spec(params))


def test_invalid_selector_raises(tmp_path: Path) -> None:
    params = {**_CSS_PARAMS, "row_selector": "tr[.dish"}
    with pytest.raises(HtmlScrapeError, match="invalid selector"):
        _fetch(tmp_path, _spec(params))


def test_page_error_status_raises(tmp_path: Path) -> None:
    with pytest.raises(HtmlScrapeError, match="status 500"):
        _fetch(tmp_path, bodies=_bodies(page=("upstream boom", 500)))


def test_empty_body_raises(tmp_path: Path) -> None:
    with pytest.raises(HtmlScrapeError, match="empty body"):
        _fetch(tmp_path, bodies=_bodies(page=("   ", 200)))


def test_adapter_declares_registry_metadata() -> None:
    assert HtmlScrapeAdapter.name == "html-scrape"
    assert HtmlScrapeAdapter.source_type == "http"
