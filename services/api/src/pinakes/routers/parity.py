"""The port-coverage catalog.

``/api/_parity/coverage`` is the machine-readable answer to "what is left to
port": the Express baseline (`contracts/parity/openapi.json`) diffed against the
routes this app actually registered. Everything in ``notImplemented`` answers
501 right now, and each entry names its port unit, its Express source file, and
the recorded fixtures that will grade the port.

Also not a parity route — hence the ``_`` in the path, which no baseline route
uses, so this can never shadow one.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

router = APIRouter(tags=["service"])


@router.get("/api/_parity/coverage")
def coverage(request: Request) -> dict[str, Any]:
    """Every baseline route, split by whether this service serves it yet."""
    payload: dict[str, Any] = request.app.state.parity_coverage.as_dict()
    return payload
