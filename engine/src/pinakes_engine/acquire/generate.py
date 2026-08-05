"""Model-generated acquisition — the last of the three TypeScript mechanisms.

Two thirds of ``server/services/*-scraper.ts`` never scraped anything. Eighteen
of the twenty-seven files retired by pinakes:70 — battles, cuisines, music
traditions, religions, art traditions, architectural styles, kinship systems,
settlements, sound changes, trade goods, contact events, under-represented
vocabulary, and the five ``*-enrichment.ts`` services — asked Gemini for rows in
a fixed JSON schema and appended them to a lexicon TSV. Each carried its own
``GoogleGenerativeAI`` client, its own retry-less call, and its own copy of the
same rules block ("kebab-case ids", "negative years for BCE", "do not duplicate
these", "cover Africa, Asia, the Americas and Oceania, not just Europe").

That is one mechanism with eighteen configurations, and ``batch-enrichment.ts``
had already noticed: its ``buildEnrichmentPrompt`` / ``buildResponseSchema`` pair
derived both the prompt and the response schema from *the target file's own
header row*. This adapter is that generalisation, made the only copy:

* the **schema is derived from ``columns``** — one required string property per
  target column, exactly as ``buildResponseSchema(headers)`` built it;
* the **rules are shared** (:data:`SHARED_RULES`), so a fix to how dates or
  coordinates are asked for lands in every domain at once;
* the **domain-specific part is data** — ``instruction`` plus any number of
  ``prompt.<key>`` passes. Those passes are what the bespoke files actually
  contributed: ``battle-scraper.ts``'s four eras, ``sound-change-scraper.ts``'s
  per-family briefs. They are coverage, so they came across verbatim; the
  boilerplate around them did not.

Two things follow from living in ``acquire/`` rather than in a route:

* **The model is reached over REST through the shared
  :class:`~pinakes_engine.acquire.http.HttpClient`**, like every other adapter
  here — so a ``429`` from the model is retried with backoff instead of read as
  an empty batch, and the key rides in an ``x-goog-api-key`` header rather than
  in a query string that every hop logs. (``POST`` is deliberately *not* cached;
  see :meth:`~pinakes_engine.acquire.http.HttpClient.post`.)
* **Generated rows are :class:`RawRecord`\\ s like any other**, so they carry
  provenance, land in the same normalization path, and are stamped at the
  :data:`DEFAULT_GENERATED_CONFIDENCE` prior — a model-generated fact has no
  external anchor on its value, which is precisely what the rubric's
  ``inferred`` class describes. The TypeScript wrote them straight into
  ``data/source/lexicons/*.tsv`` at no stated confidence at all.
"""

from __future__ import annotations

import csv
import json
import os
from collections.abc import Callable, Iterator, Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from pinakes_engine.acquire.adapters import SourceAdapter
from pinakes_engine.acquire.categories import CategorySpec
from pinakes_engine.acquire.http import HttpClient
from pinakes_engine.acquire.records import Provenance, RawRecord
from pinakes_engine.confidence import confidence_for

#: Prefix marking a ``source.params`` key as one generation pass.
PROMPT_PREFIX = "prompt."

#: Environment variables the live generator reads, matching the TypeScript's.
MODEL_ENV = "GEMINI_MODEL"
API_KEY_ENV = "GEMINI_API_KEY"

#: Model used when ``$GEMINI_MODEL`` is unset — the TypeScript's default.
DEFAULT_MODEL = "gemini-3-pro-preview"

#: REST base for ``generateContent``. The SDK has no Python counterpart worth
#: taking a dependency on for one call, and REST is what the ingest layer
#: already speaks (``services/api/src/pinakes/ingest/text_extractor.py``).
GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models"

#: Provenance source name stamped when ``source.params.source`` is unset.
DEFAULT_SOURCE = "llm-generated"

#: Entries requested per pass — ``BATCH_SIZE`` in the TypeScript.
DEFAULT_BATCH_SIZE = 25

#: A generated fact is derived with no external anchor on its value. That is the
#: rubric's ``inferred`` class, and naming it here is what keeps every generated
#: row down-weighted in one place rather than in eighteen.
DEFAULT_GENERATED_CONFIDENCE = confidence_for("inferred")

#: The rules block every one of the retired services spelled out for itself.
#: It is prompt text, so it is NOT rewrapped — a reflowed rule is a different
#: prompt, and two of its lines are over the line limit for that reason.
SHARED_RULES = """\
RULES:
- Generate exactly {count} new, unique entries that DO NOT overlap with existing ones
- Each entry must be historically/culturally accurate
- Use kebab-case IDs (e.g., "greek-classical", "persian-miniature")
- For JSON array fields, use proper JSON arrays like ["item1","item2"]
- For coordinate fields, use JSON objects like {{"lat":35.0,"lng":139.0}}
- For null values, use the string "null"
- For date fields (time_origin, origin_date, etc.), use integer years (negative for BCE)
- Focus on diverse global coverage - include entries from Africa, Asia, Americas, Oceania, not just Europe
- For language ID references, use ISO 639-2/3 codes or slugified names matching our languages.tsv format"""  # noqa: E501 - the prompt is a contract; rewrapping it changes it


class LlmGenerationError(RuntimeError):
    """Raised when a generation pass is misconfigured or the model fails."""


def _utc_now() -> datetime:
    return datetime.now(UTC)


class Generator(Protocol):
    """The single model operation this adapter depends on.

    The test seam: a fixture-backed generator returns recorded entries and the
    whole adapter runs with no key, no network and no model.
    """

    def generate(
        self, prompt: str, columns: Sequence[str]
    ) -> Sequence[Mapping[str, Any]]:
        """Return the entries the model produced for *prompt*."""
        ...


class LlmGenerationAdapter(SourceAdapter):
    """Generate rows for a domain from a model, as :class:`RawRecord`\\ s.

    Args:
        http: Shared rate-limited, retrying client. Used only when *generator*
            is not supplied — that is what makes this adapter's default path the
            polite one.
        generator: Model boundary; defaults to :class:`GeminiGenerator` over
            *http*.
        now: Clock returning a UTC timestamp for ``provenance.retrieved_at``
            (injectable for deterministic tests).
    """

    name = "llm-generate"
    source_type = "http"

    def __init__(
        self,
        http: HttpClient,
        *,
        generator: Generator | None = None,
        now: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._generator = generator if generator is not None else GeminiGenerator(http)
        self._now = now

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        """Yield one record per distinct entry across every generation pass."""
        params = category_spec.source.params
        columns = _columns(params, category_spec.id)
        id_column = params.get("id_column") or columns[0]
        if id_column not in columns:
            raise LlmGenerationError(
                f"category {category_spec.id!r}: id_column {id_column!r} is not "
                f"one of columns ({', '.join(columns)})"
            )
        domain = params.get("domain") or category_spec.id.replace("-", " ")
        count = _int_param(params, "batch_size", DEFAULT_BATCH_SIZE)
        batches = max(1, _int_param(params, "batches", 1))
        passes = _passes(params)
        known = _existing_ids(params.get("existing"), id_column)

        source_name = params.get("source") or DEFAULT_SOURCE
        license_ = params.get("license")
        confidence = _confidence(params)
        retrieved_at = self._now().isoformat()
        source_url = params.get("source_url") or _model_uri()

        for label, brief in passes:
            for batch in range(batches):
                prompt = build_prompt(
                    domain=domain,
                    columns=columns,
                    count=count,
                    instruction=params.get("instruction", ""),
                    brief=brief,
                    known=sorted(known),
                    batch=batch + 1,
                )
                for entry in self._generator.generate(prompt, columns):
                    row = _row(entry, columns)
                    identity = row.get(id_column, "")
                    if not identity or identity in known:
                        continue
                    known.add(identity)
                    yield RawRecord(
                        fields=row,
                        provenance=Provenance(
                            source=source_name,
                            source_url=source_url,
                            source_query=f"{category_spec.id}:{label}",
                            retrieved_at=retrieved_at,
                            confidence=confidence,
                            license=license_,
                        ),
                    )


def build_prompt(
    *,
    domain: str,
    columns: Sequence[str],
    count: int,
    instruction: str,
    brief: str,
    known: Sequence[str],
    batch: int,
) -> str:
    """Assemble one pass's prompt.

    The skeleton is ``batch-enrichment.ts``'s ``buildEnrichmentPrompt``: the
    domain, the target columns, what already exists, then the shared rules. What
    a bespoke scraper contributed rides in *instruction* (always) and *brief*
    (this pass only) — those are the two places domain knowledge is allowed to
    live, and nothing else about the prompt varies by domain.
    """
    sections = [
        "You are a historical and cultural research assistant. Generate "
        f"{count} NEW entries for a dataset about \"{domain}\".",
        "TSV COLUMN FORMAT (tab-separated):\n" + "\t".join(columns),
    ]
    if instruction.strip():
        sections.append(instruction.strip())
    if brief.strip():
        sections.append(brief.strip())
    if known:
        sections.append(
            "EXISTING IDS (do NOT reuse):\n" + ", ".join(known)
        )
    sections.append(SHARED_RULES.format(count=count))
    sections.append(
        f"This is batch {batch}, so pick entries that would make the dataset "
        "more comprehensive."
    )
    return "\n\n".join(sections)


def response_schema(columns: Sequence[str]) -> dict[str, Any]:
    """The ``responseSchema`` for *columns* — one required string per column.

    ``buildResponseSchema(headers)``, spelled in the REST API's upper-case type
    names rather than the SDK's ``SchemaType`` enum.
    """
    return {
        "type": "OBJECT",
        "properties": {
            "entries": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        column: {"type": "STRING"} for column in columns
                    },
                    "required": list(columns),
                },
            }
        },
        "required": ["entries"],
    }


class GeminiGenerator:
    """The real model, over REST, through the engine's polite client."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def generate(
        self, prompt: str, columns: Sequence[str]
    ) -> Sequence[Mapping[str, Any]]:
        """Ask the model for entries, and return the ones it answered with."""
        key = (os.environ.get(API_KEY_ENV) or "").strip()
        if not key:
            raise LlmGenerationError(
                f"{API_KEY_ENV} environment variable is required for "
                "model-generated acquisition"
            )
        body = json.dumps(
            {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseSchema": response_schema(columns),
                },
            }
        )
        response = self._http.post(
            _model_uri(), body=body, headers={"x-goog-api-key": key}
        )
        if response.status_code >= 400:
            raise LlmGenerationError(
                f"the generation model returned {response.status_code}"
            )
        try:
            payload = json.loads(response.text)
        except json.JSONDecodeError as exc:
            raise LlmGenerationError(
                "the generation model did not return JSON"
            ) from exc
        return _entries(payload)


def load_model_name() -> str:
    """``$GEMINI_MODEL`` else the default. Read per call, as Express read it."""
    return os.environ.get(MODEL_ENV) or DEFAULT_MODEL


def _model_uri() -> str:
    return f"{GEMINI_ENDPOINT}/{load_model_name()}:generateContent"


def _entries(payload: Any) -> Sequence[Mapping[str, Any]]:
    """Dig the ``entries`` array out of the candidate envelope.

    A model that answered with no candidate, or with something that is not the
    JSON it was told to return, is a failure — the TypeScript pushed that onto
    an ``errors[]`` and continued with an empty batch, which is how a domain
    could silently acquire nothing and still report success.
    """
    candidates = payload.get("candidates") if isinstance(payload, dict) else None
    if not isinstance(candidates, list) or not candidates:
        raise LlmGenerationError("the generation model returned no candidate")
    content = candidates[0].get("content") if isinstance(candidates[0], dict) else None
    parts = content.get("parts") if isinstance(content, dict) else None
    if not isinstance(parts, list) or not parts:
        raise LlmGenerationError("the generation model returned an empty candidate")
    text = parts[0].get("text") if isinstance(parts[0], dict) else None
    if not isinstance(text, str):
        raise LlmGenerationError("the generation model returned no text part")
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise LlmGenerationError(
            "the generation model's candidate is not valid JSON"
        ) from exc
    entries = parsed.get("entries") if isinstance(parsed, dict) else None
    if not isinstance(entries, list):
        raise LlmGenerationError(
            "the generation model's answer carries no 'entries' array"
        )
    return [entry for entry in entries if isinstance(entry, dict)]


def _row(entry: Mapping[str, Any], columns: Sequence[str]) -> dict[str, str]:
    """Project one generated entry onto the target columns, as strings."""
    row: dict[str, str] = {}
    for column in columns:
        value = entry.get(column)
        if value is None or value == "":
            continue
        if isinstance(value, str):
            row[column] = value
        elif isinstance(value, bool):
            row[column] = "true" if value else "false"
        elif isinstance(value, (int, float)):
            row[column] = str(value)
        else:
            row[column] = json.dumps(value, ensure_ascii=False, sort_keys=True)
    return row


def _columns(params: Mapping[str, str], category_id: str) -> tuple[str, ...]:
    raw = params.get("columns", "")
    columns = tuple(part.strip() for part in raw.split(",") if part.strip())
    if not columns:
        raise LlmGenerationError(
            f"category {category_id!r} declares no 'columns' for the model to "
            "fill; they are the target schema and the response schema both"
        )
    return columns


def _passes(params: Mapping[str, str]) -> tuple[tuple[str, str], ...]:
    """The ``prompt.<key>`` passes in key order, else one unbriefed pass."""
    passes = tuple(
        (key[len(PROMPT_PREFIX) :].strip(), value)
        for key, value in sorted(params.items())
        if key.startswith(PROMPT_PREFIX) and key[len(PROMPT_PREFIX) :].strip()
    )
    return passes or (("all", ""),)


def _existing_ids(path: str | None, id_column: str) -> set[str]:
    """Ids already in the corpus, so a pass is told not to regenerate them.

    A missing file is an empty set: a domain being acquired for the first time
    has nothing to avoid, and failing here would make bootstrapping impossible.
    """
    if not path:
        return set()
    file = Path(path)
    if not file.exists():
        return set()
    try:
        text = file.read_text(encoding="utf-8")
    except OSError as exc:
        raise LlmGenerationError(f"cannot read existing rows {file}: {exc}") from exc
    reader = csv.DictReader(text.splitlines(), delimiter="\t")
    if reader.fieldnames is None or id_column not in reader.fieldnames:
        return set()
    return {row[id_column] for row in reader if row.get(id_column)}


def _confidence(params: Mapping[str, str]) -> float:
    raw = params.get("confidence")
    if raw is None:
        return DEFAULT_GENERATED_CONFIDENCE
    try:
        return float(raw)
    except ValueError as exc:
        raise LlmGenerationError(
            f"source.params.confidence must be a number, got {raw!r}"
        ) from exc


def _int_param(params: Mapping[str, str], key: str, default: int) -> int:
    raw = params.get(key)
    if raw is None:
        return default
    try:
        return int(float(raw))
    except ValueError as exc:
        raise LlmGenerationError(
            f"source.params.{key} must be an integer, got {raw!r}"
        ) from exc
