"""The six `/api/linguistic-distance/*` routes — how far apart two languages are.

Ported off the inline handlers in `server/routes.ts` (pinakes:80 US-1) over
:mod:`pinakes.distance`: `calculator` is `linguistic-distance-calculator.ts`
(ASJP/LDND over word forms) and `enhanced` is `linguistic-distance-enhanced.ts`
(phoneme inventories and typological profiles). Two families of endpoint, three
shapes each — pairwise, matrix and nearest — and the enhanced pair adds a
`mode`.

Four things decide the bodies here and none of them is obvious:

* **`parseInt(req.query.k) || 10`, then a range check.** So `?k=` and `?k=abc`
  are the *default* ten, `?k=0` is also ten (zero is falsy), and `?k=-1` is a
  **400**. A declared `int` param would answer 422 to the second and accept the
  third.
* **The 500 body is `{message, error}`.** These handlers stayed inline in
  `routes.ts` rather than being extracted into `server/routes/*.ts`, and that
  half of the backend spells its failures that way (`routers/_reads.failed`).
* **Every score reaching the wire goes through `jsmath.js_number`.** A Jaccard
  overlap of exactly 1 is `1` in JSON, not `1.0`, and a language pair with no
  shared vocabulary reports `-1` rather than `-1.0`.
* **`mode` is validated differently in the two enhanced routes.** The POST
  *falls back* to `combined` for an unrecognised mode; the GET **400s**. Same
  vocabulary, opposite postures, both ports.

`GET .../enhanced/nearest/{languageId}?mode=grammatical` (and `combined`) is a
**500** on the live corpus for any language that has a grammar row at all —
see :class:`~pinakes.distance.enhanced.NotIterableError` for why, and why it is
reproduced rather than repaired.
"""

from __future__ import annotations

import logging
import math
from typing import Annotated, Any

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse

from pinakes.analytics import jsmath, tsv
from pinakes.distance import calculator, enhanced
from pinakes.lexicons import storage
from pinakes.paths import lexicons_dir
from pinakes.routers import _reads

logger = logging.getLogger("pinakes.linguistic_distance")

router = APIRouter(tags=["linguistic-distance"])

MAX_MATRIX_LANGUAGES = 50
MODE_REFUSAL = (
    "mode must be one of: vocabulary, phonological, grammatical, combined"
)


def _field(body: Any, key: str) -> Any:
    """One field of a JSON body. Anything that is not an object has no fields."""
    return body.get(key) if isinstance(body, dict) else None


def _truthy(value: Any) -> bool:
    """``!!value`` — and `![]` is **false** in JavaScript where Python says true.

    The guard over there is `!language1Id || !language2Id`, so a blank string is
    missing and an empty array is present (and then simply matches no language,
    which is a 404 rather than a 400).
    """
    if isinstance(value, str):
        return value != ""
    if isinstance(value, (list, dict)):
        return True
    return bool(value)


def _k(request: Request) -> float:
    """``parseInt(req.query.k as string) || 10`` — a falsy read is the default."""
    raw = request.query_params.get("k")
    parsed = tsv.js_parse_int(raw) if raw is not None else math.nan
    return 10.0 if math.isnan(parsed) or parsed == 0 else parsed


def _find(languages: list[dict[str, Any]], identifier: Any) -> dict[str, Any] | None:
    """``languages.find(l => l.id === id)`` — the FIRST match, and `===`.

    A duplicate id in `languages.tsv` resolves to the row nearest the top, and a
    body field that is a number matches nothing at all rather than coercing.
    """
    if not isinstance(identifier, str):
        return None
    for language in languages:
        if language["id"] == identifier:
            return language
    return None


def _lexical(metrics: dict[str, Any]) -> dict[str, Any]:
    return {
        "ldnd": jsmath.js_number(metrics["ldnd"]),
        "avgLevenshtein": jsmath.js_number(metrics["avgLevenshtein"]),
        "comparedWords": metrics["comparedWords"],
        "coverage": jsmath.js_number(metrics["coverage"]),
        "sharedCognates": metrics["sharedCognates"],
    }


def _pairwise(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "language1": result["language1"],
        "language2": result["language2"],
        "lexical": _lexical(result["lexical"]),
        "confidence": jsmath.js_number(result["confidence"]),
    }


def _scores(values: dict[str, Any]) -> dict[str, Any]:
    """`js_number` over a flat record, leaving booleans and nulls alone."""
    return {
        key: jsmath.js_number(value) if isinstance(value, float) else value
        for key, value in values.items()
    }


@router.post("/api/linguistic-distance/pairwise")
def pairwise(body: Annotated[Any, Body()] = None) -> Any:
    """LDND between two languages, plus their genealogical and geographic gaps."""
    language1_id = _field(body, "language1Id")
    language2_id = _field(body, "language2Id")
    if not _truthy(language1_id) or not _truthy(language2_id):
        return JSONResponse(
            status_code=400,
            content={"message": "Both language1Id and language2Id are required"},
        )

    try:
        lexicons = lexicons_dir()
        languages = storage.load_languages(lexicons)
        lang1 = _find(languages, language1_id)
        lang2 = _find(languages, language2_id)
        if lang1 is None or lang2 is None:
            return _reads.missing("One or both languages not found")

        result = calculator.calculate_pairwise_distance(
            calculator.Lexicon(lexicons), lang1, lang2
        )
        genealogical = calculator.calculate_genealogy_distance(lang1, lang2, languages)
        geographic = calculator.calculate_geographic_distance(lang1, lang2)

        return {
            **_pairwise(result),
            "genealogical": {
                "distance": genealogical,
                "sameFamily": lang1["familyId"] == lang2["familyId"],
            },
            "geographic": {
                "distanceKm": None
                if geographic is None
                else jsmath.js_number(geographic),
                "hasData": geographic is not None,
            },
        }
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _reads.failed(
            logger,
            "calculating pairwise distance",
            "Failed to calculate linguistic distance",
            error,
        )


@router.post("/api/linguistic-distance/matrix")
def matrix(body: Annotated[Any, Body()] = None) -> Any:
    """A symmetric distance matrix over 2–50 languages.

    The **only** route that can ask for a phonetic mode, and therefore the only
    one that reaches the feature-weighted edit distance
    (:mod:`pinakes.distance.phonetic`). An unrecognised mode silently becomes
    `ipa`, as does an unrecognised metric `ldnd`.
    """
    language_ids = _field(body, "languageIds")
    if not isinstance(language_ids, list):
        return JSONResponse(
            status_code=400, content={"message": "languageIds array is required"}
        )
    if len(language_ids) < 2:
        return JSONResponse(
            status_code=400, content={"message": "At least 2 languages are required"}
        )
    if len(language_ids) > MAX_MATRIX_LANGUAGES:
        return JSONResponse(
            status_code=400,
            content={"message": "Maximum 50 languages allowed for matrix calculation"},
        )

    try:
        lexicons = lexicons_dir()
        all_languages = storage.load_languages(lexicons)
        languages = [
            found
            for found in (
                _find(all_languages, identifier) for identifier in language_ids
            )
            if found is not None
        ]
        if len(languages) != len(language_ids):
            return _reads.missing("One or more languages not found")

        phonetic_mode = _field(body, "phoneticMode")
        metric = _field(body, "metric")
        result = calculator.calculate_distance_matrix(
            calculator.Lexicon(lexicons),
            languages,
            "levenshtein" if metric == "levenshtein" else "ldnd",
            phonetic_mode if phonetic_mode in calculator.PHONETIC_MODES else "ipa",
        )
        return {
            "languages": result["languages"],
            "matrix": [
                [jsmath.js_number(cell) for cell in row] for row in result["matrix"]
            ],
            "metric": result["metric"],
        }
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _reads.failed(
            logger,
            "calculating distance matrix",
            "Failed to calculate distance matrix",
            error,
        )


@router.get("/api/linguistic-distance/nearest/{languageId}")
def nearest(languageId: str, request: Request) -> Any:  # noqa: N803 - baseline path
    """The k lexically nearest languages.

    Every one of the ~1,100 languages is scored, including the ~990 with no word
    data at all — and those score `-1`, which sorts **first**. The answer is
    therefore mostly languages nothing is known about unless the caller reads
    `comparedWords`. Reproduced; `web/` does not use this route (the enhanced
    one does).
    """
    k = _k(request)
    if k < 1 or k > 100:
        return JSONResponse(
            status_code=400, content={"message": "k must be between 1 and 100"}
        )

    try:
        lexicons = lexicons_dir()
        languages = storage.load_languages(lexicons)
        target = _find(languages, languageId)
        if target is None:
            return _reads.missing("Language not found")

        results = calculator.find_nearest_languages(
            calculator.Lexicon(lexicons), target, languages, int(k)
        )
        return {
            "targetLanguage": target,
            "nearestLanguages": [_pairwise(result) for result in results],
            "count": len(results),
        }
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _reads.failed(
            logger,
            "finding nearest languages",
            "Failed to find nearest languages",
            error,
        )


@router.get("/api/linguistic-distance/available-languages")
def available_languages() -> Any:
    """The languages that have word data, and how many languages there are in all.

    The availability scan reads **every** `.tsv` in the corpus as a language id
    (:meth:`~pinakes.distance.calculator.Lexicon.available_language_ids`), so the
    intersection with the real language table is doing load-bearing work here —
    without it `deities` would be a language.
    """
    try:
        lexicons = lexicons_dir()
        available = set(calculator.Lexicon(lexicons).available_language_ids())
        all_languages = storage.load_languages(lexicons)
        languages = [
            language for language in all_languages if language["id"] in available
        ]
        return {
            "languages": languages,
            "count": len(languages),
            "totalLanguages": len(all_languages),
        }
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _reads.failed(
            logger,
            "fetching available languages",
            "Failed to fetch available languages",
            error,
        )


@router.post("/api/linguistic-distance/enhanced/pairwise")
def enhanced_pairwise(body: Annotated[Any, Body()] = None) -> Any:
    """Vocabulary, phonology and grammar at once, with a prose summary.

    The vocabulary leg is wrapped in its own `try` on the Express side and its
    failure is **swallowed** — a language with no word forms leaves
    `distances.vocabulary` null and the other two dimensions still answer.
    """
    language1_id = _field(body, "language1Id")
    language2_id = _field(body, "language2Id")
    if not _truthy(language1_id) or not _truthy(language2_id):
        return JSONResponse(
            status_code=400,
            content={"message": "Both language1Id and language2Id are required"},
        )

    mode = _field(body, "mode")
    selected = mode if mode in enhanced.COMPARISON_MODES else "combined"

    try:
        lexicons = lexicons_dir()
        languages = storage.load_languages(lexicons)
        lang1 = _find(languages, language1_id)
        lang2 = _find(languages, language2_id)
        if lang1 is None or lang2 is None:
            return _reads.missing("One or both languages not found")

        vocabulary: float | None = None
        if selected in ("vocabulary", "combined"):
            try:
                lexical = calculator.calculate_pairwise_distance(
                    calculator.Lexicon(lexicons), lang1, lang2
                )["lexical"]
                if lexical["ldnd"] >= 0:
                    vocabulary = lexical["ldnd"]
            except Exception:  # noqa: BLE001 - vocabulary data might not be available
                logger.debug(
                    "no vocabulary distance for %s/%s", lang1["id"], lang2["id"]
                )

        result = enhanced.compute_enhanced_distance(
            enhanced.load_profiles(lexicons),
            str(language1_id),
            str(language2_id),
            vocabulary,
        )
        distances = result["distances"]

        # Grammar, then phonology, then vocabulary — the order they are read in
        # is the order they are read out in, and `join(" but ")` between them.
        descriptions: list[str] = []
        if distances["grammatical"] is not None:
            similarity = jsmath.js_round((1 - distances["grammatical"]) * 100)
            descriptions.append(f"{similarity}% similar grammatically")
        if distances["phonological"] is not None:
            similarity = jsmath.js_round((1 - distances["phonological"]) * 100)
            descriptions.append(f"{similarity}% similar phonologically")
        if distances["vocabulary"] is not None and distances["vocabulary"] >= 0:
            similarity = jsmath.js_round((1 - distances["vocabulary"]) * 100)
            descriptions.append(f"{similarity}% similar in vocabulary")

        return {
            "language1Id": result["language1Id"],
            "language2Id": result["language2Id"],
            "distances": _scores(distances),
            "breakdown": {
                key: _scores(values) for key, values in result["breakdown"].items()
            },
            "language1": lang1,
            "language2": lang2,
            "mode": selected,
            "description": (
                f"{lang1['name']} and {lang2['name']} are {' but '.join(descriptions)}"
                if descriptions
                else f"Insufficient data to compare {lang1['name']} and {lang2['name']}"
            ),
        }
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _reads.failed(
            logger,
            "calculating enhanced pairwise distance",
            "Failed to calculate enhanced distance",
            error,
        )


@router.get("/api/linguistic-distance/enhanced/nearest/{languageId}")
def enhanced_nearest(languageId: str, request: Request) -> Any:  # noqa: N803
    """The k nearest languages on one dimension.

    `mode=vocabulary` is answered by the *lexical* ranker rather than by
    :func:`~pinakes.distance.enhanced.find_nearest_by_dimension`, which has no
    branch for it — the two produce different result shapes on purpose, and the
    client reads `distance` from both.
    """
    mode = request.query_params.get("mode") or "combined"
    if mode not in enhanced.COMPARISON_MODES:
        return JSONResponse(
            status_code=400,
            content={"message": MODE_REFUSAL},
        )

    k = _k(request)
    if k < 1 or k > 100:
        return JSONResponse(
            status_code=400, content={"message": "k must be between 1 and 100"}
        )

    try:
        lexicons = lexicons_dir()
        languages = storage.load_languages(lexicons)
        target = _find(languages, languageId)
        if target is None:
            return _reads.missing("Language not found")

        if mode == "vocabulary":
            results = calculator.find_nearest_languages(
                calculator.Lexicon(lexicons), target, languages, int(k)
            )
            return {
                "targetLanguage": target,
                "mode": mode,
                "nearestLanguages": [
                    {
                        "language": result["language2"],
                        "distance": jsmath.js_number(result["lexical"]["ldnd"]),
                    }
                    for result in results
                ],
                "count": len(results),
            }

        ranked = enhanced.find_nearest_by_dimension(
            enhanced.load_profiles(lexicons), languageId, mode, int(k)
        )
        by_id: dict[str, Any] = {}
        for language in languages:
            by_id.setdefault(language["id"], language)
        return {
            "targetLanguage": target,
            "mode": mode,
            "nearestLanguages": [
                {
                    "language": by_id.get(
                        row["languageId"],
                        {"id": row["languageId"], "name": row["languageId"]},
                    ),
                    "distance": jsmath.js_number(row["distance"]),
                }
                for row in ranked
            ],
            "count": len(ranked),
        }
    except Exception as error:  # noqa: BLE001 - reported as the Express 500
        return _reads.failed(
            logger,
            "finding enhanced nearest languages",
            "Failed to find nearest languages",
            error,
        )
