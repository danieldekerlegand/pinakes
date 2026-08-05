"""The `/api/citations` route group — an academic citation for one entity.

Ported off `server/routes/citations.ts` (docs/UNIFIED-PROJECT-PLAN.md §7). The
rendering is :mod:`pinakes.collab.citations` and the corpus lookup is
:mod:`pinakes.collab.citable`; what lives here is the HTTP wiring — resolve a
domain, pick a format, stream the result as an attachment.

``GET /api/citations`` is one of the few ported routes that **also keeps
answering on Express**, because its recording
(`contracts/parity/fixtures/get-citations-index.json`) is replayed against the
baseline app: a baseline that stops reproducing its own fixture is no longer a
baseline. The detail route below is retired over there.

What the port preserves deliberately:

* **Three different refusals.** An unknown *domain* is 404 and lists the domains
  that do exist; an unknown *format* is 400 and lists the formats; an unknown
  *id* is a bare 404. A client can tell "you asked for the wrong thing" from
  "there is no such thing" without parsing prose.
* **Missing sources are never a 500.** An entity with no `sources[]` still
  renders — the record entry citing the pinakes record itself is always there.
  That is the whole reason the generator leads with one.
* **The entity URL is derived from the request.** A citation downloaded from a
  deployment points back at *that* deployment, honouring `x-forwarded-proto` so
  it says `https` behind a terminating proxy.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from pinakes.collab import citable, citations
from pinakes.paths import lexicons_dir

logger = logging.getLogger("pinakes.citations")

router = APIRouter(tags=["citations"])

#: The format a request that names none gets. BibTeX is what the client's
#: "Cite" button copies, so it is the one worth defaulting to.
DEFAULT_FORMAT = "bibtex"


def _origin(request: Request) -> str:
    """``https://host`` for the request, or ``""`` when there is no host header.

    `x-forwarded-proto` wins over the connection's own scheme and is read as a
    comma-separated list, first entry, because a chain of proxies appends rather
    than replaces. Without a host there is no absolute URL to build, and the
    citation simply carries none.
    """
    forwarded = request.headers.get("x-forwarded-proto")
    scheme = forwarded.split(",")[0] if forwarded else request.url.scheme
    host = request.headers.get("host") or ""
    return f"{scheme}://{host}" if host else ""


@router.get("/api/citations")
def citation_index() -> Any:
    """The self-documenting contract: which domains, and which formats."""
    return {
        "domains": list(citable.DOMAINS),
        "formats": list(citations.CITATION_FORMATS),
    }


@router.get("/api/citations/{domain}/{id}")
def export_citation(
    domain: str,
    id: str,  # noqa: A002 - the baseline path parameter
    request: Request,
) -> Response:
    """Download one entity's citation in the requested format."""
    configured = citable.DOMAINS.get(domain)
    if configured is None:
        return JSONResponse(
            status_code=404,
            content={
                "error": "Unknown citation domain",
                "detail": f"No citations for {json.dumps(domain)}",
                "domains": list(citable.DOMAINS),
            },
        )

    requested = request.query_params.get("format") or DEFAULT_FORMAT
    if not citations.is_citation_format(requested):
        return JSONResponse(
            status_code=400,
            content={
                "error": "Unknown citation format",
                "detail": f"Expected one of {', '.join(citations.CITATION_FORMATS)}",
                "formats": list(citations.CITATION_FORMATS),
            },
        )

    try:
        entity = configured.fetch(id, lexicons_dir())
        if entity is None:
            return JSONResponse(
                status_code=404,
                content={
                    "error": "Not found",
                    "detail": f"No {domain} with id {json.dumps(id)}",
                },
            )
        origin = _origin(request)
        if origin:
            entity.url = f"{origin}/{configured.url_path}/{entity.id}"
        rendered = citations.render_citation(entity, requested)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        logger.exception("Unexpected error in citations/%s/%s", domain, id)
        return JSONResponse(
            status_code=500,
            content={"error": "citation export failed", "detail": str(error)},
        )

    return Response(
        content=rendered.content,
        media_type=rendered.content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{rendered.filename}"'
        },
    )
