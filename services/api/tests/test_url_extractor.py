"""`pinakes.ingest.url_extractor` — a pasted URL becomes a reviewable draft.

Graded against the **same recorded fixtures** as
`server/services/url-extractor.test.ts` did (they live at
`services/api/tests/fixtures/url-extractor/` since the cutover moved them off
`server/`), which is what says the two implementations read one Wikidata
payload the same way. Nothing here touches the network: the deps are a fake,
and the one test that exercises the live boundary drives it over a fake
transport installed behind the engine's client.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest
from pinakes_engine.acquire.http import HttpClient, HttpResponse

from pinakes.ingest import http as ingest_http
from pinakes.ingest import url_extractor as extractor

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "url-extractor"


def load(name: str) -> Any:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))


class FakeDeps:
    """The Wikidata/Wikipedia boundary, served from the recorded fixtures."""

    def __init__(self) -> None:
        self.entity_calls: list[str] = []
        self.page_calls: list[tuple[str, str]] = []

    def fetch_wikidata_entity(self, qid: str) -> dict[str, Any]:
        self.entity_calls.append(qid)
        entities = load("wikidata-Q2277")["entities"]
        if qid not in entities:
            raise extractor.UrlExtractionError(f"Wikidata entity {qid} not found")
        entity: dict[str, Any] = entities[qid]
        return entity

    def fetch_wikipedia_page(self, lang: str, title: str) -> dict[str, Any]:
        self.page_calls.append((lang, title))
        slug = (
            "wikipedia-summary-roman-empire"
            if title == "Roman Empire"
            else "wikipedia-summary-some-obscure-village"
        )
        payload = load(slug)
        page: dict[str, Any] = {"title": payload["title"], "lang": lang}
        if payload.get("wikibase_item"):
            page["qid"] = payload["wikibase_item"]
        if payload.get("extract"):
            page["extract"] = payload["extract"]
        if payload.get("coordinates"):
            page["coordinates"] = {
                "lat": payload["coordinates"]["lat"],
                "lng": payload["coordinates"]["lon"],
            }
        return page


# ── URL parsing ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "url",
    [
        "https://www.wikidata.org/wiki/Q2277",
        "https://wikidata.org/entity/Q2277",
        "https://www.wikidata.org/wiki/Special:EntityData/Q2277",
    ],
)
def test_every_wikidata_url_shape_yields_the_qid(url: str) -> None:
    parsed = extractor.parse_source_url(url)
    assert (parsed.kind, parsed.qid) == ("wikidata", "Q2277")


def test_a_wikipedia_url_yields_language_and_decoded_title() -> None:
    parsed = extractor.parse_source_url(
        "https://de.wikipedia.org/wiki/R%C3%B6misches_Reich"
    )
    assert (parsed.kind, parsed.lang, parsed.title) == (
        "wikipedia",
        "de",
        "Römisches Reich",
    )


@pytest.mark.parametrize(
    ("url", "message"),
    [
        ("", "A url is required"),
        ("   ", "A url is required"),
        # No scheme and no host — `new URL(...)` throws on both.
        ("not a url", "Not a valid URL"),
        ("/wiki/Q42", "Not a valid URL"),
        ("https://www.wikidata.org/wiki/Rome", "No Wikidata QID found"),
        ("https://en.wikipedia.org/w/index.php?title=Rome", "Not a Wikipedia article"),
        ("https://example.org/thing", "Unsupported source"),
    ],
)
def test_an_unusable_url_is_refused_with_the_reason(url: str, message: str) -> None:
    with pytest.raises(extractor.UrlExtractionError) as raised:
        extractor.parse_source_url(url)
    assert message in str(raised.value)


# ── Statement → draft ────────────────────────────────────────────────────────


def test_the_recorded_entity_drafts_every_mapped_field() -> None:
    draft = extractor.extract_draft_from_url(
        "https://www.wikidata.org/wiki/Q2277", FakeDeps()
    )

    assert draft["kind"] == "wikidata"
    assert draft["wikidataQid"] == "Q2277"
    assert draft["sourceUrl"] == "https://www.wikidata.org/wiki/Q2277"
    assert draft["name"] == {"value": "Roman Empire", "confidence": 0.98}
    assert draft["description"]["value"].startswith("empire in ancient Rome")
    assert draft["coordinates"]["value"] == {"lat": 41.9, "lng": 12.5}
    assert draft["timePeriodStart"]["value"] == -27
    assert draft["timePeriodEnd"]["value"] == 476
    assert draft["aiGenerated"] is True and draft["autoDerived"] is True
    # Relationships come back in RELATIONSHIP_PROPERTIES declaration order, not
    # in the order the entity happens to list its claims (P31, P737, P361).
    assert [(r["property"], r["type"]) for r in draft["relationships"]] == [
        ("P31", "instance-of"),
        ("P737", "influenced-by"),
        ("P361", "part-of"),
    ]
    # An unlabelled target is shown as its bare QID rather than dropped.
    assert draft["relationships"][0]["targetQid"] == "Q48349"
    assert draft["relationships"][0]["targetLabel"] == "Q48349"


@pytest.mark.parametrize(
    ("time", "year"),
    [
        ("+1979-01-01T00:00:00Z", 1979),
        ("-0044-03-15T00:00:00Z", -44),
        ("+0000-01-01T00:00:00Z", 0),
        ("1979-01-01", None),  # unsigned — not the Wikidata form
        (None, None),
        ("", None),
    ],
)
def test_a_wikidata_time_is_read_as_a_signed_year(
    time: str | None, year: int | None
) -> None:
    assert extractor.parse_wikidata_year(time) == year


def test_relationships_are_deduped_on_property_and_target() -> None:
    entity = {
        "id": "Q1",
        "labels": {"en": {"language": "en", "value": "Thing"}},
        "claims": {
            "P31": [_claim("Q9"), _claim("Q9"), _claim("Q8")],
            "P279": [_claim("Q7"), _claim("not-a-qid")],
        },
    }
    draft = extractor.draft_from_wikidata_entity(
        entity, kind="wikidata", source_url="https://example.org"
    )
    assert [(r["property"], r["targetQid"]) for r in draft["relationships"]] == [
        ("P279", "Q7"),
        ("P31", "Q9"),
        ("P31", "Q8"),
    ]


def test_a_label_less_entity_falls_back_and_says_so_in_the_confidence() -> None:
    entity: dict[str, Any] = {"id": "Q1"}
    bare = extractor.draft_from_wikidata_entity(
        entity, kind="wikidata", source_url="https://example.org"
    )
    assert bare["name"] == {"value": "Q1", "confidence": 0.5}

    titled = extractor.draft_from_wikidata_entity(
        entity,
        kind="wikipedia",
        source_url="https://example.org",
        fallback_name="Some Article",
    )
    assert titled["name"] == {"value": "Some Article", "confidence": 0.8}


def test_a_non_english_only_entity_uses_whichever_label_it_has() -> None:
    entity = {"id": "Q1", "labels": {"fr": {"language": "fr", "value": "Chose"}}}
    draft = extractor.draft_from_wikidata_entity(
        entity, kind="wikidata", source_url="https://example.org"
    )
    assert draft["name"] == {"value": "Chose", "confidence": 0.98}


# ── Wikipedia entry point ────────────────────────────────────────────────────


def test_a_wikipedia_url_resolves_through_its_wikidata_item() -> None:
    deps = FakeDeps()
    draft = extractor.extract_draft_from_url(
        "https://en.wikipedia.org/wiki/Roman_Empire", deps
    )

    assert deps.page_calls == [("en", "Roman Empire")]
    assert deps.entity_calls == ["Q2277"]
    assert draft["kind"] == "wikipedia"
    assert draft["wikidataQid"] == "Q2277"
    assert draft["sourceUrl"] == "https://en.wikipedia.org/wiki/Roman_Empire"
    # The article summary overrides the item's terser description, and says so.
    assert draft["description"] == {
        "value": "The Roman Empire was the post-Republican state of ancient Rome.",
        "confidence": 0.85,
    }


def test_a_page_with_no_wikidata_item_still_yields_a_draft() -> None:
    deps = FakeDeps()
    draft = extractor.extract_draft_from_url(
        "https://en.wikipedia.org/wiki/Some_Obscure_Village", deps
    )

    assert deps.entity_calls == []  # nothing to resolve
    assert "wikidataQid" not in draft
    assert draft["name"] == {"value": "Some Obscure Village", "confidence": 0.8}
    assert draft["description"]["confidence"] == 0.7
    assert draft["coordinates"] == {
        "value": {"lat": 12.34, "lng": 56.78},
        "confidence": 0.85,
    }
    assert draft["relationships"] == []


# ── Draft → contribution ─────────────────────────────────────────────────────


def test_a_draft_becomes_a_flagged_civilization_submission() -> None:
    draft = extractor.extract_draft_from_url(
        "https://www.wikidata.org/wiki/Q2277", FakeDeps()
    )
    submission = extractor.draft_to_contribution(draft, contributor_name="Ada")

    assert submission["entityType"] == "civilization"
    assert submission["action"] == "add"
    assert submission["contributorName"] == "Ada"
    assert submission["sources"] == [
        {
            "title": "Wikidata Q2277",
            "url": "https://www.wikidata.org/wiki/Q2277",
        }
    ]
    data = submission["entityData"]
    assert data["source"] == "auto-derived"
    assert data["aiGenerated"] is True and data["autoDerived"] is True
    assert data["provenanceKind"] == "wikidata"
    assert data["wikidataQid"] == "Q2277"
    assert data["coordinates"] == {"lat": 41.9, "lng": 12.5}
    assert set(data["perFieldConfidence"]) == {
        "name",
        "description",
        "coordinates",
        "timePeriodStart",
        "timePeriodEnd",
    }
    # Relationships ride into the queue record; a reviewer sees what was claimed.
    assert [r["targetQid"] for r in data["relationships"]] == [
        "Q48349",
        "Q1747689",
        "Q1747689",
    ]


def test_an_item_less_draft_carries_no_wikidata_qid_key_at_all() -> None:
    """Absent, not null — the TypeScript reader treats those as different records."""
    draft = extractor.extract_draft_from_url(
        "https://en.wikipedia.org/wiki/Some_Obscure_Village", FakeDeps()
    )
    data = extractor.draft_to_contribution(draft)["entityData"]
    assert "wikidataQid" not in data
    assert data["provenanceKind"] == "wikipedia"


def test_the_requested_entity_type_is_honoured() -> None:
    draft = extractor.extract_draft_from_url(
        "https://www.wikidata.org/wiki/Q2277", FakeDeps()
    )
    submission = extractor.draft_to_contribution(draft, entity_type="language")
    assert submission["entityType"] == "language"


def test_confidence_is_the_mean_of_the_present_fields_capped_at_99() -> None:
    draft: dict[str, Any] = {
        "kind": "wikidata",
        "name": {"value": "X", "confidence": 1.0},
        "relationships": [],
    }
    assert extractor.overall_confidence(draft) == 99

    draft["description"] = {"value": "d", "confidence": 0.5}
    assert extractor.overall_confidence(draft) == 75  # (1.0 + 0.5) / 2

    draft["relationships"] = [{"confidence": 0.75}]
    assert extractor.overall_confidence(draft) == 75  # (1.0 + 0.5 + 0.75) / 3


# ── The live boundary ────────────────────────────────────────────────────────


class RecordingTransport:
    """A transport that answers from a script and records what it was asked."""

    def __init__(self, responses: list[HttpResponse]) -> None:
        self._responses = list(responses)
        self.calls: list[tuple[str, str, dict[str, str]]] = []

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
        self.calls.append((method, url, dict(headers)))
        return self._responses.pop(0)


def _install(tmp_path: Path, responses: list[HttpResponse]) -> RecordingTransport:
    transport = RecordingTransport(responses)
    ingest_http.configure(
        ingest_http.WIKIMEDIA,
        HttpClient(
            cache_dir=tmp_path,
            min_interval=0.0,
            transport=transport,
            sleep=lambda _seconds: None,
        ),
    )
    return transport


def test_the_live_deps_fetch_through_the_engines_client(tmp_path: Path) -> None:
    payload = json.dumps(load("wikidata-Q2277"))
    transport = _install(
        tmp_path,
        [HttpResponse(url="", status_code=200, text=payload, headers={})],
    )

    entity = extractor.live_deps().fetch_wikidata_entity("Q2277")

    assert entity["id"] == "Q2277"
    method, url, headers = transport.calls[0]
    assert method == "GET"
    assert url.endswith("/Special:EntityData/Q2277.json")
    # Identified, as the Wikimedia policy asks — not an anonymous fetch.
    assert headers["User-Agent"]


def test_a_second_lookup_of_one_qid_is_served_from_the_cache(tmp_path: Path) -> None:
    payload = json.dumps(load("wikidata-Q2277"))
    transport = _install(
        tmp_path,
        [HttpResponse(url="", status_code=200, text=payload, headers={})],
    )

    deps = extractor.live_deps()
    deps.fetch_wikidata_entity("Q2277")
    deps.fetch_wikidata_entity("Q2277")

    assert len(transport.calls) == 1  # the second never reached the network


def test_an_upstream_error_status_is_an_extraction_error(tmp_path: Path) -> None:
    _install(
        tmp_path, [HttpResponse(url="", status_code=404, text="", headers={})]
    )
    with pytest.raises(extractor.UrlExtractionError) as raised:
        extractor.live_deps().fetch_wikidata_entity("Q999999999")
    assert "404" in str(raised.value)


def _claim(target: str) -> dict[str, Any]:
    return {
        "mainsnak": {
            "snaktype": "value",
            "datavalue": {"value": {"id": target}, "type": "wikibase-entityid"},
        }
    }
