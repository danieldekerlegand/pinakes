"""Tests for the polite, cached HTTP client.

A fake :class:`~pinakes_engine.acquire.http.Transport` stands in for the network
so we can assert caching, rate limiting, and backoff behaviour deterministically.
"""

import threading
from collections.abc import Mapping
from pathlib import Path

import pytest

from pinakes_engine.acquire import HttpClient, HttpResponse


class _FakeTransport:
    """Transport that replays a queued list of responses and records calls."""

    def __init__(self, responses: list[HttpResponse]) -> None:
        self._responses = list(responses)
        self.calls: list[tuple[str, str, dict[str, str], dict[str, str]]] = []

    def request(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, str] | None,
        headers: Mapping[str, str],
        timeout: float,
    ) -> HttpResponse:
        self.calls.append((method, url, dict(params or {}), dict(headers)))
        if not self._responses:
            raise AssertionError("unexpected extra request")
        return self._responses.pop(0)


def _ok(text: str = "ok", url: str = "https://example.org/q") -> HttpResponse:
    return HttpResponse(url=url, status_code=200, text=text, headers={})


def _client(
    tmp_path: Path,
    transport: _FakeTransport,
    sleeps: list[float],
    **kwargs: object,
) -> HttpClient:
    return HttpClient(
        cache_dir=tmp_path,
        min_interval=0.0,
        transport=transport,
        sleep=sleeps.append,
        **kwargs,  # type: ignore[arg-type]
    )


def test_cache_hit_avoids_second_network_call(tmp_path: Path) -> None:
    transport = _FakeTransport([_ok("first")])
    sleeps: list[float] = []
    client = _client(tmp_path, transport, sleeps)

    first = client.get("https://example.org/q", {"a": "1"})
    second = client.get("https://example.org/q", {"a": "1"})

    assert first.text == second.text == "first"
    assert len(transport.calls) == 1  # second call served from disk cache


def test_429_triggers_backoff_then_retry(tmp_path: Path) -> None:
    transport = _FakeTransport(
        [
            HttpResponse("u", 429, "slow down", {}),
            _ok("recovered"),
        ]
    )
    sleeps: list[float] = []
    client = _client(tmp_path, transport, sleeps, backoff_factor=0.5)

    response = client.get("https://example.org/q")

    assert response.status_code == 200
    assert response.text == "recovered"
    assert len(transport.calls) == 2
    assert sleeps == [0.5]  # backoff_factor * 2**0


def test_5xx_is_retried(tmp_path: Path) -> None:
    transport = _FakeTransport(
        [HttpResponse("u", 503, "down", {}), _ok("up")]
    )
    sleeps: list[float] = []
    client = _client(tmp_path, transport, sleeps, backoff_factor=1.0)

    response = client.get("https://example.org/q")

    assert response.status_code == 200
    assert sleeps == [1.0]


def test_retry_after_header_overrides_backoff(tmp_path: Path) -> None:
    transport = _FakeTransport(
        [
            HttpResponse("u", 429, "wait", {"Retry-After": "7"}),
            _ok(),
        ]
    )
    sleeps: list[float] = []
    client = _client(tmp_path, transport, sleeps, backoff_factor=0.5)

    client.get("https://example.org/q")

    assert sleeps == [7.0]


def test_retries_exhausted_returns_last_response(tmp_path: Path) -> None:
    transport = _FakeTransport([HttpResponse("u", 500, "err", {})] * 3)
    sleeps: list[float] = []
    client = _client(tmp_path, transport, sleeps, max_retries=2)

    response = client.get("https://example.org/q")

    assert response.status_code == 500
    assert len(transport.calls) == 3  # initial try + 2 retries
    assert len(sleeps) == 2


def test_error_responses_are_not_cached(tmp_path: Path) -> None:
    transport = _FakeTransport(
        [HttpResponse("u", 500, "err", {}), _ok("later")]
    )
    sleeps: list[float] = []
    client = _client(tmp_path, transport, sleeps, max_retries=0)

    first = client.get("https://example.org/q")
    second = client.get("https://example.org/q")

    assert first.status_code == 500
    assert second.text == "later"  # not served from cache; refetched


def test_user_agent_header_is_sent(tmp_path: Path) -> None:
    transport = _FakeTransport([_ok()])
    sleeps: list[float] = []
    client = _client(
        tmp_path, transport, sleeps, user_agent="pinakes-engine/test (contact)"
    )

    client.get("https://example.org/q")

    _, _, _, headers = transport.calls[0]
    assert headers["User-Agent"] == "pinakes-engine/test (contact)"


def test_cache_key_distinguishes_params(tmp_path: Path) -> None:
    transport = _FakeTransport([_ok("a"), _ok("b")])
    sleeps: list[float] = []
    client = _client(tmp_path, transport, sleeps)

    first = client.get("https://example.org/q", {"x": "1"})
    second = client.get("https://example.org/q", {"x": "2"})

    assert first.text == "a"
    assert second.text == "b"
    assert len(transport.calls) == 2


def test_stats_track_cache_hits_misses_and_retries(tmp_path: Path) -> None:
    transport = _FakeTransport(
        [HttpResponse("u", 503, "down", {}), _ok("up")]
    )
    sleeps: list[float] = []
    client = _client(tmp_path, transport, sleeps, backoff_factor=1.0)

    client.get("https://example.org/q")  # miss + one retry
    client.get("https://example.org/q")  # served from cache

    assert client.stats.cache_misses == 1
    assert client.stats.cache_hits == 1
    assert client.stats.retries == 1


def test_per_host_rate_limit_sleeps_between_requests(tmp_path: Path) -> None:
    transport = _FakeTransport([_ok("a"), _ok("b")])
    sleeps: list[float] = []
    clock = iter([0.0, 0.3, 0.3])  # second request starts 0.3s after the first
    client = HttpClient(
        cache_dir=tmp_path,
        min_interval=1.0,
        transport=transport,
        sleep=sleeps.append,
        monotonic=lambda: next(clock),
    )

    client.get("https://example.org/a")
    client.get("https://example.org/b")  # same host, different path

    assert sleeps == [pytest.approx(0.7)]  # 1.0 - 0.3 elapsed


class _ConstantTransport:
    """Thread-safe transport that answers any request with a fixed 200."""

    def request(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, str] | None,
        headers: Mapping[str, str],
        timeout: float,
    ) -> HttpResponse:
        return HttpResponse(url=url, status_code=200, text="ok", headers={})


def test_rate_limit_reserves_a_slot_per_concurrent_worker(tmp_path: Path) -> None:
    # Four workers hit the same host at the same instant (monotonic frozen at 0).
    # A shared client must hand each a distinct, evenly spaced slot, so three of
    # them wait one, two and three intervals respectively — the limit holds
    # across workers, not just within one.
    sleeps: list[float] = []
    lock = threading.Lock()

    def record(seconds: float) -> None:
        with lock:
            sleeps.append(seconds)

    client = HttpClient(
        cache_dir=tmp_path,
        min_interval=1.0,
        transport=_ConstantTransport(),
        sleep=record,
        monotonic=lambda: 0.0,
    )

    def worker(index: int) -> None:
        client.get(f"https://example.org/{index}")  # same host, distinct cache key

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(sleeps) == [1.0, 2.0, 3.0]


class _BodyTransport:
    """Transport that records the body it was handed, and answers 200 or a script."""

    def __init__(self, responses: list[HttpResponse] | None = None) -> None:
        self._responses = list(responses or [])
        self.calls: list[tuple[str, str, dict[str, str], str | None]] = []

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
        self.calls.append((method, url, dict(headers), body))
        if self._responses:
            return self._responses.pop(0)
        return HttpResponse(url=url, status_code=200, text="ok", headers={})


def test_post_sends_the_body_and_the_declared_content_type(tmp_path: Path) -> None:
    transport = _BodyTransport()
    sleeps: list[float] = []
    client = _client(tmp_path, transport, sleeps)

    response = client.post(
        "https://example.org/q", body='{"a":1}', headers={"X-Api-Key": "k"}
    )

    assert response.status_code == 200
    method, _, headers, body = transport.calls[0]
    assert method == "POST"
    assert body == '{"a":1}'
    assert headers["Content-Type"] == "application/json"
    # An extra header rides alongside the User-Agent rather than replacing it.
    assert headers["X-Api-Key"] == "k"
    assert headers["User-Agent"]


def test_post_is_never_cached(tmp_path: Path) -> None:
    """A POST asks for something to happen; a cached answer would skip the doing."""
    transport = _BodyTransport()
    sleeps: list[float] = []
    client = _client(tmp_path, transport, sleeps)

    client.post("https://example.org/q", body="same")
    client.post("https://example.org/q", body="same")

    assert len(transport.calls) == 2
    assert client.stats.cache_hits == 0
    assert client.stats.cache_misses == 0


def test_post_is_rate_limited_and_retried_like_a_get(tmp_path: Path) -> None:
    transport = _BodyTransport(
        [HttpResponse("u", 429, "slow down", {}), HttpResponse("u", 200, "ok", {})]
    )
    sleeps: list[float] = []
    client = HttpClient(
        cache_dir=tmp_path,
        min_interval=0.0,
        transport=transport,
        sleep=sleeps.append,
        backoff_factor=0.5,
    )

    response = client.post("https://example.org/q", body="x")

    assert response.status_code == 200
    assert len(transport.calls) == 2
    assert sleeps == [0.5]
    assert client.stats.retries == 1


def test_a_get_never_passes_a_body_to_its_transport(tmp_path: Path) -> None:
    """Every transport written before POST existed takes no `body` keyword.

    `_FakeTransport` is one of them — it is the guard, not just a stand-in.
    """
    transport = _FakeTransport([_ok()])
    sleeps: list[float] = []
    client = _client(tmp_path, transport, sleeps)

    assert client.get("https://example.org/q").status_code == 200
