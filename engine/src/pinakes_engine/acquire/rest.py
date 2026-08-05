"""Generic JSON REST source adapter — the unified replacement for the
hand-written per-API scrapers.

Before pinakes:70 the repository had two acquisition stacks. This side had
:class:`~pinakes_engine.acquire.wikidata.WikidataSparqlAdapter` and friends; the
other was ~14k lines of ``server/services/*-scraper.ts``, and every one of those
files re-implemented the same four things — an endpoint, a pagination loop, a
``setTimeout`` "rate limit", and a record→row field mapping — with its own
``node-fetch`` call and no cache. Glottolog spaced its requests 300 ms apart,
Seshat not at all, Commons on a `continue` token; none of them retried a 429 and
none of them remembered a response between runs.

The mapping is the only part of that which was ever domain-specific. So this
adapter keeps the mapping **declarative** (``source.params``) and takes the other
three from the shared :class:`~pinakes_engine.acquire.http.HttpClient`, which is
rate-limited per host, retries ``429``/``5xx`` with backoff, identifies itself,
and caches every ``GET`` on disk. One client is shared across a whole run, so
politeness holds across concurrent workers (``orchestrate/``) rather than per
scraper.

Configuration lives entirely in ``source`` (see ``docs/acquisition.md``):

* ``adapter`` — ``rest-api`` (disambiguates the shared ``http`` source type);
* ``url`` — the endpoint (falls back to ``source.query``);
* ``query.<name>`` — a query-string parameter sent on every request;
* ``records`` — dotted path to the array of records inside the payload; omit it
  when the payload *is* the array;
* ``field.<canonical>`` — a dotted path **within one record** whose value becomes
  the canonical field ``<canonical>``. A path segment that is an integer indexes
  a list; a trailing ``[]`` joins a list of scalars with ``;`` (the multi-value
  encoding ``schema/mapper.py`` already understands);
* ``id_field`` / ``url_template`` — a path holding the record's stable id and a
  ``{id}`` template building its ``source_url``;
* ``page_param`` / ``page_size_param`` / ``page_size`` / ``start_page`` /
  ``max_pages`` — offset-style pagination;
* ``next_path`` — dotted path to the cursor a paged API hands back. On its own
  the value is read as the **next page's URL** (Open Context's ``next-json``);
  with ``next_param`` it is read as an opaque **token** fed back as that query
  parameter instead (MediaWiki's ``continue.cmcontinue`` → ``cmcontinue``).
  Either way it takes precedence over the page parameters;
* ``source`` / ``license`` / ``confidence`` — stamped on every record's provenance.

Records that map to no fields at all are skipped rather than emitted empty —
the same rule :class:`~pinakes_engine.acquire.tabular.TabularDumpAdapter` uses.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

from pinakes_engine.acquire.adapters import SourceAdapter
from pinakes_engine.acquire.categories import CategorySpec
from pinakes_engine.acquire.http import HttpClient
from pinakes_engine.acquire.records import Provenance, RawRecord
from pinakes_engine.confidence import confidence_for

#: Prefix marking a ``source.params`` key as a per-field extraction path.
FIELD_PREFIX = "field."

#: Prefix marking a ``source.params`` key as a query-string parameter.
QUERY_PREFIX = "query."

#: Suffix on a field path asking for *every* value of a list, ``;``-joined.
MULTI_SUFFIX = "[]"

#: Separator for the multi-value encoding ``schema/mapper.py`` reads back.
MULTI_SEPARATOR = ";"

#: Provenance source name stamped when ``source.params.source`` is unset.
DEFAULT_SOURCE = "rest"

#: Default confidence for a REST row. ``referenced-wikidata``-grade sources are
#: the exception here, not the rule: these are catalogue APIs whose values are
#: curated by a project but carry no per-value anchor, which is what
#: ``exact-reconciled`` describes. A category that knows better overrides it.
DEFAULT_REST_CONFIDENCE = confidence_for("exact-reconciled")

#: Pages fetched before an unpaginated misconfiguration is treated as a runaway.
DEFAULT_MAX_PAGES = 20


class RestApiError(RuntimeError):
    """Raised when a REST acquisition is misconfigured or the endpoint fails."""


def _utc_now() -> datetime:
    return datetime.now(UTC)


class RestApiAdapter(SourceAdapter):
    """Fetch a JSON REST endpoint and yield one record per mapped entry.

    Args:
        http: Shared cached, rate-limited client. Every request goes through it.
        now: Clock returning a UTC timestamp for ``provenance.retrieved_at``
            (injectable for deterministic tests).
    """

    name = "rest-api"
    source_type = "http"

    def __init__(
        self, http: HttpClient, *, now: Callable[[], datetime] = _utc_now
    ) -> None:
        self._http = http
        self._now = now

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        """Yield one :class:`RawRecord` per entry the endpoint returns."""
        params = category_spec.source.params
        url = (category_spec.source.query or params.get("url") or "").strip()
        if not url:
            raise RestApiError(
                f"category {category_spec.id!r} has no endpoint "
                "(source.query or source.params.url) to fetch"
            )
        field_paths = _prefixed(params, FIELD_PREFIX)
        if not field_paths:
            raise RestApiError(
                f"category {category_spec.id!r} declares no 'field.<name>' "
                "paths to extract"
            )
        return self._iter_records(url, params, field_paths)

    def _iter_records(
        self,
        url: str,
        params: Mapping[str, str],
        field_paths: Mapping[str, str],
    ) -> Iterator[RawRecord]:
        query = dict(_prefixed(params, QUERY_PREFIX))
        records_path = params.get("records", "")
        next_path = params.get("next_path", "")
        next_param = params.get("next_param")
        id_field = params.get("id_field")
        url_template = params.get("url_template")
        source_name = params.get("source") or DEFAULT_SOURCE
        license_ = params.get("license")
        confidence = _confidence(params)
        retrieved_at = self._now().isoformat()

        page_param = params.get("page_param")
        page = _int_param(params, "start_page", 0)
        page_size = _int_param(params, "page_size", 0)
        page_size_param = params.get("page_size_param")
        max_pages = _int_param(params, "max_pages", DEFAULT_MAX_PAGES)

        next_url: str | None = url
        cursor: str | None = None
        offset = page
        seen: set[tuple[str, str, int]] = set()
        for _ in range(max(1, max_pages)):
            if next_url is None:
                return
            step = (next_url, cursor or "", offset)
            if step in seen:
                # A cursor that points back at a page already read is a real API
                # bug; returning is better than spinning until max_pages.
                return
            seen.add(step)
            request_query = dict(query)
            if page_param and cursor is None:
                request_query[page_param] = str(offset)
            if page_size_param and page_size:
                request_query[page_size_param] = str(page_size)
            if next_param and cursor:
                request_query[next_param] = cursor
            payload = self._get_json(next_url, request_query)
            entries = _entries(payload, records_path, next_url)
            emitted = 0
            for entry in entries:
                record = _to_record(
                    entry,
                    field_paths=field_paths,
                    id_field=id_field,
                    url_template=url_template,
                    source_name=source_name,
                    source_query=url,
                    license_=license_,
                    confidence=confidence,
                    retrieved_at=retrieved_at,
                    fallback_url=next_url,
                )
                if record is not None:
                    emitted += 1
                    yield record
            following = _text_at(payload, next_path) if next_path else None
            if following:
                if next_param:
                    cursor = following
                else:
                    next_url = following
                continue
            if page_param and emitted:
                next_url = url
                cursor = None
                offset += 1
                continue
            return

    def _get_json(self, url: str, query: Mapping[str, str]) -> Any:
        response = self._http.get(url, query or None)
        if response.status_code >= 400:
            raise RestApiError(
                f"fetching {url} failed with status {response.status_code}"
            )
        try:
            return json.loads(response.text)
        except json.JSONDecodeError as exc:
            raise RestApiError(f"{url} did not return JSON: {exc}") from exc


def _to_record(
    entry: Any,
    *,
    field_paths: Mapping[str, str],
    id_field: str | None,
    url_template: str | None,
    source_name: str,
    source_query: str,
    license_: str | None,
    confidence: float,
    retrieved_at: str,
    fallback_url: str,
) -> RawRecord | None:
    fields: dict[str, str] = {}
    for canonical, path in field_paths.items():
        value = _text_at(entry, path)
        if value:
            fields[canonical] = value
    if not fields:
        return None
    row_id = _text_at(entry, id_field) if id_field else None
    provenance = Provenance(
        source=source_name,
        source_url=_source_url(row_id, url_template, fallback_url),
        source_query=source_query,
        retrieved_at=retrieved_at,
        confidence=confidence,
        license=license_,
    )
    return RawRecord(fields=fields, provenance=provenance)


def _source_url(
    row_id: str | None, url_template: str | None, fallback: str
) -> str:
    if row_id:
        if url_template:
            return url_template.replace("{id}", row_id)
        return row_id
    return fallback


def _entries(payload: Any, path: str, url: str) -> Sequence[Any]:
    """Locate the record array in *payload*, tolerating a single-object body."""
    located = _resolve(payload, path) if path else payload
    if located is None:
        return ()
    if isinstance(located, list):
        return located
    if isinstance(located, dict):
        return (located,)
    raise RestApiError(
        f"{url}: 'records' path {path!r} resolved to "
        f"{type(located).__name__}, expected an object or array"
    )


def _prefixed(params: Mapping[str, str], prefix: str) -> dict[str, str]:
    """Collect ``<prefix><name>`` params into ``{name: value}``."""
    collected: dict[str, str] = {}
    for key, value in params.items():
        if key.startswith(prefix):
            name = key[len(prefix) :].strip()
            if name and value.strip():
                collected[name] = value.strip()
    return collected


def _resolve(payload: Any, path: str) -> Any:
    """Walk a dotted *path* through nested dicts and lists.

    An integer segment indexes a list; every other segment is a mapping key.
    A path that runs off the end of the data yields ``None`` rather than
    raising — a record missing an optional field is normal, not an error.
    """
    current = payload
    for segment in path.split("."):
        if current is None:
            return None
        if isinstance(current, list):
            if not segment.lstrip("-").isdigit():
                return None
            index = int(segment)
            if -len(current) <= index < len(current):
                current = current[index]
                continue
            return None
        if isinstance(current, dict):
            current = current.get(segment)
            continue
        return None
    return current


def _text_at(payload: Any, path: str | None) -> str:
    """Resolve *path* and render the value as an acquisition field string."""
    if not path:
        return ""
    multi = path.endswith(MULTI_SUFFIX)
    value = _resolve(payload, path[: -len(MULTI_SUFFIX)] if multi else path)
    if multi:
        if not isinstance(value, list):
            return "" if value is None else _stringify(value)
        return MULTI_SEPARATOR.join(
            text for text in (_stringify(item) for item in value) if text
        )
    return _stringify(value)


def _stringify(value: Any) -> str:
    """Render a JSON value as text; serialize nested structures losslessly."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)):
        return str(value)
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _confidence(params: Mapping[str, str]) -> float:
    raw = params.get("confidence")
    if raw is None:
        return DEFAULT_REST_CONFIDENCE
    try:
        return float(raw)
    except ValueError as exc:
        raise RestApiError(
            f"source.params.confidence must be a number, got {raw!r}"
        ) from exc


def _int_param(params: Mapping[str, str], key: str, default: int) -> int:
    raw = params.get(key)
    if raw is None:
        return default
    try:
        return int(float(raw))
    except ValueError as exc:
        raise RestApiError(
            f"source.params.{key} must be an integer, got {raw!r}"
        ) from exc
