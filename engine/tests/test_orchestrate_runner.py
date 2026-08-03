"""Tests for the end-to-end pipeline runner, with acquisition mocked."""

import threading
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

from pinakes_engine.acquire.adapters import SourceAdapter
from pinakes_engine.acquire.categories import CategorySpec, load_category
from pinakes_engine.acquire.records import RawRecord
from pinakes_engine.orchestrate import (
    STAGE_ORDER,
    Job,
    JobRun,
    run_job,
)
from pinakes_engine.orchestrate.runner import AdapterFactory, _default_adapter_factory
from pinakes_engine.schema.pipeline import read_raw_records

FIXTURES = Path(__file__).parent / "fixtures"
RAW_RECORDS = FIXTURES / "raw" / "peruvian_dishes.jsonl"


class _StubAdapter(SourceAdapter):
    """Yields a fixed list of records instead of touching the network."""

    name = "stub"
    source_type = "dump"

    def __init__(self, records: list[RawRecord]) -> None:
        self._records = records

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        yield from self._records


def _spec() -> CategorySpec:
    return load_category(FIXTURES / "categories" / "valid.yml")


def _job(output_root: Path, stages: tuple[str, ...]) -> Job:
    return Job(
        name="fixture-job",
        description="",
        categories=(_spec(),),
        stages=stages,
        output_root=output_root,
    )


def _stub_factory() -> AdapterFactory:
    records = read_raw_records(RAW_RECORDS)
    return lambda spec: _StubAdapter(records)


class _TrackingFactory:
    """An adapter factory that counts builds and can refuse to be called.

    Re-running an up-to-date job must not fetch; ``fail_if_called`` makes any
    attempt an assertion failure so tests can prove no network happened.
    """

    def __init__(
        self, records: list[RawRecord], *, fail_if_called: bool = False
    ) -> None:
        self._records = records
        self.fail_if_called = fail_if_called
        self.calls = 0

    def __call__(self, spec: CategorySpec) -> SourceAdapter:
        self.calls += 1
        if self.fail_if_called:
            raise AssertionError(f"unexpected fetch for category {spec.id!r}")
        return _StubAdapter(self._records)


def test_full_pipeline_runs_every_stage_in_order(tmp_path: Path) -> None:
    job = _job(tmp_path / "out", ("acquire", "normalize", "link", "export"))

    run = run_job(job, adapter_factory=_stub_factory())

    assert isinstance(run, JobRun)
    assert [s.stage for s in run.stages] == [
        "acquire",
        "normalize",
        "link",
        "export",
    ]
    # Each stage wrote into <output_root>/<stage>/<category-id>/.
    by_stage = {s.stage: s for s in run.stages}
    for stage in ("acquire", "normalize", "link", "export"):
        expected = tmp_path / "out" / stage / "peruvian-dishes"
        assert by_stage[stage].output_dir == expected
        assert by_stage[stage].output_dir.is_dir()

    # Outputs chain: acquire's records feed normalize, which feeds link/export.
    assert (by_stage["acquire"].output_dir / "records.jsonl").is_file()
    assert (by_stage["normalize"].output_dir / "nodes").is_dir()
    assert (by_stage["link"].output_dir / "metrics.json").is_file()
    assert any(by_stage["export"].output_dir.glob("*.pl"))


def test_per_stage_timing_and_row_counts_recorded(tmp_path: Path) -> None:
    job = _job(tmp_path / "out", ("acquire", "normalize", "link", "export"))

    run = run_job(job, adapter_factory=_stub_factory())

    by_stage = {s.stage: s for s in run.stages}
    # Three raw records were acquired.
    assert by_stage["acquire"].rows == 3
    # Normalization and linking emit node + edge rows; linking only adds.
    assert by_stage["normalize"].rows > 0
    assert by_stage["link"].rows >= by_stage["normalize"].rows
    # Export projects facts.
    assert by_stage["export"].rows > 0
    # Every stage recorded a non-negative duration.
    assert all(s.seconds >= 0.0 for s in run.stages)


def test_omitting_link_feeds_normalize_output_to_export(tmp_path: Path) -> None:
    job = _job(tmp_path / "out", ("acquire", "normalize", "export"))

    run = run_job(job, adapter_factory=_stub_factory())

    assert [s.stage for s in run.stages] == ["acquire", "normalize", "export"]
    assert not (tmp_path / "out" / "link").exists()
    assert run.stages[-1].rows > 0


def test_category_failure_is_isolated_and_others_complete(tmp_path: Path) -> None:
    # One category whose adapter cannot be built fails at acquire; the other
    # still runs to completion and the job reports per-category status.
    good = _spec()
    bad = replace(good, id="broken")
    job = Job(
        name="fixture-job",
        description="",
        categories=(good, bad),
        stages=("acquire", "normalize", "link", "export"),
        output_root=tmp_path / "out",
    )
    records = read_raw_records(RAW_RECORDS)

    def factory(spec: CategorySpec) -> SourceAdapter:
        if spec.id == "broken":
            raise RuntimeError("no adapter for source")
        return _StubAdapter(records)

    run = run_job(job, adapter_factory=factory)

    # The job did not abort: it ran both categories and reports the failure.
    assert not run.ok
    assert [c.category_id for c in run.failures] == ["broken"]
    (failure,) = run.failures
    assert "broken: acquire stage failed" in (failure.error or "")
    # The healthy category completed every stage; its outputs are intact.
    for stage in ("acquire", "normalize", "link", "export"):
        assert (tmp_path / "out" / stage / "peruvian-dishes").is_dir()
    # The failing category never produced an export.
    assert not (tmp_path / "out" / "export" / "broken").exists()
    # Its status shows up in the human-readable summary.
    assert "broken: FAILED" in run.summary
    assert "peruvian-dishes: ok" in run.summary


def test_stage_without_its_input_is_reported_as_failure(tmp_path: Path) -> None:
    # 'normalize' alone has no acquire output to consume: the category fails,
    # but as a recorded failure rather than an exception that aborts the run.
    job = _job(tmp_path / "out", ("normalize",))

    run = run_job(job, adapter_factory=_stub_factory())

    assert not run.ok
    (failure,) = run.failures
    assert "requires the acquire stage" in (failure.error or "")


def test_second_run_is_a_noop_and_reports_up_to_date(tmp_path: Path) -> None:
    job = _job(tmp_path / "out", STAGE_ORDER)
    run_job(job, adapter_factory=_stub_factory())

    # Nothing changed: the second run must touch no network and skip every stage.
    offline = _TrackingFactory(read_raw_records(RAW_RECORDS), fail_if_called=True)
    run = run_job(job, adapter_factory=offline)

    assert offline.calls == 0
    assert run.up_to_date
    assert all(s.skipped for s in run.stages)
    # A skipped stage still reports the row count the first run recorded.
    assert all(s.rows > 0 for s in run.stages)


def test_changed_source_reprocesses_only_affected_category(tmp_path: Path) -> None:
    good = _spec()
    other = replace(good, id="other-dishes")
    job = Job(
        name="fixture-job",
        description="",
        categories=(good, other),
        stages=STAGE_ORDER,
        output_root=tmp_path / "out",
    )
    run_job(job, adapter_factory=_stub_factory())

    # Simulate updated source data for one category by editing its acquired
    # records in place (drop the last record). The spec is untouched, so the
    # rerun must not refetch — yet normalize/link/export must recompute.
    records_path = tmp_path / "out" / "acquire" / "peruvian-dishes" / "records.jsonl"
    kept = records_path.read_text(encoding="utf-8").splitlines()[:-1]
    records_path.write_text("\n".join(kept) + "\n", encoding="utf-8")

    offline = _TrackingFactory(read_raw_records(RAW_RECORDS), fail_if_called=True)
    run = run_job(job, adapter_factory=offline)

    assert offline.calls == 0  # no network for either category
    by = {(s.category_id, s.stage): s for s in run.stages}
    # The affected category keeps its fetch (spec unchanged) but recomputes the
    # downstream stages off the changed records.
    assert by[("peruvian-dishes", "acquire")].skipped
    assert not by[("peruvian-dishes", "normalize")].skipped
    assert not by[("peruvian-dishes", "link")].skipped
    assert not by[("peruvian-dishes", "export")].skipped
    # The untouched category is entirely up to date.
    assert all(by[("other-dishes", stage)].skipped for stage in STAGE_ORDER)


def test_force_recomputes_every_stage(tmp_path: Path) -> None:
    job = _job(tmp_path / "out", STAGE_ORDER)
    run_job(job, adapter_factory=_stub_factory())

    tracking = _TrackingFactory(read_raw_records(RAW_RECORDS))
    run = run_job(job, adapter_factory=tracking, force=True)

    assert tracking.calls == 1  # acquire re-fetched despite an unchanged spec
    assert not any(s.skipped for s in run.stages)
    assert not run.up_to_date


def test_changed_spec_refetches_and_renormalizes(tmp_path: Path) -> None:
    stages = ("acquire", "normalize")
    job = _job(tmp_path / "out", stages)
    run_job(job, adapter_factory=_stub_factory())

    # Editing the spec changes acquire's input fingerprint, so the fetch reruns.
    revised = replace(_spec(), description="Every Peruvian dish (revised)")
    job2 = Job(
        name="fixture-job",
        description="",
        categories=(revised,),
        stages=stages,
        output_root=tmp_path / "out",
    )
    tracking = _TrackingFactory(read_raw_records(RAW_RECORDS))
    run = run_job(job2, adapter_factory=tracking)

    assert tracking.calls == 1
    assert not any(s.skipped for s in run.stages)


class _BarrierAdapter(SourceAdapter):
    """Acquire only completes once *all* workers reach the barrier together.

    If the runner ran categories serially, the barrier would never fill and
    ``fetch`` would raise on timeout — so a clean run proves real concurrency.
    """

    name = "stub"
    source_type = "dump"

    def __init__(self, barrier: threading.Barrier, records: list[RawRecord]) -> None:
        self._barrier = barrier
        self._records = records

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        self._barrier.wait()
        yield from self._records


def test_independent_categories_acquire_concurrently(tmp_path: Path) -> None:
    records = read_raw_records(RAW_RECORDS)
    count = 3
    barrier = threading.Barrier(count, timeout=5.0)
    specs = tuple(replace(_spec(), id=f"dishes-{i}") for i in range(count))
    job = Job(
        name="fixture-job",
        description="",
        categories=specs,
        stages=("acquire",),
        output_root=tmp_path / "out",
    )

    run = run_job(
        job,
        adapter_factory=lambda spec: _BarrierAdapter(barrier, records),
        workers=count,
    )

    # All three acquired only because they ran at the same time.
    assert run.ok
    assert {c.category_id for c in run.categories} == {s.id for s in specs}
    assert all(c.stages[0].rows == len(records) for c in run.categories)


def test_worker_cap_below_category_count_still_runs_all(tmp_path: Path) -> None:
    # More categories than workers: the cap throttles concurrency without
    # dropping any category.
    specs = tuple(replace(_spec(), id=f"dishes-{i}") for i in range(5))
    job = Job(
        name="fixture-job",
        description="",
        categories=specs,
        stages=("acquire", "normalize"),
        output_root=tmp_path / "out",
    )

    run = run_job(job, adapter_factory=_stub_factory(), workers=2)

    assert run.ok
    assert {c.category_id for c in run.categories} == {s.id for s in specs}
    assert all(len(c.stages) == 2 for c in run.categories)


def test_default_factory_shares_one_http_client_across_categories(
    tmp_path: Path,
) -> None:
    # Per-host rate limits only hold across workers if every category's adapter
    # draws from the same client.
    job = _job(tmp_path / "out", ("acquire",))
    factory = _default_adapter_factory(job)

    first = factory(_spec())
    second = factory(replace(_spec(), id="other-dishes"))

    assert first._http is second._http  # type: ignore[attr-defined]
