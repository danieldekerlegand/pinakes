"""The `/api/ancestry/*` route group — DNA to cultural association.

Ported off `server/routes/ancestry.ts` (pinakes:65 US-2) over
:mod:`pinakes.analytics.genetic`, which already owned the divergence table this
mapper shares with the correlation engine.

**The privacy guarantee is upstream of this file and stays there.** Raw-DNA
parsing and haplogroup inference happen in the browser (`web/src/lib/dna/*`); a
request carries only the inferred haplogroup ids — never genotypes — and all
these two handlers do is enrich non-identifying ids from the public reference
corpus. Nothing here reads, writes or logs a request body beyond the id list, and
that is deliberate rather than incidental.

The corpus haplogroups are **Y-chromosome only**, so an association is
paternal-line only. The result says so itself: every answer carries
:data:`~pinakes.analytics.genetic.ANCESTRY_CAVEATS`, including the answer that
matched nothing.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from pinakes.analytics import genetic
from pinakes.paths import lexicons_dir

logger = logging.getLogger("pinakes.ancestry")

router = APIRouter(tags=["ancestry"])


@router.get("/api/ancestry/haplogroups")
def haplogroups() -> Any:
    """The reference haplogroups the mapper recognizes."""
    try:
        return genetic.reference_haplogroups(genetic.load_ancestry_data(lexicons_dir()))
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        logger.exception("failed to load haplogroups")
        return JSONResponse(
            status_code=500,
            content={"error": "failed to load haplogroups", "detail": str(error)},
        )


@router.post("/api/ancestry/map")
def map_ancestry(body: Annotated[Any, Body()] = None) -> Any:
    """Map inferred haplogroup ids to cultural associations.

    Two 400s rather than one, and they say different things: a missing or empty
    list is a malformed request, where a list of non-strings is a request whose
    ids cannot be read. Express distinguished them and the client surfaces the
    message verbatim.
    """
    payload = body if isinstance(body, dict) else {}
    raw = payload.get("haplogroupIds")
    if not isinstance(raw, list) or not raw:
        return JSONResponse(
            status_code=400,
            content={"error": "haplogroupIds must be a non-empty array of strings"},
        )
    haplogroup_ids = [item for item in raw if isinstance(item, str)]
    if not haplogroup_ids:
        return JSONResponse(
            status_code=400,
            content={"error": "haplogroupIds must contain at least one string id"},
        )

    try:
        return genetic.map_haplogroups_to_ancestry(
            haplogroup_ids, genetic.load_ancestry_data(lexicons_dir())
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        logger.exception("Unexpected error in /api/ancestry/map")
        return JSONResponse(
            status_code=500,
            content={"error": "ancestry mapping failed", "detail": str(error)},
        )
