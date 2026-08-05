"""Behaviour of the ported `/api/contributions` group (pinakes:60 US-1).

The coverage that moved with the code out of `server/routes/contributions.test.ts`.
Every test here runs against the real queue implementation on a temp directory
(`isolated_data_trees`) — no store is mocked, because the on-disk shape *is* the
thing being ported: the TypeScript server still reads this directory.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from pinakes.contributions import store

VALID: dict[str, Any] = {
    "entityType": "civilization",
    "action": "add",
    "entityData": {"name": "Testtopia"},
    "sources": [{"title": "A source", "url": "https://example.org/s"}],
    "confidence": 70,
}


def submit(client: TestClient, **overrides: Any) -> dict[str, Any]:
    """Queue one contribution through the route and return the record."""
    response = client.post("/api/contributions", json={**VALID, **overrides})
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()["contribution"]
    return body


# ── Submitting ───────────────────────────────────────────────────────────────


def test_a_valid_submission_is_queued_pending(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    contribution = submit(unbuilt_client)
    assert contribution["status"] == "pending"
    assert contribution["id"].startswith("contrib-")

    on_disk = isolated_data_trees["contributions"] / f"{contribution['id']}.json"
    assert json.loads(on_disk.read_text(encoding="utf-8")) == contribution


def test_an_unset_optional_is_absent_from_the_record(
    unbuilt_client: TestClient,
) -> None:
    """`JSON.stringify` drops `undefined`; a key present-but-null would be a
    different record to the TypeScript reader."""
    contribution = submit(unbuilt_client)
    for absent in ("contributorName", "entityId", "notes", "aiGenerated"):
        assert absent not in contribution


def test_a_missing_required_field_is_a_400_listing_every_error(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    response = unbuilt_client.post(
        "/api/contributions",
        json={
            "entityType": "cuisine",
            "action": "add",
            "entityData": {},
            "sources": [],
        },
    )
    assert response.status_code == 400
    body = response.json()
    assert body["message"] == "Validation failed"
    assert "entityData.name is required for cuisine" in body["errors"]
    assert "entityData.region is required for cuisine" in body["errors"]
    assert "At least one source citation is required" in body["errors"]
    # Nothing was queued — a rejected submission is not a partial write.
    assert list(isolated_data_trees["contributions"].glob("*.json")) == []


def test_an_unspecified_confidence_warns_and_defaults(
    unbuilt_client: TestClient,
) -> None:
    payload = {key: value for key, value in VALID.items() if key != "confidence"}
    response = unbuilt_client.post("/api/contributions", json=payload)
    assert response.status_code == 201
    assert response.json()["contribution"]["confidence"] == 50
    assert "confidence not specified, defaulting to 50" in response.json()["warnings"]


def test_a_declared_null_confidence_is_an_error_not_a_default(
    unbuilt_client: TestClient,
) -> None:
    """Absent and `null` are different values to the check this mirrors."""
    response = unbuilt_client.post(
        "/api/contributions", json={**VALID, "confidence": None}
    )
    assert response.status_code == 400
    assert "confidence must be a number between 1 and 100" in response.json()["errors"]


def test_the_ai_extraction_flags_are_hoisted_out_of_entity_data(
    unbuilt_client: TestClient,
) -> None:
    contribution = submit(
        unbuilt_client,
        entityData={
            "name": "AItlantis",
            "aiGenerated": True,
            "source": "text-extractor",
            "perFieldConfidence": {"name": 0.9},
        },
    )
    assert contribution["aiGenerated"] is True
    assert contribution["aiSource"] == "text-extractor"
    assert contribution["perFieldConfidence"] == {"name": 0.9}


# ── Reading ──────────────────────────────────────────────────────────────────


def test_the_listing_filters_and_reports_the_unpaginated_total(
    unbuilt_client: TestClient,
) -> None:
    submit(unbuilt_client)
    submit(unbuilt_client, entityType="language", entityData={"name": "Testish"})

    everything = unbuilt_client.get("/api/contributions").json()
    assert everything["total"] == 2

    filtered = unbuilt_client.get("/api/contributions?entityType=language").json()
    assert filtered["total"] == 1
    assert filtered["contributions"][0]["entityType"] == "language"

    page = unbuilt_client.get("/api/contributions?limit=1").json()
    assert len(page["contributions"]) == 1
    assert page["total"] == 2, "total is the pre-pagination count"


def test_an_unknown_filter_value_matches_nothing_rather_than_400ing(
    unbuilt_client: TestClient,
) -> None:
    submit(unbuilt_client)
    body = unbuilt_client.get("/api/contributions?status=nonsense").json()
    assert body == {"contributions": [], "total": 0}


def test_a_junk_limit_is_not_a_422(unbuilt_client: TestClient) -> None:
    """Express reached `limit` through `parseInt`, so a stale bookmark returned
    an empty page. A declared `int` param would answer 422 — a harder failure
    than the baseline ever had."""
    submit(unbuilt_client)
    response = unbuilt_client.get("/api/contributions?limit=abc")
    assert response.status_code == 200
    assert response.json() == {"contributions": [], "total": 1}


def test_stats_aggregate_the_queue(unbuilt_client: TestClient) -> None:
    submit(unbuilt_client)
    submit(unbuilt_client, action="flag", entityId="civ-1", entityData={}, sources=[])

    stats = unbuilt_client.get("/api/contributions/stats").json()
    assert stats["total"] == 2
    assert stats["pending"] == 2
    assert stats["approved"] == 0
    assert stats["byEntityType"]["civilization"] == 2
    assert stats["byAction"] == {"add": 1, "flag": 1}


def test_one_contribution_by_id(unbuilt_client: TestClient) -> None:
    contribution = submit(unbuilt_client)
    found = unbuilt_client.get(f"/api/contributions/{contribution['id']}")
    assert found.status_code == 200
    assert found.json()["id"] == contribution["id"]


def test_an_unknown_id_is_a_404(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.get("/api/contributions/nope")
    assert response.status_code == 404
    assert response.json() == {"message": "Contribution 'nope' not found"}


def test_stats_is_not_read_as_a_contribution_id(unbuilt_client: TestClient) -> None:
    """`/{id}` is declared after the literal routes; the other order would make
    `/stats` a lookup for a contribution called "stats"."""
    assert unbuilt_client.get("/api/contributions/stats").status_code == 200
    assert unbuilt_client.get("/api/contributions/export").status_code == 200


def test_entity_contributions_are_the_approved_ones(unbuilt_client: TestClient) -> None:
    pending = submit(unbuilt_client, action="edit", entityId="minoan")
    approved = submit(unbuilt_client, action="edit", entityId="minoan")
    unbuilt_client.patch(
        f"/api/contributions/{approved['id']}/review", json={"decision": "approved"}
    )

    body = unbuilt_client.get("/api/contributions/entity/civilization/minoan").json()
    ids = [c["id"] for c in body["contributions"]]
    assert ids == [approved["id"]]
    assert pending["id"] not in ids


def test_the_csv_export_is_an_attachment_with_the_recorded_columns(
    unbuilt_client: TestClient,
) -> None:
    submit(unbuilt_client, notes="a, comma")
    response = unbuilt_client.get("/api/contributions/export")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment; filename=contributions.csv" in (
        response.headers["content-disposition"]
    )
    lines = response.text.splitlines()
    assert lines[0].split(",")[:4] == ["id", "entityType", "action", "status"]
    assert '"a, comma"' in lines[1], "a cell containing a comma is quoted"


# ── Reviewing ────────────────────────────────────────────────────────────────


def test_approving_records_the_decision_and_an_audit_line(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    contribution = submit(unbuilt_client)
    response = unbuilt_client.patch(
        f"/api/contributions/{contribution['id']}/review",
        json={"decision": "approved", "note": "looks good"},
    )
    assert response.status_code == 200
    reviewed = response.json()
    assert reviewed["status"] == "approved"
    assert reviewed["reviewNote"] == "looks good"
    assert reviewed["reviewedAt"]

    entries = [
        json.loads(file.read_text(encoding="utf-8"))
        for file in isolated_data_trees["changelog"].glob("*.json")
    ]
    logged = next(e for e in entries if e["contributionId"] == contribution["id"])
    assert logged["changeType"] == "added"
    assert logged["domain"] == "civilization"
    assert logged["entityName"] == "Testtopia"
    assert logged["sourceUrl"] == "https://example.org/s"
    assert logged["confidence"] == 70
    assert logged["summary"] == "looks good"


def test_an_edit_is_logged_as_modified(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    contribution = submit(
        unbuilt_client, action="edit", entityId="minoan", fieldName="capital",
        suggestedValue="Knossos",
    )
    unbuilt_client.patch(
        f"/api/contributions/{contribution['id']}/review", json={"decision": "approved"}
    )
    entries = [
        json.loads(file.read_text(encoding="utf-8"))
        for file in isolated_data_trees["changelog"].glob("*.json")
    ]
    logged = next(e for e in entries if e["contributionId"] == contribution["id"])
    assert logged["changeType"] == "modified"
    assert logged["targetId"] == "minoan"
    assert logged["fields"] == ["capital"]


@pytest.mark.parametrize("decision", ["rejected", "approved"])
def test_a_flag_is_never_logged_as_a_data_change(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path], decision: str
) -> None:
    """A flag reports on a record; it does not edit one."""
    contribution = submit(
        unbuilt_client, action="flag", entityId="civ-1", entityData={}, sources=[]
    )
    unbuilt_client.patch(
        f"/api/contributions/{contribution['id']}/review", json={"decision": decision}
    )
    assert list(isolated_data_trees["changelog"].glob("*.json")) == []


def test_rejecting_is_not_logged(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    contribution = submit(unbuilt_client)
    response = unbuilt_client.patch(
        f"/api/contributions/{contribution['id']}/review", json={"decision": "rejected"}
    )
    assert response.json()["status"] == "rejected"
    assert list(isolated_data_trees["changelog"].glob("*.json")) == []


def test_a_bad_decision_is_a_400(unbuilt_client: TestClient) -> None:
    contribution = submit(unbuilt_client)
    response = unbuilt_client.patch(
        f"/api/contributions/{contribution['id']}/review", json={"decision": "maybe"}
    )
    assert response.status_code == 400
    assert response.json() == {"message": "decision must be 'approved' or 'rejected'"}


def test_reviewing_an_unknown_contribution_is_a_404(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.patch(
        "/api/contributions/nope/review", json={"decision": "approved"}
    )
    assert response.status_code == 404


def test_an_absent_note_leaves_no_review_note_key(unbuilt_client: TestClient) -> None:
    contribution = submit(unbuilt_client)
    reviewed = unbuilt_client.patch(
        f"/api/contributions/{contribution['id']}/review", json={"decision": "approved"}
    ).json()
    assert "reviewNote" not in reviewed


# ── The JavaScript semantics the shape depends on ────────────────────────────


def test_an_empty_array_is_a_present_required_field() -> None:
    """`![]` is false in JavaScript and true in Python. Getting this wrong would
    have the two servers disagree about whether a submission is valid."""
    verdict = store.validate_contribution(
        {
            "entityType": "boundary",
            "action": "add",
            "entityData": {"name": "A shape", "geometry": []},
            "sources": [{"title": "s"}],
            "confidence": 50,
        }
    )
    assert verdict.valid, verdict.errors


def test_parse_int_js_distinguishes_absent_from_unparseable() -> None:
    assert store.parse_int_js(None) is None
    assert store.parse_int_js("") is None
    assert store.parse_int_js("12") == 12
    assert store.parse_int_js("12abc") == 12
    unparseable = store.parse_int_js("abc")
    assert unparseable is not None and unparseable != unparseable  # NaN


def test_js_slice_collapses_to_empty_on_nan() -> None:
    import math

    assert store.js_slice([1, 2, 3], 0, math.nan) == []
    assert store.js_slice([1, 2, 3], 1, 10) == [2, 3]
    assert store.js_slice([1, 2, 3], -2, 3) == [2, 3]
