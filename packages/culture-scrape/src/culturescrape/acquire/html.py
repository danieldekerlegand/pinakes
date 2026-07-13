"""Generic HTML-scraping source adapter — the last-resort acquisition path.

Most categories are reachable through a clean structured source (Wikidata SPARQL,
PetScan, an official dump, or raw wikitext). A few are not: they exist only as
prose tables or lists on an ordinary web page that exposes no API. This adapter
covers that long tail by extracting rows from arbitrary HTML using a declarative
**CSS or XPath selector spec**.

It is deliberately marked **best-effort**: HTML layout is unstable and selectors
are brittle, so every record is stamped with a *lower* default confidence and
``source='http'`` to flag it for extra scrutiny downstream.

The page is fetched through the shared
:class:`~culturescrape.acquire.http.HttpClient` so the request is polite,
rate-limited, and cached. Before fetching, the site's ``robots.txt`` is consulted
and honoured — a disallowed URL raises rather than being scraped.

The category spec drives extraction through ``source.params``:

* ``url`` — the page to scrape (falls back to ``source.query``);
* ``selector_type`` — ``css`` (default) or ``xpath``;
* ``row_selector`` — selects the element of each row to emit one record from;
* ``field.<name>`` — one entry per field, a selector evaluated *within* each row
  whose matched text becomes the value of ``<name>``.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping
from datetime import UTC, datetime
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

from lxml import html as lxml_html
from lxml.html import HtmlElement

from culturescrape.acquire.adapters import SourceAdapter
from culturescrape.acquire.categories import CategorySpec
from culturescrape.acquire.http import HttpClient
from culturescrape.acquire.records import Provenance, RawRecord
from culturescrape.confidence import confidence_for

#: Prefix marking a ``source.params`` key as a per-field selector.
FIELD_PREFIX = "field."

#: Default confidence for scraped rows — low, because HTML scraping is brittle.
#: The ``scraped-html`` rubric prior (0.5); tuned in one place (US-001).
DEFAULT_HTML_CONFIDENCE = confidence_for("scraped-html")

_VALID_SELECTOR_TYPES = frozenset({"css", "xpath"})


class HtmlScrapeError(RuntimeError):
    """Raised when a scrape is misconfigured, disallowed, or fails to fetch."""


def _utc_now() -> datetime:
    return datetime.now(UTC)


class HtmlScrapeAdapter(SourceAdapter):
    """Extract rows from a non-wiki HTML page via a CSS/XPath selector spec.

    This is the pluggable last-resort adapter named in ``PLAN.md``: use it only
    when no structured source covers a category. Records carry a low default
    confidence and ``source='http'`` so the normalization stage can treat them
    with appropriate suspicion.

    Args:
        http: Shared cached HTTP client used to fetch ``robots.txt`` and the page.
        confidence: Provenance confidence stamped on every record; defaults to
            the deliberately low :data:`DEFAULT_HTML_CONFIDENCE`.
        now: Clock returning a UTC timestamp for ``provenance.retrieved_at``
            (injectable for deterministic tests).
    """

    name = "html-scrape"
    source_type = "http"

    def __init__(
        self,
        http: HttpClient,
        *,
        confidence: float = DEFAULT_HTML_CONFIDENCE,
        now: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._http = http
        self._confidence = confidence
        self._now = now

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        """Yield one record per matched row of the scraped page."""
        params = category_spec.source.params
        url = (category_spec.source.query or params.get("url") or "").strip()
        if not url:
            raise HtmlScrapeError(
                f"category {category_spec.id!r} has no page URL "
                "(source.query or source.params.url) to scrape"
            )
        selector_type = (params.get("selector_type") or "css").strip().lower()
        if selector_type not in _VALID_SELECTOR_TYPES:
            raise HtmlScrapeError(
                f"unsupported selector_type {selector_type!r}; "
                f"expected one of: {', '.join(sorted(_VALID_SELECTOR_TYPES))}"
            )
        row_selector = (params.get("row_selector") or "").strip()
        if not row_selector:
            raise HtmlScrapeError(
                f"category {category_spec.id!r} has no 'row_selector' to "
                "locate rows"
            )
        field_selectors = _field_selectors(params)
        if not field_selectors:
            raise HtmlScrapeError(
                f"category {category_spec.id!r} declares no 'field.<name>' "
                "selectors to extract"
            )

        self._ensure_allowed(url)
        document = self._fetch_document(url)
        provenance = Provenance(
            source="http",
            source_url=url,
            source_query=row_selector,
            retrieved_at=self._now().isoformat(),
            confidence=self._confidence,
        )
        return self._iter_records(
            document, selector_type, row_selector, field_selectors, provenance
        )

    def _ensure_allowed(self, url: str) -> None:
        """Raise unless *url* is permitted by the site's ``robots.txt``."""
        parts = urlsplit(url)
        robots_url = f"{parts.scheme}://{parts.netloc}/robots.txt"
        parser = RobotFileParser()
        response = self._http.get(robots_url)
        if response.status_code >= 400:
            # By convention a 4xx (e.g. no robots.txt) allows everything, while
            # a server error means we must not assume permission.
            if response.status_code < 500:
                parser.parse([])
            else:
                parser.parse(["User-agent: *", "Disallow: /"])
        else:
            parser.parse(response.text.splitlines())
        if not parser.can_fetch(self._http.user_agent, url):
            raise HtmlScrapeError(f"robots.txt disallows fetching {url}")

    def _fetch_document(self, url: str) -> HtmlElement:
        response = self._http.get(url)
        if response.status_code >= 400:
            raise HtmlScrapeError(
                f"fetching {url} failed with status {response.status_code}"
            )
        if not response.text.strip():
            raise HtmlScrapeError(f"fetching {url} returned an empty body")
        return lxml_html.fromstring(response.text)

    def _iter_records(
        self,
        document: HtmlElement,
        selector_type: str,
        row_selector: str,
        field_selectors: Mapping[str, str],
        provenance: Provenance,
    ) -> Iterator[RawRecord]:
        for row in _select(document, row_selector, selector_type):
            if not isinstance(row, HtmlElement):
                continue  # row selectors must resolve to elements, not text
            fields: dict[str, str] = {}
            for name, selector in field_selectors.items():
                matches = _select(row, selector, selector_type)
                if matches:
                    fields[name] = _text(matches[0])
            if fields:
                yield RawRecord(fields=fields, provenance=provenance)


def _field_selectors(params: Mapping[str, str]) -> dict[str, str]:
    """Collect ``field.<name>`` params into ``{name: selector}``."""
    selectors: dict[str, str] = {}
    for key, value in params.items():
        if key.startswith(FIELD_PREFIX):
            name = key[len(FIELD_PREFIX) :].strip()
            if name and value.strip():
                selectors[name] = value.strip()
    return selectors


def _select(node: HtmlElement, selector: str, selector_type: str) -> list[object]:
    """Evaluate *selector* against *node*, returning matched nodes or strings."""
    try:
        if selector_type == "css":
            return list(node.cssselect(selector))
        result = node.xpath(selector)
    except Exception as exc:  # lxml raises a variety of selector errors
        raise HtmlScrapeError(f"invalid selector {selector!r}: {exc}") from exc
    if isinstance(result, list):
        return list(result)
    return [result]


def _text(node: object) -> str:
    """Extract stripped text from a matched element or string result."""
    if isinstance(node, str):  # xpath ``text()``/``@attr`` yields str subclasses
        return node.strip()
    if isinstance(node, HtmlElement):
        return str(node.text_content()).strip()
    return str(node).strip()
