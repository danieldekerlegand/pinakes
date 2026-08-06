"""`GET /api/quiz` and `POST /api/quiz/score-map` — learning mode.

The cutover's tenth slice (pinakes:80 US-1, continued). Everything below HTTP is
:mod:`pinakes.learning.quiz`; this file is the parameter reading and the two
vocabularies.

* **`validCategories` is not the generator table.** It admits `mixed` — which
  has no generator — and omits `cuisine` and `civilizations`, which have one
  each. So those two question kinds only ever appear inside a `mixed` quiz, and
  asking for either by name is a **400**. Copied as found.
* **`count` is `parseInt(...) || 10` then clamped to 1..30**, so `?count=abc`,
  `?count=0` and `?count=-0.5` are all ten, `?count=99` is thirty, and
  `?count=-4` is one. A declared `int` would have answered 422 to the first.
* **The score body is validated with `!answer.lat`**, so a click at latitude
  **0** is a 400 — the equator is unclickable. Reproduced.
"""

from __future__ import annotations

import logging
import math
from typing import Annotated, Any, Final

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from pinakes.analytics import tsv
from pinakes.learning import quiz as quiz_service
from pinakes.lexicons import storage
from pinakes.paths import lexicons_dir
from pinakes.routers import _reads
from pinakes.routers._owner import json_body

logger = logging.getLogger("pinakes.quiz")

router = APIRouter(tags=["quiz"])

Body = Annotated[Any, Depends(json_body)]

#: The categories the route admits, in the order its 400 lists them.
VALID_CATEGORIES: Final[tuple[str, ...]] = (
    "mixed",
    "languages",
    "families",
    "grammar",
    "writing_systems",
    "geography",
)

VALID_DIFFICULTIES: Final[tuple[str, ...]] = ("easy", "medium", "hard")


def _count(request: Request) -> int:
    """``Math.min(Math.max(parseInt(raw, 10) || 10, 1), 30)``.

    `parseInt` of an absent parameter is `NaN`, which is falsy, so the `|| 10`
    covers "no parameter" and "junk parameter" with one branch — and `-0` (from
    `?count=-0.5`) is falsy too.
    """
    raw = request.query_params.get("count")
    parsed = tsv.js_parse_int(raw) if raw is not None else math.nan
    if parsed != parsed or parsed == 0:
        parsed = 10.0
    return int(min(max(parsed, 1), 30))


def _load_corpus() -> quiz_service.Corpus:
    lexicons = lexicons_dir()
    return quiz_service.Corpus(
        languages=storage.load_languages(lexicons),
        families=storage.load_language_families(lexicons),
        cuisines=storage.load_cuisines(lexicons),
        cuisine_items=storage.load_cuisine_items(lexicons),
        grammar_features=storage.load_grammar_features(lexicons),
        writing_systems=storage.load_writing_systems(lexicons),
        civilizations=storage.load_civilizations(lexicons),
    )


@router.get("/api/quiz")
def quiz(request: Request) -> Any:
    """A drawn quiz session: questions, the category asked for, the difficulty."""
    count = _count(request)
    category = request.query_params.get("category") or "mixed"
    difficulty = request.query_params.get("difficulty") or "medium"

    if category not in VALID_CATEGORIES:
        return JSONResponse(
            status_code=400,
            content={
                "message": (
                    f"Invalid category. Must be one of: {', '.join(VALID_CATEGORIES)}"
                )
            },
        )
    if difficulty not in VALID_DIFFICULTIES:
        return JSONResponse(
            status_code=400,
            content={
                "message": (
                    "Invalid difficulty. Must be one of: "
                    f"{', '.join(VALID_DIFFICULTIES)}"
                )
            },
        )

    try:
        return quiz_service.generate_quiz(_load_corpus(), count, category, difficulty)
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _reads.failed_plain(logger, "generating quiz", "Failed to generate quiz")


def _coordinate(value: Any) -> bool:
    """``!point || !point.lat || !point.lng`` — truthiness, so `0` is missing."""
    if not isinstance(value, dict):
        return False
    lat = value.get("lat")
    lng = value.get("lng")
    return _truthy_number(lat) and _truthy_number(lng)


def _truthy_number(value: Any) -> bool:
    if isinstance(value, bool) or value is None:
        return False
    if isinstance(value, (int, float)):
        return value != 0 and value == value
    return bool(value)


@router.post("/api/quiz/score-map")
def score_map(body: Body) -> Any:
    """How far the guess is from the answer, and whether that is close enough."""
    payload = body if isinstance(body, dict) else {}
    answer = payload.get("answer")
    guess = payload.get("guess")
    if not _coordinate(answer) or not _coordinate(guess):
        return JSONResponse(
            status_code=400,
            content={"message": "answer and guess must have lat and lng"},
        )
    difficulty = payload.get("difficulty") or "medium"
    try:
        assert isinstance(answer, dict) and isinstance(guess, dict)
        return quiz_service.score_map_click(answer, guess, str(difficulty))
    except Exception:  # noqa: BLE001 - reported as the Express 500
        return _reads.failed_plain(
            logger, "scoring map click", "Failed to score map click"
        )
