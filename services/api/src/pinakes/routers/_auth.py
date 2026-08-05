"""The write guard mounted on the contribution write endpoints.

The HTTP half of :mod:`pinakes.contributions.auth`: read the headers off a
request, authenticate, count the request against its identity's window, and turn
a refusal into a response. Underscore-prefixed, so the router scanner treats it
as a helper rather than as a route group (see :mod:`pinakes.routers`).

**A dependency that returns a rejection instead of raising one.** FastAPI wraps
anything raised as ``HTTPException`` into ``{"detail": …}``, and this surface
answers ``{"message": …}`` everywhere else — including the 400s and 404s next to
these very handlers. So :func:`write_guard` hands back a :class:`WriteGuard`
whose ``rejection`` the handler returns as its first act::

    def submit(guard: WriteGuard = Depends(write_guard), ...):
        if guard.rejection is not None:
            return guard.rejection

Two lines of visible ceremony per guarded route, and in exchange the guard needs
no exception handler registered on the app — which matters more than it looks:
``app.py`` is the file every parallel port tasklist is forbidden to touch.

The `X-RateLimit-*` headers ride out on *allowed* responses through the injected
``Response``, which FastAPI merges into whatever the handler returns, and on a
429 through the rejection itself. A 401/403 carries none, because a request that
never authenticated was never counted against a quota.
"""

from __future__ import annotations

import math
import time
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import Request, Response
from fastapi.responses import JSONResponse

from pinakes.contributions import auth

RATE_LIMIT_EXCEEDED = "Rate limit exceeded. Please retry later."


def default_clock() -> float:
    """Epoch milliseconds, as an integer — ``Date.now()``.

    Integral on purpose: ``retryAfterMs`` is echoed to the client in the 429
    body, and the TypeScript server, reading an integer clock, never put a
    fractional millisecond there.
    """
    return time.time_ns() // 1_000_000


@dataclass(frozen=True, slots=True)
class WriteGuard:
    """What the guard decided about one request.

    ``rejection`` is ``None`` exactly when the handler may proceed. ``key`` is
    the record the caller authenticated as — ``None`` both when auth is disabled
    and when the request was rejected.
    """

    rejection: JSONResponse | None
    key: auth.ApiKeyRecord | None


_config: auth.ApiAuthConfig | None = None
_limiter: auth.RateLimiter | None = None
_clock: Callable[[], float] = default_clock


def configure(
    *,
    config: auth.ApiAuthConfig | None = None,
    limiter: auth.RateLimiter | None = None,
    now: Callable[[], float] | None = None,
) -> None:
    """Install the handles the guard runs on — the test seam.

    The same injection the TypeScript ``createContributionWriteGuard(options)``
    offered, moved from a constructor to module state because there is no
    registration call here to pass options to: a router module is discovered, not
    constructed. Passing a fixed *config* and a fixed *now* is what lets a test
    exhaust a window in three requests and no wall-clock at all.
    """
    global _config, _limiter, _clock
    if config is not None:
        _config = config
        # A limiter built over the previous config would keep enforcing the
        # previous window, so replace it unless one was named explicitly.
        _limiter = limiter if limiter is not None else auth.RateLimiter(
            config.rate_limit
        )
    elif limiter is not None:
        _limiter = limiter
    if now is not None:
        _clock = now


def reset() -> None:
    """Forget the configured handles and every counter. Teardown for `configure`.

    Autouse in `conftest.py`: the limiter is process-wide state, so without this
    the sixty-first write in a session would 429 in whichever test happened to
    make it.
    """
    global _config, _limiter, _clock
    _config = None
    _limiter = None
    _clock = default_clock


def _handles() -> tuple[auth.ApiAuthConfig, auth.RateLimiter, Callable[[], float]]:
    """The configuration and counters, built from the environment on first use.

    Read once and cached, not per request — the counters have to outlive the
    request that opened their window, and a config re-read would have to rebuild
    them to stay consistent with it. That is also when the TypeScript server read
    its environment: once, as the routes were registered.
    """
    global _config, _limiter
    if _config is None:
        _config = auth.load_api_auth_config()
        _limiter = auth.RateLimiter(_config.rate_limit)
    if _limiter is None:
        _limiter = auth.RateLimiter(_config.rate_limit)
    return _config, _limiter, _clock


def _identity(key: auth.ApiKeyRecord | None, request: Request) -> str:
    """Whose quota this request spends.

    The presenting key when there is one, so an authenticated caller carries its
    own ceiling from wherever it happens to be running; the client address
    otherwise, which is all an open deployment has to go on. The prefixes keep
    the two namespaces from ever colliding on a shared bucket.
    """
    if key is not None:
        return f"key:{key.key}"
    client = request.client
    return f"ip:{client.host if client is not None else 'unknown'}"


def _rate_limit_headers(result: auth.RateLimitResult) -> dict[str, str]:
    """The conventional `X-RateLimit-*` trio. Seconds, per the convention."""
    return {
        "X-RateLimit-Limit": str(result.limit),
        "X-RateLimit-Remaining": str(result.remaining),
        "X-RateLimit-Reset": str(math.ceil(result.reset_at / 1000)),
    }


def write_guard(request: Request, response: Response) -> WriteGuard:
    """Authenticate and rate-limit one contribution write."""
    config, limiter, now = _handles()

    outcome = auth.authenticate(config, request.headers)
    if isinstance(outcome, auth.AuthRejected):
        return WriteGuard(
            rejection=JSONResponse(
                status_code=outcome.status, content={"message": outcome.error}
            ),
            key=None,
        )

    result = limiter.check(_identity(outcome.key, request), now())
    headers = _rate_limit_headers(result)

    if not result.allowed:
        headers["Retry-After"] = str(math.ceil(result.retry_after_ms / 1000))
        return WriteGuard(
            rejection=JSONResponse(
                status_code=429,
                content={
                    "message": RATE_LIMIT_EXCEEDED,
                    "retryAfterMs": result.retry_after_ms,
                },
                headers=headers,
            ),
            key=outcome.key,
        )

    response.headers.update(headers)
    return WriteGuard(rejection=None, key=outcome.key)
