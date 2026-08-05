"""The `/api/entities` + `/api/entity/{domain}/{id}` routes — canonical URLs.

Ported off `server/routes/entity-resolver.ts` (docs/UNIFIED-PROJECT-PLAN.md §7).
The registry, the descriptor and the corpus fetchers are
:mod:`pinakes.lexicons.entity`; what lives here is the HTTP wiring — pick a
domain, resolve an id, build the origin the canonical URL is absolute against.

What the port preserves deliberately:

* **Two 404s that say different things.** An unknown *domain* answers with the
  domains that do exist, so a client that guessed can correct itself; an unknown
  *id* is a bare not-found. Both are 404 rather than 400 because a renamed
  entity and a mistyped URL should read the same to a bookmark.
* **The origin comes from the request.** A canonical URL minted by a deployment
  points back at *that* deployment, honouring `x-forwarded-proto` so it says
  `https` behind a terminating proxy — the same `_origin` the citation download
  uses, for the same reason.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from pinakes.lexicons import entity
from pinakes.paths import lexicons_dir

logger = logging.getLogger("pinakes.entity_resolver")

router = APIRouter(tags=["entity"])


def _origin(request: Request) -> str:
    """``https://host`` for the request, or ``""`` when there is no host header.

    `x-forwarded-proto` wins over the connection's own scheme and is read as a
    comma-separated list, first entry, because a chain of proxies appends rather
    than replaces. With no host there is no absolute URL to build, and the
    descriptor carries the site-relative path as its `canonicalUrl`.
    """
    forwarded = request.headers.get("x-forwarded-proto")
    scheme = forwarded.split(",")[0] if forwarded else request.url.scheme
    host = request.headers.get("host") or ""
    return f"{scheme}://{host}" if host else ""


@router.get("/api/entities")
def entity_index() -> Any:
    """The self-documenting contract: every domain, plus the URL template."""
    return {
        "pathTemplate": entity.CANONICAL_PATH_TEMPLATE,
        "domains": [
            {
                "domain": domain,
                "label": spec.label,
                "entityType": spec.entity_type,
                "citable": spec.citable,
            }
            for domain, spec in entity.ENTITY_DOMAINS.items()
        ],
    }


@router.get("/api/entity/{domain}/{id}")
def resolve_entity(
    domain: str,
    id: str,  # noqa: A002 - the baseline path parameter
    request: Request,
) -> Any:
    """Resolve a permanent entity id to its canonical descriptor."""
    if not entity.is_entity_domain(domain):
        return JSONResponse(
            status_code=404,
            content={
                "error": "Unknown entity domain",
                "detail": f"No canonical URLs for {json.dumps(domain)}",
                "domains": entity.entity_domains(),
            },
        )
    try:
        record = entity.FETCHERS[domain](id, lexicons_dir())
        if record is None:
            return JSONResponse(
                status_code=404,
                content={
                    "error": "Not found",
                    "detail": f"No {domain} with id {json.dumps(id)}",
                },
            )
        return entity.describe_entity(domain, record, _origin(request))
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        logger.exception("Unexpected error in entity/%s/%s", domain, id)
        return JSONResponse(
            status_code=500,
            content={"error": "entity resolution failed", "detail": str(error)},
        )
