"""Generic tabular / JSON dump adapter for ingesting existing datasets.

The Getty and Pleiades adapters are bound to one dataset's shape each. This
adapter is the reusable counterpart: it ingests *any* local delimited (TSV/CSV)
or JSON file by renaming its columns onto the canonical field names the
normalizer recognizes (``docs/data-model.md``), so folding a third-party dataset
into the corpus is a category-spec exercise rather than new adapter code.

Configuration lives entirely in ``source`` (see ``docs/acquisition.md``). The
dump path comes from ``source.query`` (or ``source.params.path``); the rest is
``source.params``:

* ``adapter`` — ``tabular-dump`` (disambiguates the shared ``dump`` source type);
* ``format`` — ``tsv`` / ``csv`` / ``json`` / ``jsonl``; inferred from the file
  extension when omitted;
* ``delimiter`` — overrides the column delimiter for the delimited formats;
* ``field.<canonical>`` — renames a source column onto a canonical field, e.g.
  ``field.name: title`` or ``field.wikidata_qid: qid``. Unmapped columns are kept
  under their own name (the normalizer preserves them in its overflow column, so
  nothing is dropped);
* ``id_column`` / ``url_template`` — a source column holding a stable row id and
  a ``{id}`` template that builds each record's ``source_url``;
* ``source`` — the provenance source name (default :data:`DEFAULT_SOURCE`);
* ``license`` / ``confidence`` — stamped onto every record's provenance.
"""

from __future__ import annotations

import csv
import json
from collections.abc import Callable, Iterator, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pinakes_engine.acquire.adapters import SourceAdapter
from pinakes_engine.acquire.categories import CategorySpec
from pinakes_engine.acquire.records import Provenance, RawRecord

#: Prefix marking a column-rename param (``field.<canonical>: <source-column>``).
FIELD_PREFIX = "field."

#: Provenance source name stamped when ``source.params.source`` is unset.
DEFAULT_SOURCE = "dump"

#: Delimited formats and their default column delimiter.
_DELIMITERS = {"tsv": "\t", "csv": ","}


class TabularDumpError(RuntimeError):
    """Raised when a tabular dump is missing, malformed, or misconfigured."""


def _utc_now() -> datetime:
    return datetime.now(UTC)


class TabularDumpAdapter(SourceAdapter):
    """Read a local delimited/JSON dump and yield one record per row.

    Args:
        now: Clock returning a UTC timestamp for ``provenance.retrieved_at``
            (injectable for deterministic tests).
    """

    name = "tabular-dump"
    source_type = "dump"

    def __init__(self, *, now: Callable[[], datetime] = _utc_now) -> None:
        self._now = now

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        """Yield one :class:`RawRecord` per row of the configured dump."""
        params = category_spec.source.params
        raw_path = (category_spec.source.query or params.get("path") or "").strip()
        if not raw_path:
            raise TabularDumpError(
                f"category {category_spec.id!r} has no dump path "
                "(source.query or source.params.path) to read"
            )
        path = Path(raw_path)
        fmt = (params.get("format") or path.suffix.lstrip(".")).lower()
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as exc:
            raise TabularDumpError(f"cannot read dump {path}: {exc}") from exc

        rename = _rename_map(params)
        targets = frozenset(rename.values())
        source_name = params.get("source") or DEFAULT_SOURCE
        license_ = params.get("license")
        confidence = _confidence(params)
        id_column = params.get("id_column")
        url_template = params.get("url_template")
        retrieved_at = self._now().isoformat()

        return self._iter_records(
            _read_rows(text, fmt, params.get("delimiter")),
            rename=rename,
            targets=targets,
            source_name=source_name,
            source_query=raw_path,
            license_=license_,
            confidence=confidence,
            id_column=id_column,
            url_template=url_template,
            retrieved_at=retrieved_at,
        )

    def _iter_records(
        self,
        rows: Iterator[dict[str, str]],
        *,
        rename: Mapping[str, str],
        targets: frozenset[str],
        source_name: str,
        source_query: str,
        license_: str | None,
        confidence: float,
        id_column: str | None,
        url_template: str | None,
        retrieved_at: str,
    ) -> Iterator[RawRecord]:
        for row in rows:
            fields = _map_columns(row, rename, targets)
            if not fields:
                continue
            row_id = row.get(id_column) if id_column else None
            provenance = Provenance(
                source=source_name,
                source_url=_source_url(row_id, url_template, source_query),
                source_query=source_query,
                retrieved_at=retrieved_at,
                confidence=confidence,
                license=license_,
            )
            yield RawRecord(fields=fields, provenance=provenance)


def _rename_map(params: Mapping[str, str]) -> dict[str, str]:
    """Build ``{source-column: canonical}`` from ``field.<canonical>`` params."""
    rename: dict[str, str] = {}
    for key, value in params.items():
        if key.startswith(FIELD_PREFIX):
            canonical = key[len(FIELD_PREFIX) :].strip()
            source_column = value.strip()
            if canonical and source_column:
                rename[source_column] = canonical
    return rename


def _map_columns(
    row: Mapping[str, str], rename: Mapping[str, str], targets: frozenset[str]
) -> dict[str, str]:
    """Rename mapped columns; keep the rest unless they collide with a target."""
    fields: dict[str, str] = {}
    for column, value in row.items():
        if value is None or value == "":
            continue
        if column in rename:
            fields[rename[column]] = value
        elif column not in targets:
            fields[column] = value
    return fields


def _source_url(
    row_id: str | None, url_template: str | None, fallback: str
) -> str:
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
        raise TabularDumpError(
            f"source.params.confidence must be a number, got {raw!r}"
        ) from exc


def _read_rows(
    text: str, fmt: str, delimiter: str | None
) -> Iterator[dict[str, str]]:
    if fmt in _DELIMITERS:
        return _delimited_rows(text, delimiter or _DELIMITERS[fmt])
    if fmt in ("json", "jsonl"):
        return _json_rows(text, fmt)
    raise TabularDumpError(
        f"unsupported dump format {fmt!r}; expected one of "
        "tsv, csv, json, jsonl"
    )


def _delimited_rows(text: str, delimiter: str) -> Iterator[dict[str, str]]:
    reader = csv.DictReader(text.splitlines(), delimiter=delimiter)
    if reader.fieldnames is None:
        raise TabularDumpError("dump has no header row")
    for row in reader:
        yield {
            key: (value or "")
            for key, value in row.items()
            if key is not None
        }


def _json_rows(text: str, fmt: str) -> Iterator[dict[str, str]]:
    entries = _json_entries(text, fmt)
    for entry in entries:
        if not isinstance(entry, dict):
            raise TabularDumpError(
                f"each JSON record must be an object, got {type(entry).__name__}"
            )
        yield {str(key): _stringify(value) for key, value in entry.items()}


def _json_entries(text: str, fmt: str) -> Iterator[Any]:
    if fmt == "jsonl":
        for number, line in enumerate(text.splitlines(), start=1):
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError as exc:
                raise TabularDumpError(
                    f"line {number} is not valid JSON: {exc}"
                ) from exc
        return
    try:
        payload: Any = json.loads(text)
    except json.JSONDecodeError as exc:
        raise TabularDumpError(f"dump is not valid JSON: {exc}") from exc
    if isinstance(payload, list):
        yield from payload
    else:
        yield payload


def _stringify(value: Any) -> str:
    """Render a JSON scalar as text; serialize nested structures losslessly."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (str, int, float)):
        return str(value)
    return json.dumps(value, ensure_ascii=False, sort_keys=True)
