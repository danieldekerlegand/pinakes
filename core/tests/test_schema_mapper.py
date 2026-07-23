"""Tests for mapping RawRecords to canonical node rows."""

import json
from pathlib import Path

import pytest

from culturescrape.acquire.categories import CategorySpec, SourceSpec
from culturescrape.acquire.records import Provenance, RawRecord
from culturescrape.schema import (
    OVERFLOW_KEY,
    MapperError,
    map_record,
    map_records,
    node_schema,
    read_rows,
    write_rows,
)


def _provenance(**overrides: object) -> Provenance:
    base: dict[str, object] = {
        "source": "wikidata",
        "source_url": "https://www.wikidata.org/wiki/Q12345",
        "source_query": "SELECT ?item WHERE { ... }",
        "retrieved_at": "2026-06-16T00:00:00+00:00",
        "confidence": 0.9,
    }
    base.update(overrides)
    return Provenance(**base)  # type: ignore[arg-type]


def _category(label: str = "Dish;CulturalArtifact") -> CategorySpec:
    return CategorySpec(
        id="peruvian-dishes",
        label=label,
        description="Every Peruvian dish",
        source=SourceSpec(type="wikidata-sparql", query="SELECT ..."),
        dimensions=("temporal", "geographic", "linguistic"),
    )


# --- identity & label ------------------------------------------------------


def test_qid_anchors_csid() -> None:
    record = RawRecord(
        fields={
            "item": "http://www.wikidata.org/entity/Q12345",
            "itemLabel": "Ceviche",
        },
        provenance=_provenance(),
    )
    row = map_record(record, _category())
    assert row["csid"] == "cs:dish:Q12345"
    assert row[":LABEL"] == ["Dish", "CulturalArtifact"]
    assert row["name"] == "Ceviche"
    assert row["wikidata_qid"] == "http://www.wikidata.org/entity/Q12345"


def test_name_anchors_csid_without_qid() -> None:
    record = RawRecord(
        fields={"title": "Lomo Saltado", "lang": "es"}, provenance=_provenance()
    )
    row = map_record(record, _category())
    assert isinstance(row["csid"], str)
    assert row["csid"].startswith("cs:dish:lomo-saltado-")
    assert row["lang"] == "es"


def test_name_anchored_csid_is_deterministic() -> None:
    record = RawRecord(
        fields={"name": "Café Criollo", "lang": "es"}, provenance=_provenance()
    )
    first = map_record(record, _category())
    second = map_record(record, _category())
    assert first["csid"] == second["csid"]


def test_malformed_qid_falls_back_to_name() -> None:
    record = RawRecord(
        fields={"qid": "not-a-qid", "name": "Anticucho"}, provenance=_provenance()
    )
    row = map_record(record, _category())
    assert row["csid"].startswith("cs:dish:anticucho-")  # type: ignore[union-attr]


def test_label_comes_from_category_spec() -> None:
    record = RawRecord(fields={"name": "Cusco"}, provenance=_provenance())
    row = map_record(record, _category(label="Place"))
    assert row[":LABEL"] == ["Place"]
    assert row["csid"] == "cs:place:" + str(row["csid"]).split(":", 2)[2]


def test_missing_name_and_qid_raises() -> None:
    record = RawRecord(fields={"description": "no name here"}, provenance=_provenance())
    with pytest.raises(MapperError):
        map_record(record, _category())


def test_empty_label_raises() -> None:
    record = RawRecord(fields={"name": "x"}, provenance=_provenance())
    with pytest.raises(MapperError):
        map_record(record, _category(label="  ;  "))


# --- provenance ------------------------------------------------------------


def test_provenance_is_carried_onto_every_row() -> None:
    records = [
        RawRecord(fields={"name": "Ceviche"}, provenance=_provenance()),
        RawRecord(
            fields={"name": "Aji de Gallina"},
            provenance=_provenance(source="petscan"),
        ),
    ]
    rows = map_records(records, _category())
    assert [r["source"] for r in rows] == ["wikidata", "petscan"]
    for row in rows:
        assert row["source_url"] == "https://www.wikidata.org/wiki/Q12345"
        assert row["source_query"] == "SELECT ?item WHERE { ... }"
        assert row["retrieved_at"] == "2026-06-16T00:00:00+00:00"
        assert row["confidence"] == "0.9"


# --- dimension resolution --------------------------------------------------


def test_temporal_field_is_resolved_to_year_columns() -> None:
    record = RawRecord(
        fields={"name": "Inca Empire", "inception": "1438"}, provenance=_provenance()
    )
    row = map_record(record, _category())
    assert row["time_start"] == "1438"
    assert "time_end" not in row


def test_temporal_range_resolves_both_ends() -> None:
    record = RawRecord(
        fields={"name": "Some Battle", "date": "500-400 BC"}, provenance=_provenance()
    )
    row = map_record(record, _category())
    assert row["time_start"] == "-500"
    assert row["time_end"] == "-400"


def test_iso_date_keeps_raw_in_time_start_iso() -> None:
    record = RawRecord(
        fields={"name": "Event", "date": "1879-03-14"}, provenance=_provenance()
    )
    row = map_record(record, _category())
    assert row["time_start"] == "1879"
    assert row["time_start_iso"] == "1879-03-14"


def test_wkt_coordinates_are_resolved_to_lat_lon() -> None:
    record = RawRecord(
        fields={"name": "Cusco", "coordinate_location": "Point(-71.97 -13.53)"},
        provenance=_provenance(),
    )
    row = map_record(record, _category(label="Place"))
    assert row["lat"] == "-13.53"
    assert row["lon"] == "-71.97"


def test_separate_lat_lon_fields_are_resolved() -> None:
    record = RawRecord(
        fields={"name": "Cusco", "latitude": "-13.53", "longitude": "-71.97"},
        provenance=_provenance(),
    )
    row = map_record(record, _category(label="Place"))
    assert row["lat"] == "-13.53"
    assert row["lon"] == "-71.97"


def test_out_of_range_coordinate_is_dropped() -> None:
    record = RawRecord(
        fields={"name": "Nowhere", "coordinates": "Point(0 999)"},
        provenance=_provenance(),
    )
    row = map_record(record, _category(label="Place"))
    assert "lat" not in row and "lon" not in row
    assert OVERFLOW_KEY not in row  # a known field, dropped not overflowed


def test_aliases_split_into_multi_value() -> None:
    record = RawRecord(
        fields={"name": "Ceviche", "altLabel": "Cebiche;Seviche"},
        provenance=_provenance(),
    )
    row = map_record(record, _category())
    assert row["aliases"] == ["Cebiche", "Seviche"]


# --- overflow --------------------------------------------------------------


def test_unknown_fields_go_to_overflow() -> None:
    record = RawRecord(
        fields={"name": "Ceviche", "spiciness": "high", "michelin_stars": "0"},
        provenance=_provenance(),
    )
    row = map_record(record, _category())
    overflow = json.loads(row[OVERFLOW_KEY])  # type: ignore[arg-type]
    assert overflow == {"michelin_stars": "0", "spiciness": "high"}


def test_no_overflow_column_when_all_fields_recognised() -> None:
    record = RawRecord(
        fields={"name": "Ceviche", "lang": "es"}, provenance=_provenance()
    )
    row = map_record(record, _category())
    assert OVERFLOW_KEY not in row


# --- round trip ------------------------------------------------------------


def test_mapped_rows_round_trip_through_tsv(tmp_path: Path) -> None:
    records = [
        RawRecord(
            fields={
                "item": "Q12345",
                "itemLabel": "Ceviche",
                "lang": "es",
                "altLabel": "Cebiche;Seviche",
                "inception": "1879",
                "region": "coast",
            },
            provenance=_provenance(),
        ),
        RawRecord(
            fields={"name": "Lomo Saltado"},
            provenance=_provenance(source="petscan"),
        ),
    ]
    rows = map_records(records, _category())
    path = tmp_path / "dish.tsv"
    assert write_rows(path, node_schema().columns, rows) == 2

    _, back = read_rows(path)
    assert back[0]["csid"] == "cs:dish:Q12345"
    assert back[0]["aliases"] == ["Cebiche", "Seviche"]
    assert back[0]["time_start"] == "1879"
    assert json.loads(back[0][OVERFLOW_KEY]) == {"region": "coast"}  # type: ignore[arg-type]
    assert back[1]["source"] == "petscan"
    assert back[1]["aliases"] == []
