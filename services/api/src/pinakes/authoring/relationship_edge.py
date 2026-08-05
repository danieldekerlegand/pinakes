"""Relationship authoring — the port of `server/services/relationship-edge.ts`.

A typed edge authored by dragging one entity onto another becomes a queued
contribution with provenance ``entityData.source = "user-authored"``; a reviewer
promotes it into `data/source/lexicons/cultural-lineages.tsv`.

The vocabulary is **the canonical edge vocabulary**
(``pinakes_contracts.canonical_schema.EDGE_TYPES``), not a local list — so an
authored edge is forward-compatible with the shared graph instead of inventing a
parallel free-text vocabulary.

Two invariants are the whole point of the surface: **no self edges**, and **no
duplicates** — a `(sourceId, targetId, relationshipType)` triple that already
exists in the corpus or the queue is rejected with a 409. Direction matters:
``A -influenced-by-> B`` and its reverse are distinct edges.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any, Final, NamedTuple

from pinakes_contracts.canonical_schema import EDGE_TYPES

from pinakes.authoring._js import (
    MISSING,
    field,
    has_sources,
    is_finite_number,
    is_present,
    json_text,
    non_empty_string,
    source_titles,
)

#: The canonical edge vocabulary as the client form + validation consume it.
RELATIONSHIP_TYPE_OPTIONS: Final[tuple[dict[str, str], ...]] = tuple(
    {"name": entry.name, "token": entry.type, "description": entry.description}
    for entry in EDGE_TYPES
)

#: Valid canonical relationship-type names, for O(1) membership checks.
RELATIONSHIP_TYPE_NAMES: Final[frozenset[str]] = frozenset(
    option["name"] for option in RELATIONSHIP_TYPE_OPTIONS
)

#: Neo4j `:TYPE` token by canonical name.
_TOKEN_BY_NAME: Final[dict[str, str]] = {
    option["name"]: option["token"] for option in RELATIONSHIP_TYPE_OPTIONS
}

#: Marks the provenance of an authored relationship contribution.
RELATIONSHIP_PROVENANCE: Final = "user-authored"

#: Default confidence (1–100) when the author leaves it blank.
DEFAULT_RELATIONSHIP_CONFIDENCE: Final = 60


@dataclass(frozen=True, slots=True)
class ExistingEdge:
    """A `(sourceId, targetId, relationshipType)` triple already present."""

    source_id: str
    target_id: str
    relationship_type: str


class ValidationResult(NamedTuple):
    valid: bool
    errors: list[str]
    warnings: list[str]
    duplicate: bool


def edge_key(source_id: str, target_id: str, relationship_type: str) -> str:
    """Canonical dedup key for a directed, typed edge.

    Ids are trimmed but case-sensitive (Pinakes ids are lowercase-stable); the
    relationship type is a fixed canonical token.
    """
    return f"{source_id.strip()} {target_id.strip()} {relationship_type.strip()}"


def token_for(name: str) -> str:
    """The Neo4j `:TYPE` token for a canonical name, or ``""`` when unknown."""
    return _TOKEN_BY_NAME.get(name, "")


def validate_relationship_edge(
    body: Any, existing: Sequence[ExistingEdge] = ()
) -> ValidationResult:
    """Validate a submission: endpoints, canonical type, no self edge, no duplicate.

    ``existing`` may be omitted when the caller only wants structural validation.
    """
    errors: list[str] = []
    warnings: list[str] = []
    duplicate = False

    raw_source = field(body, "sourceId")
    raw_target = field(body, "targetId")
    source_id = raw_source.strip() if non_empty_string(raw_source) else ""
    target_id = raw_target.strip() if non_empty_string(raw_target) else ""

    if not source_id:
        errors.append("sourceId is required — drag an entity to start the relationship")
    if not target_id:
        errors.append(
            "targetId is required — drop onto an entity to complete the relationship"
        )
    if source_id and target_id and source_id == target_id:
        errors.append("a relationship cannot connect an entity to itself (self edge)")

    raw_type = field(body, "relationshipType")
    if not non_empty_string(raw_type):
        errors.append("relationshipType is required")
    elif raw_type.strip() not in RELATIONSHIP_TYPE_NAMES:
        names = ", ".join(option["name"] for option in RELATIONSHIP_TYPE_OPTIONS)
        errors.append(f"relationshipType must be one of: {names}")

    time_start = field(body, "timeStart")
    time_end = field(body, "timeEnd")
    if is_present(time_start) and not is_finite_number(time_start):
        errors.append("timeStart must be a number (negative = BCE)")
    if is_present(time_end) and not is_finite_number(time_end):
        errors.append("timeEnd must be a number (negative = BCE)")
    if (
        is_finite_number(time_start)
        and is_finite_number(time_end)
        and time_end < time_start
    ):
        errors.append("timeEnd must not be earlier than timeStart (inverted range)")

    confidence = field(body, "confidence")
    if confidence is not MISSING:
        if not is_finite_number(confidence) or confidence < 1 or confidence > 100:
            errors.append("confidence must be a number between 1 and 100")
    else:
        warnings.append(
            "confidence not specified, defaulting to "
            f"{DEFAULT_RELATIONSHIP_CONFIDENCE}"
        )

    # Dedup — only meaningful once the core fields are well-formed.
    if (
        source_id
        and target_id
        and source_id != target_id
        and non_empty_string(raw_type)
    ):
        relationship_type = raw_type.strip()
        key = edge_key(source_id, target_id, relationship_type)
        if any(
            edge_key(edge.source_id, edge.target_id, edge.relationship_type) == key
            for edge in existing
        ):
            duplicate = True
            errors.append(
                f'a "{relationship_type}" relationship from {source_id} to '
                f"{target_id} already exists"
            )

    return ValidationResult(
        valid=not errors, errors=errors, warnings=warnings, duplicate=duplicate
    )


def _named(body: Any, name_key: str, id_key: str) -> str:
    """``(input.<name> ?? input.<id>).trim()`` — the id stands in for a blank name."""
    name = field(body, name_key)
    if name is MISSING or name is None:
        name = field(body, id_key)
    return name.strip() if isinstance(name, str) else str(name)


def _bound(body: Any, key: str) -> Any:
    """A time bound as the serializer sees it: the number, else ``None``."""
    value = field(body, key)
    return value if is_finite_number(value) else None


def serialize_relationship_edge(body: Any) -> dict[str, Any]:
    """The `cultural-lineages.tsv` row shape for an authored relationship.

    A blank numeric bound is the **empty string**, matching the TSV's blank
    cells — not a null, which the loader would read as the literal text.
    """
    time_start = _bound(body, "timeStart")
    time_end = _bound(body, "timeEnd")
    confidence = field(body, "confidence")
    evidence_types = field(body, "evidenceTypes")
    description = field(body, "description")
    return {
        "source_id": field(body, "sourceId").strip(),
        "source_name": _named(body, "sourceName", "sourceId"),
        "target_id": field(body, "targetId").strip(),
        "target_name": _named(body, "targetName", "targetId"),
        "relationship_type": field(body, "relationshipType").strip(),
        "time_start": "" if time_start is None else time_start,
        "time_end": "" if time_end is None else time_end,
        "confidence": (
            DEFAULT_RELATIONSHIP_CONFIDENCE if confidence is MISSING else confidence
        ),
        "evidence_types": json_text(
            [] if evidence_types is MISSING else evidence_types
        ),
        "description": "" if description is MISSING else description,
        "sources": json_text(source_titles(field(body, "sources"))),
    }


def relationship_summary(body: Any) -> dict[str, Any]:
    """The compact confirmation summary the client surfaces after a 201."""
    relationship_type = field(body, "relationshipType").strip()
    confidence = field(body, "confidence")
    return {
        "sourceId": field(body, "sourceId").strip(),
        "sourceName": _named(body, "sourceName", "sourceId"),
        "targetId": field(body, "targetId").strip(),
        "targetName": _named(body, "targetName", "targetId"),
        "relationshipType": relationship_type,
        "relationshipToken": token_for(relationship_type),
        "timeStart": _bound(body, "timeStart"),
        "timeEnd": _bound(body, "timeEnd"),
        "confidence": (
            DEFAULT_RELATIONSHIP_CONFIDENCE if confidence is MISSING else confidence
        ),
    }


def relationship_edge_to_contribution(body: Any) -> dict[str, Any]:
    """Map a validated relationship onto the queue's ``Partial<Contribution>``."""
    confidence = field(body, "confidence")
    if confidence is MISSING:
        confidence = DEFAULT_RELATIONSHIP_CONFIDENCE

    evidence_types = field(body, "evidenceTypes")
    description = field(body, "description")
    entity_data: dict[str, Any] = {
        "sourceId": field(body, "sourceId").strip(),
        "sourceName": _named(body, "sourceName", "sourceId"),
        "targetId": field(body, "targetId").strip(),
        "targetName": _named(body, "targetName", "targetId"),
        "relationshipType": field(body, "relationshipType").strip(),
        "timeStart": _bound(body, "timeStart"),
        "timeEnd": _bound(body, "timeEnd"),
        "evidenceTypes": [] if evidence_types is MISSING else evidence_types,
        "description": "" if description is MISSING else description,
        "source": RELATIONSHIP_PROVENANCE,
        "serialized": serialize_relationship_edge(body),
    }

    sources = field(body, "sources")
    contribution: dict[str, Any] = {
        "entityType": "relationship",
        "action": "add",
        "entityData": entity_data,
        "sources": (
            sources
            if has_sources(sources)
            else [{"title": "User-authored relationship"}]
        ),
        "confidence": confidence,
    }
    for key in ("notes", "contributorName", "contributorEmail"):
        value = field(body, key)
        if value is not MISSING:
            contribution[key] = value
    return contribution


def existing_edges_payload(edges: Iterable[ExistingEdge]) -> list[dict[str, str]]:
    """The wire shape of the existing-edge list `GET /edge/options` publishes."""
    return [
        {
            "sourceId": edge.source_id,
            "targetId": edge.target_id,
            "relationshipType": edge.relationship_type,
        }
        for edge in edges
    ]


__all__ = [
    "DEFAULT_RELATIONSHIP_CONFIDENCE",
    "RELATIONSHIP_PROVENANCE",
    "RELATIONSHIP_TYPE_NAMES",
    "RELATIONSHIP_TYPE_OPTIONS",
    "ExistingEdge",
    "ValidationResult",
    "edge_key",
    "existing_edges_payload",
    "relationship_edge_to_contribution",
    "relationship_summary",
    "serialize_relationship_edge",
    "token_for",
    "validate_relationship_edge",
]
