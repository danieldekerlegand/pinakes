"""The seven `/api/cross-domain/*` reads over the six-domain unified shape.

`search`, `connections/{type}/{id}`, `by-language/{languageId}`,
`by-time/{year}`, `summary`, `entities` and `timeline` — the first six over
:mod:`pinakes.analytics.cross_domain`, the last over
:mod:`pinakes.analytics.cross_domain_timeline`. The two remaining routes on this
prefix (`correlate`, `prebuilt-queries`) are a different port unit and live in
:mod:`pinakes.routers.correlations`.

Three query readings in here are worth naming, because each is a place a
declared FastAPI parameter would answer differently from Express:

* **`?types=` is split on a comma and nothing else.** ``?types=`` blank is
  falsy, so it is *no* filter and every domain comes back;
  ``?types=cuisine,religion`` is two; ``?types=nonsense`` matches no domain and
  the answer is an empty list, not a 400.
* **`{year}` is a path parameter read through `parseInt`, so it can be `NaN`.**
  `/api/cross-domain/by-time/soon` is a **200** echoing ``"year": null``, with
  the three dated domains filtered to nothing and the three undated ones intact
  — not the 422 a declared ``int`` path parameter would answer.
* **`?limit=abc` on search is an empty page.** `parseInt` ⇒ ``NaN`` ⇒
  ``slice(0, NaN)`` ⇒ no rows. The default is 50 and only applies when the
  parameter is absent or blank.

All seven answer the ``{message, error}`` 500 — they are inline handlers in
`routes.ts`, not extracted route files.
"""

from __future__ import annotations

import logging
import math
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from pinakes.analytics import cross_domain, cross_domain_timeline, tsv
from pinakes.paths import lexicons_dir
from pinakes.routers import _reads

logger = logging.getLogger("pinakes.cross_domain")

router = APIRouter(tags=["cross-domain"])

#: `req.query.limit ? parseInt(...) : 50` on search, `: 20` on connections.
DEFAULT_SEARCH_LIMIT = 50.0
DEFAULT_CONNECTION_LIMIT = 20.0


def _csv_list(request: Request, key: str) -> list[str] | None:
    """``req.query.k ? (req.query.k as string).split(",") : undefined``.

    A blank parameter is falsy and therefore *absent*; a present one is split
    even when it holds a single value, and the parts are **not** trimmed.
    """
    raw = request.query_params.get(key)
    if not raw:
        return None
    return raw.split(",")


def _limit(request: Request, fallback: float) -> float:
    """The same read as :func:`_reads.query_int`, with a non-`None` default."""
    parsed = _reads.query_int(request, "limit")
    return fallback if parsed is None else parsed


def _js_year(value: float) -> int | None:
    """A `parseInt` result as `JSON.stringify` writes it — `NaN` is ``null``."""
    return None if math.isnan(value) else int(value)


@router.get("/api/cross-domain/search")
def search(request: Request) -> Any:
    """A weighted substring scan across the six domains."""
    query = request.query_params.get("q")
    if not query:
        return JSONResponse(
            status_code=400, content={"message": "Query parameter 'q' is required"}
        )
    try:
        entities = cross_domain.search_entities(
            cross_domain.get_all_entities(
                lexicons_dir(),
                year=_reads.query_int(request, "year"),
                types=_csv_list(request, "types"),
            ),
            query,
            _limit(request, DEFAULT_SEARCH_LIMIT),
        )
    except Exception as error:  # noqa: BLE001 - the handler's own try/catch
        return _reads.failed(
            logger,
            "in cross-domain search",
            "Failed to perform cross-domain search",
            error,
        )
    return {"entities": entities, "count": len(entities), "query": query}


@router.get("/api/cross-domain/connections/{type}/{id}")
def connections(type: str, id: str, request: Request) -> Any:
    """Everything that scores a relationship with one entity, strongest first.

    An id that names nothing answers **200 with an empty list** — the service
    cannot tell an unknown entity from an unconnected one, and neither could the
    handler.
    """
    try:
        relationships = cross_domain.find_connections(
            cross_domain.get_all_entities(lexicons_dir()),
            id,
            type,
            _limit(request, DEFAULT_CONNECTION_LIMIT),
            now_year=cross_domain.current_year(),
        )
    except Exception as error:  # noqa: BLE001 - the handler's own try/catch
        return _reads.failed(
            logger, "finding connections", "Failed to find connections", error
        )
    return {
        "entityId": id,
        "entityType": type,
        "relationships": relationships,
        "count": len(relationships),
    }


@router.get("/api/cross-domain/by-language/{languageId}")
def by_language(languageId: str) -> Any:
    """Every entity naming one language id, across all six domains."""
    try:
        entities = cross_domain.find_by_language(
            cross_domain.get_all_entities(lexicons_dir()), languageId
        )
    except Exception as error:  # noqa: BLE001 - the handler's own try/catch
        return _reads.failed(
            logger,
            "finding entities by language",
            "Failed to find entities by language",
            error,
        )
    return {"languageId": languageId, "entities": entities, "count": len(entities)}


@router.get("/api/cross-domain/by-time/{year}")
def by_time(year: str, request: Request) -> Any:
    """The six domains as of one year — three of them actually dated."""
    # `parseInt(req.params.year, 10)` — unguarded, so an unparseable segment is
    # a `NaN` that filters every dated domain to nothing and echoes as `null`.
    parsed = tsv.js_parse_int(year)
    try:
        entities = cross_domain.get_all_entities(
            lexicons_dir(), year=parsed, types=_csv_list(request, "types")
        )
    except Exception as error:  # noqa: BLE001 - the handler's own try/catch
        return _reads.failed(
            logger,
            "finding entities by time",
            "Failed to find entities by time",
            error,
        )
    return {"year": _js_year(parsed), "entities": entities, "count": len(entities)}


@router.get("/api/cross-domain/summary")
def summary() -> Any:
    """Counts by domain, distinct languages and the origin-year range."""
    try:
        return cross_domain.summarize(cross_domain.get_all_entities(lexicons_dir()))
    except Exception as error:  # noqa: BLE001 - the handler's own try/catch
        return _reads.failed(logger, "getting summary", "Failed to get summary", error)


@router.get("/api/cross-domain/entities")
def entities(request: Request) -> Any:
    """The whole unified corpus, with the filters echoed back."""
    year = _reads.query_int(request, "year")
    region = _reads.text(request, "region")
    types = _csv_list(request, "types")
    try:
        found = cross_domain.get_all_entities(
            lexicons_dir(), year=year, region=region, types=types
        )
    except Exception as error:  # noqa: BLE001 - the handler's own try/catch
        return _reads.failed(
            logger, "fetching unified entities", "Failed to fetch entities", error
        )
    return {
        "entities": found,
        "count": len(found),
        "filters": _reads.echo(year=year, region=region, types=types),
    }


@router.get("/api/cross-domain/timeline")
def timeline(request: Request) -> Any:
    """Eight datasets on one axis, sorted by start year."""
    try:
        return cross_domain_timeline.get_timeline(
            lexicons_dir(),
            domains=_csv_list(request, "domains"),
            year_start=_reads.query_int(request, "yearStart"),
            year_end=_reads.query_int(request, "yearEnd"),
        )
    except Exception as error:  # noqa: BLE001 - the handler's own try/catch
        return _reads.failed(
            logger,
            "fetching cross-domain timeline",
            "Failed to fetch cross-domain timeline",
            error,
        )
