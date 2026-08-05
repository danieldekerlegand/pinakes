"""Measure a job's acquisition throughput, and where its time goes.

The unified acquisition layer (pinakes:70) claims two things the plan's speed
goal rests on: categories are fetched **concurrently**, and the shared
:class:`~pinakes_engine.acquire.http.HttpClient` keeps that concurrency polite
**per host**. This module is what turns those from claims into numbers —
:func:`benchmark_acquisition` runs one job's ``acquire`` stage against a fresh
HTTP cache and returns an :class:`AcquisitionBenchmark`; :func:`compare_workers`
runs it at several worker counts so a before/after sits in one table.

Reading the numbers
-------------------

Three clocks are recorded and they answer different questions:

* :attr:`~AcquisitionBenchmark.wall_seconds` — how long the run took. This is
  the throughput number, and the only one concurrency shortens.
* :attr:`~AcquisitionBenchmark.worker_seconds` — the sum of every category's
  acquire-stage duration. Under ``W`` workers this is up to ``W`` times
  wall-clock; their ratio is the **effective parallelism** actually achieved.
* :attr:`~AcquisitionBenchmark.network_seconds` — transport time plus politeness
  sleeps, aggregated across workers by the shared client.

So the network-vs-parse split is ``network_seconds`` against ``worker_seconds``
(both are worker-seconds), **never** against wall clock — comparing an aggregate
to a wall clock is how a concurrent run "spends 300% of its time on the
network".

The benchmark deliberately runs against a **fresh cache directory** and forces
every stage, because a warm run measures the cache rather than acquisition. Pass
a cache directory explicitly to measure the warm path on purpose.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter

from pinakes_engine.acquire.adapters import SourceAdapter
from pinakes_engine.acquire.categories import CategorySpec
from pinakes_engine.acquire.factory import build_adapter
from pinakes_engine.acquire.http import HttpClient, HttpStats
from pinakes_engine.orchestrate.jobs import Job
from pinakes_engine.orchestrate.runner import AdapterFactory, JobRun, run_job

#: Logger benchmark runs emit their per-configuration summary on.
LOGGER = logging.getLogger("pinakes_engine.orchestrate.benchmark")


@dataclass(frozen=True)
class AcquisitionBenchmark:
    """One measured acquisition run of a job at a given worker count.

    Attributes:
        job: The job that was acquired.
        workers: The concurrency cap the run was given (the runner clamps this
            to the category count, so :attr:`effective_parallelism` is the
            honest measure of what happened).
        categories: Categories in the job.
        failures: Categories whose acquire stage failed. A benchmark over a
            failed run still reports — a partial fetch is a real datapoint —
            but the count must be read alongside the rows.
        rows: Records acquired across every category.
        wall_seconds: Wall-clock duration of the whole acquire run.
        worker_seconds: Summed per-category acquire-stage duration.
        request_seconds: Aggregate time inside the HTTP transport.
        wait_seconds: Aggregate time slept for per-host politeness and backoff.
        cache_hits: Responses served from the cache.
        cache_misses: Responses fetched over the network.
        retries: Requests retried after a ``429``/``5xx``.
    """

    job: str
    workers: int
    categories: int
    failures: int
    rows: int
    wall_seconds: float
    worker_seconds: float
    request_seconds: float = 0.0
    wait_seconds: float = 0.0
    cache_hits: int = 0
    cache_misses: int = 0
    retries: int = 0

    @property
    def network_seconds(self) -> float:
        """Worker-seconds attributable to I/O: transport plus politeness."""
        return self.request_seconds + self.wait_seconds

    @property
    def parse_seconds(self) -> float:
        """Worker-seconds spent *not* on I/O — parsing and record building.

        Floored at zero: the two clocks are sampled independently, so a run with
        no measurable parse cost can land a hair below it.
        """
        return max(0.0, self.worker_seconds - self.network_seconds)

    @property
    def network_share(self) -> float:
        """Fraction of worker-seconds spent on I/O (``0.0`` for an idle run)."""
        if self.worker_seconds <= 0.0:
            return 0.0
        return min(1.0, self.network_seconds / self.worker_seconds)

    @property
    def rows_per_second(self) -> float:
        """End-to-end acquisition throughput in records per wall-clock second."""
        if self.wall_seconds <= 0.0:
            return 0.0
        return self.rows / self.wall_seconds

    @property
    def effective_parallelism(self) -> float:
        """Worker-seconds per wall-clock second — the concurrency actually achieved.

        ``1.0`` is a serial run. It approaches :attr:`workers` when the
        categories are I/O bound and independent, and stays near ``1.0`` when a
        single host's rate limit is the binding constraint.
        """
        if self.wall_seconds <= 0.0:
            return 0.0
        return self.worker_seconds / self.wall_seconds

    def to_dict(self) -> dict[str, object]:
        """Return a JSON-serializable mapping including the derived ratios."""
        return {
            "job": self.job,
            "workers": self.workers,
            "categories": self.categories,
            "failures": self.failures,
            "rows": self.rows,
            "wall_seconds": round(self.wall_seconds, 3),
            "worker_seconds": round(self.worker_seconds, 3),
            "request_seconds": round(self.request_seconds, 3),
            "wait_seconds": round(self.wait_seconds, 3),
            "network_seconds": round(self.network_seconds, 3),
            "parse_seconds": round(self.parse_seconds, 3),
            "network_share": round(self.network_share, 4),
            "rows_per_second": round(self.rows_per_second, 2),
            "effective_parallelism": round(self.effective_parallelism, 2),
            "cache_hits": self.cache_hits,
            "cache_misses": self.cache_misses,
            "retries": self.retries,
        }


def benchmark_acquisition(
    job: Job,
    *,
    workers: int,
    output_root: Path | str | None = None,
    cache_dir: Path | str | None = None,
    client: HttpClient | None = None,
    adapter_factory: AdapterFactory | None = None,
    logger: logging.Logger = LOGGER,
) -> AcquisitionBenchmark:
    """Run *job*'s ``acquire`` stage at *workers* and measure it.

    The job is reduced to the single ``acquire`` stage and forced, so the
    measurement covers acquisition alone and never a fingerprint skip. Every
    category's adapter draws from one :class:`HttpClient` — that is both what
    the production runner does and what makes the per-host politeness numbers
    meaningful.

    Args:
        job: The job to acquire.
        workers: Concurrency cap handed to :func:`~.runner.run_job`.
        output_root: Where stage output lands; a temporary directory is used
            and removed when omitted.
        cache_dir: HTTP cache directory. Omit for a **cold** run against a
            fresh cache (the default, and what a throughput number should
            measure); pass one to measure the warm path deliberately.
        client: The shared client whose counters are folded into the result.
            One is built over *cache_dir* when omitted.
        adapter_factory: Overrides adapter construction — for tests that must
            stay offline. Given one *without* a *client*, the HTTP timers read
            zero, because no client was built to record them.
        logger: Where the one-line summary is emitted.
    """
    with TemporaryDirectory(prefix="pinakes-bench-") as tmp:
        scratch = Path(tmp)
        root = Path(output_root) if output_root is not None else scratch / "out"
        cache = Path(cache_dir) if cache_dir is not None else scratch / "http-cache"
        shared = client
        factory = adapter_factory
        if factory is None:
            if shared is None:
                shared = HttpClient(cache_dir=cache)
            factory = _shared_client_factory(shared)

        staged = replace(job, stages=("acquire",), output_root=root)
        started = perf_counter()
        run = run_job(staged, adapter_factory=factory, workers=workers, force=True)
        wall = perf_counter() - started

        stats = shared.stats if shared is not None else HttpStats()
        result = _summarize(staged, run, workers, wall, stats)

    logger.info(
        "acquire benchmark: job=%s workers=%d rows=%d wall=%.2fs "
        "rows/s=%.1f parallelism=%.2f network=%.0f%%",
        result.job,
        result.workers,
        result.rows,
        result.wall_seconds,
        result.rows_per_second,
        result.effective_parallelism,
        100.0 * result.network_share,
        extra={"event": "benchmark.done", **result.to_dict()},
    )
    return result


def compare_workers(
    job: Job,
    worker_counts: Sequence[int],
    *,
    adapter_factory: AdapterFactory | None = None,
    logger: logging.Logger = LOGGER,
) -> tuple[AcquisitionBenchmark, ...]:
    """Benchmark *job* once per entry in *worker_counts*, in order.

    Each run gets its own fresh cache, so a later configuration is never handed
    the earlier one's warm cache — which would report it as infinitely fast.
    """
    return tuple(
        benchmark_acquisition(
            job, workers=count, adapter_factory=adapter_factory, logger=logger
        )
        for count in worker_counts
    )


def render_markdown(results: Sequence[AcquisitionBenchmark]) -> str:
    """Render *results* as a Markdown comparison table (one row per run)."""
    header = (
        "| workers | rows | wall (s) | rows/s | worker-s | parallelism "
        "| network (s) | parse (s) | network share |\n"
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"
    )
    rows = [
        f"| {r.workers} | {r.rows} | {r.wall_seconds:.2f} | {r.rows_per_second:.1f} "
        f"| {r.worker_seconds:.2f} | {r.effective_parallelism:.2f}× "
        f"| {r.network_seconds:.2f} | {r.parse_seconds:.2f} "
        f"| {100.0 * r.network_share:.0f}% |"
        for r in results
    ]
    return "\n".join([header, *rows])


def _shared_client_factory(client: HttpClient) -> AdapterFactory:
    """Build adapters that all draw from *client* (mirrors the runner's default)."""

    def factory(spec: CategorySpec) -> SourceAdapter:
        return build_adapter(spec, http_factory=lambda: client)

    return factory


def _summarize(
    job: Job,
    run: JobRun,
    workers: int,
    wall: float,
    stats: HttpStats,
) -> AcquisitionBenchmark:
    """Fold a :class:`JobRun` and the client's counters into one benchmark row."""
    acquired = [s for s in run.stages if s.stage == "acquire"]
    return AcquisitionBenchmark(
        job=job.name,
        workers=workers,
        categories=len(job.categories),
        failures=len(run.failures),
        rows=sum(s.rows for s in acquired),
        wall_seconds=wall,
        worker_seconds=sum(s.seconds for s in acquired),
        request_seconds=stats.request_seconds,
        wait_seconds=stats.wait_seconds,
        cache_hits=stats.cache_hits,
        cache_misses=stats.cache_misses,
        retries=stats.retries,
    )
