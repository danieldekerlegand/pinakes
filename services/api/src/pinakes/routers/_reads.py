"""The four shapes every flat-catalog handler in `routes.ts` is built out of.

Hoisted out of :mod:`pinakes.routers.domains` when the cutover's fourth slice
needed the same helpers in two more router files. Underscore-prefixed so the
router scanner skips it (`app.py`); it exposes no ``router``.

The two 500 spellings are the reason this is a module rather than one function.
A handler that was extracted into `server/routes/*.ts` answers ``{error, detail}``;
one that stayed inline in `routes.ts` answers either ``{message, error}`` or
``{message}`` alone, per handler, with no rule behind which. Both inline
spellings are here and each caller picks the one its own handler used.
"""

from __future__ import annotations

import logging
import math
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

from pinakes.analytics import tsv
from pinakes.analytics.jsmath import js_number


def failed(
    logger: logging.Logger, context: str, message: str, error: Exception
) -> JSONResponse:
    """The ``{message, error}`` 500 most of the inline handlers answer."""
    logger.exception("Error %s", context)
    return JSONResponse(
        status_code=500, content={"message": message, "error": str(error)}
    )


def failed_plain(
    logger: logging.Logger, context: str, message: str
) -> JSONResponse:
    """The ``{message}``-only 500 the rest of them answer."""
    logger.exception("Error %s", context)
    return JSONResponse(status_code=500, content={"message": message})


def missing(message: str) -> JSONResponse:
    return JSONResponse(status_code=404, content={"message": message})


def text(request: Request, key: str) -> str | None:
    """``req.query.k as string | undefined`` — a blank parameter stays blank.

    Absent is ``None`` and ``?k=`` is ``""``; the two are the same to a filter
    (``""`` is falsy) and different to a `filters` echo, which is exactly the
    distinction :func:`echo` preserves.
    """
    return request.query_params.get(key)


def query_int(request: Request, key: str) -> float | None:
    """``req.query.k ? parseInt(req.query.k, 10) : undefined``.

    A blank parameter is falsy in JavaScript and so is the filter's absence; an
    unparseable one is ``NaN``, which is *not* absent — the filter applies and
    matches nothing. Declaring the parameter as ``int`` instead would answer
    **422** where Express answered with the whole table.
    """
    raw = request.query_params.get(key)
    if not raw:
        return None
    return tsv.js_parse_int(raw)


def query_number(request: Request, key: str) -> float | None:
    """``req.query.k ? Number(req.query.k) : undefined`` — the whole string.

    Not :func:`query_int`: ``Number("7.5")`` is 7.5 where ``parseInt`` is 7, and
    ``Number("7d")`` is ``NaN`` where ``parseInt`` is 7. Only
    `GET /api/data-freshness` reads a parameter this way.
    """
    raw = request.query_params.get(key)
    if not raw:
        return None
    return tsv.js_number(raw)


def echo(**fields: Any) -> dict[str, Any]:
    """The handler's filter bag, as ``JSON.stringify`` would have written it.

    An ``undefined`` value emits **no key** and ``NaN`` emits ``null``;
    Starlette's ``JSONResponse`` sets ``allow_nan=False`` and *raises* on a raw
    ``NaN``, so the conversion has to happen here rather than at serialisation.
    :func:`~pinakes.analytics.jsmath.js_number` is the third rule: ``parseInt``
    yields a Python ``float``, and ``50.0`` on the wire is not the ``50``
    Express sent.
    """
    echoed: dict[str, Any] = {}
    for key, value in fields.items():
        if value is None:
            continue
        if isinstance(value, float):
            echoed[key] = None if math.isnan(value) else js_number(value)
        else:
            echoed[key] = value
    return echoed
