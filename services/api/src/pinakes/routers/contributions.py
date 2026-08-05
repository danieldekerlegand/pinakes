"""The `/api/contributions` route group — the public contribution queue.

Ported off `server/routes/contributions.ts` (docs/UNIFIED-PROJECT-PLAN.md §7).
The same adapter discipline as :mod:`pinakes.routers.graph`: parse the query
string the way Express did, call one function on
:mod:`pinakes.contributions.store`, map the outcome onto a status code. No queue
logic lives in this file.

What the port preserves deliberately:

* **A submission never touches the dataset.** It is validated and queued; the
  live corpus only changes when a reviewer approves an AI draft
  (:mod:`pinakes.routers.ai_review`). That is the premise of the whole surface,
  and it is why a 201 here is not a write anywhere else.
* **Route order.** ``/export``, ``/stats`` and ``/entity/...`` are declared
  before ``/{id}``, because Starlette resolves first-match-wins just as Express
  does — declared the other way round, ``GET /api/contributions/stats`` would
  look up a contribution whose id is the literal string "stats".
* **Junk pagination is not an error.** Express reached ``limit``/``offset``
  through ``parseInt``, so ``?limit=abc`` yielded ``NaN`` and, through
  ``Array.slice``, an empty page. A declared ``int`` param would answer 422
  instead, which is a different contract — so they are parsed by hand
  (:func:`~pinakes.contributions.store.parse_int_js`).
* **The unfiltered filters.** ``?status=nonsense`` matches nothing rather than
  400ing; the client's filter chips are free text on the wire.

Two routes registered by the same Express file are **not** here.
``GET /api/openapi.json`` is its own port unit (it publishes the spec for the
whole Express surface, most of which is still Express's). ``POST
/api/contributions/{id}/confirm`` and ``GET .../verification`` belong to the
community-verification unit. Both keep answering 501 until their own port lands
— see ``/api/_parity/coverage``.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse, PlainTextResponse

from pinakes.contributions import changelog, store

router = APIRouter(tags=["contributions"])

#: Review decisions the queue accepts. Anything else is a 400.
REVIEW_DECISIONS = ("approved", "rejected")

#: Actions that change the dataset and so are worth an audit line. A flag is a
#: report about a record, not an edit to one, so it is not logged.
LOGGED_ACTIONS = {"add": "added", "edit": "modified"}


def _not_found(contribution_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={"message": f"Contribution '{contribution_id}' not found"},
    )


@router.post("/api/contributions", status_code=201)
def submit(body: Annotated[dict[str, Any] | None, Body()] = None) -> Any:
    """Submit a contribution. 400 with every validation error, or 201 queued."""
    result = store.queue().submit(body or {})
    if not result.validation.valid:
        return JSONResponse(
            status_code=400,
            content={
                "message": "Validation failed",
                "errors": result.validation.errors,
                "warnings": result.validation.warnings,
            },
        )
    return {
        "contribution": result.contribution,
        "warnings": result.validation.warnings,
    }


@router.get("/api/contributions")
def list_contributions(
    status: str | None = None,
    entityType: str | None = None,  # noqa: N803 - the baseline query parameter
    action: str | None = None,
    limit: str | None = None,
    offset: str | None = None,
) -> Any:
    """List the queue, filtered and paginated. Always 200."""
    return store.queue().list(
        status=status,
        entity_type=entityType,
        action=action,
        limit=store.parse_int_js(limit),
        offset=store.parse_int_js(offset),
    )


@router.get("/api/contributions/export")
def export_contributions() -> PlainTextResponse:
    """The whole queue as a CSV attachment."""
    return PlainTextResponse(
        content=store.queue().export_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=contributions.csv"},
    )


@router.get("/api/contributions/stats")
def stats() -> Any:
    """Queue aggregate backing the review dashboard.

    The one route in this group with a recorded fixture
    (`contracts/parity/fixtures/get-contributions-stats.json`), so it is what
    grades the port — and it is also still served by Express, because that
    recording is replayed against the baseline app too.
    """
    return store.queue().stats()


@router.get("/api/contributions/entity/{entityType}/{entityId}")
def by_entity(entityType: str, entityId: str) -> Any:  # noqa: N803 - baseline params
    """Approved contributions attached to one entity."""
    return {"contributions": store.queue().get_by_entity(entityType, entityId)}


@router.get("/api/contributions/{id}")
def get_contribution(id: str) -> Any:  # noqa: A002 - the baseline path parameter
    """One contribution by id. 404 when the queue has no such record."""
    contribution = store.queue().get(id)
    if contribution is None:
        return _not_found(id)
    return contribution


@router.patch("/api/contributions/{id}/review")
def review(
    id: str,  # noqa: A002 - the baseline path parameter
    body: Annotated[dict[str, Any] | None, Body()] = None,
) -> Any:
    """Approve or reject a contribution, and log an approved edit.

    The changelog write is best-effort by design: an audit line that cannot be
    written must not cost the reviewer their decision, so a failure is logged and
    swallowed (`pinakes.contributions.changelog`).
    """
    payload = body or {}
    decision = payload.get("decision")
    if decision not in REVIEW_DECISIONS:
        return JSONResponse(
            status_code=400,
            content={"message": "decision must be 'approved' or 'rejected'"},
        )

    note = payload.get("note")
    contribution = store.queue().review(id, decision, note)
    if contribution is None:
        return _not_found(id)

    change_type = LOGGED_ACTIONS.get(str(contribution.get("action")))
    if decision == "approved" and change_type is not None:
        changelog.record_change(
            {
                "domain": contribution.get("entityType"),
                "changeType": change_type,
                "targetId": contribution.get("entityId"),
                "entityName": _entity_name(contribution),
                "source": "contribution",
                "sourceUrl": _first_source_url(contribution),
                "contributionId": contribution.get("id"),
                "reviewer": contribution.get("reviewer"),
                "confidence": contribution.get("confidence"),
                "fields": _edited_fields(contribution),
                "summary": note,
            }
        )

    return contribution


def _entity_name(contribution: dict[str, Any]) -> Any:
    entity_data = contribution.get("entityData")
    name = entity_data.get("name") if isinstance(entity_data, dict) else None
    return name if isinstance(name, str) else None


def _first_source_url(contribution: dict[str, Any]) -> Any:
    sources = contribution.get("sources")
    if isinstance(sources, list) and sources and isinstance(sources[0], dict):
        return sources[0].get("url")
    return None


def _edited_fields(contribution: dict[str, Any]) -> list[str] | None:
    field = contribution.get("fieldName")
    return [field] if isinstance(field, str) and field else None
