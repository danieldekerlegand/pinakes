"""Tests for node/edge TSV validation."""

from __future__ import annotations

from pathlib import Path

from pinakes_engine.schema import validate_directory
from pinakes_engine.schema.validate import ValidationError

#: A well-formed node header (structural keys + provenance + one typed column).
NODE_HEADER = (
    "csid:ID\t:LABEL\tname\ttime_start:int\t"
    "source\tsource_url\tretrieved_at\tconfidence:float"
)

#: A well-formed edge header (structural keys + provenance).
EDGE_HEADER = (
    ":START_ID\t:END_ID\t:TYPE\t"
    "source\tsource_url\tretrieved_at\tconfidence:float"
)


def _write(path: Path, lines: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _valid_tree(root: Path) -> None:
    """A directory with one valid node file and one valid edge file."""
    _write(
        root / "nodes" / "dish.tsv",
        [
            NODE_HEADER,
            "cs:dish:ceviche\tDish\tCeviche\t-100\twikidata\thttps://x/1\t2026-01-01\t0.9",
            "cs:place:peru\tPlace\tPeru\t\twikidata\thttps://x/2\t2026-01-01\t1.0",
        ],
    )
    _write(
        root / "edges" / "originates_from.tsv",
        [
            EDGE_HEADER,
            "cs:dish:ceviche\tcs:place:peru\tORIGINATES_FROM\t"
            "wikidata\thttps://x/3\t2026-01-01\t0.8",
        ],
    )


def _messages(errors: list[ValidationError]) -> str:
    return "\n".join(str(e) for e in errors)


def test_valid_directory_has_no_errors(tmp_path: Path) -> None:
    _valid_tree(tmp_path)
    assert validate_directory(tmp_path) == []


def test_missing_required_header(tmp_path: Path) -> None:
    _valid_tree(tmp_path)
    # Drop the provenance ``source`` column from the node header (and its cell).
    _write(
        tmp_path / "nodes" / "dish.tsv",
        [
            "csid:ID\t:LABEL\tname\tsource_url\tretrieved_at\tconfidence:float",
            "cs:dish:ceviche\tDish\tCeviche\thttps://x/1\t2026-01-01\t0.9",
        ],
    )
    errors = validate_directory(tmp_path)
    assert any(
        e.line == 1 and e.column == "source" and "missing required header" in e.message
        for e in errors
    ), _messages(errors)


def test_unparsable_typed_column(tmp_path: Path) -> None:
    _valid_tree(tmp_path)
    _write(
        tmp_path / "nodes" / "dish.tsv",
        [
            NODE_HEADER,
            "cs:dish:ceviche\tDish\tCeviche\tnot-a-year\t"
            "wikidata\thttps://x/1\t2026-01-01\t0.9",
        ],
    )
    errors = validate_directory(tmp_path)
    assert any(
        e.line == 2
        and e.column == "time_start:int"
        and "not a valid int" in e.message
        for e in errors
    ), _messages(errors)


def test_duplicate_csid(tmp_path: Path) -> None:
    _valid_tree(tmp_path)
    _write(
        tmp_path / "nodes" / "dish.tsv",
        [
            NODE_HEADER,
            "cs:dish:ceviche\tDish\tCeviche\t\twikidata\thttps://x/1\t2026-01-01\t0.9",
            "cs:dish:ceviche\tDish\tCebiche\t\twikidata\thttps://x/2\t2026-01-01\t0.9",
        ],
    )
    errors = validate_directory(tmp_path)
    assert any(
        e.column == "csid:ID" and "duplicate csid" in e.message for e in errors
    ), _messages(errors)


def test_edge_references_unknown_csid(tmp_path: Path) -> None:
    _valid_tree(tmp_path)
    _write(
        tmp_path / "edges" / "originates_from.tsv",
        [
            EDGE_HEADER,
            "cs:dish:ceviche\tcs:place:atlantis\tORIGINATES_FROM\t"
            "wikidata\thttps://x/3\t2026-01-01\t0.8",
        ],
    )
    errors = validate_directory(tmp_path)
    assert any(
        e.column == ":END_ID"
        and "unknown csid 'cs:place:atlantis'" in e.message
        for e in errors
    ), _messages(errors)


def test_empty_provenance(tmp_path: Path) -> None:
    _valid_tree(tmp_path)
    _write(
        tmp_path / "nodes" / "dish.tsv",
        [
            NODE_HEADER,
            "cs:dish:ceviche\tDish\tCeviche\t\t\thttps://x/1\t2026-01-01\t0.9",
        ],
    )
    errors = validate_directory(tmp_path)
    assert any(
        e.line == 2 and e.column == "source" and "empty provenance" in e.message
        for e in errors
    ), _messages(errors)


def test_empty_csid_is_reported(tmp_path: Path) -> None:
    _valid_tree(tmp_path)
    _write(
        tmp_path / "nodes" / "dish.tsv",
        [
            NODE_HEADER,
            "\tDish\tCeviche\t\twikidata\thttps://x/1\t2026-01-01\t0.9",
        ],
    )
    errors = validate_directory(tmp_path)
    assert any(
        e.column == "csid:ID" and "empty csid" in e.message for e in errors
    ), _messages(errors)


def test_ragged_row_is_reported_not_crashing(tmp_path: Path) -> None:
    _valid_tree(tmp_path)
    # One cell short of the header width: read fails, reported as a file error.
    _write(
        tmp_path / "nodes" / "dish.tsv",
        [NODE_HEADER, "cs:dish:ceviche\tDish\tCeviche"],
    )
    errors = validate_directory(tmp_path)
    assert errors
    assert any("cells, expected" in e.message for e in errors), _messages(errors)


def test_error_str_includes_file_line_column(tmp_path: Path) -> None:
    error = ValidationError(tmp_path / "nodes" / "dish.tsv", 2, "csid:ID", "boom")
    rendered = str(error)
    assert rendered.endswith(":2:csid:ID: boom")
    assert "dish.tsv" in rendered


def test_classifies_by_header_outside_named_dirs(tmp_path: Path) -> None:
    # A file not under nodes/ or edges/ is classified by its header.
    _write(
        tmp_path / "loose_edge.tsv",
        [
            EDGE_HEADER,
            "cs:a\tcs:b\tADJACENT_TO\twikidata\thttps://x\t2026-01-01\t0.5",
        ],
    )
    errors = validate_directory(tmp_path)
    # Both endpoints are unknown (no node files), so two reference errors.
    assert {e.column for e in errors} == {":START_ID", ":END_ID"}, _messages(errors)


def test_unregistered_edge_type_is_rejected(tmp_path: Path) -> None:
    _valid_tree(tmp_path)
    _write(
        tmp_path / "edges" / "originates_from.tsv",
        [
            EDGE_HEADER,
            "cs:dish:ceviche\tcs:place:peru\tNEAR\t"
            "wikidata\thttps://x/3\t2026-01-01\t0.8",
        ],
    )
    errors = validate_directory(tmp_path)
    assert any(
        e.line == 2
        and e.column == ":TYPE"
        and "unregistered relationship type 'NEAR'" in e.message
        for e in errors
    ), _messages(errors)


def test_registered_edge_type_passes(tmp_path: Path) -> None:
    _valid_tree(tmp_path)
    # ORIGINATES_FROM is a registered type; the valid tree must stay clean.
    assert validate_directory(tmp_path) == []
