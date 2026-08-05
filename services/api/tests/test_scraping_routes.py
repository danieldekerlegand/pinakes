"""The scraper dashboard — the job ledger, status, coverage, engine start.

No fixture in `contracts/parity/` records a body for any of these
(`get-scraping-jobs` records the empty array and nothing else), so this file is
the grading. Every expectation here came out of a live diff against the Express
app: 52 requests over the ten routes, identical apart from the two job-list
orderings, which differ only because the four jobs land in different
milliseconds on the two runs — the tie-break rule itself is pinned below.

`conftest.py`'s autouse `reset_scraping_jobs` empties the ledger between tests
and `isolated_data_trees` points `$PINAKES_LEXICONS_DIR` at an empty tree, so a
coverage test seeds its own corpus.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from pinakes.ingest import jobs


@pytest.fixture
def corpus(isolated_data_trees: dict[str, Path]) -> Path:
    lexicons = isolated_data_trees["lexicons"]
    lexicons.mkdir(parents=True, exist_ok=True)
    return lexicons


def write(directory: Path, filename: str, header: str, *rows: str) -> None:
    (directory / filename).write_text(
        "\n".join([header, *rows]) + "\n", encoding="utf-8"
    )


# ── Constants ────────────────────────────────────────────────────────────────


def test_scraping_status_is_the_constant_it_was_on_express(
    unbuilt_client: TestClient,
) -> None:
    """A placeholder that never got wired up. Ported as the placeholder it is."""
    response = unbuilt_client.get("/api/scraping/status")
    assert response.status_code == 200
    assert response.json() == {"familyScraping": False, "wordScraping": []}


def test_engine_categories_lists_the_four_acquirable_domains(
    unbuilt_client: TestClient,
) -> None:
    body = unbuilt_client.get("/api/scraping/engine/categories").json()
    assert [category["domain"] for category in body["categories"]] == [
        "civilizations",
        "sites",
        "figures",
        "trade-goods",
    ]
    assert body["categories"][1] == {
        "domain": "sites",
        "id": "wikidata-archaeological-sites",
        "label": "Archaeological sites",
        "description": (
            "Archaeological sites with coordinates (Wikidata P31 → Q839954)."
        ),
        "entityType": "archaeological-site",
        "wikidataClass": "Q839954",
    }


# ── The job ledger ───────────────────────────────────────────────────────────


def test_the_job_list_starts_empty_and_a_missing_job_is_a_404(
    unbuilt_client: TestClient,
) -> None:
    assert unbuilt_client.get("/api/scraping-jobs").json() == []
    missing = unbuilt_client.get("/api/scraping-jobs/nope")
    assert missing.status_code == 404
    assert missing.json() == {"message": "Job not found"}


@pytest.mark.parametrize("language_id", ["", 0, None])
def test_a_falsy_language_id_is_refused(
    unbuilt_client: TestClient, language_id: Any
) -> None:
    """`if (!languageId)` — truthiness, so `0` and `""` are both a 400."""
    body = {} if language_id is None else {"languageId": language_id}
    response = unbuilt_client.post("/api/scraping-jobs", json=body)
    assert response.status_code == 400
    assert response.json() == {"message": "languageId is required"}


def test_a_created_job_carries_the_whole_ScrapingJob_shape(
    unbuilt_client: TestClient,
) -> None:
    job = unbuilt_client.post(
        "/api/scraping-jobs",
        json={"languageId": "est", "totalWords": 12, "dataSource": "wiktionary"},
    ).json()
    assert job["id"].startswith("job_")
    assert {key: job[key] for key in sorted(job) if key != "id"} == {
        "apiCallsUsed": None,
        "completedAt": None,
        "completedWords": 0,
        "createdAt": job["createdAt"],
        "dataSource": "wiktionary",
        "errorMessage": None,
        "failedWords": 0,
        "languageId": "est",
        "outputPath": None,
        "startedAt": None,
        "status": "pending",
        "totalWords": 12,
        "wordCount": None,
    }


def test_totalWords_is_truthiness_not_validation(unbuilt_client: TestClient) -> None:
    """`createJob(languageId, totalWords || 0, …)` — a junk value is *kept*.

    Only a falsy one falls back to zero. Narrowing this to an int here would be
    validation Express never did, and the dashboard would then disagree with
    itself about a job it had already accepted.
    """
    junk = unbuilt_client.post(
        "/api/scraping-jobs", json={"languageId": "hun", "totalWords": "lots"}
    ).json()
    assert junk["totalWords"] == "lots"

    zero = unbuilt_client.post(
        "/api/scraping-jobs", json={"languageId": "sme", "totalWords": 0}
    ).json()
    assert zero["totalWords"] == 0


def test_a_blank_dataSource_falls_back_to_gemini(unbuilt_client: TestClient) -> None:
    """`(dataSource as any) || "gemini"`, inside the store rather than the route."""
    job = unbuilt_client.post(
        "/api/scraping-jobs", json={"languageId": "fin", "dataSource": ""}
    ).json()
    assert job["dataSource"] == "gemini"


def test_the_job_list_is_newest_first_and_ties_keep_insertion_order(
    unbuilt_client: TestClient,
) -> None:
    """Express sorted `bTime - aTime` with V8's stable sort; equal timestamps
    therefore stay in creation order rather than reversing. Python's
    `sorted(reverse=True)` has the same rule — this is the assertion that says
    so, because the two really do collide in one millisecond in practice."""
    for language_id in ("a", "b", "c"):
        unbuilt_client.post("/api/scraping-jobs", json={"languageId": language_id})
    for job in jobs.all_jobs():
        jobs.update_job(job["id"], createdAt="2026-01-01T00:00:00.000Z")

    listed = unbuilt_client.get("/api/scraping-jobs").json()
    assert [job["languageId"] for job in listed] == ["a", "b", "c"]


def test_patching_a_job_merges_arbitrary_keys_including_its_own_id(
    unbuilt_client: TestClient,
) -> None:
    """`{...job, ...req.body}` is an unguarded spread, so a body can rename the
    record it is addressed by. Reproduced rather than guarded: both servers are
    reading one dashboard's writes during the cutover, and a PATCH this service
    refused would be a divergence, not a fix."""
    created = unbuilt_client.post(
        "/api/scraping-jobs", json={"languageId": "fin"}
    ).json()
    updated = unbuilt_client.patch(
        f"/api/scraping-jobs/{created['id']}",
        json={"status": "running", "completedWords": 3, "id": "hijacked"},
    ).json()
    assert updated["id"] == "hijacked"
    assert updated["status"] == "running"
    assert updated["completedWords"] == 3
    assert updated["languageId"] == "fin"


def test_patching_with_an_array_body_spreads_its_indices(
    unbuilt_client: TestClient,
) -> None:
    """`{...job, ...[7, 8]}` is `{"0": 7, "1": 8, …}` in JavaScript, and that is
    what lands on the record. Silly, and it is what happens."""
    created = unbuilt_client.post(
        "/api/scraping-jobs", json={"languageId": "fin"}
    ).json()
    updated = unbuilt_client.patch(
        f"/api/scraping-jobs/{created['id']}", json=[7, 8]
    ).json()
    assert updated["0"] == 7
    assert updated["1"] == 8
    assert updated["languageId"] == "fin"


def test_patching_a_missing_job_is_a_404(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.patch(
        "/api/scraping-jobs/nope", json={"status": "running"}
    )
    assert response.status_code == 404
    assert response.json() == {"message": "Job not found"}


def test_listing_prunes_settled_jobs_beyond_fifty_but_returns_them_first() -> None:
    """`cleanup()` runs *after* `getAllJobs()`, so the request that drops the
    51st settled job still serves it. And a job that has not settled is never
    dropped, however old — it still has a writer."""
    for index in range(60):
        job = jobs.create_job(f"lang-{index:02d}", 0)
        jobs.update_job(
            job["id"],
            status="completed",
            createdAt=f"2026-01-01T00:00:{index:02d}.000Z",
        )
    running = jobs.create_job("still-going", 0)
    jobs.update_job(running["id"], createdAt="2020-01-01T00:00:00.000Z")

    before = jobs.all_jobs()
    jobs.cleanup()
    after = jobs.all_jobs()

    assert len(before) == 61
    assert len(after) == 51
    assert running["id"] in {job["id"] for job in after}
    assert [job["languageId"] for job in after[:2]] == ["lang-59", "lang-58"]


# ── Coverage ─────────────────────────────────────────────────────────────────


@pytest.fixture
def coverage_corpus(corpus: Path) -> Path:
    write(
        corpus,
        "languages.tsv",
        "id\tname\tfamily_id\tstatus\tis_historical_variant\tis_dialect",
        "fin\tFinnish\turalic\tliving\tfalse\tfalse",
        "est\tEstonian\turalic\tliving\tfalse\tfalse",
        "sme\tNorthern Sami\turalic\tliving\tfalse\tfalse",
        "goh\tOld High German\tindo-european\thistorical\ttrue\tfalse",
        "swg\tSwabian\tindo-european\tliving\tfalse\ttrue",
    )
    write(
        corpus,
        "words-base.tsv",
        "number\tid_nelex\tgloss_en",
        "1\tAuge::N\teye",
        "2\tOhr::N\tear",
        "3\tNase::N\tnose",
    )
    write(
        corpus,
        "words.tsv",
        "Language_ID\tConcept_ID\tWord_Form\tIPA",
        "fin\tAuge::N\tsilmä\ts i l m æ",
        "fin\tOhr::N\tkorva\t",
        "est\tAuge::N\tsilm\ts i l m",
        "\tNase::N\torphan\t",
        "sme\t\torphan\t",
        "sme\tNase::N\t\t",
    )
    return corpus


def test_coverage_excludes_variants_and_dialects_and_sorts_by_word_count(
    unbuilt_client: TestClient, coverage_corpus: Path
) -> None:
    body = unbuilt_client.get("/api/scraping/coverage").json()
    assert body == [
        {
            "languageId": "fin",
            "languageName": "Finnish",
            "familyId": "uralic",
            "wordCount": 2,
            "totalBaseWords": 3,
            "coveragePercent": 67,
        },
        {
            "languageId": "est",
            "languageName": "Estonian",
            "familyId": "uralic",
            "wordCount": 1,
            "totalBaseWords": 3,
            "coveragePercent": 33,
        },
        {
            "languageId": "sme",
            "languageName": "Northern Sami",
            "familyId": "uralic",
            "wordCount": 0,
            "totalBaseWords": 3,
            "coveragePercent": 0,
        },
    ]


def test_a_row_missing_language_concept_or_form_is_dropped(
    unbuilt_client: TestClient, coverage_corpus: Path
) -> None:
    """The three orphan rows in the fixture are why `sme` scores zero rather
    than one — a blank in any of the three columns drops the form."""
    body = unbuilt_client.get("/api/scraping/coverage").json()
    assert {row["languageId"]: row["wordCount"] for row in body}["sme"] == 0


def test_coverage_survives_a_corpus_with_no_words_file(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """`loadForms` warns and carries on where `loadBaseWords` raises. A corpus
    with no `words.tsv` is a dashboard showing nothing scraped yet, not a 500."""
    write(
        corpus,
        "languages.tsv",
        "id\tname\tfamily_id\tstatus",
        "fin\tFinnish\turalic\tliving",
    )
    write(corpus, "words-base.tsv", "number\tid_nelex\tgloss_en", "1\tAuge::N\teye")

    body = unbuilt_client.get("/api/scraping/coverage").json()
    assert body == [
        {
            "languageId": "fin",
            "languageName": "Finnish",
            "familyId": "uralic",
            "wordCount": 0,
            "totalBaseWords": 1,
            "coveragePercent": 0,
        }
    ]


def test_a_corpus_with_no_concept_list_is_a_500(
    unbuilt_client: TestClient, corpus: Path
) -> None:
    """`loadBaseWords` is the one loader that raises on a missing file, so the
    handler's own try/catch answers `{message}` — the inline-`routes.ts` 500."""
    write(
        corpus,
        "languages.tsv",
        "id\tname\tfamily_id\tstatus",
        "fin\tFinnish\turalic\tliving",
    )
    response = unbuilt_client.get("/api/scraping/coverage")
    assert response.status_code == 500
    assert response.json() == {"message": "Failed to fetch word coverage"}


# ── Starting a Wikidata acquisition ──────────────────────────────────────────


@pytest.mark.parametrize(
    ("body", "named"),
    [
        ({}, "(none)"),
        ({"domain": ""}, ""),
        ({"domain": "nope"}, "nope"),
        ({"domain": 7}, "7"),
    ],
)
def test_an_unresolvable_domain_is_a_400_naming_what_was_asked_for(
    unbuilt_client: TestClient, body: dict[str, Any], named: str
) -> None:
    """`${body.domain ?? "(none)"}` is *nullish*, so a blank domain is reported
    as the blank it was rather than as "none named"."""
    response = unbuilt_client.post("/api/scraping/engine", json=body)
    assert response.status_code == 400
    assert response.json() == {
        "message": f"Unknown pinakes-engine domain: {named}",
        "validDomains": ["civilizations", "sites", "figures", "trade-goods"],
    }


@pytest.mark.parametrize("limit", ["soon", 0, -3, [1]])
def test_a_non_positive_or_unparseable_limit_is_a_400(
    unbuilt_client: TestClient, limit: Any
) -> None:
    """`Number(...)` + `Number.isFinite(...)`, not a declared `int` field — so
    this is a 400 with a message rather than FastAPI's 422 validation body."""
    response = unbuilt_client.post(
        "/api/scraping/engine", json={"domain": "sites", "limit": limit}
    )
    assert response.status_code == 400
    assert response.json() == {"message": "limit must be a positive number"}


def test_a_string_limit_that_parses_is_accepted(
    unbuilt_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`"50"` is fifty. The acquisition itself is stubbed — what is under test is
    that the route got past its own validation and opened a job."""
    seen: dict[str, Any] = {}

    def fake_run(category: Any, **kwargs: Any) -> Any:
        seen["domain"] = category.domain
        seen["limit"] = kwargs.get("limit")
        raise RuntimeError("no network in tests")

    monkeypatch.setattr("pinakes.routers.scraping.acquisition_job.run", fake_run)

    response = unbuilt_client.post(
        "/api/scraping/engine", json={"domain": "sites", "limit": "50"}
    )
    assert response.status_code == 202
    body = response.json()
    assert body["domain"] == "sites"
    assert body["message"] == (
        "pinakes-engine Wikidata acquisition started for Archaeological sites"
    )
    assert seen == {"domain": "sites", "limit": 50}


def test_a_failed_acquisition_fails_the_job_not_the_request(
    unbuilt_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The 202 has already been sent, so there is nowhere else to report it.

    `TestClient` settles the background task before returning the response,
    which is why the job can be asserted on the very next line.
    """

    def fake_run(category: Any, **kwargs: Any) -> Any:
        raise RuntimeError("wikidata said no")

    monkeypatch.setattr("pinakes.routers.scraping.acquisition_job.run", fake_run)

    job_id = unbuilt_client.post(
        "/api/scraping/engine", json={"domain": "figures"}
    ).json()["jobId"]

    job = unbuilt_client.get(f"/api/scraping-jobs/{job_id}").json()
    assert job["status"] == "failed"
    assert job["errorMessage"] == "wikidata said no"
    assert job["statusMessage"] == "Acquisition failed: wikidata said no"
    assert job["languageId"] == "pinakes_engine:figures"


def test_a_completed_acquisition_settles_its_job_with_the_counts(
    unbuilt_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The job the dashboard polls is the *only* progress surface this route has
    — `acquire.job.run` reports nothing intermediate."""
    from pinakes.acquire.job import AcquisitionOutcome

    def fake_run(category: Any, **kwargs: Any) -> AcquisitionOutcome:
        return AcquisitionOutcome(
            domain=category.domain,
            acquired=9,
            queued=7,
            skipped=2,
            contribution_ids=("c1", "c2"),
        )

    monkeypatch.setattr("pinakes.routers.scraping.acquisition_job.run", fake_run)

    started = unbuilt_client.post(
        "/api/scraping/engine", json={"domain": "trade-goods", "limit": 9}
    )
    assert started.status_code == 202

    job = unbuilt_client.get(f"/api/scraping-jobs/{started.json()['jobId']}").json()
    assert job["status"] == "completed"
    assert (job["completedWords"], job["failedWords"], job["totalWords"]) == (7, 2, 9)
    assert job["wordCount"] == 7
    assert job["statusMessage"] == (
        "Queued 7 Trade goods contribution(s) for review (2 skipped, 9 fetched)."
    )
    assert job["dataSource"] == "other"


def test_a_started_acquisition_is_visible_in_the_job_list(
    unbuilt_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The hole `ingest/jobs.py` and `acquire/job.py` both documented, closed:
    a job opened by this service now appears in the surface the dashboard polls."""
    monkeypatch.setattr(
        "pinakes.routers.scraping.acquisition_job.run",
        lambda category, **kwargs: (_ for _ in ()).throw(RuntimeError("stub")),
    )
    unbuilt_client.post("/api/scraping/engine", json={"domain": "civilizations"})

    listed = unbuilt_client.get("/api/scraping-jobs").json()
    assert [job["languageId"] for job in listed] == [
        "pinakes_engine:civilizations"
    ]
