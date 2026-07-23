"""Wikidata SPARQL source adapter.

Turns a category whose ``source.type`` is ``wikidata-sparql`` into raw rows by
running its ``source.query`` against the Wikidata Query Service and mapping each
result binding to a :class:`~culturescrape.acquire.records.RawRecord`. A category
like *"every Peruvian dish"* is therefore a **query**, not a scrape: the SPARQL
text is the declarative definition of the set.

The query is sent through the shared :class:`~culturescrape.acquire.http.HttpClient`
with ``format=json`` so requests are polite, rate-limited, and cached. Each
binding row becomes one record preserving the item QID and every selected
variable, stamped with provenance pointing back at the item URI and the query.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from typing import Any

from culturescrape.acquire.adapters import SourceAdapter
from culturescrape.acquire.categories import CategorySpec
from culturescrape.acquire.http import HttpClient
from culturescrape.acquire.records import Provenance, RawRecord
from culturescrape.confidence import confidence_for

#: The Wikidata Query Service SPARQL endpoint.
WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"

#: Matches a Wikidata entity id (``Q42``) at the end of an item URI.
_QID_RE = re.compile(r"(Q\d+)$")


class WikidataSparqlError(RuntimeError):
    """Raised when a SPARQL request fails or returns an unparseable body."""


def _utc_now() -> datetime:
    return datetime.now(UTC)


class WikidataSparqlAdapter(SourceAdapter):
    """Run a category's SPARQL query against Wikidata and yield raw rows.

    Args:
        http: Shared cached HTTP client used to reach the endpoint.
        endpoint: SPARQL endpoint URL (override for testing/mirrors).
        item_var: SPARQL variable holding the entity URI/QID (conventionally
            ``item``); its value becomes ``provenance.source_url`` and is mined
            for the QID.
        confidence: Provenance confidence stamped on every record.
        now: Clock returning a UTC timestamp for ``provenance.retrieved_at``
            (injectable for deterministic tests).
    """

    name = "wikidata-sparql"
    source_type = "wikidata-sparql"

    def __init__(
        self,
        http: HttpClient,
        *,
        endpoint: str = WIKIDATA_SPARQL_ENDPOINT,
        item_var: str = "item",
        confidence: float = confidence_for("qid-anchored"),
        now: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._http = http
        self._endpoint = endpoint
        self._item_var = item_var
        self._confidence = confidence
        self._now = now

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        """Yield one :class:`RawRecord` per binding of the category's query."""
        query = category_spec.source.query
        if not query or not query.strip():
            raise WikidataSparqlError(
                f"category {category_spec.id!r} has no source.query to run "
                "against Wikidata"
            )
        response = self._http.get(
            self._endpoint, {"query": query, "format": "json"}
        )
        if response.status_code >= 400:
            raise WikidataSparqlError(
                f"Wikidata SPARQL request failed with status "
                f"{response.status_code}"
            )
        try:
            payload: Any = json.loads(response.text)
        except json.JSONDecodeError as exc:
            raise WikidataSparqlError(
                f"Wikidata SPARQL returned a non-JSON body: {exc}"
            ) from exc
        bindings = payload.get("results", {}).get("bindings", [])
        retrieved_at = self._now().isoformat()
        return self._iter_records(bindings, query, retrieved_at)

    def _iter_records(
        self, bindings: list[Any], query: str, retrieved_at: str
    ) -> Iterator[RawRecord]:
        for row in bindings:
            yield self._row_to_record(row, query, retrieved_at)

    def _row_to_record(
        self, row: dict[str, Any], query: str, retrieved_at: str
    ) -> RawRecord:
        # Preserve every selected (bound) variable as a string field.
        fields = {var: cell["value"] for var, cell in row.items()}
        item_cell = row.get(self._item_var)
        item_uri = item_cell["value"] if item_cell else ""
        qid = _extract_qid(item_uri)
        if qid is not None:
            fields["qid"] = qid
        provenance = Provenance(
            source="wikidata",
            source_url=item_uri,
            source_query=query,
            retrieved_at=retrieved_at,
            confidence=self._confidence,
        )
        return RawRecord(fields=fields, provenance=provenance)


def fetch_count(
    http: HttpClient,
    query: str,
    *,
    endpoint: str = WIKIDATA_SPARQL_ENDPOINT,
    count_var: str = "count",
) -> int:
    """Run a SPARQL ``COUNT`` *query* and return the single integer it yields.

    Used by ``culturescrape generate --verify`` to record each class's live
    entity count and to refuse a class that resolves to no rows. Returns ``0``
    when the query yields no binding — the shape a class id that does not exist
    produces — so callers can treat "zero entities" and "does not exist" alike.

    Raises:
        WikidataSparqlError: If the request fails or the body is unparseable.
    """
    response = http.get(endpoint, {"query": query, "format": "json"})
    if response.status_code >= 400:
        raise WikidataSparqlError(
            f"Wikidata SPARQL request failed with status {response.status_code}"
        )
    try:
        payload: Any = json.loads(response.text)
    except json.JSONDecodeError as exc:
        raise WikidataSparqlError(
            f"Wikidata SPARQL returned a non-JSON body: {exc}"
        ) from exc
    bindings = payload.get("results", {}).get("bindings", [])
    if not bindings:
        return 0
    cell = bindings[0].get(count_var)
    if not isinstance(cell, dict) or "value" not in cell:
        return 0
    try:
        return int(cell["value"])
    except (TypeError, ValueError) as exc:
        raise WikidataSparqlError(
            f"Wikidata SPARQL COUNT returned a non-integer value: {cell!r}"
        ) from exc


def _extract_qid(uri: str) -> str | None:
    """Return the trailing Wikidata QID in *uri*, or ``None`` if absent."""
    match = _QID_RE.search(uri)
    return match.group(1) if match else None
