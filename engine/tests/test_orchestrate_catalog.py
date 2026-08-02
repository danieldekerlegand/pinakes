"""Tests for the corpus catalog built after each job run."""

from collections.abc import Iterator
from dataclasses import replace
from datetime import datetime
from pathlib import Path

import pytest

from pinakes_engine.acquire.adapters import SourceAdapter
from pinakes_engine.acquire.categories import CategorySpec, load_category
from pinakes_engine.acquire.records import RawRecord
from pinakes_engine.cli import main
from pinakes_engine.ontology.metrics import metrics_for_dataset
from pinakes_engine.orchestrate import (
    STAGE_ORDER,
    Job,
    load_catalog,
    render_table,
    run_job,
)
from pinakes_engine.orchestrate.catalog import (
    CATALOG_NAME,
    Catalog,
    CatalogEntry,
    ProvenanceSummary,
)
from pinakes_engine.orchestrate.runner import AdapterFactory
from pinakes_engine.schema.pipeline import read_raw_records

FIXTURES = Path(__file__).parent / "fixtures"
RAW_RECORDS = FIXTURES / "raw" / "peruvian_dishes.jsonl"


class _StubAdapter(SourceAdapter):
    name = "stub"
    source_type = "dump"

    def __init__(self, records: list[RawRecord]) -> None:
        self._records = records

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        yield from self._records


def _spec() -> CategorySpec:
    return load_category(FIXTURES / "categories" / "valid.yml")


def _job(output_root: Path, *specs: CategorySpec, stages: tuple[str, ...]) -> Job:
    return Job(
        name="fixture-job",
        description="",
        categories=specs or (_spec(),),
        stages=stages,
        output_root=output_root,
    )


def _stub_factory() -> AdapterFactory:
    records = read_raw_records(RAW_RECORDS)
    return lambda spec: _StubAdapter(records)


def test_catalog_written_after_run_matches_fixture_dataset(tmp_path: Path) -> None:
    out = tmp_path / "out"
    job = _job(out, stages=STAGE_ORDER)

    run_job(job, adapter_factory=_stub_factory())

    catalog = load_catalog(out)
    (entry,) = catalog.entries
    # Identity comes straight from the spec.
    assert entry.id == "peruvian-dishes"
    assert entry.label == "Dish;CulturalArtifact"
    assert entry.source == "wikidata-sparql"

    # Node/edge counts match the dataset the link stage actually produced.
    metrics = metrics_for_dataset(out / "link" / "peruvian-dishes")
    assert entry.node_count == metrics.node_count > 0
    assert entry.edge_count == metrics.edge_count > 0
    assert entry.dimensions == tuple(
        d for d in metrics.edges_by_dimension if d != "unknown"
    )

    # Provenance is read from the acquisition report: three records, no errors.
    assert entry.provenance.records == 3
    assert entry.provenance.errors == 0
    assert entry.provenance.adapter == "stub"

    # The timestamp is a parseable ISO-8601 instant.
    assert datetime.fromisoformat(entry.last_run)


def test_catalog_file_lives_at_output_root(tmp_path: Path) -> None:
    out = tmp_path / "out"
    run_job(_job(out, stages=STAGE_ORDER), adapter_factory=_stub_factory())
    assert (out / CATALOG_NAME).is_file()


def test_normalize_only_run_catalogs_normalized_counts(tmp_path: Path) -> None:
    out = tmp_path / "out"
    job = _job(out, stages=("acquire", "normalize"))

    run_job(job, adapter_factory=_stub_factory())

    (entry,) = load_catalog(out).entries
    metrics = metrics_for_dataset(out / "normalize" / "peruvian-dishes")
    assert entry.node_count == metrics.node_count
    assert entry.edge_count == metrics.edge_count


def test_second_job_upserts_without_dropping_other_categories(tmp_path: Path) -> None:
    out = tmp_path / "out"
    first = _spec()
    second = replace(first, id="other-dishes")

    run_job(_job(out, first, stages=STAGE_ORDER), adapter_factory=_stub_factory())
    run_job(_job(out, second, stages=STAGE_ORDER), adapter_factory=_stub_factory())

    ids = [entry.id for entry in load_catalog(out).entries]
    # The second run added its category and kept the first; entries sort by id.
    assert ids == ["other-dishes", "peruvian-dishes"]


def test_failed_category_is_not_catalogued(tmp_path: Path) -> None:
    out = tmp_path / "out"
    run_job(_job(out, stages=STAGE_ORDER), adapter_factory=_stub_factory())
    before = {entry.id for entry in load_catalog(out).entries}

    # A fresh category that fails at acquire produces no dataset, so it earns no
    # catalog entry — and the already-catalogued category survives untouched.
    broken = replace(_spec(), id="broken")

    def broken_factory(spec: CategorySpec) -> SourceAdapter:
        raise RuntimeError("no adapter")

    run_job(_job(out, broken, stages=STAGE_ORDER), adapter_factory=broken_factory)

    ids = {entry.id for entry in load_catalog(out).entries}
    assert ids == before
    assert "broken" not in ids


def test_load_catalog_missing_is_empty(tmp_path: Path) -> None:
    assert load_catalog(tmp_path).entries == ()


def test_render_table_lists_each_category() -> None:
    catalog = Catalog(
        (
            CatalogEntry(
                id="peruvian-dishes",
                label="Dish",
                source="wikidata-sparql",
                node_count=12,
                edge_count=7,
                dimensions=("geographic", "temporal"),
                last_run="2026-06-16T00:00:00+00:00",
                provenance=ProvenanceSummary(
                    adapter="stub", sources=("wikidata",), records=3, errors=0
                ),
            ),
        )
    )

    table = render_table(catalog)
    assert "peruvian-dishes" in table
    assert "geographic,temporal" in table
    assert "wikidata (3 rec)" in table
    assert "id" in table.splitlines()[0]


def test_render_table_empty_catalog() -> None:
    assert "empty" in render_table(Catalog(()))


def test_cli_catalog_prints_table(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "out"
    run_job(_job(out, stages=STAGE_ORDER), adapter_factory=_stub_factory())

    exit_code = main(["catalog", str(out)])

    assert exit_code == 0
    printed = capsys.readouterr().out
    assert "peruvian-dishes" in printed
    assert "wikidata-sparql" in printed


def test_cli_catalog_missing_path_fails(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    exit_code = main(["catalog", str(tmp_path / "nope")])
    assert exit_code == 2
    assert "does not exist" in capsys.readouterr().err
