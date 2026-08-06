"""`GET /api/openapi.json` — the published API document.

Its own port unit, and the last route of the cutover: it describes the *whole*
public surface, so it could not move while most of that surface was still
Express's. The document itself is :mod:`pinakes.openapi_spec`.

**This is not FastAPI's `/openapi.json`.** That one is generated from what this
process registers — 300-odd operations, including the parity endpoints — and it
lives at the root. This one is hand-authored, covers the contribution and
dataset endpoints a third party would integrate against, and is what
``docs/openapi.json`` is a snapshot of. The baseline carries both paths; serving
the generated document here would quietly replace a curated contract with an
inventory.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from pinakes.openapi_spec import build_openapi_spec

router = APIRouter(tags=["meta"])


@router.get("/api/openapi.json")
def openapi_document() -> Any:
    """The published OpenAPI 3.0 document. Always 200; no inputs, no state."""
    return build_openapi_spec()
