"""`/api/living-dataset/*` — the corpus's ingestion and release lifecycle.

The pure schedules take their clock as a parameter and are tested directly; the
ingest route is driven with a stubbed acquisition runner, because the real one
talks to Wikidata. That stub is the whole reason this file can assert on the
partial-failure path at all: a domain that throws must land in `errors[]` and
must **not** get an ingestion stamp.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from pinakes.acquire import catalog
from pinakes.acquire import job as acquisition_job
from pinakes.acquire.job import AcquisitionOutcome
from pinakes.app import create_app
from pinakes.dataset import living
from pinakes.routers import living_dataset

WRITING_SYSTEMS = "\n".join(["id\tname\tlanguage_id", "latin\tLatin\tlat"])

NOW = datetime(2026, 8, 5, 12, 0, 0, tzinfo=UTC)


@pytest.fixture
def client(isolated_data_trees: dict[str, Path]) -> TestClient:
    lexicons: Path = isolated_data_trees["lexicons"]
    (lexicons / "writing-systems.tsv").write_text(
        WRITING_SYSTEMS + "\n", encoding="utf-8"
    )
    return TestClient(create_app(client_directory=Path("/nonexistent")))


# ── The release cadence ──────────────────────────────────────────────────────


def test_a_corpus_that_has_never_been_released_is_always_due() -> None:
    cadence = living.compute_release_cadence(None, NOW)
    assert cadence["dueNow"] is True
    assert cadence["nextReleaseDate"] is None
    assert cadence["daysUntilDue"] is None


def test_an_unparseable_last_release_reads_as_never_released_and_says_so() -> None:
    """`new Date("soon")` is an Invalid Date — a missing timestamp, not an error.

    The junk string is echoed back rather than nulled, so an operator can see
    that the recorded date was garbage rather than absent.
    """
    cadence = living.compute_release_cadence("soon", NOW)
    assert cadence["dueNow"] is True
    assert cadence["lastReleaseDate"] == "soon"


def test_the_next_release_is_a_year_on_and_the_countdown_rounds_up() -> None:
    cadence = living.compute_release_cadence("2026-06-05T12:00:00.000Z", NOW)
    assert cadence["nextReleaseDate"] == "2027-06-05T12:00:00.000Z"
    assert cadence["dueNow"] is False
    assert cadence["daysUntilDue"] == 304


def test_an_overdue_release_counts_down_past_zero() -> None:
    cadence = living.compute_release_cadence("2020-01-01T00:00:00.000Z", NOW)
    assert cadence["dueNow"] is True
    assert cadence["daysUntilDue"] < 0


def test_a_recorded_date_is_re_normalised_on_the_way_out() -> None:
    """`last.toISOString()` — a hand-written state file comes back canonical."""
    cadence = living.compute_release_cadence("2026-06-05T12:00:00Z", NOW)
    assert cadence["lastReleaseDate"] == "2026-06-05T12:00:00.000Z"


# ── The ingestion schedule ───────────────────────────────────────────────────


def test_every_domain_is_due_when_nothing_has_been_ingested() -> None:
    schedule = living.compute_ingestion_schedule({}, NOW)
    assert [entry["domain"] for entry in schedule] == list(catalog.ACQUISITION_CATALOG)
    assert all(entry["dueNow"] for entry in schedule)
    assert living.select_due_domains(schedule) == list(catalog.ACQUISITION_CATALOG)


def test_a_domain_ingested_yesterday_is_not_due_and_one_from_last_year_is() -> None:
    schedule = living.compute_ingestion_schedule(
        {"sites": "2026-08-04T12:00:00.000Z", "figures": "2025-08-04T12:00:00.000Z"},
        NOW,
    )
    by_domain = {entry["domain"]: entry for entry in schedule}
    assert by_domain["sites"]["dueNow"] is False
    assert by_domain["sites"]["daysSinceLastIngest"] == 1
    assert by_domain["figures"]["dueNow"] is True
    assert living.select_due_domains(schedule) == [
        "civilizations",
        "figures",
        "trade-goods",
    ]


# ── The store ────────────────────────────────────────────────────────────────


def test_the_current_release_is_the_last_appended_not_the_highest_version() -> None:
    current = living.current_release_from(
        [
            {"version": "9.9.9", "doi": None, "doiUrl": None, "releaseDate": "a",
             "totalRows": 1, "license": "CC-BY-4.0"},
            {"version": "1.0.1", "doi": None, "doiUrl": None, "releaseDate": "b",
             "totalRows": 2, "license": "CC-BY-4.0"},
        ]
    )
    assert current["version"] == "1.0.1"
    assert current["released"] is True


def test_a_corrupt_state_file_is_empty_state_rather_than_a_failure(
    isolated_data_trees: dict[str, Path]
) -> None:
    directory: Path = isolated_data_trees["living_dataset"]
    (directory / "state.json").write_text("{not json", encoding="utf-8")
    store = living.LivingDatasetStore()
    assert store.get_ingestions() == {}
    assert store.get_releases() == []


def test_the_store_round_trips_a_stamp_and_a_release(
    isolated_data_trees: dict[str, Path]
) -> None:
    store = living.LivingDatasetStore()
    store.record_ingestion("sites", "2026-08-05T00:00:00.000Z")
    store.record_release({"version": "1.0.1"})
    assert living.LivingDatasetStore().get_ingestions() == {
        "sites": "2026-08-05T00:00:00.000Z"
    }
    assert living.LivingDatasetStore().get_releases() == [{"version": "1.0.1"}]


# ── The routes ───────────────────────────────────────────────────────────────


def test_the_status_feed_composes_freshness_cadence_and_schedule(
    client: TestClient,
) -> None:
    body = client.get("/api/living-dataset/status").json()
    assert body["freshness"]["totalDatasets"] == 1
    assert body["currentRelease"] == {
        "version": "1.0.0",
        "doi": None,
        "doiUrl": None,
        "releaseDate": None,
        "totalRows": None,
        "license": "CC-BY-4.0",
        "released": False,
    }
    assert body["releaseCadence"]["dueNow"] is True
    assert body["ingestion"]["intervalDays"] == 30
    assert body["ingestion"]["dueCount"] == len(catalog.ACQUISITION_CATALOG)
    assert body["releaseHistory"] == []


def test_an_unknown_domain_refuses_the_whole_pass(client: TestClient) -> None:
    """Naming four domains and running three would be worse than running none."""
    response = client.post(
        "/api/living-dataset/ingest", json={"domains": ["banana", "sites", "pear"]}
    )
    assert response.status_code == 400
    assert response.json() == {"message": "Unknown domain(s): banana, pear"}
    assert living.LivingDatasetStore().get_ingestions() == {}


def test_a_named_domain_is_ingested_and_stamped(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[tuple[str, int | None]] = []

    def fake_run(category: Any, **kwargs: Any) -> AcquisitionOutcome:
        seen.append((category.domain, kwargs.get("limit")))
        return AcquisitionOutcome(
            domain=category.domain,
            acquired=3,
            queued=2,
            skipped=1,
            contribution_ids=("c1", "c2"),
        )

    monkeypatch.setattr(acquisition_job, "run", fake_run)

    body = client.post(
        "/api/living-dataset/ingest", json={"domains": ["sites"], "limit": 7}
    ).json()
    assert seen == [("sites", 7)]
    assert body["requested"] == ["sites"]
    assert body["totalQueued"] == 2
    assert body["ran"][0]["categoryId"] == "wikidata-archaeological-sites"
    assert body["errors"] == []
    assert "sites" in living.LivingDatasetStore().get_ingestions()


def test_a_failing_domain_is_collected_and_never_stamped(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_run(category: Any, **_kwargs: Any) -> AcquisitionOutcome:
        if category.domain == "sites":
            raise RuntimeError("upstream said no")
        return AcquisitionOutcome(
            domain=category.domain,
            acquired=1,
            queued=1,
            skipped=0,
            contribution_ids=("c1",),
        )

    monkeypatch.setattr(acquisition_job, "run", fake_run)

    body = client.post(
        "/api/living-dataset/ingest", json={"domains": ["sites", "figures"]}
    ).json()
    assert body["errors"] == [{"domain": "sites", "error": "upstream said no"}]
    assert [entry["domain"] for entry in body["ran"]] == ["figures"]
    assert body["totalQueued"] == 1
    assert set(living.LivingDatasetStore().get_ingestions()) == {"figures"}


def test_force_runs_every_domain_in_the_catalog(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        acquisition_job,
        "run",
        lambda category, **_k: AcquisitionOutcome(
            domain=category.domain,
            acquired=0,
            queued=0,
            skipped=0,
            contribution_ids=(),
        ),
    )
    living.LivingDatasetStore().record_ingestion(
        "sites", living_dataset._iso(datetime.now(UTC))
    )
    body = client.post("/api/living-dataset/ingest", json={"force": True}).json()
    assert body["requested"] == list(catalog.ACQUISITION_CATALOG)


def test_without_a_body_only_the_stale_domains_run(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        acquisition_job,
        "run",
        lambda category, **_k: AcquisitionOutcome(
            domain=category.domain,
            acquired=0,
            queued=0,
            skipped=0,
            contribution_ids=(),
        ),
    )
    living.LivingDatasetStore().record_ingestion(
        "sites", living_dataset._iso(datetime.now(UTC))
    )
    body = client.post("/api/living-dataset/ingest", json={}).json()
    assert "sites" not in body["requested"]
    assert body["requested"] == ["civilizations", "figures", "trade-goods"]


def test_a_release_is_recorded_and_the_next_one_walks_the_history_forward(
    client: TestClient,
) -> None:
    first = client.post(
        "/api/living-dataset/release", json={"datasets": ["writing-systems"]}
    )
    assert first.status_code == 201
    assert first.json()["release"]["version"] == "1.0.1"

    second = client.post(
        "/api/living-dataset/release", json={"datasets": ["writing-systems"]}
    ).json()
    assert second["release"]["version"] == "1.0.2"
    assert second["cadence"]["dueNow"] is False
    assert [r["version"] for r in living.LivingDatasetStore().get_releases()] == [
        "1.0.1",
        "1.0.2",
    ]


def test_the_release_appears_in_the_status_feed(client: TestClient) -> None:
    client.post("/api/living-dataset/release", json={"datasets": ["writing-systems"]})
    body = client.get("/api/living-dataset/status").json()
    assert body["currentRelease"]["version"] == "1.0.1"
    assert body["currentRelease"]["released"] is True
    assert body["releaseCadence"]["dueNow"] is False
    assert len(body["releaseHistory"]) == 1


def test_a_malformed_previous_version_is_a_400_and_records_nothing(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/living-dataset/release",
        json={"previousVersion": "nope", "datasets": ["writing-systems"]},
    )
    assert response.status_code == 400
    assert response.json() == {"message": "Invalid semver: nope"}
    assert living.LivingDatasetStore().get_releases() == []
