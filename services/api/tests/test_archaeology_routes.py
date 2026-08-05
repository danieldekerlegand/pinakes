"""The two archaeology routes over HTTP — `/api/scraping/archaeology*`.

The behavioural coverage that used to live in
`server/routes/archaeological-acquisition.test.ts` (pinakes:64 US-2); that file
now asserts only the hand-off.

Neither route carries a recorded parity fixture (`x-pinakes-parity.fixtures` is
empty for both), so `test_parity_replay.py` cannot grade them and there is
nothing to add to its `GRADED` tuple. The coverage assertion below is what stands
in for it: it is the statement that these two paths left the 501 catalog, which
is the one thing a replay would otherwise have caught.

The `onJobSettled` hook the TypeScript route carried has **no counterpart here**
and needs none: `TestClient` runs a `BackgroundTask` to completion before it
returns the response, so a job is already settled by the line after the POST.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from conftest import coverage_of
from pinakes.ingest import archaeology, jobs
from test_archaeology import TDAR, FixtureDeps, UnreachableDeps


@pytest.fixture
def authorities(monkeypatch: pytest.MonkeyPatch) -> FixtureDeps:
    """Answer both authorities from the recordings, for the whole request."""
    deps = FixtureDeps()
    monkeypatch.setattr(archaeology, "live_deps", lambda: deps)
    return deps


# ── The port itself ──────────────────────────────────────────────────────────


def test_the_group_is_registered_rather_than_stubbed(
    unbuilt_client: TestClient,
) -> None:
    """What "ported" means here: both paths left the 501 catalog."""
    ported = {route.key for route in coverage_of(unbuilt_client).ported}
    assert {
        ("GET", "/api/scraping/archaeology/sources"),
        ("POST", "/api/scraping/archaeology"),
    } <= ported


# ── GET /api/scraping/archaeology/sources ────────────────────────────────────


def test_the_sources_endpoint_lists_the_two_authorities(
    unbuilt_client: TestClient,
) -> None:
    response = unbuilt_client.get("/api/scraping/archaeology/sources")

    assert response.status_code == 200
    sources = response.json()["sources"]
    assert sorted(source["id"] for source in sources) == ["open-context", "tdar"]
    # Four fields, and only four — the dashboard renders exactly these.
    assert set(sources[0]) == {"id", "label", "description", "homepage"}


# ── POST /api/scraping/archaeology ───────────────────────────────────────────


def test_a_started_job_queues_its_sites_for_review(
    unbuilt_client: TestClient,
    authorities: FixtureDeps,
    isolated_data_trees: dict[str, Path],
) -> None:
    response = unbuilt_client.post(
        "/api/scraping/archaeology", json={"source": "tdar", "limit": 50}
    )

    assert response.status_code == 202
    body = response.json()
    assert body["source"] == "tdar"
    assert isinstance(body["jobId"], str)
    assert authorities.calls == [("tdar", None, 50)]

    # Acquired rows are in `data/runtime/contributions`, pending, never the corpus.
    written = sorted(isolated_data_trees["contributions"].glob("*.json"))
    assert len(written) == 2
    record = json.loads(written[0].read_text(encoding="utf-8"))
    assert record["status"] == "pending"
    assert record["entityType"] == "archaeological-site"
    assert record["entityData"]["source"] == "tdar"
    assert record["entityData"]["autoDerived"] is True


def test_the_job_settles_with_what_the_run_did(
    unbuilt_client: TestClient, authorities: FixtureDeps
) -> None:
    body = unbuilt_client.post(
        "/api/scraping/archaeology", json={"source": "open-context"}
    ).json()

    job = jobs.get_job(body["jobId"])
    assert job is not None
    assert job["status"] == "completed"
    assert job["languageId"] == "archaeology:open-context"
    assert job["dataSource"] == "other"
    assert (job["completedWords"], job["failedWords"], job["totalWords"]) == (2, 0, 2)
    assert job["statusMessage"] == (
        "Queued 2 archaeological site(s) for review (0 skipped, 2 fetched)."
    )


def test_a_query_reaches_the_authority(
    unbuilt_client: TestClient, authorities: FixtureDeps
) -> None:
    unbuilt_client.post(
        "/api/scraping/archaeology", json={"source": "tdar", "query": "hohokam"}
    )
    assert authorities.calls == [("tdar", "hohokam", None)]


def test_an_unreachable_authority_fails_the_job_not_the_request(
    unbuilt_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """202 was already sent — the job is the only place left to report this."""
    monkeypatch.setattr(archaeology, "live_deps", UnreachableDeps)

    response = unbuilt_client.post(
        "/api/scraping/archaeology", json={"source": "tdar"}
    )

    assert response.status_code == 202
    job = jobs.get_job(response.json()["jobId"])
    assert job is not None
    assert job["status"] == "failed"
    assert job["errorMessage"] == "network down"
    assert job["statusMessage"] == "Acquisition failed: network down"


def test_an_unknown_source_is_a_400_naming_the_valid_ones(
    unbuilt_client: TestClient, authorities: FixtureDeps
) -> None:
    response = unbuilt_client.post(
        "/api/scraping/archaeology", json={"source": "not-a-source"}
    )

    assert response.status_code == 400
    body = response.json()
    assert body["message"] == "Unknown archaeological source: not-a-source"
    assert body["validSources"] == ["open-context", "tdar"]
    assert authorities.calls == []


def test_a_body_that_names_no_source_says_so(
    unbuilt_client: TestClient, authorities: FixtureDeps
) -> None:
    response = unbuilt_client.post("/api/scraping/archaeology", json={})
    assert response.status_code == 400
    assert response.json()["message"] == "Unknown archaeological source: (none)"


@pytest.mark.parametrize("limit", [-5, 0, "soon", {}])
def test_a_non_positive_or_unparseable_limit_is_a_400_not_a_422(
    unbuilt_client: TestClient, authorities: FixtureDeps, limit: Any
) -> None:
    response = unbuilt_client.post(
        "/api/scraping/archaeology", json={"source": "open-context", "limit": limit}
    )
    assert response.status_code == 400
    assert response.json() == {"message": "limit must be a positive number"}


def test_a_numeric_string_limit_is_read_as_a_number(
    unbuilt_client: TestClient, authorities: FixtureDeps
) -> None:
    """`Number("50")` is fifty on both servers; a declared `int` would 422."""
    response = unbuilt_client.post(
        "/api/scraping/archaeology", json={"source": "tdar", "limit": "50"}
    )
    assert response.status_code == 202
    assert authorities.calls == [("tdar", None, 50)]


def test_a_null_limit_is_no_limit_at_all(
    unbuilt_client: TestClient, authorities: FixtureDeps
) -> None:
    response = unbuilt_client.post(
        "/api/scraping/archaeology", json={"source": "tdar", "limit": None}
    )
    assert response.status_code == 202
    assert authorities.calls == [("tdar", None, None)]


def test_a_junk_body_is_refused_before_anything_is_started(
    unbuilt_client: TestClient, authorities: FixtureDeps
) -> None:
    response = unbuilt_client.post("/api/scraping/archaeology", json=["nope"])
    assert response.status_code == 400
    assert jobs.all_jobs() == []


def test_every_acquired_row_carries_a_resolvable_citation(
    unbuilt_client: TestClient,
    authorities: FixtureDeps,
    isolated_data_trees: dict[str, Path],
) -> None:
    """Provenance is what lets a reviewer trace a row back to its authority."""
    unbuilt_client.post("/api/scraping/archaeology", json={"source": "tdar"})

    urls = {
        json.loads(path.read_text(encoding="utf-8"))["entityData"]["sourceUrl"]
        for path in isolated_data_trees["contributions"].glob("*.json")
    }
    assert urls == {
        resource["url"] if "url" in resource else resource["detailUrl"]
        for resource in TDAR["resources"][:2]
    }
