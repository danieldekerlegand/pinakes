"""Locating the language-neutral contract sources on disk.

The generated modules beside this one embed the vocabulary they declare, so the
common case needs no filesystem at all. Two cases still want the *whole* document
— the three registries (consumed as nested prose, not field by field) and
:mod:`pinakes_engine.datalog.schema_constraints`, which compiles its replay
artifact from the raw schema — and this module is the single place that knows
where those files live.

That matters because the alternative is what it replaces: every Python caller
walking up its own count of ``Path(__file__).parents[n]`` to reach the repo root.
A wrong count fails *silently* (the file simply "doesn't exist", and an
``if path.exists()`` guard degrades a test to a skip), which is precisely the
failure mode ``engine/CLAUDE.md`` documents.

This file is hand-written; everything else in the package is generated. Keep it
dependency-free.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Final, cast

#: Env var pointing at the ``contracts/`` directory, overriding source-relative
#: discovery. Set it when the package is installed somewhere that is not the repo.
CONTRACTS_DIR_ENV: Final = "PINAKES_CONTRACTS_DIR"

#: The language-neutral source documents, in the order the generator reads them.
CONTRACT_DOCUMENTS: Final[tuple[str, ...]] = (
    "canonical-schema.json",
    "capability-manifest.json",
    "confidence-rubric.json",
    "lexicon-mapping.json",
    "predicate-mapping.json",
)


class ContractDocumentError(RuntimeError):
    """Raised when a contract document cannot be located or is malformed."""


def contracts_dir() -> Path:
    """The repo's ``contracts/`` directory.

    Honours ``$PINAKES_CONTRACTS_DIR``; otherwise resolves relative to this
    module, which lives at ``contracts/python/src/pinakes_contracts/`` in the
    checkout (so the directory is three levels up). Editable installs — how every
    workspace member is installed — keep ``__file__`` inside the checkout, which
    is what makes the walk work.
    """
    override = os.environ.get(CONTRACTS_DIR_ENV)
    if override:
        return Path(override).resolve()
    return Path(__file__).resolve().parents[3]


def contract_path(name: str) -> Path:
    """The path to the neutral source document *name* (e.g. ``canonical-schema.json``).

    Does not check the file exists — a caller that tolerates a standalone
    checkout (no ``contracts/`` around it) tests for that itself.
    """
    return contracts_dir() / name


def load_document(name: str) -> dict[str, Any]:
    """Parse the neutral source document *name*.

    Raises:
        ContractDocumentError: If the document is missing, unparseable, or is not
            a JSON object.
    """
    path = contract_path(name)
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ContractDocumentError(
            f"contract document not found: {path} (set ${CONTRACTS_DIR_ENV})"
        ) from exc
    try:
        parsed: object = json.loads(raw)
    except ValueError as exc:
        raise ContractDocumentError(f"contract document is not valid JSON: {path}") from exc
    if not isinstance(parsed, dict):
        raise ContractDocumentError(f"contract document is not a JSON object: {path}")
    return cast("dict[str, Any]", parsed)
