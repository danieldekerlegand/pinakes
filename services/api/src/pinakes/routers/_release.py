"""What the two release routes share: coercion, the changelog read, the 400.

`server/routes/{dataset-releases,living-dataset}.ts` each carried their own copy
of `parseFormat`, `parseDatasets`, `errorMessage` and the `changelog.stats()` →
`ChangeCounts` lift — four identical blocks across two files. They are one here,
for the same reason :mod:`pinakes.routers._reads` is one: the two groups differ
in what they do with a snapshot, not in how they read a request for one.

Underscore-prefixed so the router scanner skips it; it exposes no ``router``.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi.responses import JSONResponse

from pinakes.contributions import changelog
from pinakes.dataset import export as pipeline


def parse_format(raw: Any) -> str:
    """One of the four formats, or `json`. Never an error, never a 422."""
    return raw if isinstance(raw, str) and raw in pipeline.VALID_FORMATS else "json"


def parse_datasets(raw: Any) -> list[str] | None:
    """A comma-separated query value or a JSON array; ``None`` ⇒ every profile.

    An array contributes only its **string** members, and one that ends up empty
    (or a blank string) is `undefined` rather than an empty selection — asking
    for nothing gets you everything, which is what the fallback means.
    """
    if isinstance(raw, list):
        kept = [item.strip() for item in raw if isinstance(item, str)]
        return [item for item in kept if item] or None
    if isinstance(raw, str) and raw.strip():
        return [part.strip() for part in raw.split(",") if part.strip()]
    return None


def change_counts() -> dict[str, int]:
    """`changelog.stats().byChangeType` — the three counts a semver bump reads.

    Unfiltered, as it was called: a release bumps on every change recorded since
    the log began, not since the previous release.
    """
    by_type = changelog.stats({})["byChangeType"]
    return {
        "added": int(by_type.get("added", 0)),
        "modified": int(by_type.get("modified", 0)),
        "removed": int(by_type.get("removed", 0)),
    }


def failed(logger: logging.Logger, context: str, error: Exception) -> JSONResponse:
    """The release routes' only failure shape: **400** carrying the error's message.

    `errorMessage(error, fallback)` returned its fallback only for a throw that
    was not an `Error` at all — a shape Python has no equivalent of, since every
    `raise` carries a message. The fallback string is therefore unreachable and
    is not spelled; the caller's context goes to the log line instead.
    """
    logger.exception("Error %s", context)
    return JSONResponse(status_code=400, content={"message": str(error)})
