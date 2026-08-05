"""The scraper dashboard — the job ledger, the coverage report, the engine start.

Eight of the ten routes the dashboard polls: the four `/api/scraping-jobs`
CRUD-ish endpoints over :mod:`pinakes.ingest.jobs`, `GET /api/scraping/status`,
`GET /api/scraping/coverage` over the word-form table, and the two
`/api/scraping/engine*` routes that start a Wikidata acquisition through
:mod:`pinakes.acquire`.

This is the slice that closes a hole two earlier bands documented rather than
fixed. `ingest/jobs.py` (pinakes:64 US-2) and `acquire/job.py` (pinakes:65 US-1)
both shipped with a note saying their progress was invisible because
`/api/scraping-jobs` was still Express's. It is not any more, and neither module
grew a second copy of anything — `POST /api/scraping/engine` is an adapter over
`acquire.job.run` exactly as `routers/archaeology.py` is one over
`ingest.archaeology`.

Two routes of the unit deliberately did **not** come across and are still 501:
`POST /api/scraping/{families,mythology}`. Those are ~1,000 lines of Gemini
prompt/schema plus a direct TSV **write** into the live corpus
(`server/services/{language-family,mythology}-scraper-tsv.ts`) — a real port of a
generator, not of a route, and the only part of it a route touches is the job id
it hands back. They are their own slice.

* **The 500 spellings are `{message}` alone**, everywhere in this file: every one
  of these handlers stayed inline in `routes.ts`. `/api/scraping/engine*` is the
  exception in the other direction — it was extracted to
  `server/routes/engine-acquisition.ts` and has **no** try/catch at all.
* **`GET /api/scraping-jobs` prunes as a side effect of listing.** The response is
  the pre-prune list and the prune runs after it is taken, so a request that
  drops the 51st settled job still returns it. Copied — see
  :func:`pinakes.ingest.jobs.cleanup`.
* **Nothing in the request body is validated beyond `!languageId`.** A job's
  `totalWords` is `totalWords || 0` and a PATCH is a raw object spread, so a
  caller can put arbitrary keys on a job record. That is Express's, and it is why
  `jobs.create_job` takes `Any`.
"""

from __future__ import annotations

import logging
import math
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Body
from fastapi.responses import JSONResponse

from pinakes.acquire import catalog
from pinakes.acquire import job as acquisition_job
from pinakes.contributions import store
from pinakes.contributions.store import js_truthy
from pinakes.ingest import jobs
from pinakes.lexicons import forms
from pinakes.paths import lexicons_dir
from pinakes.routers import _reads

logger = logging.getLogger("pinakes.scraping")

router = APIRouter(tags=["scraping"])


def _payload(body: Any) -> dict[str, Any]:
    """``req.body ?? {}`` for a body that is read as an object."""
    return body if isinstance(body, dict) else {}


def _spread(body: Any) -> dict[str, Any]:
    """``{...job, ...req.body}``'s right-hand side, as JavaScript spreads it.

    An object contributes its own keys; an **array** contributes its indices as
    string keys (`{...[7]}` is `{"0": 7}`), which is silly and is what happens.
    Anything else — including a body Express never parsed — contributes nothing.
    """
    if isinstance(body, dict):
        return body
    if isinstance(body, list):
        return {str(index): value for index, value in enumerate(body)}
    return {}


# ── The job ledger ───────────────────────────────────────────────────────────


@router.get("/api/scraping-jobs")
def list_scraping_jobs() -> Any:
    """Every job this process knows about, newest first. The dashboard's poll."""
    try:
        listed = jobs.all_jobs()
        jobs.cleanup()
        return listed
    except Exception:  # noqa: BLE001 - the handler's own try/catch
        return _reads.failed_plain(
            logger, "fetching scraping jobs", "Failed to fetch scraping jobs"
        )


@router.get("/api/scraping-jobs/{id}")
def get_scraping_job(id: str) -> Any:
    """One job by id, or 404."""
    try:
        job = jobs.get_job(id)
    except Exception:  # noqa: BLE001 - the handler's own try/catch
        return _reads.failed_plain(
            logger, "fetching scraping job", "Failed to fetch scraping job"
        )
    if job is None:
        return _reads.missing("Job not found")
    return job


@router.post("/api/scraping-jobs")
def create_scraping_job(body: Annotated[Any, Body()] = None) -> Any:
    """Open a job the caller will report progress into itself.

    "For compatibility", said the TypeScript, and it means it: nothing here
    starts any work. `languageId` is the only required field and the check is
    JavaScript truthiness, so `0` and `""` are both refused.
    """
    data = _payload(body)
    language_id = data.get("languageId")
    if not js_truthy(language_id):
        return JSONResponse(
            status_code=400, content={"message": "languageId is required"}
        )
    try:
        total_words = data.get("totalWords")
        return jobs.create_job(
            language_id,
            total_words if js_truthy(total_words) else 0,
            data.get("dataSource"),
        )
    except Exception:  # noqa: BLE001 - the handler's own try/catch
        return _reads.failed_plain(
            logger, "creating scraping job", "Failed to create scraping job"
        )


@router.patch("/api/scraping-jobs/{id}")
def update_scraping_job(id: str, body: Annotated[Any, Body()] = None) -> Any:
    """Merge the body into a job. Unknown id is a 404; unknown *keys* are kept."""
    try:
        updated = jobs.update_job(id, **_spread(body))
    except Exception:  # noqa: BLE001 - the handler's own try/catch
        return _reads.failed_plain(
            logger, "updating scraping job", "Failed to update scraping job"
        )
    if updated is None:
        return _reads.missing("Job not found")
    return updated


# ── Status and coverage ──────────────────────────────────────────────────────


@router.get("/api/scraping/status")
def scraping_status() -> Any:
    """A constant, and it was a constant on Express too.

    The comment over there reads "placeholder for now — in the future this could
    track active scraping jobs". It never did; `GET /api/scraping-jobs` is what
    the dashboard actually reads. Ported as the constant it is rather than
    quietly wired up to the ledger, which would be a behaviour change no client
    asked for.
    """
    return {"familyScraping": False, "wordScraping": []}


@router.get("/api/scraping/coverage")
def scraping_coverage() -> Any:
    """How much of the concept list each living language has forms for."""
    try:
        return forms.word_coverage_by_language(lexicons_dir())
    except Exception:  # noqa: BLE001 - the handler's own try/catch
        return _reads.failed_plain(
            logger, "fetching word coverage", "Failed to fetch word coverage"
        )


# ── Wikidata bulk acquisition ────────────────────────────────────────────────


@router.get("/api/scraping/engine/categories")
def engine_categories() -> Any:
    """The four acquirable domains, for the dashboard's picker."""
    return {
        "categories": [
            {
                "domain": category.domain,
                "id": category.id,
                "label": category.label,
                "description": category.description,
                "entityType": category.entity_type,
                "wikidataClass": category.wikidata_class,
            }
            for category in catalog.list_acquisition_categories()
        ]
    }


@router.post("/api/scraping/engine", status_code=202)
def start_engine_acquisition(
    background: BackgroundTasks, body: Annotated[Any, Body()] = None
) -> Any:
    """Start a Wikidata acquisition; rows land in the contribution review queue.

    202 and work afterwards, for the reasons `routers/archaeology.py` documents
    at length — including that `TestClient` settles the background task before
    returning, so a test asserts on a finished job on the next line.
    """
    data = _payload(body)

    category = catalog.resolve_acquisition_category(
        data["domain"] if isinstance(data.get("domain"), str) else None
    )
    if category is None:
        # `${body.domain ?? "(none)"}` — *nullish*, so an explicitly blank domain
        # is reported as the blank it was rather than as "none named".
        named = data.get("domain")
        return JSONResponse(
            status_code=400,
            content={
                "message": (
                    "Unknown pinakes-engine domain: "
                    f"{'(none)' if named is None else named}"
                ),
                "validDomains": list(catalog.ACQUISITION_CATALOG),
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

    job = jobs.create_job(f"pinakes_engine:{category.domain}", limit or 0, "other")
    jobs.update_job(
        job["id"],
        status="running",
        startedAt=store.iso_now(),
        statusMessage=f"Starting Wikidata acquisition for {category.label}",
    )

    background.add_task(_acquire, job["id"], category, limit)

    return {
        "jobId": job["id"],
        "domain": category.domain,
        "message": (
            f"pinakes-engine Wikidata acquisition started for {category.label}"
        ),
    }


def _acquire(
    job_id: str, category: catalog.AcquisitionCategory, limit: int | None
) -> None:
    """Run the acquisition and settle its job, whichever way it goes.

    `acquire.job.run` reports no intermediate progress — it is one `fetch`
    followed by a queue write per record — so unlike the archaeological
    acquisition there is no `onProgress` to forward. The `statusMessage` the
    TypeScript's progress callback would have written is the completion one.
    """
    try:
        outcome = acquisition_job.run(
            category, limit=limit, contributions=store.queue()
        )
    except Exception as error:  # noqa: BLE001 - any failure fails the job
        logger.exception("Wikidata acquisition failed")
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
        completedWords=outcome.queued,
        failedWords=outcome.skipped,
        totalWords=outcome.acquired,
        wordCount=outcome.queued,
        statusMessage=(
            f"Queued {outcome.queued} {category.label} contribution(s) for "
            f"review ({outcome.skipped} skipped, {outcome.acquired} fetched)."
        ),
    )
