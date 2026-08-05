"""`/api/timeline/event*` — the authoring surface on the temporal axis.

The Express suite that used to hold these cases
(`server/routes/timeline-event.test.ts`) kept its POST tests, because that route
still answers there too; what moved is the whole *behaviour* of the port. The
first test below is the one that matters most: the recorded fixture grades the
**400 body**, so an error string is a contract, not a message.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from pinakes.authoring import timeline_event

VALID: dict[str, Any] = {
    "kind": "period",
    "cultureProfileId": "sumer",
    "title": "Uruk period",
    "lane": "urbanism",
    "timePeriodStart": -4000,
    "timePeriodEnd": -3100,
    "magnitude": "major",
}


def test_an_empty_submission_reports_every_error_in_order(
    unbuilt_client: TestClient,
) -> None:
    """The `post-timeline-event-invalid` contract, spelled out.

    Order is part of it: the client renders `errors` as a list, and the recorded
    sample's first two entries are the kind and the title.
    """
    response = unbuilt_client.post("/api/timeline/event", json={})

    assert response.status_code == 400
    body = response.json()
    assert body["message"] == "Invalid timeline entry"
    assert body["errors"] == [
        "kind must be one of: event, period",
        "title is required",
        "cultureProfileId is required — a timeline entry must be associated "
        "with an entity",
        "lane must be one of: political, territory, urbanism, technology, "
        "religion, language, economy",
        "timePeriodStart is required and must be a number (negative = BCE)",
    ]
    assert body["warnings"] == ["confidence not specified, defaulting to 60"]


def test_a_rejected_submission_never_reaches_the_queue(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """Why serving this route on both backends is safe — nothing is written."""
    unbuilt_client.post("/api/timeline/event", json={})
    assert list(isolated_data_trees["contributions"].iterdir()) == []


def test_a_valid_period_is_queued_with_user_authored_provenance(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    response = unbuilt_client.post("/api/timeline/event", json=VALID)

    assert response.status_code == 201
    contribution = response.json()["contribution"]
    assert contribution["entityType"] == "timeline-event"
    assert contribution["action"] == "add"
    assert contribution["status"] == "pending"
    assert contribution["entityId"] == "sumer"
    assert contribution["confidence"] == 60
    data = contribution["entityData"]
    assert data["source"] == timeline_event.TIMELINE_PROVENANCE
    assert data["timePeriodStart"] == -4000
    assert data["timePeriodEnd"] == -3100
    # The promotable row a reviewer would paste into `culture-events.tsv`, with
    # `year` as the *start* — that TSV has one year column.
    assert data["serialized"] == {
        "culture_profile_id": "sumer",
        "year": -4000,
        "lane": "urbanism",
        "event_type": "event",
        "title": "Uruk period",
        "description": "",
        "magnitude": "major",
        "sources": "[]",
    }
    assert len(list(isolated_data_trees["contributions"].iterdir())) == 1


def test_an_event_may_not_carry_a_divergent_end(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.post(
        "/api/timeline/event",
        json={**VALID, "kind": "event", "timePeriodEnd": -3100},
    )
    assert response.status_code == 400
    assert any("single point in time" in error for error in response.json()["errors"])


def test_an_event_whose_end_matches_its_start_is_accepted(
    unbuilt_client: TestClient,
) -> None:
    response = unbuilt_client.post(
        "/api/timeline/event",
        json={**VALID, "kind": "event", "timePeriodEnd": -4000},
    )
    assert response.status_code == 201
    # An `event` never carries a range forward, even one it was given.
    assert response.json()["contribution"]["entityData"]["timePeriodEnd"] is None


def test_a_period_requires_an_end(unbuilt_client: TestClient) -> None:
    payload = {key: value for key, value in VALID.items() if key != "timePeriodEnd"}
    response = unbuilt_client.post("/api/timeline/event", json=payload)
    assert response.status_code == 400
    assert "timePeriodEnd is required for a period entry" in response.json()["errors"]


def test_an_inverted_range_is_rejected(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.post(
        "/api/timeline/event", json={**VALID, "timePeriodEnd": -5000}
    )
    assert response.status_code == 400
    assert any("inverted range" in error for error in response.json()["errors"])


def test_a_year_outside_the_global_bounds_is_rejected(
    unbuilt_client: TestClient,
) -> None:
    response = unbuilt_client.post(
        "/api/timeline/event",
        json={**VALID, "timePeriodStart": -60000, "timePeriodEnd": -3100},
    )
    assert response.status_code == 400
    assert (
        "timePeriodStart -60000 is out of bounds (allowed -50000..2100)"
        in response.json()["errors"]
    )


def test_a_declared_null_confidence_is_an_error_not_a_default(
    unbuilt_client: TestClient,
) -> None:
    """`!== undefined` is true for null, and the two answers differ.

    An omitted confidence warns and defaults to 60; a declared `null` is a 400.
    `dict.get` cannot tell them apart, which is what `_js.MISSING` is for.
    """
    response = unbuilt_client.post(
        "/api/timeline/event", json={**VALID, "confidence": None}
    )
    assert response.status_code == 400
    assert "confidence must be a number between 1 and 100" in response.json()["errors"]


def test_a_boolean_is_not_a_year(unbuilt_client: TestClient) -> None:
    """`typeof true === "boolean"`, where Python's `isinstance(True, int)` is True."""
    response = unbuilt_client.post(
        "/api/timeline/event", json={**VALID, "timePeriodStart": True}
    )
    assert response.status_code == 400
    assert (
        "timePeriodStart is required and must be a number (negative = BCE)"
        in response.json()["errors"]
    )


def test_the_options_route_publishes_the_authoring_vocabulary(
    unbuilt_client: TestClient,
) -> None:
    body = unbuilt_client.get("/api/timeline/event/options").json()

    assert body == {
        "kinds": ["event", "period"],
        "lanes": [
            "political",
            "territory",
            "urbanism",
            "technology",
            "religion",
            "language",
            "economy",
        ],
        "magnitudes": ["major", "moderate", "minor"],
        "minYear": -50000,
        "maxYear": 2100,
    }


def test_narrower_bounds_intersect_the_global_ones_rather_than_widening_them() -> None:
    """A caller's window can only tighten the allowed years, never extend them."""
    verdict = timeline_event.validate_timeline_event(
        {**VALID, "timePeriodStart": -4000}, {"min": -3000, "max": 3000}
    )
    assert not verdict.valid
    assert (
        "timePeriodStart -4000 is out of bounds (allowed -3000..2100)"
        in verdict.errors
    )
