"""The `/api/relationships/*` route group — authoring and proposing edges.

Ported off `server/routes/relationship-edge.ts` and
`server/routes/relationship-suggestions.ts` (pinakes:65 US-2). One file because
the two halves are one loop: `/suggestions` **proposes** an edge and `/edge`
**accepts** one, and both read the same existing-edge set — the corpus's
canonical edges (:mod:`pinakes.lexicons.canonical_edges`) plus what is already
queued.

Three things the port keeps deliberately:

* **A duplicate is 409, not 400.** The client distinguishes them: a duplicate is
  something the contributor can act on ("that link already exists"), where a
  validation error is something they must fix. `validation.duplicate` is what
  carries it, and it is on the 409 body too.
* **The existing-edge set spans corpus *and* queue, at any status.** A pending —
  or even rejected — duplicate is still a collision worth flagging; two
  contributors authoring the same edge an hour apart is the case this exists for.
* **The suggestion loaders never 500 on a thin corpus.** A missing lexicons
  directory degrades to "no exclusions", so the worst case is a suggestion the
  contributor has to reject rather than an endpoint that is down.
"""

from __future__ import annotations

import logging
import math
from typing import Annotated, Any

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from pinakes.authoring import candidates, relationship_edge, suggestions
from pinakes.authoring.relationship_edge import ExistingEdge
from pinakes.authoring.suggestions import SuggestionEntity
from pinakes.contributions import store
from pinakes.paths import lexicons_dir

logger = logging.getLogger("pinakes.relationships")

router = APIRouter(tags=["relationship-edge"])

#: The page size the dedup read asks the queue for. Express passed `100000` to
#: mean "everything"; the number is the contract only in that it must exceed any
#: plausible queue.
QUEUE_SCAN_LIMIT = 100000


def _number_param(value: Any) -> float | None:
    """``Number(value)`` with a non-finite result reported as absent.

    Express read `?limit=` through `Number(...)` + `Number.isFinite(...)`, so a
    stale bookmark carrying `?limit=abc` fell back to the default rather than
    failing. A declared `int` param would answer 422 — a different contract.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    if not isinstance(value, str):
        return None
    try:
        parsed = float(value)
    except ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def _collect_existing_edges() -> list[ExistingEdge]:
    """The relationships already present: the corpus's edges plus the queue's."""
    existing = candidates.load_existing_edges(lexicons_dir())
    queued = store.queue().list(
        entity_type="relationship", limit=float(QUEUE_SCAN_LIMIT)
    )
    for contribution in queued["contributions"]:
        data = contribution.get("entityData")
        if not isinstance(data, dict):
            continue
        source_id = data.get("sourceId")
        target_id = data.get("targetId")
        relationship_type = data.get("relationshipType")
        if (
            isinstance(source_id, str)
            and isinstance(target_id, str)
            and isinstance(relationship_type, str)
        ):
            existing.append(
                ExistingEdge(
                    source_id=source_id,
                    target_id=target_id,
                    relationship_type=relationship_type,
                )
            )
    return existing


@router.post("/api/relationships/edge", status_code=201)
def submit_relationship_edge(body: Annotated[Any, Body()] = None) -> Any:
    """Queue an authored edge. 201 queued, 409 duplicate, 400 otherwise."""
    try:
        existing = _collect_existing_edges()
        validation = relationship_edge.validate_relationship_edge(body, existing)
        if not validation.valid:
            return JSONResponse(
                status_code=409 if validation.duplicate else 400,
                content={
                    "message": (
                        "Duplicate relationship"
                        if validation.duplicate
                        else "Invalid relationship"
                    ),
                    "errors": validation.errors,
                    "warnings": validation.warnings,
                    "duplicate": validation.duplicate,
                },
            )

        result = store.queue().submit(
            relationship_edge.relationship_edge_to_contribution(body)
        )
        if result.contribution is None:
            return JSONResponse(
                status_code=400,
                content={
                    "message": "Invalid relationship",
                    "errors": result.validation.errors,
                    "warnings": result.validation.warnings,
                },
            )

        return {
            "contribution": result.contribution,
            "relationship": relationship_edge.relationship_summary(body),
            "warnings": [*validation.warnings, *result.validation.warnings],
        }
    except Exception:  # noqa: BLE001 - the Express catch-all
        logger.exception("Error submitting relationship")
        return JSONResponse(
            status_code=500, content={"message": "Failed to submit relationship"}
        )


@router.get("/api/relationships/edge/options")
def relationship_edge_options() -> Any:
    """The canonical vocabulary plus the existing triples, so the UI pre-empts a 409."""
    try:
        return {
            "relationshipTypes": [
                dict(option) for option in relationship_edge.RELATIONSHIP_TYPE_OPTIONS
            ],
            "existingEdges": relationship_edge.existing_edges_payload(
                _collect_existing_edges()
            ),
        }
    except Exception:  # noqa: BLE001 - the Express catch-all
        logger.exception("Error loading relationship options")
        return JSONResponse(
            status_code=500,
            content={"message": "Failed to load relationship options"},
        )


def _suggestion_response(
    source: SuggestionEntity, pool: list[SuggestionEntity], options: dict[str, Any]
) -> dict[str, Any]:
    ranked = suggestions.suggest_relationships(
        source, pool, candidates.load_existing_edges(lexicons_dir()), options
    )
    return {
        "source": {
            "id": source.id,
            "name": source.name,
            "entityType": source.entity_type,
        },
        "count": len(ranked),
        "suggestions": ranked,
    }


@router.get("/api/relationships/suggestions")
def relationship_suggestions(
    entityId: str | None = None,  # noqa: N803 - the baseline query parameter
    entityType: str | None = None,  # noqa: N803 - the baseline query parameter
    limit: str | None = None,
    minConfidence: str | None = None,  # noqa: N803 - the baseline query parameter
) -> Any:
    """Suggestions for an entity already in the corpus. 400 no id, 404 unknown."""
    try:
        entity_id = entityId.strip() if isinstance(entityId, str) else ""
        entity_type = entityType.strip() if isinstance(entityType, str) else ""
        if not entity_id:
            return JSONResponse(
                status_code=400, content={"message": "entityId is required"}
            )

        pool = candidates.load_candidates(lexicons_dir())
        source = next(
            (
                entity
                for entity in pool
                if entity.id == entity_id
                and (not entity_type or entity.entity_type == entity_type)
            ),
            None,
        )
        if source is None:
            qualifier = f' and type "{entity_type}"' if entity_type else ""
            return JSONResponse(
                status_code=404,
                content={
                    "message": f'No entity found with id "{entity_id}"{qualifier}'
                },
            )

        return _suggestion_response(
            source,
            pool,
            {
                "limit": _number_param(limit),
                "minConfidence": _number_param(minConfidence),
            },
        )
    except Exception:  # noqa: BLE001 - the Express catch-all
        logger.exception("Error computing relationship suggestions")
        return JSONResponse(
            status_code=500,
            content={"message": "Failed to compute relationship suggestions"},
        )


@router.post("/api/relationships/suggestions")
def relationship_suggestions_for_draft(body: Annotated[Any, Body()] = None) -> Any:
    """Suggestions for an entity being authored — one not in the corpus yet."""
    try:
        payload = body if isinstance(body, dict) else {}
        identifier = payload.get("id")
        name = payload.get("name")
        entity_type = payload.get("entityType")
        if not (
            isinstance(identifier, str)
            and identifier.strip()
            and isinstance(name, str)
            and name.strip()
            and isinstance(entity_type, str)
            and entity_type.strip()
        ):
            return JSONResponse(
                status_code=400,
                content={"message": "id, name, and entityType are required"},
            )

        language_ids = payload.get("languageIds")
        source = SuggestionEntity(
            id=identifier.strip(),
            name=name.strip(),
            entity_type=entity_type.strip(),
            language_ids=language_ids if isinstance(language_ids, list) else [],
            coordinates=payload.get("coordinates") or None,
            time_start=payload.get("timeStart"),
            time_end=payload.get("timeEnd"),
            region=payload.get("region") or None,
        )

        return _suggestion_response(
            source,
            candidates.load_candidates(lexicons_dir()),
            {
                "limit": _number_param(payload.get("limit")),
                "minConfidence": _number_param(payload.get("minConfidence")),
            },
        )
    except Exception:  # noqa: BLE001 - the Express catch-all
        logger.exception("Error computing relationship suggestions")
        return JSONResponse(
            status_code=500,
            content={"message": "Failed to compute relationship suggestions"},
        )
