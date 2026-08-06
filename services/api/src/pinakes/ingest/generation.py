"""What the two TSV generators share: the model call and the two id rules.

`server/services/{language-family,mythology}-scraper-tsv.ts` are the last two
files in `server/services/` that end `-scraper-tsv.ts` — the pair `pinakes:70`
deliberately left standing when it deleted the other twenty-seven scrapers,
because they *generate* TSVs from a model rather than fetching a source. Each
carries its own byte-identical copies of `slugify` and `normalize` and its own
copy of the `getGenerativeModel` boilerplate; there is one copy of each here.

* **REST, not the vendor SDK**, through :mod:`pinakes.ingest.http` — the trade
  :mod:`pinakes.ingest.text_extractor`, :mod:`pinakes.narrative.llm` and
  :mod:`pinakes.media.images` all make. That module's ``LiveDeps`` predates this
  one and keeps its own error spelling (`TextExtractionError` maps onto a 502);
  it was **not** refactored onto :func:`generate_json`, because a port must not
  change what an already-ported route answers.
* **`GEMINI_MODEL` is read per call**, as `process.env.GEMINI_MODEL ||` read it —
  a generator that runs for minutes picks up an operator's change between
  requests, which is what the truthy fallback meant over there.
* **The key check is the caller's**, because the two files word its message
  differently by *phase*: the entry point says "is required for scraping" and
  every inner step says "not set". Both reach a job's `errorMessage`, so the
  difference is visible.
"""

from __future__ import annotations

import json
import os
import re
import unicodedata
from typing import Any, Final

from pinakes.ingest import http

#: Same names, same default, as both TypeScript files — so the two backends call
#: the same model out of the same environment.
GEMINI_API_KEY_ENV: Final = "GEMINI_API_KEY"
GEMINI_MODEL_ENV: Final = "GEMINI_MODEL"
DEFAULT_MODEL: Final = "gemini-3-pro-preview"
GEMINI_ENDPOINT: Final = "https://generativelanguage.googleapis.com/v1beta/models"

#: V8's `\s`, as a character-class body — :mod:`pinakes.lexicons.etymology`
#: spells out why Python's is a different set. `normalize` collapses runs of it,
#: and the result is a Map key, so a character one engine calls whitespace and
#: the other does not decides whether a language lands under its subfamily.
_JS_SPACE: Final = (
    " \\t\\n\\v\\f\\r\\u00a0\\u1680\\u2000-\\u200a"
    "\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff"
)

_COMBINING = re.compile("[\\u0300-\\u036f]")
_NON_SLUG = re.compile("[^a-z0-9]+")
_EDGE_UNDERSCORES = re.compile("^_+|_+$")
_SPACE_RUN = re.compile("[" + _JS_SPACE + "]+")
_TRIM = re.compile("^[" + _JS_SPACE + "]+|[" + _JS_SPACE + "]+$")


class GenerationError(RuntimeError):
    """The model could not be reached, or did not answer with usable JSON.

    Stands in for the three ways the SDK threw: a non-2xx from `generateContent`,
    a `response.text()` with no candidate behind it, and the `JSON.parse` of the
    returned text. All three landed in the same `catch` over there, so one class
    is enough — what matters is that they *throw* rather than degrade, since a
    generator that silently produced no rows would then overwrite the corpus
    with them.
    """


def slugify(value: str) -> str:
    """``toLowerCase → NFKD → strip marks → non-alphanumerics to _ → trim _``.

    The order matters: the case fold runs *before* the decomposition, and the
    ``[^a-z0-9]+`` class is ASCII, so every non-Latin character becomes an
    underscore and a wholly non-Latin name slugs to the empty string.
    """
    lowered = value.lower()
    stripped = _COMBINING.sub("", unicodedata.normalize("NFKD", lowered))
    return _EDGE_UNDERSCORES.sub("", _NON_SLUG.sub("_", stripped))


def normalize(value: str) -> str:
    """``toLowerCase → NFKD → strip marks → collapse whitespace → trim``.

    Keeps punctuation, unlike :func:`slugify`. It is only ever a lookup key for
    matching a language's declared `subfamily` against a generated subfamily
    name, and `.trim()` is V8's whitespace set at both ends — the same rule
    :mod:`pinakes.lexicons.preservation` documents.
    """
    lowered = value.lower()
    stripped = _COMBINING.sub("", unicodedata.normalize("NFKD", lowered))
    return _TRIM.sub("", _SPACE_RUN.sub(" ", stripped))


def api_key() -> str:
    """``process.env.GEMINI_API_KEY`` — the raw value, not trimmed.

    Both files test it with plain truthiness (``if (!process.env.GEMINI_API_KEY)``),
    so a key of whitespace is a *configured* key over there and reaches the
    model as one. Not tidied: an operator who set the variable to a space gets
    the same upstream refusal on both backends rather than two different
    messages.
    """
    return os.environ.get(GEMINI_API_KEY_ENV, "")


def model_name() -> str:
    """``process.env.GEMINI_MODEL || "gemini-3-pro-preview"``."""
    return os.environ.get(GEMINI_MODEL_ENV) or DEFAULT_MODEL


def generate_json(prompt: str, schema: dict[str, Any], key: str) -> Any:
    """One `generateContent` round trip, returning the parsed JSON answer.

    `responseMimeType: "application/json"` plus a `responseSchema` is what the
    SDK's `generationConfig` carried, and the REST enum spells the schema's
    types in **upper case** where `SchemaType` spelled them lower — the same
    translation :mod:`pinakes.ingest.text_extractor` made. The key rides in an
    ``x-goog-api-key`` header; a query parameter is logged by every hop between
    here and the model.
    """
    # The three keys, in the SDK's own order, including the empty
    # `safetySettings` its `formatGenerateContentInput` always emits. None of
    # that changes what the model answers — it is here so the request bodies the
    # two backends put on the wire are byte-identical, which is what the live
    # diff behind this port compares. The one header not reproduced is
    # `x-goog-api-client`, which identifies the SDK and would be a lie.
    body = json.dumps(
        {
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": schema,
            },
            "safetySettings": [],
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        }
    )
    response = http.client(http.GOOGLE).post(
        f"{GEMINI_ENDPOINT}/{model_name()}:generateContent",
        body=body,
        headers={"x-goog-api-key": key},
    )
    if response.status_code >= 400:
        raise GenerationError(
            f"the generation model returned {response.status_code}"
        )
    payload = http.read_json(response, context="The generation model")
    text = response_text(payload)
    try:
        return json.loads(text)
    except ValueError as error:
        # `JSON.parse` threw a SyntaxError into the same `catch` over there.
        raise GenerationError(
            "the generation model returned content that is not JSON"
        ) from error


def response_text(payload: Any) -> str:
    """``result.response.text()`` — every text part of the first candidate.

    The SDK concatenates the parts rather than reading the first one, which is
    what a model that split a long JSON answer across parts relies on. No
    candidate at all is a throw over there too.
    """
    candidates = payload.get("candidates") if isinstance(payload, dict) else None
    if not isinstance(candidates, list) or not candidates:
        raise GenerationError("the generation model returned no candidates")
    first = candidates[0]
    content = first.get("content") if isinstance(first, dict) else None
    parts = content.get("parts") if isinstance(content, dict) else None
    texts = [
        part["text"]
        for part in (parts if isinstance(parts, list) else [])
        if isinstance(part, dict) and isinstance(part.get("text"), str)
    ]
    if not texts:
        raise GenerationError("the generation model returned no content")
    return "".join(texts)


__all__ = [
    "DEFAULT_MODEL",
    "GEMINI_API_KEY_ENV",
    "GEMINI_ENDPOINT",
    "GEMINI_MODEL_ENV",
    "GenerationError",
    "api_key",
    "generate_json",
    "model_name",
    "normalize",
    "response_text",
    "slugify",
]
