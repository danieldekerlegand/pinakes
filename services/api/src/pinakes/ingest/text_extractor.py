"""A pasted paragraph → reviewable entity drafts, via the extraction model.

The port of `server/services/text-extractor.ts` (pinakes:64 US-1). Everything
below the model call is pure and is the bulk of the file: normalising what the
model returned, mapping its free-text entity kind onto a queue-safe
``entityType``, scoring each draft, and attaching each relationship to the
contribution of the entity that owns it.

Two notes on the model boundary:

* **It is REST, not an SDK.** The TypeScript used `@google/generative-ai`; this
  service reaches the same endpoint through :mod:`pinakes.ingest.http`, so the
  call is rate-limited and retried like every other outbound request here, and
  no second HTTP stack enters the dependency tree. The key rides in the
  ``x-goog-api-key`` **header** — a query parameter would be logged by every hop
  in between.
* **It is injectable, and the tests never call it.** :class:`TextExtractorDeps`
  is what the route passes; the suite passes a fake reading the same recorded
  fixture the TypeScript's suite reads (`server/services/fixtures/`), which is
  what says the two implementations normalise the same payload the same way.

Nothing here writes the dataset. Every entity becomes a *pending* contribution
flagged ``aiGenerated``/``autoDerived``; promotion is a reviewer's decision
(:mod:`pinakes.contributions.ai_review`).
"""

from __future__ import annotations

import json
import math
import os
from typing import Any, Protocol, TypeGuard

from pinakes.analytics.jsmath import js_round
from pinakes.ingest import http

#: A normalised extraction, or one entity within it, as JSON.
Extraction = dict[str, Any]

#: Default model, and the environment variable that overrides it. Same names and
#: same default as the TypeScript, so both backends call the same model.
GEMINI_MODEL_ENV = "GEMINI_MODEL"
GEMINI_API_KEY_ENV = "GEMINI_API_KEY"
DEFAULT_MODEL = "gemini-3-pro-preview"
GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models"


class TextExtractionError(Exception):
    """The pasted text is empty or unusable (→ 400)."""


# ── Normalisation (pure) ─────────────────────────────────────────────────────


def clamp_confidence(value: Any, fallback: float) -> float:
    """Any number-ish value into 0..1, defaulting to *fallback*.

    ``typeof value !== "number"`` is the guard being ported, and a JavaScript
    boolean is not a number — so ``True`` falls back here rather than clamping
    to 1, which is what Python's own ``isinstance(True, int)`` would have done.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return fallback
    if not math.isfinite(value):
        return fallback
    return max(0.0, min(1.0, float(value)))


def normalize_name(name: str) -> str:
    """The key entities and relationships are matched on."""
    return name.strip().lower()


def _text(value: Any) -> str:
    """``(value ?? "").trim()`` — a non-string is not text at all."""
    return value.strip() if isinstance(value, str) else ""


def normalize_extraction(raw: Extraction) -> Extraction:
    """The model's raw payload → the draft shape the client is handed.

    Entities without a name are dropped, coordinates survive only when *both*
    halves are finite, and a year must be a finite number (truncated, so a model
    that answers ``-27.0`` still means 27 BCE). Relationships drop self-edges and
    duplicates.
    """
    entities: list[Extraction] = []
    for item in raw.get("entities") or []:
        if not isinstance(item, dict):
            continue
        name = _text(item.get("name"))
        if not name:
            continue

        name_confidence = clamp_confidence(item.get("confidence"), 0.5)
        entity: Extraction = {
            "name": {"value": name, "confidence": name_confidence},
            "rawType": _text(item.get("entityType")) or "unknown",
        }

        description = _text(item.get("description"))
        if description:
            entity["description"] = {
                "value": description,
                "confidence": clamp_confidence(
                    item.get("descriptionConfidence"), name_confidence
                ),
            }

        latitude = item.get("latitude")
        longitude = item.get("longitude")
        if _finite_number(latitude) and _finite_number(longitude):
            entity["coordinates"] = {
                "value": {"lat": latitude, "lng": longitude},
                "confidence": clamp_confidence(
                    item.get("coordinatesConfidence"), name_confidence
                ),
            }

        for source_field, target_field, confidence_field in (
            ("startYear", "timePeriodStart", "startYearConfidence"),
            ("endYear", "timePeriodEnd", "endYearConfidence"),
        ):
            year = item.get(source_field)
            if _finite_number(year):
                entity[target_field] = {
                    "value": math.trunc(year),
                    "confidence": clamp_confidence(
                        item.get(confidence_field), name_confidence
                    ),
                }

        entities.append(entity)

    relationships: list[Extraction] = []
    seen: set[str] = set()
    for item in raw.get("relationships") or []:
        if not isinstance(item, dict):
            continue
        source = _text(item.get("source"))
        target = _text(item.get("target"))
        kind = _text(item.get("type"))
        if not source or not target or not kind:
            continue
        if normalize_name(source) == normalize_name(target):
            continue  # no self edge
        key = f"{normalize_name(source)}→{normalize_name(target)}:{kind.lower()}"
        if key in seen:
            continue
        seen.add(key)
        relationships.append(
            {
                "source": source,
                "target": target,
                "type": kind,
                "confidence": clamp_confidence(item.get("confidence"), 0.5),
            }
        )

    return {
        "entities": entities,
        "relationships": relationships,
        "aiGenerated": True,
        "autoDerived": True,
    }


def _finite_number(value: Any) -> TypeGuard[float]:
    """``typeof value === "number" && Number.isFinite(value)``."""
    return (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isfinite(value)
    )


# ── Entity type resolution ───────────────────────────────────────────────────


def resolve_contribution_entity_type(raw_type: str, has_coordinates: bool) -> str:
    """The model's free-text kind → an ``entityType`` the queue can validate.

    Only types whose required fields a paragraph can actually supply are
    reachable: the name-only ones, plus ``archaeological-site`` — and that one
    only when coordinates came with it, because the queue requires them.
    ``religion`` is deliberately *not* here: it requires a ``religionType`` free
    text cannot guarantee, so a religion is filed as a civilization and a
    reviewer retypes it.
    """
    kind = raw_type.strip().lower()
    if "language" in kind or "dialect" in kind:
        return "language"
    if (
        any(
            token in kind
            for token in ("site", "settlement", "city", "ruin", "archaeolog")
        )
        and has_coordinates
    ):
        return "archaeological-site"
    if any(
        token in kind
        for token in ("figure", "person", "ruler", "king", "emperor", "leader")
    ):
        return "historical-figure"
    if any(
        token in kind for token in ("trade", "good", "commodity", "product")
    ):
        return "trade-good"
    return "civilization"


# ── Draft → contributions ────────────────────────────────────────────────────


def overall_confidence(entity: Extraction) -> int:
    """One entity's mean field confidence, on the queue's 1..100 scale.

    Accumulated in a loop, not with :func:`sum` — see
    :func:`pinakes.ingest.url_extractor.overall_confidence` for why that is not
    a style preference.
    """
    scores = [entity["name"]["confidence"]]
    for field in ("description", "coordinates", "timePeriodStart", "timePeriodEnd"):
        if field in entity:
            scores.append(entity[field]["confidence"])
    total = 0.0
    for score in scores:
        total += score
    return max(1, min(99, js_round(total / len(scores) * 100)))


def extraction_to_contributions(
    result: Extraction,
    *,
    source_text: str | None = None,
    contributor_name: str | None = None,
    contributor_email: str | None = None,
) -> list[Extraction]:
    """One queue submission per extracted entity, relationships attached.

    A relationship is carried by its **source** entity's contribution, or by its
    target's when the source is not among the extracted entities — so an edge
    the model asserted between something it named and something it did not is
    still reviewable. An edge naming neither is dropped from the submissions but
    stays in the returned extraction, which is what the client displays.
    """
    by_name = {
        normalize_name(entity["name"]["value"]): entity
        for entity in result["entities"]
    }

    owned: dict[str, list[Extraction]] = {}
    for relationship in result["relationships"]:
        source = normalize_name(relationship["source"])
        target = normalize_name(relationship["target"])
        owner = source if source in by_name else target if target in by_name else None
        if owner is None:
            continue
        owned.setdefault(owner, []).append(relationship)

    excerpt = (source_text or "").strip()[:280]

    submissions: list[Extraction] = []
    for entity in result["entities"]:
        entity_type = resolve_contribution_entity_type(
            entity["rawType"], "coordinates" in entity
        )

        per_field: dict[str, float] = {"name": entity["name"]["confidence"]}
        for field in (
            "description",
            "coordinates",
            "timePeriodStart",
            "timePeriodEnd",
        ):
            if field in entity:
                per_field[field] = entity[field]["confidence"]

        entity_data: Extraction = {
            "name": entity["name"]["value"],
            "source": "ai-extracted",
            "aiGenerated": True,
            "autoDerived": True,
            "llmEntityType": entity["rawType"],
            "relationships": owned.get(normalize_name(entity["name"]["value"]), []),
            "perFieldConfidence": per_field,
        }
        for field in (
            "description",
            "coordinates",
            "timePeriodStart",
            "timePeriodEnd",
        ):
            if field in entity:
                entity_data[field] = entity[field]["value"]

        title = (
            f'AI text extraction: "{excerpt}{"…" if len(excerpt) >= 280 else ""}"'
            if excerpt
            else "AI text extraction"
        )
        submissions.append(
            {
                "entityType": entity_type,
                "action": "add",
                "entityData": entity_data,
                "sources": [{"title": title}],
                "confidence": overall_confidence(entity),
                "contributorName": contributor_name,
                "contributorEmail": contributor_email,
                "notes": (
                    "AI-extracted draft from pasted text — review before promoting."
                ),
            }
        )
    return submissions


# ── The injectable model boundary ────────────────────────────────────────────


class TextExtractorDeps(Protocol):
    """The extraction model, behind an interface."""

    def extract(self, text: str) -> Extraction:
        """Run the model over *text* and return its raw structured JSON."""
        ...


def extract_draft_from_text(text: str, deps: TextExtractorDeps) -> Extraction:
    """Extract a structured draft from a pasted paragraph."""
    trimmed = (text or "").strip()
    if not trimmed:
        raise TextExtractionError("text is required")
    return normalize_extraction(deps.extract(trimmed))


#: The response schema the model is constrained to. The REST API spells its type
#: enum in upper case where the TypeScript SDK's `SchemaType` spelled it lower;
#: the fields, their descriptions and what is required are the same document.
RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "OBJECT",
    "properties": {
        "entities": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "name": {"type": "STRING"},
                    "entityType": {
                        "type": "STRING",
                        "description": (
                            "One of: civilization, language, archaeological-site, "
                            "historical-figure, trade-good, religion, or a short "
                            "kind label."
                        ),
                    },
                    "confidence": {
                        "type": "NUMBER",
                        "description": "0..1 confidence in the entity identity.",
                    },
                    "description": {"type": "STRING"},
                    "descriptionConfidence": {"type": "NUMBER"},
                    "latitude": {"type": "NUMBER"},
                    "longitude": {"type": "NUMBER"},
                    "coordinatesConfidence": {"type": "NUMBER"},
                    "startYear": {
                        "type": "NUMBER",
                        "description": (
                            "Start year as a signed integer; negative for BCE."
                        ),
                    },
                    "startYearConfidence": {"type": "NUMBER"},
                    "endYear": {
                        "type": "NUMBER",
                        "description": (
                            "End year as a signed integer; negative for BCE."
                        ),
                    },
                    "endYearConfidence": {"type": "NUMBER"},
                },
                "required": ["name", "entityType", "confidence"],
            },
        },
        "relationships": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "source": {"type": "STRING"},
                    "target": {"type": "STRING"},
                    "type": {"type": "STRING"},
                    "confidence": {"type": "NUMBER"},
                },
                "required": ["source", "target", "type", "confidence"],
            },
        },
    },
    "required": ["entities", "relationships"],
}


def build_extraction_prompt(text: str) -> str:
    """The extraction prompt, word for word as the TypeScript built it."""
    return f"""You are extracting structured cultural/historical data from a paragraph of text (from a paper, textbook, or article).

Extract:
- entities: named civilizations, languages, archaeological sites/settlements, historical figures, trade goods, religions, or other cultural entities. For each, give its name, a short entityType label, an optional one-sentence description, coordinates (latitude/longitude) if the text implies a location, and a start/end year if the text implies a time period (use signed integers; negative for BCE).
- relationships: directed links between two named entities that the text asserts (e.g. one language descended from another, one civilization traded with another, a site located in a region). Give source, target, and a short relationship type label.

Assign every field a confidence score from 0.0 (a guess) to 1.0 (stated explicitly in the text). Only include a coordinate or year when the text supports it. Do not invent entities or facts that are not in the text.

Return valid JSON matching the schema. If nothing of a kind is present, return an empty array.

TEXT:
\"\"\"
{text}
\"\"\""""  # noqa: E501 - the prompt is a contract; rewrapping it changes it


def load_model_name() -> str:
    """``$GEMINI_MODEL`` else the default. Read per call, as Express read it."""
    return os.environ.get(GEMINI_MODEL_ENV) or DEFAULT_MODEL


class LiveDeps:
    """The real model, over REST, through the engine's client."""

    def extract(self, text: str) -> Extraction:
        key = (os.environ.get(GEMINI_API_KEY_ENV) or "").strip()
        if not key:
            raise TextExtractionError(
                f"{GEMINI_API_KEY_ENV} environment variable is required for "
                "text extraction"
            )
        body = json.dumps(
            {
                "contents": [{"parts": [{"text": build_extraction_prompt(text)}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseSchema": RESPONSE_SCHEMA,
                },
            }
        )
        response = http.client(http.GOOGLE).post(
            f"{GEMINI_ENDPOINT}/{load_model_name()}:generateContent",
            body=body,
            headers={"x-goog-api-key": key},
        )
        if response.status_code >= 400:
            raise http.UpstreamError(
                f"the extraction model returned {response.status_code}"
            )
        payload = http.read_json(response, context="The extraction model")
        return _model_payload(payload)


def _model_payload(payload: Any) -> Extraction:
    """The model's JSON answer, dug out of the candidate envelope.

    A model that returned no candidate, or a candidate that is not the JSON it
    was told to return, is an upstream failure — the route reports 502, exactly
    as a thrown SDK error did.
    """
    candidates = payload.get("candidates") if isinstance(payload, dict) else None
    parts = None
    if isinstance(candidates, list) and candidates:
        first = candidates[0]
        content = first.get("content") if isinstance(first, dict) else None
        parts = content.get("parts") if isinstance(content, dict) else None
    text = parts[0].get("text") if isinstance(parts, list) and parts else None
    if not isinstance(text, str):
        raise http.UpstreamError("the extraction model returned no content")
    try:
        raw = json.loads(text)
    except ValueError as error:
        raise http.UpstreamError(
            "the extraction model returned content that is not JSON"
        ) from error
    entities = raw.get("entities") if isinstance(raw, dict) else None
    relationships = raw.get("relationships") if isinstance(raw, dict) else None
    return {
        "entities": entities if isinstance(entities, list) else [],
        "relationships": relationships if isinstance(relationships, list) else [],
    }


def live_deps() -> TextExtractorDeps:
    """The live boundary. A function, so the key and model are read per call."""
    return LiveDeps()


__all__ = [
    "DEFAULT_MODEL",
    "GEMINI_API_KEY_ENV",
    "GEMINI_MODEL_ENV",
    "RESPONSE_SCHEMA",
    "Extraction",
    "LiveDeps",
    "TextExtractionError",
    "TextExtractorDeps",
    "build_extraction_prompt",
    "clamp_confidence",
    "extract_draft_from_text",
    "extraction_to_contributions",
    "live_deps",
    "load_model_name",
    "normalize_extraction",
    "normalize_name",
    "overall_confidence",
    "resolve_contribution_entity_type",
]
