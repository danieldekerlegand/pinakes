"""Tests for the auditable acquisition run: structured logs + run report."""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from pathlib import Path

import pytest

from pinakes_engine.acquire import (
    CategorySpec,
    HttpStats,
    Provenance,
    RawRecord,
    RunReport,
    SourceAdapter,
    SourceSpec,
    run_acquisition,
)

_RETRIEVED_AT = "2026-06-16T00:00:00+00:00"


def _spec() -> CategorySpec:
    return CategorySpec(
        id="peruvian-dishes",
        label="Dish",
        description="Every Peruvian dish",
        source=SourceSpec(type="wikidata-sparql"),
        dimensions=(),
    )


def _record(name: str, source: str = "wikidata") -> RawRecord:
    return RawRecord(
        fields={"name": name},
        provenance=Provenance(
            source=source,
            source_url=f"https://example.test/{name}",
            source_query="q",
            retrieved_at=_RETRIEVED_AT,
            confidence=1.0,
        ),
    )


class _ListAdapter(SourceAdapter):
    """Yields a fixed list of records (no network)."""

    name = "list"
    source_type = "wikidata-sparql"

    def __init__(self, records: list[RawRecord]) -> None:
        self._records = records

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        yield from self._records


class _RaisingAdapter(SourceAdapter):
    """Yields one record, then raises while producing the next."""

    name = "raising"
    source_type = "wikidata-sparql"

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        yield _record("ceviche")
        raise RuntimeError("upstream blew up")


class _FetchFailsAdapter(SourceAdapter):
    """Fails eagerly when ``fetch`` is called (e.g. the HTTP request failed)."""

    name = "fetch-fails"
    source_type = "wikidata-sparql"

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        raise RuntimeError("request failed with status 500")


def test_report_counts_rows_and_distinct_sources() -> None:
    adapter = _ListAdapter(
        [
            _record("ceviche", source="wikidata"),
            _record("lomo", source="wikidata"),
            _record("pisco", source="petscan"),
        ]
    )
    collected: list[RawRecord] = []

    report = run_acquisition(adapter, _spec(), collected.append)

    assert report == RunReport(
        category_id="peruvian-dishes",
        adapter="list",
        row_count=3,
        distinct_sources=("petscan", "wikidata"),
        error_count=0,
    )
    assert len(collected) == 3


def test_sink_failure_is_counted_without_aborting_run(
    caplog: pytest.LogCaptureFixture,
) -> None:
    adapter = _ListAdapter([_record("a"), _record("b"), _record("c")])
    collected: list[RawRecord] = []

    def sink(record: RawRecord) -> None:
        if record.fields["name"] == "b":
            raise ValueError("bad record")
        collected.append(record)

    with caplog.at_level(logging.WARNING, logger="pinakes_engine.acquire.run"):
        report = run_acquisition(adapter, _spec(), sink)

    assert report.row_count == 2  # a and c still acquired
    assert report.error_count == 1
    assert [r.fields["name"] for r in collected] == ["a", "c"]
    errors = [
        r for r in caplog.records if vars(r).get("event") == "acquire.record_error"
    ]
    assert len(errors) == 1
    assert "bad record" in vars(errors[0])["error"]


def test_record_production_failure_is_counted() -> None:
    collected: list[RawRecord] = []

    report = run_acquisition(_RaisingAdapter(), _spec(), collected.append)

    assert report.row_count == 1  # the record yielded before the failure
    assert report.error_count == 1
    assert len(collected) == 1


def test_fetch_failure_is_reported_not_raised() -> None:
    collected: list[RawRecord] = []

    report = run_acquisition(_FetchFailsAdapter(), _spec(), collected.append)

    assert report.row_count == 0
    assert report.error_count == 1
    assert report.distinct_sources == ()
    assert collected == []


def test_http_stats_are_folded_into_report() -> None:
    adapter = _ListAdapter([_record("a")])

    report = run_acquisition(
        adapter,
        _spec(),
        lambda _record: None,
        http_stats=lambda: HttpStats(cache_hits=2, cache_misses=1, retries=3),
    )

    assert report.cache_hits == 2
    assert report.cache_misses == 1
    assert report.retries == 3


def test_start_and_done_events_are_logged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    adapter = _ListAdapter([_record("a"), _record("b")])

    with caplog.at_level(logging.INFO, logger="pinakes_engine.acquire.run"):
        run_acquisition(adapter, _spec(), lambda _record: None)

    events = {vars(r).get("event") for r in caplog.records}
    assert {"acquire.start", "acquire.done"} <= events
    done = next(
        r for r in caplog.records if vars(r).get("event") == "acquire.done"
    )
    assert vars(done)["row_count"] == 2
    assert vars(done)["category_id"] == "peruvian-dishes"


def test_report_write_round_trips(tmp_path: Path) -> None:
    report = RunReport(
        category_id="peruvian-dishes",
        adapter="list",
        row_count=3,
        distinct_sources=("petscan", "wikidata"),
        error_count=1,
        cache_hits=4,
        cache_misses=2,
        retries=1,
    )

    path = report.write(tmp_path / "nested" / "report.json")

    loaded = json.loads(path.read_text(encoding="utf-8"))
    assert loaded == {
        "category_id": "peruvian-dishes",
        "adapter": "list",
        "row_count": 3,
        "distinct_sources": ["petscan", "wikidata"],
        "error_count": 1,
        "cache_hits": 4,
        "cache_misses": 2,
        "retries": 1,
    }
