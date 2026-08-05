"""The write guard as the routes see it (pinakes:60 US-2).

`test_contribution_auth.py` covers the decisions; this file covers where they are
enforced — which endpoints are guarded, what a rejection looks like on the wire,
and which headers ride out on what. The coverage that moved out of the guard half
of `server/routes/contributions.test.ts`.

Every test drives the real app through `unbuilt_client`, with the guard's config
and clock injected (`_auth.configure`) so a window is exhausted in two requests
and no test waits on anything. `conftest.py`'s autouse `reset_write_guard` puts
the module state back afterwards.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from pinakes.contributions import auth
from pinakes.routers import _auth

VALID: dict[str, Any] = {
    "entityType": "civilization",
    "action": "add",
    "entityData": {"name": "Testtopia"},
    "sources": [{"title": "A source", "url": "https://example.org/s"}],
    "confidence": 70,
}

GOOD_KEY = auth.ApiKeyRecord(key="good-key", label="good")


def write(client: TestClient, key: str | None = None) -> int:
    """Submit one valid contribution, presenting *key*, and return the status."""
    headers = {"X-API-Key": key} if key is not None else {}
    status: int = client.post(
        "/api/contributions", json=VALID, headers=headers
    ).status_code
    return status


def guarded(
    *, keys: tuple[auth.ApiKeyRecord, ...] = (GOOD_KEY,), max_requests: int = 60
) -> None:
    """Install a config with *keys* and a stopped clock at epoch 0."""
    _auth.configure(
        config=auth.ApiAuthConfig(
            keys=keys,
            rate_limit=auth.RateLimitConfig(window_ms=1000, max=max_requests),
        ),
        now=lambda: 0.0,
    )


# ── Open by default ──────────────────────────────────────────────────────────


def test_writes_are_open_when_no_keys_are_configured(
    unbuilt_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The backward-compatible default. A checkout that has configured no
    secrets still accepts contributions from its own client."""
    monkeypatch.delenv(auth.API_KEYS_ENV, raising=False)
    assert write(unbuilt_client) == 201


def test_an_unguarded_write_is_still_counted(
    unbuilt_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Rate limiting is not conditional on auth — an open surface is exactly the
    one that needs a ceiling. With no key to attribute to, the client address is
    the identity."""
    monkeypatch.delenv(auth.API_KEYS_ENV, raising=False)
    _auth.configure(
        config=auth.ApiAuthConfig(
            keys=(), rate_limit=auth.RateLimitConfig(window_ms=1000, max=1)
        ),
        now=lambda: 0.0,
    )
    assert write(unbuilt_client) == 201
    assert write(unbuilt_client) == 429


# ── Authentication ───────────────────────────────────────────────────────────


def test_a_write_with_no_key_is_a_401_naming_both_headers(
    unbuilt_client: TestClient,
) -> None:
    guarded()
    response = unbuilt_client.post("/api/contributions", json=VALID)
    assert response.status_code == 401
    assert "X-API-Key" in response.json()["message"]


def test_a_write_with_an_unknown_key_is_a_403(unbuilt_client: TestClient) -> None:
    guarded()
    response = unbuilt_client.post(
        "/api/contributions", json=VALID, headers={"X-API-Key": "wrong"}
    )
    assert response.status_code == 403
    assert response.json() == {"message": auth.INVALID_KEY_ERROR}


@pytest.mark.parametrize(
    "headers",
    [{"X-API-Key": "good-key"}, {"Authorization": "Bearer good-key"}],
    ids=["x-api-key", "bearer"],
)
def test_a_write_with_a_valid_key_is_queued(
    unbuilt_client: TestClient, headers: dict[str, str]
) -> None:
    guarded()
    response = unbuilt_client.post("/api/contributions", json=VALID, headers=headers)
    assert response.status_code == 201


def test_a_rejected_write_never_reaches_the_queue(unbuilt_client: TestClient) -> None:
    """The guard runs before the handler, so an unauthenticated submission is not
    a queued-then-hidden record — it does not exist."""
    guarded()
    assert write(unbuilt_client) == 401
    assert unbuilt_client.get("/api/contributions").json()["total"] == 0


def test_the_review_endpoint_is_guarded_too(unbuilt_client: TestClient) -> None:
    """Approving is the decision that can reach the corpus; it is the other
    write, and it is guarded on the same terms as submitting."""
    guarded()
    queued = unbuilt_client.post(
        "/api/contributions", json=VALID, headers={"X-API-Key": "good-key"}
    ).json()["contribution"]

    unauthenticated = unbuilt_client.patch(
        f"/api/contributions/{queued['id']}/review", json={"decision": "approved"}
    )
    assert unauthenticated.status_code == 401

    authenticated = unbuilt_client.patch(
        f"/api/contributions/{queued['id']}/review",
        json={"decision": "approved"},
        headers={"X-API-Key": "good-key"},
    )
    assert authenticated.status_code == 200
    assert authenticated.json()["status"] == "approved"


# ── What stays open ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "path",
    [
        "/api/contributions",
        "/api/contributions/stats",
        "/api/contributions/export",
        "/api/contributions/entity/civilization/nope",
        "/api/ai-review",
    ],
    ids=["list", "stats", "export", "by-entity", "ai-drafts"],
)
def test_reads_are_never_guarded(unbuilt_client: TestClient, path: str) -> None:
    guarded()
    assert unbuilt_client.get(path).status_code == 200


def test_the_ai_draft_review_is_not_guarded(unbuilt_client: TestClient) -> None:
    """It was not guarded on Express either. That surface is reached through the
    reviewer's own session, not through the public contribution key — porting the
    guard onto it here would be a new policy, not a port."""
    guarded()
    response = unbuilt_client.patch(
        "/api/ai-review/nope",
        json={"decision": "approved", "reviewer": "someone"},
    )
    assert response.status_code == 404  # the handler's own answer, not the guard's


# ── Rate limiting ────────────────────────────────────────────────────────────


def test_the_quota_headers_ride_out_on_an_accepted_write(
    unbuilt_client: TestClient,
) -> None:
    guarded(max_requests=3)
    response = unbuilt_client.post(
        "/api/contributions", json=VALID, headers={"X-API-Key": "good-key"}
    )
    assert response.status_code == 201
    assert response.headers["x-ratelimit-limit"] == "3"
    assert response.headers["x-ratelimit-remaining"] == "2"
    assert response.headers["x-ratelimit-reset"] == "1"  # ceil(1000ms / 1000)


def test_exceeding_the_quota_is_a_429_that_says_when_to_come_back(
    unbuilt_client: TestClient,
) -> None:
    guarded(max_requests=1)
    assert write(unbuilt_client, "good-key") == 201

    blocked = unbuilt_client.post(
        "/api/contributions", json=VALID, headers={"X-API-Key": "good-key"}
    )
    assert blocked.status_code == 429
    assert blocked.json() == {
        "message": _auth.RATE_LIMIT_EXCEEDED,
        "retryAfterMs": 1000,
    }
    assert blocked.headers["retry-after"] == "1"
    assert blocked.headers["x-ratelimit-remaining"] == "0"


def test_each_key_carries_its_own_quota(unbuilt_client: TestClient) -> None:
    """Identity is the presenting key, not the address — two partners sharing a
    NAT must not share a ceiling."""
    other = auth.ApiKeyRecord(key="other-key", label="other")
    guarded(keys=(GOOD_KEY, other), max_requests=1)

    for key in ("good-key", "other-key"):
        assert write(unbuilt_client, key) == 201, key

    assert write(unbuilt_client, "good-key") == 429


def test_a_401_carries_no_quota_headers(unbuilt_client: TestClient) -> None:
    """A request that never authenticated was never counted, so reporting a
    remaining quota on it would be reporting somebody else's."""
    guarded()
    response = unbuilt_client.post("/api/contributions", json=VALID)
    assert response.status_code == 401
    assert "x-ratelimit-limit" not in response.headers


def test_the_quota_refreshes_once_the_window_has_elapsed(
    unbuilt_client: TestClient,
) -> None:
    guarded(max_requests=1)
    assert write(unbuilt_client, "good-key") == 201
    assert write(unbuilt_client, "good-key") == 429

    _auth.configure(now=lambda: 1000.0)
    assert write(unbuilt_client, "good-key") == 201


# ── The environment is the switch ────────────────────────────────────────────


def test_configuring_keys_is_what_turns_auth_on(
    unbuilt_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No second switch: the guard reads the environment on first use, and a
    configured key set is itself the instruction to enforce it."""
    monkeypatch.setenv(auth.API_KEYS_ENV, "env-key:CI")
    assert write(unbuilt_client) == 401
    assert write(unbuilt_client, "env-key") == 201
