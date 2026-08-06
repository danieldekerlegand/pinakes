"""Generated historical-reconstruction imagery — `services/image-generator.ts`.

`POST /api/media/generate` builds a prompt out of a scene type and an art style,
asks Gemini for an image, and appends what it asked for to a TSV ledger that
`GET /api/media/prompts` reads back. Two things carry over unchanged and one
does not:

* **The prompt text is the contract.** Every directive string, the order the
  parts are joined in, and the blank lines between them are copied verbatim —
  the ledger is a record of what was asked, and a reworded prompt makes the
  history incomparable.
* **The ledger records failures too, and it is written before the throw.** A
  model that refuses still leaves a `status: error` row, which is the only trace
  a caller has that the request happened at all. A *missing key* leaves no row,
  because that check runs before the id is minted — kept as found.
* **`urllib`, not the vendor SDK**, the same trade :mod:`pinakes.narrative.llm`
  and :mod:`pinakes.kcb.registry` make. `responseModalities` is a
  `generationConfig` field over REST exactly as it is in the SDK, and the key
  rides in an `x-goog-api-key` header rather than the query string, which every
  hop between here and the model would log.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from itertools import count
from pathlib import Path
from typing import Any, Final

#: Env vars. `GEMINI_IMAGE_MODEL` is optional; the key is not.
API_KEY_ENV: Final = "GEMINI_API_KEY"
MODEL_ENV: Final = "GEMINI_IMAGE_MODEL"
DEFAULT_MODEL: Final = "gemini-2.0-flash-exp"

#: Where `generateContent` lives. Overridable so a test can point at a stub
#: rather than monkeypatching `urllib` — same seam `narrative/llm.py` opens.
BASE_URL_ENV: Final = "GEMINI_API_BASE_URL"
DEFAULT_BASE_URL: Final = "https://generativelanguage.googleapis.com/v1beta"

#: Upstream timeout, in seconds.
TIMEOUT_S: Final = 30.0

#: The scene vocabulary `validateSceneType` admits, in its declaration order —
#: the 400 message lists them in exactly this order.
VALID_SCENE_TYPES: Final[tuple[str, ...]] = (
    "city_reconstruction",
    "architectural",
    "daily_life",
    "artifact",
)

#: The art-style vocabulary `validateStyle` admits. Same standing.
VALID_STYLES: Final[tuple[str, ...]] = (
    "realistic",
    "illustrated",
    "watercolor",
    "archaeological_sketch",
)

STYLE_DIRECTIVES: Final[dict[str, str]] = {
    "realistic": (
        "Photorealistic rendering with accurate materials, lighting, and "
        "atmospheric perspective. Museum-quality historical reconstruction."
    ),
    "illustrated": (
        "Detailed digital illustration with clean linework and rich colors. "
        "Educational illustration style suitable for a history textbook."
    ),
    "watercolor": (
        "Soft watercolor painting with gentle washes, visible brushstrokes, and "
        "muted earth tones. Fine art style reminiscent of 19th-century "
        "archaeological expedition paintings."
    ),
    "archaeological_sketch": (
        "Technical archaeological pencil sketch with cross-hatching, measurement "
        "annotations, and labeled architectural features. Scientific "
        "illustration style."
    ),
}

SCENE_DIRECTIVES: Final[dict[str, str]] = {
    "city_reconstruction": (
        "A panoramic reconstruction of an ancient city showing its architecture, "
        "streets, public spaces, walls, and surrounding landscape. Include "
        "people going about daily activities to show scale."
    ),
    "architectural": (
        "A detailed architectural reconstruction showing the structure's full "
        "form, construction materials, decorative elements, and spatial "
        "proportions. Include contextual surroundings."
    ),
    "daily_life": (
        "A scene depicting everyday life showing people in period-accurate "
        "clothing engaged in typical activities like trade, craftsmanship, "
        "cooking, or ceremonies. Show tools, vessels, and furnishings of the era."
    ),
    "artifact": (
        "A detailed close-up reconstruction of a cultural artifact shown in its "
        "original complete form, with accurate materials, colors, patterns, and "
        "decorative elements. Show the object from multiple angles or in its "
        "usage context."
    ),
}

#: The prompt ledger's file name and header, as `ensurePromptsTsv` writes them.
PROMPTS_FILE: Final = "genai-prompts.tsv"
PROMPTS_HEADER: Final = (
    "id\tentity_type\tentity_id\tprompt_text\tscene_type\tstyle\t"
    "generated_at\tstatus"
)

#: The ledger's columns, in the order `readPromptRecords` destructures them.
_PROMPT_FIELDS: Final[tuple[str, ...]] = (
    "id",
    "entityType",
    "entityId",
    "promptText",
    "sceneType",
    "style",
    "generatedAt",
    "status",
)

#: `img_<epoch-ms>_<n>`, where `n` is a module-level counter that starts at 1
#: and never resets. Two ids minted in the same millisecond differ by it.
_counter = count(1)


class ImageGenerationError(RuntimeError):
    """The model could not be reached, or returned no image."""


def validate_scene_type(value: Any) -> bool:
    """``VALID_SCENE_TYPES.includes(value)`` — strict, so a non-string is false."""
    return value in VALID_SCENE_TYPES


def validate_style(value: Any) -> bool:
    """``VALID_STYLES.includes(value)``."""
    return value in VALID_STYLES


def build_image_prompt(request: dict[str, Any]) -> str:
    """The prompt, joined with ``"\\n"``. Blank entries are the blank lines.

    `timePeriod` and `region` are pushed **only when truthy**, so a blank one is
    a missing line rather than an empty label — and that changes the prompt the
    ledger records.
    """
    parts: list[str] = [
        "Create a historical reconstruction image.",
        "",
        f"Subject: {request['description']}",
    ]
    if request.get("timePeriod"):
        parts.append(f"Time Period: {request['timePeriod']}")
    if request.get("region"):
        parts.append(f"Region: {request['region']}")
    parts.extend(
        [
            "",
            f"Scene Type: {SCENE_DIRECTIVES[request['sceneType']]}",
            "",
            f"Art Style: {STYLE_DIRECTIVES[request['style']]}",
            "",
            "Requirements:",
            "- Historically and archaeologically accurate based on current "
            "scholarly understanding",
            "- No modern elements or anachronisms",
            "- Respectful and dignified portrayal of cultures and peoples",
            "- Include environmental context appropriate to the geographic region",
        ]
    )
    return "\n".join(parts)


def generate_id() -> str:
    """``img_${Date.now()}_${++idCounter}``."""
    return f"img_{int(time.time() * 1000)}_{next(_counter)}"


def prompts_path(lexicons: Path) -> Path:
    return lexicons / PROMPTS_FILE


def escape_tsv_field(value: str) -> str:
    """Tabs and newlines become spaces; a carriage return is dropped outright.

    The prompt is multi-line by construction, so this is what makes the ledger a
    TSV at all. Note the asymmetry — ``\\r`` is deleted rather than replaced —
    which is the TypeScript's and which is why a CRLF-authored prompt collapses
    to one space per line break rather than two.
    """
    return value.replace("\t", " ").replace("\n", " ").replace("\r", "")


def append_prompt_record(lexicons: Path, record: dict[str, Any]) -> None:
    """Append one ledger row, creating the file with its header if absent."""
    path = prompts_path(lexicons)
    if not path.is_file():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(PROMPTS_HEADER + "\n", encoding="utf-8")
    line = "\t".join(
        [
            str(record["id"]),
            escape_tsv_field(str(record["entityType"])),
            escape_tsv_field(str(record["entityId"])),
            escape_tsv_field(str(record["promptText"])),
            str(record["sceneType"]),
            str(record["style"]),
            str(record["generatedAt"]),
            str(record["status"]),
        ]
    )
    with open(path, "a", encoding="utf-8", newline="") as handle:
        handle.write(line + "\n")


def read_prompt_records(lexicons: Path) -> list[dict[str, Any]]:
    """The ledger, newest last. A header-only file is an empty list.

    The reader `trim()`s the whole file and splits on ``"\\n"`` alone, so a CRLF
    ledger keeps a ``\\r`` on its last column — the same trap
    :mod:`pinakes.analytics.quality` documents, and the reason for
    ``newline=""``. A short row omits the keys it has no cell for, because
    destructuring past the end yields ``undefined`` and `JSON.stringify` drops
    those keys entirely.
    """
    path = prompts_path(lexicons)
    if not path.is_file():
        return []
    with open(path, encoding="utf-8", newline="") as handle:
        content = handle.read()
    lines = content.strip().split("\n")
    if len(lines) <= 1:
        return []
    records: list[dict[str, Any]] = []
    for line in lines[1:]:
        cells = line.split("\t")
        records.append(
            {
                field: cells[position]
                for position, field in enumerate(_PROMPT_FIELDS)
                if position < len(cells)
            }
        )
    return records


def _base_url() -> str:
    return os.environ.get(BASE_URL_ENV, "").strip().rstrip("/") or DEFAULT_BASE_URL


def _model_name() -> str:
    """``process.env.GEMINI_IMAGE_MODEL || "gemini-2.0-flash-exp"`` — truthy."""
    return os.environ.get(MODEL_ENV, "") or DEFAULT_MODEL


def _inline_image(payload: Any) -> tuple[str, str] | None:
    """The first `inlineData` part of candidate 0, as ``(data, mimeType)``."""
    candidates = payload.get("candidates") if isinstance(payload, dict) else None
    if not isinstance(candidates, list) or not candidates:
        raise ImageGenerationError("No candidates returned from image generation")
    content = candidates[0].get("content") if isinstance(candidates[0], dict) else None
    parts = content.get("parts") if isinstance(content, dict) else None
    for part in parts if isinstance(parts, list) else []:
        inline = part.get("inlineData") if isinstance(part, dict) else None
        if isinstance(inline, dict):
            data = inline.get("data")
            mime = inline.get("mimeType")
            return (
                data if isinstance(data, str) else "",
                mime if isinstance(mime, str) and mime else "image/png",
            )
    return None


def generate_reconstruction_image(
    lexicons: Path, request: dict[str, Any]
) -> dict[str, Any]:
    """Ask the model for one image, ledgering the prompt either way.

    The key check comes **first**, before the id and the prompt exist, so a
    checkout with no `$GEMINI_API_KEY` writes nothing at all — the ledger stays
    a record of requests that reached the model.
    """
    api_key = os.environ.get(API_KEY_ENV, "").strip()
    if not api_key:
        raise ImageGenerationError(
            f"{API_KEY_ENV} environment variable is required for image generation"
        )

    prompt = build_image_prompt(request)
    identifier = generate_id()
    generated_at = _iso_now()

    def ledger(status: str) -> None:
        append_prompt_record(
            lexicons,
            {
                "id": identifier,
                "entityType": request["entityType"],
                "entityId": request["entityId"],
                "promptText": prompt,
                "sceneType": request["sceneType"],
                "style": request["style"],
                "generatedAt": generated_at,
                "status": status,
            },
        )

    try:
        payload = _call_model(api_key, prompt)
        image = _inline_image(payload)
        if image is None or not image[0]:
            raise ImageGenerationError("No image data returned from generation model")
    except Exception:
        ledger("error")
        raise

    ledger("success")
    return {
        "id": identifier,
        "entityType": request["entityType"],
        "entityId": request["entityId"],
        "sceneType": request["sceneType"],
        "style": request["style"],
        "prompt": prompt,
        "imageBase64": image[0],
        "mimeType": image[1],
        "generatedAt": generated_at,
    }


def _call_model(api_key: str, prompt: str) -> Any:
    url = f"{_base_url()}/models/{_model_name()}:generateContent"
    body = json.dumps(
        {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"responseModalities": ["image", "text"]},
        }
    ).encode("utf-8")
    request = urllib.request.Request(  # noqa: S310 - a fixed https endpoint
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as error:
        raise ImageGenerationError(
            f"image generation request failed: {error}"
        ) from error


def _iso_now() -> str:
    """``new Date().toISOString()`` — UTC, milliseconds, a literal ``Z``."""
    stamp = datetime.now(UTC).isoformat(timespec="milliseconds")
    return stamp.replace("+00:00", "Z")
