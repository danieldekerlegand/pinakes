"""The cross-domain and genetic-linguistic correlation routes.

Ported off the inline handlers in `server/routes.ts` (pinakes:62 US-1). Three
reads, two engines: :mod:`pinakes.analytics.correlation` scores two cultural
domains against each other, :mod:`pinakes.analytics.genetic` scores haplogroups
against language families.

Two shapes of the Express handlers are reproduced rather than improved:

* **The body is read, not declared.** `POST /api/cross-domain/correlate`
  validated `req.body` by hand, so a request missing a field is a **400 naming
  all three**; a declared FastAPI model would answer 422, which is a different
  contract (same family as `routers/collections._payload`).
* **The 500 body carries `message` + `error`, not `error` + `detail`.** These
  handlers lived in `routes.ts` rather than in one of the extracted route files,
  and that half of the backend spells its failures the other way round. The
  client parses whichever the route it called uses, so the port keeps each
  route's own spelling.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from pinakes.analytics import corpus, correlation, genetic
from pinakes.paths import lexicons_dir

logger = logging.getLogger("pinakes.correlations")

router = APIRouter(tags=["cross-domain"])


def _failed(context: str, message: str, error: Exception) -> JSONResponse:
    logger.exception("Error %s", context)
    return JSONResponse(
        status_code=500, content={"message": message, "error": str(error)}
    )


def _field(body: Any, key: str) -> Any:
    """One field of a JSON body. Anything that is not an object has no fields."""
    return body.get(key) if isinstance(body, dict) else None


def _truthy(value: Any) -> bool:
    """``!!value``: a blank string is missing, but a non-string is present.

    The Express guard was `!domainA || !domainB || !relationshipType`, so it
    rejected `""` and accepted anything else — including a number, which then
    simply matched no domain and scored nothing.
    """
    return bool(value) if not isinstance(value, str) else value != ""


@router.post("/api/cross-domain/correlate")
def correlate(body: Annotated[Any, Body()] = None) -> Any:
    """Correlate two cultural domains, from the graph when it is enabled.

    The answer carries ``source``: ``"graph"`` when the shared Neo4j served it,
    ``"memory"`` when the in-memory TSV path did. With
    ``CORRELATION_GRAPH_ENABLED`` unset — the default, and the state a checkout
    with no graph stack is in — it is always ``"memory"``.
    """
    domain_a = _field(body, "domainA")
    domain_b = _field(body, "domainB")
    relationship_type = _field(body, "relationshipType")
    if not (_truthy(domain_a) and _truthy(domain_b) and _truthy(relationship_type)):
        return JSONResponse(
            status_code=400,
            content={
                "message": (
                    "Missing required fields: domainA, domainB, relationshipType"
                )
            },
        )

    lexicons = lexicons_dir()
    try:
        result, source = correlation.correlate_with_graph_fallback(
            domain_a,
            domain_b,
            relationship_type,
            lambda: correlation.query_correlation(
                domain_a, domain_b, relationship_type, lexicons
            ),
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "computing cross-domain correlation", "Failed to compute correlation", error
        )
    return {**result, "source": source}


@router.get("/api/cross-domain/prebuilt-queries")
def prebuilt_queries() -> Any:
    """The curated correlation queries the client offers as starting points."""
    queries = [dict(query) for query in correlation.PREBUILT_QUERIES]
    return {"queries": queries, "count": len(queries)}


@router.get("/api/genetic-linguistic-correlations")
def genetic_linguistic_correlations(
    haplogroupType: str | None = None,  # noqa: N803 - the baseline query parameter
) -> Any:
    """Haplogroup ↔ language-family overlap, optionally for one haplogroup type."""
    lexicons = lexicons_dir()
    try:
        return genetic.compute_correlations(
            corpus.load_haplogroups(lexicons),
            corpus.load_language_families(lexicons),
            haplogroupType,
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed(
            "computing genetic-linguistic correlations",
            "Failed to compute genetic-linguistic correlations",
            error,
        )
