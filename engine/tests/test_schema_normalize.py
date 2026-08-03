"""Tests for cleaning raw fields into canonical columns."""

import logging
import unicodedata

import pytest

from pinakes_engine.schema import (
    DEFAULT_FIELD_MAP,
    Coordinates,
    TimeSpan,
    map_field_names,
    normalize_fields,
    normalize_text,
    parse_lat_lon,
    parse_point,
    parse_temporal,
)

# --- text normalization ----------------------------------------------------


def test_normalize_text_trims_and_collapses_whitespace() -> None:
    assert normalize_text("  Lomo\t Saltado \n") == "Lomo Saltado"


def test_normalize_text_applies_nfc() -> None:
    # "e" + U+0301 combining acute (NFD) folds to one NFC code point U+00E9.
    nfc = unicodedata.normalize("NFC", "Café")
    nfd = unicodedata.normalize("NFD", nfc)
    assert nfd != nfc
    assert normalize_text(nfd) == nfc


def test_normalize_text_empty() -> None:
    assert normalize_text("   ") == ""


# --- field-name mapping ----------------------------------------------------


def test_map_field_names_renames_known_keys() -> None:
    mapped = map_field_names({"itemLabel": "Ceviche", "altLabel": "Cebiche"})
    assert mapped == {"name": "Ceviche", "aliases": "Cebiche"}


def test_map_field_names_passes_unknown_keys_through() -> None:
    assert map_field_names({"weird_field": "x"}) == {"weird_field": "x"}


def test_map_field_names_accepts_custom_mapping() -> None:
    mapped = map_field_names({"plato": "Ceviche"}, {"plato": "name"})
    assert mapped == {"name": "Ceviche"}


def test_default_field_map_can_be_extended_without_mutation() -> None:
    extended = {**DEFAULT_FIELD_MAP, "plato": "name"}
    assert "plato" not in DEFAULT_FIELD_MAP
    assert extended["itemLabel"] == "name"


def test_normalize_fields_renames_and_normalizes() -> None:
    out = normalize_fields({"itemLabel": "  Lomo\tSaltado ", "desc": "A  dish"})
    assert out == {"name": "Lomo Saltado", "description": "A dish"}


# --- temporal: single years ------------------------------------------------


def test_parse_plain_year() -> None:
    assert parse_temporal("1879") == TimeSpan(time_start=1879)


def test_parse_year_ad_and_ce() -> None:
    assert parse_temporal("1879 AD") == TimeSpan(time_start=1879)
    assert parse_temporal("1879 CE") == TimeSpan(time_start=1879)


def test_parse_year_bce_marker() -> None:
    assert parse_temporal("500 BC") == TimeSpan(time_start=-500)
    assert parse_temporal("500 BCE") == TimeSpan(time_start=-500)
    assert parse_temporal("500 B.C.") == TimeSpan(time_start=-500)


def test_parse_negative_year_is_bce() -> None:
    assert parse_temporal("-500") == TimeSpan(time_start=-500)


# --- temporal: centuries ---------------------------------------------------


def test_parse_century_ce() -> None:
    assert parse_temporal("5th century") == TimeSpan(time_start=401, time_end=500)


def test_parse_first_century_ce() -> None:
    assert parse_temporal("1st century") == TimeSpan(time_start=1, time_end=100)


def test_parse_century_bce() -> None:
    assert parse_temporal("5th century BC") == TimeSpan(time_start=-500, time_end=-401)


def test_parse_first_century_bce() -> None:
    assert parse_temporal("1st century BCE") == TimeSpan(time_start=-100, time_end=-1)


# --- temporal: ranges ------------------------------------------------------

#: En dash (U+2013) and em dash (U+2014), as sources commonly write ranges.
EN_DASH = "–"
EM_DASH = "—"


def test_parse_year_range_en_dash() -> None:
    assert parse_temporal(f"1879{EN_DASH}1955") == TimeSpan(
        time_start=1879, time_end=1955
    )


def test_parse_year_range_em_dash() -> None:
    assert parse_temporal(f"1879{EM_DASH}1955") == TimeSpan(
        time_start=1879, time_end=1955
    )


def test_parse_year_range_hyphen() -> None:
    assert parse_temporal("1879-1955") == TimeSpan(time_start=1879, time_end=1955)


def test_parse_year_range_word_to() -> None:
    assert parse_temporal("1879 to 1955") == TimeSpan(time_start=1879, time_end=1955)


def test_parse_bce_range_shares_era() -> None:
    # "BC" on the right end applies to both ends.
    assert parse_temporal(f"500{EN_DASH}400 BC") == TimeSpan(
        time_start=-500, time_end=-400
    )


def test_parse_bce_to_ce_range() -> None:
    assert parse_temporal(f"100 BC {EN_DASH} 50 AD") == TimeSpan(
        time_start=-100, time_end=50
    )


# --- temporal: ISO dates and ambiguity -------------------------------------


def test_parse_iso_date_keeps_raw() -> None:
    assert parse_temporal("1879-03-14") == TimeSpan(
        time_start=1879, time_start_iso="1879-03-14"
    )


def test_parse_iso_year_month_keeps_raw() -> None:
    assert parse_temporal("1879-03") == TimeSpan(
        time_start=1879, time_start_iso="1879-03"
    )


def test_parse_ambiguous_keeps_raw_only() -> None:
    span = parse_temporal("Late Bronze Age")
    assert span == TimeSpan(time_start_iso="Late Bronze Age")
    assert span.time_start is None and span.time_end is None


def test_parse_empty_is_empty() -> None:
    span = parse_temporal("   ")
    assert span == TimeSpan()
    assert span.is_empty


# --- coordinates -----------------------------------------------------------


def test_parse_wkt_point_is_lon_lat() -> None:
    # WKT is Point(<lon> <lat>); Lima is roughly (-12.04 lat, -77.03 lon).
    assert parse_point("Point(-77.0282 -12.0432)") == Coordinates(
        lat=-12.0432, lon=-77.0282
    )


def test_parse_lat_lon_pair() -> None:
    assert parse_point("-12.0432, -77.0282") == Coordinates(lat=-12.0432, lon=-77.0282)


def test_parse_lat_lon_separate_fields() -> None:
    assert parse_lat_lon("48.8566", "2.3522") == Coordinates(lat=48.8566, lon=2.3522)


def test_invalid_latitude_is_dropped_with_warning(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING):
        assert parse_lat_lon("999", "0") is None
    assert "out-of-range" in caplog.text


def test_invalid_longitude_in_wkt_is_dropped_with_warning(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING):
        assert parse_point("Point(200 0)") is None
    assert "out-of-range" in caplog.text


def test_unparseable_coordinate_is_dropped_with_warning(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING):
        assert parse_point("somewhere nice") is None
        assert parse_lat_lon("north", "south") is None
    assert "unparseable" in caplog.text


def test_boundary_coordinates_are_valid() -> None:
    assert parse_lat_lon("90", "180") == Coordinates(lat=90.0, lon=180.0)
    assert parse_lat_lon("-90", "-180") == Coordinates(lat=-90.0, lon=-180.0)
