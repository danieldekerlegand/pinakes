"""`pinakes.ingest.http` — the one door the ingest routes reach the network by.

Small module, three things worth pinning: a client is shared per source (or the
per-host rate limit means nothing), the two sources are configured differently
on purpose, and the test seam actually replaces what production would build.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from pinakes_engine.acquire.http import HttpClient, HttpResponse

from pinakes.ingest import http


def test_one_client_per_source_shared_across_calls() -> None:
    """A per-call client would rate-limit nothing: each would start unthrottled."""
    assert http.client(http.WIKIMEDIA) is http.client(http.WIKIMEDIA)
    assert http.client(http.WIKIMEDIA) is not http.client(http.GOOGLE)


def test_wikimedia_is_spaced_and_googles_apis_are_not() -> None:
    """The politeness that a User-Agent policy asks for, and the one nobody does.

    Wikidata/Wikipedia are anonymous and ask for a second between requests.
    Google's endpoints are key-authenticated and quota-metered, and the client
    translates a vocabulary word by word — a one-second floor there would be a
    minute of waiting per fifty words, for no one's benefit.
    """
    assert http.WIKIMEDIA.min_interval == 1.0
    assert http.GOOGLE.min_interval == 0.0


def test_the_client_identifies_this_service() -> None:
    assert http.client(http.WIKIMEDIA).user_agent == http.USER_AGENT
    assert "pinakes" in http.USER_AGENT


def test_configure_replaces_the_client_and_reset_forgets_it(tmp_path: Path) -> None:
    replacement = HttpClient(cache_dir=tmp_path, min_interval=0.0)
    http.configure(http.WIKIMEDIA, replacement)
    assert http.client(http.WIKIMEDIA) is replacement

    http.reset()
    assert http.client(http.WIKIMEDIA) is not replacement


def test_a_non_json_response_names_who_sent_it() -> None:
    with pytest.raises(http.UpstreamError) as raised:
        http.read_json(
            HttpResponse(url="", status_code=200, text="<html/>", headers={}),
            context="Wikidata",
        )
    assert "Wikidata" in str(raised.value)
