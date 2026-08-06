"""The `/api/living-dataset/*` route group — the corpus's lifecycle layer.

`server/routes/living-dataset.ts`. Three routes that compose things this service
already has rather than adding anything: the freshness report
(:mod:`pinakes.lexicons.freshness`), the acquisition runner
(:mod:`pinakes.acquire.job`), the snapshot builder
(:mod:`pinakes.dataset.export`) and the changelog. The only new state is one
`state.json` recording what was ingested when and what has been released.

* **`POST /ingest` never fails as a whole.** A domain whose acquisition throws
  lands in `errors[]` and the pass carries on; a partial run still records the
  domains that succeeded. There is no try/catch around the handler either — the
  TypeScript had none, so a failure *outside* the per-domain loop was an
  unhandled rejection over there and is a 500 here, which is the closer of the
  two available answers.
* **The stamp on a recorded ingestion is a fresh `now()`, not the one in the
  response.** `ranAt` is taken once at the top and each `recordIngestion` calls
  the clock again — so with a real clock they differ by the acquisition's
  duration. Copied, because the recorded stamp is what staleness is measured
  against and it should be when the work *finished*.
* **`?force` is not "ignore the schedule for the named domains"** — an explicit
  `domains` list already ignores it. `force` alone means *every* domain in the
  catalog, due or not.
* **`POST /release` derives its previous version from the store**, where
  `/api/dataset/release` defaults to the seed. That is the difference between
  the two release routes: this one advances a history, that one mints a
  standalone snapshot.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from pinakes.acquire import catalog
from pinakes.acquire import job as acquisition_job
from pinakes.contributions import store as contribution_store
from pinakes.dataset import export as pipeline
from pinakes.dataset import living
from pinakes.lexicons import freshness
from pinakes.paths import lexicons_dir
from pinakes.routers import _release

logger = logging.getLogger("pinakes.living_dataset")

router = APIRouter(tags=["living-dataset"])

#: Per-domain acquisition limit for a scheduled pass.
DEFAULT_INGEST_LIMIT = 50


def _iso(moment: datetime) -> str:
    """`date.toISOString()` — UTC, milliseconds, a `Z` suffix."""
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


@router.get("/api/living-dataset/status")
def living_dataset_status() -> Any:
    """The freshness + versioning dashboard payload.

    The one route in the group whose 500 is a real 500 (`{message}` carrying the
    error), because a status feed that cannot read the corpus has nothing
    partial to offer.
    """
    now = datetime.now(UTC)
    try:
        summary = freshness.freshness_summary(lexicons_dir(), now)
        store = living.LivingDatasetStore()
        releases = store.get_releases()
        current = living.current_release_from(releases)
        cadence = living.compute_release_cadence(current["releaseDate"], now)
        schedule = living.compute_ingestion_schedule(store.get_ingestions(), now)
        due = living.select_due_domains(schedule)
    except Exception as error:  # noqa: BLE001 - the handler's own try/catch
        logger.exception("Error loading living-dataset status")
        return JSONResponse(status_code=500, content={"message": str(error)})

    return {
        "generatedAt": _iso(now),
        "freshness": summary,
        "currentRelease": current,
        "releaseCadence": cadence,
        "ingestion": {
            "intervalDays": living.INGESTION_INTERVAL_DAYS,
            "entries": schedule,
            "dueDomains": due,
            "dueCount": len(due),
        },
        "releaseHistory": releases,
    }


@router.post("/api/living-dataset/ingest")
def living_dataset_ingest(body: Annotated[Any, Body()] = None) -> Any:
    """Run a scheduled discovery-ingestion pass. Body: `{domains?, force?, limit?}`.

    Every acquired record lands in the contribution review queue — this route
    never writes a lexicon row. An unknown requested domain is the only 400, and
    it refuses the **whole** pass rather than running the valid ones: a caller
    who named four domains and got three would have no way to tell.
    """
    data = body if isinstance(body, dict) else {}
    now = datetime.now(UTC)
    store = living.LivingDatasetStore()
    schedule = living.compute_ingestion_schedule(store.get_ingestions(), now)

    requested = data.get("domains")
    if isinstance(requested, list) and requested:
        names = [name for name in requested if isinstance(name, str)]
        invalid = [name for name in names if name not in catalog.ACQUISITION_CATALOG]
        if invalid:
            return JSONResponse(
                status_code=400,
                content={"message": f"Unknown domain(s): {', '.join(invalid)}"},
            )
        targets = names
    elif data.get("force") is True:
        targets = list(catalog.ACQUISITION_CATALOG)
    else:
        targets = living.select_due_domains(schedule)

    raw_limit = data.get("limit")
    limit = (
        int(raw_limit)
        if isinstance(raw_limit, (int, float))
        and not isinstance(raw_limit, bool)
        and raw_limit > 0
        else DEFAULT_INGEST_LIMIT
    )

    ran: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    queue = contribution_store.queue()

    for domain in targets:
        category = catalog.ACQUISITION_CATALOG[domain]
        try:
            outcome = acquisition_job.run(category, limit=limit, contributions=queue)
        except Exception as error:  # noqa: BLE001 - one domain must not end the pass
            logger.exception("Ingestion failed for %s", domain)
            errors.append({"domain": domain, "error": str(error)})
            continue
        store.record_ingestion(domain, _iso(datetime.now(UTC)))
        ran.append(
            {
                "domain": domain,
                "categoryId": category.id,
                "acquired": outcome.acquired,
                "queued": outcome.queued,
                "skipped": outcome.skipped,
                "contributionIds": list(outcome.contribution_ids),
            }
        )

    total = 0
    for entry in ran:
        total += int(entry["queued"])

    return {
        "ranAt": _iso(now),
        "requested": targets,
        "ran": ran,
        "errors": errors,
        "totalQueued": total,
    }


@router.post("/api/living-dataset/release")
def living_dataset_release(body: Annotated[Any, Body()] = None) -> Any:
    """Mint a DOI-bearing snapshot and record it so the annual cadence advances.

    Body: `{version?, previousVersion?, format?, datasets?}`. Unlike
    `/api/dataset/release` the default `previousVersion` is the **current
    recorded** release, so repeated calls walk the history forward.
    """
    data = body if isinstance(body, dict) else {}
    now = datetime.now(UTC)
    store = living.LivingDatasetStore()

    try:
        current = living.current_release_from(store.get_releases())
        explicit = data.get("version") if isinstance(data.get("version"), str) else None
        previous = (
            data["previousVersion"]
            if isinstance(data.get("previousVersion"), str)
            else current["version"]
        )

        snapshot = pipeline.build_dataset_snapshot(
            fmt=_release.parse_format(data.get("format")),
            datasets=_release.parse_datasets(data.get("datasets")),
            version=explicit,
            previous_version=previous,
            change_counts=None if explicit else _release.change_counts(),
            release_date=_iso(now),
            doi_minter=pipeline.zenodo_doi_minter(),
        )

        metadata = snapshot["metadata"]
        record = {
            "version": metadata["version"],
            "doi": metadata["doi"],
            "doiUrl": metadata["doiUrl"],
            "releaseDate": metadata["releaseDate"],
            "totalRows": metadata["totalRows"],
            "license": metadata["license"],
        }
        store.record_release(record)
    except Exception as error:  # noqa: BLE001 - the handler's own try/catch
        return _release.failed(logger, "minting living-dataset release", error)

    return JSONResponse(
        status_code=201,
        content={
            "release": metadata,
            "cadence": living.compute_release_cadence(
                str(record["releaseDate"]), now
            ),
        },
    )
