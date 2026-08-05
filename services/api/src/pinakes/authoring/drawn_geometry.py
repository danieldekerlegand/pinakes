"""Drawn-geometry authoring — the port of `server/services/drawn-geometry.ts`.

A GeoJSON Polygon or LineString drawn on the map becomes a queued contribution
with provenance ``entityData.source = "user-drawn"``. The geometry keeps the
corpus's ``[lng, lat]`` order, and :func:`serialize_geometry` produces exactly
the JSON string a `geometry`/`waypoints` TSV cell holds — the promotion target.

The target vocabulary maps 1:1 onto ``ContributionEntityType``
(:data:`~pinakes.contributions.store.REQUIRED_FIELDS`), which is why a
`language-range` mirrors its associated entity into ``entityData.languageId``:
that type requires a `languageId`, and without the mirror a valid drawing would
be rejected by the queue one layer down.
"""

from __future__ import annotations

from typing import Any, Final, NamedTuple

from pinakes.authoring._js import (
    MISSING,
    field,
    has_sources,
    is_finite_number,
    is_present,
    json_text,
    truthy,
)

#: Targets that describe an area (Polygon) and a path (LineString).
POLYGON_TARGETS: Final[tuple[str, ...]] = ("boundary", "language-range")
LINE_TARGETS: Final[tuple[str, ...]] = ("trade-route", "migration-route")

#: Where a drawn shape is destined once a reviewer promotes it.
DRAWN_GEOMETRY_TARGETS: Final[tuple[str, ...]] = POLYGON_TARGETS + LINE_TARGETS

#: Marks the provenance of a drawn contribution's ``entityData.source``.
DRAWN_PROVENANCE: Final = "user-drawn"

#: Confidence hand-drawn geometry gets when the author declares none.
DEFAULT_GEOMETRY_CONFIDENCE: Final = 60


class ValidationResult(NamedTuple):
    valid: bool
    errors: list[str]
    warnings: list[str]


def _is_valid_position(position: Any) -> bool:
    """A single ``[lng, lat]`` with finite, in-world-bounds coordinates."""
    if not isinstance(position, list) or len(position) < 2:
        return False
    lng, lat = position[0], position[1]
    if not is_finite_number(lng) or not is_finite_number(lat):
        return False
    return bool(-180 <= lng <= 180 and -90 <= lat <= 90)


def _positions_equal(a: Any, b: Any) -> bool:
    return bool(a[0] == b[0] and a[1] == b[1])


def validate_geometry(geometry: Any) -> ValidationResult:
    """Structural GeoJSON validation.

    Polygon: ≥1 ring, each ring ≥4 positions and closed. LineString: ≥2
    positions. Every position a finite ``[lng, lat]`` within world bounds.
    """
    errors: list[str] = []
    warnings: list[str] = []

    if not isinstance(geometry, dict):
        return ValidationResult(
            valid=False,
            errors=["geometry is required and must be an object"],
            warnings=warnings,
        )

    kind = geometry.get("type", MISSING)
    coordinates = geometry.get("coordinates", MISSING)

    if kind == "Polygon":
        if not isinstance(coordinates, list) or not coordinates:
            errors.append("Polygon geometry must have at least one linear ring")
        else:
            for ring_index, ring in enumerate(coordinates):
                if not isinstance(ring, list) or len(ring) < 4:
                    errors.append(
                        f"Polygon ring {ring_index} must have at least 4 positions "
                        "(a closed triangle)"
                    )
                    continue
                for position_index, position in enumerate(ring):
                    if not _is_valid_position(position):
                        errors.append(
                            f"Polygon ring {ring_index} position {position_index} "
                            "is not a valid [lng, lat] within world bounds"
                        )
                first, last = ring[0], ring[-1]
                if (
                    _is_valid_position(first)
                    and _is_valid_position(last)
                    and not _positions_equal(first, last)
                ):
                    errors.append(
                        f"Polygon ring {ring_index} is not closed (first and last "
                        "positions must match)"
                    )
    elif kind == "LineString":
        if not isinstance(coordinates, list) or len(coordinates) < 2:
            errors.append("LineString geometry must have at least 2 positions")
        else:
            for position_index, position in enumerate(coordinates):
                if not _is_valid_position(position):
                    errors.append(
                        f"LineString position {position_index} is not a valid "
                        "[lng, lat] within world bounds"
                    )
    else:
        errors.append(
            f"Unsupported geometry type: {_type_text(kind)} "
            "(expected Polygon or LineString)"
        )

    return ValidationResult(valid=not errors, errors=errors, warnings=warnings)


def _type_text(value: Any) -> str:
    """``String(geom.type)`` for the unsupported-type message."""
    if value is MISSING:
        return "undefined"
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def serialize_geometry(geometry: Any) -> str:
    """The exact JSON string a geometry-bearing TSV cell would hold."""
    return json_text(geometry)


def _expected_geometry_type(target: str) -> str:
    return "Polygon" if target in POLYGON_TARGETS else "LineString"


def validate_drawn_geometry(body: Any) -> ValidationResult:
    """Validate a full submission: geometry, target agreement, association, time."""
    errors: list[str] = []
    warnings: list[str] = []

    target = field(body, "target")
    if target not in DRAWN_GEOMETRY_TARGETS:
        errors.append(f"target must be one of: {', '.join(DRAWN_GEOMETRY_TARGETS)}")

    name = field(body, "name")
    if not isinstance(name, str) or not name.strip():
        errors.append("name is required")

    associated = field(body, "associatedEntityId")
    if not isinstance(associated, str) or not associated.strip():
        errors.append(
            "associatedEntityId is required — a drawn geometry must be "
            "associated with an entity"
        )

    start = field(body, "timePeriodStart")
    if not is_finite_number(start):
        errors.append(
            "timePeriodStart is required and must be a number (negative = BCE)"
        )
    end = field(body, "timePeriodEnd")
    if is_present(end):
        if not is_finite_number(end):
            errors.append("timePeriodEnd must be a number or null")
        elif is_finite_number(start) and end < start:
            errors.append(
                "timePeriodEnd must not be earlier than timePeriodStart "
                "(inverted range)"
            )

    confidence = field(body, "confidence")
    if confidence is not MISSING:
        if not is_finite_number(confidence) or confidence < 1 or confidence > 100:
            errors.append("confidence must be a number between 1 and 100")
    else:
        warnings.append(
            f"confidence not specified, defaulting to {DEFAULT_GEOMETRY_CONFIDENCE}"
        )

    geometry = field(body, "geometry")
    geometry_result = validate_geometry(geometry)
    errors.extend(geometry_result.errors)

    # Target ↔ geometry-type agreement, only once both are individually valid —
    # otherwise a malformed shape would be reported twice.
    if (
        target in DRAWN_GEOMETRY_TARGETS
        and geometry_result.valid
        and isinstance(geometry, dict)
    ):
        expected = _expected_geometry_type(target)
        actual = geometry.get("type", MISSING)
        if actual != expected:
            errors.append(
                f"target '{target}' expects a {expected} geometry but received "
                f"a {_type_text(actual)}"
            )

    return ValidationResult(valid=not errors, errors=errors, warnings=warnings)


def drawn_geometry_to_contribution(body: Any) -> dict[str, Any]:
    """Map a validated drawing onto the queue's ``Partial<Contribution>`` shape."""
    entity_type = field(body, "target")
    confidence = field(body, "confidence")
    if confidence is MISSING:
        confidence = DEFAULT_GEOMETRY_CONFIDENCE

    geometry = field(body, "geometry")
    associated = field(body, "associatedEntityId")
    end = field(body, "timePeriodEnd")
    label = field(body, "timePeriodLabel")

    entity_data: dict[str, Any] = {
        "name": field(body, "name"),
        "geometry": geometry,
        "geometrySerialized": serialize_geometry(geometry),
        "drawingMode": (
            "polygon"
            if isinstance(geometry, dict) and geometry.get("type") == "Polygon"
            else "polyline"
        ),
        "source": DRAWN_PROVENANCE,
        "associatedEntityId": associated,
        "timePeriodStart": field(body, "timePeriodStart"),
        "timePeriodEnd": None if end is MISSING else end,
    }
    # `timePeriodLabel: undefined` is dropped by `JSON.stringify`; an explicit
    # null the client sent is kept.
    if label is not MISSING:
        entity_data["timePeriodLabel"] = label

    description = field(body, "description")
    if truthy(description):
        entity_data["description"] = description
    if entity_type == "language-range":
        entity_data["languageId"] = associated

    sources = field(body, "sources")
    contribution: dict[str, Any] = {
        "entityType": entity_type,
        "action": "add",
        "entityId": associated,
        "entityData": entity_data,
        "sources": (
            sources if has_sources(sources) else [{"title": "User-drawn geometry"}]
        ),
        "confidence": confidence,
    }
    for key in ("notes", "contributorName", "contributorEmail"):
        value = field(body, key)
        if value is not MISSING:
            contribution[key] = value
    return contribution


def targets() -> dict[str, Any]:
    """The valid drawing targets, for the client's target selector."""
    return {"targets": list(DRAWN_GEOMETRY_TARGETS)}


__all__ = [
    "DEFAULT_GEOMETRY_CONFIDENCE",
    "DRAWN_GEOMETRY_TARGETS",
    "DRAWN_PROVENANCE",
    "LINE_TARGETS",
    "POLYGON_TARGETS",
    "ValidationResult",
    "drawn_geometry_to_contribution",
    "serialize_geometry",
    "targets",
    "validate_drawn_geometry",
    "validate_geometry",
]
