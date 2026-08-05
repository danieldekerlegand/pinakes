"""The `POST /api/translate` route — the server-side translation proxy.

Ported off `server/routes/translate.ts` (pinakes:64 US-1) over
:mod:`pinakes.ingest.translate`, which holds the key handling and the upstream
call. This file is the four status codes.

The 503 is the one worth knowing: with no ``$GOOGLE_TRANSLATE_API_KEY`` the
route answers "translation is not available" and `web/src/lib/scraping.ts`
silently falls through to its next source. That is the **default** state of a
checkout, not a misconfiguration — the same optional-enhancement shape as
``$GEONAMES_USERNAME`` in the place resolver.

Sync, not `async def`: the upstream call blocks (see
:mod:`pinakes.ingest.http`).
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from pinakes.ingest import translate

logger = logging.getLogger("pinakes.translate")

router = APIRouter(tags=["translate"])

#: The 502 body. A failure upstream is never described to the client in detail —
#: the message could carry the key back out (`docs/SECURITY.md`).
FAILED = "Translation failed"


@router.post("/api/translate")
def translate_route(body: Annotated[Any, Body()] = None) -> Any:
    """Translate one string with the server-side key. 200/400/502/503."""
    try:
        request = translate.validate_translate_input(body)
    except translate.TranslateValidationError as error:
        return JSONResponse(status_code=400, content={"message": str(error)})

    try:
        return translate.translate_text(request)
    except translate.TranslateNotConfiguredError:
        return JSONResponse(
            status_code=503,
            content={
                "message": (
                    "Translation is not available (no server-side key configured)"
                )
            },
        )
    except translate.TranslateError:
        return JSONResponse(status_code=502, content={"message": FAILED})
    except Exception:  # noqa: BLE001 - the Express catch-all, same 502
        logger.exception("Translation failed")
        return JSONResponse(status_code=502, content={"message": FAILED})
