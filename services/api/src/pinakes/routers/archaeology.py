"""The `/api/scraping/archaeology*` route group — acquire sites for review.

Ported off `server/routes/archaeological-acquisition.ts` (pinakes:64 US-2) over
:mod:`pinakes.ingest.archaeology`. An adapter, like every router here: read the
body the way Express read it, open a job, hand the work to the ingest layer.

* **The POST answers 202 and does the work afterwards.** An acquisition is a
  fetch plus up to a hundred queue writes; holding the connection open for it
  would be a different contract, and the dashboard is built around polling. The
  work runs as a Starlette `BackgroundTask`, which for a `def` callable means
  the threadpool — where the ingest layer's *synchronous* HTTP client is at home
  (`pinakes/ingest/http.py`). Declared `async` this would block the event loop
  for the whole process, and the rate limiter's own sleep would block it
  deliberately.
* **A test does not have to poll for it.** `TestClient` runs the background task
  before it returns the response, so the assertion after a `client.post(...)`
  sees a settled job. That is what replaced the TypeScript route's
  `onJobSettled` hook, which existed only to make the same thing deterministic.
* **The failure modes split at the fetch.** An authority that refuses fails the
  *job* (202 was already sent — there is nowhere else to report it), while a
  body this service can refuse before starting is a **400**. Neither is a 5xx:
  nothing here is broken.
"""

from __future__ import annotations

import logging
import math
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Body
from fastapi.responses import JSONResponse

from pinakes.contributions import store
from pinakes.ingest import archaeology, jobs
from pinakes.routers import _reads

logger = logging.getLogger("pinakes.archaeology")

router = APIRouter(tags=["archaeology"])


def _payload(body: Any) -> dict[str, Any]:
    """``req.body ?? {}`` — anything that is not an object is no fields at all."""
    return body if isinstance(body, dict) else {}


@router.get("/api/scraping/archaeology/sources")
def archaeology_sources() -> Any:
    """The external authorities the dashboard can start an acquisition against."""
    return {
        "sources": [
            {
                "id": source["id"],
                "label": source["label"],
                "description": source["description"],
                "homepage": source["homepage"],
            }
            for source in archaeology.list_archaeology_sources()
        ]
    }


@router.post("/api/scraping/archaeology", status_code=202)
def start_archaeology_acquisition(
    background: BackgroundTasks, body: Annotated[Any, Body()] = None
) -> Any:
    """Start an acquisition job for one authority; sites land in the review queue."""
    data = _payload(body)

    source = archaeology.resolve_archaeology_source(data.get("source"))
    if source is None:
        # `${body.source ?? "(none)"}` — *nullish*, not falsy, so an explicitly
        # blank source is reported as the blank it was, not as "none named".
        named = data.get("source")
        return JSONResponse(
            status_code=400,
            content={
                "message": (
                    "Unknown archaeological source: "
                    f"{'(none)' if named is None else named}"
                ),
                "validSources": list(archaeology.ARCHAEOLOGY_SOURCES),
            },
        )

    limit: int | None = None
    if data.get("limit") is not None:
        parsed = _reads.body_number(data["limit"])
        if not math.isfinite(parsed) or parsed <= 0:
            return JSONResponse(
                status_code=400,
                content={"message": "limit must be a positive number"},
            )
        limit = math.floor(parsed)

    raw_query = data.get("query")
    query = raw_query if isinstance(raw_query, str) else None

    source_id = source["id"]
    job = jobs.create_job(f"archaeology:{source_id}", limit or 0, "other")
    jobs.update_job(
        job["id"],
        status="running",
        startedAt=store.iso_now(),
        statusMessage=f"Starting acquisition from {source['label']}",
    )

    background.add_task(_acquire, job["id"], source_id, query, limit)

    return {
        "jobId": job["id"],
        "source": source_id,
        "message": f"Archaeological acquisition started for {source['label']}",
    }


def _acquire(job_id: str, source: str, query: str | None, limit: int | None) -> None:
    """Run the acquisition and settle its job, whichever way it goes."""

    def on_progress(progress: archaeology.AcquisitionProgress) -> None:
        jobs.update_job(
            job_id,
            statusMessage=progress.message,
            completedWords=progress.queued,
            failedWords=progress.skipped,
            # `progress.total ?? limit ?? progress.acquired` — before the fetch
            # returns, the caller's limit is the best total anyone has.
            totalWords=(
                progress.total
                if progress.total is not None
                else limit
                if limit is not None
                else progress.acquired
            ),
        )

    try:
        result = archaeology.run_archaeological_acquisition(
            source,
            contributions=store.queue(),
            query=query,
            limit=limit,
            on_progress=on_progress,
        )
    except Exception as error:  # noqa: BLE001 - any failure fails the job, not the process
        logger.exception("Archaeological acquisition failed")
        jobs.update_job(
            job_id,
            status="failed",
            completedAt=store.iso_now(),
            errorMessage=str(error),
            statusMessage=f"Acquisition failed: {error}",
        )
        return

    jobs.update_job(
        job_id,
        status="completed",
        completedAt=store.iso_now(),
        completedWords=result.queued,
        failedWords=result.skipped,
        totalWords=result.acquired,
        wordCount=result.queued,
        statusMessage=(
            f"Queued {result.queued} archaeological site(s) for review "
            f"({result.skipped} skipped, {result.acquired} fetched)."
        ),
    )
