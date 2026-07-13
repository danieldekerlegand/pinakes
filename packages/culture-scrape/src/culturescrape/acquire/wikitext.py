"""Raw-wikitext source adapter.

Turns a category whose ``source.type`` is ``wikitext`` into raw rows by fetching
a page's raw wikitext via the MediaWiki API and parsing it with
`mwparserfromhell <https://mwparserfromhell.readthedocs.io/>`_. This reaches the
long tail of cultural data that lives only in prose pages — the rows of a
*"List of ..."* wikitable and the fields of an infobox — which neither a clean
Wikidata SPARQL query nor a PetScan category walk can surface.

The request goes through the shared
:class:`~culturescrape.acquire.http.HttpClient` (``action=parse&prop=wikitext``)
so it is polite, rate-limited, and cached. From the returned wikitext the adapter
emits:

* one :class:`~culturescrape.acquire.records.RawRecord` per data row of the first
  matching wikitable, keyed by the table's header columns; and
* one record per occurrence of the ``template`` named in the category spec
  (e.g. an ``Infobox food``), keyed by its parameter names.

Every record is stamped with provenance pointing back at the page URL and the
page title that produced it.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator, Mapping
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

import mwparserfromhell
from mwparserfromhell.nodes import Tag, Template
from mwparserfromhell.wikicode import Wikicode

from culturescrape.acquire.adapters import SourceAdapter
from culturescrape.acquire.categories import CategorySpec
from culturescrape.acquire.http import HttpClient
from culturescrape.acquire.records import Provenance, RawRecord
from culturescrape.confidence import confidence_for

#: Path of the MediaWiki API relative to a wiki's host.
MEDIAWIKI_API_PATH = "/w/api.php"

#: Default CSS class identifying the wikitable to extract rows from.
DEFAULT_TABLE_CLASS = "wikitable"


class WikitextError(RuntimeError):
    """Raised when a wikitext request fails or returns an unparseable body."""


def _utc_now() -> datetime:
    return datetime.now(UTC)


class WikitextAdapter(SourceAdapter):
    """Fetch a page's wikitext and yield rows from its table and infobox.

    The page title comes from ``source.query`` (falling back to
    ``source.params['page']``). Optional ``source.params`` keys:

    * ``template`` — name of the template/infobox whose parameters to extract;
    * ``table_class`` — CSS class of the wikitable to read (default
      ``wikitable``);
    * ``language`` / ``project`` — wiki to target (default English Wikipedia).

    Args:
        http: Shared cached HTTP client used to reach the MediaWiki API.
        endpoint: API endpoint URL; when ``None`` it is derived from the spec's
            ``language``/``project`` params. Override for testing/mirrors.
        confidence: Provenance confidence stamped on every record.
        now: Clock returning a UTC timestamp for ``provenance.retrieved_at``
            (injectable for deterministic tests).
    """

    name = "wikitext"
    source_type = "wikitext"

    def __init__(
        self,
        http: HttpClient,
        *,
        endpoint: str | None = None,
        confidence: float = confidence_for("qid-anchored"),
        now: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._http = http
        self._endpoint = endpoint
        self._confidence = confidence
        self._now = now

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        """Yield one record per table row and per matching template."""
        params = category_spec.source.params
        title = (category_spec.source.query or params.get("page") or "").strip()
        if not title:
            raise WikitextError(
                f"category {category_spec.id!r} has no page title "
                "(source.query or source.params.page) to fetch"
            )
        wikitext = self._fetch_wikitext(title, params)
        code = mwparserfromhell.parse(wikitext)
        retrieved_at = self._now().isoformat()
        provenance = Provenance(
            source="wikitext",
            source_url=_page_url(title, params),
            source_query=title,
            retrieved_at=retrieved_at,
            confidence=self._confidence,
        )
        return self._iter_records(code, params, provenance)

    def _fetch_wikitext(
        self, title: str, params: Mapping[str, str]
    ) -> str:
        endpoint = self._endpoint or _api_endpoint(params)
        response = self._http.get(
            endpoint,
            {
                "action": "parse",
                "page": title,
                "prop": "wikitext",
                "redirects": "1",
                "formatversion": "2",
                "format": "json",
            },
        )
        if response.status_code >= 400:
            raise WikitextError(
                f"MediaWiki API request failed with status "
                f"{response.status_code}"
            )
        try:
            payload: Any = json.loads(response.text)
        except json.JSONDecodeError as exc:
            raise WikitextError(
                f"MediaWiki API returned a non-JSON body: {exc}"
            ) from exc
        if "error" in payload:
            info = payload["error"].get("info", payload["error"])
            raise WikitextError(f"MediaWiki API error for {title!r}: {info}")
        parse = payload.get("parse")
        if not isinstance(parse, dict) or "wikitext" not in parse:
            raise WikitextError(
                f"MediaWiki API returned no wikitext for {title!r}"
            )
        wikitext = parse["wikitext"]
        # formatversion=1 wraps the text as {"*": "..."}; tolerate both.
        if isinstance(wikitext, dict):
            wikitext = wikitext.get("*", "")
        return str(wikitext)

    def _iter_records(
        self,
        code: Wikicode,
        params: Mapping[str, str],
        provenance: Provenance,
    ) -> Iterator[RawRecord]:
        table = _first_wikitable(
            code, params.get("table_class") or DEFAULT_TABLE_CLASS
        )
        if table is not None:
            for fields in _table_rows(str(table.contents)):
                yield RawRecord(fields=fields, provenance=provenance)
        template_name = (params.get("template") or "").strip()
        if template_name:
            for template in code.filter_templates():
                if str(template.name).strip() == template_name:
                    yield RawRecord(
                        fields=_template_fields(template),
                        provenance=provenance,
                    )


def _api_endpoint(params: Mapping[str, str]) -> str:
    language = params.get("language") or "en"
    project = params.get("project") or "wikipedia"
    return f"https://{language}.{project}.org{MEDIAWIKI_API_PATH}"


def _page_url(title: str, params: Mapping[str, str]) -> str:
    language = params.get("language") or "en"
    project = params.get("project") or "wikipedia"
    slug = quote(title.replace(" ", "_"), safe="")
    return f"https://{language}.{project}.org/wiki/{slug}"


def _first_wikitable(code: Wikicode, table_class: str) -> Tag | None:
    """Return the first ``table`` tag whose ``class`` contains *table_class*."""
    fallback: Tag | None = None
    for tag in code.filter_tags(matches=lambda n: n.tag == "table"):
        if fallback is None:
            fallback = tag
        class_attr = tag.get("class") if tag.has("class") else None
        if class_attr is not None and table_class in str(class_attr.value):
            return tag
    return fallback


def _template_fields(template: Template) -> dict[str, str]:
    """Map a template's named parameters to plain-text values."""
    fields: dict[str, str] = {}
    for param in template.params:
        key = str(param.name).strip()
        fields[key] = _plain_text(str(param.value))
    return fields


def _table_rows(contents: str) -> Iterator[dict[str, str]]:
    """Yield each data row of a wikitable as a header-keyed field map.

    The first row carrying header (``!``) cells supplies the column names;
    each later row becomes one mapping, with unlabelled columns keyed
    positionally as ``col0``, ``col1``, ...
    """
    rows = _split_rows(contents)
    if not rows:
        return
    header: list[str] = []
    start = 0
    if any(is_header for is_header, _ in rows[0]):
        header = [_plain_text(text) for _, text in rows[0]]
        start = 1
    for cells in rows[start:]:
        if not cells:
            continue
        fields: dict[str, str] = {}
        for index, (_, text) in enumerate(cells):
            labelled = index < len(header) and header[index]
            key = header[index] if labelled else f"col{index}"
            fields[key] = _plain_text(text)
        yield fields


def _split_rows(contents: str) -> list[list[tuple[bool, str]]]:
    """Split raw wikitable contents into rows of ``(is_header, raw_cell)``."""
    rows: list[list[tuple[bool, str]]] = []
    current: list[tuple[bool, str]] | None = None
    for raw_line in contents.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("|+"):
            continue  # blank line or table caption
        if line.startswith("|-"):
            if current is not None:
                rows.append(current)
            current = []
            continue
        if line[0] not in "!|":
            continue  # cell continuation/markup we don't split on
        if current is None:
            current = []
        is_header = line[0] == "!"
        separator = "!!" if is_header else "||"
        for token in _split_top_level(line[1:], separator):
            current.append((is_header, _strip_cell_attributes(token)))
    if current:
        rows.append(current)
    return rows


def _strip_cell_attributes(token: str) -> str:
    """Drop a leading ``attr=... |`` cell-attribute prefix, if present."""
    parts = _split_top_level(token, "|")
    if len(parts) > 1 and "=" in parts[0] and "[[" not in parts[0]:
        return "|".join(parts[1:]).strip()
    return token.strip()


def _split_top_level(text: str, separator: str) -> list[str]:
    """Split *text* on *separator*, ignoring separators inside ``[[``/``{{``."""
    parts: list[str] = []
    buffer: list[str] = []
    link_depth = 0
    template_depth = 0
    index = 0
    width = len(separator)
    while index < len(text):
        pair = text[index : index + 2]
        if pair == "[[":
            link_depth += 1
            buffer.append(pair)
            index += 2
        elif pair == "]]":
            link_depth = max(0, link_depth - 1)
            buffer.append(pair)
            index += 2
        elif pair == "{{":
            template_depth += 1
            buffer.append(pair)
            index += 2
        elif pair == "}}":
            template_depth = max(0, template_depth - 1)
            buffer.append(pair)
            index += 2
        elif (
            link_depth == 0
            and template_depth == 0
            and text[index : index + width] == separator
        ):
            parts.append("".join(buffer))
            buffer = []
            index += width
        else:
            buffer.append(text[index])
            index += 1
    parts.append("".join(buffer))
    return parts


def _plain_text(wikitext: str) -> str:
    """Render a wikitext fragment to stripped plain text."""
    return str(mwparserfromhell.parse(wikitext).strip_code()).strip()
