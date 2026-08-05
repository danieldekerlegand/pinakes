"""The JavaScript number and TSV behaviours the analytics port rests on.

Every expectation below was produced by running the corresponding expression in
node, because "the same number" here means "the same bytes on the wire": these
values are rendered into correlation summaries, anomaly prose and separation
strings, all of which are part of the recorded contract. Python's own defaults
disagree with several of them, which is the reason
:mod:`pinakes.analytics.jsmath` exists at all.
"""

from __future__ import annotations

import math

import pytest

from pinakes.analytics import jsmath, tsv


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (0.5, 1),  # Python's round() gives 0 — banker's rounding
        (1.5, 2),
        (2.5, 3),  # ...and 2 here
        (-0.5, 0),
        (-1.5, -1),
        (0.4999999, 0),
        (1234.5, 1235),
        (0, 0),
    ],
)
def test_js_round_breaks_ties_upward(value: float, expected: int) -> None:
    assert jsmath.js_round(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (0.125, "0.13"),  # format(x, ".2f") gives "0.12"
        (0.345, "0.34"),  # ...and "0.34" here too, but for the other reason
        (1.005, "1.00"),
        (2.675, "2.67"),
        (0, "0.00"),
        (1, "1.00"),
        (0.005, "0.01"),
        (0.3450000000000001, "0.35"),
        (0.115, "0.12"),
    ],
)
def test_to_fixed_matches_the_ecmascript_algorithm(value: float, expected: str) -> None:
    assert jsmath.to_fixed(value, 2) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [(0, "0"), (1000, "1,000"), (11200, "11,200"), (1234567, "1,234,567")],
)
def test_locale_int_groups_thousands(value: int, expected: str) -> None:
    assert jsmath.locale_int(value) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("0.4abc", 0.4),
        ("abc", None),
        ("", None),
        ("  .5", 0.5),
        ("1e3", 1000.0),
        ("-0.2", -0.2),
    ],
)
def test_js_parse_float_reads_a_prefix(raw: str, expected: float | None) -> None:
    value = tsv.js_parse_float(raw)
    if expected is None:
        assert math.isnan(value)
    else:
        assert value == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("5abc", 5), ("abc", None), ("", None), ("  -12", -12), (" +7", 7), ("3.9", 3)],
)
def test_js_parse_int_stops_at_the_first_non_digit(
    raw: str, expected: int | None
) -> None:
    value = tsv.js_parse_int(raw)
    if expected is None:
        assert math.isnan(value)
    else:
        assert value == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("", 0.0),
        ("  ", 0.0),
        ("12", 12.0),
        ("12abc", None),
        ("1e3", 1000.0),
        (".5", 0.5),
    ],
)
def test_js_number_must_match_the_whole_string(
    raw: str, expected: float | None
) -> None:
    value = tsv.js_number(raw)
    if expected is None:
        assert math.isnan(value)
    else:
        assert value == expected


# ── The TSV dialect ──────────────────────────────────────────────────────────


def test_blank_lines_are_dropped_and_cells_are_split_on_tabs_only() -> None:
    header, rows = tsv.parse_tsv('id\tname\r\na\tA "quoted"\n\n\nb\tB\n')
    assert header == ["id", "name"]
    # Quoting is not a thing in this dialect — the cell keeps its quotes.
    assert rows == [["a", 'A "quoted"'], ["b", "B"]]


def test_a_short_row_reads_as_blank_rather_than_raising() -> None:
    header, rows = tsv.parse_tsv("id\tname\tregion\nonly-an-id\n")
    assert tsv.cell(rows[0], tsv.index_of(header, "region")) == ""


def test_a_required_column_raises_and_an_optional_one_is_minus_one() -> None:
    header, _ = tsv.parse_tsv("id\tname\nx\tX\n")
    assert tsv.index_of(header, "region") == -1
    with pytest.raises(tsv.MissingColumnError, match="Missing column 'region'"):
        tsv.required_index(header, "region")


def test_an_unparseable_json_array_cell_is_empty_not_an_error() -> None:
    _, rows = tsv.parse_tsv('id\tlangs\nx\t["a", "b"]\ny\tnot json\nz\t\n')
    assert tsv.json_array(rows[0], 1) == ["a", "b"]
    assert tsv.json_array(rows[1], 1) == []
    assert tsv.json_array(rows[2], 1) == []


def test_the_literal_null_cell_is_the_absent_year_sentinel() -> None:
    _, rows = tsv.parse_tsv("id\tyear\na\tnull\nb\t-2800\nc\t\nd\t1200 BCE\n")
    assert tsv.nullable_int(rows[0], 1) is None
    assert tsv.nullable_int(rows[1], 1) == -2800
    assert tsv.nullable_int(rows[2], 1) is None
    assert tsv.nullable_int(rows[3], 1) == 1200


def test_a_zero_reads_as_absent_for_a_number_or_none_column() -> None:
    """``Number(cell) || null`` — the TypeScript's, and it is load-bearing."""
    _, rows = tsv.parse_tsv("id\tspeakers\na\t0\nb\t42\n")
    assert tsv.number_or_none(rows[0], 1) is None
    assert tsv.number_or_none(rows[1], 1) == 42
