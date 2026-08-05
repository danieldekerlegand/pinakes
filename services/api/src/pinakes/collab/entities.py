"""What collections and annotations both rest on: entity refs and a record dir.

Both TypeScript services declare `stableEntityId`, `normalizeVisibility` and
`validateEntityRef` locally, each with a comment saying the copy is deliberate
("kept local so this module stays free of the graph-resolver's filesystem
imports"). That reason does not survive the port — nothing here imports a graph
resolver — and two copies of a *key format* is exactly the drift worth not
having, so the port keeps one. The rest of each store stays in its own module.

The stable id is the same deterministic `cs:<node-type>:<pinakes-id>` csid the
shared-graph convergence work mints, so a curated item or a note survives a
rename of the denormalized display fields and lines up 1:1 with a graph node.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from pinakes.contributions.store import js_truthy

#: A record as it is stored and served — a plain dict, for the same reason
#: :data:`pinakes.contributions.store.Contribution` is one: the on-disk shape is
#: the TypeScript writer's, and re-typing it here would mean maintaining a second
#: copy of a shape that already has an authority.
Record = dict[str, Any]

#: The owner a request that names none is attributed to. Not a sentinel for
#: "unowned": records really are written under this id, and two anonymous
#: browsers share them. That is the Express behaviour and the client relies on
#: it (`web/src/lib/collections.ts` seeds a per-browser id precisely because the
#: fallback is shared).
ANONYMOUS = "anonymous"

VISIBILITIES = ("private", "public")


def stable_entity_id(ref: dict[str, Any]) -> str:
    """``cs:<type>:<id>`` — the dedup / lookup key for a referenced entity."""
    return f"cs:{ref['type']}:{ref['id']}"


def normalize_visibility(value: Any) -> str:
    """Coerce anything to a valid visibility. Not ``"public"`` means private."""
    return "public" if value == "public" else "private"


def validate_entity_ref(ref: Any) -> list[str]:
    """Errors for an entity ref: ``type`` and ``id`` are non-empty strings.

    The JS guard is ``!ref || typeof ref !== "object"``, and ``typeof`` says
    "object" for an array too — so a list falls through to the property checks
    and collects the two field errors rather than the shape one. Reproduced
    because the error *list* is what the 400 body carries.
    """
    if not js_truthy(ref) or not isinstance(ref, (dict, list)):
        return ["entity ref must be an object"]

    errors: list[str] = []
    fields = ref if isinstance(ref, dict) else {}
    entity_type = fields.get("type")
    entity_id = fields.get("id")
    if not isinstance(entity_type, str) or entity_type.strip() == "":
        errors.append("entity ref requires a non-empty 'type'")
    if not isinstance(entity_id, str) or entity_id.strip() == "":
        errors.append("entity ref requires a non-empty 'id'")
    return errors


def clean_ref(ref: dict[str, Any]) -> dict[str, Any]:
    """Normalize a ref down to its persisted, trimmed shape.

    ``name``/``region`` are denormalized display fields: present when they carry
    something, and *absent* — not null — when they do not, because that is what
    ``JSON.stringify`` writes for the `undefined` the TypeScript builder leaves.
    """
    cleaned: dict[str, Any] = {
        "type": str(ref.get("type", "")).strip(),
        "id": str(ref.get("id", "")).strip(),
    }
    for key in ("name", "region"):
        value = ref.get(key)
        if isinstance(value, str) and value.strip() != "":
            cleaned[key] = value.strip()
    return cleaned


def epoch_ms(timestamp: Any) -> float:
    """``new Date(x).getTime()`` for the ISO stamps these records carry.

    Only ever used as a sort key, so an unparseable value sorts last (0) rather
    than reproducing JavaScript's `NaN`, which would leave the pair in place.
    Neither ordering is observable through the API; the total one is simpler.
    """
    if not isinstance(timestamp, str):
        return 0.0
    try:
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        return 0.0
    return parsed.timestamp() * 1000


class RecordStore:
    """A JSON-per-record directory: the filesystem half of a collab store.

    The mutation rules live in the store subclass's module as pure functions;
    this is only the part that touches disk. As in
    :class:`~pinakes.contributions.store.ContributionStore` there is **no
    in-memory cache of the directory** — two servers read it during the cutover,
    so a cached listing would be a listing of what this process last wrote.
    """

    def __init__(self, directory: Path) -> None:
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)

    def path_for(self, record_id: str) -> Path:
        return self.directory / f"{record_id}.json"

    def read_all(self) -> list[Record]:
        """Every record in the directory, in filename order.

        Unlike the contribution queue this does **not** swallow a malformed
        file: `readAll` in TypeScript lets `JSON.parse` throw, the route catches
        it, and the caller gets a 500 naming the operation. A silently skipped
        record here would be a collection that quietly lost an entry.
        """
        records: list[Record] = []
        for file in sorted(self.directory.glob("*.json")):
            records.append(json.loads(file.read_text(encoding="utf-8")))
        return records

    def read(self, record_id: str) -> Record | None:
        """One record by id, straight off disk. ``None`` when absent."""
        path = self.path_for(record_id)
        if not path.is_file():
            return None
        loaded: Record = json.loads(path.read_text(encoding="utf-8"))
        return loaded

    def write(self, record: Record) -> None:
        """Persist one record, pretty-printed as the TypeScript writer leaves it."""
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path_for(str(record["id"])).write_text(
            json.dumps(record, indent=2), encoding="utf-8"
        )

    def delete(self, record_id: str) -> None:
        self.path_for(record_id).unlink()
