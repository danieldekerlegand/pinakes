"""Liveness for the service shell.

``/api/health`` is *not* a parity route — the Express backend never had one, so
this adds to the contract rather than porting a piece of it. It exists so the
shell is provably up (process, app wiring, router discovery) independently of
whether any route group has been ported yet.
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version
from typing import Any

from fastapi import APIRouter, Request

router = APIRouter(tags=["service"])


def _service_version() -> str:
    try:
        return version("pinakes")
    except PackageNotFoundError:  # pragma: no cover - only if run uninstalled
        return "unknown"


@router.get("/api/health")
def health(request: Request) -> dict[str, Any]:
    """Report that the shell is serving, and what it is serving."""
    coverage = request.app.state.parity_coverage
    return {
        "status": "ok",
        "service": "pinakes",
        "version": _service_version(),
        "routers": list(request.app.state.router_modules),
        "clientBuilt": bool(request.app.state.client_built),
        "parity": {
            "total": coverage.total,
            "ported": len(coverage.ported),
            "unported": len(coverage.unported),
        },
    }
