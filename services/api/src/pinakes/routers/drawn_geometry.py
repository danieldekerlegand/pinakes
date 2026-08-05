"""The `/api/map/drawn-geometry` route group — authoring on the map.

Ported off `server/routes/drawn-geometry.ts` (pinakes:65 US-2). A polygon or
line drawn in the client lands in the contribution review queue; it never writes
a geometry TSV, which is why a 201 here changes nothing a map renders yet.

Neither route carries a recorded fixture, so both are retired to 501 on Express.
The 400 body is still hand-built rather than declared — a FastAPI model would
answer 422, and this group's client (`BoundaryDrawingPanel`) renders the
`errors` array.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from pinakes.authoring import drawn_geometry
from pinakes.contributions import store

logger = logging.getLogger("pinakes.drawn-geometry")

router = APIRouter(tags=["drawn-geometry"])


@router.post("/api/map/drawn-geometry", status_code=201)
def submit_drawn_geometry(body: Annotated[Any, Body()] = None) -> Any:
    """Queue a drawn geometry. 201 queued, or 400 with the errors."""
    try:
        validation = drawn_geometry.validate_drawn_geometry(body)
        if not validation.valid:
            return JSONResponse(
                status_code=400,
                content={
                    "message": "Invalid drawn geometry",
                    "errors": validation.errors,
                    "warnings": validation.warnings,
                },
            )

        result = store.queue().submit(
            drawn_geometry.drawn_geometry_to_contribution(body)
        )
        if result.contribution is None:
            return JSONResponse(
                status_code=400,
                content={
                    "message": "Invalid drawn geometry",
                    "errors": result.validation.errors,
                    "warnings": result.validation.warnings,
                },
            )

        return {
            "contribution": result.contribution,
            "warnings": [*validation.warnings, *result.validation.warnings],
        }
    except Exception:  # noqa: BLE001 - the Express catch-all
        logger.exception("Error submitting drawn geometry")
        return JSONResponse(
            status_code=500,
            content={"message": "Failed to submit drawn geometry"},
        )


@router.get("/api/map/drawn-geometry/targets")
def drawn_geometry_targets() -> Any:
    """The valid drawing targets, for the client's target selector."""
    return drawn_geometry.targets()
