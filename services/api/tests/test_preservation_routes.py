"""The preservation dashboard and the field-research update (pinakes:80 US-1).

No recorded fixture grades either route, so this file is the whole gate. The
two things it exists to pin are the ones a rewrite would quietly change: the
alias table's *bucketing* (an unrecognised status is `unknown`, never `living`)
and the field-update workflow's **two** side effects — a queued contribution and
a changelog entry, written at submission time rather than at approval.

`conftest.py`'s autouse `isolated_data_trees` redirects the lexicons corpus, the
contribution queue and the changelog into this test's temp tree, so every case
here seeds its own rows and asserts on what was actually written.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from pinakes.app import create_app
from pinakes.lexicons import preservation

LANGUAGE_HEADER = (
    "id\tname\tfamily_id\tstatus\tregion\tnative_speakers\ttotal_speakers\t"
    "endangerment_status"
)


@pytest.fixture
def corpus(isolated_data_trees: dict[str, Path]) -> Path:
    lexicons = isolated_data_trees["lexicons"]
    lexicons.mkdir(parents=True, exist_ok=True)
    return lexicons


@pytest.fixture
def client(corpus: Path) -> TestClient:
    """Built after `corpus`, so the app resolves this test's temp lexicons tree."""
    return TestClient(create_app())


def write_languages(corpus: Path, *rows: str) -> None:
    (corpus / "languages.tsv").write_text(
        "\n".join([LANGUAGE_HEADER, *rows]) + "\n", encoding="utf-8"
    )


@pytest.fixture
def languages(corpus: Path) -> Path:
    write_languages(
        corpus,
        "cmn\tMandarin\tsino\tliving\tEast Asia\t900\t1100\t",
        "ain\tAinu\tisolate\tcritically endangered\tJapan\t2\t10\t",
        "yug\tYugh\tyeniseian\tmoribund\tRussia\t\t1\t",
        # The sourced UNESCO enrichment wins over the free-text `status`.
        "cor\tCornish\tceltic\tliving\tBritain\t600\t600\trevitalizing",
        "lat\tLatin\titalic\textinct\tItaly\t\t\t",
        "zzz\tZed\tisolate\tperfectly fine\t\t\t\t",
    )
    return corpus


# ── The vitality model ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("raw", "key"),
    [
        ("living", "living"),
        ("  LIVING  ", "living"),
        ("Critically   Endangered", "critically-endangered"),
        # The corpus's own misspellings, which is why the alias table exists.
        ("definiteley endangered", "definitely-endangered"),
        ("definately endangered", "definitely-endangered"),
        # An already-canonical key round-trips through the space → hyphen swap.
        ("severely-endangered", "severely-endangered"),
        # Substring fallbacks, in the order they are tested: `critically`
        # outranks the bare `endanger` that also matches it.
        ("moderately endangered", "endangered"),
        ("critically threatened", "critically-endangered"),
        ("functionally extinct", "extinct"),
        ("", "unknown"),
        (None, "unknown"),
        ("gibberish", "unknown"),
    ],
)
def test_normalize_status(raw: Any, key: str) -> None:
    assert preservation.normalize_status(raw).key == key


def test_an_unrecognized_status_is_unknown_not_living() -> None:
    """The honesty rule: a messy cell is never quietly bucketed as safe."""
    level = preservation.normalize_status("perfectly fine")
    assert (level.key, level.category, level.rank) == ("unknown", "unknown", -1)


def test_trim_uses_v8s_whitespace_set_not_pythons() -> None:
    """U+FEFF is whitespace to V8 and not to Python; `\\x85` is the reverse.

    A status cell wrapped in either character therefore normalizes differently
    on the two engines unless the class is spelled out.
    """
    assert preservation.js_trim("﻿living﻿") == "living"
    assert preservation.js_trim("\x85living\x85") == "\x85living\x85"


@pytest.mark.parametrize(
    ("value", "text"),
    [
        (None, "null"),
        (True, "true"),
        ([], ""),
        (["a", None, "b"], "a,,b"),
        ({"a": 1}, "[object Object]"),
        (1234.0, "1234"),
        (1234.5, "1234.5"),
    ],
)
def test_js_string(value: Any, text: str) -> None:
    assert preservation.js_string(value) == text


def test_an_empty_array_region_proposes_no_change() -> None:
    """`String([])` is `""`, so the truthiness test drops it. `str([])` is not."""
    assert preservation.changed_fields({"region": []}) == []
    assert preservation.changed_fields({"region": ["East Asia"]}) == ["region"]


def test_a_zero_speaker_count_is_a_change() -> None:
    """`String(0)` is `"0"` — truthy as a string, however falsy as a number."""
    assert preservation.changed_fields({"totalSpeakers": 0}) == ["totalSpeakers"]


def test_changed_fields_reports_the_declared_order() -> None:
    assert preservation.changed_fields(
        {"region": "R", "totalSpeakers": 1, "status": "extinct"}
    ) == ["status", "totalSpeakers", "region"]


# ── The dashboard ────────────────────────────────────────────────────────────


def test_dashboard_buckets_and_counts(client: TestClient, languages: Path) -> None:
    body = client.get("/api/languages/preservation").json()

    assert body["total"] == 6
    assert body["classified"] == 5
    assert body["byCategory"] == {
        "living": 1,
        "endangered": 3,
        "extinct": 1,
        "unknown": 1,
    }
    # `endangered / (living + endangered)` — extinct and unknown are excluded.
    assert body["endangermentRate"] == 0.75
    # Only the endangered languages contribute, and `totalSpeakers` wins.
    assert body["speakersAtRisk"] == 611


def test_the_sourced_endangerment_status_outranks_the_free_text_one(
    client: TestClient, languages: Path
) -> None:
    """Cornish is `living` in `status` and `revitalizing` in the enrichment."""
    body = client.get("/api/languages/preservation").json()
    watchlist = {row["id"]: row["vitalityKey"] for row in body["watchlist"]}
    assert watchlist["cor"] == "revitalizing"


def test_vitality_walks_the_risk_ladder_and_omits_absent_levels(
    client: TestClient, languages: Path
) -> None:
    body = client.get("/api/languages/preservation").json()
    assert [row["key"] for row in body["vitality"]] == [
        "living",
        "revitalizing",
        "critically-endangered",
        "moribund",
        "extinct",
        "unknown",
    ]
    assert [row["count"] for row in body["vitality"]] == [1, 1, 1, 1, 1, 1]


def test_the_watchlist_is_riskiest_first_then_fewest_speakers(
    client: TestClient, languages: Path
) -> None:
    body = client.get("/api/languages/preservation").json()
    assert [row["id"] for row in body["watchlist"]] == ["yug", "ain", "cor"]


def test_an_unknown_speaker_count_sorts_last_among_equal_ranks(
    client: TestClient, corpus: Path
) -> None:
    """`?? Number.POSITIVE_INFINITY` — not zero, which would sort it first."""
    write_languages(
        corpus,
        "a\tAlpha\tf\tmoribund\tR\t\t\t",
        "b\tBravo\tf\tmoribund\tR\t\t9\t",
    )
    body = client.get("/api/languages/preservation").json()
    assert [row["id"] for row in body["watchlist"]] == ["b", "a"]


def test_a_blank_region_is_its_own_bucket(
    client: TestClient, languages: Path
) -> None:
    body = client.get("/api/languages/preservation").json()
    assert "Unknown region" in {row["region"] for row in body["regions"]}
    # The *watchlist* spells the same absence as `null`, not as the label.
    assert all(row["region"] != "Unknown region" for row in body["watchlist"])


def test_regions_are_most_endangered_first(
    client: TestClient, languages: Path
) -> None:
    body = client.get("/api/languages/preservation").json()
    rates = [row["endangermentRate"] for row in body["regions"]]
    assert rates == sorted(rates, reverse=True)


@pytest.mark.parametrize(
    ("query", "size"),
    [
        ("", 3),
        ("?watchlistLimit=1", 1),
        ("?watchlistLimit=2.9", 2),
        # `Number("")` is 0 and finite, so a **blank** parameter is a bound of
        # zero; `Number("abc")` is NaN, which fails the guard and defaults to 25.
        ("?watchlistLimit=", 0),
        ("?watchlistLimit=abc", 3),
        ("?watchlistLimit=-4", 0),
        # `Number` reads the non-decimal literals `parseInt` does not.
        ("?watchlistLimit=0x2", 2),
        # An array fails Express's `typeof raw === "string"` outright.
        ("?watchlistLimit=1&watchlistLimit=2", 3),
        ("?watchlistLimit=Infinity", 3),
    ],
)
def test_watchlist_limit(
    client: TestClient, languages: Path, query: str, size: int
) -> None:
    body = client.get("/api/languages/preservation" + query).json()
    assert len(body["watchlist"]) == size


def test_an_empty_corpus_reports_zero_rather_than_dividing_by_it(
    client: TestClient, corpus: Path
) -> None:
    write_languages(corpus)
    body = client.get("/api/languages/preservation").json()
    assert body["total"] == 0
    assert body["endangermentRate"] == 0
    assert body["vitality"] == []


def test_an_exact_rate_serialises_without_a_fraction(
    client: TestClient, corpus: Path
) -> None:
    """`1` on the wire, not `1.0` — every JavaScript number is a double."""
    write_languages(corpus, "a\tAlpha\tf\tmoribund\tR\t\t4\t")
    raw = client.get("/api/languages/preservation").text
    assert '"endangermentRate":1,' in raw
    assert '"share":1}' in raw


# ── The field-research update ────────────────────────────────────────────────

SOURCES = [{"title": "Field notes 2026", "url": "https://example.org/notes"}]


def submit(client: TestClient, **body: Any) -> Any:
    return client.post("/api/languages/field-update", json=body)


def test_a_valid_update_queues_a_contribution_and_logs_the_change(
    client: TestClient,
    languages: Path,
    isolated_data_trees: dict[str, Path],
) -> None:
    response = submit(
        client,
        languageId="cmn",
        researcherName="A. Fieldworker",
        status="vulnerable",
        sources=SOURCES,
    )
    assert response.status_code == 201
    body = response.json()
    assert body["changedFields"] == ["status"]

    queued = json.loads(
        next(isolated_data_trees["contributions"].glob("*.json")).read_text()
    )
    assert queued["entityType"] == "language"
    assert queued["action"] == "edit"
    assert queued["status"] == "pending"
    assert queued["entityId"] == "cmn"
    # Provenance, and the denormalized name the route filled from storage.
    assert queued["entityData"]["source"] == "field-research"
    assert queued["entityData"]["fieldResearch"] is True
    assert queued["entityData"]["name"] == "Mandarin"
    # A field observation is corroboration, not certainty.
    assert queued["confidence"] == 60

    entry = json.loads(
        next(isolated_data_trees["changelog"].glob("*.json")).read_text()
    )
    assert entry["domain"] == "language"
    assert entry["changeType"] == "modified"
    assert entry["source"] == "field-research"
    assert entry["targetId"] == "cmn"
    assert entry["reviewer"] == "A. Fieldworker"
    assert entry["sourceUrl"] == "https://example.org/notes"
    assert entry["contributionId"] == queued["id"]
    assert body["changelogEntryId"] == entry["id"]


def test_the_changelog_records_at_submission_not_at_approval(
    client: TestClient,
    languages: Path,
    isolated_data_trees: dict[str, Path],
) -> None:
    """A status change is versioned immediately — that is the AC's design.

    This is the *only* entry the standard review path would not have written,
    and it is distinct from the `source: contribution` one an approval logs
    later. The contribution is still `pending`, which is what makes the point.
    """
    submit(
        client,
        languageId="ain",
        researcherName="R",
        status="extinct",
        sources=SOURCES,
    )
    queued = json.loads(
        next(isolated_data_trees["contributions"].glob("*.json")).read_text()
    )
    assert queued["status"] == "pending"
    assert len(list(isolated_data_trees["changelog"].glob("*.json"))) == 1


def test_a_single_field_change_fills_the_review_triple(
    client: TestClient,
    languages: Path,
    isolated_data_trees: dict[str, Path],
) -> None:
    submit(
        client,
        languageId="cmn",
        researcherName="R",
        status="extinct",
        sources=SOURCES,
    )
    queued = json.loads(
        next(isolated_data_trees["contributions"].glob("*.json")).read_text()
    )
    assert queued["fieldName"] == "status"
    assert queued["suggestedValue"] == "extinct"
    # Enriched from storage, because the body declared none.
    assert queued["currentValue"] == "living"


def test_several_changes_carry_no_per_field_triple(
    client: TestClient,
    languages: Path,
    isolated_data_trees: dict[str, Path],
) -> None:
    submit(
        client,
        languageId="cmn",
        researcherName="R",
        status="extinct",
        totalSpeakers=4,
        sources=SOURCES,
    )
    queued = json.loads(
        next(isolated_data_trees["contributions"].glob("*.json")).read_text()
    )
    assert "fieldName" not in queued
    assert "suggestedValue" not in queued


def test_an_integral_float_speaker_count_is_written_without_its_fraction(
    client: TestClient,
    languages: Path,
    isolated_data_trees: dict[str, Path],
) -> None:
    """`JSON.parse("1234.0")` is the double `1234` and restringifies as `1234`.

    Python's `json` keeps the `float`, which would persist `1234.0` into a queue
    both servers read — the one place a value straight out of a request still
    needs `js_number`.
    """
    client.post(
        "/api/languages/field-update",
        content=json.dumps(
            {
                "languageId": "cmn",
                "researcherName": "R",
                "nativeSpeakers": 1234.0,
                "sources": SOURCES,
            }
        ),
        headers={"content-type": "application/json"},
    )
    raw = next(isolated_data_trees["contributions"].glob("*.json")).read_text()
    assert '"nativeSpeakers": 1234' in raw
    assert "1234.0" not in raw


@pytest.mark.parametrize(
    ("body", "error"),
    [
        ({"researcherName": "R", "status": "extinct"}, "languageId is required"),
        (
            {"languageId": "cmn", "status": "extinct"},
            "researcherName is required (field updates must be attributed)",
        ),
        (
            {"languageId": "cmn", "researcherName": "R", "status": "extinct"},
            "at least one source is required (field updates must be sourced)",
        ),
        (
            {
                "languageId": "cmn",
                "researcherName": "R",
                "status": "extinct",
                "sources": [{"url": "https://example.org"}],
            },
            "at least one source must have a title",
        ),
        (
            {"languageId": "cmn", "researcherName": "R", "sources": SOURCES},
            "provide at least one changed field (status, nativeSpeakers, "
            "totalSpeakers, or region)",
        ),
        (
            {
                "languageId": "cmn",
                "researcherName": "R",
                "totalSpeakers": -1,
                "sources": SOURCES,
            },
            "totalSpeakers must be a non-negative number",
        ),
        (
            {
                "languageId": "cmn",
                "researcherName": "R",
                "status": "extinct",
                "confidence": 150,
                "sources": SOURCES,
            },
            "confidence must be a number between 1 and 100",
        ),
    ],
)
def test_validation_refusals(
    client: TestClient, languages: Path, body: dict[str, Any], error: str
) -> None:
    response = client.post("/api/languages/field-update", json=body)
    assert response.status_code == 400
    assert response.json()["message"] == "Validation failed"
    assert error in response.json()["errors"]


def test_a_declared_null_confidence_is_an_error_where_an_absent_one_is_not(
    client: TestClient, languages: Path
) -> None:
    """`input.confidence !== undefined` — the distinction `dict.get` collapses."""
    rejected = submit(
        client,
        languageId="cmn",
        researcherName="R",
        status="extinct",
        confidence=None,
        sources=SOURCES,
    )
    assert rejected.status_code == 400
    assert "confidence must be a number between 1 and 100" in rejected.json()["errors"]

    accepted = submit(
        client,
        languageId="cmn",
        researcherName="R",
        status="extinct",
        sources=SOURCES,
    )
    assert accepted.status_code == 201


def test_a_boolean_speaker_count_is_not_a_number(
    client: TestClient, languages: Path
) -> None:
    """`typeof true === "boolean"` — where `isinstance(True, int)` would pass."""
    response = submit(
        client,
        languageId="cmn",
        researcherName="R",
        totalSpeakers=True,
        sources=SOURCES,
    )
    assert response.status_code == 400
    assert "totalSpeakers must be a non-negative number" in response.json()["errors"]


def test_an_unrecognized_status_warns_and_is_still_recorded(
    client: TestClient, languages: Path
) -> None:
    response = submit(
        client,
        languageId="cmn",
        researcherName="R",
        status="flourishing wildly",
        sources=SOURCES,
    )
    assert response.status_code == 201
    assert response.json()["warnings"] == []
    # The warning belongs to *this* validator, not the queue's — the response
    # echoes the queue's, which is why a caller reads the two separately.
    validation = preservation.validate_field_update(
        {
            "languageId": "cmn",
            "researcherName": "R",
            "status": "flourishing wildly",
            "sources": SOURCES,
        }
    )
    assert validation.warnings == [
        "status 'flourishing wildly' is not a recognized vitality level and "
        "will be recorded as-is"
    ]


def test_a_malformed_email_warns_without_refusing() -> None:
    validation = preservation.validate_field_update(
        {
            "languageId": "cmn",
            "researcherName": "R",
            "researcherEmail": "not-an-email",
            "status": "extinct",
            "sources": SOURCES,
        }
    )
    assert validation.valid is True
    assert validation.warnings == ["researcherEmail format appears invalid"]


def test_an_unknown_language_is_a_404_after_validation_passes(
    client: TestClient, languages: Path
) -> None:
    response = submit(
        client,
        languageId="nope",
        researcherName="R",
        status="extinct",
        sources=SOURCES,
    )
    assert response.status_code == 404
    assert response.json() == {"message": "Language 'nope' not found"}


def test_the_language_id_is_matched_untrimmed(
    client: TestClient, languages: Path
) -> None:
    """Validation trims to decide the id is *present*; the lookup does not."""
    response = submit(
        client,
        languageId="  cmn  ",
        researcherName="R",
        status="extinct",
        sources=SOURCES,
    )
    assert response.status_code == 404


def test_a_declared_null_speaker_count_renders_as_null_in_the_summary() -> None:
    """`${null}` interpolates as `"null"`, and the guard is `!== undefined`."""
    summary = preservation.field_update_summary(
        {
            "languageId": "cmn",
            "researcherName": "R",
            "status": "dormant",
            "totalSpeakers": None,
            "currentStatus": "living",
        }
    )
    assert summary == (
        "status living → dormant; total speakers → null "
        "(field research by R)"
    )


def test_a_summary_with_nothing_to_name_falls_back(
    client: TestClient,
) -> None:
    assert preservation.field_update_summary({"researcherName": "R"}) == (
        "field-research update (field research by R)"
    )


def test_a_failed_changelog_write_omits_the_key_rather_than_nulling_it(
    client: TestClient,
    languages: Path,
    isolated_data_trees: dict[str, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Losing the audit line must never cost the researcher their submission."""
    from pinakes.contributions import changelog

    monkeypatch.setattr(changelog, "record_change", lambda *a, **k: None)
    response = submit(
        client,
        languageId="cmn",
        researcherName="R",
        status="extinct",
        sources=SOURCES,
    )
    assert response.status_code == 201
    assert "changelogEntryId" not in response.json()
    assert list(isolated_data_trees["contributions"].glob("*.json"))


def test_the_preservation_route_outranks_the_language_id_route(
    client: TestClient, languages: Path
) -> None:
    """`catalog.py` re-registers the static path ahead of its own wildcard.

    Without that, `discover_routers`' module-name order (`catalog` before
    `preservation`) would have `/api/languages/{id}` swallow this and answer
    `Language not found`.
    """
    response = client.get("/api/languages/preservation")
    assert response.status_code == 200
    assert "watchlist" in response.json()
