"""The `/api/data-quality` route — the corpus's own report card.

Ported off the handler that was registered inline in `server/routes.ts`
(pinakes:62 US-2). Everything below HTTP is :mod:`pinakes.analytics.quality`;
this file takes no parameters at all.

Two shapes here are ports rather than choices:

* **The 500 body is `{message}` alone.** The handlers extracted into
  `server/routes/*.ts` answered `{error, detail}`, but this one stayed inline in
  `routes.ts` and answered a bare message — the same split
  `routers/correlations.py` reproduces.
* **A missing corpus directory is a 500, not an empty report.** `readdirSync`
  threw where the rest of the readers degrade to "no rows", and that is the one
  behaviour worth keeping: a quality report that graded an absent corpus would
  answer with a clean bill of health for a corpus that is not there
  (`server/CLAUDE.md` — the missing directory is how the lexicon move was caught).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from pinakes.analytics import quality
from pinakes.paths import lexicons_dir

logger = logging.getLogger("pinakes.data_quality")

router = APIRouter(tags=["data-quality"])


@router.get("/api/data-quality")
def data_quality() -> Any:
    """Per-file quality, referential integrity, coverage and tier composition."""
    try:
        return quality.generate_data_quality_report(lexicons_dir())
    except Exception:  # noqa: BLE001 - reported as the Express 500
        logger.exception("Error generating data quality report")
        return JSONResponse(
            status_code=500,
            content={"message": "Failed to generate data quality report"},
        )
