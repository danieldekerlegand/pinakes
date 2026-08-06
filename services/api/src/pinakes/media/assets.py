"""`media-assets.tsv` — the reads' filters and the whole write side.

One module for one file, where the TypeScript had two readers of it. The three
GETs went through `tsv-storage.ts`'s `getMediaAssets*` and the POST/DELETE
through `services/media-asset-service.ts`, and **the two do not read the file
the same way**: the storage loader takes every column through ``getIdx`` (a
missing one is a 500) while the service uses ``indexOf`` (a missing one is a
blank cell) and then rewrites the whole file with the canonical fifteen-column
header. So a write really can repair a header a read refuses. That asymmetry is
reproduced — :func:`load_assets` here is the service's reader,
:func:`pinakes.lexicons.storage.load_media_assets` is the storage one — and the
filters below are the only part of the read half that is not a loader.

Three JavaScript rules decide the answers here:

* **A blank filter is no filter.** ``if (filters?.entityType)`` — ``""`` is
  falsy, so `?entity_type=` returns the whole table.
* **A dimension of zero is unrecorded.** Both readers spell width and height
  ``cell ? parseInt(cell) || null : null``, so ``"0"`` and ``"nope"`` both load
  as ``None`` (:func:`pinakes.analytics.tsv.truthy_int`).
* **A validated dimension is any *integral* number.** ``Number.isInteger(10.0)``
  is true and ``Number.isInteger("10")`` is false, so a JSON body's ``10.0``
  passes and its ``"10"`` is a 400 — a declared `int` field would have answered
  422 to both.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pinakes.analytics import tsv
from pinakes.lexicons.storage import Record

#: The entity kinds a media asset may hang off, in `media-asset-service.ts`'s
#: order — `GET /api/media-assets/meta/types` publishes this list verbatim, so
#: the order is part of the response.
VALID_ENTITY_TYPES: tuple[str, ...] = (
    "art_tradition",
    "archaeological_site",
    "archaeological_culture",
    "civilization",
    "culture_profile",
    "writing_system",
    "music_tradition",
    "dance_tradition",
    "language",
    "language_family",
    "religion",
    "deity",
    "cuisine",
    "literary_tradition",
    "literary_work",
    "architectural_style",
    "building_type",
    "settlement",
    "empire",
    "trade_route",
)

#: The media kinds. Same standing as :data:`VALID_ENTITY_TYPES`.
VALID_MEDIA_TYPES: tuple[str, ...] = ("image", "audio", "video", "document")

#: The header `writeAssets` emits, and the column order every row follows.
COLUMNS: tuple[str, ...] = (
    "id",
    "entity_type",
    "entity_id",
    "media_type",
    "url",
    "title",
    "description",
    "source",
    "license",
    "attribution",
    "mime_type",
    "width",
    "height",
    "tags",
    "date_added",
)

#: `media-<n>` with the number zero-padded to three, as `generateId` mints it.
_ID_PATTERN = re.compile(r"^media-(\d+)$")

#: The fields `addAsset` copies across verbatim — validation has already
#: refused a blank one. `id` and `dateAdded` are minted, not read.
_REQUIRED_FIELDS: tuple[str, ...] = (
    "entityType",
    "entityId",
    "mediaType",
    "url",
    "title",
)

#: The optional string fields, which default to a blank rather than being
#: omitted — ``input.description ?? ""``.
_OPTIONAL_TEXT: tuple[str, ...] = (
    "description",
    "source",
    "license",
    "attribution",
    "mimeType",
)


class MediaAssetValidationError(RuntimeError):
    """`addAsset` refusing an input the route did not validate first.

    Unreachable through `POST /api/media-assets`, which validates and answers
    400 before calling — kept because the service raised, and a caller added
    later should meet the same wall rather than a half-written TSV.
    """


# ── The read half's filters (`tsv-storage.ts`) ───────────────────────────────


def get_media_assets(
    assets: list[Record],
    *,
    entity_type: str | None = None,
    entity_id: str | None = None,
    media_type: str | None = None,
    tag: str | None = None,
) -> list[Record]:
    """`GET /api/media-assets` — four exact filters, each skipped when blank."""
    result = assets
    if entity_type:
        result = [a for a in result if a.get("entityType") == entity_type]
    if entity_id:
        result = [a for a in result if a.get("entityId") == entity_id]
    if media_type:
        result = [a for a in result if a.get("mediaType") == media_type]
    if tag:
        result = [a for a in result if tag in _tags(a)]
    return result


def get_media_assets_for_entity(
    assets: list[Record], entity_type: str, entity_id: str
) -> list[Record]:
    """`GET /api/media-assets/entity/{entityType}/{entityId}` — both, exactly."""
    return [
        a
        for a in assets
        if a.get("entityType") == entity_type and a.get("entityId") == entity_id
    ]


def _tags(asset: Record) -> list[Any]:
    """``a.tags.includes(t)`` over a cell that is only *cast* to ``string[]``.

    The loader parses whatever JSON the cell holds, so a malformed row can land
    a number or an object here. ``Array.prototype.includes`` on a non-array
    would throw over there; this answers "no such tag", which is the same thing
    the surrounding try/catch turns it into.
    """
    tags = asset.get("tags")
    return tags if isinstance(tags, list) else []


# ── Validation (`MediaAssetService.validate`) ────────────────────────────────


def validate(data: dict[str, Any]) -> list[dict[str, str]]:
    """The field errors `POST /api/media-assets` answers 400 with, in order."""
    errors: list[dict[str, str]] = []

    entity_type = data.get("entityType")
    if not entity_type:
        errors.append({"field": "entityType", "message": "entityType is required"})
    elif entity_type not in VALID_ENTITY_TYPES:
        errors.append(
            {"field": "entityType", "message": f"Invalid entityType: {entity_type}"}
        )

    if not data.get("entityId"):
        errors.append({"field": "entityId", "message": "entityId is required"})

    media_type = data.get("mediaType")
    if not media_type:
        errors.append({"field": "mediaType", "message": "mediaType is required"})
    elif media_type not in VALID_MEDIA_TYPES:
        errors.append(
            {"field": "mediaType", "message": f"Invalid mediaType: {media_type}"}
        )

    if not data.get("url"):
        errors.append({"field": "url", "message": "url is required"})

    if not data.get("title"):
        errors.append({"field": "title", "message": "title is required"})

    for field in ("width", "height"):
        # `input.x !== undefined` — *absent*, not falsy, so an explicit `null`
        # is validated (and refused) rather than skipped.
        if field in data and _not_a_dimension(data[field]):
            errors.append(
                {"field": field, "message": f"{field} must be a non-negative integer"}
            )

    return errors


def _not_a_dimension(value: Any) -> bool:
    """``value < 0 || !Number.isInteger(value)`` — the `||` decides everything.

    `Number.isInteger` is false for every non-number, so only a real number
    reaches the comparison; that is why a string, a ``null`` or a ``true`` is
    refused without any coercion happening here. ``bool`` is excluded explicitly
    because Python's ``isinstance(True, int)`` would otherwise call it the
    integer 1, which is exactly the value JavaScript refuses.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return True
    return value < 0 or not float(value).is_integer()


# ── The write half (`MediaAssetService`) ─────────────────────────────────────


def assets_path(lexicons: Path) -> Path:
    return lexicons / "media-assets.tsv"


def load_assets(lexicons: Path) -> list[Record]:
    """The **service's** reader: `indexOf`, so a missing column is a blank cell.

    Deliberately not :func:`pinakes.lexicons.storage.load_media_assets` — see
    this module's docstring for why the two coexist.
    """
    path = assets_path(lexicons)
    if not path.is_file():
        return []
    # `newline=""` because the split below is the TypeScript's `/\r?\n/`, not
    # Python's universal-newline translation: a lone `\r` is not a line break
    # over there, and letting the runtime turn one into a break would silently
    # read a different number of rows.
    with open(path, encoding="utf-8", newline="") as handle:
        text = handle.read()
    lines = [line for line in re.split(r"\r?\n", text) if line.strip() != ""]
    if len(lines) <= 1:
        return []

    header = lines[0].split("\t")

    def index(name: str) -> int:
        return tsv.index_of(header, name)

    text_indices = [
        (key, index(column))
        for key, column in (
            ("id", "id"),
            ("entityType", "entity_type"),
            ("entityId", "entity_id"),
            ("mediaType", "media_type"),
            ("url", "url"),
            ("title", "title"),
            ("description", "description"),
            ("source", "source"),
            ("license", "license"),
            ("attribution", "attribution"),
            ("mimeType", "mime_type"),
        )
    ]
    width_index = index("width")
    height_index = index("height")
    tags_index = index("tags")
    date_index = index("date_added")

    records: list[Record] = []
    for line in lines[1:]:
        row = line.split("\t")
        record: Record = {
            key: tsv.cell(row, position) for key, position in text_indices
        }
        record["width"] = tsv.truthy_int(row, width_index)
        record["height"] = tsv.truthy_int(row, height_index)
        record["tags"] = tsv.json_cell(row, tags_index, [])
        record["dateAdded"] = tsv.cell(row, date_index)
        records.append(record)
    return records


def generate_id(existing: list[Record]) -> str:
    """``media-XXX``, one past the highest `media-<n>` already in the file.

    Highest, not count: deleting `media-003` out of three rows still mints
    `media-004` next, because the scan is a max over the surviving ids. An id
    that does not match the pattern contributes nothing.
    """
    highest = 0
    for asset in existing:
        identifier = asset.get("id")
        if not isinstance(identifier, str):
            continue
        match = _ID_PATTERN.match(identifier)
        if match:
            number = int(match.group(1))
            highest = max(highest, number)
    return f"media-{highest + 1:03d}"


def add_asset(lexicons: Path, data: dict[str, Any]) -> Record:
    """Append one validated asset and rewrite the file. Returns the new record."""
    errors = validate(data)
    if errors:
        joined = ", ".join(error["message"] for error in errors)
        raise MediaAssetValidationError(f"Validation failed: {joined}")

    existing = load_assets(lexicons)
    asset: Record = {"id": generate_id(existing)}
    for field in _REQUIRED_FIELDS:
        asset[field] = data[field]
    for field in _OPTIONAL_TEXT:
        # `input.x ?? ""` — nullish, so an explicitly blank value stays blank
        # and only an absent (or null) one becomes the empty string.
        value = data.get(field)
        asset[field] = "" if value is None else value
    asset["width"] = data.get("width")
    asset["height"] = data.get("height")
    asset["tags"] = data.get("tags") if data.get("tags") is not None else []
    # `new Date().toISOString().split("T")[0]` — the UTC day, not the local one.
    asset["dateAdded"] = datetime.now(UTC).strftime("%Y-%m-%d")

    write_assets(lexicons, [*existing, asset])
    return asset


def delete_asset(lexicons: Path, identifier: str) -> bool:
    """Drop every row with this id. ``False`` — a 404 — when none matched."""
    assets = load_assets(lexicons)
    remaining = [asset for asset in assets if asset.get("id") != identifier]
    if len(remaining) == len(assets):
        return False
    write_assets(lexicons, remaining)
    return True


def write_assets(lexicons: Path, assets: list[Record]) -> None:
    """Rewrite the whole file, atomically, in the canonical column order.

    `TsvWriter.writeTSV`: a `<path>.tmp` sibling then a rename, so a reader
    never sees a half-written corpus. **Nothing is escaped** — a tab or a
    newline inside a title corrupts the file, exactly as it did over there.
    Fixing that here would write cells the TypeScript loader reads back
    differently, which is the one thing a cutover cannot afford.
    """
    path = assets_path(lexicons)
    path.parent.mkdir(parents=True, exist_ok=True)

    lines = ["\t".join(COLUMNS)]
    lines.extend("\t".join(_cells(asset)) for asset in assets)
    content = "\n".join(lines) + "\n"

    temp = path.with_name(path.name + ".tmp")
    temp.write_text(content, encoding="utf-8")
    temp.replace(path)


def _cells(asset: Record) -> list[str]:
    return [
        _text(asset.get("id")),
        _text(asset.get("entityType")),
        _text(asset.get("entityId")),
        _text(asset.get("mediaType")),
        _text(asset.get("url")),
        _text(asset.get("title")),
        _text(asset.get("description")),
        _text(asset.get("source")),
        _text(asset.get("license")),
        _text(asset.get("attribution")),
        _text(asset.get("mimeType")),
        _dimension(asset.get("width")),
        _dimension(asset.get("height")),
        json.dumps(asset.get("tags"), ensure_ascii=False, separators=(",", ":")),
        _text(asset.get("dateAdded")),
    ]


def _text(value: Any) -> str:
    """``Array.prototype.join``'s coercion, for the cells that are strings.

    Every one of these is a string in a record that came off disk, and the five
    a POST supplies are truthiness-checked rather than type-checked — so a body
    naming its `entityId` as the number ``7`` reaches here, and `join` writes
    ``7``. Only the shapes `join` renders unhelpfully (an object, an array) are
    collapsed to a blank; none of them can reach a validated input.
    """
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return _dimension(value)
    return ""


def _dimension(value: Any) -> str:
    """``n?.toString() ?? ""`` — and ``(10.0).toString()`` is ``"10"``.

    Same rule :func:`pinakes.authoring._js.number_text` spells for error
    messages: JavaScript has one number type and prints an integral double with
    no fractional part, so a JSON body's ``10.0`` must land in the cell as
    ``10`` or the TSV round-trips differently on the two backends.
    """
    if value is None or isinstance(value, bool) or not isinstance(value, (int, float)):
        return ""
    return str(int(value)) if float(value).is_integer() else str(value)
