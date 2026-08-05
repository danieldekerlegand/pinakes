"""Behaviour of the ported `/api/ai-review` group (pinakes:60 US-1).

The coverage that moved with the code out of `server/routes/ai-review.test.ts`.
The promotion is exercised for real — a row genuinely lands in a TSV — against
the temp corpus `isolated_data_trees` redirects to. Never the live one: a fixture
row in `data/source/lexicons/` is visible to every other reader of it, and the
resulting failure lands somewhere unrelated (`server/CLAUDE.md`).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from pinakes.contributions import ai_review

DRAFT: dict[str, Any] = {
    "entityType": "civilization",
    "action": "add",
    "entityData": {
        "name": "AItlantis",
        "description": "an AI-drafted civ",
        "timePeriodStart": -3000,
        "aiGenerated": True,
        "source": "text-extractor",
        "perFieldConfidence": {"name": 0.9, "description": 0.3},
    },
    "sources": [{"title": "extracted"}],
    "confidence": 60,
}


def queue_draft(client: TestClient, **overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {**DRAFT, **overrides}
    response = client.post("/api/contributions", json=payload)
    assert response.status_code == 201, response.text
    contribution: dict[str, Any] = response.json()["contribution"]
    return contribution


def queue_plain(client: TestClient) -> dict[str, Any]:
    """A hand-written contribution — not an AI draft."""
    response = client.post(
        "/api/contributions",
        json={
            "entityType": "civilization",
            "action": "add",
            "entityData": {"name": "Handmade"},
            "sources": [{"title": "a book"}],
            "confidence": 80,
        },
    )
    assert response.status_code == 201
    body: dict[str, Any] = response.json()["contribution"]
    return body


# ── Listing and projecting ───────────────────────────────────────────────────


def test_only_ai_drafts_are_listed(unbuilt_client: TestClient) -> None:
    draft = queue_draft(unbuilt_client)
    queue_plain(unbuilt_client)

    body = unbuilt_client.get("/api/ai-review").json()
    assert body["total"] == 1
    assert [d["id"] for d in body["drafts"]] == [draft["id"]]


def test_a_draft_is_projected_field_by_field_with_confidence(
    unbuilt_client: TestClient,
) -> None:
    draft = queue_draft(unbuilt_client)
    view = unbuilt_client.get(f"/api/ai-review/{draft['id']}").json()

    assert view["aiSource"] == "text-extractor"
    assert view["overallConfidence"] == 60
    assert view["promotable"] is True

    fields = {field["field"]: field for field in view["fields"]}
    assert set(fields) == {"name", "description", "timePeriodStart"}, (
        "metadata keys are not reviewable content"
    )
    assert fields["name"]["confidence"] == 0.9
    assert fields["name"]["lowConfidence"] is False
    assert fields["description"]["lowConfidence"] is True
    assert fields["timePeriodStart"]["confidence"] is None


def test_an_unreviewed_draft_carries_no_reviewer_keys(
    unbuilt_client: TestClient,
) -> None:
    draft = queue_draft(unbuilt_client)
    view = unbuilt_client.get(f"/api/ai-review/{draft['id']}").json()
    for absent in ("reviewer", "reviewedAt", "promotion"):
        assert absent not in view


def test_a_non_ai_contribution_is_a_404(unbuilt_client: TestClient) -> None:
    plain = queue_plain(unbuilt_client)
    response = unbuilt_client.get(f"/api/ai-review/{plain['id']}")
    assert response.status_code == 404
    assert response.json() == {"message": f"AI draft '{plain['id']}' not found"}


def test_an_unknown_draft_is_a_404(unbuilt_client: TestClient) -> None:
    assert unbuilt_client.get("/api/ai-review/nope").status_code == 404


# ── Reviewing ────────────────────────────────────────────────────────────────


def test_approving_promotes_the_accepted_draft_into_the_lexicon(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    draft = queue_draft(unbuilt_client)
    response = unbuilt_client.patch(
        f"/api/ai-review/{draft['id']}",
        json={"decision": "approved", "reviewer": "curator"},
    )
    assert response.status_code == 200, response.text
    view = response.json()
    assert view["status"] == "approved"
    assert view["reviewer"] == "curator"
    assert view["promotion"]["file"] == "civilizations.tsv"
    assert view["promotion"]["targetId"] == "aitlantis"

    lexicon = isolated_data_trees["lexicons"] / "civilizations.tsv"
    header, row = lexicon.read_text(encoding="utf-8").splitlines()
    cells = dict(zip(header.split("\t"), row.split("\t"), strict=True))
    assert cells["id"] == "aitlantis"
    assert cells["name"] == "AItlantis"
    assert cells["time_period_start"] == "-3000", "an integer year keeps no decimal"
    assert cells["sources"] == json.dumps(
        ["AI-extracted via text-extractor; reviewed by curator"], separators=(",", ":")
    )


def test_the_promotion_is_recorded_in_the_provenance_ledger(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """Provenance is uniform across targets whose own columns are not."""
    draft = queue_draft(unbuilt_client)
    unbuilt_client.patch(
        f"/api/ai-review/{draft['id']}",
        json={"decision": "approved", "reviewer": "curator"},
    )
    ledger = isolated_data_trees["lexicons"] / ai_review.PROVENANCE_LEDGER
    header, row = ledger.read_text(encoding="utf-8").splitlines()
    cells = dict(zip(header.split("\t"), row.split("\t"), strict=True))
    assert cells["contribution_id"] == draft["id"]
    assert cells["ai_source"] == "text-extractor"
    assert cells["reviewer"] == "curator"
    assert cells["target_id"] == "aitlantis"


def test_a_repeated_name_gets_a_suffixed_id(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    for _ in range(2):
        draft = queue_draft(unbuilt_client)
        unbuilt_client.patch(
            f"/api/ai-review/{draft['id']}",
            json={"decision": "approved", "reviewer": "curator"},
        )
    rows = (
        (isolated_data_trees["lexicons"] / "civilizations.tsv")
        .read_text(encoding="utf-8")
        .splitlines()[1:]
    )
    assert [row.split("\t")[0] for row in rows] == ["aitlantis", "aitlantis-2"]


def test_a_field_edit_is_what_lands_in_the_corpus(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    draft = queue_draft(unbuilt_client)
    view = unbuilt_client.patch(
        f"/api/ai-review/{draft['id']}",
        json={
            "decision": "approved",
            "reviewer": "curator",
            "fields": {
                "name": {"decision": "edit", "value": "Atlantis"},
                "description": {"decision": "reject"},
            },
        },
    ).json()
    assert view["promotion"]["targetId"] == "atlantis"

    row = (
        (isolated_data_trees["lexicons"] / "civilizations.tsv")
        .read_text(encoding="utf-8")
        .splitlines()[1]
    )
    assert "Atlantis" in row
    assert "an AI-drafted civ" not in row, "a rejected field is not promoted"


def test_rejecting_a_required_field_is_a_400_that_wrote_nothing(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    draft = queue_draft(unbuilt_client)
    response = unbuilt_client.patch(
        f"/api/ai-review/{draft['id']}",
        json={
            "decision": "approved",
            "reviewer": "curator",
            "fields": {"name": {"decision": "reject"}},
        },
    )
    assert response.status_code == 400
    assert response.json()["message"] == "Cannot approve draft"
    assert response.json()["errors"] == [
        "Required field 'name' was rejected or is empty"
    ]
    assert list(isolated_data_trees["lexicons"].glob("*.tsv")) == []


def test_a_decision_naming_an_unknown_field_is_a_400(
    unbuilt_client: TestClient,
) -> None:
    draft = queue_draft(unbuilt_client)
    response = unbuilt_client.patch(
        f"/api/ai-review/{draft['id']}",
        json={
            "decision": "approved",
            "reviewer": "curator",
            "fields": {"nope": {"decision": "accept"}},
        },
    )
    assert response.status_code == 400
    assert "Unknown field 'nope'" in response.json()["message"]


def test_a_non_promotable_type_cannot_be_approved(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """`historical-figure` is reviewable but has no TSV of its own — approving it
    is a 400, not a silent write into the wrong file."""
    draft = queue_draft(
        unbuilt_client,
        entityType="historical-figure",
        entityData={"name": "Someone", "aiGenerated": True, "source": "text-extractor"},
    )
    response = unbuilt_client.patch(
        f"/api/ai-review/{draft['id']}",
        json={"decision": "approved", "reviewer": "curator"},
    )
    assert response.status_code == 400
    assert "No TSV promotion target" in response.json()["message"]
    assert list(isolated_data_trees["lexicons"].glob("*.tsv")) == []


def test_rejecting_a_draft_promotes_nothing(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    draft = queue_draft(unbuilt_client)
    view = unbuilt_client.patch(
        f"/api/ai-review/{draft['id']}",
        json={"decision": "rejected", "reviewer": "curator", "note": "hallucinated"},
    ).json()
    assert view["status"] == "rejected"
    assert "promotion" not in view
    assert list(isolated_data_trees["lexicons"].glob("*.tsv")) == []


def test_a_missing_reviewer_is_a_400(unbuilt_client: TestClient) -> None:
    draft = queue_draft(unbuilt_client)
    response = unbuilt_client.patch(
        f"/api/ai-review/{draft['id']}", json={"decision": "approved"}
    )
    assert response.status_code == 400
    assert response.json()["message"] == "reviewer is required"


def test_a_bad_decision_is_a_400(unbuilt_client: TestClient) -> None:
    draft = queue_draft(unbuilt_client)
    response = unbuilt_client.patch(
        f"/api/ai-review/{draft['id']}", json={"decision": "maybe", "reviewer": "c"}
    )
    assert response.status_code == 400
    assert response.json()["message"] == "decision must be 'approved' or 'rejected'"


def test_a_promotion_is_logged_into_the_changelog(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    draft = queue_draft(unbuilt_client)
    unbuilt_client.patch(
        f"/api/ai-review/{draft['id']}",
        json={"decision": "approved", "reviewer": "curator"},
    )
    entries = [
        json.loads(file.read_text(encoding="utf-8"))
        for file in isolated_data_trees["changelog"].glob("*.json")
    ]
    logged = next(e for e in entries if e["contributionId"] == draft["id"])
    assert logged["source"] == "ai-review"
    assert logged["changeType"] == "added"
    assert logged["targetFile"] == "civilizations.tsv"
    assert logged["entityName"] == "AItlantis"
    assert logged["reviewer"] == "curator"


# ── The promotion primitives ─────────────────────────────────────────────────


def test_slugify_matches_the_corpus_id_form() -> None:
    assert ai_review.slugify("Minoan Crete") == "minoan-crete"
    assert ai_review.slugify("Çatalhöyük") == "catalhoyuk"
    assert ai_review.slugify("!!!") == "entity"


def test_a_coordinate_cell_is_the_corpus_json_shape(tmp_path: Path) -> None:
    promotion = ai_review.promote_contribution(
        contribution_id="c1",
        entity_type="archaeological-site",
        accepted_data={"name": "Dig", "coordinates": {"lat": 35.5, "lng": 24.1}},
        reviewer="curator",
        ai_source="url-extractor",
        overall_confidence=42,
        lexicons_dir=tmp_path,
        now="2026-08-05T00:00:00.000Z",
    )
    assert promotion["targetId"] == "dig"
    header, row = (
        (tmp_path / "archaeological-sites.tsv")
        .read_text(encoding="utf-8")
        .splitlines()
    )
    cells = dict(zip(header.split("\t"), row.split("\t"), strict=True))
    assert cells["coordinates"] == '{"lat":35.5,"lng":24.1}'
    assert cells["confidence"] == "42"


def test_a_tab_in_a_cell_cannot_split_the_row(tmp_path: Path) -> None:
    """A TSV has no quoting, so a stray tab would silently become a new column."""
    ai_review.append_row(
        tmp_path / "t.tsv", ("id", "name"), {"id": "x", "name": "a\tb\nc"}
    )
    row = (tmp_path / "t.tsv").read_text(encoding="utf-8").splitlines()[1]
    assert row == "x\ta b c"
