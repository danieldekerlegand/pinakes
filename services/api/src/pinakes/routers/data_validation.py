"""The three `/api/data-validation/*` reads.

The cutover's tenth slice (pinakes:80 US-1, continued). Everything below HTTP is
:mod:`pinakes.analytics.validation`; the service is built per request against
`paths.lexicons_dir()`, which is what keeps the id cache from outliving the
corpus it indexed.

Two reads are ports rather than choices:

* **`?files=` splits on a comma and trims each part**, and the parts are matched
  against the schema table by **exact** file name — so `?files=languages` selects
  nothing and answers a report with zero files validated rather than a 400.
* **`?skipCrossReferences` is compared against the literal `"true"`**, so
  `?skipCrossReferences=1` does *not* skip them.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Request

from pinakes.analytics import validation
from pinakes.paths import lexicons_dir
from pinakes.routers import _reads

logger = logging.getLogger("pinakes.data_validation")

router = APIRouter(tags=["data-validation"])


def _service() -> validation.DataValidationService:
    return validation.DataValidationService(lexicons_dir())


@router.get("/api/data-validation/validate")
def validate(request: Request) -> Any:
    """Run the schema pass, and the referential-integrity pass beside it."""
    raw = request.query_params.get("files")
    files = [part.strip() for part in raw.split(",")] if raw else None
    skip = request.query_params.get("skipCrossReferences") == "true"
    try:
        return _service().validate(files=files, skip_cross_references=skip)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _reads.failed(
            logger,
            "running data validation",
            "Failed to run data validation",
            error,
        )


@router.get("/api/data-validation/summary")
def summary() -> Any:
    """Every declared file, whether it exists, and how big it is."""
    try:
        files = _service().data_summary()
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _reads.failed(
            logger, "fetching data summary", "Failed to fetch data summary", error
        )
    return {"files": files, "totalFiles": len(files)}


@router.get("/api/data-validation/cross-references")
def cross_references() -> Any:
    """The declared cross-reference rules, for the UI to display."""
    try:
        rules = _service().cross_reference_rules()
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _reads.failed(
            logger,
            "fetching cross-reference rules",
            "Failed to fetch cross-reference rules",
            error,
        )
    return {"rules": rules, "totalRules": len(rules)}
