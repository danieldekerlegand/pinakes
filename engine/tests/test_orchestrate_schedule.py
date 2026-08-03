"""Tests for scheduled, incremental refresh selection (``run --since``)."""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

import pinakes_engine.cli as cli
from pinakes_engine.acquire.adapters import SourceAdapter
from pinakes_engine.acquire.categories import CategorySpec, load_category
from pinakes_engine.acquire.records import RawRecord
from pinakes_engine.orchestrate import STAGE_ORDER, Job, load_catalog, run_job
from pinakes_engine.orchestrate.catalog import (
    Catalog,
    CatalogEntry,
    ProvenanceSummary,
)
from pinakes_engine.orchestrate.runner import AdapterFactory, JobRun
from pinakes_engine.orchestrate.schedule import (
    REFRESH_LOG_NAME,
    DurationError,
    parse_duration,
    select_stale,
    write_refresh_log,
)
from pinakes_engine.schema.pipeline import read_raw_records

FIXTURES = Path(__file__).parent / "fixtures"
REPO_ROOT = Path(__file__).resolve().parent.parent
RAW_RECORDS = FIXTURES / "raw" / "peruvian_dishes.jsonl"

#: A fixed clock so staleness decisions are deterministic.
NOW = datetime(2026, 6, 16, 12, 0, 0, tzinfo=UTC)


def _spec(category_id: str) -> CategorySpec:
    """A valid category spec with the given id (only the id is used here)."""
    return replace(load_category(FIXTURES / "categories" / "valid.yml"), id=category_id)


def _entry(category_id: str, last_run: str) -> CatalogEntry:
    return CatalogEntry(
        id=category_id,
        label="Dish",
        source="dump",
        node_count=1,
        edge_count=0,
        dimensions=(),
        last_run=last_run,
        provenance=ProvenanceSummary(adapter="", sources=(), records=0, errors=0),
    )


# --- parse_duration --------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("30m", timedelta(minutes=30)),
        ("24h", timedelta(hours=24)),
        ("7d", timedelta(days=7)),
        ("1w", timedelta(weeks=1)),
        ("45s", timedelta(seconds=45)),
        ("1w12h", timedelta(weeks=1, hours=12)),
        (" 7D ", timedelta(days=7)),
    ],
)
def test_parse_duration_accepts_valid_forms(text: str, expected: timedelta) -> None:
    assert parse_duration(text) == expected


@pytest.mark.parametrize(
    "text", ["", "  ", "7", "d", "7x", "7days", "-3d", "0h", "7d!"]
)
def test_parse_duration_rejects_garbage(text: str) -> None:
    with pytest.raises(DurationError):
        parse_duration(text)


# --- select_stale ----------------------------------------------------------


def test_select_stale_picks_only_stale_categories() -> None:
    specs = [_spec("stale"), _spec("fresh"), _spec("never-run")]
    catalog = Catalog(
        (
            # 30 days old -> older than the 7d window -> stale.
            _entry("stale", (NOW - timedelta(days=30)).isoformat()),
            # 1 hour old -> within the window -> fresh.
            _entry("fresh", (NOW - timedelta(hours=1)).isoformat()),
        )
    )

    selection = select_stale(specs, catalog, parse_duration("7d"), now=NOW)

    # "never-run" has no entry, so it is stale; only "fresh" is skipped.
    assert selection.refreshed == ("stale", "never-run")
    assert selection.skipped == ("fresh",)


def test_select_stale_cutoff_is_inclusive() -> None:
    since = parse_duration("7d")
    specs = [_spec("on-the-line")]
    # last_run lands exactly on the cutoff -> at/before -> stale.
    catalog = Catalog((_entry("on-the-line", (NOW - since).isoformat()),))

    selection = select_stale(specs, catalog, since, now=NOW)

    assert selection.refreshed == ("on-the-line",)


def test_select_stale_unparseable_timestamp_is_stale() -> None:
    catalog = Catalog((_entry("broken", "not-a-timestamp"),))

    selection = select_stale([_spec("broken")], catalog, parse_duration("7d"), now=NOW)

    assert selection.refreshed == ("broken",)
    decision = selection.decisions[0]
    assert "unparseable" in decision.reason


def test_select_stale_treats_naive_timestamp_as_utc() -> None:
    # A naive (tz-less) last_run must still compare cleanly against the cutoff.
    catalog = Catalog((_entry("naive", "2026-06-15T12:00:00"),))

    selection = select_stale([_spec("naive")], catalog, parse_duration("7d"), now=NOW)

    assert selection.skipped == ("naive",)


def test_select_stale_empty_catalog_refreshes_everything() -> None:
    specs = [_spec("a"), _spec("b")]

    selection = select_stale(specs, Catalog(()), parse_duration("1d"), now=NOW)

    assert selection.refreshed == ("a", "b")
    assert selection.skipped == ()


# --- write_refresh_log -----------------------------------------------------


def test_write_refresh_log_records_refreshed_and_skipped(tmp_path: Path) -> None:
    specs = [_spec("stale"), _spec("fresh")]
    catalog = Catalog((_entry("fresh", (NOW - timedelta(hours=1)).isoformat()),))
    selection = select_stale(specs, catalog, parse_duration("7d"), now=NOW)

    path = write_refresh_log(tmp_path, selection, now=NOW)

    assert path == tmp_path / REFRESH_LOG_NAME
    entry = json.loads(path.read_text(encoding="utf-8").strip())
    assert entry["refreshed"] == ["stale"]
    assert entry["skipped"] == ["fresh"]
    assert entry["since_seconds"] == 7 * 86400
    assert entry["timestamp"] == NOW.isoformat()


def test_write_refresh_log_appends_one_line_per_run(tmp_path: Path) -> None:
    selection = select_stale([_spec("a")], Catalog(()), parse_duration("1d"), now=NOW)

    write_refresh_log(tmp_path, selection, now=NOW)
    write_refresh_log(tmp_path, selection, now=NOW)

    lines = (tmp_path / REFRESH_LOG_NAME).read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2


# --- CLI integration -------------------------------------------------------


def _write_job(tmp_path: Path, *category_ids: str) -> Path:
    job = tmp_path / "job.yml"
    categories = "".join(
        f"  - {REPO_ROOT / 'inputs' / 'categories' / f'{cid}.yml'}\n"
        for cid in category_ids
    )
    job.write_text(
        "name: refresh-job\n"
        "categories:\n" + categories + f"output_root: {tmp_path / 'out'}\n",
        encoding="utf-8",
    )
    return job


def _seed_catalog(out: Path, *entries: CatalogEntry) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / "catalog.json").write_text(
        Catalog(entries).to_json(), encoding="utf-8"
    )


def test_cli_run_since_forces_only_stale_categories(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "out"
    job = _write_job(tmp_path, "peruvian-dishes", "italian-sculptures")
    now = datetime.now(UTC)
    _seed_catalog(
        out,
        _entry("peruvian-dishes", (now - timedelta(days=30)).isoformat()),
        _entry("italian-sculptures", (now - timedelta(hours=1)).isoformat()),
    )

    captured: dict[str, frozenset[str] | None] = {}

    def fake_run_job(job_arg, *, force, force_ids, workers):  # type: ignore[no-untyped-def]
        captured["force_ids"] = force_ids
        return JobRun(name=job_arg.name, categories=())

    monkeypatch.setattr(cli, "run_job", fake_run_job)

    exit_code = cli.main(["run", str(job), "--stages", "acquire", "--since", "7d"])

    assert exit_code == 0
    # Only the 30-day-old category is forced; the 1-hour-old one is left alone.
    assert captured["force_ids"] == frozenset({"peruvian-dishes"})
    out_text = capsys.readouterr().out
    assert "refreshing: peruvian-dishes" in out_text
    assert (out / REFRESH_LOG_NAME).is_file()


def test_cli_run_since_skips_run_when_all_fresh(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "out"
    job = _write_job(tmp_path, "peruvian-dishes")
    now = datetime.now(UTC)
    fresh = _entry("peruvian-dishes", (now - timedelta(hours=1)).isoformat())
    _seed_catalog(out, fresh)

    def fail_run_job(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise AssertionError("run_job must not be called when nothing is stale")

    monkeypatch.setattr(cli, "run_job", fail_run_job)

    exit_code = cli.main(["run", str(job), "--stages", "acquire", "--since", "7d"])

    assert exit_code == 0
    assert "nothing to refresh" in capsys.readouterr().out
    # The schedule still leaves an audit line.
    log = (out / REFRESH_LOG_NAME).read_text(encoding="utf-8").strip()
    assert json.loads(log)["skipped"] == ["peruvian-dishes"]


def test_cli_run_since_rejects_bad_duration(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    job = _write_job(tmp_path, "peruvian-dishes")

    exit_code = cli.main(["run", str(job), "--since", "soon"])

    assert exit_code == 2
    assert "invalid duration" in capsys.readouterr().err


# --- catalog last_run preservation -----------------------------------------


class _StubAdapter(SourceAdapter):
    name = "stub"
    source_type = "dump"

    def __init__(self, records: list[RawRecord]) -> None:
        self._records = records

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        yield from self._records


def _stub_factory() -> AdapterFactory:
    records = read_raw_records(RAW_RECORDS)
    return lambda spec: _StubAdapter(records)


def test_skipped_rerun_keeps_prior_last_run(tmp_path: Path) -> None:
    # A scheduled --since refresh leans on last_run staying put when a category
    # is skipped — otherwise every incremental run would freshen the clock and
    # the window would never elapse.
    out = tmp_path / "out"
    job = Job(
        name="job",
        description="",
        categories=(_spec("peruvian-dishes"),),
        stages=STAGE_ORDER,
        output_root=out,
    )

    run_job(job, adapter_factory=_stub_factory())
    (first,) = load_catalog(out).entries

    # Re-running with unchanged inputs skips every stage...
    run_job(job, adapter_factory=_stub_factory())
    (second,) = load_catalog(out).entries

    # ...so the recorded last_run is preserved, not re-stamped with "now".
    assert second.last_run == first.last_run
