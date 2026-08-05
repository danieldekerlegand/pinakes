"""The server-side Google Translate proxy.

The port of `server/services/translate.ts` (pinakes:64 US-1). The whole point of
the surface is where the key lives: ``$GOOGLE_TRANSLATE_API_KEY`` is read *here*
and the upstream call is made *here*, so the browser never holds it. Nothing
about that changes in the port — `docs/SECURITY.md` is the posture, and
`server/security/translate-proxy.test.ts` is still the guard that no `web/`
source names the key.

Three refusals, and they mean different things to the client
(`web/src/lib/scraping.ts` reads them as one thing — "try the next source"):

* **400** the body is unusable;
* **503** no key is configured. This is the normal state of a checkout, not an
  error: translation is an *optional* enhancement, same shape as
  ``$GEONAMES_USERNAME``;
* **502** the upstream failed.

The call is a POST through :mod:`pinakes.ingest.http`, so it is retried on 429/5xx
and **not cached** — the engine client caches reads only, which is what we want
here for a second reason: the key rides in the request, and a cached response
carries the URL it was fetched from.
"""

from __future__ import annotations

import json
import os
from typing import Any, NamedTuple, Protocol
from urllib.parse import quote

from pinakes.ingest import http

#: The environment variable holding the key. Never `VITE_`-prefixed: Vite inlines
#: those into the browser bundle.
API_KEY_ENV = "GOOGLE_TRANSLATE_API_KEY"

ENDPOINT = "https://translation.googleapis.com/language/translate/v2"

#: The `source` field on every answer — the client displays which engine spoke.
SOURCE = "google-translate"


class TranslateError(Exception):
    """The upstream failed or refused (→ 502)."""


class TranslateNotConfiguredError(Exception):
    """No server-side key is configured (→ 503)."""


class TranslateValidationError(Exception):
    """The request body is unusable (→ 400)."""


class TranslateInput(NamedTuple):
    """One validated translation request."""

    text: str
    to: str
    from_: str | None


def load_api_key() -> str | None:
    """The server-side key, or ``None``. Read per call, never cached."""
    key = (os.environ.get(API_KEY_ENV) or "").strip()
    return key or None


def validate_translate_input(body: Any) -> TranslateInput:
    """Normalise and validate a raw request body.

    Validated by hand rather than declared as a model, for the reason the whole
    port keeps repeating: a declared body answers **422** with FastAPI's own
    envelope, and this surface answers **400** with ``{message}``. The client
    treats any non-200 as "degrade to the next source", so the difference is
    invisible to it — and visible to everything else.
    """
    data = body if isinstance(body, dict) else {}
    text = data.get("text")
    if not isinstance(text, str) or not text.strip():
        raise TranslateValidationError("text is required")
    to = data.get("to")
    if not isinstance(to, str) or not to.strip():
        raise TranslateValidationError("to (target language) is required")
    source = data.get("from")
    from_ = (
        source.strip()
        if isinstance(source, str) and source.strip()
        else None
    )
    # `text` is NOT trimmed: what was pasted is what gets translated.
    return TranslateInput(text=text, to=to.strip(), from_=from_)


class TranslateDeps(Protocol):
    """The upstream, behind an interface. Tests pass a fake; no key needed."""

    def translate(self, request: TranslateInput, api_key: str) -> str | None:
        """The translated string, or ``None`` when the upstream yielded none."""
        ...


class LiveDeps:
    """The real Translation v2 REST endpoint, through the engine's client."""

    def translate(self, request: TranslateInput, api_key: str) -> str | None:
        payload: dict[str, str] = {
            "q": request.text,
            "target": request.to,
            "format": "text",
        }
        if request.from_:
            payload["source"] = request.from_
        try:
            response = http.client(http.GOOGLE).post(
                f"{ENDPOINT}?key={quote(api_key, safe='')}",
                body=json.dumps(payload),
            )
        except Exception as error:  # noqa: BLE001 - any transport failure is a 502
            raise TranslateError(f"Google Translate request failed: {error}") from error

        try:
            data = http.read_json(response, context="Google Translate")
        except http.UpstreamError:
            # `res.json().catch(() => ({}))` — an unreadable body is not itself
            # the failure; the status is what decides.
            data = {}
        if response.status_code >= 400:
            message = _error_message(data)
            raise TranslateError(
                f"Google Translate returned {response.status_code}"
                + (f": {message}" if message else "")
            )
        return _first_translation(data)


def _error_message(data: Any) -> str | None:
    error = data.get("error") if isinstance(data, dict) else None
    message = error.get("message") if isinstance(error, dict) else None
    return message if isinstance(message, str) and message else None


def _first_translation(data: Any) -> str | None:
    """``data.data?.translations?.[0]?.translatedText ?? null``."""
    inner = data.get("data") if isinstance(data, dict) else None
    translations = inner.get("translations") if isinstance(inner, dict) else None
    first = (
        translations[0]
        if isinstance(translations, list) and translations
        else None
    )
    text = first.get("translatedText") if isinstance(first, dict) else None
    return text if isinstance(text, str) else None


def live_deps() -> TranslateDeps:
    """The live boundary. A function, so a configured client is used per call."""
    return LiveDeps()


def translate_text(
    request: TranslateInput,
    deps: TranslateDeps | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    """Translate one string. Raises :class:`TranslateNotConfiguredError` with no key."""
    key = api_key if api_key is not None else load_api_key()
    if not key:
        raise TranslateNotConfiguredError(
            f"{API_KEY_ENV} is not configured on the server"
        )
    translation = (deps if deps is not None else live_deps()).translate(request, key)
    return {
        "translation": translation,
        "source": SOURCE,
        "from": request.from_,
        "to": request.to,
    }


__all__ = [
    "API_KEY_ENV",
    "ENDPOINT",
    "SOURCE",
    "LiveDeps",
    "TranslateDeps",
    "TranslateError",
    "TranslateInput",
    "TranslateNotConfiguredError",
    "TranslateValidationError",
    "live_deps",
    "load_api_key",
    "translate_text",
    "validate_translate_input",
]
