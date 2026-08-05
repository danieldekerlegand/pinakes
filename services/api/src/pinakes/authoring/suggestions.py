"""Authoring-time relationship suggestions — the port of
`server/services/relationship-suggestions.ts`.

When a contributor creates or edits an entity, this ranks the *most likely*
relationships to nearby entities from three proximity signals — linguistic
(shared associated languages), temporal (overlapping spans), spatial (coordinate
distance and/or region match).

A suggestion is a **proposal**. Nothing here creates an edge: each result
carries a rationale, a confidence, and a ready-to-submit payload the contributor
confirms through `POST /api/relationships/edge`, which is where dedup and the
review queue live.

The one rule worth stating twice: a dimension is *applicable* only when **both**
entities carry its data, and :func:`combined_confidence` averages over the
applicable ones only. A language with no coordinates is not "far away" — it is
unmeasured, and diluting its score with a zero would rank it below a genuinely
weaker match.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from datetime import UTC, datetime
from typing import Any, Final

from pinakes.analytics.jsmath import js_number, js_round, locale_key
from pinakes.authoring.relationship_edge import (
    RELATIONSHIP_TYPE_NAMES,
    ExistingEdge,
    token_for,
)
from pinakes.contributions.store import js_slice

DEFAULT_WEIGHTS: Final[dict[str, float]] = {
    "linguistic": 0.4,
    "temporal": 0.3,
    "spatial": 0.3,
}

DEFAULT_MAX_DISTANCE_KM: Final = 2000
DEFAULT_LIMIT: Final = 10
DEFAULT_MIN_CONFIDENCE: Final = 20

#: Suggestions never claim certainty — they always need human confirmation.
MAX_SUGGESTION_CONFIDENCE: Final = 95


@dataclass(frozen=True, slots=True)
class SuggestionEntity:
    """The authoring subject, or one candidate to suggest against.

    Deliberately domain-agnostic: anything with a name, a type and any subset of
    {language ids, coordinates, time span, region} can participate.
    """

    id: str
    name: str
    entity_type: str
    language_ids: list[str] = dataclass_field(default_factory=list)
    coordinates: dict[str, float] | None = None
    time_start: float | None = None
    time_end: float | None = None
    region: str | None = None


def haversine_km(a: dict[str, float], b: dict[str, float]) -> float:
    """Great-circle distance in km, spelled as the TypeScript spelled it.

    Operation for operation — ``(x * pi) / 180`` rather than ``math.radians``,
    ``sin(x) * sin(x)`` rather than ``sin(x) ** 2`` — because the result reaches
    a rounded confidence, and re-associating the arithmetic moves the last bits
    (`services/api/CLAUDE.md`, the `/api/search/spatial` note).
    """
    radius = 6371
    d_lat = ((b["lat"] - a["lat"]) * math.pi) / 180
    d_lng = ((b["lng"] - a["lng"]) * math.pi) / 180
    a_lat = (a["lat"] * math.pi) / 180
    b_lat = (b["lat"] * math.pi) / 180
    h = math.sin(d_lat / 2) * math.sin(d_lat / 2) + math.cos(a_lat) * math.cos(
        b_lat
    ) * math.sin(d_lng / 2) * math.sin(d_lng / 2)
    return radius * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def regions_match(a: str, b: str) -> bool:
    """Region equality, loosened to substring containment either way."""
    x = a.strip().lower()
    y = b.strip().lower()
    if not x or not y:
        return False
    return x == y or y in x or x in y


def _current_year() -> int:
    """``new Date().getFullYear()`` — the reference year for an open-ended span."""
    return datetime.now(UTC).year


def compute_proximity(
    source: SuggestionEntity,
    candidate: SuggestionEntity,
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """The three-dimensional proximity between subject and candidate."""
    options = options or {}
    max_distance_km = options.get("maxDistanceKm") or DEFAULT_MAX_DISTANCE_KM
    now = options.get("now")
    if now is None:
        now = _current_year()

    # ── Linguistic (Jaccard of associated languages) ─────────────────────────
    source_languages = source.language_ids or []
    candidate_languages = candidate.language_ids or []
    linguistic_applicable = bool(source_languages) and bool(candidate_languages)
    shared = [item for item in source_languages if item in candidate_languages]
    linguistic = 0.0
    if linguistic_applicable and shared:
        union = set(source_languages) | set(candidate_languages)
        linguistic = len(shared) / len(union)

    # ── Temporal (overlap share of the longer span) ──────────────────────────
    temporal_applicable = (
        source.time_start is not None and candidate.time_start is not None
    )
    temporal = 0.0
    overlap_years: float | None = None
    if temporal_applicable:
        source_start = float(source.time_start or 0)
        source_end = float(source.time_end if source.time_end is not None else now)
        candidate_start = float(candidate.time_start or 0)
        candidate_end = float(
            candidate.time_end if candidate.time_end is not None else now
        )
        overlap_start = max(source_start, candidate_start)
        overlap_end = min(source_end, candidate_end)
        if overlap_start <= overlap_end:
            overlap_years = overlap_end - overlap_start
            max_span = max(
                source_end - source_start, candidate_end - candidate_start, 1
            )
            temporal = min(overlap_years / max_span, 1)
        else:
            overlap_years = 0

    # ── Spatial (coordinate distance and/or region match) ────────────────────
    has_coordinates = bool(source.coordinates) and bool(candidate.coordinates)
    has_regions = bool(source.region) and bool(candidate.region)
    spatial_applicable = has_coordinates or has_regions
    spatial = 0.0
    distance_km: float | None = None
    shared_region: str | None = None
    if has_coordinates and source.coordinates and candidate.coordinates:
        distance_km = haversine_km(source.coordinates, candidate.coordinates)
        if distance_km < max_distance_km:
            spatial = max(spatial, 1 - distance_km / max_distance_km)
    if has_regions and source.region and candidate.region:
        if regions_match(source.region, candidate.region):
            spatial = max(spatial, 0.5)
            shared_region = source.region

    return {
        # `js_number` on the three scores and the two measurements: each is a
        # computed double, and an exact 1.0 (or a whole-year overlap) is `1` on
        # the JavaScript wire, not `1.0`.
        "linguistic": js_number(linguistic),
        "temporal": js_number(temporal),
        "spatial": js_number(spatial),
        "applicable": {
            "linguistic": linguistic_applicable,
            "temporal": temporal_applicable,
            "spatial": spatial_applicable,
        },
        "sharedLanguages": shared,
        "overlapYears": None if overlap_years is None else js_number(overlap_years),
        "distanceKm": None if distance_km is None else js_number(distance_km),
        "sharedRegion": shared_region,
    }


def combined_confidence(
    proximity: dict[str, Any], weights: dict[str, float] | None = None
) -> int:
    """1..100 weighted average over the *applicable* dimensions only.

    ``0`` when nothing is applicable, and capped below 100 so a suggestion
    always reads as "confirm me", never "trust me".
    """
    weights = weights or DEFAULT_WEIGHTS
    applicable = proximity["applicable"]
    weighted = 0.0
    weight_sum = 0.0
    for dimension in ("linguistic", "temporal", "spatial"):
        if applicable[dimension]:
            weighted += weights[dimension] * proximity[dimension]
            weight_sum += weights[dimension]
    if weight_sum == 0:
        return 0
    raw = js_round((weighted / weight_sum) * 100)
    return max(1, min(MAX_SUGGESTION_CONFIDENCE, raw))


def _is_language_like(entity_type: str) -> bool:
    return "language" in entity_type.lower()


def _is_place_like(entity_type: str) -> bool:
    lowered = entity_type.lower()
    return any(token in lowered for token in ("place", "site", "settlement", "battle"))


def suggest_relationship_type(
    source: SuggestionEntity,
    candidate: SuggestionEntity,
    proximity: dict[str, Any],
) -> str:
    """The canonical relationship type a suggestion defaults to.

    Chosen from the dominant proximity signal and the two entity types; always a
    valid canonical edge name (falling back to the domain-agnostic
    ``influenced-by``). The contributor can override it before confirming.
    """
    applicable = proximity["applicable"]
    scored = [
        ("linguistic", proximity["linguistic"] if applicable["linguistic"] else -1),
        ("temporal", proximity["temporal"] if applicable["temporal"] else -1),
        ("spatial", proximity["spatial"] if applicable["spatial"] else -1),
    ]
    # `Array.prototype.sort` is stable, so equal scores keep declaration order.
    scored.sort(key=lambda entry: -entry[1])
    dominant = scored[0][0] if scored[0][1] > 0 else None

    if dominant == "linguistic":
        name = (
            "cognate-with"
            if _is_language_like(source.entity_type)
            and _is_language_like(candidate.entity_type)
            else "influenced-by"
        )
    elif dominant == "temporal":
        name = "contemporary-with"
    elif dominant == "spatial":
        name = (
            "located-in" if _is_place_like(candidate.entity_type) else "influenced-by"
        )
    else:
        name = "influenced-by"
    return name if name in RELATIONSHIP_TYPE_NAMES else "influenced-by"


def _overlap_text(value: float | None) -> str:
    """``${proximity.overlapYears}`` — an integral float prints without ``.0``."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def build_rationale(proximity: dict[str, Any]) -> list[dict[str, Any]]:
    """The human-readable reasons a suggestion was surfaced, strongest first."""
    applicable = proximity["applicable"]
    rationale: list[dict[str, Any]] = []

    if applicable["linguistic"] and proximity["linguistic"] > 0:
        languages = proximity["sharedLanguages"]
        plural = "" if len(languages) == 1 else "s"
        rationale.append(
            {
                "kind": "linguistic",
                "score": proximity["linguistic"],
                "detail": (
                    f"Shares {len(languages)} associated language{plural} "
                    f"({', '.join(languages)})"
                ),
            }
        )
    if applicable["temporal"] and proximity["temporal"] > 0:
        rationale.append(
            {
                "kind": "temporal",
                "score": proximity["temporal"],
                "detail": (
                    "Overlapping time span "
                    f"({_overlap_text(proximity['overlapYears'])} years)"
                ),
            }
        )
    if applicable["spatial"] and proximity["spatial"] > 0:
        detail = (
            f"Shared region: {proximity['sharedRegion']}"
            if proximity["sharedRegion"]
            else f"~{js_round(proximity['distanceKm'] or 0)} km apart"
        )
        rationale.append(
            {"kind": "spatial", "score": proximity["spatial"], "detail": detail}
        )

    rationale.sort(key=lambda entry: -entry["score"])
    return rationale


def _pair_key(a: str, b: str) -> str:
    """Undirected pair key, so an existing edge blocks a suggestion either way."""
    x, y = a.strip(), b.strip()
    return f"{x} {y}" if x < y else f"{y} {x}"


def suggest_relationships(
    source: SuggestionEntity,
    candidates: Sequence[SuggestionEntity],
    existing_edges: Sequence[ExistingEdge] = (),
    options: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Rank the relationships worth suggesting for *source*.

    Candidates that are the subject itself, or already connected to it in
    *either* direction, are excluded — a suggestion surfaces a **new** likely
    link, never one already authored.
    """
    options = options or {}
    limit = options.get("limit")
    limit = DEFAULT_LIMIT if limit is None else limit
    min_confidence = options.get("minConfidence")
    min_confidence = (
        DEFAULT_MIN_CONFIDENCE if min_confidence is None else min_confidence
    )
    weights = options.get("weights") or DEFAULT_WEIGHTS

    connected = {_pair_key(edge.source_id, edge.target_id) for edge in existing_edges}

    suggestions: list[dict[str, Any]] = []
    for candidate in candidates:
        if candidate.id == source.id:
            continue
        if _pair_key(source.id, candidate.id) in connected:
            continue

        proximity = compute_proximity(source, candidate, options)
        applicable = proximity["applicable"]
        any_signal = any(
            applicable[dimension] and proximity[dimension] > 0
            for dimension in ("linguistic", "temporal", "spatial")
        )
        if not any_signal:
            continue

        confidence = combined_confidence(proximity, weights)
        if confidence < min_confidence:
            continue

        relationship_type = suggest_relationship_type(source, candidate, proximity)
        rationale = build_rationale(proximity)

        time_start = source.time_start
        if time_start is None:
            time_start = candidate.time_start
        time_end = source.time_end
        if time_end is None:
            time_end = candidate.time_end

        suggestions.append(
            {
                "sourceId": source.id,
                "sourceName": source.name,
                "targetId": candidate.id,
                "targetName": candidate.name,
                "targetType": candidate.entity_type,
                "relationshipType": relationship_type,
                "relationshipToken": token_for(relationship_type),
                "confidence": confidence,
                "proximity": proximity,
                "rationale": rationale,
                "edge": {
                    "sourceId": source.id,
                    "sourceName": source.name,
                    "targetId": candidate.id,
                    "targetName": candidate.name,
                    "relationshipType": relationship_type,
                    "timeStart": time_start,
                    "timeEnd": time_end,
                    "confidence": confidence,
                    "evidenceTypes": [entry["kind"] for entry in rationale],
                    "description": "; ".join(entry["detail"] for entry in rationale),
                },
            }
        )

    suggestions.sort(
        key=lambda entry: (-entry["confidence"], locale_key(entry["targetName"]))
    )
    # `Array.slice`, not a Python slice: a negative `?limit=` counts back
    # from the end rather than emptying the list.
    return list(js_slice(suggestions, 0.0, float(limit)))


__all__ = [
    "DEFAULT_LIMIT",
    "DEFAULT_MAX_DISTANCE_KM",
    "DEFAULT_MIN_CONFIDENCE",
    "DEFAULT_WEIGHTS",
    "MAX_SUGGESTION_CONFIDENCE",
    "SuggestionEntity",
    "build_rationale",
    "combined_confidence",
    "compute_proximity",
    "haversine_km",
    "regions_match",
    "suggest_relationship_type",
    "suggest_relationships",
]
