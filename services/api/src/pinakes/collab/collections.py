"""Collaborative collections — a user-curated, shareable group of entities.

The port of `server/services/collections.ts`. One JSON file per collection under
``data/runtime/collections``; items are keyed by the stable
``cs:<type>:<id>`` id so re-adding an entity refreshes it rather than
duplicating it.

Two rules are load-bearing and neither is obvious from the route surface:

* **Visibility governs reads, ownership governs writes.** A public collection is
  readable by anyone; only the owner may ever mutate one. The share token is a
  third, orthogonal thing — a capability that grants a read of the owner-free
  projection *regardless* of visibility, which is what makes "share a private
  collection by URL" work.
* **An unset optional is absent, not null.** `description` is deleted when a
  patch clears it, and never written as `null`, because the TypeScript reader
  distinguishes the two and `JSON.stringify` writes no key for `undefined`.

Pure functions take `id` / `shareToken` / `now` as arguments, exactly as the
TypeScript did, so every mutation rule is testable with no filesystem and no
clock; :class:`CollectionStore` is the thin wrapper that supplies them.
"""

from __future__ import annotations

import secrets
import uuid
from pathlib import Path
from typing import Any

from pinakes.collab.entities import (
    VISIBILITIES,
    Record,
    RecordStore,
    clean_ref,
    epoch_ms,
    normalize_visibility,
    stable_entity_id,
    validate_entity_ref,
)
from pinakes.contributions.store import ValidationResult, iso_now
from pinakes.paths import collections_dir

#: Longest accepted title. Bounds one JSON record; not a display constraint.
MAX_TITLE_LENGTH = 200

#: Bytes behind a share token. 12 → 16 base64url characters, which is what
#: `crypto.randomBytes(12).toString("base64url")` produces — the token is the
#: only thing protecting a shared private collection, so keep the width.
SHARE_TOKEN_BYTES = 12


class CollectionAccessError(Exception):
    """A non-owner tried to mutate a collection. The route maps this to 403."""

    def __init__(
        self, message: str = "You do not have access to this collection"
    ) -> None:
        super().__init__(message)
        self.message = message


# ── Validation (pure) ────────────────────────────────────────────────────────


def validate_collection_input(data: dict[str, Any]) -> ValidationResult:
    """The port of `validateCollectionInput`. Pure — no filesystem, no clock.

    Every optional is checked with ``"key" in data`` rather than a ``.get()``
    that cannot tell absent from ``null``: the TypeScript compares against
    ``undefined``, so an explicitly null `description` is a 400 while an omitted
    one is fine.
    """
    errors: list[str] = []

    title = data.get("title")
    if not isinstance(title, str) or title.strip() == "":
        errors.append("title is required")
    elif len(title) > MAX_TITLE_LENGTH:
        errors.append(f"title must be {MAX_TITLE_LENGTH} characters or fewer")

    if "description" in data and not isinstance(data["description"], str):
        errors.append("description must be a string")

    if "visibility" in data and data["visibility"] not in VISIBILITIES:
        errors.append("visibility must be 'private' or 'public'")

    if "items" in data:
        items = data["items"]
        if not isinstance(items, list):
            errors.append("items must be an array")
        else:
            for index, item in enumerate(items):
                for error in validate_entity_ref(item):
                    errors.append(f"items[{index}]: {error}")

    return ValidationResult(valid=not errors, errors=errors, warnings=[])


# ── Mutation (pure) ──────────────────────────────────────────────────────────


def make_item(ref: dict[str, Any], note: Any, now: str) -> Record:
    """One curated item from an already-validated ref."""
    cleaned = clean_ref(ref)
    item: Record = {
        "stableId": stable_entity_id(cleaned),
        "ref": cleaned,
        "addedAt": now,
    }
    if isinstance(note, str) and note.strip() != "":
        item["note"] = note.strip()
    return item


def create_collection(data: dict[str, Any], ctx: dict[str, str]) -> Record:
    """Build a collection from validated input. Ids/token/clock come in *ctx*."""
    items: list[Record] = []
    for ref in data.get("items") or []:
        item = make_item(ref, None, ctx["now"])
        if not any(existing["stableId"] == item["stableId"] for existing in items):
            items.append(item)

    collection: Record = {
        "id": ctx["id"],
        "title": str(data["title"]).strip(),
        "owner": ctx["owner"],
        "visibility": normalize_visibility(data.get("visibility")),
        "shareToken": ctx["shareToken"],
        "items": items,
        "createdAt": ctx["now"],
        "updatedAt": ctx["now"],
    }
    description = data.get("description")
    if isinstance(description, str) and description.strip() != "":
        collection["description"] = description.strip()
    return collection


def apply_collection_update(
    collection: Record, patch: dict[str, Any], now: str
) -> Record:
    """Apply a metadata patch, returning a new record (the input is not mutated).

    A patch key is only present when the route accepted its type, so the reads
    below need no re-validation — and a *blank* description is a deletion, which
    is why this is a `pop` and not an assignment of ``""``.
    """
    updated: Record = {
        **collection,
        "items": list(collection["items"]),
        "updatedAt": now,
    }
    if "title" in patch:
        updated["title"] = str(patch["title"]).strip()
    if "description" in patch:
        description = str(patch["description"]).strip()
        if description:
            updated["description"] = description
        else:
            updated.pop("description", None)
    if "visibility" in patch:
        updated["visibility"] = normalize_visibility(patch["visibility"])
    return updated


def add_collection_item(
    collection: Record, ref: dict[str, Any], note: Any, now: str
) -> Record:
    """Add or refresh an entity, deduped by stable id.

    Re-adding an entity updates its ref and note but **keeps the original
    `addedAt`** — the collection remembers when the entity first joined it, not
    when its display name was last refreshed.
    """
    item = make_item(ref, note, now)
    items = list(collection["items"])
    for index, existing in enumerate(items):
        if existing["stableId"] == item["stableId"]:
            items[index] = {**item, "addedAt": existing["addedAt"]}
            break
    else:
        items.append(item)
    return {**collection, "items": items, "updatedAt": now}


def remove_collection_item(collection: Record, stable_id: str, now: str) -> Record:
    """Remove an entity by stable id. Absent id ⇒ the record is returned as-is,
    `updatedAt` untouched — a no-op must not look like an edit."""
    items = [item for item in collection["items"] if item["stableId"] != stable_id]
    if len(items) == len(collection["items"]):
        return collection
    return {**collection, "items": items, "updatedAt": now}


def can_view(collection: Record, owner: str) -> bool:
    """Owner match, or the collection is public."""
    return collection.get("owner") == owner or collection.get("visibility") == "public"


def can_edit(collection: Record, owner: str) -> bool:
    """Owner match only. Public is a read grant, never a write one."""
    return collection.get("owner") == owner


def to_share_view(collection: Record) -> Record:
    """The owner-free public projection served for a share token.

    Dropping `owner` is the point — the token grants a read to someone who is
    not the owner, and the opaque id is the only thing resembling an identity in
    this surface. `shareToken` is dropped too: a viewer holds it already, and a
    re-share should be the owner's decision.
    """
    view: Record = {
        "id": collection["id"],
        "title": collection["title"],
        "visibility": collection["visibility"],
        "items": collection["items"],
        "itemCount": len(collection["items"]),
        "createdAt": collection["createdAt"],
        "updatedAt": collection["updatedAt"],
    }
    if collection.get("description"):
        view["description"] = collection["description"]
    return view


# ── The store ────────────────────────────────────────────────────────────────


class CollectionStore(RecordStore):
    """JSON-per-record collections rooted at one directory."""

    def create(self, data: dict[str, Any], owner: str) -> Record:
        """Create and persist a collection owned by *owner*."""
        collection = create_collection(
            data,
            {
                "id": f"col_{uuid.uuid4()}",
                "owner": owner,
                "shareToken": secrets.token_urlsafe(SHARE_TOKEN_BYTES),
                "now": iso_now(),
            },
        )
        self.write(collection)
        return collection

    def list_for_owner(self, owner: str) -> list[Record]:
        """Everything *owner* owns, newest-updated first.

        Named `list_for_owner` rather than `list`: a method called `list` shadows
        the builtin for every annotation after it in the class body, which strict
        mypy rejects outright (`server/CLAUDE.md`'s twin of the
        `ContributionStore.list` trap).
        """
        owned = [
            record for record in self.read_all() if record.get("owner") == owner
        ]
        owned.sort(key=lambda record: -epoch_ms(record.get("updatedAt")))
        return owned

    def get(self, collection_id: str) -> Record | None:
        """Raw lookup by id — **no access check**. Every caller applies its own."""
        return self.read(collection_id)

    def get_by_share_token(self, token: str) -> Record | None:
        """Lookup by share token. An empty token matches nothing, deliberately:
        a record whose `shareToken` failed to write must not become world-readable
        to a caller asking for ``/shared/``."""
        if not token:
            return None
        for record in self.read_all():
            if record.get("shareToken") == token:
                return record
        return None

    def update(
        self, collection_id: str, patch: dict[str, Any], owner: str
    ) -> Record | None:
        """Patch metadata. ``None`` when unknown; raises when *owner* may not edit."""
        collection = self.get(collection_id)
        if collection is None:
            return None
        if not can_edit(collection, owner):
            raise CollectionAccessError
        updated = apply_collection_update(collection, patch, iso_now())
        self.write(updated)
        return updated

    def remove(self, collection_id: str, owner: str) -> bool:
        """Delete a collection. ``False`` when unknown; raises on a non-owner."""
        collection = self.get(collection_id)
        if collection is None:
            return False
        if not can_edit(collection, owner):
            raise CollectionAccessError
        self.delete(collection_id)
        return True

    def add_item(
        self, collection_id: str, ref: dict[str, Any], note: Any, owner: str
    ) -> Record | None:
        """Add an entity. ``None`` when unknown; raises on a non-owner."""
        collection = self.get(collection_id)
        if collection is None:
            return None
        if not can_edit(collection, owner):
            raise CollectionAccessError
        updated = add_collection_item(collection, ref, note, iso_now())
        self.write(updated)
        return updated

    def remove_item(
        self, collection_id: str, stable_id: str, owner: str
    ) -> Record | None:
        """Remove an entity by stable id. ``None`` when unknown; raises on a
        non-owner."""
        collection = self.get(collection_id)
        if collection is None:
            return None
        if not can_edit(collection, owner):
            raise CollectionAccessError
        updated = remove_collection_item(collection, stable_id, iso_now())
        self.write(updated)
        return updated


def store(directory: Path | None = None) -> CollectionStore:
    """The collection store this process serves.

    Built per call from :func:`pinakes.paths.collections_dir`, which re-reads its
    environment override every time — the same no-singleton rule the contribution
    queue follows, and for the same two reasons: there is a second server reading
    this directory, and a test redirects it by setting one variable.
    """
    return CollectionStore(directory if directory is not None else collections_dir())
