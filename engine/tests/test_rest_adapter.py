"""Tests for the generic JSON REST source adapter (pinakes:70 US-1).

A fake transport replays recorded payloads through the *real* cached
:class:`~pinakes_engine.acquire.http.HttpClient`, so field extraction, both
pagination shapes, provenance and the cache are exercised with no live network.
The fixtures are the shapes the retired TypeScript scrapers actually spoke to —
Seshat's ``results`` envelope and MediaWiki's continuation token.
"""

from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path

import pytest

from pinakes_engine.acquire import (
    CategorySpec,
    HttpClient,
    HttpResponse,
    RestApiAdapter,
    RestApiError,
    SourceSpec,
    load_category,
)

_FIXTURES = Path(__file__).parent / "fixtures" / "scrapers"
_CATEGORY_DIR = Path(__file__).resolve().parents[1] / "inputs" / "categories"
_FIXED_NOW = datetime(2026, 8, 5, 12, 0, 0, tzinfo=UTC)
_SESHAT = "https://seshatdatabank.info/api/v1/polities/"
_COMMONS = "https://commons.wikimedia.org/w/api.php"


class _FakeTransport:
    """Return a body per ``(url, sorted params)``, recording every call."""

    def __init__(self, bodies: dict[tuple[str, tuple], tuple[str, int]]) -> None:
        self._bodies = bodies
        self.calls: list[tuple[str, dict[str, str]]] = []

    def request(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, str] | None,
        headers: Mapping[str, str],
        timeout: float,
    ) -> HttpResponse:
        sent = dict(params or {})
        self.calls.append((url, sent))
        key = (url, tuple(sorted(sent.items())))
        body, status = self._bodies.get(key, ("{}", 404))
        return HttpResponse(url=url, status_code=status, text=body, headers={})


def _client(tmp_path: Path, transport: _FakeTransport) -> HttpClient:
    return HttpClient(
        cache_dir=tmp_path,
        min_interval=0.0,
        max_retries=0,
        transport=transport,
        sleep=lambda _: None,
    )


def _adapter(client: HttpClient) -> RestApiAdapter:
    return RestApiAdapter(client, now=lambda: _FIXED_NOW)


def _spec(params: dict[str, str], *, query: str | None = None) -> CategorySpec:
    return CategorySpec(
        id="rest-test",
        label="Culture",
        description="a REST acquisition",
        source=SourceSpec(type="http", query=query, params=params),
        dimensions=("temporal",),
    )


def _text(name: str) -> str:
    return (_FIXTURES / name).read_text(encoding="utf-8")


# ── field extraction ─────────────────────────────────────────────────────────


def test_maps_dotted_paths_onto_canonical_fields(tmp_path: Path) -> None:
    transport = _FakeTransport({(_SESHAT, ()): (_text("seshat-polities.json"), 200)})
    records = list(
        _adapter(_client(tmp_path, transport)).fetch(
            _spec(
                {
                    "records": "results",
                    "field.name": "name",
                    "field.start_year": "start_year",
                    "field.region": "region",
                },
                query=_SESHAT,
            )
        )
    )

    assert [r.fields.get("name") for r in records] == [
        "Kingdom of Aksum",
        "Qin Dynasty",
        None,  # the third row has no name, but does carry a start_year
    ]
    assert records[0].fields == {
        "name": "Kingdom of Aksum",
        "start_year": "-100",
        "region": "Africa",
    }


def test_a_record_that_maps_to_no_field_is_skipped_not_emitted_empty(
    tmp_path: Path,
) -> None:
    """The third Seshat row has no ``name``; the mapping is what defines a row."""
    transport = _FakeTransport({(_SESHAT, ()): (_text("seshat-polities.json"), 200)})
    records = list(
        _adapter(_client(tmp_path, transport)).fetch(
            _spec({"records": "results", "field.name": "name"}, query=_SESHAT)
        )
    )
    assert len(records) == 2


def test_a_missing_path_is_absent_rather_than_an_error(tmp_path: Path) -> None:
    transport = _FakeTransport({(_SESHAT, ()): (_text("seshat-polities.json"), 200)})
    records = list(
        _adapter(_client(tmp_path, transport)).fetch(
            _spec(
                {
                    "records": "results",
                    "field.name": "name",
                    "field.capital": "capital.settlement.name",
                },
                query=_SESHAT,
            )
        )
    )
    assert all("capital" not in r.fields for r in records)


def test_a_trailing_bracket_joins_a_list_with_the_multi_value_separator(
    tmp_path: Path,
) -> None:
    body = '{"rows": [{"name": "Aksum", "langs": ["gez", "tig", "amh"]}]}'
    transport = _FakeTransport({("https://x.test/a", ()): (body, 200)})
    (record,) = list(
        _adapter(_client(tmp_path, transport)).fetch(
            _spec(
                {
                    "records": "rows",
                    "field.name": "name",
                    "field.language_code": "langs[]",
                },
                query="https://x.test/a",
            )
        )
    )
    assert record.fields["language_code"] == "gez;tig;amh"


def test_an_integer_segment_indexes_a_list(tmp_path: Path) -> None:
    body = '{"rows": [{"coords": [{"lat": 14.1, "lon": 38.7}]}]}'
    transport = _FakeTransport({("https://x.test/a", ()): (body, 200)})
    (record,) = list(
        _adapter(_client(tmp_path, transport)).fetch(
            _spec(
                {
                    "records": "rows",
                    "field.lat": "coords.0.lat",
                    "field.lon": "coords.0.lon",
                },
                query="https://x.test/a",
            )
        )
    )
    assert record.fields == {"lat": "14.1", "lon": "38.7"}


def test_a_payload_that_is_itself_the_record_array_needs_no_records_path(
    tmp_path: Path,
) -> None:
    transport = _FakeTransport({("https://x.test/a", ()): ('[{"n": "one"}]', 200)})
    (record,) = list(
        _adapter(_client(tmp_path, transport)).fetch(
            _spec({"field.name": "n"}, query="https://x.test/a")
        )
    )
    assert record.fields == {"name": "one"}


# ── provenance ───────────────────────────────────────────────────────────────


def test_provenance_carries_the_source_licence_and_a_per_record_url(
    tmp_path: Path,
) -> None:
    transport = _FakeTransport({(_SESHAT, ()): (_text("seshat-polities.json"), 200)})
    (first, _) = list(
        _adapter(_client(tmp_path, transport)).fetch(
            _spec(
                {
                    "records": "results",
                    "field.name": "name",
                    "id_field": "id",
                    "url_template": "https://seshatdatabank.info/browser/{id}",
                    "source": "seshat",
                    "license": "CC-BY-NC-SA-4.0",
                    "confidence": "0.8",
                },
                query=_SESHAT,
            )
        )
    )
    assert first.provenance.source == "seshat"
    assert first.provenance.license == "CC-BY-NC-SA-4.0"
    assert first.provenance.confidence == 0.8
    assert (
        first.provenance.source_url
        == "https://seshatdatabank.info/browser/AfAksumite"
    )
    assert first.provenance.source_query == _SESHAT
    assert first.provenance.retrieved_at == _FIXED_NOW.isoformat()


def test_a_record_with_no_id_falls_back_to_the_page_url(tmp_path: Path) -> None:
    transport = _FakeTransport({(_SESHAT, ()): (_text("seshat-polities.json"), 200)})
    (first, _) = list(
        _adapter(_client(tmp_path, transport)).fetch(
            _spec(
                {"records": "results", "field.name": "name"},
                query=_SESHAT,
            )
        )
    )
    assert first.provenance.source_url == _SESHAT


# ── pagination ───────────────────────────────────────────────────────────────


def test_a_continuation_token_is_fed_back_as_a_query_parameter(
    tmp_path: Path,
) -> None:
    """MediaWiki's cursor is an opaque token, not a URL — ``next_param``."""
    base = {"action": "query", "list": "categorymembers", "format": "json"}
    token = "file|4d59434e414549|21"
    transport = _FakeTransport(
        {
            (_COMMONS, tuple(sorted(base.items()))): (
                _text("commons-categorymembers-page1.json"),
                200,
            ),
            (_COMMONS, tuple(sorted({**base, "cmcontinue": token}.items()))): (
                _text("commons-categorymembers-page2.json"),
                200,
            ),
        }
    )
    records = list(
        _adapter(_client(tmp_path, transport)).fetch(
            _spec(
                {
                    "query.action": "query",
                    "query.list": "categorymembers",
                    "query.format": "json",
                    "records": "query.categorymembers",
                    "next_path": "continue.cmcontinue",
                    "next_param": "cmcontinue",
                    "field.name": "title",
                },
                query=_COMMONS,
            )
        )
    )

    assert [r.fields["name"] for r in records] == [
        "File:Rosetta Stone.jpg",
        "File:Ishtar Gate detail.jpg",
        "File:Antikythera mechanism.jpg",
    ]
    assert transport.calls[1][1]["cmcontinue"] == token


def test_a_cursor_without_next_param_is_read_as_the_next_pages_url(
    tmp_path: Path,
) -> None:
    transport = _FakeTransport(
        {
            ("https://x.test/p1", ()): (
                '{"rows": [{"n": "a"}], "next": "https://x.test/p2"}',
                200,
            ),
            ("https://x.test/p2", ()): ('{"rows": [{"n": "b"}]}', 200),
        }
    )
    records = list(
        _adapter(_client(tmp_path, transport)).fetch(
            _spec(
                {"records": "rows", "next_path": "next", "field.name": "n"},
                query="https://x.test/p1",
            )
        )
    )
    assert [r.fields["name"] for r in records] == ["a", "b"]


def test_offset_pagination_stops_when_a_page_yields_nothing(
    tmp_path: Path,
) -> None:
    transport = _FakeTransport(
        {
            ("https://x.test/a", (("page", "1"),)): ('{"rows": [{"n": "a"}]}', 200),
            ("https://x.test/a", (("page", "2"),)): ('{"rows": []}', 200),
        }
    )
    records = list(
        _adapter(_client(tmp_path, transport)).fetch(
            _spec(
                {
                    "records": "rows",
                    "field.name": "n",
                    "page_param": "page",
                    "start_page": "1",
                    "max_pages": "5",
                },
                query="https://x.test/a",
            )
        )
    )
    assert [r.fields["name"] for r in records] == ["a"]
    assert len(transport.calls) == 2


def test_a_cursor_that_repeats_itself_terminates_rather_than_looping(
    tmp_path: Path,
) -> None:
    """A self-referential ``next`` is a real API bug; it must not hang a run."""
    transport = _FakeTransport(
        {
            ("https://x.test/p", ()): (
                '{"rows": [{"n": "a"}], "next": "https://x.test/p"}',
                200,
            )
        }
    )
    records = list(
        _adapter(_client(tmp_path, transport)).fetch(
            _spec(
                {"records": "rows", "next_path": "next", "field.name": "n"},
                query="https://x.test/p",
            )
        )
    )
    assert len(records) == 1


def test_max_pages_bounds_an_endpoint_that_never_stops(tmp_path: Path) -> None:
    transport = _FakeTransport({})
    transport._bodies = {  # every page answers, and every page has more
        ("https://x.test/a", (("page", str(n)),)): ('{"rows": [{"n": "x"}]}', 200)
        for n in range(50)
    }
    records = list(
        _adapter(_client(tmp_path, transport)).fetch(
            _spec(
                {
                    "records": "rows",
                    "field.name": "n",
                    "page_param": "page",
                    "max_pages": "3",
                },
                query="https://x.test/a",
            )
        )
    )
    assert len(records) == 3


# ── politeness is the client's, not the adapter's ────────────────────────────


def test_a_repeated_page_is_served_from_the_cache_not_the_endpoint(
    tmp_path: Path,
) -> None:
    """The whole point of unifying: the retired scrapers cached nothing."""
    transport = _FakeTransport({(_SESHAT, ()): (_text("seshat-polities.json"), 200)})
    client = _client(tmp_path, transport)
    spec = _spec({"records": "results", "field.name": "name"}, query=_SESHAT)

    first = list(_adapter(client).fetch(spec))
    second = list(_adapter(client).fetch(spec))

    assert [r.fields for r in first] == [r.fields for r in second]
    assert len(transport.calls) == 1
    assert client.stats.cache_hits == 1


# ── refusals ─────────────────────────────────────────────────────────────────


def test_no_endpoint_is_an_error_naming_the_category(tmp_path: Path) -> None:
    adapter = _adapter(_client(tmp_path, _FakeTransport({})))
    with pytest.raises(RestApiError, match="no endpoint"):
        list(adapter.fetch(_spec({"field.name": "n"})))


def test_no_field_paths_is_an_error(tmp_path: Path) -> None:
    adapter = _adapter(_client(tmp_path, _FakeTransport({})))
    with pytest.raises(RestApiError, match="no 'field.<name>'"):
        list(adapter.fetch(_spec({}, query="https://x.test/a")))


def test_an_error_status_is_raised_rather_than_read_as_no_rows(
    tmp_path: Path,
) -> None:
    transport = _FakeTransport({("https://x.test/a", ()): ("nope", 503)})
    adapter = _adapter(_client(tmp_path, transport))
    with pytest.raises(RestApiError, match="status 503"):
        list(adapter.fetch(_spec({"field.name": "n"}, query="https://x.test/a")))


def test_a_non_json_body_is_raised_rather_than_swallowed(tmp_path: Path) -> None:
    transport = _FakeTransport({("https://x.test/a", ()): ("<html>", 200)})
    adapter = _adapter(_client(tmp_path, transport))
    with pytest.raises(RestApiError, match="did not return JSON"):
        list(adapter.fetch(_spec({"field.name": "n"}, query="https://x.test/a")))


def test_a_records_path_that_resolves_to_a_scalar_is_an_error(
    tmp_path: Path,
) -> None:
    transport = _FakeTransport({("https://x.test/a", ()): ('{"rows": 7}', 200)})
    adapter = _adapter(_client(tmp_path, transport))
    with pytest.raises(RestApiError, match="expected an object or array"):
        list(
            adapter.fetch(
                _spec(
                    {"records": "rows", "field.name": "n"}, query="https://x.test/a"
                )
            )
        )


# ── the committed category specs ─────────────────────────────────────────────


@pytest.mark.parametrize(
    "category", ["seshat-polities", "commons-images", "wiktionary-phonology"]
)
def test_the_migrated_rest_categories_declare_a_usable_mapping(
    category: str,
) -> None:
    spec = load_category(_CATEGORY_DIR / f"{category}.yml")
    assert spec.source.type == "http"
    assert spec.source.params["adapter"] == RestApiAdapter.name
    assert spec.source.query
    assert any(key.startswith("field.") for key in spec.source.params)
