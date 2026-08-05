"""Polite, cached HTTP client for acquisition adapters.

Adapters never call :mod:`requests` directly; they go through
:class:`HttpClient`, which makes network access *polite* and *reproducible*:

* a configurable **per-host rate limit** so we never hammer an endpoint;
* **exponential backoff** (honouring ``Retry-After`` when present) on ``429``
  and ``5xx`` responses;
* an on-disk **response cache** keyed on ``(url, params)`` so repeated requests
  — including across runs and tests — skip the network entirely (:meth:`get`
  only: :meth:`post` is rate-limited and retried but never cached, because a
  POST is not a repeatable read);
* a configurable **User-Agent** that identifies the project, as required by the
  `Wikimedia User-Agent policy
  <https://meta.wikimedia.org/wiki/User-Agent_policy>`_.

The wire boundary is the small :class:`Transport` protocol, so tests can inject
a fake transport instead of touching the network.

A single client is meant to be **shared** across an acquisition run — including
across the concurrent workers the orchestration layer fans categories out to.
The per-host rate limit, the hit/miss/retry counters and the I/O timers are
therefore guarded by a lock, so politeness is enforced globally rather than per
worker.

Politeness is enforced **per host and only per host**: the reservation is
computed under the lock but the resulting sleep happens *outside* it, so a slow
host never blocks a request to a different one. That is what makes a
multi-source job concurrent in practice — see
:mod:`pinakes_engine.orchestrate.benchmark` for the measured effect.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from urllib.parse import urlsplit

import requests

#: Default User-Agent identifying the project per the Wikimedia policy. Callers
#: are encouraged to override this with their own contact details.
DEFAULT_USER_AGENT = (
    "pinakes-engine/0.1.0 (+https://github.com/danieldekerlegand/pinakes)"
)


@dataclass(frozen=True)
class HttpStats:
    """Counters describing what a :class:`HttpClient` did over its lifetime.

    Surfaced so an acquisition run report can record cache hit/miss and retry
    activity (see ``docs/data-model.md`` provenance goals), and so a benchmark
    can say *where the time went* rather than guessing
    (:mod:`pinakes_engine.orchestrate.benchmark`).

    The two timers are **aggregated across every caller**, so under ``W``
    concurrent workers they measure worker-seconds and may exceed the run's
    wall-clock. Compare them against summed per-category stage seconds, never
    against wall clock.

    Attributes:
        cache_hits: Responses served from the on-disk cache.
        cache_misses: Responses that had to be fetched.
        retries: Requests retried after a ``429``/``5xx``.
        request_seconds: Time spent inside the transport — the network itself.
        wait_seconds: Time spent *sleeping*: per-host politeness gaps plus
            retry backoff. Deliberately separate from
            :attr:`request_seconds`, because it is the cost of being polite,
            not the cost of the network.
    """

    cache_hits: int = 0
    cache_misses: int = 0
    retries: int = 0
    request_seconds: float = 0.0
    wait_seconds: float = 0.0

    @property
    def network_seconds(self) -> float:
        """Total time attributable to acquisition I/O (transport + politeness)."""
        return self.request_seconds + self.wait_seconds


@dataclass(frozen=True)
class HttpResponse:
    """A minimal, cacheable view of an HTTP response."""

    url: str
    status_code: int
    text: str
    headers: Mapping[str, str]

    def header(self, name: str) -> str | None:
        """Return header *name* case-insensitively, or ``None`` if absent."""
        lowered = name.lower()
        for key, value in self.headers.items():
            if key.lower() == lowered:
                return value
        return None


class Transport(Protocol):
    """The single network operation :class:`HttpClient` depends on."""

    def request(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, str] | None,
        headers: Mapping[str, str],
        timeout: float,
        body: str | None = ...,
    ) -> HttpResponse:
        """Perform one request and return its :class:`HttpResponse`."""
        ...


class RequestsTransport:
    """Default :class:`Transport` backed by a :class:`requests.Session`."""

    def __init__(self, session: requests.Session | None = None) -> None:
        self._session = session if session is not None else requests.Session()

    def request(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, str] | None,
        headers: Mapping[str, str],
        timeout: float,
        body: str | None = None,
    ) -> HttpResponse:
        response = self._session.request(
            method,
            url,
            params=dict(params) if params is not None else None,
            headers=dict(headers),
            timeout=timeout,
            data=body.encode("utf-8") if body is not None else None,
        )
        return HttpResponse(
            url=response.url,
            status_code=response.status_code,
            text=response.text,
            headers=dict(response.headers),
        )


def _is_retryable(status_code: int) -> bool:
    """True for statuses we retry: ``429`` and any ``5xx``."""
    return status_code == 429 or 500 <= status_code < 600


class HttpClient:
    """Rate-limited, retrying, disk-cached HTTP client.

    Args:
        cache_dir: Directory for cached responses (created if missing).
        user_agent: ``User-Agent`` sent on every request.
        min_interval: Minimum seconds between requests to the *same host*.
        max_retries: Retries attempted on ``429``/``5xx`` before giving up.
        backoff_factor: Base for ``backoff_factor * 2 ** attempt`` delays.
        timeout: Per-request timeout in seconds.
        transport: Wire implementation; defaults to :class:`RequestsTransport`.
        sleep: Delay function (injectable for tests).
        monotonic: Monotonic clock (injectable for tests).
    """

    def __init__(
        self,
        *,
        cache_dir: Path | str,
        user_agent: str = DEFAULT_USER_AGENT,
        min_interval: float = 1.0,
        max_retries: int = 4,
        backoff_factor: float = 0.5,
        timeout: float = 30.0,
        transport: Transport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._cache_dir = Path(cache_dir)
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        self._user_agent = user_agent
        self._min_interval = min_interval
        self._max_retries = max_retries
        self._backoff_factor = backoff_factor
        self._timeout = timeout
        self._transport: Transport = (
            transport if transport is not None else RequestsTransport()
        )
        self._sleep = sleep
        self._monotonic = monotonic
        self._last_request: dict[str, float] = {}
        self._cache_hits = 0
        self._cache_misses = 0
        self._retries = 0
        self._request_seconds = 0.0
        self._wait_seconds = 0.0
        #: Guards rate-limit reservations and counters so the client is safe to
        #: share across concurrent acquisition workers.
        self._lock = threading.Lock()

    @property
    def user_agent(self) -> str:
        """The ``User-Agent`` this client sends on every request."""
        return self._user_agent

    @property
    def stats(self) -> HttpStats:
        """A snapshot of the cache/retry counts and I/O timers so far."""
        with self._lock:
            return HttpStats(
                cache_hits=self._cache_hits,
                cache_misses=self._cache_misses,
                retries=self._retries,
                request_seconds=self._request_seconds,
                wait_seconds=self._wait_seconds,
            )

    def get(
        self, url: str, params: Mapping[str, str] | None = None
    ) -> HttpResponse:
        """GET *url* with *params*, using the cache and retrying politely.

        A cache hit returns immediately without touching the network. On a
        miss, the request is rate-limited and retried on ``429``/``5xx``;
        successful (``<400``) responses are written to the cache.
        """
        cached = self._read_cache(url, params)
        if cached is not None:
            with self._lock:
                self._cache_hits += 1
            return cached
        with self._lock:
            self._cache_misses += 1
        response = self._fetch_with_retries("GET", url, params)
        if response.status_code < 400:
            self._write_cache(url, params, response)
        return response

    def post(
        self,
        url: str,
        *,
        body: str,
        params: Mapping[str, str] | None = None,
        content_type: str = "application/json",
        headers: Mapping[str, str] | None = None,
    ) -> HttpResponse:
        """POST *body* to *url*, rate-limited and retried — and **never cached**.

        The politeness and the backoff are the parts a POST wants: an endpoint
        that answers ``429`` deserves the same restraint whichever verb reached
        it. The cache is the part it must not have — a POST is a request to *do*
        something, so replaying a stored answer would silently skip the doing.
        The counters therefore record no hit and no miss for this call.

        *headers* is merged over the ``User-Agent`` and ``Content-Type`` this
        sets, which is how an API key rides as a header rather than as a query
        parameter (a query parameter would end up in a cache key elsewhere, and
        in every log between here and the endpoint).
        """
        merged = {"Content-Type": content_type, **dict(headers or {})}
        return self._fetch_with_retries("POST", url, params, body=body, extra=merged)

    def _fetch_with_retries(
        self,
        method: str,
        url: str,
        params: Mapping[str, str] | None,
        *,
        body: str | None = None,
        extra: Mapping[str, str] | None = None,
    ) -> HttpResponse:
        attempt = 0
        headers = {"User-Agent": self._user_agent, **dict(extra or {})}
        while True:
            self._respect_rate_limit(url)
            started = self._monotonic()
            response = self._send(method, url, params, headers, body)
            self._record_request_seconds(self._monotonic() - started)
            if not _is_retryable(response.status_code):
                return response
            if attempt >= self._max_retries:
                return response
            self._wait(self._retry_delay(response, attempt))
            with self._lock:
                self._retries += 1
            attempt += 1

    def _send(
        self,
        method: str,
        url: str,
        params: Mapping[str, str] | None,
        headers: Mapping[str, str],
        body: str | None,
    ) -> HttpResponse:
        """One transport call, passing ``body`` only when there is one.

        A :class:`Transport` is duck-typed, and every one written before POST
        existed here takes no ``body`` — a GET that started passing the keyword
        unconditionally would break all of them for a value that is always
        ``None``. So the bodyless call stays exactly the call it always was.
        """
        if body is None:
            return self._transport.request(
                method, url, params=params, headers=headers, timeout=self._timeout
            )
        return self._transport.request(
            method,
            url,
            params=params,
            headers=headers,
            timeout=self._timeout,
            body=body,
        )

    def _respect_rate_limit(self, url: str) -> None:
        """Wait until this host's next polite slot, reserving it atomically.

        Under the lock we compute the earliest moment the next request to *host*
        may go out — at least ``min_interval`` after the last one — and record it
        as the new "last request" before releasing. Concurrent workers hitting
        the same host therefore reserve distinct, evenly spaced slots and sleep
        for them independently, so the per-host limit holds across all workers
        without serialising requests to *different* hosts.
        """
        host = urlsplit(url).netloc
        with self._lock:
            now = self._monotonic()
            last = self._last_request.get(host)
            earliest = now if last is None else max(now, last + self._min_interval)
            self._last_request[host] = earliest
        wait = earliest - now
        if wait > 0:
            self._wait(wait)

    def _wait(self, seconds: float) -> None:
        """Sleep *seconds* and bill it to :attr:`HttpStats.wait_seconds`.

        The billed value is the delay we *asked* for, not a measured one: the
        two agree to within scheduler jitter, and reading the clock again here
        would double the clock calls on the hot path for no extra truth.
        """
        self._sleep(seconds)
        with self._lock:
            self._wait_seconds += seconds

    def _record_request_seconds(self, seconds: float) -> None:
        """Bill *seconds* of transport time to :attr:`HttpStats.request_seconds`."""
        with self._lock:
            self._request_seconds += seconds

    def _retry_delay(self, response: HttpResponse, attempt: int) -> float:
        retry_after = response.header("Retry-After")
        if retry_after is not None:
            try:
                return max(0.0, float(retry_after))
            except ValueError:
                pass
        return self._backoff_factor * 2.0**attempt

    def _cache_path(
        self, url: str, params: Mapping[str, str] | None
    ) -> Path:
        key = json.dumps(
            [url, sorted((params or {}).items())], sort_keys=True
        )
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return self._cache_dir / f"{digest}.json"

    def _read_cache(
        self, url: str, params: Mapping[str, str] | None
    ) -> HttpResponse | None:
        path = self._cache_path(url, params)
        if not path.exists():
            return None
        payload = json.loads(path.read_text(encoding="utf-8"))
        return HttpResponse(
            url=payload["url"],
            status_code=payload["status_code"],
            text=payload["text"],
            headers=payload["headers"],
        )

    def _write_cache(
        self,
        url: str,
        params: Mapping[str, str] | None,
        response: HttpResponse,
    ) -> None:
        payload = {
            "url": response.url,
            "status_code": response.status_code,
            "text": response.text,
            "headers": dict(response.headers),
        }
        path = self._cache_path(url, params)
        path.write_text(
            json.dumps(payload, sort_keys=True), encoding="utf-8"
        )
