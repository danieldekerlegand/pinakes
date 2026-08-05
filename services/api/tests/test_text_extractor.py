"""`pinakes.ingest.text_extractor` — a paragraph becomes reviewable drafts.

Graded against the same recorded model payload as
`server/services/text-extractor.test.ts`
(`server/services/fixtures/text-extractor/roman-empire-paragraph.json`), which is
what says the two implementations normalise one answer the same way. No model is
called anywhere in this file; the one test that exercises the live boundary
drives it over a fake transport behind the engine's client.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest
from pinakes_contracts import contracts_dir
from pinakes_engine.acquire.http import HttpClient, HttpResponse

from pinakes.ingest import http as ingest_http
from pinakes.ingest import text_extractor as extractor

FIXTURE = (
    contracts_dir().parent
    / "server"
    / "services"
    / "fixtures"
    / "text-extractor"
    / "roman-empire-paragraph.json"
)

PARAGRAPH = (
    "The Roman Empire was founded in 27 BCE and fell in 476 CE. Latin was its "
    "language; Pompeii was one of its cities."
)


def recorded() -> dict[str, Any]:
    payload: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return payload


class FakeDeps:
    """The model boundary, answering with the recorded payload."""

    def __init__(self, payload: dict[str, Any] | None = None) -> None:
        self.payload = payload if payload is not None else recorded()
        self.calls: list[str] = []

    def extract(self, text: str) -> dict[str, Any]:
        self.calls.append(text)
        return self.payload


# ── Normalisation ────────────────────────────────────────────────────────────


def test_the_recorded_payload_normalises_to_three_scored_entities() -> None:
    result = extractor.extract_draft_from_text(PARAGRAPH, FakeDeps())

    # The fourth entity in the payload is a blank name and is dropped.
    assert [entity["name"]["value"] for entity in result["entities"]] == [
        "Roman Empire",
        "Latin",
        "Pompeii",
    ]
    assert result["aiGenerated"] is True and result["autoDerived"] is True

    empire = result["entities"][0]
    assert empire["name"]["confidence"] == 0.95
    assert empire["description"]["confidence"] == 0.8
    assert empire["timePeriodStart"]["value"] == -27
    assert empire["timePeriodEnd"] == {"value": 476, "confidence": 0.7}

    # An unscored field inherits the entity's own name confidence.
    latin = result["entities"][1]
    assert latin["description"]["confidence"] == 0.9
    assert "coordinates" not in latin

    pompeii = result["entities"][2]
    assert pompeii["coordinates"] == {
        "value": {"lat": 40.7497, "lng": 14.4869},
        "confidence": 0.92,
    }
    assert pompeii["timePeriodStart"] == {"value": -700, "confidence": 0.88}


def test_duplicate_relationships_collapse_and_the_first_confidence_wins() -> None:
    result = extractor.extract_draft_from_text(PARAGRAPH, FakeDeps())
    assert [
        (r["source"], r["target"], r["confidence"]) for r in result["relationships"]
    ] == [("French", "Latin", 0.75), ("Pompeii", "Roman Empire", 0.8)]


def test_blank_text_is_refused_before_the_model_is_called() -> None:
    deps = FakeDeps()
    with pytest.raises(extractor.TextExtractionError):
        extractor.extract_draft_from_text("   ", deps)
    assert deps.calls == []


def test_the_model_is_handed_the_trimmed_text() -> None:
    deps = FakeDeps()
    extractor.extract_draft_from_text(f"  {PARAGRAPH}  ", deps)
    assert deps.calls == [PARAGRAPH]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ({"entities": [{"name": "A", "confidence": 5}], "relationships": []}, 1.0),
        ({"entities": [{"name": "A", "confidence": -2}], "relationships": []}, 0.0),
        ({"entities": [{"name": "A", "confidence": "high"}], "relationships": []}, 0.5),
        ({"entities": [{"name": "A"}], "relationships": []}, 0.5),
        ({"entities": [{"name": "A", "confidence": True}], "relationships": []}, 0.5),
    ],
)
def test_a_confidence_is_clamped_or_defaulted_never_trusted(
    raw: dict[str, Any], expected: float
) -> None:
    result = extractor.normalize_extraction(raw)
    assert result["entities"][0]["name"]["confidence"] == expected


def test_a_self_edge_and_an_incomplete_edge_are_dropped() -> None:
    result = extractor.normalize_extraction(
        {
            "entities": [],
            "relationships": [
                {"source": "A", "target": "a", "type": "same", "confidence": 1},
                {"source": "A", "target": "", "type": "x", "confidence": 1},
                {"source": "A", "target": "B", "type": "", "confidence": 1},
            ],
        }
    )
    assert result["relationships"] == []


def test_a_missing_key_is_an_empty_extraction_not_a_crash() -> None:
    result = extractor.normalize_extraction({})
    assert result["entities"] == [] and result["relationships"] == []


# ── Entity type resolution ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("raw_type", "has_coordinates", "resolved"),
    [
        ("language", False, "language"),
        ("Dialect of Latin", False, "language"),
        ("archaeological site", True, "archaeological-site"),
        # The queue requires coordinates on a site, so one without them is filed
        # where its required fields *can* be met.
        ("archaeological site", False, "civilization"),
        ("settlement", True, "archaeological-site"),
        ("historical figure", False, "historical-figure"),
        ("emperor", False, "historical-figure"),
        ("trade good", False, "trade-good"),
        ("commodity", False, "trade-good"),
        # A religion needs a `religionType` free text cannot guarantee.
        ("religion", False, "civilization"),
        ("something else entirely", False, "civilization"),
    ],
)
def test_the_models_free_text_kind_maps_to_a_queue_safe_type(
    raw_type: str, has_coordinates: bool, resolved: str
) -> None:
    assert (
        extractor.resolve_contribution_entity_type(raw_type, has_coordinates)
        == resolved
    )


# ── Extraction → contributions ───────────────────────────────────────────────


def test_each_entity_becomes_one_flagged_submission() -> None:
    result = extractor.extract_draft_from_text(PARAGRAPH, FakeDeps())
    submissions = extractor.extraction_to_contributions(
        result, source_text=PARAGRAPH, contributor_name="Ada"
    )

    assert [s["entityType"] for s in submissions] == [
        "civilization",
        "language",
        "archaeological-site",
    ]
    for submission in submissions:
        assert submission["action"] == "add"
        assert submission["contributorName"] == "Ada"
        assert submission["entityData"]["source"] == "ai-extracted"
        assert submission["entityData"]["aiGenerated"] is True
        assert submission["sources"][0]["title"].startswith("AI text extraction:")
        assert 1 <= submission["confidence"] <= 99


def test_a_relationship_rides_on_its_source_entitys_submission() -> None:
    result = extractor.extract_draft_from_text(PARAGRAPH, FakeDeps())
    by_name = {
        s["entityData"]["name"]: s
        for s in extractor.extraction_to_contributions(result)
    }

    # `Pompeii → Roman Empire` is owned by Pompeii, its source.
    assert [r["type"] for r in by_name["Pompeii"]["entityData"]["relationships"]] == [
        "located-in"
    ]
    assert by_name["Roman Empire"]["entityData"]["relationships"] == []
    # `French → Latin` names a source the model did not extract, so Latin — the
    # target — carries it rather than the edge being lost.
    assert [r["source"] for r in by_name["Latin"]["entityData"]["relationships"]] == [
        "French"
    ]


def test_an_edge_between_two_unextracted_entities_is_carried_by_no_one() -> None:
    result = extractor.normalize_extraction(
        {
            "entities": [{"name": "A", "entityType": "civilization", "confidence": 1}],
            "relationships": [
                {"source": "B", "target": "C", "type": "x", "confidence": 1}
            ],
        }
    )
    submissions = extractor.extraction_to_contributions(result)
    assert submissions[0]["entityData"]["relationships"] == []
    # …but it is still in the answer the client renders.
    assert len(result["relationships"]) == 1


def test_the_source_excerpt_is_bounded_and_marked_when_truncated() -> None:
    result = extractor.normalize_extraction(
        {"entities": [{"name": "A", "entityType": "x", "confidence": 1}]}
    )
    long_text = "word " * 200
    title = extractor.extraction_to_contributions(result, source_text=long_text)[0][
        "sources"
    ][0]["title"]
    assert title.endswith('…"')
    assert len(title) < len(long_text)

    untitled = extractor.extraction_to_contributions(result)[0]["sources"][0]
    assert untitled == {"title": "AI text extraction"}


def test_confidence_is_the_mean_of_the_present_fields() -> None:
    entity = {"name": {"value": "A", "confidence": 0.9}}
    assert extractor.overall_confidence(entity) == 90
    entity["description"] = {"value": "d", "confidence": 0.7}
    assert extractor.overall_confidence(entity) == 80


# ── The live model boundary ──────────────────────────────────────────────────


class RecordingTransport:
    def __init__(self, responses: list[HttpResponse]) -> None:
        self._responses = list(responses)
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


def _candidate(payload: dict[str, Any]) -> str:
    return json.dumps(
        {"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]}
    )


def test_the_live_deps_post_the_prompt_with_the_key_in_a_header(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(extractor.GEMINI_API_KEY_ENV, "sekrit")
    monkeypatch.setenv(extractor.GEMINI_MODEL_ENV, "gemini-test")
    answer = _candidate(recorded())
    transport = _install(
        tmp_path, [HttpResponse(url="", status_code=200, text=answer, headers={})]
    )

    raw = extractor.live_deps().extract(PARAGRAPH)

    assert len(raw["entities"]) == 4  # raw, not yet normalised
    method, url, headers, body = transport.calls[0]
    assert method == "POST"
    assert url.endswith("/gemini-test:generateContent")
    # The key is a header, never a query parameter: a query parameter is logged
    # by every hop between here and the model.
    assert headers["x-goog-api-key"] == "sekrit"
    assert "sekrit" not in url
    assert body is not None and PARAGRAPH in body


def test_no_key_configured_is_a_refusal_and_no_request(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv(extractor.GEMINI_API_KEY_ENV, raising=False)
    transport = _install(tmp_path, [])
    with pytest.raises(extractor.TextExtractionError):
        extractor.live_deps().extract(PARAGRAPH)
    assert transport.calls == []


@pytest.mark.parametrize(
    "text",
    [
        json.dumps({"candidates": []}),  # no candidate
        json.dumps({"candidates": [{"content": {"parts": [{"text": "not json"}]}}]}),
    ],
)
def test_an_unreadable_model_answer_is_an_upstream_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, text: str
) -> None:
    monkeypatch.setenv(extractor.GEMINI_API_KEY_ENV, "sekrit")
    _install(tmp_path, [HttpResponse(url="", status_code=200, text=text, headers={})])
    with pytest.raises(ingest_http.UpstreamError):
        extractor.live_deps().extract(PARAGRAPH)


def test_a_model_error_status_is_an_upstream_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(extractor.GEMINI_API_KEY_ENV, "sekrit")
    _install(tmp_path, [HttpResponse(url="", status_code=403, text="", headers={})])
    with pytest.raises(ingest_http.UpstreamError) as raised:
        extractor.live_deps().extract(PARAGRAPH)
    assert "403" in str(raised.value)


def test_a_throttled_model_is_retried_rather_than_failed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The reason the call goes through the engine's client at all.

    A ``429`` is backed off and retried; the TypeScript's bare ``fetch`` reported
    it to the user as a failed extraction on the first try.
    """
    monkeypatch.setenv(extractor.GEMINI_API_KEY_ENV, "sekrit")
    transport = _install(
        tmp_path,
        [
            HttpResponse(url="", status_code=429, text="", headers={}),
            HttpResponse(
                url="", status_code=200, text=_candidate(recorded()), headers={}
            ),
        ],
    )

    raw = extractor.live_deps().extract(PARAGRAPH)

    assert len(raw["entities"]) == 4
    assert len(transport.calls) == 2
