"""The soft owner id the collaborative stores are keyed by.

There is no auth in this project. Ownership of a collection or a note is an
opaque string the client mints and persists per browser
(`web/src/lib/collections.ts` `getOwnerId`), and the server reads it — in
priority order — from the ``x-owner-id`` header, the ``owner`` query parameter,
or the ``owner`` body field, falling back to ``"anonymous"``.

All three sources, in that order, are the contract and not an accident: the
client sends the header on reads, the query parameter is what makes a collection
URL shareable between two tabs, and the body field is how a `DELETE` carries an
owner at all (`use-collections.ts` posts `{owner}` on every mutation). Dropping
the body source would break delete for every existing client.

Underscore-prefixed so the router scanner treats it as a helper rather than a
route group — see :mod:`pinakes.routers`.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import Request

from pinakes.collab.entities import ANONYMOUS

#: The header the client sends. Case-insensitive, as Starlette stores headers.
OWNER_HEADER = "x-owner-id"

#: The query parameter and body field, which share a name.
OWNER_FIELD = "owner"


async def json_body(request: Request) -> Any:
    """The request's parsed JSON body, or ``None`` when there isn't one.

    Starlette caches the raw body on the request, so reading it here does not
    consume it — a handler that also declares a ``Body()`` parameter still gets
    its payload. Malformed JSON returns ``None`` rather than raising: the owner
    is being *sniffed* out of the body, and a body that cannot be parsed is the
    handler's problem to report, not this function's.
    """
    raw = await request.body()
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def _trimmed(value: Any) -> str | None:
    """A non-blank string, trimmed — or ``None``, matching the JS guard."""
    if isinstance(value, str) and value.strip() != "":
        return value.strip()
    return None


async def resolve_owner(request: Request) -> str:
    """Read the owner id off a request. Used as a FastAPI dependency.

    Never fails and never rejects: an unattributed request is served as
    ``"anonymous"``, which is a real owner with real records, not a sentinel.
    """
    header = _trimmed(request.headers.get(OWNER_HEADER))
    if header is not None:
        return header

    query = _trimmed(request.query_params.get(OWNER_FIELD))
    if query is not None:
        return query

    body = await json_body(request)
    if isinstance(body, dict):
        field = _trimmed(body.get(OWNER_FIELD))
        if field is not None:
            return field

    return ANONYMOUS
