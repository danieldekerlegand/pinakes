"""The scraping-job ledger a long-running acquisition reports progress through.

The port of `server/services/job-store.ts` (pinakes:64 US-2), and the smallest
thing that could be. `POST /api/scraping/archaeology` answers **202 with a job
id** and does the work afterwards, so the id has to name something; this is that
something.

**`/api/scraping-jobs` landed in pinakes:80 US-1's fifth slice**
(:mod:`pinakes.routers.scraping`), which closed the hole this docstring used to
describe: a job started on this service — by the archaeological acquisition, the
Wikidata acquisition, or `POST /api/scraping-jobs` itself — is now visible to the
dashboard's poll. The two servers still keep *separate* ledgers, because this one
is in memory and so was Express's; only jobs opened in this process appear here.

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
    language_id: Any, total_words: Any, data_source: Any = None
) -> Job:
    """Open a pending job and return it.

    The three parameters are `Any` rather than their declared TypeScript types
    because `POST /api/scraping-jobs` hands them **straight out of a request
    body** — `createJob(languageId, totalWords || 0, dataSource)` — and
    TypeScript's annotations are not runtime checks. A caller that posts
    `{"languageId": "fin", "totalWords": "lots"}` gets a job carrying the string,
    on both servers. Narrowing here would be new validation, not a port.

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


def update_job(job_id: str, /, **updates: Any) -> Job | None:
    """Merge *updates* into a job, or return ``None`` if there is no such job.

    ``job_id`` is **positional-only** because `PATCH /api/scraping-jobs/{id}`
    spreads a caller's body straight in (`{...job, ...req.body}`), so any key at
    all can arrive — including `job_id`. Without the ``/`` that one body field
    would be a `TypeError` where Express simply set it on the record.
    """
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


def cleanup() -> None:
    """Drop all but the 50 most recent **settled** jobs (``JobStore.cleanup``).

    Called from `GET /api/scraping-jobs` and nowhere else, exactly as Express
    called it: the list request is the only moment anything knows the store has
    grown, and there is no timer. Running or pending jobs are never dropped
    however old they are — a job that has not settled still has a writer.

    Note the ordering is `getAllJobs()`'s (newest first) *before* the completed
    filter, so "the 50 most recent" is by `createdAt`, not by completion time.
    """
    settled = [
        job
        for job in all_jobs()
        if job.get("status") in ("completed", "failed")
    ]
    if len(settled) <= 50:
        return
    with _lock:
        for job in settled[50:]:
            _jobs.pop(job["id"], None)


def reset() -> None:
    """Forget every job. The test seam; nothing in the service calls it."""
    global _counter
    with _lock:
        _jobs.clear()
        _counter = 0


__all__ = [
    "Job",
    "all_jobs",
    "cleanup",
    "create_job",
    "get_job",
    "reset",
    "update_job",
]
