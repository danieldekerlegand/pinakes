"""The `/api/analytics/*` route group — the DuckDB analytical index.

Ported off `server/routes/analytics.ts` (pinakes:62 US-1). Two discovery reads
over :mod:`pinakes.analytics.index`: what is indexed, and the facet counts for
one column. Everything below HTTP is that module; this file is the adapter.

The one contract worth naming: **a bad table or column is a 404, not a 500.**
The TypeScript decided that by matching the index's own error message with a
regular expression; the port raises two typed errors instead and catches them by
type, which says the same thing without the message being load-bearing. An
unexpected index failure is still a 500 with a structured body — a handler here
never crashes the process.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from pinakes.analytics.index import (
    UnknownColumnError,
    UnknownTableError,
    get_analytical_index,
)
from pinakes.paths import lexicons_dir

logger = logging.getLogger("pinakes.analytics")

router = APIRouter(tags=["analytics"])


def _not_found(context: str, error: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=404, content={"error": f"{context} not found", "detail": str(error)}
    )


def _failed(context: str, error: Exception) -> JSONResponse:
    logger.exception("Unexpected error in %s", context)
    return JSONResponse(
        status_code=500, content={"error": f"{context} failed", "detail": str(error)}
    )


@router.get("/api/analytics/tables")
def analytics_tables() -> Any:
    """Every indexed table with its columns and row count."""
    try:
        index = get_analytical_index(lexicons_dir())
        return {"tables": index.describe()}
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("analytics tables", error)


@router.get("/api/analytics/facets/{table}/{column}")
def analytics_facets(table: str, column: str) -> Any:
    """Facet counts for one column: distinct values, most common first."""
    try:
        index = get_analytical_index(lexicons_dir())
        facets = index.facet_counts(table, column)
    except (UnknownTableError, UnknownColumnError) as error:
        return _not_found("analytics facets", error)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _failed("analytics facets", error)
    return {"table": table, "column": column, "facets": facets}
