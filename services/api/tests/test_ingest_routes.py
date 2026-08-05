"""The three ingest routes over HTTP — `/api/extract/{text,url}`, `/api/translate`.

The behavioural coverage that used to live in `server/routes/text-extractor.test.ts`,
`server/routes/url-extractor.test.ts` and `server/routes/translate.test.ts`
(pinakes:64 US-1). Those three files now assert only the hand-off.

None of these tests reaches the network: each replaces the module's `live_deps`
with a fake, which is the seam the routers resolve per request. `conftest.py`'s
autouse `isolated_data_trees` points the contribution queue at a temp directory,
so what the routes queue is asserted on disk without touching the real one.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pinakes_contracts import contracts_dir

from conftest import coverage_of
from pinakes.ingest import text_extractor, translate, url_extractor

FIXTURES = contracts_dir().parent / "server" / "services" / "fixtures"

PARAGRAPH = "The Roman Empire was founded in 27 BCE. Latin was its language."


def recorded(*parts: str) -> Any:
    return json.loads(FIXTURES.joinpath(*parts).read_text(encoding="utf-8"))


# ── The port itself ──────────────────────────────────────────────────────────


def test_the_group_is_registered_rather_than_stubbed(
    unbuilt_client: TestClient,
) -> None:
    """What "ported" means here: these three left the 501 catalog."""
    ported = {route.key for route in coverage_of(unbuilt_client).ported}
    assert {
        ("POST", "/api/extract/text"),
        ("POST", "/api/extract/url"),
        ("POST", "/api/translate"),
    } <= ported


# ── POST /api/extract/text ───────────────────────────────────────────────────


class FakeModel:
    def __init__(self, payload: Any | None = None) -> None:
        self.payload = (
            payload
            if payload is not None
            else recorded("text-extractor", "roman-empire-paragraph.json")
        )
        self.calls: list[str] = []

    def extract(self, text: str) -> Any:
        self.calls.append(text)
        return self.payload


class ExplodingModel:
    def extract(self, text: str) -> Any:
        raise RuntimeError("the model is down")


@pytest.fixture
def model(monkeypatch: pytest.MonkeyPatch) -> FakeModel:
    fake = FakeModel()
    monkeypatch.setattr(text_extractor, "live_deps", lambda: fake)
    return fake


def test_a_pasted_paragraph_is_extracted_and_queued(
    unbuilt_client: TestClient,
    model: FakeModel,
    isolated_data_trees: dict[str, Path],
) -> None:
    response = unbuilt_client.post(
        "/api/extract/text", json={"text": PARAGRAPH, "contributorName": "Ada"}
    )

    assert response.status_code == 201
    body = response.json()
    assert [e["name"]["value"] for e in body["result"]["entities"]] == [
        "Roman Empire",
        "Latin",
        "Pompeii",
    ]
    assert len(body["contributions"]) == 3
    assert body["warnings"] == []
    assert model.calls == [PARAGRAPH]

    # Queued as pending, on disk, flagged — and nowhere near the corpus.
    written = sorted(isolated_data_trees["contributions"].glob("*.json"))
    assert len(written) == 3
    record = json.loads(written[0].read_text(encoding="utf-8"))
    assert record["status"] == "pending"
    assert record["aiGenerated"] is True
    assert record["entityData"]["source"] == "ai-extracted"


def test_an_entity_the_queue_rejects_is_a_warning_not_a_lost_page(
    unbuilt_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """One unqueueable entity must not cost the others.

    Nothing the model can *say* reaches this branch — a nameless entity is
    dropped in normalisation and every resolved `entityType` needs only fields
    the draft carries — so the rejection is staged by stripping one draft's
    sources. The branch is worth holding open anyway: it is what makes a
    paragraph naming five entities queue four when one of them is bad.
    """
    payload = {
        "entities": [
            {"name": "Keeper", "entityType": "civilization", "confidence": 0.9},
            {"name": "Skipped", "entityType": "civilization", "confidence": 0.9},
        ],
        "relationships": [],
    }
    monkeypatch.setattr(text_extractor, "live_deps", lambda: FakeModel(payload))

    original = text_extractor.extraction_to_contributions

    def drop_the_sources(result: Any, **kwargs: Any) -> Any:
        drafts = original(result, **kwargs)
        for draft in drafts:
            if draft["entityData"]["name"] == "Skipped":
                draft["sources"] = []
        return drafts

    monkeypatch.setattr(
        text_extractor, "extraction_to_contributions", drop_the_sources
    )

    body = unbuilt_client.post("/api/extract/text", json={"text": PARAGRAPH}).json()

    assert [c["entityData"]["name"] for c in body["contributions"]] == ["Keeper"]
    assert body["warnings"] == [
        'Skipped "Skipped": At least one source citation is required'
    ]


@pytest.mark.parametrize("body", [{}, {"text": ""}, {"text": "   "}, {"text": 42}])
def test_text_is_required(
    unbuilt_client: TestClient, model: FakeModel, body: Any
) -> None:
    response = unbuilt_client.post("/api/extract/text", json=body)
    assert response.status_code == 400
    assert response.json() == {"message": "text is required"}
    assert model.calls == []


def test_a_model_failure_is_a_502(
    unbuilt_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(text_extractor, "live_deps", ExplodingModel)
    response = unbuilt_client.post("/api/extract/text", json={"text": PARAGRAPH})
    assert response.status_code == 502
    assert response.json() == {
        "message": "Failed to extract entities from the text"
    }


# ── POST /api/extract/url ────────────────────────────────────────────────────


class FakeSource:
    def __init__(self) -> None:
        self.entities = recorded("url-extractor", "wikidata-Q2277.json")["entities"]

    def fetch_wikidata_entity(self, qid: str) -> Any:
        return self.entities[qid]

    def fetch_wikipedia_page(self, lang: str, title: str) -> Any:
        payload = recorded("url-extractor", "wikipedia-summary-roman-empire.json")
        return {
            "title": payload["title"],
            "lang": lang,
            "qid": payload["wikibase_item"],
            "extract": payload["extract"],
        }


class UnreachableSource:
    def fetch_wikidata_entity(self, qid: str) -> Any:
        raise RuntimeError("wikidata is unreachable")

    def fetch_wikipedia_page(self, lang: str, title: str) -> Any:
        raise RuntimeError("wikipedia is unreachable")


@pytest.fixture
def source(monkeypatch: pytest.MonkeyPatch) -> FakeSource:
    fake = FakeSource()
    monkeypatch.setattr(url_extractor, "live_deps", lambda: fake)
    return fake


def test_a_pasted_url_is_drafted_and_queued(
    unbuilt_client: TestClient,
    source: FakeSource,
    isolated_data_trees: dict[str, Path],
) -> None:
    response = unbuilt_client.post(
        "/api/extract/url",
        json={"url": "https://www.wikidata.org/wiki/Q2277", "contributorName": "Ada"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["draft"]["name"]["value"] == "Roman Empire"
    assert body["contribution"]["status"] == "pending"
    assert body["contribution"]["entityType"] == "civilization"

    written = sorted(isolated_data_trees["contributions"].glob("*.json"))
    assert len(written) == 1
    record = json.loads(written[0].read_text(encoding="utf-8"))
    assert record["entityData"]["wikidataQid"] == "Q2277"
    assert record["aiGenerated"] is True


def test_a_wikipedia_url_is_resolved_through_its_item(
    unbuilt_client: TestClient, source: FakeSource
) -> None:
    body = unbuilt_client.post(
        "/api/extract/url",
        json={"url": "https://en.wikipedia.org/wiki/Roman_Empire"},
    ).json()
    assert body["draft"]["kind"] == "wikipedia"
    assert body["draft"]["wikidataQid"] == "Q2277"


def test_a_requested_entity_type_is_honoured(
    unbuilt_client: TestClient, source: FakeSource
) -> None:
    body = unbuilt_client.post(
        "/api/extract/url",
        json={
            "url": "https://www.wikidata.org/wiki/Q2277",
            "entityType": "language",
        },
    ).json()
    assert body["contribution"]["entityType"] == "language"


def test_an_unsupported_entity_type_is_refused_with_the_allowed_list(
    unbuilt_client: TestClient, source: FakeSource
) -> None:
    response = unbuilt_client.post(
        "/api/extract/url",
        json={"url": "https://www.wikidata.org/wiki/Q2277", "entityType": "haplogroup"},
    )
    assert response.status_code == 400
    body = response.json()
    assert body["message"] == "Unsupported entityType: haplogroup"
    assert body["allowed"] == list(url_extractor.ALLOWED_ENTITY_TYPES)


@pytest.mark.parametrize("body", [{}, {"url": ""}, {"url": 42}])
def test_a_url_is_required(
    unbuilt_client: TestClient, source: FakeSource, body: Any
) -> None:
    response = unbuilt_client.post("/api/extract/url", json=body)
    assert response.status_code == 400
    assert response.json() == {"message": "url is required"}


def test_an_unrecognised_url_is_a_400_naming_why(
    unbuilt_client: TestClient, source: FakeSource
) -> None:
    response = unbuilt_client.post(
        "/api/extract/url", json={"url": "https://example.org/thing"}
    )
    assert response.status_code == 400
    assert "Unsupported source" in response.json()["message"]


def test_an_unreachable_source_is_a_502(
    unbuilt_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(url_extractor, "live_deps", UnreachableSource)
    response = unbuilt_client.post(
        "/api/extract/url", json={"url": "https://www.wikidata.org/wiki/Q2277"}
    )
    assert response.status_code == 502
    assert response.json() == {"message": "Failed to resolve the source URL"}


# ── POST /api/translate ──────────────────────────────────────────────────────


class FakeUpstream:
    def __init__(self, answer: str | None = "bonjour") -> None:
        self.answer = answer
        self.keys: list[str] = []

    def translate(self, request: translate.TranslateInput, api_key: str) -> str | None:
        self.keys.append(api_key)
        return self.answer


class FailingUpstream:
    def translate(self, request: translate.TranslateInput, api_key: str) -> str | None:
        raise translate.TranslateError("upstream said no")


def test_a_translation_comes_back_with_its_provenance(
    unbuilt_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(translate.API_KEY_ENV, "sekrit")
    upstream = FakeUpstream()
    monkeypatch.setattr(translate, "live_deps", lambda: upstream)

    response = unbuilt_client.post(
        "/api/translate", json={"text": "hello", "to": "fr", "from": "en"}
    )

    assert response.status_code == 200
    assert response.json() == {
        "translation": "bonjour",
        "source": "google-translate",
        "from": "en",
        "to": "fr",
    }
    assert upstream.keys == ["sekrit"]
    # The key reached the upstream and nothing else.
    assert "sekrit" not in response.text


def test_no_configured_key_is_a_503_the_client_degrades_past(
    unbuilt_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv(translate.API_KEY_ENV, raising=False)
    response = unbuilt_client.post("/api/translate", json={"text": "hello", "to": "fr"})
    assert response.status_code == 503
    assert "not available" in response.json()["message"]


def test_an_upstream_failure_is_a_502_that_says_nothing_else(
    unbuilt_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(translate.API_KEY_ENV, "sekrit")
    monkeypatch.setattr(translate, "live_deps", FailingUpstream)
    response = unbuilt_client.post("/api/translate", json={"text": "hello", "to": "fr"})
    assert response.status_code == 502
    assert response.json() == {"message": "Translation failed"}


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({}, "text is required"),
        ({"to": "fr"}, "text is required"),
        ({"text": "hello"}, "to (target language) is required"),
    ],
)
def test_an_unusable_body_is_a_400_not_a_422(
    unbuilt_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    body: Any,
    message: str,
) -> None:
    monkeypatch.setenv(translate.API_KEY_ENV, "sekrit")
    response = unbuilt_client.post("/api/translate", json=body)
    assert response.status_code == 400
    assert response.json() == {"message": message}
