"""Bulk acquisition, in-process — the CLI child-process seam removed.

`server/services/engine-acquisition.ts`'s live runner did this per fetch: render
a category spec to YAML, write it to a temp file, spawn
``python -m pinakes_engine.cli fetch <spec> --out <dir>`` with a hand-built
``PYTHONPATH``, wait on the child (with a kill-timeout), read the ``.jsonl`` and
``.report.json`` it wrote back off disk, then delete the directory. Six failure
modes — interpreter not found, wrong package dir, timeout, non-zero exit, missing
output, unparseable report — none of which had anything to do with acquisition.

All of it collapses into :func:`fetch`, which calls the same two engine functions
the CLI's ``fetch`` handler calls (:func:`~pinakes_engine.acquire.factory.build_adapter`
and :func:`~pinakes_engine.acquire.run.run_acquisition`) and collects records into
a list instead of a file. Nothing is written to disk except the adapter's own HTTP
cache.

Two things are kept from the CLI handler on purpose, because they are behaviour
rather than plumbing: the HTTP client is captured so its cache/retry counters
land in the run report, and a per-record failure is counted, not raised — one bad
row must not lose the rest of the run.

The *adapter* is injectable for the same reason the TypeScript kept a
``EngineJobRunner`` interface: the whole path is then exercisable with no network
and no Wikidata.
"""

from __future__ import annotations

import tempfile
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from pinakes_engine.acquire.adapters import SourceAdapter
from pinakes_engine.acquire.categories import (
    CategorySpec,
    CategorySpecError,
    parse_category,
)
from pinakes_engine.acquire.factory import AdapterSelectionError, build_adapter
from pinakes_engine.acquire.http import HttpClient, HttpStats
from pinakes_engine.acquire.records import RawRecord
from pinakes_engine.acquire.run import RunReport, run_acquisition

from pinakes.engine.errors import EngineFailure

#: Where a network adapter caches responses when the caller names no directory.
#: Under the system temp root rather than the corpus: it is a transport detail,
#: not an artifact, and the CLI runner threw its equivalent away too.
DEFAULT_CACHE_SUBDIR = "http-cache"


@dataclass(frozen=True)
class Acquisition:
    """One completed acquisition run: the rows, and the report describing it."""

    records: tuple[RawRecord, ...]
    report: RunReport

    def payload(self) -> dict[str, Any]:
        """The run as plain JSON — ``{records: [{fields, provenance}], report}``.

        The record shape is the engine's own JSON-lines shape, so a caller that
        used to read the CLI's ``.jsonl`` back needs no new parser.
        """
        return {
            "records": [asdict(record) for record in self.records],
            "report": self.report.to_dict(),
        }


def category(spec: Mapping[str, Any] | CategorySpec) -> CategorySpec:
    """Validate a category spec given as a mapping (or pass one through).

    Uses :func:`~pinakes_engine.acquire.categories.parse_category`, the in-memory
    counterpart of the file loader — the same exhaustive validation the CLI ran
    on a YAML file, minus the file. A bad spec is the *caller's* error, so it
    raises :class:`~pinakes.engine.errors.EngineFailure` rather than looking like
    an unavailable backend.
    """
    if isinstance(spec, CategorySpec):
        return spec
    try:
        return parse_category(dict(spec))
    except CategorySpecError as exc:
        raise EngineFailure(f"invalid category spec: {exc}") from exc


def fetch(
    spec: Mapping[str, Any] | CategorySpec,
    *,
    adapter: SourceAdapter | None = None,
    cache_dir: str | Path | None = None,
) -> Acquisition:
    """Acquire one category's raw records in this process.

    *adapter* defaults to the one :func:`~pinakes_engine.acquire.factory.build_adapter`
    selects from ``source.type``; pass one to run against a fixture instead of a
    live source. *cache_dir* is where a network adapter caches responses.
    """
    resolved = category(spec)
    client: HttpClient | None = None

    def http_factory() -> HttpClient:
        nonlocal client
        client = HttpClient(cache_dir=_cache_dir(cache_dir, resolved))
        return client

    if adapter is None:
        try:
            adapter = build_adapter(resolved, http_factory=http_factory)
        except AdapterSelectionError as exc:
            raise EngineFailure(str(exc)) from exc

    def http_stats() -> HttpStats:
        return client.stats if client is not None else HttpStats()

    records: list[RawRecord] = []
    report = run_acquisition(
        adapter, resolved, records.append, http_stats=http_stats
    )
    return Acquisition(records=tuple(records), report=report)


def _cache_dir(explicit: str | Path | None, spec: CategorySpec) -> Path:
    if explicit is not None:
        return Path(explicit)
    return Path(tempfile.gettempdir()) / DEFAULT_CACHE_SUBDIR / spec.id


__all__ = ["Acquisition", "category", "fetch"]
