"""The `/api/hypotheses` route group — generated, speculative research leads.

Ported off `server/routes/hypotheses.ts` (pinakes:62 US-2). The clustering, the
corridor-gap heuristic and the corpus projection are
:mod:`pinakes.analytics.hypothesis`; this file parses four query parameters and
owns the HTTP boundary.

The nodes are `anomaly.load_nodes` — the *same* projection `/api/anomalies`
scans, as it was on Express, where the two route files carried a "keep in sync"
note between two copies of it. Here there is one copy and nothing to keep in
sync.

Parameters are declared as strings and parsed here rather than as typed FastAPI
params, for the reason `routers/graph.py` records: Express reached these through
`parseInt`/`parseFloat` and fell back to the default on anything unparseable,
while a declared `int` answers **422**. A stale bookmark with `?limit=all` must
keep returning leads, not a validation error.
"""

from __future__ import annotations

import logging
import math
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from pinakes.analytics import anomaly, hypothesis
from pinakes.analytics.tsv import js_parse_float, js_parse_int
from pinakes.paths import lexicons_dir

logger = logging.getLogger("pinakes.hypotheses")

router = APIRouter(tags=["hypotheses"])


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


def _non_negative_float(raw: str | None) -> float | None:
    """``parseFloat(raw)`` when it is finite and not negative, else the default."""
    if raw is None:
        return None
    value = js_parse_float(raw)
    return value if math.isfinite(value) and value >= 0 else None


@router.get("/api/hypotheses")
def hypotheses(
    minMembers: str | None = None,  # noqa: N803 - the baseline query parameters
    minRarity: str | None = None,  # noqa: N803
    minGapKm: str | None = None,  # noqa: N803
    limit: str | None = None,
) -> Any:
    """Generate both families of speculative lead over the shared corpus.

    ``minMembers`` (≥ 2) is the smallest ancestor cluster, ``minRarity`` (0..1)
    the rarity floor an anchoring trait must clear, ``minGapKm`` how far a
    corridor point must lie from a known site to become a predicted region, and
    ``limit`` caps **both** families.

    Every item in the answer is marked ``speculative`` and ``generated``, and the
    body carries the disclaimer plus the note distinguishing these leads from the
    curated `urheimat-hypotheses` dataset. That framing is the contract, not
    decoration.
    """
    try:
        lexicons = lexicons_dir()
        nodes = anomaly.load_nodes(lexicons)
        corridors = hypothesis.load_corridors(lexicons)
        known_sites = hypothesis.load_known_sites(lexicons)

        options: dict[str, Any] = {}
        members = _positive_int(minMembers)
        # Below two there is no cluster to speak of, so the parameter is ignored
        # rather than honoured — as it was.
        if members is not None and members >= 2:
            options["min_members"] = members
        rarity = _unit_float(minRarity)
        if rarity is not None:
            options["min_rarity"] = rarity
        gap = _non_negative_float(minGapKm)
        if gap is not None:
            options["min_gap_km"] = gap
        count = _positive_int(limit)
        if count is not None:
            options["max_ancestor_hypotheses"] = count
            options["max_site_predictions"] = count

        result = hypothesis.generate_hypotheses(
            nodes, corridors, known_sites, **options
        )
        return {
            **result,
            "geojson": hypothesis.site_predictions_to_geojson(
                result["sitePredictions"]
            ),
        }
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        logger.exception("Unexpected error in /api/hypotheses")
        return JSONResponse(
            status_code=500,
            content={"error": "hypothesis generation failed", "detail": str(error)},
        )
