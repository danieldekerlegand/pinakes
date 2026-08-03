"""kaikki.org (wiktextract) Wiktionary JSONL adapter.

kaikki.org publishes machine-parsed Wiktionary as newline-delimited JSON — one
object per word sense group — so the broad etymology / cognate / borrowing signal
Wiktionary carries becomes ingestible without the heavy wikitext parsing
``docs/sources-linguistic.md`` flagged as a research effort. This adapter reads such
a JSONL extract *from local disk* and yields one
:class:`~pinakes_engine.acquire.records.RawRecord` per entry so kaikki joins the
corpus as a first-class linguistic source.

Each entry becomes a **Wordform** node keyed by the entry's language:

* ``name`` — the head ``word``;
* ``lang`` — the entry's ``lang_code`` (a Wiktionary / ISO 639 code), which is the
  ``merge_rows`` fuzzy-block key (so forms of different languages are never compared)
  **and** the reconciler's ISO 639-3 join key;
* ``Language_Name`` — the human-readable ``lang`` (kept in the node overflow for a
  legible report);
* ``etymology_relations`` — the canonical etymology edges
  (:mod:`pinakes_engine.schema.kaikki_etymology`) extracted from the entry's
  ``etymology_templates``, serialised to a JSON cell. It is an **unmapped** field, so
  it rides into the node's ``extra`` overflow and survives the normalize → disk →
  link round-trip; the linguistic linker reads it back and emits the
  ``BORROWED_FROM`` / ``DERIVED_FROM`` / ``COGNATE_WITH`` edges. Template tokens that
  name no canonical relation are skipped here and reported by the reconcile driver —
  never coerced onto an edge type.

Every record carries the source's provenance: ``source`` (default
:data:`KAIKKI_SOURCE`), a per-record ``source_url`` built from ``url_template`` +
``id_column`` when configured, ``license`` (Wiktionary is **CC-BY-SA-3.0**, dual
GFDL — set it in ``source.params.license``), and ``confidence``.

Configuration (all under ``source.params`` unless noted):

* ``adapter`` — ``kaikki`` (disambiguates the shared ``dump`` source type);
* ``path`` — the JSONL extract, when not given as ``source.query``;
* ``word_field`` / ``lang_code_field`` / ``lang_name_field`` — override the entry
  keys read for the head word / language code / language name;
* ``id_column`` / ``url_template`` — a per-entry id key and a ``{id}`` template that
  builds each record's ``source_url``;
* ``source`` / ``license`` / ``confidence`` — stamped onto every record's provenance.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator, Mapping
from datetime import UTC, datetime
from typing import Any

from pinakes_engine.acquire.adapters import SourceAdapter
from pinakes_engine.acquire.categories import CategorySpec
from pinakes_engine.acquire.records import Provenance, RawRecord
from pinakes_engine.schema.kaikki_etymology import extract_relations, relations_cell

#: Provenance ``source`` id stamped when ``source.params.source`` is unset.
KAIKKI_SOURCE = "kaikki"

#: Node cell holding the extracted canonical etymology relations (unmapped → the
#: node's ``extra`` overflow, where the linguistic linker reads it back).
ETYMOLOGY_RELATIONS_FIELD = "etymology_relations"

#: Node overflow cell carrying the human-readable language name (for the report).
LANGUAGE_NAME_FIELD = "Language_Name"

#: Default kaikki entry keys.
_DEFAULT_WORD_FIELD = "word"
_DEFAULT_LANG_CODE_FIELD = "lang_code"
_DEFAULT_LANG_NAME_FIELD = "lang"


class KaikkiError(RuntimeError):
    """Raised when a kaikki extract is missing, malformed, or misconfigured."""


def _utc_now() -> datetime:
    return datetime.now(UTC)


class KaikkiAdapter(SourceAdapter):
    """Read a local kaikki.org JSONL extract and yield one record per entry.

    Args:
        now: Clock returning a UTC timestamp for ``provenance.retrieved_at``
            (injectable for deterministic tests).
    """

    name = "kaikki"
    source_type = "dump"

    def __init__(self, *, now: Callable[[], datetime] = _utc_now) -> None:
        self._now = now

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        """Yield one :class:`RawRecord` per entry of the configured JSONL extract."""
        params = category_spec.source.params
        raw_path = (category_spec.source.query or params.get("path") or "").strip()
        if not raw_path:
            raise KaikkiError(
                f"category {category_spec.id!r} has no extract path "
                "(source.query or source.params.path) to read"
            )
        try:
            text = _read_text(raw_path)
        except OSError as exc:
            raise KaikkiError(f"cannot read extract {raw_path}: {exc}") from exc

        return self._iter_records(
            _iter_entries(text),
            params=params,
            source_query=raw_path,
            retrieved_at=self._now().isoformat(),
        )

    def _iter_records(
        self,
        entries: Iterator[Mapping[str, Any]],
        *,
        params: Mapping[str, str],
        source_query: str,
        retrieved_at: str,
    ) -> Iterator[RawRecord]:
        word_field = params.get("word_field") or _DEFAULT_WORD_FIELD
        lang_code_field = params.get("lang_code_field") or _DEFAULT_LANG_CODE_FIELD
        lang_name_field = params.get("lang_name_field") or _DEFAULT_LANG_NAME_FIELD
        source_name = params.get("source") or KAIKKI_SOURCE
        license_ = params.get("license")
        confidence = _confidence(params)
        id_column = params.get("id_column")
        url_template = params.get("url_template")

        for entry in entries:
            word = _text(entry.get(word_field))
            if not word:
                continue
            fields: dict[str, str] = {"name": word}
            if lang_code := _text(entry.get(lang_code_field)):
                fields["lang"] = lang_code
            if lang_name := _text(entry.get(lang_name_field)):
                fields[LANGUAGE_NAME_FIELD] = lang_name
            relations = extract_relations(entry).relations
            if relations:
                fields[ETYMOLOGY_RELATIONS_FIELD] = relations_cell(relations)

            row_id = _text(entry.get(id_column)) if id_column else ""
            provenance = Provenance(
                source=source_name,
                source_url=_source_url(row_id, url_template, source_query),
                source_query=source_query,
                retrieved_at=retrieved_at,
                confidence=confidence,
                license=license_,
            )
            yield RawRecord(fields=fields, provenance=provenance)


def _read_text(path: str) -> str:
    from pathlib import Path

    return Path(path).read_text(encoding="utf-8")


def _iter_entries(text: str) -> Iterator[Mapping[str, Any]]:
    """Yield one JSON object per non-blank JSONL line (raising on malformed JSON)."""
    for number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped:
            continue
        try:
            entry = json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise KaikkiError(f"line {number} is not valid JSON: {exc}") from exc
        if not isinstance(entry, dict):
            raise KaikkiError(
                f"line {number}: each kaikki entry must be a JSON object, "
                f"got {type(entry).__name__}"
            )
        yield entry


def _text(value: Any) -> str:
    """Render a scalar entry value as a stripped string (``""`` when empty/None)."""
    if value is None:
        return ""
    return str(value).strip()


def _source_url(row_id: str, url_template: str | None, fallback: str) -> str:
    if row_id:
        if url_template:
            return url_template.replace("{id}", row_id)
        return row_id
    return fallback


def _confidence(params: Mapping[str, str]) -> float:
    raw = params.get("confidence")
    if raw is None:
        return 1.0
    try:
        return float(raw)
    except ValueError as exc:
        raise KaikkiError(
            f"source.params.confidence must be a number, got {raw!r}"
        ) from exc
