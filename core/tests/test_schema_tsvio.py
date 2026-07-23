"""Tests for lossless tab-delimited row IO."""

from pathlib import Path

import pytest

from culturescrape.schema import (
    EdgeSchema,
    IdColumn,
    NodeSchema,
    PropertyColumn,
    StructuralColumn,
    TsvError,
    column_key,
    decode_value,
    decode_values,
    encode_value,
    encode_values,
    read_rows,
    write_edge_rows,
    write_node_rows,
    write_rows,
)

#: Values that would corrupt a naive TSV file.
HOSTILE = [
    "plain",
    "",
    "has\ttab",
    "has\nnewline",
    "has\r\ncrlf",
    "back\\slash",
    "semi;colon",
    "escaped\\;already",
    "\\t literal not a tab",
    "everything\t\n\\;mixed",
]


@pytest.mark.parametrize("value", HOSTILE)
def test_value_round_trip(value: str) -> None:
    assert decode_value(encode_value(value)) == value


def test_encoded_value_has_no_raw_control_chars() -> None:
    encoded = encode_value("a\tb\nc\\d")
    assert "\t" not in encoded
    assert "\n" not in encoded
    # The only backslashes are part of escape sequences.
    assert encoded == "a\\tb\\nc\\\\d"


def test_escaped_backslash_is_not_a_tab() -> None:
    # A literal backslash-t must decode back to backslash-t, not a tab.
    assert decode_value(encode_value("\\t")) == "\\t"


@pytest.mark.parametrize(
    "values",
    [
        [],
        ["one"],
        ["a", "b", "c"],
        ["with;semi", "with\ttab", "with\nnl", "back\\slash"],
        [";", "\\", "\\;"],
    ],
)
def test_values_round_trip(values: list[str]) -> None:
    assert decode_values(encode_values(values)) == values


def test_multi_value_splits_only_on_unescaped_delimiter() -> None:
    encoded = encode_values(["a;b", "c"])
    assert encoded == "a\\;b;c"
    assert decode_values(encoded) == ["a;b", "c"]


def test_empty_cell_is_empty_list() -> None:
    assert decode_values("") == []
    assert encode_values([]) == ""


def test_decode_rejects_dangling_escape() -> None:
    with pytest.raises(TsvError):
        decode_value("trailing\\")


def test_decode_rejects_invalid_escape() -> None:
    with pytest.raises(TsvError):
        decode_value("bad\\x")


def test_column_key() -> None:
    assert column_key(IdColumn("csid")) == "csid"
    assert column_key(StructuralColumn(":LABEL")) == ":LABEL"
    assert column_key(PropertyColumn("name")) == "name"


def test_write_then_read_round_trip(tmp_path: Path) -> None:
    schema = NodeSchema.canonical()
    rows = [
        {
            "csid": "cs:dish:ceviche",
            ":LABEL": ["Dish", "Cultural;Artifact"],
            "name": "Ceviche\twith\ttabs",
            "aliases": ["cebiche", "seviche\nnewline"],
            "description": "fish\\marinated; in citrus",
            "source": "wikidata",
        },
        {
            "csid": "cs:dish:empty",
            ":LABEL": [],
            "name": "",
            "aliases": [],
        },
    ]
    path = tmp_path / "nodes" / "dish.tsv"
    written = write_rows(path, schema.columns, rows)
    assert written == 2

    columns, read = read_rows(path)
    assert columns == schema.columns

    # Header is always the first physical line.
    lines = path.read_text(encoding="utf-8").split("\n")
    assert lines[0] == "\t".join(c.header for c in schema.columns)

    # Provided fields survive exactly; absent fields read back empty.
    assert read[0]["csid"] == "cs:dish:ceviche"
    assert read[0][":LABEL"] == ["Dish", "Cultural;Artifact"]
    assert read[0]["name"] == "Ceviche\twith\ttabs"
    assert read[0]["aliases"] == ["cebiche", "seviche\nnewline"]
    assert read[0]["description"] == "fish\\marinated; in citrus"
    assert read[0]["source"] == "wikidata"
    assert read[0]["wikidata_qid"] == ""

    assert read[1]["name"] == ""
    assert read[1][":LABEL"] == []
    assert read[1]["aliases"] == []


def test_write_is_deterministic(tmp_path: Path) -> None:
    schema = NodeSchema.canonical()
    rows = [{"csid": "cs:1", ":LABEL": ["Dish"], "name": "a\tb"}]
    a = tmp_path / "a.tsv"
    b = tmp_path / "b.tsv"
    write_rows(a, schema.columns, rows)
    write_rows(b, schema.columns, rows)
    assert a.read_bytes() == b.read_bytes()


def test_write_node_rows_sorts_by_csid(tmp_path: Path) -> None:
    schema = NodeSchema.canonical()
    rows = [
        {"csid": "cs:dish:c", ":LABEL": ["Dish"], "name": "c"},
        {"csid": "cs:dish:a", ":LABEL": ["Dish"], "name": "a"},
        {"csid": "cs:dish:b", ":LABEL": ["Dish"], "name": "b"},
    ]
    path = tmp_path / "nodes.tsv"
    assert write_node_rows(path, schema, rows) == 3
    _, read = read_rows(path)
    assert [r["csid"] for r in read] == ["cs:dish:a", "cs:dish:b", "cs:dish:c"]


def test_write_node_rows_uses_canonical_column_order(tmp_path: Path) -> None:
    schema = NodeSchema.canonical()
    path = tmp_path / "nodes.tsv"
    write_node_rows(path, schema, [{"csid": "cs:1", ":LABEL": ["Dish"], "name": "n"}])
    columns, _ = read_rows(path)
    assert columns == schema.columns


def test_write_node_rows_is_byte_stable_across_input_orderings(
    tmp_path: Path,
) -> None:
    schema = NodeSchema.canonical()
    rows = [
        {"csid": "cs:3", ":LABEL": ["Dish"], "name": "three\twith\ttab"},
        {"csid": "cs:1", ":LABEL": ["Dish", "Artifact"], "aliases": ["x", "y"]},
        {"csid": "cs:2", ":LABEL": [], "name": "two"},
    ]
    a = tmp_path / "a.tsv"
    b = tmp_path / "b.tsv"
    write_node_rows(a, schema, rows)
    write_node_rows(b, schema, list(reversed(rows)))
    assert a.read_bytes() == b.read_bytes()


def test_write_edge_rows_sorts_by_start_end_type(tmp_path: Path) -> None:
    schema = EdgeSchema.canonical()
    rows = [
        {":START_ID": "cs:1", ":END_ID": "cs:2", ":TYPE": "NEAR"},
        {":START_ID": "cs:1", ":END_ID": "cs:2", ":TYPE": "AFTER"},
        {":START_ID": "cs:1", ":END_ID": "cs:1", ":TYPE": "NEAR"},
        {":START_ID": "cs:0", ":END_ID": "cs:9", ":TYPE": "NEAR"},
    ]
    path = tmp_path / "edges.tsv"
    assert write_edge_rows(path, schema, rows) == 4
    _, read = read_rows(path)
    assert [(r[":START_ID"], r[":END_ID"], r[":TYPE"]) for r in read] == [
        ("cs:0", "cs:9", "NEAR"),
        ("cs:1", "cs:1", "NEAR"),
        ("cs:1", "cs:2", "AFTER"),
        ("cs:1", "cs:2", "NEAR"),
    ]


def test_write_edge_rows_is_byte_stable_across_input_orderings(
    tmp_path: Path,
) -> None:
    schema = EdgeSchema.canonical()
    rows = [
        {":START_ID": "cs:1", ":END_ID": "cs:2", ":TYPE": "NEAR", "weight": "0.5"},
        {":START_ID": "cs:0", ":END_ID": "cs:9", ":TYPE": "AFTER"},
        {":START_ID": "cs:1", ":END_ID": "cs:1", ":TYPE": "NEAR"},
    ]
    a = tmp_path / "a.tsv"
    b = tmp_path / "b.tsv"
    write_edge_rows(a, schema, rows)
    write_edge_rows(b, schema, list(reversed(rows)))
    assert a.read_bytes() == b.read_bytes()


def test_write_node_rows_rejects_list_sort_key(tmp_path: Path) -> None:
    schema = NodeSchema.canonical()
    with pytest.raises(TsvError):
        write_node_rows(
            tmp_path / "x.tsv",
            schema,
            [{"csid": ["not", "scalar"], ":LABEL": ["Dish"], "name": "n"}],
        )


def test_write_rejects_string_for_multi_value_column(tmp_path: Path) -> None:
    schema = NodeSchema.canonical()
    with pytest.raises(TsvError):
        write_rows(
            tmp_path / "x.tsv",
            schema.columns,
            [{"csid": "cs:1", ":LABEL": "Dish", "name": "n"}],
        )


def test_read_rejects_wrong_cell_count(tmp_path: Path) -> None:
    path = tmp_path / "bad.tsv"
    path.write_text("csid:ID\t:LABEL\tname\nonly\ttwo\n", encoding="utf-8")
    with pytest.raises(TsvError):
        read_rows(path)
