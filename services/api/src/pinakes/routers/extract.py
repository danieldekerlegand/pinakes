"""The `/api/extract/*` route group — one paste, one reviewable draft.

Ported off `server/routes/{text-extractor,url-extractor}.ts` (pinakes:64 US-1)
over :mod:`pinakes.ingest`. Adapters, as everywhere in this package: read the
body the way Express read it, call one function, map the failure onto a status
code. The extraction itself, the drafting and the queue write live below HTTP.

* **The handlers are `def`, not `async def`, and that is load-bearing.** They
  fetch through the engine's synchronous HTTP client, so FastAPI runs them in
  its threadpool; declared `async` they would block the event loop for the whole
  process while Wikidata answers.
* **The body is read, not declared.** A junk body is a **400 naming the missing
  field** — a declared model would answer 422, which is a different contract.
  Same rule as the collaborative stores (`services/api/CLAUDE.md`).
* **Neither route writes the dataset.** Every draft enters the contribution queue
  as `pending`; the corpus only changes when a reviewer promotes it.
* **A queued draft that fails validation is reported, not dropped.** The text
  route warns per skipped entity and still answers 201 with what it queued
  (a paragraph naming five entities should not lose four to one bad row); the
  URL route has a single draft, so its failure is the whole answer — 400.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from pinakes.contributions import store
from pinakes.ingest import text_extractor, url_extractor

logger = logging.getLogger("pinakes.extract")

router = APIRouter(tags=["extract"])


def _payload(body: Any) -> dict[str, Any]:
    """``req.body ?? {}`` — anything that is not an object is no fields at all."""
    return body if isinstance(body, dict) else {}


@router.post("/api/extract/text", status_code=201)
def extract_text(body: Annotated[Any, Body()] = None) -> Any:
    """Extract entities + relationships from a pasted paragraph and queue them."""
    data = _payload(body)
    text = data.get("text")
    if not isinstance(text, str) or not text.strip():
        return JSONResponse(status_code=400, content={"message": "text is required"})

    try:
        result = text_extractor.extract_draft_from_text(
            text, text_extractor.live_deps()
        )
    except text_extractor.TextExtractionError as error:
        return JSONResponse(status_code=400, content={"message": str(error)})
    except Exception:  # noqa: BLE001 - any model/transport failure is a 502
        logger.exception("Text extraction failed")
        return JSONResponse(
            status_code=502,
            content={"message": "Failed to extract entities from the text"},
        )

    drafts = text_extractor.extraction_to_contributions(
        result,
        source_text=text,
        contributor_name=data.get("contributorName"),
        contributor_email=data.get("contributorEmail"),
    )

    queue = store.queue()
    queued: list[Any] = []
    warnings: list[str] = []
    for draft in drafts:
        submitted = queue.submit(draft)
        if submitted.contribution is not None:
            queued.append(submitted.contribution)
        else:
            name = draft.get("entityData", {}).get("name", "?")
            errors = "; ".join(submitted.validation.errors)
            warnings.append(f'Skipped "{name}": {errors}')

    return {"result": result, "contributions": queued, "warnings": warnings}


@router.post("/api/extract/url", status_code=201)
def extract_url(body: Annotated[Any, Body()] = None) -> Any:
    """Resolve a pasted Wikipedia/Wikidata URL into a draft and queue it."""
    data = _payload(body)
    url = data.get("url")
    if not url or not isinstance(url, str):
        return JSONResponse(status_code=400, content={"message": "url is required"})

    entity_type = data.get("entityType")
    if entity_type and entity_type not in url_extractor.ALLOWED_ENTITY_TYPES:
        return JSONResponse(
            status_code=400,
            content={
                "message": f"Unsupported entityType: {entity_type}",
                "allowed": list(url_extractor.ALLOWED_ENTITY_TYPES),
            },
        )

    try:
        draft = url_extractor.extract_draft_from_url(url, url_extractor.live_deps())
    except url_extractor.UrlExtractionError as error:
        return JSONResponse(status_code=400, content={"message": str(error)})
    except Exception:  # noqa: BLE001 - any transport failure is a 502
        logger.exception("URL extraction failed")
        return JSONResponse(
            status_code=502, content={"message": "Failed to resolve the source URL"}
        )

    submitted = store.queue().submit(
        url_extractor.draft_to_contribution(
            draft,
            entity_type=entity_type,
            contributor_name=data.get("contributorName"),
            contributor_email=data.get("contributorEmail"),
        )
    )
    if submitted.contribution is None:
        return JSONResponse(
            status_code=400,
            content={
                "message": "Extracted draft failed validation",
                "errors": submitted.validation.errors,
                "warnings": submitted.validation.warnings,
            },
        )

    return {
        "draft": draft,
        "contribution": submitted.contribution,
        "warnings": submitted.validation.warnings,
    }
