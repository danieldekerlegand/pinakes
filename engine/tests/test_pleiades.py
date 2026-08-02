"""Tests for the Pleiades places dump adapter.

Small ``sample.json`` and ``sample.csv`` excerpts — Roma and Ostia, with
coordinates expressed both as a ``reprPoint`` ``[lon, lat]`` pair and as explicit
``reprLat``/``reprLong`` fields — exercise both dump formats, coordinate
extraction, cross-link collection, and provenance.
"""

from datetime import UTC, datetime
from pathlib import Path

import pytest

from pinakes_engine.acquire import (
    PLEIADES_LICENSE,
    CategorySpec,
    PleiadesDumpAdapter,
    PleiadesDumpError,
    RawRecord,
    SourceSpec,
)

_FIXTURES = Path(__file__).parent / "fixtures" / "pleiades"
_FIXED_NOW = datetime(2026, 6, 16, 12, 0, 0, tzinfo=UTC)


def _spec(query: str | None, params: dict[str, str] | None = None) -> CategorySpec:
    return CategorySpec(
        id="ancient-places",
        label="Place",
        description="Pleiades ancient places",
        source=SourceSpec(type="dump", query=query, params=params or {}),
        dimensions=("geographic",),
    )


def _adapter() -> PleiadesDumpAdapter:
    return PleiadesDumpAdapter(now=lambda: _FIXED_NOW)


def _fetch(name: str, **params: str) -> list[RawRecord]:
    spec = _spec(str(_FIXTURES / name), params or None)
    return list(_adapter().fetch(spec))


def _by_id(records: list[RawRecord], rec_id: str) -> RawRecord:
    return next(r for r in records if r.fields["id"] == rec_id)


@pytest.mark.parametrize("name", ["sample.json", "sample.csv"])
def test_one_record_per_place(name: str) -> None:
    ids = sorted(r.fields["id"] for r in _fetch(name))
    assert ids == ["413005", "423025"]


@pytest.mark.parametrize("name", ["sample.json", "sample.csv"])
def test_place_name_and_coordinates(name: str) -> None:
    roma = _by_id(_fetch(name), "423025")
    assert roma.fields["name"] == "Roma"
    assert roma.fields["lat"] == "41.890101"
    assert roma.fields["lon"] == "12.486948"
    assert roma.fields["uri"] == "https://pleiades.stoa.org/places/423025"


def test_repr_lat_long_fields_are_used() -> None:
    # Ostia carries explicit reprLat/reprLong rather than a reprPoint pair.
    ostia = _by_id(_fetch("sample.json"), "413005")
    assert ostia.fields["name"] == "Ostia"
    assert ostia.fields["lat"] == "41.7556"
    assert ostia.fields["lon"] == "12.2917"


def test_cross_links_collected_from_json() -> None:
    roma = _by_id(_fetch("sample.json"), "423025")
    assert roma.fields["cross_links"] == (
        "https://pleiades.stoa.org/places/413005;"
        "https://pleiades.stoa.org/places/413000;"
        "https://www.wikidata.org/wiki/Q220"
    )


def test_cross_links_collected_from_csv() -> None:
    roma = _by_id(_fetch("sample.csv"), "423025")
    assert roma.fields["cross_links"] == (
        "https://pleiades.stoa.org/places/413005;"
        "https://pleiades.stoa.org/places/413000"
    )


@pytest.mark.parametrize("name", ["sample.json", "sample.csv"])
def test_provenance_names_source_and_license(name: str) -> None:
    roma = _by_id(_fetch(name), "423025")
    prov = roma.provenance
    assert prov.source == "pleiades"
    assert prov.source_url == "https://pleiades.stoa.org/places/423025"
    assert prov.source_query == prov.source_url
    assert prov.license == PLEIADES_LICENSE
    assert prov.retrieved_at == "2026-06-16T12:00:00+00:00"


def test_format_inferred_from_extension_is_overridable() -> None:
    # The CSV fixture read with an explicit format param still parses.
    records = _fetch("sample.csv", format="csv")
    assert len(records) == 2


def test_license_can_be_overridden_via_params() -> None:
    record = _fetch("sample.json", license="CC-BY 3.0 (Pleiades)")[0]
    assert record.provenance.license == "CC-BY 3.0 (Pleiades)"


def test_missing_path_raises() -> None:
    with pytest.raises(PleiadesDumpError, match="no dump path"):
        list(_adapter().fetch(_spec(None)))


def test_unknown_format_raises(tmp_path: Path) -> None:
    weird = tmp_path / "places.xml"
    weird.write_text("<places/>", encoding="utf-8")
    with pytest.raises(PleiadesDumpError, match="unsupported Pleiades dump format"):
        list(_adapter().fetch(_spec(str(weird))))


def test_invalid_json_raises(tmp_path: Path) -> None:
    bad = tmp_path / "places.json"
    bad.write_text("{not json", encoding="utf-8")
    with pytest.raises(PleiadesDumpError, match="not valid JSON"):
        list(_adapter().fetch(_spec(str(bad))))


def test_csv_without_id_column_raises(tmp_path: Path) -> None:
    bad = tmp_path / "places.csv"
    bad.write_text("title,reprLat\nRoma,41.9\n", encoding="utf-8")
    with pytest.raises(PleiadesDumpError, match="no 'id' column"):
        list(_adapter().fetch(_spec(str(bad))))


def test_adapter_declares_registry_metadata() -> None:
    assert PleiadesDumpAdapter.name == "pleiades-dump"
    assert PleiadesDumpAdapter.source_type == "dump"
