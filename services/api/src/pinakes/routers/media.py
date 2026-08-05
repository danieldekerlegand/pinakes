"""The `/api/media-assets*` and `/api/media/*` route groups — eight routes.

The cutover's seventh slice (pinakes:80 US-1), over :mod:`pinakes.media`. Two
port units in one file because they are the two halves of one surface: the
catalogued assets a curator uploads, and the reconstruction images the model
generates. It is also the first slice since the collaborative stores to carry
**writes** — a POST that appends to the live corpus and a DELETE that rewrites
it.

Three things are worth knowing before touching it:

* **`storage.invalidateCache("media")` has no counterpart, and that is
  correct.** Express memoised the asset table on its storage singleton, so a
  write had to evict it; nothing in this service caches a lexicon table
  (`lexicons/storage.py` explains why), so the next read already sees the new
  row. The absence is the port, not an omission.
* **The 500 spellings are per handler again.** All five asset routes answer
  `{message, error}`; both `/api/media/*` routes answer `{message}` alone, and
  the message they carry is the *exception's* text rather than a fixed string.
  That is what surfaces "GEMINI_API_KEY … is required" to a caller.
* **`GET /api/media-assets/{id}` cannot swallow its two siblings.** `entity/…`
  is three segments and `meta/types` is two, so Starlette's matcher separates
  them the same way Express's `:id` did. No re-registration trick is needed
  here — unlike `routers/ethnography.py`, which had to hoist a static path above
  its own wildcard.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse

from pinakes.lexicons import storage
from pinakes.media import assets, images
from pinakes.paths import lexicons_dir
from pinakes.routers import _reads

logger = logging.getLogger("pinakes.media")

router = APIRouter(tags=["media"])


def _payload(body: Any) -> dict[str, Any]:
    """``req.body ?? {}`` — anything that is not an object is no fields at all."""
    return body if isinstance(body, dict) else {}


@router.get("/api/media-assets")
def list_media_assets(request: Request) -> Any:
    """`GET /api/media-assets` — four exact filters, each skipped when blank."""
    try:
        found = assets.get_media_assets(
            storage.load_media_assets(lexicons_dir()),
            entity_type=_reads.text(request, "entity_type"),
            entity_id=_reads.text(request, "entity_id"),
            media_type=_reads.text(request, "media_type"),
            tag=_reads.text(request, "tag"),
        )
    except Exception as error:  # noqa: BLE001 - the handler's own try/catch
        return _reads.failed(
            logger, "fetching media assets", "Failed to fetch media assets", error
        )
    return {"assets": found, "count": len(found)}


@router.get("/api/media-assets/{id}")
def get_media_asset(id: str) -> Any:
    """`GET /api/media-assets/{id}` — 404 when no row carries that id."""
    try:
        asset = storage.find_by_id(storage.load_media_assets(lexicons_dir()), id)
    except Exception as error:  # noqa: BLE001
        return _reads.failed(
            logger, "fetching media asset", "Failed to fetch media asset", error
        )
    if asset is None:
        return _reads.missing("Media asset not found")
    return asset


@router.get("/api/media-assets/entity/{entityType}/{entityId}")
def media_assets_for_entity(entityType: str, entityId: str) -> Any:  # noqa: N803 - baseline params
    """`GET /api/media-assets/entity/{entityType}/{entityId}`.

    An unknown entity is an empty list, never a 404: the asset table cannot
    tell "no such entity" from "nothing illustrates it".
    """
    try:
        found = assets.get_media_assets_for_entity(
            storage.load_media_assets(lexicons_dir()), entityType, entityId
        )
    except Exception as error:  # noqa: BLE001
        return _reads.failed(
            logger,
            "fetching entity media assets",
            "Failed to fetch entity media assets",
            error,
        )
    return {"assets": found, "count": len(found)}


@router.post("/api/media-assets", status_code=201)
def add_media_asset(body: Annotated[Any, Body()] = None) -> Any:
    """`POST /api/media-assets` — validate, append, answer **201** with the row.

    The body is read rather than declared, for the reason the collaborative
    stores document: a junk body is a **400 listing the field errors**, where a
    declared model would answer 422 and name none of them.
    """
    data = _payload(body)
    errors = assets.validate(data)
    if errors:
        return JSONResponse(status_code=400, content={"errors": errors})
    try:
        return assets.add_asset(lexicons_dir(), data)
    except Exception as error:  # noqa: BLE001
        return _reads.failed(
            logger, "adding media asset", "Failed to add media asset", error
        )


@router.delete("/api/media-assets/{id}")
def delete_media_asset(id: str) -> Any:
    """`DELETE /api/media-assets/{id}` — 404 when the id matched nothing."""
    try:
        deleted = assets.delete_asset(lexicons_dir(), id)
    except Exception as error:  # noqa: BLE001
        return _reads.failed(
            logger, "deleting media asset", "Failed to delete media asset", error
        )
    if not deleted:
        return _reads.missing("Media asset not found")
    return {"message": "Media asset deleted"}


@router.get("/api/media-assets/meta/types")
def media_asset_types() -> Any:
    """The two vocabularies, in declaration order. Reads nothing off disk."""
    return {
        "entityTypes": list(assets.VALID_ENTITY_TYPES),
        "mediaTypes": list(assets.VALID_MEDIA_TYPES),
    }


@router.post("/api/media/generate")
def generate_image(body: Annotated[Any, Body()] = None) -> Any:
    """`POST /api/media/generate` — a reconstruction image, and a ledger row.

    Five fields are required by **truthiness**, so a blank description is the
    same refusal as a missing one, and the message names all five whichever is
    absent. The scene type and the style are then checked against their
    vocabularies in that order — two separate 400s, each listing its own.
    """
    data = _payload(body)
    scene_type = data.get("sceneType")
    style = data.get("style")

    if not all(
        (
            data.get("entityType"),
            data.get("entityId"),
            scene_type,
            style,
            data.get("description"),
        )
    ):
        return JSONResponse(
            status_code=400,
            content={
                "message": (
                    "Missing required fields: entityType, entityId, sceneType, "
                    "style, description"
                )
            },
        )

    if not images.validate_scene_type(scene_type):
        return JSONResponse(
            status_code=400,
            content={
                "message": (
                    "Invalid sceneType. Must be one of: city_reconstruction, "
                    "architectural, daily_life, artifact"
                )
            },
        )

    if not images.validate_style(style):
        return JSONResponse(
            status_code=400,
            content={
                "message": (
                    "Invalid style. Must be one of: realistic, illustrated, "
                    "watercolor, archaeological_sketch"
                )
            },
        )

    try:
        return images.generate_reconstruction_image(
            lexicons_dir(),
            {
                "entityType": data["entityType"],
                "entityId": data["entityId"],
                "sceneType": scene_type,
                "style": style,
                "description": data["description"],
                "timePeriod": data.get("timePeriod"),
                "region": data.get("region"),
            },
        )
    except Exception as error:  # noqa: BLE001
        # `error instanceof Error ? error.message : "Failed to generate image"` —
        # the reason reaches the caller, which is what makes a missing key
        # actionable rather than a bare 500.
        logger.exception("Error generating reconstruction image")
        return JSONResponse(status_code=500, content={"message": str(error)})


@router.get("/api/media/prompts")
def list_prompts() -> Any:
    """`GET /api/media/prompts` — the whole ledger, oldest first."""
    try:
        prompts = images.read_prompt_records(lexicons_dir())
    except Exception as error:  # noqa: BLE001
        logger.exception("Error reading prompt records")
        return JSONResponse(status_code=500, content={"message": str(error)})
    return {"prompts": prompts, "count": len(prompts)}
