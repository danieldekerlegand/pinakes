"""Tests for the remote delimited/JSON dataset adapter (pinakes:70 US-1).

The point of this adapter is that a published dataset need not be downloaded by
hand first, and that the download is the *shared* client's — so the assertions
that matter are (a) the rows come out identical to what ``tabular-dump`` makes
of the same bytes off disk, and (b) a second build costs the host nothing.
"""

from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path

import pytest

from pinakes_engine.acquire import (
    CategorySpec,
    HttpClient,
    HttpResponse,
    RemoteTabularAdapter,
    RemoteTabularError,
    SourceSpec,
    load_category,
)
from pinakes_engine.acquire.tabular import TabularDumpAdapter

_FIXTURES = Path(__file__).parent / "fixtures" / "scrapers"
_CATEGORY_DIR = Path(__file__).resolve().parents[1] / "inputs" / "categories"
_FIXED_NOW = datetime(2026, 8, 5, 12, 0, 0, tzinfo=UTC)
_WALS = "https://raw.githubusercontent.com/cldf-datasets/wals/master/cldf/values.csv"
_UNIMORPH = "https://raw.githubusercontent.com/unimorph/lat/master/lat"
_CLDR = (
    "https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/"
    "cldr-core/scriptMetadata.json"
)


class _FakeTransport:
    def __init__(self, bodies: dict[str, tuple[str, int]]) -> None:
        self._bodies = bodies
        self.calls: list[str] = []

    def request(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, str] | None,
        headers: Mapping[str, str],
        timeout: float,
    ) -> HttpResponse:
        self.calls.append(url)
        body, status = self._bodies.get(url, ("", 404))
        return HttpResponse(url=url, status_code=status, text=body, headers={})


def _client(tmp_path: Path, transport: _FakeTransport) -> HttpClient:
    return HttpClient(
        cache_dir=tmp_path,
        min_interval=0.0,
        max_retries=0,
        transport=transport,
        sleep=lambda _: None,
    )


def _adapter(client: HttpClient) -> RemoteTabularAdapter:
    return RemoteTabularAdapter(client, now=lambda: _FIXED_NOW)


def _spec(params: dict[str, str], *, query: str) -> CategorySpec:
    return CategorySpec(
        id="remote-test",
        label="Typology",
        description="a downloaded dataset",
        source=SourceSpec(type="http", query=query, params=params),
        dimensions=("linguistic",),
    )


def _text(name: str) -> str:
    return (_FIXTURES / name).read_text(encoding="utf-8")


_WALS_PARAMS = {
    "format": "csv",
    "source": "wals",
    "license": "CC-BY-4.0",
    "confidence": "0.8",
    "id_column": "ID",
    "url_template": "https://wals.info/valuesets/{id}",
    "field.language_code": "Language_ID",
    "field.name": "Value",
}


# ── the same mapping, downloaded instead of dumped ───────────────────────────


def test_a_downloaded_csv_yields_the_rows_its_column_map_names(
    tmp_path: Path,
) -> None:
    transport = _FakeTransport({_WALS: (_text("wals-values.csv"), 200)})
    records = list(
        _adapter(_client(tmp_path, transport)).fetch(
            _spec(_WALS_PARAMS, query=_WALS)
        )
    )

    assert [r.fields["name"] for r in records] == ["SVO", "SOV", "VSO"]
    assert records[0].fields["language_code"] == "eng"
    # Unmapped columns ride through, exactly as they do off disk.
    assert records[0].fields["Parameter_ID"] == "81A"
    assert records[0].provenance.source_url == "https://wals.info/valuesets/eng-81A"
    assert records[0].provenance.license == "CC-BY-4.0"


def test_downloading_and_dumping_the_same_bytes_give_identical_rows(
    tmp_path: Path,
) -> None:
    """The transport is a detail; the mapping is the contract, and it is shared."""
    transport = _FakeTransport({_WALS: (_text("wals-values.csv"), 200)})
    downloaded = list(
        _adapter(_client(tmp_path / "cache", transport)).fetch(
            _spec(_WALS_PARAMS, query=_WALS)
        )
    )

    on_disk_path = tmp_path / "values.csv"
    on_disk_path.write_text(_text("wals-values.csv"), encoding="utf-8")
    dumped = list(
        TabularDumpAdapter(now=lambda: _FIXED_NOW).fetch(
            CategorySpec(
                id="remote-test",
                label="Typology",
                description="the same dataset, off disk",
                source=SourceSpec(
                    type="dump",
                    query=str(on_disk_path),
                    params={**_WALS_PARAMS, "adapter": "tabular-dump"},
                ),
                dimensions=("linguistic",),
            )
        )
    )

    assert [r.fields for r in downloaded] == [r.fields for r in dumped]
    assert [r.provenance.source_url for r in downloaded] == [
        r.provenance.source_url for r in dumped
    ]


def test_a_second_build_is_served_from_the_cache(tmp_path: Path) -> None:
    transport = _FakeTransport({_WALS: (_text("wals-values.csv"), 200)})
    client = _client(tmp_path, transport)
    spec = _spec(_WALS_PARAMS, query=_WALS)

    list(_adapter(client).fetch(spec))
    list(_adapter(client).fetch(spec))

    assert transport.calls == [_WALS]
    assert client.stats.cache_hits == 1


# ── the two shapes a hand-written scraper had to special-case ────────────────


def test_a_headerless_file_takes_its_column_names_from_the_spec(
    tmp_path: Path,
) -> None:
    """UniMorph ships bare triples; without ``columns`` row one is eaten."""
    transport = _FakeTransport({_UNIMORPH: (_text("unimorph-lat.tsv"), 200)})
    records = list(
        _adapter(_client(tmp_path, transport)).fetch(
            _spec(
                {
                    "format": "tsv",
                    "columns": "lemma,form,features",
                    "source": "unimorph",
                    "field.name": "form",
                    "field.lemma": "lemma",
                },
                query=_UNIMORPH,
            )
        )
    )

    assert [r.fields["name"] for r in records] == ["amo", "amas", "fert"]
    assert records[0].fields["lemma"] == "amare"
    assert records[0].fields["features"] == "V;IND;PRS;1;SG"


def test_json_records_keyed_by_code_lift_the_key_into_a_column(
    tmp_path: Path,
) -> None:
    """CLDR keys scripts by code; the code is the script's only identity."""
    transport = _FakeTransport({_CLDR: (_text("cldr-script-metadata.json"), 200)})
    records = list(
        _adapter(_client(tmp_path, transport)).fetch(
            _spec(
                {
                    "format": "json",
                    "records": "scriptMetadata",
                    "key_field": "script_code",
                    "source": "cldr",
                    "id_column": "script_code",
                    "field.script": "script_code",
                },
                query=_CLDR,
            )
        )
    )

    assert [r.fields["script"] for r in records] == ["Latn", "Arab", "Egyp"]
    assert records[1].fields["rtl"] == "YES"
    assert records[0].provenance.source_url == "Latn"


def test_the_format_is_inferred_from_the_url_when_unset(tmp_path: Path) -> None:
    transport = _FakeTransport({_WALS: (_text("wals-values.csv"), 200)})
    params = {key: value for key, value in _WALS_PARAMS.items() if key != "format"}
    records = list(
        _adapter(_client(tmp_path, transport)).fetch(_spec(params, query=_WALS))
    )
    assert len(records) == 3


# ── refusals ─────────────────────────────────────────────────────────────────


def test_no_url_is_an_error_naming_the_category(tmp_path: Path) -> None:
    adapter = _adapter(_client(tmp_path, _FakeTransport({})))
    spec = CategorySpec(
        id="remote-test",
        label="Typology",
        description="no url",
        source=SourceSpec(type="http", query=None, params={"format": "csv"}),
        dimensions=("linguistic",),
    )
    with pytest.raises(RemoteTabularError, match="no dataset URL"):
        list(adapter.fetch(spec))


def test_an_extensionless_url_with_no_format_is_an_error(tmp_path: Path) -> None:
    adapter = _adapter(_client(tmp_path, _FakeTransport({})))
    with pytest.raises(RemoteTabularError, match="cannot infer a format"):
        list(adapter.fetch(_spec({"field.name": "x"}, query="https://x.test/data")))


def test_an_error_status_is_raised_rather_than_read_as_no_rows(
    tmp_path: Path,
) -> None:
    transport = _FakeTransport({_WALS: ("gone", 404)})
    adapter = _adapter(_client(tmp_path, transport))
    with pytest.raises(RemoteTabularError, match="status 404"):
        list(adapter.fetch(_spec(_WALS_PARAMS, query=_WALS)))


def test_an_empty_body_is_raised_rather_than_read_as_no_rows(
    tmp_path: Path,
) -> None:
    transport = _FakeTransport({_WALS: ("   ", 200)})
    adapter = _adapter(_client(tmp_path, transport))
    with pytest.raises(RemoteTabularError, match="empty body"):
        list(adapter.fetch(_spec(_WALS_PARAMS, query=_WALS)))


def test_a_records_path_that_resolves_to_a_scalar_is_an_error(
    tmp_path: Path,
) -> None:
    transport = _FakeTransport({_CLDR: ('{"scriptMetadata": 7}', 200)})
    adapter = _adapter(_client(tmp_path, transport))
    with pytest.raises(RemoteTabularError, match="expected an object or array"):
        list(
            adapter.fetch(
                _spec(
                    {"format": "json", "records": "scriptMetadata", "field.x": "x"},
                    query=_CLDR,
                )
            )
        )


# ── the committed category specs ─────────────────────────────────────────────


@pytest.mark.parametrize(
    "category", ["wals-cldf", "grambank-cldf", "verb-paradigms", "cldr-scripts"]
)
def test_the_migrated_remote_categories_declare_a_usable_mapping(
    category: str,
) -> None:
    spec = load_category(_CATEGORY_DIR / f"{category}.yml")
    assert spec.source.params["adapter"] == RemoteTabularAdapter.name
    assert spec.source.query and spec.source.query.startswith("https://")
    assert any(key.startswith("field.") for key in spec.source.params)
    # A downloaded dataset always states its licence: attribution has to travel.
    assert spec.source.params.get("license")
