"""The `/api/stewardship` route group — "adopt a culture".

Ported off the stewardship third of `server/routes/community-verification.ts`
(docs/UNIFIED-PROJECT-PLAN.md §7). The other two thirds of that file —
``POST /api/contributions/{id}/confirm`` and ``GET .../verification`` — are a
**different port unit** and still answer 501; they are the multi-confirmation
flow, which is about the contribution queue rather than about who has claimed
what.

That split is only safe because the two servers share one `stewards.json`: while
the confirm route is still Express's, it reads a steward roster this service
writes, and a claim made here takes effect there on the next request.

What the port preserves deliberately:

* **Adopting twice is a 200, not a 409.** Re-adopting a domain you already hold
  is not an error, it is a no-op, and the response says so with
  ``alreadyOwned``. Only a genuinely new claim is a 201.
* **The body is read, not declared.** Express validated ``req.body?.steward``
  by hand, so a junk body is a **400 naming the missing fields**; a declared
  model would answer 422, which is a different contract.
* **`?domain=` is normalized, not matched literally.** "Roman Empire" finds what
  was adopted as "roman-empire", because the normalized key is what is stored.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from pinakes.collab import stewardship
from pinakes.routers._owner import json_body

router = APIRouter(tags=["stewardship"])

#: The parsed request body, or ``None``. See the module docstring.
Body = Annotated[Any, Depends(json_body)]


def _trimmed(body: Any, key: str) -> str:
    """A required string field, trimmed. Anything else reads as absent."""
    if isinstance(body, dict) and isinstance(body.get(key), str):
        value: str = body[key]
        return value.strip()
    return ""


def _optional_note(body: Any) -> str | None:
    """The note, untrimmed — it is prose, and only a string counts as one."""
    if isinstance(body, dict) and isinstance(body.get("note"), str):
        note: str = body["note"]
        return note
    return None


def _missing_fields() -> JSONResponse:
    return JSONResponse(
        status_code=400, content={"message": "steward and domain are required"}
    )


@router.get("/api/stewardship")
def list_stewardship(domain: str | None = None) -> Any:
    """Steward adoptions, optionally narrowed to one domain."""
    store = stewardship.store()
    adoptions = store.list_for_domain(domain) if domain else store.list_all()
    return {"adoptions": adoptions, "total": len(adoptions)}


@router.post("/api/stewardship/adopt")
def adopt(body: Body) -> Any:
    """Claim a cultural domain. 201 for a new claim, 200 for one already held."""
    steward = _trimmed(body, "steward")
    domain = _trimmed(body, "domain")
    if not steward or not domain:
        return _missing_fields()

    result = stewardship.store().adopt(
        steward=steward, domain=domain, note=_optional_note(body)
    )
    return JSONResponse(
        status_code=200 if result.already_owned else 201,
        content={"adoption": result.adoption, "alreadyOwned": result.already_owned},
    )


@router.post("/api/stewardship/release")
def release(body: Body) -> Any:
    """Drop a claim. ``released`` is false when there was nothing to drop."""
    steward = _trimmed(body, "steward")
    domain = _trimmed(body, "domain")
    if not steward or not domain:
        return _missing_fields()
    return {"released": stewardship.store().release(steward, domain)}
