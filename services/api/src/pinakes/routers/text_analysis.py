"""The two `/api/text-analysis/*` posts — where a text's words came from.

The cutover's tenth slice (pinakes:80 US-1, continued). Everything below HTTP is
:mod:`pinakes.lexicons.etymology`; `compare` runs the same analysis twice and
diffs the two origin tables.

* **The body is read, not declared.** Express validated `req.body` by hand, so a
  junk payload is a **400 naming the fields**; a declared model answers 422,
  which is a different contract. Same rule as `routers/collections.py`.
* **Both handlers validate with truthiness**, so `""` is as missing as absent —
  and `compare` requires all four fields in one message rather than naming the
  one that is missing.
* **`analyzeTextOrigins` is called twice under `Promise.all` over there**, which
  is concurrency and not parallelism: the corpus read is synchronous, so the two
  analyses run one after the other exactly as they do here.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from pinakes.lexicons import etymology, storage
from pinakes.paths import lexicons_dir
from pinakes.routers import _reads
from pinakes.routers._owner import json_body

logger = logging.getLogger("pinakes.text_analysis")

router = APIRouter(tags=["text-analysis"])

Body = Annotated[Any, Depends(json_body)]


def _field(body: Any, key: str) -> Any:
    return body.get(key) if isinstance(body, dict) else None


def _truthy(value: Any) -> bool:
    """``!!value`` for the values a JSON body can hold."""
    if value is None or value is False:
        return False
    if isinstance(value, str):
        return value != ""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value != 0 and value == value
    return True


def _text_of(value: Any) -> str:
    """The value as a string, or V8's `TypeError` for calling a method on it.

    `analyzeTextOrigins` reaches straight for ``text.toLowerCase()``, so a
    non-string `text` that passed the truthiness guard (a number, an object) is
    a **500 publishing the engine's own message**. That message is part of the
    body, which is why it is spelled here rather than left to whatever Python
    would have said about the same mistake — and it names the *parameter*,
    `text`, not the caller's `textA`/`textB`.
    """
    if isinstance(value, str):
        return value
    raise TypeError("text.toLowerCase is not a function")


def _analyze(text: Any, language: Any) -> Any:
    lexicons = lexicons_dir()
    return etymology.analyze_text_origins(
        _text_of(text),
        language if isinstance(language, str) else str(language),
        storage.load_etymology_relations(lexicons),
        storage.load_languages(lexicons),
    )


@router.post("/api/text-analysis/origins")
def origins(body: Body) -> Any:
    """Tally one text's words by the language each descends from."""
    text = _field(body, "text")
    language = _field(body, "language")
    if not _truthy(text) or not _truthy(language):
        return JSONResponse(
            status_code=400,
            content={"message": "Both 'text' and 'language' fields are required"},
        )
    try:
        return _analyze(text, language)
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _reads.failed(
            logger, "analyzing text origins", "Failed to analyze text origins", error
        )


@router.post("/api/text-analysis/compare")
def compare(body: Body) -> Any:
    """Two texts, their origin tables, and the difference between them."""
    text_a = _field(body, "textA")
    text_b = _field(body, "textB")
    language_a = _field(body, "languageA")
    language_b = _field(body, "languageB")
    if not all(_truthy(value) for value in (text_a, text_b, language_a, language_b)):
        return JSONResponse(
            status_code=400,
            content={
                "message": (
                    "Fields 'textA', 'textB', 'languageA', and 'languageB' are "
                    "all required"
                )
            },
        )
    try:
        analysis_a = _analyze(text_a, language_a)
        analysis_b = _analyze(text_b, language_b)
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _reads.failed_plain(
            logger, "comparing text origins", "Failed to compare text origins"
        )
    return {
        "analysisA": analysis_a,
        "analysisB": analysis_b,
        "comparison": etymology.compare_origins(analysis_a, analysis_b),
    }
