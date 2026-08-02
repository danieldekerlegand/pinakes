"""Drive one category's acquisition with structured logging and a run report.

This module turns a :class:`~pinakes_engine.acquire.adapters.SourceAdapter` run
into an *auditable* event: it iterates the adapter's records to completion,
emits one structured log line per stage (start, per-record error, done), and
returns a :class:`RunReport` — category id, adapter, row count, distinct
sources, error count, plus cache hit/miss and retry counts for network sources.

A failure producing or processing a single record is **counted and logged but
does not abort the run** (see ``PLAN.md`` provenance/QA goals): the remaining
records are still acquired. The CLI persists the report as JSON so every run
can be inspected after the fact.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Iterator
from dataclasses import asdict, dataclass
from pathlib import Path

from pinakes_engine.acquire.adapters import SourceAdapter
from pinakes_engine.acquire.categories import CategorySpec
from pinakes_engine.acquire.http import HttpStats
from pinakes_engine.acquire.records import RawRecord

#: Logger acquisition runs emit structured events on. Each call passes the
#: report fields via ``extra=`` so handlers can render them however they like.
LOGGER = logging.getLogger("pinakes_engine.acquire.run")


@dataclass(frozen=True)
class RunReport:
    """An auditable summary of one acquisition run.

    Attributes:
        category_id: The category that was fetched.
        adapter: The :attr:`~SourceAdapter.name` that produced the rows.
        row_count: Records successfully acquired and handed to the sink.
        distinct_sources: Sorted, de-duplicated ``provenance.source`` values.
        error_count: Records that failed to be produced or processed.
        cache_hits: HTTP responses served from cache (0 for non-network runs).
        cache_misses: HTTP responses fetched from the network.
        retries: HTTP requests retried after a ``429``/``5xx``.
    """

    category_id: str
    adapter: str
    row_count: int
    distinct_sources: tuple[str, ...]
    error_count: int
    cache_hits: int = 0
    cache_misses: int = 0
    retries: int = 0

    def to_dict(self) -> dict[str, object]:
        """Return a JSON-serializable mapping of the report."""
        data: dict[str, object] = asdict(self)
        data["distinct_sources"] = list(self.distinct_sources)
        return data

    def write(self, path: str | Path) -> Path:
        """Write the report to *path* as pretty-printed JSON, creating dirs."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(self.to_dict(), indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return path


def run_acquisition(
    adapter: SourceAdapter,
    spec: CategorySpec,
    sink: Callable[[RawRecord], None],
    *,
    http_stats: Callable[[], HttpStats] | None = None,
    logger: logging.Logger = LOGGER,
) -> RunReport:
    """Fetch *spec* through *adapter*, handing each record to *sink*.

    Records are pulled one at a time; an exception raised while producing the
    next record, or while *sink* processes it, is counted and logged but never
    propagated. *http_stats*, when given, is called once at the end to fold the
    network client's cache/retry counters into the returned :class:`RunReport`.
    """
    adapter_id = adapter.name
    logger.info(
        "acquire start: category=%s adapter=%s",
        spec.id,
        adapter_id,
        extra={"event": "acquire.start", "category": spec.id, "adapter": adapter_id},
    )

    row_count = 0
    error_count = 0
    sources: set[str] = set()
    records = _iter_records(adapter, spec, logger, adapter_id)
    for record in records:
        if record is None:  # a record-level failure already logged by the iterator
            error_count += 1
            continue
        try:
            sink(record)
        except Exception as exc:  # noqa: BLE001 - one bad record must not abort the run
            error_count += 1
            logger.warning(
                "acquire record error: category=%s adapter=%s error=%s",
                spec.id,
                adapter_id,
                exc,
                extra={
                    "event": "acquire.record_error",
                    "category": spec.id,
                    "adapter": adapter_id,
                    "error": str(exc),
                },
            )
            continue
        row_count += 1
        sources.add(record.provenance.source)

    stats = http_stats() if http_stats is not None else HttpStats()
    report = RunReport(
        category_id=spec.id,
        adapter=adapter_id,
        row_count=row_count,
        distinct_sources=tuple(sorted(sources)),
        error_count=error_count,
        cache_hits=stats.cache_hits,
        cache_misses=stats.cache_misses,
        retries=stats.retries,
    )
    logger.info(
        "acquire done: category=%s adapter=%s rows=%d errors=%d sources=%s "
        "cache_hits=%d cache_misses=%d retries=%d",
        report.category_id,
        report.adapter,
        report.row_count,
        report.error_count,
        ",".join(report.distinct_sources) or "-",
        report.cache_hits,
        report.cache_misses,
        report.retries,
        extra={"event": "acquire.done", **report.to_dict()},
    )
    return report


def _iter_records(
    adapter: SourceAdapter,
    spec: CategorySpec,
    logger: logging.Logger,
    adapter_id: str,
) -> Iterator[RawRecord | None]:
    """Yield records from ``adapter.fetch(spec)``, never raising.

    A failure starting the fetch, or while advancing to the next record, is
    logged and surfaced as a single ``None`` sentinel; iteration then stops
    because a generator cannot resume past an exception.
    """
    try:
        iterator = iter(adapter.fetch(spec))
    except Exception as exc:  # noqa: BLE001 - fetch failures are reported, not raised
        _log_record_error(logger, spec, adapter_id, exc)
        yield None
        return
    while True:
        try:
            record = next(iterator)
        except StopIteration:
            return
        except Exception as exc:  # noqa: BLE001 - one bad record must not abort the run
            _log_record_error(logger, spec, adapter_id, exc)
            yield None
            return
        yield record


def _log_record_error(
    logger: logging.Logger,
    spec: CategorySpec,
    adapter_id: str,
    exc: Exception,
) -> None:
    logger.warning(
        "acquire record error: category=%s adapter=%s error=%s",
        spec.id,
        adapter_id,
        exc,
        extra={
            "event": "acquire.record_error",
            "category": spec.id,
            "adapter": adapter_id,
            "error": str(exc),
        },
    )
