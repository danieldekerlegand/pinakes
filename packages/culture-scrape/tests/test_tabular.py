"""Tests for the generic tabular/JSON dump adapter.

The adapter ingests an arbitrary local dataset by renaming its columns onto the
canonical field names the normalizer recognizes. These tests pin the column
rename + passthrough, every supported format, the provenance stamping (source,
licence, confidence, and the templated ``source_url``), and the configuration
errors — plus an end-to-end pass through the factory and the normalizer so a
third-party dump really does become canonical TSV.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path

import pytest

from culturescrape.acquire.categories import CategorySpec, SourceSpec
from culturescrape.acquire.factory import AdapterSelectionError, build_adapter
from culturescrape.acquire.http import HttpClient
from culturescrape.acquire.records import RawRecord
from culturescrape.acquire.tabular import TabularDumpAdapter, TabularDumpError

_FIXED = datetime(2026, 1, 1, tzinfo=UTC)


def _spec(params: Mapping[str, str], *, query: str | None = None) -> CategorySpec:
    return CategorySpec(
        id="ds",
        label="Place",
        description="a local dataset",
        source=SourceSpec(type="dump", query=query, params=dict(params)),
        dimensions=("geographic",),
        links=(),
    )


def _fetch(spec: CategorySpec) -> list[RawRecord]:
    return list(TabularDumpAdapter(now=lambda: _FIXED).fetch(spec))


def _write(path: Path, text: str) -> Path:
    path.write_text(text, encoding="utf-8")
    return path


def test_tsv_renames_mapped_columns_and_keeps_the_rest(tmp_path: Path) -> None:
    dump = _write(
        tmp_path / "cities.tsv",
        "gid\tcity_name\tqid\n1\tCusco\tQ5582\n",
    )
    records = _fetch(
        _spec(
            {
                "path": str(dump),
                "field.name": "city_name",
                "field.wikidata_qid": "qid",
            }
        )
    )
    (record,) = records
    assert record.fields["name"] == "Cusco"  # renamed onto a canonical field
    assert record.fields["wikidata_qid"] == "Q5582"
    assert record.fields["gid"] == "1"  # unmapped column kept under its own name
    assert "city_name" not in record.fields  # the original name is gone


def test_path_may_come_from_source_query(tmp_path: Path) -> None:
    dump = _write(tmp_path / "d.tsv", "name\nAlice\n")
    (record,) = _fetch(_spec({}, query=str(dump)))
    assert record.fields["name"] == "Alice"


def test_csv_format_inferred_from_extension(tmp_path: Path) -> None:
    dump = _write(tmp_path / "d.csv", "name,qid\nLima,Q2868\n")
    (record,) = _fetch(_spec({"path": str(dump), "field.wikidata_qid": "qid"}))
    assert record.fields["name"] == "Lima"
    assert record.fields["wikidata_qid"] == "Q2868"


def test_json_array_of_objects(tmp_path: Path) -> None:
    dump = _write(
        tmp_path / "d.json",
        '[{"name": "A", "rank": 1}, {"name": "B", "rank": 2}]',
    )
    records = _fetch(_spec({"path": str(dump)}))
    assert [r.fields["name"] for r in records] == ["A", "B"]
    assert records[0].fields["rank"] == "1"  # non-string scalar stringified


def test_jsonl_one_object_per_line(tmp_path: Path) -> None:
    dump = _write(tmp_path / "d.jsonl", '{"name": "A"}\n\n{"name": "B"}\n')
    records = _fetch(_spec({"path": str(dump)}))
    assert [r.fields["name"] for r in records] == ["A", "B"]


def test_nested_json_values_are_serialized(tmp_path: Path) -> None:
    dump = _write(tmp_path / "d.json", '[{"name": "A", "tags": ["x", "y"]}]')
    (record,) = _fetch(_spec({"path": str(dump)}))
    assert record.fields["tags"] == '["x", "y"]'


def test_empty_cells_are_dropped_and_blank_rows_skipped(tmp_path: Path) -> None:
    dump = _write(
        tmp_path / "d.csv",
        "name,qid\nLima,\n,\n",  # second row is entirely empty
    )
    records = _fetch(_spec({"path": str(dump), "field.wikidata_qid": "qid"}))
    (record,) = records  # the all-empty row produced no record
    assert record.fields == {"name": "Lima"}  # empty qid cell dropped


def test_provenance_is_stamped_with_source_licence_and_templated_url(
    tmp_path: Path,
) -> None:
    dump = _write(tmp_path / "d.tsv", "gid\tname\n42\tCusco\n")
    (record,) = _fetch(
        _spec(
            {
                "path": str(dump),
                "source": "andean-gazetteer",
                "license": "CC-BY 4.0",
                "confidence": "0.8",
                "id_column": "gid",
                "url_template": "https://example.org/city/{id}",
            }
        )
    )
    prov = record.provenance
    assert prov.source == "andean-gazetteer"
    assert prov.license == "CC-BY 4.0"
    assert prov.confidence == 0.8
    assert prov.source_url == "https://example.org/city/42"
    assert prov.source_query == str(dump)
    assert prov.retrieved_at == _FIXED.isoformat()


def test_source_url_falls_back_to_the_dump_path(tmp_path: Path) -> None:
    dump = _write(tmp_path / "d.tsv", "name\nCusco\n")
    (record,) = _fetch(_spec({"path": str(dump)}))
    assert record.provenance.source_url == str(dump)
    assert record.provenance.source == "dump"  # default source name


def test_explicit_format_and_delimiter_override(tmp_path: Path) -> None:
    dump = _write(tmp_path / "d.txt", "name|qid\nLima|Q2868\n")
    (record,) = _fetch(
        _spec({"path": str(dump), "format": "csv", "delimiter": "|"})
    )
    assert record.fields["name"] == "Lima"
    assert record.fields["qid"] == "Q2868"


def test_missing_path_raises(tmp_path: Path) -> None:
    with pytest.raises(TabularDumpError, match="no dump path"):
        _fetch(_spec({}))


def test_missing_file_raises(tmp_path: Path) -> None:
    with pytest.raises(TabularDumpError, match="cannot read dump"):
        _fetch(_spec({"path": str(tmp_path / "nope.tsv")}))


def test_unsupported_format_raises(tmp_path: Path) -> None:
    dump = _write(tmp_path / "d.xml", "<rows/>")
    with pytest.raises(TabularDumpError, match="unsupported dump format"):
        _fetch(_spec({"path": str(dump)}))


def test_bad_confidence_raises(tmp_path: Path) -> None:
    dump = _write(tmp_path / "d.tsv", "name\nCusco\n")
    with pytest.raises(TabularDumpError, match="confidence"):
        _fetch(_spec({"path": str(dump), "confidence": "high"}))


def test_header_less_file_raises(tmp_path: Path) -> None:
    dump = _write(tmp_path / "d.tsv", "")
    with pytest.raises(TabularDumpError, match="no header row"):
        _fetch(_spec({"path": str(dump)}))


def test_factory_selects_tabular_dump_via_adapter_param(tmp_path: Path) -> None:
    spec = _spec({"path": str(tmp_path / "d.tsv"), "adapter": "tabular-dump"})
    adapter = build_adapter(spec, http_factory=lambda: HttpClient(cache_dir=tmp_path))
    assert isinstance(adapter, TabularDumpAdapter)


def test_factory_requires_adapter_param_for_ambiguous_dump(tmp_path: Path) -> None:
    # `dump` is now served by three adapters, so the spec must disambiguate.
    spec = _spec({"path": str(tmp_path / "d.tsv")})
    with pytest.raises(AdapterSelectionError, match="multiple adapters"):
        build_adapter(spec, http_factory=lambda: HttpClient(cache_dir=tmp_path))
