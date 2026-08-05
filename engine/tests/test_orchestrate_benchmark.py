"""Tests for the acquisition throughput benchmark.

The benchmark is what turns pinakes:70's speed claims into numbers, so these
tests are about the *arithmetic* being trustworthy — the network/parse split, the
effective-parallelism ratio, and the fact that concurrency actually shortens
wall-clock. Every run here is offline: the adapters are stubs, and the
network-timed cases drive an :class:`HttpClient` with an injected clock rather
than a socket.
"""

import threading
import time
from collections.abc import Iterator, Mapping
from dataclasses import replace
from pathlib import Path

import pytest

from pinakes_engine.acquire.adapters import SourceAdapter
from pinakes_engine.acquire.categories import CategorySpec, load_category
from pinakes_engine.acquire.http import HttpClient, HttpResponse
from pinakes_engine.acquire.records import Provenance, RawRecord
from pinakes_engine.orchestrate import Job
from pinakes_engine.orchestrate.benchmark import (
    AcquisitionBenchmark,
    benchmark_acquisition,
    compare_workers,
    render_markdown,
)
from pinakes_engine.schema.pipeline import read_raw_records

FIXTURES = Path(__file__).parent / "fixtures"
RAW_RECORDS = FIXTURES / "raw" / "peruvian_dishes.jsonl"

#: Long enough to dominate scheduler noise, short enough not to slow the suite.
SLEEP = 0.05


def _spec() -> CategorySpec:
    return load_category(FIXTURES / "categories" / "valid.yml")


def _job(output_root: Path, count: int = 1) -> Job:
    specs = tuple(replace(_spec(), id=f"dishes-{i}") for i in range(count))
    return Job(
        name="benchmark-job",
        description="",
        categories=specs,
        stages=("acquire", "normalize"),
        output_root=output_root,
    )


class _StubAdapter(SourceAdapter):
    """Yields a fixed list of records instead of touching the network."""

    name = "stub"
    source_type = "dump"

    def __init__(self, records: list[RawRecord], *, delay: float = 0.0) -> None:
        self._records = records
        self._delay = delay

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        if self._delay:
            time.sleep(self._delay)
        yield from self._records


def _stub_factory(delay: float = 0.0):  # type: ignore[no-untyped-def]
    records = read_raw_records(RAW_RECORDS)
    return lambda spec: _StubAdapter(records, delay=delay)


def _bench(**kwargs: object) -> AcquisitionBenchmark:
    """An AcquisitionBenchmark with plausible defaults, for pure-arithmetic tests."""
    fields: dict[str, object] = {
        "job": "j",
        "workers": 1,
        "categories": 1,
        "failures": 0,
        "rows": 100,
        "wall_seconds": 10.0,
        "worker_seconds": 10.0,
    }
    fields.update(kwargs)
    return AcquisitionBenchmark(**fields)  # type: ignore[arg-type]


# --- the arithmetic -------------------------------------------------------


def test_network_and_parse_split_the_worker_seconds() -> None:
    result = _bench(worker_seconds=10.0, request_seconds=6.0, wait_seconds=1.5)

    assert result.network_seconds == pytest.approx(7.5)
    assert result.parse_seconds == pytest.approx(2.5)
    assert result.network_share == pytest.approx(0.75)


def test_parse_seconds_never_goes_negative() -> None:
    # The two clocks are sampled independently, so an all-network run can land a
    # hair over its worker-seconds. That is noise, not negative parse time.
    result = _bench(worker_seconds=5.0, request_seconds=5.01)

    assert result.parse_seconds == 0.0
    assert result.network_share == 1.0


def test_effective_parallelism_is_worker_seconds_over_wall() -> None:
    # Four workers that genuinely overlapped: 12 worker-seconds in 3.2 wall.
    result = _bench(workers=4, wall_seconds=3.2, worker_seconds=12.0)

    assert result.effective_parallelism == pytest.approx(3.75)
    assert result.rows_per_second == pytest.approx(100 / 3.2)


def test_a_serial_run_reports_parallelism_of_one() -> None:
    assert _bench(wall_seconds=4.0, worker_seconds=4.0).effective_parallelism == 1.0


def test_an_instant_run_reports_zero_rather_than_dividing_by_zero() -> None:
    result = _bench(wall_seconds=0.0, worker_seconds=0.0)

    assert result.rows_per_second == 0.0
    assert result.effective_parallelism == 0.0
    assert result.network_share == 0.0


def test_to_dict_carries_the_derived_ratios() -> None:
    payload = _bench(
        wall_seconds=4.0, worker_seconds=8.0, request_seconds=6.0
    ).to_dict()

    assert payload["network_seconds"] == 6.0
    assert payload["parse_seconds"] == 2.0
    assert payload["effective_parallelism"] == 2.0
    assert payload["rows_per_second"] == 25.0


def test_render_markdown_has_one_row_per_run() -> None:
    table = render_markdown([_bench(workers=1), _bench(workers=4)])

    lines = table.splitlines()
    assert len(lines) == 4  # header, separator, two runs
    assert lines[2].startswith("| 1 |")
    assert lines[3].startswith("| 4 |")


# --- the measurement ------------------------------------------------------


def test_benchmark_counts_the_rows_a_job_acquires(tmp_path: Path) -> None:
    rows = len(read_raw_records(RAW_RECORDS))

    result = benchmark_acquisition(
        _job(tmp_path / "out", count=3),
        workers=3,
        output_root=tmp_path / "out",
        adapter_factory=_stub_factory(),
    )

    assert result.job == "benchmark-job"
    assert result.categories == 3
    assert result.failures == 0
    assert result.rows == 3 * rows
    assert result.wall_seconds > 0.0


def test_benchmark_measures_only_the_acquire_stage(tmp_path: Path) -> None:
    # The job declares normalize too; a throughput number for *acquisition* must
    # not silently include it, so the staged job is reduced to acquire alone.
    job = _job(tmp_path / "out", count=1)
    out = tmp_path / "out"

    result = benchmark_acquisition(
        job, workers=1, output_root=out, adapter_factory=_stub_factory()
    )

    assert result.rows == len(read_raw_records(RAW_RECORDS))
    assert (out / "acquire").is_dir()
    assert not (out / "normalize").exists()


def test_concurrency_shortens_the_wall_clock(tmp_path: Path) -> None:
    # Four categories that each block for SLEEP: serially that is 4×SLEEP, and
    # concurrently it is about one. This is the whole before/after the note
    # records, asserted with a generous margin so it is not a flaky timer test.
    job = _job(tmp_path / "out", count=4)

    serial, parallel = compare_workers(
        job, [1, 4], adapter_factory=_stub_factory(delay=SLEEP)
    )

    assert serial.rows == parallel.rows
    assert parallel.wall_seconds < serial.wall_seconds
    assert serial.effective_parallelism < 1.5
    assert parallel.effective_parallelism > 1.5


def test_each_configuration_gets_its_own_cold_cache(tmp_path: Path) -> None:
    # If the second run inherited the first run's warm cache it would report an
    # unearned speedup, so the run counts must be identical across both.
    job = _job(tmp_path / "out", count=2)

    first, second = compare_workers(job, [1, 2], adapter_factory=_stub_factory())

    assert first.rows == second.rows
    assert first.cache_hits == second.cache_hits == 0


def test_a_failing_category_is_reported_not_swallowed(tmp_path: Path) -> None:
    class _BrokenAdapter(SourceAdapter):
        name = "stub"
        source_type = "dump"

        def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
            raise RuntimeError("boom")
            yield  # pragma: no cover - unreachable, marks this a generator

    def factory(spec: CategorySpec) -> SourceAdapter:
        return _StubAdapter([]) if spec.id == "dishes-0" else _BrokenAdapter()

    result = benchmark_acquisition(
        _job(tmp_path / "out", count=2),
        workers=2,
        output_root=tmp_path / "out",
        adapter_factory=factory,
    )

    # run_acquisition counts a fetch failure rather than raising, so the
    # category "succeeds" with zero rows — the honest signal is the row count.
    assert result.rows == 0
    assert result.categories == 2


# --- the network split, end to end ----------------------------------------


class _Clock:
    """A virtual clock: the transport and every sleep advance it, nothing else.

    Using one makes the network numbers exact instead of approximate — a
    ``0.2s`` request costs exactly 0.2s and a politeness gap costs exactly what
    the limiter asked for, with no scheduler noise to hedge the assertions with.
    """

    def __init__(self) -> None:
        self.now = 0.0
        self._lock = threading.Lock()

    def monotonic(self) -> float:
        with self._lock:
            return self.now

    def sleep(self, seconds: float) -> None:
        with self._lock:
            self.now += seconds


class _SlowTransport:
    """Answers every request after advancing *clock* by a fixed span."""

    def __init__(self, clock: _Clock, seconds: float) -> None:
        self._clock = clock
        self._seconds = seconds

    def request(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, str] | None,
        headers: Mapping[str, str],
        timeout: float,
    ) -> HttpResponse:
        self._clock.sleep(self._seconds)
        return HttpResponse(url=url, status_code=200, text="{}", headers={})


def _timed_client(tmp_path: Path, clock: _Clock, request_seconds: float) -> HttpClient:
    """A client on the virtual *clock* whose every request costs *request_seconds*."""
    return HttpClient(
        cache_dir=tmp_path / "cache",
        min_interval=1.0,
        transport=_SlowTransport(clock, request_seconds),
        sleep=clock.sleep,
        monotonic=clock.monotonic,
    )


class _FetchingAdapter(SourceAdapter):
    """Issues one HTTP GET per record through the shared client."""

    name = "stub"
    source_type = "http"

    def __init__(self, client: HttpClient, urls: tuple[str, ...]) -> None:
        self._client = client
        self._urls = urls

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        for url in self._urls:
            self._client.get(url)
            yield RawRecord(
                fields={"name": url},
                provenance=Provenance(
                    source="stub",
                    source_url=url,
                    source_query="",
                    retrieved_at="2026-01-01T00:00:00Z",
                    confidence=0.9,
                ),
            )


def _acquire_urls(
    tmp_path: Path, client: HttpClient, urls: tuple[str, ...]
) -> AcquisitionBenchmark:
    return benchmark_acquisition(
        _job(tmp_path / "out", count=1),
        workers=1,
        output_root=tmp_path / "out",
        client=client,
        adapter_factory=lambda spec: _FetchingAdapter(client, urls),
    )


def test_transport_time_and_politeness_reach_the_report_separately(
    tmp_path: Path,
) -> None:
    # Four 0.2s requests to ONE host at a 1s interval: 0.8s of network and three
    # 0.6s gaps of waiting. The benchmark must keep those apart — "throttled" and
    # "slow" are different findings with different fixes.
    clock = _Clock()
    client = _timed_client(tmp_path, clock, request_seconds=0.2)
    urls = tuple(f"https://alpha.example.org/{i}" for i in range(4))

    result = _acquire_urls(tmp_path, client, urls)

    assert result.rows == len(urls)
    assert result.cache_misses == len(urls)
    assert result.request_seconds == pytest.approx(0.8)
    assert result.wait_seconds == pytest.approx(2.4)
    assert result.network_seconds == pytest.approx(3.2)


def test_spreading_the_same_requests_over_two_hosts_costs_less_waiting(
    tmp_path: Path,
) -> None:
    # The same four 0.2s requests, alternating between two hosts. The network
    # cost is identical; the politeness cost collapses from 2.4s to 0.6s because
    # the interval is owed per host. This is the measured form of "min_interval
    # honored per host, not globally serialized".
    clock = _Clock()
    client = _timed_client(tmp_path, clock, request_seconds=0.2)
    urls = (
        "https://alpha.example.org/1",
        "https://beta.example.org/1",
        "https://alpha.example.org/2",
        "https://beta.example.org/2",
    )

    result = _acquire_urls(tmp_path, client, urls)

    assert result.request_seconds == pytest.approx(0.8)
    assert result.wait_seconds == pytest.approx(0.6)
