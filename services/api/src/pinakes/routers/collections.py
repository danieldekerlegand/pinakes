"""The `/api/collections` route group — curated, shareable groups of entities.

Ported off `server/routes/collections.ts` (docs/UNIFIED-PROJECT-PLAN.md §7).
Same adapter discipline as the groups before it: resolve the owner, call one
function on :mod:`pinakes.collab.collections`, map the outcome onto a status
code. No ownership or mutation rule lives in this file.

What the port preserves deliberately:

* **Route order.** ``/shared/{token}`` is declared before ``/{id}``, because
  Starlette resolves first-match-wins just as Express does — the other way round,
  ``GET /api/collections/shared/abc`` would look for a collection whose id is
  the literal string "shared".
* **Two ways to be refused.** A missing collection is **404** and a collection
  someone else owns is **403**, on both reads and writes. Collapsing them into
  one answer would be better privacy and a different contract: the client
  distinguishes "gone" from "not yours" in its error copy.
* **The body is read, not declared.** Express reached the payload through
  ``req.body ?? {}`` and validated it by hand, so a non-object body is a 400
  listing the missing fields. A declared FastAPI model would answer 422 instead,
  which is a different contract — so the body arrives through
  :func:`~pinakes.routers._owner.json_body`, the same read the owner is sniffed
  out of.
* **The 500 shape.** Every Express handler wrapped its work in a try/catch that
  answered ``{error, detail}``; a bare exception here would be a 502-shaped
  surprise instead. The `except` clauses are that catch, and the `detail` is the
  exception message exactly as `error.message` was.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from pinakes.collab import collections
from pinakes.collab.entities import VISIBILITIES, validate_entity_ref
from pinakes.routers._owner import json_body, resolve_owner

logger = logging.getLogger("pinakes.collections")

router = APIRouter(tags=["collections"])

#: The soft owner id every handler is scoped by. See :mod:`pinakes.routers._owner`.
Owner = Annotated[str, Depends(resolve_owner)]

#: The parsed request body, or ``None``. Reading it as a dependency is what lets
#: `DELETE` carry an owner — the client posts `{owner}` on every mutation.
Body = Annotated[Any, Depends(json_body)]


def _not_found(collection_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={"error": "Not found", "detail": f"No collection {collection_id}"},
    )


def _forbidden(detail: str) -> JSONResponse:
    return JSONResponse(
        status_code=403, content={"error": "Forbidden", "detail": detail}
    )


def _failed(label: str, error: Exception) -> JSONResponse:
    """The Express catch-all: log it, answer 500 naming the operation."""
    logger.exception("Error %s", label)
    return JSONResponse(
        status_code=500, content={"error": f"{label} failed", "detail": str(error)}
    )


def _payload(body: Any) -> dict[str, Any]:
    """``req.body ?? {}`` — anything that is not an object is an empty one."""
    return body if isinstance(body, dict) else {}


def _normalize_patch(body: dict[str, Any]) -> dict[str, Any]:
    """The metadata patch, filtered to the keys the route accepts.

    A key of the wrong type is *dropped*, not rejected — that is the Express
    behaviour, and it is why `apply_collection_update` can read the values back
    without re-validating them.
    """
    patch: dict[str, Any] = {}
    if isinstance(body.get("title"), str):
        patch["title"] = body["title"]
    if isinstance(body.get("description"), str):
        patch["description"] = body["description"]
    if body.get("visibility") in VISIBILITIES:
        patch["visibility"] = body["visibility"]
    return patch


@router.get("/api/collections")
async def list_collections(owner: Owner) -> Any:
    """The caller's own collections, newest-updated first."""
    try:
        owned = collections.store().list_for_owner(owner)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("listing collections", error)
    return {"collections": owned, "total": len(owned)}


@router.post("/api/collections", status_code=201)
async def create_collection(owner: Owner, body: Body) -> Any:
    """Create a collection. 400 with every validation error, or 201."""
    validation = collections.validate_collection_input(_payload(body))
    if not validation.valid:
        return JSONResponse(
            status_code=400,
            content={"error": "invalid collection", "errors": validation.errors},
        )
    try:
        created = collections.store().create(_payload(body), owner)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("creating collection", error)
    return {"collection": created}


@router.get("/api/collections/shared/{token}")
async def shared_collection(token: str) -> Any:
    """The owner-free share view for a token.

    No owner check and no visibility check: the unguessable token *is* the
    capability, which is what lets a private collection be shared by URL.
    Declared before ``/{id}`` — see the module docstring.
    """
    try:
        collection = collections.store().get_by_share_token(token)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("loading shared collection", error)
    if collection is None:
        return JSONResponse(
            status_code=404,
            content={
                "error": "Not found",
                "detail": "No shared collection for that token",
            },
        )
    return {"collection": collections.to_share_view(collection)}


@router.get("/api/collections/{id}")
async def get_collection(id: str, owner: Owner) -> Any:  # noqa: A002 - baseline param
    """One collection. 404 when unknown, 403 when it is someone else's private."""
    try:
        collection = collections.store().get(id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("loading collection", error)
    if collection is None:
        return _not_found(id)
    if not collections.can_view(collection, owner):
        return _forbidden("This collection is private")
    return {"collection": collection}


@router.patch("/api/collections/{id}")
async def update_collection(
    id: str,  # noqa: A002 - the baseline path parameter
    owner: Owner,
    body: Body,
) -> Any:
    """Update title / description / visibility. Owner only."""
    patch = _normalize_patch(_payload(body))
    if "title" in patch and patch["title"].strip() == "":
        return JSONResponse(
            status_code=400,
            content={
                "error": "invalid collection",
                "errors": ["title cannot be empty"],
            },
        )
    try:
        updated = collections.store().update(id, patch, owner)
    except collections.CollectionAccessError as error:
        return _forbidden(error.message)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("updating collection", error)
    if updated is None:
        return _not_found(id)
    return {"collection": updated}


@router.delete("/api/collections/{id}")
async def delete_collection(
    id: str,  # noqa: A002 - the baseline path parameter
    owner: Owner,
    body: Body,
) -> Any:
    """Delete a collection. Owner only.

    ``body`` is unused by the handler and load-bearing anyway: it is what makes
    the owner readable out of a `DELETE` payload, which is how the client sends
    it.
    """
    del body
    try:
        removed = collections.store().remove(id, owner)
    except collections.CollectionAccessError as error:
        return _forbidden(error.message)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("deleting collection", error)
    if not removed:
        return _not_found(id)
    return {"ok": True, "id": id}


@router.post("/api/collections/{id}/items")
async def add_collection_item(
    id: str,  # noqa: A002 - the baseline path parameter
    owner: Owner,
    body: Body,
) -> Any:
    """Add an entity to a collection. The whole body *is* the entity ref."""
    payload = _payload(body)
    ref_errors = validate_entity_ref(payload)
    if ref_errors:
        return JSONResponse(
            status_code=400,
            content={"error": "invalid entity ref", "errors": ref_errors},
        )
    try:
        updated = collections.store().add_item(
            id,
            {
                "type": payload.get("type"),
                "id": payload.get("id"),
                "name": payload.get("name"),
                "region": payload.get("region"),
            },
            payload.get("note"),
            owner,
        )
    except collections.CollectionAccessError as error:
        return _forbidden(error.message)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("adding collection item", error)
    if updated is None:
        return _not_found(id)
    return {"collection": updated}


@router.delete("/api/collections/{id}/items/{stableId}")
async def remove_collection_item(
    id: str,  # noqa: A002 - the baseline path parameter
    stableId: str,  # noqa: N803 - the baseline path parameter
    owner: Owner,
    body: Body,
) -> Any:
    """Remove an entity by its stable ``cs:<type>:<id>`` key. Owner only."""
    del body
    try:
        updated = collections.store().remove_item(id, stableId, owner)
    except collections.CollectionAccessError as error:
        return _forbidden(error.message)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("removing collection item", error)
    if updated is None:
        return _not_found(id)
    return {"collection": updated}
