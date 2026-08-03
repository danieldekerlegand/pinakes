"""The `pinakes` FastAPI application factory.

The shell the Express backend is ported into (docs/UNIFIED-PROJECT-PLAN.md §5,
§7). :func:`create_app` wires four things, in an order that matters:

1. **routers** — every module under :mod:`pinakes.routers` is discovered and
   mounted (see that package's docstring for the drop-in contract);
2. **coverage** — the parity baseline is diffed against what step 1 registered;
3. **the 501 catalog** — one stub per baseline route step 1 did *not* register;
4. **the client** — the built SPA at ``/``.

Order is the whole design. Real routes win over their own stubs because they
were registered first, and nothing can be shadowed by the static mount because
it is last. A port tasklist only ever adds a file in step 1; steps 2–4 rearrange
themselves around it.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator, Sequence
from pathlib import Path

from fastapi import FastAPI

from pinakes.client import mount_client
from pinakes.not_implemented import register_not_implemented
from pinakes.parity import ParityCoverage, load_parity_routes, split_coverage
from pinakes.paths import client_dist
from pinakes.routers import discover_routers

logger = logging.getLogger("pinakes")

TITLE = "pinakes"
DESCRIPTION = (
    "The unified Pinakes service. Serves the React client and the /api surface; "
    "routes not yet ported off the TypeScript backend answer 501 — see "
    "/api/_parity/coverage."
)


def _iter_route_pairs(
    routes: Sequence[object], prefix: str = ""
) -> Iterator[tuple[str, str]]:
    """Walk a Starlette routing table, flattening included routers.

    Since FastAPI 0.139 ``include_router`` no longer copies the router's routes
    into ``app.routes``; it appends one opaque node holding the original router
    and the prefix it was mounted under. Recursing through that node (and
    tolerating its absence, for a flat table) is what keeps the parity diff
    seeing real routes — read it flat and every route reads as unported, which
    is silent: the stubs would still be registered, still be outranked by the
    real handler, and only the coverage number would lie.
    """
    for route in routes:
        original = getattr(route, "original_router", None)
        if original is not None:
            context = getattr(route, "include_context", None)
            yield from _iter_route_pairs(
                original.routes, prefix + (getattr(context, "prefix", "") or "")
            )
            continue
        methods = getattr(route, "methods", None)
        path = getattr(route, "path", None)
        if methods and path is not None:
            for method in methods:
                yield method.upper(), prefix + path


def registered_routes(app: FastAPI) -> set[tuple[str, str]]:
    """The app's own ``(METHOD, path)`` pairs — the left side of the parity diff."""
    return set(_iter_route_pairs(app.routes))


def describe_coverage(coverage: ParityCoverage) -> str:
    """One-line startup summary — what fraction of the baseline this app serves."""
    return (
        f"parity: {len(coverage.ported)}/{coverage.total} baseline routes ported "
        f"({len(coverage.unported)} answering 501)"
    )


def create_app(
    *,
    client_directory: Path | None = None,
    parity_spec: Path | None = None,
) -> FastAPI:
    """Build the service.

    Both arguments exist for tests and for deployments that place these
    elsewhere; left unset they resolve through :mod:`pinakes.paths` (which also
    honours ``$PINAKES_CLIENT_DIST`` / ``$PINAKES_PARITY_SPEC``).
    """
    app = FastAPI(title=TITLE, description=DESCRIPTION, version="0.1.0")

    discovered = discover_routers()
    for entry in discovered:
        app.include_router(entry.router)
    app.state.router_modules = tuple(entry.module for entry in discovered)

    coverage = split_coverage(
        load_parity_routes(parity_spec), registered_routes(app)
    )
    app.state.parity_coverage = coverage

    register_not_implemented(app, coverage.unported)

    dist = client_directory if client_directory is not None else client_dist()
    app.state.client_dist = dist
    app.state.client_built = mount_client(app, dist)

    logger.info(describe_coverage(coverage))
    if not app.state.client_built:
        logger.warning("no client build under %s — serving the API only", dist)

    return app
