"""The one door the ingest routes reach the network through.

Every outbound fetch in this package goes through
:class:`~pinakes_engine.acquire.http.HttpClient` — the engine's polite client,
the same one the acquisition adapters use. It is not a convenience wrapper: it
is what makes these routes *rate-limited per host*, *retrying with backoff on
429/5xx*, *identified by a real User-Agent*, and (for reads) *cached on disk*.
The TypeScript originals called bare ``fetch`` four times over and had none of
that; a pasted Wikipedia URL hit Wikidata as hard and as often as the client
asked it to.

Two things follow from using it, and both are deliberate:

* **The client is synchronous** (``requests`` + ``time.sleep``). So the handlers
  in :mod:`pinakes.routers.extract` and :mod:`pinakes.routers.translate` are
  ``def``, not ``async def`` — FastAPI runs a sync handler in its threadpool,
  where blocking is fine. An ``async def`` handler calling this would block the
  event loop for every other request in the process.
* **Politeness is per source, so clients are too.** :data:`WIKIMEDIA` keeps the
  one-request-per-second spacing the `Wikimedia User-Agent policy
  <https://meta.wikimedia.org/wiki/User-Agent_policy>`_ asks for. :data:`GOOGLE`
  does not space requests at all: those endpoints are key-authenticated and
  quota-metered by the provider, and `web/src/lib/scraping.ts` translates a
  vocabulary **word by word** — a one-second floor would turn a list of fifty
  words into a minute of waiting for no one's benefit. :data:`OPEN_CONTEXT` and
  :data:`TDAR` are back on the one-second floor: they are small scholarly
  publishers, unkeyed, and an acquisition asks them for one page. All of them
  keep the retry budget, which is the part that matters when an endpoint pushes
  back.

A client is built once per source and shared, because the per-host rate limit
and the counters only mean anything if every request goes through the same one.
"""

from __future__ import annotations

import json
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pinakes_engine.acquire.http import HttpClient, HttpResponse

#: User-Agent identifying this service (not the CLI) to the endpoints below.
USER_AGENT = "pinakes/0.1.0 (ingest; +https://github.com/danieldekerlegand/pinakes)"

#: Where cached reads land. Under the system temp root rather than the corpus —
#: a cached Wikidata response is a transport detail, not an artifact. Same
#: reasoning as :data:`pinakes.engine.acquisition.DEFAULT_CACHE_SUBDIR`.
CACHE_SUBDIR = "pinakes-ingest-cache"


@dataclass(frozen=True, slots=True)
class Source:
    """An upstream, and how politely to approach it."""

    name: str
    """Cache-directory name; also the key clients are memoised under."""

    min_interval: float
    """Minimum seconds between requests to the same host."""


#: Wikidata + Wikipedia. Spaced, per the Wikimedia User-Agent policy.
WIKIMEDIA = Source(name="wikimedia", min_interval=1.0)

#: Google's key-authenticated APIs (Translate, Gemini). Unspaced — see above.
GOOGLE = Source(name="google", min_interval=0.0)

#: Open Context (opencontext.org). A small, grant-funded scholarly publisher with
#: no key and no published quota, so it gets the same one-second floor Wikimedia
#: asks for. One acquisition is one request, so the floor costs a job nothing.
OPEN_CONTEXT = Source(name="open-context", min_interval=1.0)

#: tDAR / Digital Antiquity (core.tdar.org). Same reasoning as Open Context.
TDAR = Source(name="tdar", min_interval=1.0)

_clients: dict[str, HttpClient] = {}


def client(source: Source) -> HttpClient:
    """The shared client for *source*, built on first use."""
    existing = _clients.get(source.name)
    if existing is not None:
        return existing
    built = HttpClient(
        cache_dir=Path(tempfile.gettempdir()) / CACHE_SUBDIR / source.name,
        user_agent=USER_AGENT,
        min_interval=source.min_interval,
    )
    _clients[source.name] = built
    return built


def configure(source: Source, replacement: HttpClient) -> None:
    """Install *replacement* as the client for *source*.

    The test seam, in the shape :mod:`pinakes.engine.graph` uses: a client built
    over a fake transport goes in here and the whole package runs with no
    network. Pair it with :func:`reset` in teardown.
    """
    _clients[source.name] = replacement


def reset() -> None:
    """Forget every configured client. Call in teardown."""
    _clients.clear()


class UpstreamError(RuntimeError):
    """An upstream answered with an error status, or with something unreadable.

    Each caller maps this onto its own refusal — the three TypeScript services
    spelled that differently (``UrlExtractionError``, a bare throw, a
    ``TranslateError``) and the port keeps each spelling where it was.
    """


def read_json(response: HttpResponse, *, context: str) -> Any:
    """Parse *response* as JSON, or raise :class:`UpstreamError` naming *context*."""
    try:
        return json.loads(response.text)
    except ValueError as error:
        raise UpstreamError(
            f"{context} returned a response that is not JSON"
        ) from error


__all__ = [
    "CACHE_SUBDIR",
    "GOOGLE",
    "OPEN_CONTEXT",
    "TDAR",
    "USER_AGENT",
    "WIKIMEDIA",
    "Source",
    "UpstreamError",
    "client",
    "configure",
    "read_json",
    "reset",
]
