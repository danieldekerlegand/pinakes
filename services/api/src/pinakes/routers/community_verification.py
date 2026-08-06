"""The multi-confirmation flow — `POST /api/contributions/{id}/confirm` and
`GET /api/contributions/{id}/verification`.

The port of the two handlers `server/routes/community-verification.ts` kept when
pinakes:61 US-2 took the three `/api/stewardship*` routes out of the same file.
They were split off deliberately: stewardship is about who has claimed what, and
these two are about the contribution queue — a different port unit, and the last
third of that group.

The split worked because **both servers read one `stewards.json`**. That is no
longer load-bearing after this lands: the confirm handler's steward lookup is
now :func:`pinakes.collab.stewardship.is_steward_of` over the same roster
:mod:`pinakes.routers.stewardship` writes, in this process.

Three things the port preserves:

* **Four ways to be refused, and they are not interchangeable.** A missing
  reviewer is a **400**, an unknown contribution a **404**, a contributor
  confirming their own work a **400** (with ``reason: "self"``), and a reviewer
  confirming twice a **409**. The last two carry the *current* verification
  state, so a client that raced another reviewer can render the outcome rather
  than just the refusal.
* **The domain is resolved per request, from the contribution.** It is not
  stored on the record and it is not a query parameter — a contribution's domain
  is a reading of its `entityData`, so a steward's claim takes effect on the next
  confirmation without anything being migrated.
* **The verification read is unguarded and never mutates.** It is the same
  summary the confirm answers with, recomputed from ``baseConfidence`` — which
  is why calling it twice cannot ramp anything.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from pinakes.collab import stewardship, verification
from pinakes.contributions import store
from pinakes.routers._owner import json_body

router = APIRouter(tags=["contributions"])

#: The request body, read rather than declared. Express validated ``req.body?``
#: by hand, so a body that is not an object is an *empty* one and reaches the
#: handler's own 400 — a declared model would answer 422, which is a different
#: contract. Same rule :mod:`pinakes.routers.collections` follows.
Body = Annotated[Any, Depends(json_body)]

#: ``result.reason`` → status code. A self-confirmation is the client's mistake
#: about *who* is asking (400); a duplicate is a conflict with a request that
#: already succeeded (409).
REFUSAL_STATUS = {"self": 400, "duplicate": 409}

REFUSAL_MESSAGE = {
    "self": "A contributor cannot confirm their own contribution",
    "duplicate": "This reviewer has already confirmed this contribution",
}


def _not_found(contribution_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={"message": f"Contribution '{contribution_id}' not found"},
    )


@router.post("/api/contributions/{id}/confirm")
def confirm(id: str, body: Body) -> Any:  # noqa: A002 - the baseline path parameter
    """Record an independent confirmation from a distinct reviewer."""
    payload = body if isinstance(body, dict) else {}
    raw_reviewer = payload.get("reviewer")
    reviewer = (
        verification.js_trim(raw_reviewer) if isinstance(raw_reviewer, str) else ""
    )
    if not reviewer:
        return JSONResponse(
            status_code=400, content={"message": "reviewer is required"}
        )

    queue = store.queue()
    contribution = queue.get(id)
    if contribution is None:
        return _not_found(id)

    domain = stewardship.resolve_contribution_domain(contribution)
    is_steward = stewardship.store().is_steward(reviewer, domain)

    note = payload.get("note")
    result = queue.confirm(
        id,
        reviewer=reviewer,
        is_steward=is_steward,
        domain=domain,
        note=note if isinstance(note, str) else None,
        config=verification.load_verification_config(),
    )
    # Unreachable in practice — the record was read a moment ago — but the
    # TypeScript answers the same 404 rather than assuming it, and a queue two
    # processes write is exactly where that assumption would not hold.
    if result is None:
        return _not_found(id)

    if not result.added:
        reason = result.reason or "duplicate"
        return JSONResponse(
            status_code=REFUSAL_STATUS.get(reason, 409),
            content={
                "message": REFUSAL_MESSAGE.get(reason, REFUSAL_MESSAGE["duplicate"]),
                "reason": reason,
                "domain": domain,
                "verification": result.verification,
            },
        )

    return {
        "contribution": result.contribution,
        "verification": result.verification,
        "domain": domain,
        "confirmedAsSteward": is_steward,
    }


@router.get("/api/contributions/{id}/verification")
def read_verification(id: str) -> Any:  # noqa: A002 - the baseline path parameter
    """The current verification state of one contribution."""
    contribution = store.queue().get(id)
    if contribution is None:
        return _not_found(id)

    raw_confirmations = contribution.get("confirmations")
    confirmations: list[verification.Confirmation] = (
        list(raw_confirmations) if isinstance(raw_confirmations, list) else []
    )
    attribution = contribution.get("stewardAttribution")

    config = verification.load_verification_config()
    return {
        "id": contribution.get("id"),
        "domain": stewardship.resolve_contribution_domain(contribution),
        "status": contribution.get("status"),
        "config": config,
        "verification": verification.summarize_verification(
            verification.base_confidence(contribution), confirmations, config
        ),
        "stewardAttribution": attribution if attribution is not None else [],
    }
