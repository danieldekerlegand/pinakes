"""The dataset changelog — the write half, ported for the review pipeline.

`GET /api/changelog` is a different port unit and is still served by Express, so
only what the contribution pipeline *writes* lives here: one JSON file per
recorded change, in the same directory and the same record shape as
`server/services/changelog.ts`, so the Express reader lists entries this service
wrote without knowing which server wrote them.

**Recording never fails a review.** An approved contribution is the user's work;
losing an audit line is bad, losing their submission because the audit line could
not be written is worse. :func:`record_change` swallows and reports, exactly as
the try/catch around the TypeScript call site does.
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Literal

from pinakes.contributions.store import iso_now
from pinakes.paths import changelog_dir

logger = logging.getLogger("pinakes")

ChangeType = Literal["added", "modified", "removed"]

CHANGE_TYPES: tuple[str, ...] = ("added", "modified", "removed")

#: Optional string fields dropped when blank, so the persisted record is tidy.
_OPTIONAL_STRINGS = (
    "targetFile",
    "targetId",
    "entityName",
    "sourceUrl",
    "contributionId",
    "reviewer",
    "summary",
)

_BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def make_entry(
    payload: dict[str, Any], entry_id: str, timestamp: str
) -> dict[str, Any]:
    """Normalize an input into a persisted entry. Pure — trims, drops blanks."""
    entry: dict[str, Any] = {
        "id": entry_id,
        "timestamp": timestamp,
        "domain": str(payload["domain"]).strip(),
        "changeType": payload["changeType"],
        "source": str(payload["source"]).strip(),
    }
    for key in _OPTIONAL_STRINGS:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            entry[key] = value.strip()
    fields = payload.get("fields")
    if isinstance(fields, list):
        trimmed = [f.strip() for f in fields if isinstance(f, str) and f.strip()]
        if trimmed:
            entry["fields"] = trimmed
    confidence = payload.get("confidence")
    if isinstance(confidence, (int, float)) and not isinstance(confidence, bool):
        entry["confidence"] = confidence
    return entry


def validate(payload: dict[str, Any]) -> list[str]:
    """Why this input cannot be recorded. Empty list ⇒ it can."""
    errors: list[str] = []
    domain = payload.get("domain")
    if not isinstance(domain, str) or not domain.strip():
        errors.append("domain is required")
    if payload.get("changeType") not in CHANGE_TYPES:
        errors.append(f"changeType must be one of: {', '.join(CHANGE_TYPES)}")
    source = payload.get("source")
    if not isinstance(source, str) or not source.strip():
        errors.append("source is required")
    confidence = payload.get("confidence")
    if confidence is not None and (
        isinstance(confidence, bool)
        or not isinstance(confidence, (int, float))
        or confidence < 1
        or confidence > 100
    ):
        errors.append("confidence must be a number between 1 and 100")
    return errors


def record_change(
    payload: dict[str, Any],
    *,
    directory: Path | None = None,
    entry_id: str | None = None,
    now: str | None = None,
) -> dict[str, Any] | None:
    """Record one change, best-effort. Returns the entry, or ``None`` on failure.

    ``directory``/``entry_id``/``now`` are injectable so a test asserts on an
    exact file; left unset they resolve the way the running service does.
    """
    try:
        errors = validate(payload)
        if errors:
            raise ValueError(f"Invalid changelog entry: {'; '.join(errors)}")
        target = Path(directory) if directory is not None else changelog_dir()
        target.mkdir(parents=True, exist_ok=True)
        stamp = now if now is not None else iso_now()
        identity = entry_id if entry_id is not None else _generate_id()
        entry = make_entry(payload, identity, stamp)
        (target / f"{identity}.json").write_text(
            json.dumps(entry, indent=2), encoding="utf-8"
        )
        return entry
    except (OSError, ValueError, KeyError) as exc:
        logger.warning("failed to record a changelog entry: %s", exc)
        return None


def _generate_id() -> str:
    """``change-<ms in base36>-<8 random hex chars>``, as TypeScript mints it."""
    value = int(time.time() * 1000)
    digits: list[str] = []
    while value > 0:
        value, remainder = divmod(value, 36)
        digits.append(_BASE36[remainder])
    return f"change-{''.join(reversed(digits))}-{os.urandom(4).hex()}"
