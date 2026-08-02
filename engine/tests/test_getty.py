"""Tests for the Getty N-Triples dump adapter.

A small hand-built ``sample.nt`` excerpt — one AAT concept, one TGN place, one
ULAN agent, plus label nodes and a foreign-namespace triple — exercises subject
grouping, vocabulary detection, literal parsing, and ODC-By provenance without
needing a multi-gigabyte real dump.
"""

from datetime import UTC, datetime
from pathlib import Path

import pytest

from pinakes_engine.acquire import (
    GETTY_LICENSE,
    CategorySpec,
    GettyDumpAdapter,
    GettyDumpError,
    RawRecord,
    SourceSpec,
)

_FIXTURE = Path(__file__).parent / "fixtures" / "getty" / "sample.nt"
_FIXED_NOW = datetime(2026, 6, 16, 12, 0, 0, tzinfo=UTC)


def _spec(query: str | None, params: dict[str, str] | None = None) -> CategorySpec:
    return CategorySpec(
        id="getty-anchors",
        label="Concept",
        description="Getty vocabulary anchors",
        source=SourceSpec(type="dump", query=query, params=params or {}),
        dimensions=(),
    )


def _adapter() -> GettyDumpAdapter:
    return GettyDumpAdapter(now=lambda: _FIXED_NOW)


def _fetch(query: str | None = None, **params: str) -> list[RawRecord]:
    spec = _spec(str(_FIXTURE) if query is None else query, params or None)
    return list(_adapter().fetch(spec))


def _by_id(records: list[RawRecord], rec_id: str) -> RawRecord:
    return next(r for r in records if r.fields["id"] == rec_id)


def test_one_record_per_getty_subject() -> None:
    records = _fetch()
    ids = sorted(r.fields["id"] for r in records)
    assert ids == ["300132410", "500002600", "7000874"]


def test_foreign_namespace_subjects_are_skipped() -> None:
    records = _fetch()
    assert all("example.org" not in r.provenance.source_url for r in records)


def test_aat_record_fields() -> None:
    record = _by_id(_fetch(), "300132410")
    assert record.fields["name"] == "frescoes (paintings)"
    assert record.fields["lang"] == "en"
    # The domain-specific type is preferred over the generic skos:Concept.
    assert record.fields["type"] == "http://vocab.getty.edu/ontology#Concept"
    assert record.fields["uri"] == "http://vocab.getty.edu/aat/300132410"


def test_literal_escapes_are_decoded() -> None:
    record = _by_id(_fetch(), "7000874")
    assert record.fields["name"] == 'Roma ("the eternal city")'
    assert record.fields["lang"] == "it"


def test_record_without_language_tag_omits_lang() -> None:
    record = _by_id(_fetch(), "500002600")
    assert record.fields["name"] == "Rivera, Diego"
    assert "lang" not in record.fields


def test_provenance_names_vocabulary_and_license() -> None:
    records = _fetch()
    provs = {r.fields["id"]: r.provenance for r in records}

    assert provs["300132410"].source == "getty_aat"
    assert provs["7000874"].source == "getty_tgn"
    assert provs["500002600"].source == "getty_ulan"
    for prov in provs.values():
        assert prov.license == GETTY_LICENSE
        assert prov.retrieved_at == "2026-06-16T12:00:00+00:00"
        assert prov.source_url == prov.source_query


def test_license_can_be_overridden_via_params() -> None:
    record = _fetch(license="ODC-By 1.0 (Getty, 2026)")[0]
    assert record.provenance.license == "ODC-By 1.0 (Getty, 2026)"


def test_path_may_come_from_params() -> None:
    records = list(_adapter().fetch(_spec(None, {"path": str(_FIXTURE)})))
    assert len(records) == 3


def test_missing_path_raises() -> None:
    with pytest.raises(GettyDumpError, match="no dump path"):
        list(_adapter().fetch(_spec(None)))


def test_unreadable_dump_raises(tmp_path: Path) -> None:
    missing = tmp_path / "nope.nt"
    with pytest.raises(GettyDumpError, match="cannot read"):
        _fetch(str(missing))


def test_malformed_line_raises(tmp_path: Path) -> None:
    bad = tmp_path / "bad.nt"
    bad.write_text("<http://vocab.getty.edu/aat/1> garbage\n", encoding="utf-8")
    with pytest.raises(GettyDumpError, match="malformed N-Triples"):
        _fetch(str(bad))


def test_adapter_declares_registry_metadata() -> None:
    assert GettyDumpAdapter.name == "getty-dump"
    assert GettyDumpAdapter.source_type == "dump"
