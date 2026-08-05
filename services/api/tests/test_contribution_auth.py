"""The pure half of the contribution write guard (pinakes:60 US-2).

The coverage that moved with the code out of `server/services/api-auth.test.ts`.
Nothing here touches HTTP: the config comes from a dict, the clock is an
argument, and the guard's route-level behaviour is `test_contribution_write_guard.py`.
"""

from __future__ import annotations

from pinakes.contributions import auth

# ── Parsing the key list ─────────────────────────────────────────────────────


def test_no_configured_keys_parses_to_nothing() -> None:
    """Unset, empty and all-blank are the same thing: an open API."""
    assert auth.parse_api_keys(None) == ()
    assert auth.parse_api_keys("") == ()
    assert auth.parse_api_keys("   ,  ") == ()


def test_bare_keys_and_labelled_keys_both_parse() -> None:
    keys = auth.parse_api_keys("secret-abc, key-two:Partner Bot ")
    assert len(keys) == 2
    assert keys[0].key == "secret-abc"
    assert keys[1] == auth.ApiKeyRecord(key="key-two", label="Partner Bot")


def test_a_bare_key_gets_a_label_that_is_not_the_secret() -> None:
    """The label goes in logs, so it must not carry the whole key."""
    (record,) = auth.parse_api_keys("supersecretvalue")
    assert record.key == "supersecretvalue"
    assert record.label == "supers…"
    assert "value" not in record.label


def test_a_short_key_is_truncated_harder() -> None:
    (record,) = auth.parse_api_keys("abc123")
    assert record.label == "ab…"


def test_an_empty_label_falls_back_to_the_derived_one() -> None:
    (record,) = auth.parse_api_keys("supersecretvalue:")
    assert record.label == "supers…"


def test_an_entry_with_no_key_is_dropped() -> None:
    """`:label` names nothing; it must not become a key that matches ''."""
    assert auth.parse_api_keys(":orphan-label") == ()


# ── Loading the configuration ────────────────────────────────────────────────


def test_an_empty_environment_is_open_with_default_limits() -> None:
    config = auth.load_api_auth_config({})
    assert config.keys == ()
    assert config.rate_limit == auth.DEFAULT_RATE_LIMIT


def test_keys_and_limits_are_read_from_the_environment() -> None:
    config = auth.load_api_auth_config(
        {
            auth.API_KEYS_ENV: "k1,k2:two",
            auth.RATE_LIMIT_MAX_ENV: "5",
            auth.RATE_LIMIT_WINDOW_MS_ENV: "1000",
        }
    )
    assert [record.key for record in config.keys] == ["k1", "k2"]
    assert config.rate_limit == auth.RateLimitConfig(window_ms=1000, max=5)


def test_junk_or_non_positive_limits_fall_back_to_the_defaults() -> None:
    """A typo in a rate-limit variable must not be able to disable the ceiling."""
    config = auth.load_api_auth_config(
        {auth.RATE_LIMIT_MAX_ENV: "-3", auth.RATE_LIMIT_WINDOW_MS_ENV: "nope"}
    )
    assert config.rate_limit == auth.DEFAULT_RATE_LIMIT

    zeroed = auth.load_api_auth_config({auth.RATE_LIMIT_MAX_ENV: "0"})
    assert zeroed.rate_limit.max == auth.DEFAULT_RATE_LIMIT.max


# ── Reading the presented key ────────────────────────────────────────────────


def test_the_dedicated_header_is_read_and_trimmed() -> None:
    assert auth.extract_api_key({"x-api-key": "  abc "}) == "abc"


def test_a_bearer_token_is_read_case_insensitively() -> None:
    assert auth.extract_api_key({"authorization": "Bearer tok-1"}) == "tok-1"
    assert auth.extract_api_key({"authorization": "bearer tok-2"}) == "tok-2"


def test_the_dedicated_header_wins_over_authorization() -> None:
    """An `Authorization` header may well be some other system's, forwarded."""
    headers = {"x-api-key": "primary", "authorization": "Bearer other"}
    assert auth.extract_api_key(headers) == "primary"


def test_an_absent_or_malformed_credential_reads_as_none() -> None:
    assert auth.extract_api_key({}) is None
    assert auth.extract_api_key({"authorization": "Basic xyz"}) is None
    assert auth.extract_api_key({"authorization": "Bearer "}) is None
    assert auth.extract_api_key({"authorization": "Bearertoken"}) is None
    assert auth.extract_api_key({"x-api-key": "   "}) is None


# ── Authenticating ───────────────────────────────────────────────────────────

CONFIG = auth.ApiAuthConfig(
    keys=(auth.ApiKeyRecord(key="good-key", label="good"),),
    rate_limit=auth.DEFAULT_RATE_LIMIT,
)


def test_no_configured_keys_means_authenticated_as_nobody() -> None:
    """The backward-compatible default: a checkout with no secrets still works."""
    open_config = auth.ApiAuthConfig(keys=(), rate_limit=auth.DEFAULT_RATE_LIMIT)
    assert auth.authenticate(open_config, {}) == auth.AuthOk(key=None)


def test_presenting_nothing_when_a_key_is_required_is_a_401() -> None:
    result = auth.authenticate(CONFIG, {})
    assert isinstance(result, auth.AuthRejected)
    assert result.status == 401


def test_presenting_an_unknown_key_is_a_403() -> None:
    """403, not 401: the caller did authenticate, and is not welcome."""
    result = auth.authenticate(CONFIG, {"x-api-key": "wrong"})
    assert isinstance(result, auth.AuthRejected)
    assert result.status == 403


def test_a_valid_key_is_accepted_through_either_header() -> None:
    expected = auth.AuthOk(key=auth.ApiKeyRecord(key="good-key", label="good"))
    assert auth.authenticate(CONFIG, {"x-api-key": "good-key"}) == expected
    assert auth.authenticate(CONFIG, {"authorization": "Bearer good-key"}) == expected


def test_a_prefix_of_a_valid_key_is_rejected() -> None:
    """The length guard in the constant-time compare, from the other side."""
    result = auth.authenticate(CONFIG, {"x-api-key": "good"})
    assert isinstance(result, auth.AuthRejected)


# ── Counting requests ────────────────────────────────────────────────────────


def test_the_window_allows_max_requests_then_blocks() -> None:
    limiter = auth.RateLimiter(auth.RateLimitConfig(window_ms=1000, max=3))

    first = limiter.check("id", 0)
    assert first.allowed
    assert first.remaining == 2

    assert limiter.check("id", 100).allowed
    assert limiter.check("id", 200).allowed

    blocked = limiter.check("id", 300)
    assert not blocked.allowed
    assert blocked.remaining == 0
    assert blocked.retry_after_ms == 700  # resetAt(1000) - now(300)


def test_the_counter_starts_over_once_the_window_elapses() -> None:
    limiter = auth.RateLimiter(auth.RateLimitConfig(window_ms=1000, max=1))
    assert limiter.check("id", 0).allowed
    assert not limiter.check("id", 500).allowed

    after = limiter.check("id", 1000)
    assert after.allowed
    assert after.remaining == 0


def test_identities_are_counted_independently() -> None:
    limiter = auth.RateLimiter(auth.RateLimitConfig(window_ms=1000, max=1))
    assert limiter.check("a", 0).allowed
    assert limiter.check("b", 0).allowed
    assert not limiter.check("a", 10).allowed


def test_a_blocked_request_does_not_extend_the_window() -> None:
    """Rejections are not counted, so hammering a blocked key cannot push its
    own reset further out."""
    limiter = auth.RateLimiter(auth.RateLimitConfig(window_ms=1000, max=1))
    limiter.check("id", 0)
    for moment in (100, 200, 300):
        assert limiter.check("id", moment).reset_at == 1000
    assert limiter.check("id", 1000).allowed


def test_reset_drops_every_counter() -> None:
    limiter = auth.RateLimiter(auth.RateLimitConfig(window_ms=1000, max=1))
    assert limiter.check("id", 0).allowed
    limiter.reset()
    assert limiter.check("id", 0).allowed
