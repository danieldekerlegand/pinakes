"""The narrative model proxy — the port of `liveNarrativeLlm`.

The key is **server-side only** (`docs/SECURITY.md`): the client posts two entity
refs, this process holds `$GEMINI_API_KEY` and makes the upstream call. There is
no `VITE_`-prefixed variant of it, and there must not be — Vite inlines those
into the browser bundle.

**`urllib`, not the vendor SDK.** Express reached the model through
`@google/generative-ai`; the equivalent here would be a new runtime dependency
for one request shape, against a service that deliberately declares no HTTP
client (`kcb/registry.py`, `search/places.py` — same call, same reasoning). The
request below is the SDK's `generateContent` body field for field, including the
`responseSchema` that is what makes the answer parseable rather than prose about
prose.

A missing key **raises** rather than degrading to a canned string. The route maps
that to a 502 with the reason attached, which is honest; answering 200 with a
fabricated narrative would not be, and answering 200 with an empty one would look
like "no connection found" — the one result this surface must never fake.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Final

#: Env vars. `GEMINI_MODEL` is optional; the key is not.
API_KEY_ENV: Final = "GEMINI_API_KEY"
MODEL_ENV: Final = "GEMINI_MODEL"
DEFAULT_MODEL: Final = "gemini-3-pro-preview"

#: Where `generateContent` lives. Overridable so a test can point at a stub
#: without monkeypatching `urllib`.
BASE_URL_ENV: Final = "GEMINI_API_BASE_URL"
DEFAULT_BASE_URL: Final = "https://generativelanguage.googleapis.com/v1beta"

#: Upstream timeout, in seconds.
TIMEOUT_S: Final = 30.0

#: The structured-output schema, as the SDK's `SchemaType` spells it.
RESPONSE_SCHEMA: Final[dict[str, Any]] = {
    "type": "OBJECT",
    "properties": {
        "explanation": {
            "type": "STRING",
            "description": (
                "2–4 sentence grounded prose explanation of the connection."
            ),
        }
    },
    "required": ["explanation"],
}


class NarrativeModelError(RuntimeError):
    """The model could not be reached, or returned nothing usable."""


def _base_url() -> str:
    return os.environ.get(BASE_URL_ENV, "").strip().rstrip("/") or DEFAULT_BASE_URL


def _model_name() -> str:
    return os.environ.get(MODEL_ENV, "").strip() or DEFAULT_MODEL


def _extract_text(payload: Any) -> str:
    """``result.response.text()`` — the concatenated text parts of candidate 0."""
    candidates = payload.get("candidates") if isinstance(payload, dict) else None
    if not isinstance(candidates, list) or not candidates:
        return ""
    content = candidates[0].get("content") if isinstance(candidates[0], dict) else None
    parts = content.get("parts") if isinstance(content, dict) else None
    if not isinstance(parts, list):
        return ""
    return "".join(
        part["text"]
        for part in parts
        if isinstance(part, dict) and isinstance(part.get("text"), str)
    )


class LiveNarrativeLlm:
    """The live model. Satisfies :class:`~pinakes.narrative.connection.NarrativeLlm`."""

    def generate(self, prompt: str) -> str:
        api_key = os.environ.get(API_KEY_ENV, "").strip()
        if not api_key:
            raise NarrativeModelError(
                f"{API_KEY_ENV} environment variable is required for narrative "
                "generation"
            )

        url = f"{_base_url()}/models/{_model_name()}:generateContent"
        body = json.dumps(
            {
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseSchema": RESPONSE_SCHEMA,
                },
            }
        ).encode("utf-8")
        request = urllib.request.Request(  # noqa: S310 - a fixed https endpoint
            url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": api_key,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:  # noqa: S310
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as error:
            raise NarrativeModelError(
                f"narrative model request failed: {error}"
            ) from error

        try:
            parsed = json.loads(_extract_text(payload))
        except ValueError as error:
            raise NarrativeModelError(
                "the narrative model did not return JSON"
            ) from error
        explanation = parsed.get("explanation") if isinstance(parsed, dict) else None
        if not isinstance(explanation, str) or not explanation.strip():
            raise NarrativeModelError("empty narrative from the model")
        return explanation


#: The default model instance the route wires when nothing is injected.
live_narrative_llm: Final = LiveNarrativeLlm()


__all__ = [
    "API_KEY_ENV",
    "BASE_URL_ENV",
    "DEFAULT_MODEL",
    "MODEL_ENV",
    "RESPONSE_SCHEMA",
    "LiveNarrativeLlm",
    "NarrativeModelError",
    "live_narrative_llm",
]
