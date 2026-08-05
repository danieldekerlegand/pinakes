"""The two reads over the word-form table — comparison and per-language list.

`GET /api/word-comparisons` and `GET /api/languages/{id}/word-list`, both over
:mod:`pinakes.lexicons.forms`. They are one file because they share a pagination
idiom that appears nowhere else in `routes.ts`, and getting it wrong is silent.

* **Optional pagination changes the response *type*, not just its contents.**
  With no `?limit=` the body is a **bare array**; with one it is
  `{items, total, limit, offset}`. A client that always destructures `items`
  breaks on the first request that omits the limit, and vice versa — so the
  branch is the contract.
* **`?limit=abc` returns an empty page, not the whole list.** `parseInt` yields
  `NaN`, `slice(offset, offset + NaN)` clamps both ends to 0, and `limit: NaN`
  serialises as **`null`**. Reproduced through `store.parse_int_js` +
  `store.js_slice`; `_page` is where all three meet.
* **`?languages=fin,est` is ONE language, not two.** Express reads the parameter
  as `Array.isArray(q) ? q : [q]` and never splits on a comma, so the
  comma-joined form fails the "at least 2" check with a 400. The array form is
  the *repeated* parameter — `?languages=fin&languages=est` — which is why this
  handler reads `getlist` rather than `get`.
"""

from __future__ import annotations

import logging
import math
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from pinakes.contributions.store import js_slice, parse_int_js
from pinakes.lexicons import forms
from pinakes.paths import lexicons_dir
from pinakes.routers import _reads

logger = logging.getLogger("pinakes.words")

router = APIRouter(tags=["catalog"])


def _page(request: Request, items: list[Any]) -> Any:
    """`?limit=`/`?offset=` applied the way both handlers apply them.

    ``limit`` absent (or blank, which is falsy) ⇒ the bare array. ``offset``
    absent ⇒ 0, and an unparseable one is a `NaN` that `slice` reads as 0 —
    while still being echoed as `null`.
    """
    limit = parse_int_js(request.query_params.get("limit"))
    offset = parse_int_js(request.query_params.get("offset"))
    if offset is None:
        offset = 0.0
    if limit is None:
        return items
    return {
        "items": js_slice(items, offset, offset + limit),
        "total": len(items),
        "limit": None if math.isnan(limit) else int(limit),
        "offset": None if math.isnan(offset) else int(offset),
    }


@router.get("/api/word-comparisons")
def word_comparisons(request: Request) -> Any:
    """The concepts at least one of the selected languages attests."""
    languages = request.query_params.getlist("languages")
    # `if (!languages)` — a *single* blank value is the falsy empty string, and
    # an absent parameter is `undefined`. Both are "no languages named".
    if not languages or (len(languages) == 1 and languages[0] == ""):
        return JSONResponse(
            status_code=400, content={"message": "Languages parameter is required"}
        )
    if len(languages) < 2:
        return JSONResponse(
            status_code=400,
            content={
                "message": "At least 2 languages are required for comparison"
            },
        )
    try:
        comparisons = forms.word_comparisons(lexicons_dir(), languages)
    except Exception:  # noqa: BLE001 - the handler's own try/catch
        return _reads.failed_plain(
            logger,
            "in /api/word-comparisons endpoint",
            "Failed to fetch word comparisons",
        )
    return _page(request, comparisons)


@router.get("/api/languages/{id}/word-list")
def language_word_list(id: str, request: Request) -> Any:
    """Every concept, annotated with this language's form (or `null`)."""
    try:
        word_list = forms.language_word_list(lexicons_dir(), id)
    except Exception:  # noqa: BLE001 - the handler's own try/catch
        return _reads.failed_plain(
            logger,
            "in /api/languages/:id/word-list endpoint",
            "Failed to fetch language word list",
        )
    return _page(request, word_list)
