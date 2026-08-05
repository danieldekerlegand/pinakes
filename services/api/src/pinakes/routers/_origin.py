"""Which origin the two well-known KCB documents absolutize against.

A shared helper (hence the ``_`` — the router scanner skips it), because the
manifest front and the agent-card front must never disagree about where this
deployment is: a crawler that pulls one and dials the other would otherwise be
sent to two different hosts.

The rule is the Express one (`server/routes/{capability-bus,a2a}.ts`):
``$PINAKES_PUBLIC_ORIGIN`` when configured, else the origin the request arrived
on so a document fetched over the network is dialable, else ``None`` — serve the
document as authored, server-relative, which is what a same-origin client wants
and what makes the served manifest byte-identical to the contract on disk.
"""

from __future__ import annotations

from fastapi import Request

from pinakes.kcb.manifest import configured_origin


def origin_for(request: Request) -> str | None:
    """The origin to absolutize against, or ``None`` for the as-authored document."""
    configured = configured_origin()
    if configured:
        return configured
    host = request.headers.get("host")
    if not host:
        return None
    return f"{request.url.scheme}://{host}"
