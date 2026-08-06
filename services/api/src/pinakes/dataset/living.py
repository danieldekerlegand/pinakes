"""`server/services/living-dataset.ts`, ported — when to re-ingest, when to release.

Two schedules and the one JSON file that records what happened:

* **Release cadence** — annual. A corpus that has never been released is
  *always* due, because the first release should ship.
* **Ingestion schedule** — one entry per acquisition domain, stale after thirty
  days. Mirrors `pinakes_engine.orchestrate.schedule.select_stale`'s idea
  without importing it: the engine grades *categories* by a run manifest, this
  grades *domains* by a timestamp a route wrote.

Everything except :class:`LivingDatasetStore` is pure with the clock as a
parameter, which is what makes the routes testable at all.

Two date rules carry over and neither is Python's default. `new Date(x)` on an
unparseable string yields an Invalid Date, and both schedules treat that
**exactly like a missing timestamp** — never as an error and never as "now". And
`last.toISOString()` re-normalises whatever spelling was recorded, so a state
file written by hand comes back in the canonical form.
"""

from __future__ import annotations

import json
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

from pinakes.acquire.catalog import ACQUISITION_CATALOG
from pinakes.contributions.changelog import date_parse_ms
from pinakes.dataset.export import DATASET_LICENSE, DATASET_RELEASE_VERSION
from pinakes.paths import living_dataset_dir

DAY_MS: Final = 24 * 60 * 60 * 1000

#: Annual — the living dataset produces a citable snapshot yearly.
RELEASE_CADENCE_DAYS: Final = 365

#: A domain not ingested for this long is stale and gets picked up by a
#: scheduled run.
INGESTION_INTERVAL_DAYS: Final = 30


def _iso(ms: float) -> str:
    """`new Date(ms).toISOString()` — UTC, milliseconds, a `Z` suffix."""
    moment = datetime.fromtimestamp(ms / 1000, tz=UTC)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def _ceil_days(delta_ms: float) -> int:
    """`Math.ceil(x / DAY_MS)` — toward +∞, so an overdue release is negative."""
    return int(math.ceil(delta_ms / DAY_MS))


def _floor_days(delta_ms: float) -> int:
    """`Math.floor(x / DAY_MS)` — toward −∞, which is what "days since" means."""
    return int(math.floor(delta_ms / DAY_MS))


def compute_release_cadence(
    last_release_date: str | None,
    now: datetime,
    interval_days: int = RELEASE_CADENCE_DAYS,
) -> dict[str, Any]:
    """Is a release due, and when is the next one?

    The never-released answer keeps whatever was passed in as
    `lastReleaseDate` — including an unparseable string — so a caller can see
    that the recorded date was junk rather than absent.
    """
    never = {
        "cadence": "annual",
        "intervalDays": interval_days,
        "lastReleaseDate": last_release_date if last_release_date else None,
        "nextReleaseDate": None,
        "dueNow": True,
        "daysUntilDue": None,
    }
    if not last_release_date:
        return never

    last_ms = date_parse_ms(last_release_date)
    if last_ms is None:
        return never

    now_ms = now.timestamp() * 1000
    next_ms = last_ms + interval_days * DAY_MS
    return {
        "cadence": "annual",
        "intervalDays": interval_days,
        "lastReleaseDate": _iso(last_ms),
        "nextReleaseDate": _iso(next_ms),
        "dueNow": now_ms >= next_ms,
        "daysUntilDue": _ceil_days(next_ms - now_ms),
    }


def compute_ingestion_schedule(
    ingestions: dict[str, str],
    now: datetime,
    interval_days: int = INGESTION_INTERVAL_DAYS,
) -> list[dict[str, Any]]:
    """Grade every acquisition domain, in catalog order.

    Catalog order rather than sorted order because the schedule is rendered as a
    list and the four domains read sensibly in the order they were declared in.
    """
    now_ms = now.timestamp() * 1000
    entries: list[dict[str, Any]] = []
    for category in ACQUISITION_CATALOG.values():
        raw = ingestions.get(category.domain)
        last_ms = date_parse_ms(raw) if raw else None
        if last_ms is None:
            entries.append(
                {
                    "domain": category.domain,
                    "label": category.label,
                    "lastIngested": None,
                    "nextDue": None,
                    "dueNow": True,
                    "daysSinceLastIngest": None,
                }
            )
            continue
        next_ms = last_ms + interval_days * DAY_MS
        entries.append(
            {
                "domain": category.domain,
                "label": category.label,
                "lastIngested": _iso(last_ms),
                "nextDue": _iso(next_ms),
                "dueNow": now_ms >= next_ms,
                "daysSinceLastIngest": _floor_days(now_ms - last_ms),
            }
        )
    return entries


def select_due_domains(schedule: list[dict[str, Any]]) -> list[str]:
    """The domains a scheduled run refreshes, in catalog order."""
    return [str(entry["domain"]) for entry in schedule if entry["dueNow"]]


def current_release_from(releases: list[dict[str, Any]]) -> dict[str, Any]:
    """The latest recorded release, or the seed defaults when there is none.

    "Latest" is the **last appended**, not the highest version — the history is
    a log of what was minted, and a release explicitly cut at an older version
    is still the current one.
    """
    latest = releases[-1] if releases else None
    if latest is None:
        return {
            "version": DATASET_RELEASE_VERSION,
            "doi": None,
            "doiUrl": None,
            "releaseDate": None,
            "totalRows": None,
            "license": DATASET_LICENSE,
            "released": False,
        }
    return {
        "version": latest.get("version"),
        "doi": latest.get("doi"),
        "doiUrl": latest.get("doiUrl"),
        "releaseDate": latest.get("releaseDate"),
        "totalRows": latest.get("totalRows"),
        "license": latest.get("license"),
        "released": True,
    }


# ── Persistence (the fs boundary) ────────────────────────────────────────────


class LivingDatasetStore:
    """One `state.json` holding the ingestion stamps and the release history.

    Built per call from :func:`pinakes.paths.living_dataset_dir` rather than
    cached, for the same reason `contributions.store.queue()` is — the path
    re-reads its env override every time, and that override is the only thing
    between a test and the real state file.

    An unreadable or unparseable file is **empty state**, not an error: this
    backs a dashboard and a scheduler, and losing the schedule to a corrupt file
    should cost a re-ingest, not the endpoint.
    """

    def __init__(self, directory: Path | None = None) -> None:
        base = Path(directory) if directory is not None else living_dataset_dir()
        self.file = base / "state.json"

    def _read(self) -> dict[str, Any]:
        try:
            parsed = json.loads(self.file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"ingestions": {}, "releases": []}
        if not isinstance(parsed, dict):
            return {"ingestions": {}, "releases": []}
        ingestions = parsed.get("ingestions")
        releases = parsed.get("releases")
        return {
            "ingestions": ingestions if isinstance(ingestions, dict) else {},
            "releases": releases if isinstance(releases, list) else [],
        }

    def _write(self, state: dict[str, Any]) -> None:
        self.file.parent.mkdir(parents=True, exist_ok=True)
        self.file.write_text(
            json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    def get_ingestions(self) -> dict[str, str]:
        ingestions: dict[str, str] = self._read()["ingestions"]
        return ingestions

    def get_releases(self) -> list[dict[str, Any]]:
        releases: list[dict[str, Any]] = self._read()["releases"]
        return releases

    def record_ingestion(self, domain: str, at: str) -> None:
        """Stamp *domain* as ingested at *at* (ISO)."""
        state = self._read()
        state["ingestions"][domain] = at
        self._write(state)

    def record_release(self, record: dict[str, Any]) -> None:
        """Append a minted release so the annual cadence advances."""
        state = self._read()
        state["releases"].append(record)
        self._write(state)
