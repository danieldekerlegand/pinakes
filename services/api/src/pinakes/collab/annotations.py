"""User annotations — a reader's own free-text notes on an entity.

The port of `server/services/annotations.ts`. One JSON file per note under
``data/runtime/annotations``, keyed by the entity's stable ``cs:<type>:<id>`` id
plus the owner — so the natural query is "the notes on this entity that I may
see", not "the note with this id".

Where this differs from :mod:`pinakes.collab.collections`, which it otherwise
mirrors:

* **Private by default, and sharing is a visibility flip.** There is no share
  token: a public note is simply visible to everyone looking at that entity.
* **Nothing leaves this module carrying an owner id.** Every response goes
  through :func:`to_view`, which drops `owner` and replaces it with an
  `editable` boolean for the asking viewer. A public note authored by someone
  else is served to strangers, so the projection is the privacy boundary — not
  a convenience.
* **Notes are user content beside curated data, never mixed into it.** Nothing
  here writes to the corpus.
"""

from __future__ import annotations

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
from pinakes.paths import annotations_dir

#: Longest accepted note. Generous, but it bounds a single JSON record.
MAX_ANNOTATION_LENGTH = 10_000


class AnnotationAccessError(Exception):
    """A non-owner tried to mutate a note. The route maps this to 403."""

    def __init__(
        self, message: str = "You do not have access to this annotation"
    ) -> None:
        super().__init__(message)
        self.message = message


# ── Validation (pure) ────────────────────────────────────────────────────────


def validate_annotation_input(data: dict[str, Any]) -> ValidationResult:
    """The port of `validateAnnotationInput`. Pure — no filesystem, no clock.

    The entity ref is the payload *itself* (`type`/`id` at the top level), not a
    nested object — that is the shape the client posts, and the shape the errors
    are phrased against.
    """
    errors: list[str] = list(validate_entity_ref(data))

    body = data.get("body")
    if not isinstance(body, str) or body.strip() == "":
        errors.append("body is required")
    elif len(body) > MAX_ANNOTATION_LENGTH:
        errors.append(f"body must be {MAX_ANNOTATION_LENGTH} characters or fewer")

    if "visibility" in data and data["visibility"] not in VISIBILITIES:
        errors.append("visibility must be 'private' or 'public'")

    return ValidationResult(valid=not errors, errors=errors, warnings=[])


# ── Mutation (pure) ──────────────────────────────────────────────────────────


def create_annotation(data: dict[str, Any], ctx: dict[str, str]) -> Record:
    """Build a note from validated input. Id/owner/clock come in *ctx*."""
    entity = clean_ref(
        {
            "type": data.get("type") or "",
            "id": data.get("id") or "",
            "name": data.get("name"),
            "region": data.get("region"),
        }
    )
    return {
        "id": ctx["id"],
        "stableId": stable_entity_id(entity),
        "entity": entity,
        "owner": ctx["owner"],
        "body": str(data.get("body") or "").strip(),
        "visibility": normalize_visibility(data.get("visibility")),
        "createdAt": ctx["now"],
        "updatedAt": ctx["now"],
    }


def apply_annotation_update(
    annotation: Record, patch: dict[str, Any], now: str
) -> Record:
    """Apply a body/visibility patch, returning a new record (no mutation)."""
    updated: Record = {**annotation, "updatedAt": now}
    if "body" in patch:
        updated["body"] = str(patch["body"]).strip()
    if "visibility" in patch:
        updated["visibility"] = normalize_visibility(patch["visibility"])
    return updated


def can_view(annotation: Record, owner: str) -> bool:
    """Owner match, or the note is public."""
    return annotation.get("owner") == owner or annotation.get("visibility") == "public"


def can_edit(annotation: Record, owner: str) -> bool:
    """Owner match only."""
    return annotation.get("owner") == owner


def to_view(annotation: Record, viewer: str) -> Record:
    """The outgoing projection: no owner id, plus whether *viewer* may edit it.

    Used for **every** response — list, get, create and patch alike — so there is
    no path on which a raw record reaches a client.
    """
    return {
        "id": annotation["id"],
        "stableId": annotation["stableId"],
        "entity": annotation["entity"],
        "body": annotation["body"],
        "visibility": annotation["visibility"],
        "editable": can_edit(annotation, viewer),
        "createdAt": annotation["createdAt"],
        "updatedAt": annotation["updatedAt"],
    }


def visible_annotations(
    records: list[Record], stable_id: str, viewer: str
) -> list[Record]:
    """The notes on one entity *viewer* may see: their own, plus public others'.

    Ordered own-first, then newest-updated. Sorting on the pair in one key is
    the same total order the TypeScript comparator produces, and Python's sort
    is stable for the same reason V8's is.
    """
    visible = [
        record
        for record in records
        if record.get("stableId") == stable_id and can_view(record, viewer)
    ]
    visible.sort(
        key=lambda record: (
            0 if record.get("owner") == viewer else 1,
            -epoch_ms(record.get("updatedAt")),
        )
    )
    return visible


# ── The store ────────────────────────────────────────────────────────────────


class AnnotationStore(RecordStore):
    """JSON-per-record annotations rooted at one directory."""

    def create(self, data: dict[str, Any], owner: str) -> Record:
        """Create and persist a note owned by *owner*."""
        annotation = create_annotation(
            data, {"id": f"note_{uuid.uuid4()}", "owner": owner, "now": iso_now()}
        )
        self.write(annotation)
        return annotation

    def list_for_entity(self, stable_id: str, owner: str) -> list[Record]:
        """The notes on one entity that *owner* may see."""
        return visible_annotations(self.read_all(), stable_id, owner)

    def get(self, annotation_id: str) -> Record | None:
        """Raw lookup by id — **no access check**. The route applies `can_view`."""
        return self.read(annotation_id)

    def update(
        self, annotation_id: str, patch: dict[str, Any], owner: str
    ) -> Record | None:
        """Patch body/visibility. ``None`` when unknown; raises on a non-owner."""
        annotation = self.get(annotation_id)
        if annotation is None:
            return None
        if not can_edit(annotation, owner):
            raise AnnotationAccessError
        updated = apply_annotation_update(annotation, patch, iso_now())
        self.write(updated)
        return updated

    def remove(self, annotation_id: str, owner: str) -> bool:
        """Delete a note. ``False`` when unknown; raises on a non-owner."""
        annotation = self.get(annotation_id)
        if annotation is None:
            return False
        if not can_edit(annotation, owner):
            raise AnnotationAccessError
        self.delete(annotation_id)
        return True


def store(directory: Path | None = None) -> AnnotationStore:
    """The annotation store this process serves — built per call, never cached
    (see :func:`pinakes.collab.collections.store` for why)."""
    return AnnotationStore(directory if directory is not None else annotations_dir())
