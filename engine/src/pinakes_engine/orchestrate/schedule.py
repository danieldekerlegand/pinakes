"""Time-based selection for scheduled, incremental corpus refreshes.

A scheduled run — ``pinakes_engine run --since <duration> jobs/<name>.yml`` driven
by cron or a systemd timer — should refresh only the categories that have gone
stale, leaving recently-built ones untouched. "Stale" is decided against the
corpus catalog (:mod:`pinakes_engine.orchestrate.catalog`): a category whose
recorded ``last_run`` is at or before ``now - since`` (or that has no entry yet)
is selected for refresh; everything newer is skipped.

The selection is the scheduling layer that sits *above* the per-stage
fingerprint incrementality (US-003). A category's ``acquire`` fingerprint is its
spec alone, so an unchanged spec never re-fetches on its own — which is correct
for a one-off run but wrong for a periodic refresh that must pick up upstream
edits. ``--since`` is that periodic trigger: the stale categories it selects are
re-acquired (the CLI forces them), while the fresh ones fall through to the
ordinary fingerprint skip and do no work.

:func:`parse_duration` reads the ``--since`` value, :func:`select_stale` makes
the per-category decisions, and :func:`write_refresh_log` appends a line to the
run log recording what was refreshed and what was skipped, so a scheduled run
leaves an audit trail.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from pinakes_engine.acquire.categories import CategorySpec
from pinakes_engine.orchestrate.catalog import Catalog, CatalogEntry

#: Filename of the JSONL refresh log appended under a job's output root.
REFRESH_LOG_NAME = "refresh-log.jsonl"

#: Seconds in each duration-suffix unit accepted by :func:`parse_duration`.
_UNIT_SECONDS = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}

#: One ``<number><unit>`` term of a duration string, e.g. ``7d`` or ``12h``.
_TERM = re.compile(r"(\d+)([smhdw])")


class DurationError(ValueError):
    """Raised when a ``--since`` duration string cannot be parsed."""


def parse_duration(text: str) -> timedelta:
    """Parse a compact duration such as ``30m``, ``24h``, ``7d``, or ``1w12h``.

    Terms are ``<number><unit>`` with units ``s``/``m``/``h``/``d``/``w`` and may
    be concatenated (``1w12h`` is eight and a half days); whitespace between
    terms is ignored. The total must be positive.

    Raises:
        DurationError: If the string is empty, holds an unrecognised term, or
            sums to zero.
    """
    cleaned = "".join(text.split()).lower()
    if not cleaned:
        raise DurationError("duration is empty; use e.g. 30m, 24h, 7d, 1w")

    total = timedelta()
    position = 0
    for match in _TERM.finditer(cleaned):
        if match.start() != position:  # a gap means an unparseable run of text
            break
        total += timedelta(seconds=int(match.group(1)) * _UNIT_SECONDS[match.group(2)])
        position = match.end()

    if position != len(cleaned) or total <= timedelta():
        raise DurationError(
            f"invalid duration {text!r}; use e.g. 30m, 24h, 7d, 1w "
            "(units: s, m, h, d, w)"
        )
    return total


@dataclass(frozen=True)
class CategoryDecision:
    """Why one category was selected for refresh or skipped.

    Attributes:
        category_id: The category the decision is about.
        refresh: Whether the category is stale and should be refreshed.
        reason: A human-readable explanation (used in the run log).
        last_run: The catalog's recorded ``last_run`` for this category, or
            ``None`` if it has never been catalogued.
    """

    category_id: str
    refresh: bool
    reason: str
    last_run: str | None


@dataclass(frozen=True)
class RefreshSelection:
    """The outcome of grading a job's categories against a ``--since`` window.

    Attributes:
        since: The staleness window the categories were graded against.
        cutoff: ``now - since`` — categories last run at or before it are stale.
        decisions: One :class:`CategoryDecision` per category, in job order.
    """

    since: timedelta
    cutoff: datetime
    decisions: tuple[CategoryDecision, ...]

    @property
    def refreshed(self) -> tuple[str, ...]:
        """The ids of the stale categories selected for refresh, in order."""
        return tuple(d.category_id for d in self.decisions if d.refresh)

    @property
    def skipped(self) -> tuple[str, ...]:
        """The ids of the fresh categories left untouched, in order."""
        return tuple(d.category_id for d in self.decisions if not d.refresh)

    @property
    def summary(self) -> str:
        """A one-line gloss of how many categories were refreshed vs skipped."""
        return (
            f"refresh window {self.since}: "
            f"{len(self.refreshed)} stale, {len(self.skipped)} up to date"
        )


def select_stale(
    categories: Sequence[CategorySpec],
    catalog: Catalog,
    since: timedelta,
    *,
    now: datetime,
) -> RefreshSelection:
    """Grade *categories* against the catalog, selecting the stale ones.

    A category is stale (``refresh=True``) when it has no catalog entry yet, its
    recorded ``last_run`` cannot be parsed, or that ``last_run`` is at or before
    ``now - since``. Everything newer is fresh and skipped. The returned
    :class:`RefreshSelection` preserves job order so the run log reads sensibly.
    """
    cutoff = now - since
    by_id = {entry.id: entry for entry in catalog.entries}
    decisions = tuple(
        _decide(spec.id, by_id.get(spec.id), cutoff) for spec in categories
    )
    return RefreshSelection(since=since, cutoff=cutoff, decisions=decisions)


def _decide(
    category_id: str, entry: CatalogEntry | None, cutoff: datetime
) -> CategoryDecision:
    """Decide whether one category is stale relative to *cutoff*."""
    if entry is None:
        return CategoryDecision(category_id, True, "never run (no catalog entry)", None)
    last_run = _parse_timestamp(entry.last_run)
    if last_run is None:
        return CategoryDecision(
            category_id,
            True,
            f"unparseable last run {entry.last_run!r}",
            entry.last_run or None,
        )
    cutoff_iso = cutoff.isoformat()
    stale = last_run <= cutoff
    relation = "at/before" if stale else "after"
    reason = f"last run {entry.last_run} {relation} cutoff {cutoff_iso}"
    return CategoryDecision(category_id, stale, reason, entry.last_run)


def _parse_timestamp(value: str) -> datetime | None:
    """Parse an ISO-8601 ``last_run``, treating a naive value as UTC."""
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def write_refresh_log(
    output_root: Path, selection: RefreshSelection, *, now: datetime
) -> Path:
    """Append a JSON line recording *selection*'s outcome to the refresh log.

    The log lives at ``<output_root>/refresh-log.jsonl`` and accumulates one
    line per scheduled run: its timestamp, the staleness window, and the
    categories refreshed vs skipped (with the per-category reason), so a
    scheduled refresh leaves an auditable record of what it touched.
    """
    output_root.mkdir(parents=True, exist_ok=True)
    path = output_root / REFRESH_LOG_NAME
    entry = {
        "timestamp": now.isoformat(),
        "since_seconds": int(selection.since.total_seconds()),
        "cutoff": selection.cutoff.isoformat(),
        "refreshed": list(selection.refreshed),
        "skipped": list(selection.skipped),
        "decisions": [
            {
                "category": d.category_id,
                "refresh": d.refresh,
                "reason": d.reason,
                "last_run": d.last_run,
            }
            for d in selection.decisions
        ],
    }
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry) + "\n")
    return path
