"""The MCP invocation front at ``/mcp`` (pinakes:65 US-1).

Ported off `server/routes/mcp.ts`. The server itself — the tool table, the
handlers and the JSON-RPC dispatch — is :mod:`pinakes.kcb.mcp`; this file is the
transport, and it is deliberately thin.

**Stateless streamable HTTP, JSON responses.** The Express front ran the SDK
transport with ``sessionIdGenerator: undefined`` + ``enableJsonResponse: true``,
which means: every POST carries its own JSON-RPC message(s) and is answered with
JSON, there is no session id, and the GET (server-initiated SSE stream) and
DELETE (session teardown) verbs have nothing to do. Both therefore answer the
same JSON-RPC "method not allowed" they did over there — **405 with a JSON-RPC
error body**, not FastAPI's ``{"detail": …}``.

A batch that is all notifications produces no responses, which is a **202 with an
empty body** per the MCP streamable-HTTP rules; the Express SDK did the same.

The ``Accept`` header is **not** enforced. The spec asks a client to offer both
``application/json`` and ``text/event-stream`` and the JS SDK rejects one that
does not; this front only ever answers JSON, so refusing a JSON-only client would
be a stricter contract than the one the surface actually implements.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from pinakes.kcb.mcp import MCP_ROUTE_PATH, METHOD_NOT_ALLOWED, handle_payload

router = APIRouter(tags=["kcb"])


def _method_not_allowed() -> JSONResponse:
    return JSONResponse(
        status_code=405,
        content={
            "jsonrpc": "2.0",
            "error": {
                "code": METHOD_NOT_ALLOWED,
                "message": "Method not allowed — POST JSON-RPC to /mcp.",
            },
            "id": None,
        },
    )


@router.post(MCP_ROUTE_PATH)
async def mcp_post(request: Request) -> Response:
    """One JSON-RPC message (or batch) in, its response(s) out."""
    raw = await request.body()
    try:
        payload: Any = json.loads(raw) if raw else None
    except json.JSONDecodeError as exc:
        return JSONResponse(
            status_code=400,
            content={
                "jsonrpc": "2.0",
                "error": {"code": -32700, "message": f"Parse error: {exc.msg}"},
                "id": None,
            },
        )

    responses = handle_payload(payload)
    if not responses:
        # Notifications only: accepted, nothing to say back.
        return Response(status_code=202)
    body: Any = responses if isinstance(payload, list) else responses[0]
    return JSONResponse(content=body)


@router.get(MCP_ROUTE_PATH)
def mcp_get() -> Response:
    """The session SSE stream — not served by a stateless transport."""
    return _method_not_allowed()


@router.delete(MCP_ROUTE_PATH)
def mcp_delete() -> Response:
    """Session teardown — there is no session to tear down."""
    return _method_not_allowed()
