"""`server/services/data-freshness.ts`, ported — how old is each lexicon file.

The only reader in this package that grades the corpus by its **mtime** rather
than by its contents, and the only one whose answer changes when nothing does.
Three things about it are contract rather than convenience:

* **A missing directory is an empty report, not an error.** Unlike
  :mod:`pinakes.analytics.quality` — which 500s on a corpus that is not there,
  because a clean bill of health for nothing is worse than a failure — this one
  is a dashboard tile, and an empty tile is an honest one.
* **The record count is `lines - 1`, floored at zero**, over a plain
  ``split("\\n")`` with blank lines dropped. That is deliberately not
  :func:`pinakes.analytics.tsv.parse_tsv`: this counts what is in the file,
  including rows a loader would reject.
* **The clock is a parameter.** `getFreshnessSummary` took `now` so its tests
  could pin an age; keeping that here is what makes the summary testable at all.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any, NamedTuple

from pinakes.analytics.jsmath import js_number, js_round

MILLISECONDS_PER_DAY = 1000 * 60 * 60 * 24


class Thresholds(NamedTuple):
    """The two age boundaries between ``fresh``, ``aging`` and ``stale``."""

    fresh_days: float
    aging_days: float


#: `DEFAULT_THRESHOLDS` — a week, then a month.
DEFAULT_THRESHOLDS = Thresholds(fresh_days=7.0, aging_days=30.0)


def classify_staleness(age_days: float, thresholds: Thresholds) -> str:
    """``<= freshDays`` is fresh, ``<= agingDays`` is aging, else stale."""
    if age_days <= thresholds.fresh_days:
        return "fresh"
    if age_days <= thresholds.aging_days:
        return "aging"
    return "stale"


def _record_count(path: Path) -> int:
    """``max(0, nonBlankLines - 1)``; an unreadable file counts **0** rows."""
    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        return 0
    lines = [line for line in content.split("\n") if line.strip()]
    return max(0, len(lines) - 1)


def human_name(filename: str) -> str:
    """``"sample-texts.tsv"`` → ``"Sample Texts"``.

    ``w.charAt(0).toUpperCase() + w.slice(1)``, which is **not** `str.title()`:
    only the first character is touched, so ``"wikimedia-commons-images"`` keeps
    any internal capitals a filename happens to carry.
    """
    stem = filename[: -len(".tsv")] if filename.endswith(".tsv") else filename
    return " ".join(word[:1].upper() + word[1:] for word in stem.split("-"))


def _iso(moment: datetime) -> str:
    """``Date.prototype.toISOString`` — UTC, milliseconds, a ``Z`` suffix."""
    return (
        moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.")
        + f"{moment.astimezone(UTC).microsecond // 1000:03d}Z"
    )


def dataset_freshness(
    lexicons: Path,
    now: datetime,
    thresholds: Thresholds = DEFAULT_THRESHOLDS,
) -> list[dict[str, Any]]:
    """One record per `*.tsv` in *lexicons*, sorted by filename."""
    directory = Path(lexicons)
    if not directory.is_dir():
        return []

    records: list[dict[str, Any]] = []
    for path in sorted(directory.glob("*.tsv"), key=lambda entry: entry.name):
        stat = path.stat()
        # `stat.mtimeMs` is fractional (nanoseconds / 1e6) and `ageMs` is
        # computed from it unrounded — but `stat.mtime`, which is what
        # `lastModified` prints, is node's `Math.round` of the same number, not
        # a truncation. Reading `st_mtime_ns` rather than the float `st_mtime`
        # is what makes that rounding land on the same millisecond Express got.
        modified_ms = stat.st_mtime_ns / 1e6
        age_ms = now.timestamp() * 1000 - modified_ms
        age_days = age_ms / MILLISECONDS_PER_DAY
        records.append(
            {
                "name": human_name(path.name),
                "file": path.name,
                "recordCount": _record_count(path),
                "sizeBytes": stat.st_size,
                "lastModified": _iso(
                    datetime.fromtimestamp(js_round(modified_ms) / 1000, tz=UTC)
                ),
                "ageMs": js_number(age_ms),
                # `Math.round(x * 100) / 100`, ties toward +∞ — two decimals of
                # a duration, which is what the dashboard prints.
                "ageDays": js_number(js_round(age_days * 100) / 100),
                "staleness": classify_staleness(age_days, thresholds),
            }
        )
    return records


def freshness_summary(
    lexicons: Path,
    now: datetime,
    thresholds: Thresholds = DEFAULT_THRESHOLDS,
) -> dict[str, Any]:
    """`GET /api/data-freshness`'s whole body.

    `oldestDataset`/`newestDataset` come off a **stable** sort by `ageMs`, so a
    tie between two files written in the same millisecond is broken by filename
    — which is the order :func:`dataset_freshness` already returned them in.
    """
    datasets = dataset_freshness(lexicons, now, thresholds)
    by_age = sorted(datasets, key=lambda entry: float(entry["ageMs"]))

    total_records = 0
    total_size = 0
    for entry in datasets:
        total_records += int(entry["recordCount"])
        total_size += int(entry["sizeBytes"])

    return {
        "datasets": datasets,
        "totalDatasets": len(datasets),
        "totalRecords": total_records,
        "totalSizeBytes": total_size,
        "freshCount": sum(1 for e in datasets if e["staleness"] == "fresh"),
        "agingCount": sum(1 for e in datasets if e["staleness"] == "aging"),
        "staleCount": sum(1 for e in datasets if e["staleness"] == "stale"),
        "oldestDataset": by_age[-1]["name"] if by_age else None,
        "newestDataset": by_age[0]["name"] if by_age else None,
        "generatedAt": _iso(now),
    }
