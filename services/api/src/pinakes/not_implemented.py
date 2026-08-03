"""The 501 catalog: every baseline route this service does not serve yet.

Registered *after* the real routers, for each ``(method, path)`` in the parity
spec that no router claimed. So the catalog maintains itself — port a route
group and its stubs disappear, because they were only ever the complement of the
routing table.

The body names what a caller needs to act on: the port unit to claim, the
Express file that still serves this route today, and the recorded fixtures that
grade the port.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from pinakes.parity import ParityRoute

#: Status the catalog answers with. 501 (not 404) is deliberate: the route
#: *exists* in the contract, this implementation just does not provide it yet —
#: exactly what RFC 9110 §15.6.2 reserves 501 for. A client that gets 404 would
#: reasonably conclude the resource is gone.
NOT_IMPLEMENTED_STATUS = 501

#: Machine-readable discriminator in the body, so a caller can tell "not ported
#: yet" apart from a genuine downstream failure without parsing prose.
NOT_IMPLEMENTED_ERROR = "not_ported"


def not_implemented_body(route: ParityRoute) -> dict[str, object]:
    """The documented 501 payload for one outstanding baseline route."""
    return {
        "error": NOT_IMPLEMENTED_ERROR,
        "message": (
            f"{route.describe()} is part of the API contract but has not been "
            f"ported to the Python service yet. It is still served by the "
            f"TypeScript backend ({route.source})."
        ),
        "method": route.method,
        "path": route.path,
        "portUnit": route.port_unit,
        "source": route.source,
        "clientUsed": route.client_used,
        "parityFixtures": list(route.fixtures),
        "coverage": "/api/_parity/coverage",
    }


def _endpoint(route: ParityRoute) -> Callable[[], Awaitable[JSONResponse]]:
    """Build the stub handler for one route. Takes no request — the answer is
    the same whatever was asked, and declaring parameters would make FastAPI
    validate them and turn a 501 into a 422."""
    body = not_implemented_body(route)

    async def handler() -> JSONResponse:
        return JSONResponse(status_code=NOT_IMPLEMENTED_STATUS, content=body)

    handler.__name__ = f"not_ported_{route.operation_id.replace('-', '_')}"
    return handler


def register_not_implemented(app: FastAPI, routes: Iterable[ParityRoute]) -> int:
    """Mount a 501 stub for each outstanding route. Returns how many.

    ``include_in_schema=False`` on purpose: this app's own ``/openapi.json``
    describes what it *serves*, and advertising 306 unimplemented operations
    there would make it a fiction. The outstanding set is published as data at
    ``/api/_parity/coverage`` instead.
    """
    count = 0
    for route in routes:
        app.add_api_route(
            route.path,
            _endpoint(route),
            methods=[route.method],
            include_in_schema=False,
            name=f"not-ported:{route.operation_id}",
        )
        count += 1
    return count
