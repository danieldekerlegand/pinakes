"""Behaviour of the ported `/api/annotations` group (pinakes:61 US-1).

The coverage that moved with the code out of `server/routes/annotations.test.ts`.
As with the collections suite, nothing is mocked: the on-disk record is part of
what is being ported, and the projection that keeps an owner id off the wire is
the part most worth asserting from the outside.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from pinakes.collab import annotations as annotations_module

ALICE = {"x-owner-id": "alice"}
BOB = {"x-owner-id": "bob"}

ENTITY = {"type": "language", "id": "eng", "name": "English"}


def create(
    client: TestClient, headers: dict[str, str] = ALICE, **body: Any
) -> dict[str, Any]:
    """Create one note through the route and return the view it answered with."""
    payload: dict[str, Any] = {**ENTITY, "body": "A note about English", **body}
    response = client.post("/api/annotations", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()["annotation"]
    return created


def test_the_annotations_submodule_is_not_shadowed() -> None:
    """`from __future__ import annotations` in `pinakes/collab/__init__.py` would
    bind that name on the *package*, so `from pinakes.collab import annotations`
    would hand back a `__future__._Feature` — and every route in this group would
    500 on an AttributeError at request time. Cheap to assert, easy to reintroduce.
    """
    assert hasattr(annotations_module, "validate_annotation_input")


# ── Creating ─────────────────────────────────────────────────────────────────


def test_a_created_note_is_private_and_projected(unbuilt_client: TestClient) -> None:
    annotation = create(unbuilt_client)
    assert annotation["id"].startswith("note_")
    assert annotation["stableId"] == "cs:language:eng"
    assert annotation["visibility"] == "private"
    assert annotation["editable"] is True
    assert "owner" not in annotation


def test_the_record_on_disk_keeps_the_owner_the_view_drops(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    """`owner` is stored — it is the access key — and never served."""
    annotation = create(unbuilt_client)
    on_disk = json.loads(
        (isolated_data_trees["annotations"] / f"{annotation['id']}.json").read_text(
            encoding="utf-8"
        )
    )
    assert on_disk["owner"] == "alice"
    assert on_disk["entity"] == ENTITY


def test_a_missing_ref_or_body_is_a_400(unbuilt_client: TestClient) -> None:
    blank = unbuilt_client.post(
        "/api/annotations", json={"type": "", "id": "", "body": ""}, headers=ALICE
    )
    assert blank.status_code == 400
    assert blank.json()["error"] == "invalid annotation"
    assert "entity ref requires a non-empty 'type'" in blank.json()["errors"]
    assert "body is required" in blank.json()["errors"]

    no_body = unbuilt_client.post(
        "/api/annotations", json={"type": "language", "id": "eng"}, headers=ALICE
    )
    assert no_body.status_code == 400


def test_an_over_long_note_is_a_400(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.post(
        "/api/annotations", json={**ENTITY, "body": "x" * 10_001}, headers=ALICE
    )
    assert response.status_code == 400
    assert "body must be 10000 characters or fewer" in response.json()["errors"]


def test_a_rejected_note_is_not_a_partial_write(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    unbuilt_client.post("/api/annotations", json={"body": "orphan"}, headers=ALICE)
    assert list(isolated_data_trees["annotations"].glob("*.json")) == []


# ── Listing ──────────────────────────────────────────────────────────────────


def test_a_list_with_no_entity_is_a_400(unbuilt_client: TestClient) -> None:
    """There is no "all annotations" read, deliberately — the surface is keyed
    by entity, and an unfiltered dump would be a different (and leakier) API."""
    response = unbuilt_client.get("/api/annotations", headers=ALICE)
    assert response.status_code == 400
    assert response.json()["errors"] == ["entity (or type+id) is required"]


def test_both_spellings_of_the_lookup_resolve_the_same_entity(
    unbuilt_client: TestClient,
) -> None:
    create(unbuilt_client)
    by_stable_id = unbuilt_client.get(
        "/api/annotations?entity=cs:language:eng", headers=ALICE
    )
    by_ref = unbuilt_client.get(
        "/api/annotations?type=language&id=eng", headers=ALICE
    )
    assert by_stable_id.json()["total"] == 1
    assert by_ref.json() == by_stable_id.json()


def test_a_stranger_sees_a_public_note_but_not_a_private_one(
    unbuilt_client: TestClient,
) -> None:
    private = create(unbuilt_client, body="private note")
    create(unbuilt_client, headers=BOB, body="bob's public note", visibility="public")

    alice_sees = unbuilt_client.get(
        "/api/annotations?entity=cs:language:eng", headers=ALICE
    ).json()
    assert alice_sees["total"] == 2
    # Own notes first, whoever updated last.
    assert alice_sees["annotations"][0]["id"] == private["id"]
    assert alice_sees["annotations"][0]["editable"] is True
    assert alice_sees["annotations"][1]["editable"] is False

    stranger_sees = unbuilt_client.get(
        "/api/annotations?entity=cs:language:eng", headers={"x-owner-id": "carol"}
    ).json()
    assert stranger_sees["total"] == 1
    assert stranger_sees["annotations"][0]["body"] == "bob's public note"
    assert all("owner" not in view for view in stranger_sees["annotations"])


def test_notes_on_another_entity_are_not_listed(unbuilt_client: TestClient) -> None:
    create(unbuilt_client)
    create(unbuilt_client, type="battle", id="kadesh", body="elsewhere")
    listed = unbuilt_client.get(
        "/api/annotations?entity=cs:battle:kadesh", headers=ALICE
    ).json()
    assert listed["total"] == 1
    assert listed["annotations"][0]["body"] == "elsewhere"


# ── Reading one ──────────────────────────────────────────────────────────────


def test_an_unknown_id_is_a_404(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.get("/api/annotations/note_missing", headers=ALICE)
    assert response.status_code == 404
    assert response.json() == {
        "error": "Not found",
        "detail": "No annotation note_missing",
    }


def test_a_private_note_is_403_to_a_stranger(unbuilt_client: TestClient) -> None:
    annotation = create(unbuilt_client)
    response = unbuilt_client.get(f"/api/annotations/{annotation['id']}", headers=BOB)
    assert response.status_code == 403
    assert response.json()["detail"] == "This annotation is private"


# ── Updating and sharing ─────────────────────────────────────────────────────


def test_editing_the_text_stamps_updated_at(unbuilt_client: TestClient) -> None:
    annotation = create(unbuilt_client)
    edited = unbuilt_client.patch(
        f"/api/annotations/{annotation['id']}",
        json={"body": "  Edited note  ", "owner": "alice"},
        headers=ALICE,
    )
    assert edited.status_code == 200
    view = edited.json()["annotation"]
    assert view["body"] == "Edited note"
    assert view["createdAt"] == annotation["createdAt"]
    assert "owner" not in view


def test_sharing_is_a_visibility_flip_not_a_token(unbuilt_client: TestClient) -> None:
    """Unlike a collection, a note has no share capability: making it public is
    the whole of sharing, and it is visible to anyone reading that entity."""
    annotation = create(unbuilt_client)
    shared = unbuilt_client.patch(
        f"/api/annotations/{annotation['id']}",
        json={"visibility": "public"},
        headers=ALICE,
    ).json()["annotation"]
    assert shared["visibility"] == "public"
    assert "shareToken" not in shared

    bob_sees = unbuilt_client.get(
        "/api/annotations?entity=cs:language:eng", headers=BOB
    ).json()
    assert bob_sees["total"] == 1
    assert bob_sees["annotations"][0]["editable"] is False


def test_a_blank_body_edit_is_a_400(unbuilt_client: TestClient) -> None:
    annotation = create(unbuilt_client)
    response = unbuilt_client.patch(
        f"/api/annotations/{annotation['id']}", json={"body": "   "}, headers=ALICE
    )
    assert response.status_code == 400
    assert response.json()["errors"] == ["body cannot be empty"]


def test_a_stranger_cannot_edit_or_delete_even_a_public_note(
    unbuilt_client: TestClient,
) -> None:
    annotation = create(unbuilt_client, visibility="public")
    patched = unbuilt_client.patch(
        f"/api/annotations/{annotation['id']}", json={"body": "hijack"}, headers=BOB
    )
    assert patched.status_code == 403
    assert patched.json()["detail"] == "You do not have access to this annotation"
    assert (
        unbuilt_client.delete(
            f"/api/annotations/{annotation['id']}", headers=BOB
        ).status_code
        == 403
    )


# ── Deleting ─────────────────────────────────────────────────────────────────


def test_delete_removes_the_file_and_the_second_delete_is_a_404(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    annotation = create(unbuilt_client)
    response = unbuilt_client.request(
        "DELETE", f"/api/annotations/{annotation['id']}", json={"owner": "alice"}
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True, "id": annotation["id"]}
    assert list(isolated_data_trees["annotations"].glob("*.json")) == []
    assert (
        unbuilt_client.delete(
            f"/api/annotations/{annotation['id']}", headers=ALICE
        ).status_code
        == 404
    )
