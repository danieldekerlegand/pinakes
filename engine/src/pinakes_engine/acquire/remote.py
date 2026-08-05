"""Remote delimited/JSON dataset adapter — a dump you did not download first.

:class:`~pinakes_engine.acquire.tabular.TabularDumpAdapter` ingests a CLDF table,
a UniMorph paradigm file or a CLDR JSON blob that is already on disk. A great
many of them never are: WALS and Grambank publish their CLDF straight out of a
git repository, UniMorph the same, and the TypeScript scrapers that read them
(``grammar-wals-grambank-scraper.ts``, ``verb-paradigm-scraper.ts``,
``writing-system-scraper.ts``) each opened their own ``node-fetch`` to pull the
file down, kept it nowhere, and re-downloaded it on the next run.

This adapter is that fetch, done once and politely: the bytes come through the
shared :class:`~pinakes_engine.acquire.http.HttpClient` — rate-limited per host,
retried on ``429``/``5xx``, and **cached on disk**, so the second run of a job
costs the host nothing — and are then handed to the *same* column mapping
:mod:`~pinakes_engine.acquire.tabular` uses. Whether a dataset arrived by
download or by dump is a transport detail; the ``field.<canonical>`` vocabulary,
the format inference and the provenance stamping are identical, and are imported
rather than restated.

Configuration lives entirely in ``source``:

* ``adapter`` — ``remote-tabular`` (disambiguates the shared ``http`` type);
* ``url`` — the file to download (falls back to ``source.query``);
* ``format`` — ``tsv`` / ``csv`` / ``json`` / ``jsonl``; inferred from the URL's
  path extension when omitted;
* ``records`` — for a JSON payload, a dotted path to the array (or object) of
  rows inside it; omit it when the payload *is* the rows. CLDR's
  ``scriptMetadata.json`` is the reason this exists — its rows hang off
  ``scriptMetadata``, keyed by script code;
* ``key_field`` — when ``records`` resolves to an **object**, the field to write
  each entry's key into (CLDR keys scripts by ``Latn``/``Arab``/… and the code is
  the only place the script's identity lives);
* ``columns`` — comma-separated column names for a **headerless** delimited
  file. UniMorph publishes bare ``lemma⇥form⇥features`` triples with no header
  row, and without this the reader would silently consume the first paradigm as
  the header;
* ``delimiter`` / ``field.<canonical>`` / ``id_column`` / ``url_template`` /
  ``source`` / ``license`` / ``confidence`` — exactly as in ``tabular-dump``.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator, Mapping
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

from pinakes_engine.acquire.adapters import SourceAdapter
from pinakes_engine.acquire.categories import CategorySpec
from pinakes_engine.acquire.http import HttpClient
from pinakes_engine.acquire.records import Provenance, RawRecord
from pinakes_engine.acquire.tabular import (
    confidence_param,
    map_columns,
    read_rows,
    rename_map,
    row_source_url,
)

#: Provenance source name stamped when ``source.params.source`` is unset.
DEFAULT_SOURCE = "remote"


class RemoteTabularError(RuntimeError):
    """Raised when a remote dataset is unreachable, malformed, or misconfigured."""


def _utc_now() -> datetime:
    return datetime.now(UTC)


class RemoteTabularAdapter(SourceAdapter):
    """Download a delimited/JSON dataset and yield one record per row.

    Args:
        http: Shared cached, rate-limited client. The download goes through it,
            so a repeated build is served from the cache rather than the host.
        now: Clock returning a UTC timestamp for ``provenance.retrieved_at``
            (injectable for deterministic tests).
    """

    name = "remote-tabular"
    source_type = "http"

    def __init__(
        self, http: HttpClient, *, now: Callable[[], datetime] = _utc_now
    ) -> None:
        self._http = http
        self._now = now

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        """Yield one :class:`RawRecord` per row of the downloaded dataset."""
        params = category_spec.source.params
        url = (category_spec.source.query or params.get("url") or "").strip()
        if not url:
            raise RemoteTabularError(
                f"category {category_spec.id!r} has no dataset URL "
                "(source.query or source.params.url) to download"
            )
        fmt = (params.get("format") or _extension(url)).lower()
        if not fmt:
            raise RemoteTabularError(
                f"category {category_spec.id!r}: cannot infer a format from "
                f"{url!r}; set source.params.format"
            )
        text = self._download(url)
        rows = self._rows(text, fmt, params, url)

        rename = rename_map(params)
        targets = frozenset(rename.values())
        source_name = params.get("source") or DEFAULT_SOURCE
        license_ = params.get("license")
        confidence = confidence_param(params)
        id_column = params.get("id_column")
        url_template = params.get("url_template")
        retrieved_at = self._now().isoformat()

        for row in rows:
            fields = map_columns(row, rename, targets)
            if not fields:
                continue
            row_id = row.get(id_column) if id_column else None
            yield RawRecord(
                fields=fields,
                provenance=Provenance(
                    source=source_name,
                    source_url=row_source_url(row_id, url_template, url),
                    source_query=url,
                    retrieved_at=retrieved_at,
                    confidence=confidence,
                    license=license_,
                ),
            )

    def _download(self, url: str) -> str:
        response = self._http.get(url)
        if response.status_code >= 400:
            raise RemoteTabularError(
                f"downloading {url} failed with status {response.status_code}"
            )
        if not response.text.strip():
            raise RemoteTabularError(f"downloading {url} returned an empty body")
        return response.text

    def _rows(
        self, text: str, fmt: str, params: Mapping[str, str], url: str
    ) -> Iterator[dict[str, str]]:
        """Delegate to the shared reader, after narrowing a JSON payload."""
        records_path = params.get("records", "").strip()
        if fmt == "json" and records_path:
            return _keyed_rows(text, records_path, params.get("key_field"), url)
        delimiter = params.get("delimiter")
        columns = params.get("columns", "").strip()
        if columns and fmt in ("tsv", "csv"):
            header = (delimiter or ("\t" if fmt == "tsv" else ",")).join(
                column.strip() for column in columns.split(",")
            )
            text = f"{header}\n{text}"
        return read_rows(text, fmt, delimiter)


def _keyed_rows(
    text: str, records_path: str, key_field: str | None, url: str
) -> Iterator[dict[str, str]]:
    """Yield the rows under *records_path*, lifting an object's keys if asked."""
    try:
        payload: Any = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RemoteTabularError(f"{url} is not valid JSON: {exc}") from exc
    located: Any = payload
    for segment in records_path.split("."):
        if not isinstance(located, dict):
            raise RemoteTabularError(
                f"{url}: 'records' path {records_path!r} runs through "
                f"{type(located).__name__}, which is not an object"
            )
        located = located.get(segment)
    if isinstance(located, list):
        entries: Iterator[tuple[str | None, Any]] = (
            (None, entry) for entry in located
        )
    elif isinstance(located, dict):
        entries = iter(located.items())
    else:
        raise RemoteTabularError(
            f"{url}: 'records' path {records_path!r} resolved to "
            f"{type(located).__name__}, expected an object or array"
        )
    for key, entry in entries:
        if not isinstance(entry, dict):
            raise RemoteTabularError(
                f"{url}: each record must be an object, got "
                f"{type(entry).__name__}"
            )
        row = {str(name): _stringify(value) for name, value in entry.items()}
        if key is not None and key_field:
            row[key_field] = key
        yield row


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (str, int, float)):
        return str(value)
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _extension(url: str) -> str:
    """The URL path's file extension, ``""`` when it has none."""
    path = urlsplit(url).path
    _, _, suffix = path.rpartition(".")
    return suffix if suffix and "/" not in suffix else ""
