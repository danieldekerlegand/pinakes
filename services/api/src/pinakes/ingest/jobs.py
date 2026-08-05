"""The scraping-job ledger a long-running acquisition reports progress through.

The port of `server/services/job-store.ts` (pinakes:64 US-2), and the smallest
thing that could be. `POST /api/scraping/archaeology` answers **202 with a job
id** and does the work afterwards, so the id has to name something; this is that
something.

**`/api/scraping-jobs` is a different port unit and is still Express's**, which
has one consequence worth stating plainly rather than discovering: until it lands
here, a job started on this service is not visible to the dashboard's poll. The
acquisition itself is unaffected — it writes to the contribution queue, which
both servers share on disk — but its *progress* is only readable in-process. That
is the cost of porting the route before the ledger it reports into, and it is
temporary.

The store is in-memory, as the TypeScript's was: a job is progress, not a record,
and it is expected not to survive a restart. It is therefore also per-process,
which is the same caveat Express carried.
"""

from __future__ import annotations

import threading
import time
from typing import Any

from pinakes.contributions.store import iso_now

#: A job, in the `ScrapingJob` shape `contracts/types.ts` declares. A plain dict
#: for the same reason `Contribution` is one: it is a response body whose
#: authority is the contract, and re-typing it here would be a second copy.
Job = dict[str, Any]

_lock = threading.Lock()
_jobs: dict[str, Job] = {}
_counter = 0


def create_job(
    language_id: str, total_words: int, data_source: str | None = None
) -> Job:
    """Open a pending job and return it.

    The id is `job_<epoch ms>_<n>`, as Express minted it — two acquisitions
    started in the same millisecond are still distinct, which is what the
    counter is for.
    """
    global _counter
    with _lock:
        _counter += 1
        job_id = f"job_{int(time.time() * 1000)}_{_counter}"
        job: Job = {
            "id": job_id,
            "languageId": language_id,
            "status": "pending",
            "totalWords": total_words,
            "completedWords": 0,
            "failedWords": 0,
            "startedAt": None,
            "completedAt": None,
            "errorMessage": None,
            "createdAt": iso_now(),
            "dataSource": data_source or "gemini",
            "outputPath": None,
            "wordCount": None,
            "apiCallsUsed": None,
        }
        _jobs[job_id] = job
        return dict(job)


def update_job(job_id: str, **updates: Any) -> Job | None:
    """Merge *updates* into a job, or return ``None`` if there is no such job."""
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return None
        job.update(updates)
        return dict(job)


def get_job(job_id: str) -> Job | None:
    """One job by id."""
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job is not None else None


def all_jobs() -> list[Job]:
    """Every job, newest first — the order `GET /api/scraping-jobs` serves."""
    with _lock:
        jobs = [dict(job) for job in _jobs.values()]
    return sorted(jobs, key=lambda job: job.get("createdAt") or "", reverse=True)


def reset() -> None:
    """Forget every job. The test seam; nothing in the service calls it."""
    global _counter
    with _lock:
        _jobs.clear()
        _counter = 0


__all__ = [
    "Job",
    "all_jobs",
    "create_job",
    "get_job",
    "reset",
    "update_job",
]
