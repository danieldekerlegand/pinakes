"""The `/api/timeline/event` route group — authoring on the temporal axis.

Ported off `server/routes/timeline-event.ts` (pinakes:65 US-2). Two routes: a
POST that validates an authored event/period and queues it, and a GET publishing
the vocabulary the client's authoring form needs.

**`POST /api/timeline/event` also still answers on Express**, the
`GET /api/citations` precedent. Its `post-timeline-event-invalid` fixture is
replayed against that app by `contracts/parity/parity.test.ts`, so retiring the
handler there would break the baseline this port is graded against. It is safe
for a stronger reason than usual: the recorded case is a **validation
rejection** — the request is refused before either backend touches the
contribution queue, so the double-served path writes nothing at all.

The body is read, not declared: Express validated `req.body` by hand and
answers a **400 listing every error**, where a declared FastAPI model would
answer 422 (same family as `routers/collections._payload`). That 400 body *is*
the recorded contract.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from pinakes.authoring import timeline_event
from pinakes.contributions import store

logger = logging.getLogger("pinakes.timeline")

router = APIRouter(tags=["timeline-event"])


@router.post("/api/timeline/event", status_code=201)
def submit_timeline_event(body: Annotated[Any, Body()] = None) -> Any:
    """Queue an authored event/period. 201 queued, or 400 with the errors."""
    try:
        validation = timeline_event.validate_timeline_event(body)
        if not validation.valid:
            return JSONResponse(
                status_code=400,
                content={
                    "message": "Invalid timeline entry",
                    "errors": validation.errors,
                    "warnings": validation.warnings,
                },
            )

        result = store.queue().submit(
            timeline_event.timeline_event_to_contribution(body)
        )
        if result.contribution is None:
            return JSONResponse(
                status_code=400,
                content={
                    "message": "Invalid timeline entry",
                    "errors": result.validation.errors,
                    "warnings": result.validation.warnings,
                },
            )

        return {
            "contribution": result.contribution,
            "warnings": [*validation.warnings, *result.validation.warnings],
        }
    except Exception:  # noqa: BLE001 - the Express catch-all
        logger.exception("Error submitting timeline entry")
        return JSONResponse(
            status_code=500,
            content={"message": "Failed to submit timeline entry"},
        )


@router.get("/api/timeline/event/options")
def timeline_event_options() -> Any:
    """The kinds, lanes, magnitudes and year bounds the authoring form needs."""
    return timeline_event.options()
