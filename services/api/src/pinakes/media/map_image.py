"""Feature extraction from a georeferenced map image — `services/map-image-analyzer.ts`.

Ported for `POST /api/map/analyze-image` (pinakes:80 US-1, the tenth slice). A
base64 image plus its geographic bounds go to Gemini Vision; what comes back is
clamped to those bounds and its vocabularies narrowed.

* **The prompt is the contract**, corner coordinates included — they are printed
  through `toFixed(4)`, which is :func:`pinakes.analytics.jsmath.to_fixed` and
  not `format(.4f)`: the two disagree on a tie, and a bound of `1.00005` is one
  such tie.
* **`urllib`, not the vendor SDK**, the same trade :mod:`pinakes.media.images`
  and :mod:`pinakes.narrative.llm` make. The SDK's `responseSchema` is a REST
  `generationConfig` field whose type enum is spelled in upper case.
* **The key check runs first**, before the prompt is built — so on a checkout
  with no `$GEMINI_API_KEY` this route is a 500 naming the variable, whatever
  else is wrong with the request.
* **An out-of-vocabulary `type` becomes `unknown` rather than an error**, and a
  confidence outside 0..1 is clamped. A confidence that is not a number at all
  stays `NaN` through `Math.min`/`Math.max` and serialises as **null**, which is
  why :func:`_clamp_unit` returns `None` for one.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Final

from pinakes.analytics.jsmath import to_fixed

Record = dict[str, Any]

API_KEY_ENV: Final = "GEMINI_API_KEY"
MODEL_ENV: Final = "GEMINI_MODEL"
DEFAULT_MODEL: Final = "gemini-3-pro-preview"

BASE_URL_ENV: Final = "GEMINI_API_BASE_URL"
DEFAULT_BASE_URL: Final = "https://generativelanguage.googleapis.com/v1beta"

TIMEOUT_S: Final = 60.0

#: `request.featureTypes || [...]` — the default when the caller names none.
DEFAULT_FEATURE_TYPES: Final[tuple[str, ...]] = (
    "settlements",
    "boundaries",
    "routes",
    "labels",
)

SETTLEMENT_TYPES: Final[tuple[str, ...]] = (
    "city",
    "town",
    "village",
    "fort",
    "port",
    "religious",
)
BOUNDARY_TYPES: Final[tuple[str, ...]] = ("empire", "kingdom", "region", "territory")
ROUTE_TYPES: Final[tuple[str, ...]] = ("trade", "migration", "military", "pilgrimage")
LABEL_CATEGORIES: Final[tuple[str, ...]] = (
    "place",
    "region",
    "water",
    "mountain",
    "legend",
)

#: `EXTRACTION_SCHEMA`, as the REST API spells it (the SDK's `SchemaType.OBJECT`
#: is the string `"OBJECT"` on the wire).
EXTRACTION_SCHEMA: Final[Record] = {
    "type": "OBJECT",
    "properties": {
        "settlements": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "name": {"type": "STRING"},
                    "lat": {"type": "NUMBER"},
                    "lng": {"type": "NUMBER"},
                    "type": {"type": "STRING"},
                    "confidence": {"type": "NUMBER"},
                },
                "required": ["name", "lat", "lng", "type", "confidence"],
            },
        },
        "boundaries": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "name": {"type": "STRING"},
                    "coordinates": {
                        "type": "ARRAY",
                        "items": {"type": "ARRAY", "items": {"type": "NUMBER"}},
                    },
                    "type": {"type": "STRING"},
                    "confidence": {"type": "NUMBER"},
                },
                "required": ["name", "coordinates", "type", "confidence"],
            },
        },
        "routes": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "name": {"type": "STRING"},
                    "waypoints": {
                        "type": "ARRAY",
                        "items": {"type": "ARRAY", "items": {"type": "NUMBER"}},
                    },
                    "type": {"type": "STRING"},
                    "confidence": {"type": "NUMBER"},
                },
                "required": ["name", "waypoints", "type", "confidence"],
            },
        },
        "labels": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "text": {"type": "STRING"},
                    "lat": {"type": "NUMBER"},
                    "lng": {"type": "NUMBER"},
                    "category": {"type": "STRING"},
                    "confidence": {"type": "NUMBER"},
                },
                "required": ["text", "lat", "lng", "category", "confidence"],
            },
        },
        "mapDescription": {"type": "STRING"},
        "estimatedTimePeriod": {"type": "STRING"},
        "estimatedRegion": {"type": "STRING"},
    },
    "required": [
        "settlements",
        "boundaries",
        "routes",
        "labels",
        "mapDescription",
        "estimatedTimePeriod",
        "estimatedRegion",
    ],
}


class MapImageAnalysisError(RuntimeError):
    """The model could not be reached, or answered with something unreadable."""


def build_extraction_prompt(
    bounds: list[list[float]], feature_types: list[str]
) -> str:
    """The prompt, verbatim. `bounds` is `[[south, west], [north, east]]`."""
    (south, west), (north, east) = bounds[0], bounds[1]
    return (
        "You are analyzing a historical map image that has been georeferenced to "
        "the following geographic bounds:\n"
        f"- South-West corner: {to_fixed(south, 4)}°N, {to_fixed(west, 4)}°E\n"
        f"- North-East corner: {to_fixed(north, 4)}°N, {to_fixed(east, 4)}°E\n"
        "\n"
        "Extract geographic features from this map image. All coordinates you "
        "return must be within or near these bounds. Convert pixel positions to "
        "approximate lat/lng coordinates based on the map's geographic extent.\n"
        "\n"
        f"Extract the following feature types: {', '.join(feature_types)}\n"
        "\n"
        "For each feature, assign a confidence score (0.0 to 1.0) indicating how "
        "certain you are about the identification.\n"
        "\n"
        "Guidelines:\n"
        "- For settlements: identify cities, towns, villages, forts, ports, and "
        "religious sites marked on the map. Use symbols, dots, or text labels as "
        "indicators.\n"
        "- For boundaries: trace political or territorial boundaries shown as "
        "lines or color-coded regions. Return polygon coordinates as ordered "
        "points tracing the boundary.\n"
        "- For routes: identify trade routes, roads, rivers used as routes, or "
        "migration paths shown as lines. Return ordered waypoints along the "
        "route.\n"
        "- For labels: extract any text visible on the map including place names, "
        "region names, water body names, and legend text.\n"
        "- Estimate the map's time period and geographic region from visual cues "
        "(cartographic style, place names, political boundaries).\n"
        "\n"
        "Return valid JSON matching the schema. If no features of a type are "
        "found, return an empty array for that type."
    )


def _number(value: Any) -> float:
    """The value as a double, or `NaN` — `Math.min`'s view of a non-number."""
    if isinstance(value, bool) or value is None:
        return float("nan")
    if isinstance(value, (int, float)):
        return float(value)
    return float("nan")


def clamp_coordinate(
    lat: Any, lng: Any, bounds: list[list[float]]
) -> tuple[Any, Any]:
    """Pull a point back inside the bounds, with a 10% margin on the larger side.

    The margin is `Math.max((north - south) * 0.1, (east - west) * 0.1)` — one
    number for both axes, so a wide, short box gives its latitude the *longitude*
    margin. Kept as written.
    """
    (south, west), (north, east) = bounds[0], bounds[1]
    margin = max((north - south) * 0.1, (east - west) * 0.1)
    return (
        _js_max(south - margin, _js_min(north + margin, _number(lat))),
        _js_max(west - margin, _js_min(east + margin, _number(lng))),
    )


def _js_min(left: float, right: float) -> float:
    """`Math.min` — `NaN` propagates, where Python's `min` would drop it."""
    if left != left or right != right:
        return float("nan")
    return left if left < right else right


def _js_max(left: float, right: float) -> float:
    if left != left or right != right:
        return float("nan")
    return left if left > right else right


def _clamp_unit(value: Any) -> float | None:
    """`Math.max(0, Math.min(1, confidence))`; `None` where that is `NaN`."""
    clamped = _js_max(0.0, _js_min(1.0, _number(value)))
    return None if clamped != clamped else clamped


def _nullable(value: float) -> float | None:
    return None if value != value else value


def _narrow(value: Any, vocabulary: tuple[str, ...]) -> str:
    """``[…].includes(v) ? v : "unknown"`` — strict, so a non-string is unknown."""
    return value if value in vocabulary else "unknown"


def validate_and_clean_result(raw: Record, bounds: list[list[float]]) -> Record:
    """Clamp the coordinates, clamp the confidences, narrow the vocabularies.

    The four arrays are *replaced* on a shallow copy of the model's answer, so
    any other key it returned survives untouched — including the three strings
    the schema requires.
    """
    result: Record = dict(raw)

    settlements = []
    for item in raw.get("settlements") or []:
        lat, lng = clamp_coordinate(item.get("lat"), item.get("lng"), bounds)
        settlements.append(
            {
                **item,
                "lat": _nullable(lat),
                "lng": _nullable(lng),
                "confidence": _clamp_unit(item.get("confidence")),
                "type": _narrow(item.get("type"), SETTLEMENT_TYPES),
            }
        )
    result["settlements"] = settlements

    boundaries = []
    for item in raw.get("boundaries") or []:
        boundaries.append(
            {
                **item,
                "coordinates": [
                    _clamped_pair(coord, bounds)
                    for coord in (item.get("coordinates") or [])
                ],
                "confidence": _clamp_unit(item.get("confidence")),
                "type": _narrow(item.get("type"), BOUNDARY_TYPES),
            }
        )
    result["boundaries"] = boundaries

    routes = []
    for item in raw.get("routes") or []:
        routes.append(
            {
                **item,
                "waypoints": [
                    _clamped_pair(point, bounds)
                    for point in (item.get("waypoints") or [])
                ],
                "confidence": _clamp_unit(item.get("confidence")),
                "type": _narrow(item.get("type"), ROUTE_TYPES),
            }
        )
    result["routes"] = routes

    labels = []
    for item in raw.get("labels") or []:
        lat, lng = clamp_coordinate(item.get("lat"), item.get("lng"), bounds)
        labels.append(
            {
                **item,
                "lat": _nullable(lat),
                "lng": _nullable(lng),
                "confidence": _clamp_unit(item.get("confidence")),
                "category": _narrow(item.get("category"), LABEL_CATEGORIES),
            }
        )
    result["labels"] = labels

    return result


def _clamped_pair(coordinate: Any, bounds: list[list[float]]) -> list[float | None]:
    """One `[lat, lng]` of a boundary ring or a route waypoint, clamped."""
    return [_nullable(part) for part in clamp_coordinate(*_pair(coordinate), bounds)]


def _pair(coordinate: Any) -> tuple[Any, Any]:
    """``coord[0], coord[1]`` — a short pair reads as `undefined`, i.e. `NaN`."""
    if not isinstance(coordinate, list):
        return None, None
    first = coordinate[0] if len(coordinate) > 0 else None
    second = coordinate[1] if len(coordinate) > 1 else None
    return first, second


def analyze_map_image(request: Record) -> Record:
    """Ask the model, then clean what it said."""
    api_key = os.environ.get(API_KEY_ENV, "").strip()
    if not api_key:
        raise MapImageAnalysisError(
            f"{API_KEY_ENV} environment variable is required for map image analysis"
        )

    feature_types = list(request.get("featureTypes") or DEFAULT_FEATURE_TYPES)
    bounds = request["bounds"]
    prompt = build_extraction_prompt(bounds, feature_types)
    payload = _call_model(
        api_key, prompt, str(request.get("mimeType")), str(request.get("imageBase64"))
    )
    return validate_and_clean_result(_parse_response(payload), bounds)


def _base_url() -> str:
    return os.environ.get(BASE_URL_ENV, "").strip().rstrip("/") or DEFAULT_BASE_URL


def _model_name() -> str:
    """``process.env.GEMINI_MODEL || "gemini-3-pro-preview"`` — truthy."""
    return os.environ.get(MODEL_ENV, "") or DEFAULT_MODEL


def _call_model(
    api_key: str, prompt: str, mime_type: str, image_base64: str
) -> Any:
    url = f"{_base_url()}/models/{_model_name()}:generateContent"
    body = json.dumps(
        {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"text": prompt},
                        {
                            "inlineData": {
                                "mimeType": mime_type,
                                "data": image_base64,
                            }
                        },
                    ],
                }
            ],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": EXTRACTION_SCHEMA,
            },
        }
    ).encode("utf-8")
    call = urllib.request.Request(  # noqa: S310 - a fixed https endpoint
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
    )
    try:
        with urllib.request.urlopen(call, timeout=TIMEOUT_S) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as error:
        raise MapImageAnalysisError(
            f"map image analysis request failed: {error}"
        ) from error


def _parse_response(payload: Any) -> Record:
    """`JSON.parse(result.response.text())` — the first text part of candidate 0."""
    candidates = payload.get("candidates") if isinstance(payload, dict) else None
    if not isinstance(candidates, list) or not candidates:
        raise MapImageAnalysisError("No candidates returned from map image analysis")
    content = candidates[0].get("content") if isinstance(candidates[0], dict) else None
    parts = content.get("parts") if isinstance(content, dict) else None
    for part in parts if isinstance(parts, list) else []:
        text = part.get("text") if isinstance(part, dict) else None
        if isinstance(text, str):
            try:
                parsed = json.loads(text)
            except ValueError as error:
                raise MapImageAnalysisError(str(error)) from error
            if isinstance(parsed, dict):
                return parsed
            raise MapImageAnalysisError("map image analysis returned a non-object")
    raise MapImageAnalysisError("No text returned from map image analysis")
