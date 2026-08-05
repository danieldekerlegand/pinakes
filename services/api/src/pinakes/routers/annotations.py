"""The `/api/annotations` route group — a reader's own notes on an entity.

Ported off `server/routes/annotations.ts` (docs/UNIFIED-PROJECT-PLAN.md §7).
The same adapter shape as :mod:`pinakes.routers.collections`, which it was
written beside; what is specific to this group:

* **Every response is a projection.** List, get, create and patch all answer
  through :func:`~pinakes.collab.annotations.to_view`, so no owner id leaves the
  process and the client is told which notes it may edit. A public note authored
  by a stranger is served to anyone reading that entity, which is what makes the
  projection the privacy boundary rather than a convenience.
* **The list is keyed by entity, not by note.** ``GET /api/annotations`` without
  an entity is a **400**, not an unfiltered dump of everyone's notes — the
  surface has no "all annotations" read, deliberately.
* **`?entity=` or `?type=&id=`.** Two spellings of the same lookup: the client
  holds a stable id in some places and a ref in others, and both must resolve to
  the same `cs:<type>:<id>` key.

The store is imported **under an alias** (`notes`), and it has to be: every
module here opens with ``from __future__ import annotations``, which binds the
plain name to a ``__future__._Feature``. Rebinding it works at runtime and is a
hard error under strict mypy ("imported name has type Module, local name has
type _Feature"), which is the good outcome — the runtime failure it stands in
for is an ``AttributeError`` on every route in this file. See also the warning in
:mod:`pinakes.collab`, which is the same collision one level up.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from pinakes.collab import annotations as notes
from pinakes.collab.entities import VISIBILITIES, stable_entity_id
from pinakes.routers._owner import json_body, resolve_owner

logger = logging.getLogger("pinakes.annotations")

router = APIRouter(tags=["annotations"])

#: The soft owner id every handler is scoped by. See :mod:`pinakes.routers._owner`.
Owner = Annotated[str, Depends(resolve_owner)]

#: The parsed request body, or ``None`` — also where a `DELETE` carries its owner.
Body = Annotated[Any, Depends(json_body)]


def _not_found(annotation_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={"error": "Not found", "detail": f"No annotation {annotation_id}"},
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
    """The patch, filtered to the keys the route accepts (wrong types dropped)."""
    patch: dict[str, Any] = {}
    if isinstance(body.get("body"), str):
        patch["body"] = body["body"]
    if body.get("visibility") in VISIBILITIES:
        patch["visibility"] = body["visibility"]
    return patch


def _resolve_stable_id(
    entity: str | None,
    type: str | None,  # noqa: A002 - the baseline query parameter
    id: str | None,  # noqa: A002 - the baseline query parameter
) -> str | None:
    """The entity key from ``?entity=`` or ``?type=&id=``. ``None`` when neither."""
    if entity is not None and entity.strip() != "":
        return entity.strip()
    if type is not None and type.strip() != "" and id is not None and id.strip() != "":
        return stable_entity_id({"type": type.strip(), "id": id.strip()})
    return None


@router.get("/api/annotations")
async def list_annotations(
    owner: Owner,
    entity: str | None = None,
    type: str | None = None,  # noqa: A002 - the baseline query parameter
    id: str | None = None,  # noqa: A002 - the baseline query parameter
) -> Any:
    """The notes on one entity the caller may see: their own, plus public others'."""
    stable_id = _resolve_stable_id(entity, type, id)
    if stable_id is None:
        return JSONResponse(
            status_code=400,
            content={
                "error": "invalid entity",
                "errors": ["entity (or type+id) is required"],
            },
        )
    try:
        visible = notes.store().list_for_entity(stable_id, owner)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("listing annotations", error)
    views = [notes.to_view(record, owner) for record in visible]
    return {"annotations": views, "total": len(views)}


@router.post("/api/annotations", status_code=201)
async def create_annotation(owner: Owner, body: Body) -> Any:
    """Create a note on an entity. Private unless the payload says otherwise."""
    payload = _payload(body)
    validation = notes.validate_annotation_input(payload)
    if not validation.valid:
        return JSONResponse(
            status_code=400,
            content={"error": "invalid annotation", "errors": validation.errors},
        )
    try:
        created = notes.store().create(payload, owner)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("creating annotation", error)
    return {"annotation": notes.to_view(created, owner)}


@router.get("/api/annotations/{id}")
async def get_annotation(id: str, owner: Owner) -> Any:  # noqa: A002 - baseline param
    """One note. 404 when unknown, 403 when it is someone else's private note."""
    try:
        annotation = notes.store().get(id)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("loading annotation", error)
    if annotation is None:
        return _not_found(id)
    if not notes.can_view(annotation, owner):
        return _forbidden("This annotation is private")
    return {"annotation": notes.to_view(annotation, owner)}


@router.patch("/api/annotations/{id}")
async def update_annotation(
    id: str,  # noqa: A002 - the baseline path parameter
    owner: Owner,
    body: Body,
) -> Any:
    """Edit the text, or share it by flipping `visibility` to public. Owner only."""
    patch = _normalize_patch(_payload(body))
    if "body" in patch and patch["body"].strip() == "":
        return JSONResponse(
            status_code=400,
            content={"error": "invalid annotation", "errors": ["body cannot be empty"]},
        )
    try:
        updated = notes.store().update(id, patch, owner)
    except notes.AnnotationAccessError as error:
        return _forbidden(error.message)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("updating annotation", error)
    if updated is None:
        return _not_found(id)
    return {"annotation": notes.to_view(updated, owner)}


@router.delete("/api/annotations/{id}")
async def delete_annotation(
    id: str,  # noqa: A002 - the baseline path parameter
    owner: Owner,
    body: Body,
) -> Any:
    """Delete a note. Owner only. ``body`` is where a `DELETE` carries its owner."""
    del body
    try:
        removed = notes.store().remove(id, owner)
    except notes.AnnotationAccessError as error:
        return _forbidden(error.message)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("deleting annotation", error)
    if not removed:
        return _not_found(id)
    return {"ok": True, "id": id}
