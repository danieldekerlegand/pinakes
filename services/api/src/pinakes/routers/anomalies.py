"""The `/api/anomalies` route group — statistically surprising similarities.

Ported off `server/routes/anomaly-detection.ts` (pinakes:62 US-1). The scoring
and the corpus projection are :mod:`pinakes.analytics.anomaly`; this file parses
three query parameters and owns the HTTP boundary.

The parameters are declared as strings and parsed here rather than as typed
FastAPI params, for the reason `routers/graph.py` records: Express reached these
through `parseInt`/`parseFloat` and fell back to the default on anything
unparseable, while a declared `float` answers **422**. A stale bookmark with
``?minSurprise=high`` must keep returning anomalies, not a validation error.
"""

from __future__ import annotations

import logging
import math
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from pinakes.analytics import anomaly
from pinakes.analytics.tsv import js_parse_float, js_parse_int
from pinakes.paths import lexicons_dir

logger = logging.getLogger("pinakes.anomalies")

router = APIRouter(tags=["anomalies"])


def _positive_int(raw: str | None) -> int | None:
    """``parseInt(raw, 10)`` when it is finite and positive, else the default."""
    if raw is None:
        return None
    value = js_parse_int(raw)
    return int(value) if math.isfinite(value) and value > 0 else None


def _unit_float(raw: str | None) -> float | None:
    """``parseFloat(raw)`` when it lands in [0, 1], else the default."""
    if raw is None:
        return None
    value = js_parse_float(raw)
    return value if math.isfinite(value) and 0 <= value <= 1 else None


@router.get("/api/anomalies")
def anomalies(
    domains: str | None = None,
    minSurprise: str | None = None,  # noqa: N803 - the baseline query parameter
    limit: str | None = None,
) -> Any:
    """Rank the corpus's most unexpected cross-cultural similarities.

    ``domains`` (comma-separated) narrows which node domains are scanned,
    ``minSurprise`` (0..1) raises the reporting threshold, and ``limit`` caps
    the result. Filtering happens **before** the scan, so it changes the rarity
    denominator as well as the output — narrowing to one domain asks "what is
    surprising within this domain", not "which of these results came from it".
    """
    try:
        nodes = anomaly.load_nodes(lexicons_dir())

        if domains is not None and domains.strip():
            wanted = {part.strip() for part in domains.split(",") if part.strip()}
            nodes = [node for node in nodes if node.domain in wanted]

        options: dict[str, Any] = {}
        threshold = _unit_float(minSurprise)
        if threshold is not None:
            options["min_surprise"] = threshold
        count = _positive_int(limit)
        if count is not None:
            options["limit"] = count

        return anomaly.detect_anomalies(nodes, **options)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        logger.exception("Unexpected error in /api/anomalies")
        return JSONResponse(
            status_code=500,
            content={"error": "anomaly detection failed", "detail": str(error)},
        )
