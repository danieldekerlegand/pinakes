"""API-key auth + per-key rate limiting for the contribution write side.

The port of `server/services/api-auth.ts` (US-011 over there). Two concerns, both
pure or clock-injected so they are testable with no live environment and no wall
clock: authenticate a presented key against the configured set, then count that
identity's requests inside a fixed window. The HTTP half — reading a `Request`,
shaping the rejection, emitting the `X-RateLimit-*` headers — lives in
:mod:`pinakes.routers._auth`; nothing in here imports FastAPI.

**Open by default, and deliberately so.** With ``$CONTRIBUTION_API_KEYS`` unset
there are no keys, :func:`authenticate` returns "authenticated as nobody", and
every write passes — the same backward-compatible default the TypeScript server
shipped, so a checkout with no secrets configured still accepts contributions
from its own client. Configuring the variable is what *turns auth on*; there is
no separate switch, and no way to configure keys without enforcing them.

Rate limiting still applies when auth is off, keyed on the client address rather
than on a key — an open surface is exactly the one that needs a ceiling.

Read endpoints are never guarded. A contribution is queued, never applied, so the
thing worth protecting is the queue's write side, not the reading of a queue the
client is already showing.
"""

from __future__ import annotations

import hmac
import math
import os
from collections.abc import Mapping
from typing import Literal, NamedTuple

from pinakes.contributions.store import parse_int_js

#: Comma-separated ``key`` or ``key:label`` entries. Unset ⇒ auth disabled.
API_KEYS_ENV = "CONTRIBUTION_API_KEYS"
#: Requests allowed per identity per window. Non-positive/junk ⇒ the default.
RATE_LIMIT_MAX_ENV = "CONTRIBUTION_RATE_LIMIT_MAX"
#: Window length in milliseconds. Non-positive/junk ⇒ the default.
RATE_LIMIT_WINDOW_MS_ENV = "CONTRIBUTION_RATE_LIMIT_WINDOW_MS"


class ApiKeyRecord(NamedTuple):
    """One configured key and the non-secret label it is attributed by."""

    key: str
    """The secret value a client presents."""

    label: str
    """A human-readable name for logs — never the whole secret."""


class RateLimitConfig(NamedTuple):
    """A fixed window: at most *max* requests per *window_ms*."""

    window_ms: int
    max: int


#: 60 requests a minute — the TypeScript server's numbers, kept so a client that
#: was inside the old ceiling is inside this one.
DEFAULT_RATE_LIMIT = RateLimitConfig(window_ms=60_000, max=60)


class ApiAuthConfig(NamedTuple):
    """The whole guard's configuration. Empty ``keys`` ⇒ auth disabled."""

    keys: tuple[ApiKeyRecord, ...]
    rate_limit: RateLimitConfig


def _default_label(key: str) -> str:
    """A short, non-secret display label derived from a key."""
    return f"{key[:2]}…" if len(key) <= 6 else f"{key[:6]}…"


def parse_api_keys(raw: str | None) -> tuple[ApiKeyRecord, ...]:
    """Parse ``$CONTRIBUTION_API_KEYS``: ``key`` or ``key:label``, comma-separated.

    Blank entries are dropped rather than rejected — a trailing comma in a
    deployment's env file must not be the difference between a guarded API and a
    process that will not start.
    """
    if not raw:
        return ()
    records: list[ApiKeyRecord] = []
    for entry in (part.strip() for part in raw.split(",")):
        if not entry:
            continue
        key, separator, label = entry.partition(":")
        key = key.strip()
        if not key:
            continue
        label = label.strip() if separator else ""
        records.append(ApiKeyRecord(key=key, label=label or _default_label(key)))
    return tuple(records)


def _positive_int(raw: str | None, fallback: int) -> int:
    """``parseInt`` the way the TypeScript loader did, then demand a positive.

    ``Number.parseInt`` yields ``NaN`` for junk and for an unset variable alike,
    and the guard was ``Number.isFinite(n) && n > 0`` — so garbage, a negative
    and an absent value all fall back to the same default rather than failing the
    boot. :func:`~pinakes.contributions.store.parse_int_js` is that same parse.
    """
    parsed = parse_int_js(raw)
    if parsed is None or math.isnan(parsed) or parsed <= 0:
        return fallback
    return int(parsed)


def load_api_auth_config(env: Mapping[str, str] | None = None) -> ApiAuthConfig:
    """Build the configuration from the environment."""
    source = os.environ if env is None else env
    return ApiAuthConfig(
        keys=parse_api_keys(source.get(API_KEYS_ENV)),
        rate_limit=RateLimitConfig(
            window_ms=_positive_int(
                source.get(RATE_LIMIT_WINDOW_MS_ENV), DEFAULT_RATE_LIMIT.window_ms
            ),
            max=_positive_int(
                source.get(RATE_LIMIT_MAX_ENV), DEFAULT_RATE_LIMIT.max
            ),
        ),
    )


class AuthOk(NamedTuple):
    """The request may proceed. ``key`` is ``None`` when auth is disabled."""

    key: ApiKeyRecord | None


class AuthRejected(NamedTuple):
    """The request must not proceed, with the status the route should answer."""

    status: Literal[401, 403]
    error: str


#: The two arms are discriminated by :func:`isinstance`, not by an ``ok`` flag —
#: a rejection has no key and an acceptance has no status, and spelling that as
#: one optional-everything record is how a caller ends up reading a field that
#: was never set on the arm it actually got.
AuthResult = AuthOk | AuthRejected

MISSING_KEY_ERROR = (
    "API key required. Provide an 'X-API-Key' header or "
    "'Authorization: Bearer <key>'."
)
INVALID_KEY_ERROR = "Invalid API key."


def extract_api_key(headers: Mapping[str, str]) -> str | None:
    """The key a request presents, or ``None``.

    ``X-API-Key`` wins over ``Authorization: Bearer …`` when both are set: the
    dedicated header is the unambiguous statement of intent, and a `Bearer` token
    may well be some other system's, forwarded by a proxy.

    *headers* is looked up in lower case, which is what both Node's
    ``IncomingHttpHeaders`` and Starlette's case-insensitive ``Headers`` give.
    """
    api_key = headers.get("x-api-key")
    if api_key is not None and api_key.strip():
        return api_key.strip()

    authorization = headers.get("authorization")
    if authorization is not None:
        candidate = authorization.strip()
        prefix = candidate[:6].lower()
        if prefix == "bearer":
            token = candidate[6:]
            # `^Bearer\s+(.+)$`: at least one space, then something non-blank.
            if token[:1].isspace() and token.strip():
                return token.strip()
    return None


def _secret_equal(a: str, b: str) -> bool:
    """Constant-time comparison, length-guarded.

    ``hmac.compare_digest`` on the raw bytes: a plain ``==`` returns as soon as
    two bytes differ, which leaks how much of a guessed key was right. The
    explicit length check is not a weakening — the lengths are already
    distinguishable from the timing of the comparison itself.
    """
    left = a.encode("utf-8")
    right = b.encode("utf-8")
    if len(left) != len(right):
        return False
    return hmac.compare_digest(left, right)


def authenticate(config: ApiAuthConfig, headers: Mapping[str, str]) -> AuthResult:
    """Authenticate a request against the configured keys.

    No keys configured ⇒ open (``AuthOk(key=None)``). Otherwise: nothing
    presented is a **401** (the caller may not know a key is needed), an unknown
    key is a **403** (the caller authenticated, and is not welcome) — the
    distinction the TypeScript guard drew, and the one a client can act on.
    """
    if not config.keys:
        return AuthOk(key=None)

    presented = extract_api_key(headers)
    if presented is None:
        return AuthRejected(status=401, error=MISSING_KEY_ERROR)

    for record in config.keys:
        if _secret_equal(record.key, presented):
            return AuthOk(key=record)
    return AuthRejected(status=403, error=INVALID_KEY_ERROR)


class RateLimitResult(NamedTuple):
    """The verdict for one request, and the numbers the headers report."""

    allowed: bool
    limit: int
    remaining: int
    reset_at: float
    """Epoch-ms at which the current window resets."""

    retry_after_ms: float
    """Ms until the window resets. ``0`` when the request was allowed."""


class _Bucket(NamedTuple):
    """One identity's window. ``hits``, not ``count`` — a NamedTuple field named
    `count` would shadow ``tuple.count`` and mypy refuses it."""

    hits: int
    window_start: float


class RateLimiter:
    """An in-memory fixed-window counter, one bucket per identity.

    Stateful — the counters are the point — but the clock is a parameter of
    :meth:`check`, so a window boundary is something a test states rather than
    something it waits for.

    Fixed windows, not a sliding log, because the failure mode of a fixed window
    (a burst straddling the boundary can reach 2×max) is far cheaper here than
    keeping a timestamp per request would be. In-memory, so the counters are
    per-process and reset on deploy; a multi-process deployment that needs a
    shared ceiling wants a shared store, and this is not it.
    """

    def __init__(self, config: RateLimitConfig = DEFAULT_RATE_LIMIT) -> None:
        self._window_ms = config.window_ms
        self._max = config.max
        self._buckets: dict[str, _Bucket] = {}

    def check(self, identity: str, now: float) -> RateLimitResult:
        """Count one request from *identity* at *now* (epoch-ms) and rule on it."""
        bucket = self._buckets.get(identity)

        # Unseen identity, or the previous window has fully elapsed → start fresh.
        if bucket is None or now - bucket.window_start >= self._window_ms:
            self._buckets[identity] = _Bucket(hits=1, window_start=now)
            return RateLimitResult(
                allowed=True,
                limit=self._max,
                remaining=self._max - 1,
                reset_at=now + self._window_ms,
                retry_after_ms=0,
            )

        reset_at = bucket.window_start + self._window_ms

        if bucket.hits >= self._max:
            return RateLimitResult(
                allowed=False,
                limit=self._max,
                remaining=0,
                reset_at=reset_at,
                retry_after_ms=max(0.0, reset_at - now),
            )

        self._buckets[identity] = bucket._replace(hits=bucket.hits + 1)
        return RateLimitResult(
            allowed=True,
            limit=self._max,
            remaining=self._max - bucket.hits - 1,
            reset_at=reset_at,
            retry_after_ms=0,
        )

    def reset(self) -> None:
        """Drop every counter (test teardown / a manual flush)."""
        self._buckets.clear()
