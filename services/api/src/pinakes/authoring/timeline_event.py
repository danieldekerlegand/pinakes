"""Timeline-event authoring — the port of `server/services/timeline-event.ts`.

An `event` (a single year) or a `period` (a dated range) authored on the
temporal axis becomes a queued contribution with provenance
``entityData.source = "user-authored"``; a reviewer promotes it into
`data/source/lexicons/culture-events.tsv` later. Nothing here writes a TSV.

The error strings are the contract, not prose: `post-timeline-event-invalid`
records the **400 body** of an empty submission — message, the five errors in
declaration order, and the one warning — and that fixture is replayed against
both backends.
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
    number_text,
    source_titles,
)

#: Swim-lane keys, kept in sync with the client timeline's ``LANE_ORDER``.
TIMELINE_LANES: Final[tuple[str, ...]] = (
    "political",
    "territory",
    "urbanism",
    "technology",
    "religion",
    "language",
    "economy",
)

#: Event magnitude — drives the marker radius on the client timeline.
TIMELINE_MAGNITUDES: Final[tuple[str, ...]] = ("major", "moderate", "minor")

#: A single-year marker vs. a dated range.
TIMELINE_ENTRY_KINDS: Final[tuple[str, ...]] = ("event", "period")

#: Inclusive year bounds an authored entry must fall within (negative = BCE).
TIMELINE_MIN_YEAR: Final = -50000
TIMELINE_MAX_YEAR: Final = 2100

#: Marks the provenance of an authored timeline contribution.
TIMELINE_PROVENANCE: Final = "user-authored"

#: Confidence a submission gets when it declares none (and warns about it).
DEFAULT_TIMELINE_CONFIDENCE: Final = 60


class ValidationResult(NamedTuple):
    """The verdict, as the route reports it."""

    valid: bool
    errors: list[str]
    warnings: list[str]


def _bounds(bounds: Any) -> tuple[float, float]:
    """The allowed window: the global bounds intersected with *bounds*."""
    low: Any = MISSING
    high: Any = MISSING
    if isinstance(bounds, dict):
        low = bounds.get("min", MISSING)
        high = bounds.get("max", MISSING)
    minimum = max(TIMELINE_MIN_YEAR, low if is_present(low) else TIMELINE_MIN_YEAR)
    maximum = min(TIMELINE_MAX_YEAR, high if is_present(high) else TIMELINE_MAX_YEAR)
    return minimum, maximum


def _within_bounds(year: float, bounds: Any) -> bool:
    minimum, maximum = _bounds(bounds)
    return minimum <= year <= maximum


def _out_of_bounds(label: str, year: Any, bounds: Any) -> str:
    minimum, maximum = _bounds(bounds)
    return (
        f"{label} {number_text(year)} is out of bounds "
        f"(allowed {number_text(minimum)}..{number_text(maximum)})"
    )


def validate_timeline_event(
    body: Any, bounds: Any = None
) -> ValidationResult:
    """Validate a submission: kind, association, lane, and a coherent range.

    ``bounds`` optionally tightens the year window (e.g. an associated culture's
    active period); it is intersected with the global bounds, never widened past
    them.
    """
    errors: list[str] = []
    warnings: list[str] = []

    kind = field(body, "kind")
    if kind not in TIMELINE_ENTRY_KINDS:
        errors.append(f"kind must be one of: {', '.join(TIMELINE_ENTRY_KINDS)}")

    title = field(body, "title")
    if not isinstance(title, str) or not title.strip():
        errors.append("title is required")

    culture_profile_id = field(body, "cultureProfileId")
    if not isinstance(culture_profile_id, str) or not culture_profile_id.strip():
        errors.append(
            "cultureProfileId is required — a timeline entry must be associated "
            "with an entity"
        )

    lane = field(body, "lane")
    if lane not in TIMELINE_LANES:
        errors.append(f"lane must be one of: {', '.join(TIMELINE_LANES)}")

    magnitude = field(body, "magnitude")
    if magnitude is not MISSING and magnitude not in TIMELINE_MAGNITUDES:
        errors.append(f"magnitude must be one of: {', '.join(TIMELINE_MAGNITUDES)}")

    start = field(body, "timePeriodStart")
    if not is_finite_number(start):
        errors.append(
            "timePeriodStart is required and must be a number (negative = BCE)"
        )
    elif not _within_bounds(start, bounds):
        errors.append(_out_of_bounds("timePeriodStart", start, bounds))

    end = field(body, "timePeriodEnd")
    has_end = is_present(end)
    if kind == "period":
        if not has_end:
            errors.append("timePeriodEnd is required for a period entry")
        elif not is_finite_number(end):
            errors.append("timePeriodEnd must be a number")
        else:
            if not _within_bounds(end, bounds):
                errors.append(_out_of_bounds("timePeriodEnd", end, bounds))
            if is_finite_number(start) and end < start:
                errors.append(
                    "timePeriodEnd must not be earlier than timePeriodStart "
                    "(inverted range)"
                )
            elif is_finite_number(start) and end == start:
                warnings.append(
                    "timePeriodEnd equals timePeriodStart; consider kind 'event' "
                    "for a point in time"
                )
    elif kind == "event" and has_end:
        if is_finite_number(end) and end != start:
            errors.append(
                "an event is a single point in time; use kind 'period' for a "
                "range (timePeriodEnd must match timePeriodStart)"
            )

    confidence = field(body, "confidence")
    if confidence is not MISSING:
        if not is_finite_number(confidence) or confidence < 1 or confidence > 100:
            errors.append("confidence must be a number between 1 and 100")
    else:
        warnings.append(
            f"confidence not specified, defaulting to {DEFAULT_TIMELINE_CONFIDENCE}"
        )

    return ValidationResult(valid=not errors, errors=errors, warnings=warnings)


def _event_type(body: Any) -> str:
    """``input.eventType?.trim() || "event"``."""
    raw = field(body, "eventType")
    return raw.strip() if isinstance(raw, str) and raw.strip() else "event"


def _magnitude(body: Any) -> Any:
    raw = field(body, "magnitude")
    return "moderate" if raw is MISSING else raw


def serialize_timeline_event(body: Any) -> dict[str, Any]:
    """The `culture-events.tsv` row shape.

    ``year`` is the *start* year — that TSV carries a single year column, so the
    full range survives only on the contribution's ``entityData`` for a reviewer.
    """
    description = field(body, "description")
    return {
        "culture_profile_id": field(body, "cultureProfileId"),
        "year": field(body, "timePeriodStart"),
        "lane": field(body, "lane"),
        "event_type": _event_type(body),
        "title": field(body, "title"),
        "description": "" if description is MISSING else description,
        "magnitude": _magnitude(body),
        "sources": json_text(source_titles(field(body, "sources"))),
    }


def timeline_event_to_contribution(body: Any) -> dict[str, Any]:
    """Map a validated entry onto the queue's ``Partial<Contribution>`` shape."""
    confidence = field(body, "confidence")
    if confidence is MISSING:
        confidence = DEFAULT_TIMELINE_CONFIDENCE

    kind = field(body, "kind")
    end = field(body, "timePeriodEnd")
    if kind == "period":
        time_period_end = None if end is MISSING else end
    else:
        time_period_end = None

    description = field(body, "description")
    entity_data: dict[str, Any] = {
        "kind": kind,
        "cultureProfileId": field(body, "cultureProfileId"),
        "title": field(body, "title"),
        "lane": field(body, "lane"),
        "eventType": _event_type(body),
        "magnitude": _magnitude(body),
        "timePeriodStart": field(body, "timePeriodStart"),
        "timePeriodEnd": time_period_end,
        "description": "" if description is MISSING else description,
        "source": TIMELINE_PROVENANCE,
        "serialized": serialize_timeline_event(body),
    }

    sources = field(body, "sources")
    contribution: dict[str, Any] = {
        "entityType": "timeline-event",
        "action": "add",
        "entityId": field(body, "cultureProfileId"),
        "entityData": entity_data,
        "sources": (
            sources
            if has_sources(sources)
            else [{"title": "User-authored timeline entry"}]
        ),
        "confidence": confidence,
    }
    # `JSON.stringify` drops an undefined property, and the queue reproduces
    # that (`contributions.store._compact`); an absent optional must not arrive
    # as an explicit null.
    for key in ("notes", "contributorName", "contributorEmail"):
        value = field(body, key)
        if value is not MISSING:
            contribution[key] = value
    return contribution


def options() -> dict[str, Any]:
    """The vocabulary + year bounds the client's authoring form needs."""
    return {
        "kinds": list(TIMELINE_ENTRY_KINDS),
        "lanes": list(TIMELINE_LANES),
        "magnitudes": list(TIMELINE_MAGNITUDES),
        "minYear": TIMELINE_MIN_YEAR,
        "maxYear": TIMELINE_MAX_YEAR,
    }


__all__ = [
    "DEFAULT_TIMELINE_CONFIDENCE",
    "TIMELINE_ENTRY_KINDS",
    "TIMELINE_LANES",
    "TIMELINE_MAGNITUDES",
    "TIMELINE_MAX_YEAR",
    "TIMELINE_MIN_YEAR",
    "TIMELINE_PROVENANCE",
    "ValidationResult",
    "options",
    "serialize_timeline_event",
    "timeline_event_to_contribution",
    "validate_timeline_event",
]
