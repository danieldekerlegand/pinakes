"""Tests for the LinguaScrape canonical-export acquisition adapter.

LinguaScrape exports its lexicons in the shared canonical shape — a directory of
typed Neo4j-import TSVs under ``nodes/`` and ``edges/`` (``docs/data-model.md``).
These tests pin that the adapter turns that export into :class:`RawRecord`\\ s:
the field mapping and the ``linguascrape_id`` round-trip alias, the provenance
lifted out of the row (``source`` stamped ``linguascrape``, a blank
``retrieved_at`` filled from the clock, ``confidence`` parsed), the node/edge
discriminators, the configuration + malformed-file errors, and an end-to-end
pass through the factory over the committed fixture export.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path

import pytest

from culturescrape.acquire.categories import CategorySpec, SourceSpec
from culturescrape.acquire.factory import build_adapter
from culturescrape.acquire.http import HttpClient
from culturescrape.acquire.linguascrape import (
    LINGUASCRAPE_SOURCE,
    LinguaScrapeExportAdapter,
    LinguaScrapeExportError,
)
from culturescrape.acquire.records import RawRecord

#: The committed fixture export (no coupling to a live filesystem path).
FIXTURE_EXPORT = Path(__file__).parent / "fixtures" / "linguascrape" / "export"

_FIXED = datetime(2026, 1, 1, tzinfo=UTC)

_NODE_HEADER = (
    "csid:ID\t:LABEL\tname\tlinguascrape_id\tlanguage_code\t"
    "source\tsource_url\tsource_query\tretrieved_at\tconfidence:float"
)
_EDGE_HEADER = (
    ":START_ID\t:END_ID\t:TYPE\tweight:float\tlinguascrape_id\t"
    "source\tsource_url\tretrieved_at\tconfidence:float"
)


def _spec(query: str | None, params: Mapping[str, str] | None = None) -> CategorySpec:
    return CategorySpec(
        id="linguascrape",
        label="Entity",
        description="the LinguaScrape export",
        source=SourceSpec(type="dump", query=query, params=dict(params or {})),
        dimensions=("linguistic",),
        links=(),
    )


def _fetch(spec: CategorySpec) -> list[RawRecord]:
    return list(LinguaScrapeExportAdapter(now=lambda: _FIXED).fetch(spec))


def _write_export(
    root: Path, *, nodes: Mapping[str, str] = {}, edges: Mapping[str, str] = {}
) -> Path:
    for family, files in (("nodes", nodes), ("edges", edges)):
        directory = root / family
        directory.mkdir(parents=True, exist_ok=True)
        for name, text in files.items():
            (directory / f"{name}.tsv").write_text(text, encoding="utf-8")
    return root


def _key(record: RawRecord) -> str:
    """A node's ``csid`` or an edge's ``start->end`` — a stable lookup handle."""
    if ":TYPE" in record.fields:
        return f"{record.fields[':START_ID']}->{record.fields[':END_ID']}"
    return record.fields["csid"]


def _by_id(records: list[RawRecord]) -> dict[str, RawRecord]:
    return {_key(record): record for record in records}


# --- reading the committed fixture export ------------------------------------


def test_reads_the_committed_fixture_export() -> None:
    records = _fetch(_spec(str(FIXTURE_EXPORT)))

    # 4 node rows (2 languages + 2 archaeological cultures) + 1 edge row.
    assert len(records) == 5
    assert {r.provenance.source for r in records} == {LINGUASCRAPE_SOURCE}


def test_node_row_maps_columns_and_keeps_the_linguascrape_id_alias() -> None:
    records = _by_id(_fetch(_spec(str(FIXTURE_EXPORT))))
    aap = records["cs:language:aap"]

    assert aap.fields["name"] == "Arara (Para)"
    assert aap.fields[":LABEL"] == "Language"
    assert aap.fields["linguascrape_id"] == "aap"  # round-trip alias retained
    assert aap.fields["language_code"] == "aap"
    assert aap.fields["time_start"] == "1000"  # typed suffix stripped from the key


def test_provenance_is_lifted_out_of_the_fields() -> None:
    aap = _by_id(_fetch(_spec(str(FIXTURE_EXPORT))))["cs:language:aap"]

    # The five provenance columns become Provenance, not overflow fields.
    provenance_columns = (
        "source",
        "source_url",
        "source_query",
        "retrieved_at",
        "confidence",
    )
    for column in provenance_columns:
        assert column not in aap.fields
    assert aap.provenance.source == LINGUASCRAPE_SOURCE
    assert aap.provenance.source_query == "Ethnologue; Glottolog"
    assert aap.provenance.confidence == 0.5


def test_blank_retrieved_at_is_stamped_from_the_clock() -> None:
    # The export leaves retrieved_at blank; the adapter fills it at ingest time.
    aap = _by_id(_fetch(_spec(str(FIXTURE_EXPORT))))["cs:language:aap"]
    assert aap.provenance.retrieved_at == _FIXED.isoformat()


def test_edges_carry_the_type_and_endpoints() -> None:
    records = _by_id(_fetch(_spec(str(FIXTURE_EXPORT))))
    edge = records[
        "cs:archaeological-culture:bell-beaker"
        "->cs:archaeological-culture:yamnaya"
    ]

    assert edge.fields[":TYPE"] == "DESCENDS_FROM"
    assert edge.fields[":START_ID"] == "cs:archaeological-culture:bell-beaker"
    assert edge.fields[":END_ID"] == "cs:archaeological-culture:yamnaya"
    assert ":LABEL" not in edge.fields  # edges are discriminated from nodes
    assert edge.provenance.confidence == 0.85


# --- configuration -----------------------------------------------------------


def test_path_may_come_from_source_params() -> None:
    records = _fetch(_spec(None, {"path": str(FIXTURE_EXPORT)}))
    assert len(records) == 5


def test_source_name_is_overridable() -> None:
    records = _fetch(_spec(str(FIXTURE_EXPORT), {"source": "linguascrape-2024"}))
    assert {r.provenance.source for r in records} == {"linguascrape-2024"}


def test_license_is_stamped_when_configured() -> None:
    records = _fetch(_spec(str(FIXTURE_EXPORT), {"license": "CC-BY-4.0"}))
    assert {r.provenance.license for r in records} == {"CC-BY-4.0"}


def test_per_row_license_column_is_lifted_and_overrides_the_param(
    tmp_path: Path,
) -> None:
    # Canonical schema v1.1 (US-003): a row-level `license` cell wins over the
    # export-level license param and is lifted into Provenance, not overflow fields.
    header = (
        "csid:ID\t:LABEL\tname\tlinguascrape_id\t"
        "source\tsource_url\tsource_query\tretrieved_at\tconfidence:float\tlicense"
    )
    root = _write_export(
        tmp_path,
        nodes={
            "language": f"{header}\n"
            "cs:language:xx\tLanguage\tX\txx\tlinguascrape\t\t\t\t0.5\tCC0-1.0"
        },
    )
    (record,) = _fetch(_spec(str(root), {"license": "CC-BY-4.0"}))
    assert record.provenance.license == "CC0-1.0"  # row cell overrides the param
    assert "license" not in record.fields  # lifted into Provenance, not overflow


def test_confidence_defaults_when_blank(tmp_path: Path) -> None:
    root = _write_export(
        tmp_path,
        nodes={
            "language": f"{_NODE_HEADER}\n"
            "cs:language:xx\tLanguage\tX\txx\txx\tlinguascrape\t\t\t\t"
        },
    )
    (record,) = _fetch(_spec(str(root)))
    assert record.provenance.confidence == 1.0  # DEFAULT_CONFIDENCE


def test_empty_cells_are_dropped_from_fields(tmp_path: Path) -> None:
    root = _write_export(
        tmp_path,
        nodes={
            "language": f"{_NODE_HEADER}\n"
            "cs:language:xx\tLanguage\tX\txx\t\tlinguascrape\t\t\t\t0.5"
        },
    )
    (record,) = _fetch(_spec(str(root)))
    assert "language_code" not in record.fields  # blank cell not carried


def test_only_one_of_nodes_or_edges_need_be_present(tmp_path: Path) -> None:
    root = _write_export(
        tmp_path,
        edges={
            "descended-from": f"{_EDGE_HEADER}\n"
            "cs:x\tcs:y\tDESCENDS_FROM\t\t\tlinguascrape\t\t\t0.9"
        },
    )
    (record,) = _fetch(_spec(str(root)))
    assert record.fields[":TYPE"] == "DESCENDS_FROM"


# --- errors ------------------------------------------------------------------


def test_missing_path_is_rejected() -> None:
    with pytest.raises(LinguaScrapeExportError, match="no export path"):
        _fetch(_spec(None))


def test_non_directory_root_is_rejected(tmp_path: Path) -> None:
    file_path = tmp_path / "export.tsv"
    file_path.write_text("x\n", encoding="utf-8")
    with pytest.raises(LinguaScrapeExportError, match="is not a directory"):
        _fetch(_spec(str(file_path)))


def test_a_directory_without_nodes_or_edges_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(LinguaScrapeExportError, match="is not a LinguaScrape export"):
        _fetch(_spec(str(tmp_path)))


def test_a_non_canonical_header_is_rejected(tmp_path: Path) -> None:
    root = _write_export(tmp_path, nodes={"junk": "a\tb\tc\n1\t2\t3"})
    with pytest.raises(LinguaScrapeExportError, match="invalid canonical header"):
        _fetch(_spec(str(root)))


def test_a_row_with_the_wrong_column_count_is_rejected(tmp_path: Path) -> None:
    root = _write_export(
        tmp_path,
        nodes={"language": f"{_NODE_HEADER}\ncs:language:xx\tLanguage\tX"},
    )
    with pytest.raises(LinguaScrapeExportError, match="columns, header has"):
        _fetch(_spec(str(root)))


# --- factory selection -------------------------------------------------------


def test_factory_selects_the_adapter_via_params() -> None:
    spec = _spec(str(FIXTURE_EXPORT), {"adapter": "linguascrape-export"})

    def _no_http() -> HttpClient:  # pragma: no cover - a dump takes no client
        raise AssertionError("a local export must not build an HttpClient")

    adapter = build_adapter(spec, http_factory=_no_http)
    assert isinstance(adapter, LinguaScrapeExportAdapter)
