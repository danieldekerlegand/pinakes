"""Tests for the ``culturescrape`` command-line entrypoint."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest

from culturescrape import cli
from culturescrape.acquire import (
    CategorySpec,
    Provenance,
    RawRecord,
    SourceAdapter,
    load_index,
)

_FIXTURES = Path(__file__).parent / "fixtures"
_VALID_CATEGORY = _FIXTURES / "categories" / "valid.yml"


class _StubAdapter(SourceAdapter):
    """A network-free adapter that yields two provenance-stamped records."""

    name = "stub"
    source_type = "wikidata-sparql"

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        provenance = Provenance(
            source="stub",
            source_url="https://example.test/1",
            source_query="q",
            retrieved_at="2026-06-16T00:00:00+00:00",
            confidence=1.0,
        )
        yield RawRecord(fields={"name": "ceviche"}, provenance=provenance)
        yield RawRecord(fields={"name": "lomo saltado"}, provenance=provenance)


def test_fetch_with_mocked_adapter_writes_jsonl(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(
        cli, "build_adapter", lambda spec, *, http_factory: _StubAdapter()
    )
    out = tmp_path / "out"

    exit_code = cli.main(["fetch", str(_VALID_CATEGORY), "--out", str(out)])

    assert exit_code == 0
    out_file = out / "peruvian-dishes.jsonl"
    lines = out_file.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2
    first = json.loads(lines[0])
    assert first["fields"] == {"name": "ceviche"}
    assert first["provenance"]["source"] == "stub"
    assert "wrote 2 record(s)" in capsys.readouterr().out

    report = json.loads(
        (out / "peruvian-dishes.report.json").read_text(encoding="utf-8")
    )
    assert report["category_id"] == "peruvian-dishes"
    assert report["adapter"] == "stub"
    assert report["row_count"] == 2
    assert report["distinct_sources"] == ["stub"]
    assert report["error_count"] == 0


def test_fetch_fixture_backed_category_produces_nonempty_output(
    tmp_path: Path,
) -> None:
    fixture = _FIXTURES / "pleiades" / "sample.json"
    category = tmp_path / "ancient-places.yml"
    category.write_text(
        "id: ancient-places\n"
        "label: Place\n"
        "description: Ancient places\n"
        "source:\n"
        "  type: dump\n"
        "  query: " + json.dumps(str(fixture)) + "\n"
        "  params:\n"
        "    adapter: pleiades-dump\n"
        "dimensions: [geographic]\n",
        encoding="utf-8",
    )
    out = tmp_path / "out"

    exit_code = cli.main(["fetch", str(category), "--out", str(out)])

    assert exit_code == 0
    out_file = out / "ancient-places.jsonl"
    lines = out_file.read_text(encoding="utf-8").splitlines()
    assert lines
    record = json.loads(lines[0])
    assert record["fields"]
    assert record["provenance"]["source"]


def test_fetch_unreadable_category_exits_with_error(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code = cli.main(
        ["fetch", str(tmp_path / "missing.yml"), "--out", str(tmp_path / "out")]
    )
    assert exit_code == 2
    assert "error:" in capsys.readouterr().err


def test_fetch_ambiguous_source_type_exits_with_error(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    category = tmp_path / "ambiguous.yml"
    category.write_text(
        "id: ambiguous\n"
        "label: Place\n"
        "description: d\n"
        "source:\n"
        "  type: dump\n"
        "dimensions: []\n",
        encoding="utf-8",
    )
    exit_code = cli.main(["fetch", str(category), "--out", str(tmp_path / "out")])
    assert exit_code == 2
    assert "multiple adapters" in capsys.readouterr().err


def test_missing_subcommand_errors() -> None:
    with pytest.raises(SystemExit):
        cli.main([])


_DUMP = _FIXTURES / "wikidata" / "peruvian_dishes_dump.json"


def test_index_wikidata_builds_sidecar(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    import shutil

    dump = tmp_path / "dump.json"
    shutil.copyfile(_DUMP, dump)
    exit_code = cli.main(["index-wikidata", str(dump)])
    assert exit_code == 0
    index = tmp_path / "dump.json.index.sqlite3"
    assert index.exists()
    loaded = load_index(index, dump)
    try:
        assert loaded.members_of("Q746549") == ["Q207058", "Q2734670"]
    finally:
        loaded.close()
    assert "indexed 8 entit" in capsys.readouterr().out


def test_index_wikidata_missing_dump_errors(tmp_path: Path) -> None:
    assert cli.main(["index-wikidata", str(tmp_path / "absent.json.gz")]) == 2


_RAW_DISHES = _FIXTURES / "raw" / "peruvian_dishes.jsonl"


def test_normalize_fixture_produces_valid_tsv(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "out"

    exit_code = cli.main(
        [
            "normalize",
            str(_RAW_DISHES),
            "--category",
            str(_VALID_CATEGORY),
            "--out",
            str(out),
        ]
    )

    assert exit_code == 0
    assert "TSV valid" in capsys.readouterr().out

    # The two ceviche rows collapse to one node; lomo saltado stays distinct, so
    # the dish file holds two entity nodes anchored to their QIDs.
    dish_text = (out / "nodes" / "dish.tsv").read_text(encoding="utf-8")
    lines = dish_text.splitlines()
    assert lines[0].startswith("csid:ID\t:LABEL\tname")
    assert len(lines) == 3
    assert "cs:dish:Q1047586" in dish_text
    assert "cs:dish:Q2003932" in dish_text

    # Structural nodes and edges land in their canonical files.
    assert (out / "nodes" / "category.tsv").is_file()
    assert (out / "nodes" / "type.tsv").is_file()
    assert (out / "edges" / "member-of-category.tsv").is_file()
    assert (out / "edges" / "instance-of.tsv").is_file()

    # The whole directory passes US-011 validation.
    assert cli.main(["validate", str(out)]) == 0


def test_normalize_is_byte_stable_across_two_runs(tmp_path: Path) -> None:
    first = tmp_path / "first"
    second = tmp_path / "second"
    args = ["normalize", str(_RAW_DISHES), "--category", str(_VALID_CATEGORY)]

    assert cli.main([*args, "--out", str(first)]) == 0
    assert cli.main([*args, "--out", str(second)]) == 0

    for relative in (
        "nodes/dish.tsv",
        "nodes/category.tsv",
        "nodes/type.tsv",
        "edges/member-of-category.tsv",
        "edges/instance-of.tsv",
    ):
        assert (first / relative).read_bytes() == (second / relative).read_bytes()


def test_normalize_unreadable_raw_exits_with_error(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code = cli.main(
        [
            "normalize",
            str(tmp_path / "missing.jsonl"),
            "--category",
            str(_VALID_CATEGORY),
            "--out",
            str(tmp_path / "out"),
        ]
    )
    assert exit_code == 2
    assert "error:" in capsys.readouterr().err


_NODE_HEADER = (
    "csid:ID\t:LABEL\tname\tsource\tsource_url\tretrieved_at\tconfidence:float"
)


def test_validate_passes_on_valid_directory(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    nodes = tmp_path / "nodes"
    nodes.mkdir()
    (nodes / "dish.tsv").write_text(
        _NODE_HEADER
        + "\ncs:dish:ceviche\tDish\tCeviche\twikidata\thttps://x/1\t2026-01-01\t0.9\n",
        encoding="utf-8",
    )
    assert cli.main(["validate", str(tmp_path)]) == 0
    assert "valid" in capsys.readouterr().out


def test_validate_fails_nonzero_on_invalid_directory(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    nodes = tmp_path / "nodes"
    nodes.mkdir()
    # Empty provenance source -> one validation error.
    (nodes / "dish.tsv").write_text(
        _NODE_HEADER
        + "\ncs:dish:ceviche\tDish\tCeviche\t\thttps://x/1\t2026-01-01\t0.9\n",
        encoding="utf-8",
    )
    assert cli.main(["validate", str(tmp_path)]) == 1
    assert "empty provenance" in capsys.readouterr().err


def test_validate_missing_directory_exits_with_error(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert cli.main(["validate", str(tmp_path / "nope")]) == 2
    assert "not a directory" in capsys.readouterr().err
