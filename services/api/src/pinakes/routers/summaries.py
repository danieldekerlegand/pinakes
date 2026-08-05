"""The `/api/summaries/*` routes — progressive summary/detail loading.

Ported off `server/routes/summaries.ts` (docs/UNIFIED-PROJECT-PLAN.md §7). The
projection, the pagination and the per-domain loader are
:mod:`pinakes.lexicons.summary`; what lives here is the HTTP wiring — map a
domain, read `offset`/`limit`, format the two refusals.

Two things the port keeps:

* **`?limit=abc` is the default page, not a 422.** The query string is read
  through `Number(...)` + `Number.isFinite(...)`, so an unparseable bound falls
  back to "no limit" exactly as it did on Express. A declared `int` parameter
  would make FastAPI answer 422, which is a different contract — a stale
  bookmark must not become a hard failure. (Note this is a *third* spelling of
  the rule: the contribution queue collapses the page to empty and
  `/api/changelog` restores its own default. `server/CLAUDE.md` has the table.)
* **The detail route returns the record unprojected.** `/api/summaries/<domain>/
  <id>` is the same data as `/api/<domain>/<id>`, in the uniform namespace, so
  the two-step load is lossless.
"""

from __future__ import annotations

import json
import logging
import math
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from pinakes.analytics import tsv
from pinakes.lexicons import storage, summary
from pinakes.paths import lexicons_dir

logger = logging.getLogger("pinakes.summaries")

router = APIRouter(tags=["summaries"])


def _number(request: Request, name: str) -> float | None:
    """``Number(req.query[name])``, or ``None`` when absent, blank or not finite.

    The blank case is checked before the conversion on purpose: `Number("")` is
    `0`, and `?offset=` means "unstated", not "start at the beginning" — which
    happen to agree for an offset and would not for a limit.
    """
    raw = request.query_params.get(name)
    if raw is None or raw == "":
        return None
    value = tsv.js_number(raw)
    return value if math.isfinite(value) else None


def _unknown_domain(domain: str) -> JSONResponse:
    """The 404 both routes answer for a domain with no summary contract."""
    return JSONResponse(
        status_code=404,
        content={
            "error": "Unknown summary domain",
            "detail": f"No summary contract for {json.dumps(domain)}",
            "domains": summary.summary_domains(),
        },
    )


@router.get("/api/summaries")
def summary_index() -> Any:
    """The machine-readable contract: every domain, its fields, its detail URL."""
    return {
        "domains": [
            {
                "domain": domain,
                "detailEndpoint": contract.detail_endpoint,
                "fields": list(contract.fields),
            }
            for domain, contract in summary.SUMMARY_CONTRACTS.items()
        ]
    }


@router.get("/api/summaries/{domain}")
def summary_page(domain: str, request: Request) -> Any:
    """A bounded, paginated page of lightweight records for one domain."""
    if not summary.is_summary_domain(domain):
        return _unknown_domain(domain)
    try:
        records = summary.SUMMARY_CONTRACTS[domain].load(lexicons_dir())
        return summary.summarize_list(
            domain, records, _number(request, "offset"), _number(request, "limit")
        )
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        logger.exception("Unexpected error in summaries/%s", domain)
        return JSONResponse(
            status_code=500,
            content={"error": "summary listing failed", "detail": str(error)},
        )


@router.get("/api/summaries/{domain}/{id}")
def summary_detail(
    domain: str,
    id: str,  # noqa: A002 - the baseline path parameter
) -> Any:
    """Detail on demand: the full, unprojected record for one entity."""
    if not summary.is_summary_domain(domain):
        return _unknown_domain(domain)
    try:
        records = summary.SUMMARY_CONTRACTS[domain].load(lexicons_dir())
        record = storage.find_by_id(records, id)
        if record is None:
            return JSONResponse(
                status_code=404,
                content={
                    "error": "Not found",
                    "detail": f"No {domain} with id {json.dumps(id)}",
                },
            )
        return record
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        logger.exception("Unexpected error in summaries/%s/%s", domain, id)
        return JSONResponse(
            status_code=500,
            content={"error": "detail lookup failed", "detail": str(error)},
        )
