"""`pinakes.ingest.translate` — the server-side Google Translate proxy.

The Python twin of `server/routes/translate.test.ts`'s service coverage: the
same validation rules, the same three failures, and the same guarantee that the
key never leaves this process. No live call is made anywhere here — the upstream
is a fake, or a fake transport behind the engine's client.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest
from pinakes_engine.acquire.http import HttpClient, HttpResponse

from pinakes.ingest import http as ingest_http
from pinakes.ingest import translate


class FakeUpstream:
    """Records what it was asked and answers with a canned translation."""

    def __init__(self, answer: str | None = "bonjour") -> None:
        self.answer = answer
        self.calls: list[tuple[translate.TranslateInput, str]] = []

    def translate(self, request: translate.TranslateInput, api_key: str) -> str | None:
        self.calls.append((request, api_key))
        return self.answer


class FailingUpstream:
    def translate(self, request: translate.TranslateInput, api_key: str) -> str | None:
        raise translate.TranslateError("upstream said no")


# ── Validation ───────────────────────────────────────────────────────────────


def test_a_valid_body_normalises_to_an_input() -> None:
    request = translate.validate_translate_input(
        {"text": " bonjour ", "to": " fr ", "from": " en "}
    )
    # The target/source are trimmed; the text is NOT — what was pasted is what
    # gets translated, trailing space and all.
    assert request == translate.TranslateInput(text=" bonjour ", to="fr", from_="en")


def test_an_absent_source_language_is_none_not_empty() -> None:
    request = translate.validate_translate_input({"text": "x", "to": "fr", "from": " "})
    assert request.from_ is None


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({}, "text is required"),
        (None, "text is required"),
        ("not an object", "text is required"),
        ({"text": "   ", "to": "fr"}, "text is required"),
        ({"text": 42, "to": "fr"}, "text is required"),
        ({"text": "x"}, "to (target language) is required"),
        ({"text": "x", "to": "  "}, "to (target language) is required"),
    ],
)
def test_an_unusable_body_is_refused_with_the_reason(body: Any, message: str) -> None:
    with pytest.raises(translate.TranslateValidationError) as raised:
        translate.validate_translate_input(body)
    assert str(raised.value) == message


# ── The proxy ────────────────────────────────────────────────────────────────


def test_the_key_is_read_here_and_passed_to_the_upstream(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(translate.API_KEY_ENV, "sekrit")
    upstream = FakeUpstream()
    request = translate.validate_translate_input(
        {"text": "hello", "to": "fr", "from": "en"}
    )

    result = translate.translate_text(request, upstream)

    assert result == {
        "translation": "bonjour",
        "source": "google-translate",
        "from": "en",
        "to": "fr",
    }
    assert upstream.calls[0][1] == "sekrit"


def test_an_absent_source_comes_back_as_null() -> None:
    request = translate.validate_translate_input({"text": "hello", "to": "fr"})
    result = translate.translate_text(request, FakeUpstream(), api_key="k")
    assert result["from"] is None


def test_an_upstream_with_no_translation_answers_null_not_an_error() -> None:
    request = translate.validate_translate_input({"text": "hello", "to": "fr"})
    result = translate.translate_text(request, FakeUpstream(answer=None), api_key="k")
    assert result["translation"] is None


def test_no_configured_key_refuses_before_any_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(translate.API_KEY_ENV, raising=False)
    upstream = FakeUpstream()
    request = translate.validate_translate_input({"text": "hello", "to": "fr"})
    with pytest.raises(translate.TranslateNotConfiguredError):
        translate.translate_text(request, upstream)
    assert upstream.calls == []


def test_a_blank_key_is_no_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(translate.API_KEY_ENV, "   ")
    assert translate.load_api_key() is None


def test_an_upstream_failure_propagates_as_a_translate_error() -> None:
    request = translate.validate_translate_input({"text": "hello", "to": "fr"})
    with pytest.raises(translate.TranslateError):
        translate.translate_text(request, FailingUpstream(), api_key="k")


# ── The live upstream ────────────────────────────────────────────────────────


class RecordingTransport:
    def __init__(self, responses: list[HttpResponse]) -> None:
        self._responses = list(responses)
        self.calls: list[tuple[str, str, str | None]] = []

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
        self.calls.append((method, url, body))
        return self._responses.pop(0)


def _install(tmp_path: Path, responses: list[HttpResponse]) -> RecordingTransport:
    transport = RecordingTransport(responses)
    ingest_http.configure(
        ingest_http.GOOGLE,
        HttpClient(
            cache_dir=tmp_path,
            min_interval=0.0,
            transport=transport,
            sleep=lambda _seconds: None,
        ),
    )
    return transport


def test_the_live_upstream_posts_the_v2_payload(tmp_path: Path) -> None:
    answer = json.dumps({"data": {"translations": [{"translatedText": "bonjour"}]}})
    transport = _install(
        tmp_path, [HttpResponse(url="", status_code=200, text=answer, headers={})]
    )

    result = translate.LiveDeps().translate(
        translate.TranslateInput(text="hello", to="fr", from_="en"), "sekrit"
    )

    assert result == "bonjour"
    method, url, body = transport.calls[0]
    assert method == "POST"
    assert url.startswith(translate.ENDPOINT)
    assert json.loads(body or "{}") == {
        "q": "hello",
        "target": "fr",
        "format": "text",
        "source": "en",
    }


def test_a_translation_is_not_cached(tmp_path: Path) -> None:
    """A POST is a request to *do* something; replaying a stored answer for one
    would mean the second identical word never reached the translator at all."""
    answer = json.dumps({"data": {"translations": [{"translatedText": "bonjour"}]}})
    transport = _install(
        tmp_path,
        [
            HttpResponse(url="", status_code=200, text=answer, headers={}),
            HttpResponse(url="", status_code=200, text=answer, headers={}),
        ],
    )
    request = translate.TranslateInput(text="hello", to="fr", from_=None)

    translate.LiveDeps().translate(request, "sekrit")
    translate.LiveDeps().translate(request, "sekrit")

    assert len(transport.calls) == 2


def test_an_upstream_error_carries_its_status_and_message(tmp_path: Path) -> None:
    body = json.dumps({"error": {"message": "API key not valid"}})
    _install(tmp_path, [HttpResponse(url="", status_code=400, text=body, headers={})])

    with pytest.raises(translate.TranslateError) as raised:
        translate.LiveDeps().translate(
            translate.TranslateInput(text="hello", to="fr", from_=None), "nope"
        )
    assert "400" in str(raised.value) and "API key not valid" in str(raised.value)


def test_an_unreadable_upstream_body_is_still_judged_by_its_status(
    tmp_path: Path,
) -> None:
    _install(
        tmp_path, [HttpResponse(url="", status_code=200, text="<html/>", headers={})]
    )
    result = translate.LiveDeps().translate(
        translate.TranslateInput(text="hello", to="fr", from_=None), "sekrit"
    )
    assert result is None
