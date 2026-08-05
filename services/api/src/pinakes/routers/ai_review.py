"""The `/api/ai-review` route group — the promotion leg for AI drafts.

Ported off `server/routes/ai-review.ts`. This is the one place in the service
where a review **writes to the corpus**: an approved draft is appended to its
`data/source/lexicons/*.tsv` with provenance naming both the AI source and the
human reviewer. Everything else about AI extraction — the URL extractor, the
text extractor — only ever queues.

The order inside ``PATCH`` is the contract, not an implementation detail:
validate the decision, apply the field decisions, and only then promote. A draft
that fails any of those is a **400 that wrote nothing**, so a reviewer never has
to wonder whether a rejected approval half-landed in the corpus. The record of
the review is written last, after the promotion it describes succeeded.

The lexicon write itself lives in :mod:`pinakes.contributions.ai_review`, over an
explicit directory — which is what lets the tests exercise a real promotion
against a temporary corpus instead of the live one.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from pinakes.contributions import ai_review, changelog, store
from pinakes.paths import lexicons_dir

router = APIRouter(tags=["ai-review"])

#: How many drafts one listing reads out of the queue. The baseline's number:
#: the review view is a working queue, not a paginated archive.
DRAFT_LIST_LIMIT = 1000

REVIEW_DECISIONS = ("approved", "rejected")


def _not_found(draft_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=404, content={"message": f"AI draft '{draft_id}' not found"}
    )


def _bad_request(message: str, **extra: Any) -> JSONResponse:
    return JSONResponse(status_code=400, content={"message": message, **extra})


@router.get("/api/ai-review")
def list_drafts(status: str | None = None) -> Any:
    """AI drafts as field-level review views. Non-AI contributions are filtered
    out here rather than queried out — `aiGenerated` lives in `entityData`, and
    the queue is small enough that the honest filter beats an index."""
    page = store.queue().list(status=status, limit=DRAFT_LIST_LIMIT)
    drafts = [
        ai_review.project_draft(contribution)
        for contribution in page["contributions"]
        if ai_review.is_ai_draft(contribution)
    ]
    return {"drafts": drafts, "total": len(drafts)}


@router.get("/api/ai-review/{id}")
def get_draft(id: str) -> Any:  # noqa: A002 - the baseline path parameter
    """One draft's review view. A contribution that is not an AI draft is a 404
    here — this surface is about AI provenance, and a hand-written contribution
    has none to review."""
    contribution = store.queue().get(id)
    if contribution is None or not ai_review.is_ai_draft(contribution):
        return _not_found(id)
    return ai_review.project_draft(contribution)


@router.patch("/api/ai-review/{id}")
def review_draft(
    id: str,  # noqa: A002 - the baseline path parameter
    body: Annotated[dict[str, Any] | None, Body()] = None,
) -> Any:
    """Record per-field decisions and, on approval, promote into the corpus."""
    payload = body or {}
    decision = payload.get("decision")
    if decision not in REVIEW_DECISIONS:
        return _bad_request("decision must be 'approved' or 'rejected'")
    reviewer = payload.get("reviewer")
    if not isinstance(reviewer, str) or not reviewer.strip():
        return _bad_request("reviewer is required")

    contributions = store.queue()
    contribution = contributions.get(id)
    if contribution is None or not ai_review.is_ai_draft(contribution):
        return _not_found(id)

    fields = payload.get("fields")
    try:
        applied = ai_review.apply_field_reviews(
            contribution, fields if isinstance(fields, dict) else None
        )
    except ai_review.AiReviewError as exc:
        return _bad_request(str(exc))

    note = payload.get("note", ...)

    if decision == "rejected":
        updated = contributions.record_ai_review(
            id,
            status="rejected",
            reviewer=reviewer,
            field_reviews=applied.field_reviews,
            note=note,
        )
        return ai_review.project_draft(updated) if updated is not None else None

    entity_type = str(contribution.get("entityType"))
    errors = ai_review.validate_accepted_draft(entity_type, applied.accepted_data)
    if errors:
        return _bad_request("Cannot approve draft", errors=errors)

    ai_source = contribution.get("aiSource") or "unknown"
    try:
        promotion = ai_review.promote_contribution(
            contribution_id=str(contribution.get("id")),
            entity_type=entity_type,
            accepted_data=applied.accepted_data,
            reviewer=reviewer,
            ai_source=str(ai_source),
            overall_confidence=contribution.get("confidence"),
            lexicons_dir=lexicons_dir(),
            now=store.iso_now(),
        )
    except ai_review.AiReviewError as exc:
        return _bad_request(str(exc))

    # A promotion always appends a new row, so the change type is "added".
    changelog.record_change(
        {
            "domain": entity_type,
            "changeType": "added",
            "targetFile": promotion["file"],
            "targetId": promotion["targetId"],
            "entityName": _accepted_name(applied.accepted_data),
            "source": "ai-review",
            "sourceUrl": contribution.get("aiSource"),
            "contributionId": contribution.get("id"),
            "reviewer": reviewer,
            "confidence": contribution.get("confidence"),
            "summary": (
                f"Promoted AI draft ({ai_source}) into {promotion['file']}"
            ),
        }
    )

    updated = contributions.record_ai_review(
        id,
        status="approved",
        reviewer=reviewer,
        field_reviews=applied.field_reviews,
        promotion=promotion,
        note=note,
    )
    return ai_review.project_draft(updated) if updated is not None else None


def _accepted_name(accepted_data: dict[str, Any]) -> Any:
    name = accepted_data.get("name")
    return name if isinstance(name, str) else None
