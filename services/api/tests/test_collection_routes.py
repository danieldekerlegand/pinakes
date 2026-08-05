"""Behaviour of the ported `/api/collections` group (pinakes:61 US-1).

The coverage that moved with the code out of `server/routes/collections.test.ts`,
plus the on-disk assertions that file could not make from the outside. Every
test runs against the real store on a temp directory (`isolated_data_trees`) —
nothing is mocked, because the record shape *is* what is being ported: the
TypeScript reader still parses these files.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

ALICE = {"x-owner-id": "alice"}
BOB = {"x-owner-id": "bob"}


def create(
    client: TestClient, headers: dict[str, str] = ALICE, **body: Any
) -> dict[str, Any]:
    """Create one collection through the route and return the record."""
    payload: dict[str, Any] = {"title": "Bronze Age", **body}
    response = client.post("/api/collections", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()["collection"]
    return created


# ── Creating ─────────────────────────────────────────────────────────────────


def test_a_created_collection_is_private_and_owned(unbuilt_client: TestClient) -> None:
    collection = create(unbuilt_client)
    assert collection["id"].startswith("col_")
    assert collection["owner"] == "alice"
    assert collection["visibility"] == "private"
    assert collection["items"] == []
    assert collection["createdAt"] == collection["updatedAt"]


def test_a_share_token_is_minted_up_front(unbuilt_client: TestClient) -> None:
    """Sharing is not a second step: the capability exists from creation, which
    is what lets the client offer a share URL without a round trip."""
    first = create(unbuilt_client)["shareToken"]
    second = create(unbuilt_client)["shareToken"]
    assert len(first) == 16
    assert first != second


def test_the_record_is_written_to_the_collections_tree(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    collection = create(unbuilt_client)
    on_disk = isolated_data_trees["collections"] / f"{collection['id']}.json"
    assert json.loads(on_disk.read_text(encoding="utf-8")) == collection


def test_an_unset_description_is_absent_from_the_record(
    unbuilt_client: TestClient,
) -> None:
    """`JSON.stringify` writes no key for `undefined`; a present-but-null one
    would be a different record to the TypeScript reader."""
    assert "description" not in create(unbuilt_client)
    assert create(unbuilt_client, description="  ").get("description") is None


def test_items_are_stamped_with_a_stable_id_and_deduped(
    unbuilt_client: TestClient,
) -> None:
    collection = create(
        unbuilt_client,
        items=[
            {"type": "culture", "id": "sumer", "name": "Sumer", "region": " Iraq "},
            {"type": "culture", "id": "sumer", "name": "Sumer again"},
        ],
    )
    assert len(collection["items"]) == 1
    item = collection["items"][0]
    assert item["stableId"] == "cs:culture:sumer"
    assert item["ref"] == {
        "type": "culture",
        "id": "sumer",
        "name": "Sumer",
        "region": "Iraq",
    }


def test_a_missing_title_is_a_400_listing_every_error(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    response = unbuilt_client.post(
        "/api/collections",
        json={"description": "no title", "visibility": "secret", "items": "nope"},
        headers=ALICE,
    )
    assert response.status_code == 400
    body = response.json()
    assert body["error"] == "invalid collection"
    assert "title is required" in body["errors"]
    assert "visibility must be 'private' or 'public'" in body["errors"]
    assert "items must be an array" in body["errors"]
    # A rejected create is not a partial write.
    assert list(isolated_data_trees["collections"].glob("*.json")) == []


def test_an_item_ref_error_names_its_index(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.post(
        "/api/collections",
        json={"title": "set", "items": [{"type": "culture", "id": "s"}, {"id": ""}]},
        headers=ALICE,
    )
    assert response.status_code == 400
    assert (
        "items[1]: entity ref requires a non-empty 'type'" in response.json()["errors"]
    )


def test_an_explicitly_null_description_is_rejected(
    unbuilt_client: TestClient,
) -> None:
    """Absent and null are different to the check this ports: `!== undefined`."""
    response = unbuilt_client.post(
        "/api/collections", json={"title": "set", "description": None}, headers=ALICE
    )
    assert response.status_code == 400
    assert "description must be a string" in response.json()["errors"]


# ── Listing and reading ──────────────────────────────────────────────────────


def test_the_list_is_owner_scoped_and_newest_updated_first(
    unbuilt_client: TestClient,
) -> None:
    older = create(unbuilt_client, title="Older")
    newer = create(unbuilt_client, title="Newer")
    create(unbuilt_client, headers=BOB, title="Bob's")

    unbuilt_client.patch(
        f"/api/collections/{older['id']}", json={"title": "Touched"}, headers=ALICE
    )

    body = unbuilt_client.get("/api/collections", headers=ALICE).json()
    assert body["total"] == 2
    assert [entry["id"] for entry in body["collections"]] == [older["id"], newer["id"]]
    assert unbuilt_client.get("/api/collections", headers=BOB).json()["total"] == 1


def test_an_unknown_id_is_a_404(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.get("/api/collections/col_missing", headers=ALICE)
    assert response.status_code == 404
    assert response.json() == {
        "error": "Not found",
        "detail": "No collection col_missing",
    }


def test_a_private_collection_is_403_to_a_stranger_and_200_once_public(
    unbuilt_client: TestClient,
) -> None:
    collection = create(unbuilt_client)
    denied = unbuilt_client.get(f"/api/collections/{collection['id']}", headers=BOB)
    assert denied.status_code == 403
    assert denied.json()["detail"] == "This collection is private"

    unbuilt_client.patch(
        f"/api/collections/{collection['id']}",
        json={"visibility": "public"},
        headers=ALICE,
    )
    assert (
        unbuilt_client.get(
            f"/api/collections/{collection['id']}", headers=BOB
        ).status_code
        == 200
    )


# ── Sharing ──────────────────────────────────────────────────────────────────


def test_the_share_view_resolves_a_private_collection_without_its_owner(
    unbuilt_client: TestClient,
) -> None:
    """The token is the capability — visibility does not gate it, and the
    projection is what keeps the owner id from leaking to whoever holds the URL."""
    collection = create(
        unbuilt_client,
        description="  Mesopotamia  ",
        items=[{"type": "culture", "id": "sumer"}],
    )
    response = unbuilt_client.get(f"/api/collections/shared/{collection['shareToken']}")
    assert response.status_code == 200

    view = response.json()["collection"]
    assert "owner" not in view
    assert "shareToken" not in view
    assert view["itemCount"] == 1
    assert view["visibility"] == "private"
    assert view["description"] == "Mesopotamia"


def test_an_unknown_share_token_is_a_404(unbuilt_client: TestClient) -> None:
    response = unbuilt_client.get("/api/collections/shared/badtoken")
    assert response.status_code == 404
    assert response.json()["detail"] == "No shared collection for that token"


def test_shared_is_not_read_as_a_collection_id(unbuilt_client: TestClient) -> None:
    """Route order, asserted rather than assumed: `/shared/{token}` is declared
    before `/{id}`, so a share lookup never becomes a lookup of the id "shared"."""
    create(unbuilt_client)
    response = unbuilt_client.get("/api/collections/shared/badtoken", headers=ALICE)
    assert response.json()["detail"] == "No shared collection for that token"


# ── Updating ─────────────────────────────────────────────────────────────────


def test_a_patch_updates_metadata_and_stamps_updated_at(
    unbuilt_client: TestClient,
) -> None:
    collection = create(unbuilt_client, description="First")
    response = unbuilt_client.patch(
        f"/api/collections/{collection['id']}",
        json={"title": "  Bronze Age Cultures  ", "visibility": "public"},
        headers=ALICE,
    )
    assert response.status_code == 200
    updated = response.json()["collection"]
    assert updated["title"] == "Bronze Age Cultures"
    assert updated["visibility"] == "public"
    assert updated["description"] == "First"
    assert updated["createdAt"] == collection["createdAt"]


def test_a_blank_description_deletes_the_key(unbuilt_client: TestClient) -> None:
    collection = create(unbuilt_client, description="First")
    updated = unbuilt_client.patch(
        f"/api/collections/{collection['id']}",
        json={"description": "   "},
        headers=ALICE,
    ).json()["collection"]
    assert "description" not in updated


def test_a_blank_title_is_a_400(unbuilt_client: TestClient) -> None:
    collection = create(unbuilt_client)
    response = unbuilt_client.patch(
        f"/api/collections/{collection['id']}", json={"title": "   "}, headers=ALICE
    )
    assert response.status_code == 400
    assert response.json()["errors"] == ["title cannot be empty"]


def test_an_unknown_patch_key_is_ignored_not_rejected(
    unbuilt_client: TestClient,
) -> None:
    """A wrong-typed or unrecognised field is dropped by `normalizePatch`; the
    client posts `{...patch, owner}` and the owner must not become a 400."""
    collection = create(unbuilt_client)
    response = unbuilt_client.patch(
        f"/api/collections/{collection['id']}",
        json={"owner": "alice", "title": 42, "nonsense": True},
        headers=ALICE,
    )
    assert response.status_code == 200
    assert response.json()["collection"]["title"] == "Bronze Age"


def test_a_stranger_cannot_patch_or_delete(unbuilt_client: TestClient) -> None:
    collection = create(unbuilt_client)
    patched = unbuilt_client.patch(
        f"/api/collections/{collection['id']}", json={"title": "hijack"}, headers=BOB
    )
    assert patched.status_code == 403
    assert patched.json()["detail"] == "You do not have access to this collection"
    assert (
        unbuilt_client.delete(
            f"/api/collections/{collection['id']}", headers=BOB
        ).status_code
        == 403
    )


def test_public_grants_a_read_never_a_write(unbuilt_client: TestClient) -> None:
    """Visibility governs reads; ownership governs writes. The two are separate
    and a public collection is still only editable by its owner."""
    collection = create(unbuilt_client, visibility="public")
    assert (
        unbuilt_client.get(
            f"/api/collections/{collection['id']}", headers=BOB
        ).status_code
        == 200
    )
    assert (
        unbuilt_client.patch(
            f"/api/collections/{collection['id']}",
            json={"title": "hijack"},
            headers=BOB,
        ).status_code
        == 403
    )


# ── Items ────────────────────────────────────────────────────────────────────


def test_adding_an_item_stamps_it_and_removing_it_by_stable_id(
    unbuilt_client: TestClient,
) -> None:
    collection = create(unbuilt_client)
    added = unbuilt_client.post(
        f"/api/collections/{collection['id']}/items",
        json={"type": "battle", "id": "kadesh", "name": "Kadesh", "note": " a note "},
        headers=ALICE,
    )
    assert added.status_code == 200
    item = added.json()["collection"]["items"][0]
    assert item["stableId"] == "cs:battle:kadesh"
    assert item["note"] == "a note"

    removed = unbuilt_client.delete(
        f"/api/collections/{collection['id']}/items/cs:battle:kadesh", headers=ALICE
    )
    assert removed.status_code == 200
    assert removed.json()["collection"]["items"] == []


def test_re_adding_an_entity_refreshes_it_but_keeps_added_at(
    unbuilt_client: TestClient,
) -> None:
    """The collection remembers when the entity joined it, not when its
    denormalized display name was last refreshed."""
    collection = create(
        unbuilt_client, items=[{"type": "culture", "id": "sumer", "name": "Sumer"}]
    )
    first = collection["items"][0]

    updated = unbuilt_client.post(
        f"/api/collections/{collection['id']}/items",
        json={"type": "culture", "id": "sumer", "name": "Sumerians"},
        headers=ALICE,
    ).json()["collection"]

    assert len(updated["items"]) == 1
    assert updated["items"][0]["ref"]["name"] == "Sumerians"
    assert updated["items"][0]["addedAt"] == first["addedAt"]


def test_removing_an_absent_item_is_a_no_op_not_an_edit(
    unbuilt_client: TestClient,
) -> None:
    collection = create(unbuilt_client)
    response = unbuilt_client.delete(
        f"/api/collections/{collection['id']}/items/cs:battle:nowhere", headers=ALICE
    )
    assert response.status_code == 200
    assert response.json()["collection"]["updatedAt"] == collection["updatedAt"]


def test_an_invalid_item_ref_is_a_400(unbuilt_client: TestClient) -> None:
    collection = create(unbuilt_client)
    response = unbuilt_client.post(
        f"/api/collections/{collection['id']}/items",
        json={"type": "", "id": ""},
        headers=ALICE,
    )
    assert response.status_code == 400
    assert response.json()["error"] == "invalid entity ref"


def test_an_item_add_to_an_unknown_collection_is_a_404(
    unbuilt_client: TestClient,
) -> None:
    response = unbuilt_client.post(
        "/api/collections/col_missing/items",
        json={"type": "battle", "id": "kadesh"},
        headers=ALICE,
    )
    assert response.status_code == 404


# ── Deleting ─────────────────────────────────────────────────────────────────


def test_delete_removes_the_file_and_the_second_delete_is_a_404(
    unbuilt_client: TestClient, isolated_data_trees: dict[str, Path]
) -> None:
    collection = create(unbuilt_client)
    response = unbuilt_client.delete(
        f"/api/collections/{collection['id']}", headers=ALICE
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True, "id": collection["id"]}
    assert list(isolated_data_trees["collections"].glob("*.json")) == []
    assert (
        unbuilt_client.delete(
            f"/api/collections/{collection['id']}", headers=ALICE
        ).status_code
        == 404
    )


# ── Owner resolution ─────────────────────────────────────────────────────────


def test_the_owner_is_read_from_the_header_then_the_query_then_the_body(
    unbuilt_client: TestClient,
) -> None:
    """All three sources are the contract. The client sends the header on reads,
    the query parameter is what makes a URL shareable between tabs, and the body
    field is how its `DELETE` carries an owner at all."""
    collection = create(unbuilt_client)

    assert unbuilt_client.get("/api/collections?owner=alice").json()["total"] == 1
    assert unbuilt_client.get("/api/collections?owner=bob").json()["total"] == 0
    # Header wins over the query parameter.
    assert (
        unbuilt_client.get("/api/collections?owner=bob", headers=ALICE).json()["total"]
        == 1
    )

    deleted = unbuilt_client.request(
        "DELETE", f"/api/collections/{collection['id']}", json={"owner": "alice"}
    )
    assert deleted.status_code == 200


def test_an_unattributed_request_is_anonymous(unbuilt_client: TestClient) -> None:
    """Not a sentinel for unowned: two anonymous browsers really do share these
    records, which is exactly why the client seeds a per-browser id."""
    response = unbuilt_client.post("/api/collections", json={"title": "Unowned"})
    assert response.json()["collection"]["owner"] == "anonymous"
    assert unbuilt_client.get("/api/collections").json()["total"] == 1
