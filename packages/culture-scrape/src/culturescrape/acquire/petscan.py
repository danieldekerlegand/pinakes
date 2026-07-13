"""PetScan source adapter.

Turns a category whose ``source.type`` is ``petscan`` into raw rows by running
its PetScan parameters against `PetScan <https://petscan.wmcloud.org/>`_, the
category-tree front-end. Categories that live as **wiki categories** (rather than
as a clean Wikidata class) become first-class here: PetScan traverses the
category tree to the requested ``depth``, combines branches by ``combination``
(``subset``/``union``/...), and can intersect the result with a WDQS ``sparql``
query in a single request.

The request goes through the shared
:class:`~culturescrape.acquire.http.HttpClient` with ``format=json`` so it is
polite, rate-limited, and cached. Each result page/item becomes one
:class:`~culturescrape.acquire.records.RawRecord` carrying its ``title``,
``pageid``, and Wikidata ``qid`` (when PetScan resolved one), stamped with
provenance pointing back at the page and the PetScan query URL.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator, Mapping
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote, urlencode

from culturescrape.acquire.adapters import SourceAdapter
from culturescrape.acquire.categories import CategorySpec
from culturescrape.acquire.http import HttpClient
from culturescrape.acquire.records import Provenance, RawRecord
from culturescrape.confidence import confidence_for

#: The PetScan endpoint.
PETSCAN_ENDPOINT = "https://petscan.wmcloud.org/"


class PetScanError(RuntimeError):
    """Raised when a PetScan request fails or returns an unparseable body."""


def _utc_now() -> datetime:
    return datetime.now(UTC)


class PetScanAdapter(SourceAdapter):
    """Run a category's PetScan parameters and yield raw rows.

    Args:
        http: Shared cached HTTP client used to reach the endpoint.
        endpoint: PetScan endpoint URL (override for testing/mirrors).
        confidence: Provenance confidence stamped on every record.
        now: Clock returning a UTC timestamp for ``provenance.retrieved_at``
            (injectable for deterministic tests).
    """

    name = "petscan"
    source_type = "petscan"

    def __init__(
        self,
        http: HttpClient,
        *,
        endpoint: str = PETSCAN_ENDPOINT,
        confidence: float = confidence_for("qid-anchored"),
        now: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._http = http
        self._endpoint = endpoint
        self._confidence = confidence
        self._now = now

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        """Yield one :class:`RawRecord` per page/item PetScan returns."""
        spec_params = category_spec.source.params
        if not spec_params.get("categories") and not spec_params.get("sparql"):
            raise PetScanError(
                f"category {category_spec.id!r} has no PetScan 'categories' "
                "or 'sparql' parameter to run"
            )
        # Pass the spec's PetScan parameters through, forcing JSON output and
        # asking PetScan to actually run the query.
        params = {**spec_params, "format": "json", "doit": "1"}
        query_url = f"{self._endpoint}?{urlencode(params)}"
        response = self._http.get(self._endpoint, params)
        if response.status_code >= 400:
            raise PetScanError(
                f"PetScan request failed with status {response.status_code}"
            )
        try:
            payload: Any = json.loads(response.text)
        except json.JSONDecodeError as exc:
            raise PetScanError(
                f"PetScan returned a non-JSON body: {exc}"
            ) from exc
        retrieved_at = self._now().isoformat()
        page_url = _page_url_builder(spec_params)
        return self._iter_records(
            _iter_pages(payload), query_url, page_url, retrieved_at
        )

    def _iter_records(
        self,
        pages: Iterator[dict[str, Any]],
        query_url: str,
        page_url: Callable[[str], str],
        retrieved_at: str,
    ) -> Iterator[RawRecord]:
        for page in pages:
            yield self._page_to_record(
                page, query_url, page_url, retrieved_at
            )

    def _page_to_record(
        self,
        page: dict[str, Any],
        query_url: str,
        page_url: Callable[[str], str],
        retrieved_at: str,
    ) -> RawRecord:
        title = str(page.get("title", ""))
        fields = {
            "title": title,
            "pageid": str(page.get("id", "")),
            "namespace": str(page.get("namespace", "")),
        }
        qid = page.get("metadata", {}).get("wikidata")
        if qid:
            fields["qid"] = str(qid)
        provenance = Provenance(
            source="petscan",
            source_url=page_url(title),
            source_query=query_url,
            retrieved_at=retrieved_at,
            confidence=self._confidence,
        )
        return RawRecord(fields=fields, provenance=provenance)


def _iter_pages(payload: Any) -> Iterator[dict[str, Any]]:
    """Yield each page dict from a PetScan ``format=json`` response.

    PetScan nests result pages under one or more ``combination`` blocks:
    ``payload["*"][i]["a"]["*"]``.
    """
    for block in payload.get("*", []):
        for page in block.get("a", {}).get("*", []):
            if isinstance(page, dict):
                yield page


def _page_url_builder(params: Mapping[str, str]) -> Callable[[str], str]:
    """Return a function mapping a page title to its wiki URL.

    Uses the spec's ``language``/``project`` PetScan params (defaulting to the
    English Wikipedia) to build ``https://<lang>.<project>.org/wiki/<title>``.
    """
    language = params.get("language") or "en"
    project = params.get("project") or "wikipedia"

    def build(title: str) -> str:
        slug = quote(title.replace(" ", "_"), safe="")
        return f"https://{language}.{project}.org/wiki/{slug}"

    return build
