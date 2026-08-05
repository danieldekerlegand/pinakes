"""Behaviour of the ported `/api/changelog` group (pinakes:61 US-2).

The coverage that moved out of `server/routes/changelog.test.ts`, plus the cases
that file could not reach from the outside — the date-boundary rule and the
malformed-file 500 in particular.

Entries are seeded through :func:`pinakes.contributions.changelog.record_change`
rather than by writing JSON by hand: that function is the *other* half of this
module and the one the review pipeline calls, so seeding through it is also an
assertion that what the pipeline writes is what this endpoint reads.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from pinakes.contributions import changelog


def record(directory: Path, entry_id: str, now: str, **payload: Any) -> dict[str, Any]:
    """Seed one entry, exactly as an approved review would."""
    base: dict[str, Any] = {
        "domain": "civilization",
        "changeType": "added",
        "source": "contribution",
    }
    entry = changelog.record_change(
        {**base, **payload}, directory=directory, entry_id=entry_id, now=now
    )
    assert entry is not None
    return entry


def seed(directory: Path) -> None:
    """A small, deliberately out-of-order log covering every filter."""
    record(
        directory,
        "s1",
        "2026-07-01T00:00:00.000Z",
        domain="civilization",
        changeType="added",
        source="ai-review",
        entityName="Testtopia",
        contributionId="c-1",
    )
    record(
        directory,
        "s2",
        "2026-07-04T12:00:00.000Z",
        domain="language",
        changeType="modified",
        source="contribution",
        contributionId="c-2",
    )
    record(
        directory,
        "s3",
        "2026-07-04T23:59:59.000Z",
        domain="language",
        changeType="removed",
        source="field-research",
    )


# ── Listing ──────────────────────────────────────────────────────────────────


def test_an_empty_log_is_a_200_not_a_404(unbuilt_client: TestClient) -> None:
    body = unbuilt_client.get("/api/changelog").json()
    assert body["entries"] == []
    assert body["total"] == 0
    assert body["offset"] == 0
    assert body["limit"] == 50
    assert body["changeTypes"] == ["added", "modified", "removed"]


def test_entries_come_back_newest_first(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    seed(isolated_data_trees["changelog"])
    body = unbuilt_client.get("/api/changelog").json()
    assert [entry["id"] for entry in body["entries"]] == ["s3", "s2", "s1"]
    assert body["total"] == 3


def test_each_equality_filter_narrows_the_set(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    seed(isolated_data_trees["changelog"])
    for query, expected in (
        ("domain=civilization", ["s1"]),
        ("changeType=modified", ["s2"]),
        ("source=field-research", ["s3"]),
        ("contributionId=c-2", ["s2"]),
        ("domain=language&changeType=removed", ["s3"]),
    ):
        body = unbuilt_client.get(f"/api/changelog?{query}").json()
        assert [e["id"] for e in body["entries"]] == expected, query


def test_an_unknown_change_type_is_ignored_rather_than_rejected(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """The client's filter chips are free text on the wire; a stale one must not
    turn into a 400."""
    seed(isolated_data_trees["changelog"])
    response = unbuilt_client.get("/api/changelog?changeType=banana")
    assert response.status_code == 200
    assert response.json()["total"] == 3


# ── Dates ────────────────────────────────────────────────────────────────────


def test_a_date_only_upper_bound_covers_the_whole_day(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """`to=2026-07-04` means "through the 4th" — the entry a second before
    midnight is inside the range, not outside it."""
    seed(isolated_data_trees["changelog"])
    body = unbuilt_client.get("/api/changelog?from=2026-07-02&to=2026-07-04").json()
    assert [entry["id"] for entry in body["entries"]] == ["s3", "s2"]


def test_a_lower_bound_is_read_as_utc_midnight(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    seed(isolated_data_trees["changelog"])
    body = unbuilt_client.get("/api/changelog?from=2026-07-01T00:00:00.000Z").json()
    assert body["total"] == 3
    later = unbuilt_client.get("/api/changelog?from=2026-07-01T00:00:00.001Z").json()
    assert later["total"] == 2


def test_an_unparseable_bound_widens_rather_than_empties(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    seed(isolated_data_trees["changelog"])
    assert unbuilt_client.get("/api/changelog?from=whenever").json()["total"] == 3


# ── Pagination ───────────────────────────────────────────────────────────────


def test_limit_and_offset_page_the_filtered_set(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    seed(isolated_data_trees["changelog"])
    body = unbuilt_client.get("/api/changelog?limit=1&offset=1").json()
    assert [entry["id"] for entry in body["entries"]] == ["s2"]
    # `total` is the size of the match, not of the page — that is what lets the
    # client render "1 of 3" without a second request.
    assert body["total"] == 3
    assert body["limit"] == 1
    assert body["offset"] == 1


def test_a_junk_limit_falls_back_to_the_default_page(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """The contribution queue collapses `?limit=abc` to an empty page; this group
    does not. `parseFilters` dropped the NaN back to undefined, and the
    difference between the two route groups is real."""
    seed(isolated_data_trees["changelog"])
    body = unbuilt_client.get("/api/changelog?limit=abc").json()
    assert len(body["entries"]) == 3
    assert body["limit"] == 50


def test_a_negative_limit_returns_everything_from_the_offset(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    seed(isolated_data_trees["changelog"])
    body = unbuilt_client.get("/api/changelog?limit=-1&offset=1").json()
    assert [entry["id"] for entry in body["entries"]] == ["s2", "s1"]


def test_a_negative_offset_is_clamped_but_echoed_as_sent(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    seed(isolated_data_trees["changelog"])
    body = unbuilt_client.get("/api/changelog?offset=-5").json()
    assert len(body["entries"]) == 3
    assert body["offset"] == -5


# ── Stats ────────────────────────────────────────────────────────────────────


def test_stats_aggregate_the_whole_filtered_set(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    seed(isolated_data_trees["changelog"])
    body = unbuilt_client.get("/api/changelog/stats").json()
    assert body["total"] == 3
    assert body["byDomain"] == {"language": 2, "civilization": 1}
    assert body["bySource"] == {
        "field-research": 1,
        "contribution": 1,
        "ai-review": 1,
    }
    assert body["byChangeType"] == {"added": 1, "modified": 1, "removed": 1}
    assert body["firstAt"] == "2026-07-01T00:00:00.000Z"
    assert body["lastAt"] == "2026-07-04T23:59:59.000Z"


def test_stats_name_every_change_type_even_at_zero(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """The client renders a fixed row per kind, so an absent kind is a 0 rather
    than a missing key."""
    seed(isolated_data_trees["changelog"])
    body = unbuilt_client.get("/api/changelog/stats?domain=civilization").json()
    assert body["byChangeType"] == {"added": 1, "modified": 0, "removed": 0}


def test_stats_ignore_pagination(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    seed(isolated_data_trees["changelog"])
    assert unbuilt_client.get("/api/changelog/stats?limit=1").json()["total"] == 3


def test_stats_of_an_empty_log_carry_null_bounds(unbuilt_client: TestClient) -> None:
    body = unbuilt_client.get("/api/changelog/stats").json()
    assert body["total"] == 0
    assert body["firstAt"] is None
    assert body["lastAt"] is None


# ── The pipeline integration, and the failure mode ───────────────────────────


def test_a_pipeline_entry_is_legible_through_the_read_api(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """The half of `server/routes/changelog.test.ts` that mattered: an approved
    review writes an entry, and this endpoint shows it with every field intact."""
    record(
        isolated_data_trees["changelog"],
        "promoted",
        "2026-07-05T00:00:00.000Z",
        targetFile="civilizations.tsv",
        targetId="aitlantis",
        entityName="AItlantis",
        source="ai-review",
        contributionId="contrib-9",
        reviewer="curator",
        confidence=60,
        fields=["name", "description"],
        summary="Promoted AI draft (text-extractor) into civilizations.tsv",
    )
    entry = unbuilt_client.get("/api/changelog?source=ai-review").json()["entries"][0]
    assert entry["targetFile"] == "civilizations.tsv"
    assert entry["reviewer"] == "curator"
    assert entry["confidence"] == 60
    assert entry["fields"] == ["name", "description"]
    assert "sourceUrl" not in entry


def test_a_malformed_entry_is_a_500_naming_the_operation(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """An audit log that has lost a record says so. Silently skipping the file
    would report a smaller history than actually happened, which is the one
    thing an audit log must not do."""
    (isolated_data_trees["changelog"] / "broken.json").write_text(
        "{not json", encoding="utf-8"
    )
    response = unbuilt_client.get("/api/changelog")
    assert response.status_code == 500
    assert response.json()["message"] == "Failed to list changelog"
    assert response.json()["error"]

    stats = unbuilt_client.get("/api/changelog/stats")
    assert stats.status_code == 500
    assert stats.json()["message"] == "Failed to compute changelog stats"


def test_the_entries_are_read_off_disk_every_request(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """No cached listing: Express is still writing into this directory during
    the cutover, so a cached one would be a listing of what *this* process last
    wrote."""
    directory = isolated_data_trees["changelog"]
    assert unbuilt_client.get("/api/changelog").json()["total"] == 0
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "outside.json").write_text(
        json.dumps(
            {
                "id": "outside",
                "timestamp": "2026-07-09T00:00:00.000Z",
                "domain": "language",
                "changeType": "added",
                "source": "express",
            }
        ),
        encoding="utf-8",
    )
    assert unbuilt_client.get("/api/changelog").json()["total"] == 1
