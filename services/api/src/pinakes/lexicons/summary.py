"""Progressive summary/detail — `server/services/entity-summary.ts`, ported.

The list endpoints answer with fully hydrated records, so a client that only
needs a name and two badge fields to render a collapsed card still pays for the
descriptions, the pantheons and the diffusion paths. This module declares the
**lightweight projection** per domain plus the pagination around it; the routes
add only "which loader, and what did the query string say".

The summary is always a strict **subset** of the detail record, always led by
`id` + `name`, so "fetch summaries, hydrate one on demand" loses nothing. A
contract field the record does not carry is *omitted*, never emitted as null —
which is what keeps the subset relation true for a domain whose rows are ragged.

Human-readable contract table: `docs/progressive-loading.md`.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any, NamedTuple

from pinakes.lexicons import storage


class SummaryContract(NamedTuple):
    """One domain's summary/detail contract."""

    detail_endpoint: str
    """Where to hydrate a single entity's full record (`:id` placeholder)."""

    fields: tuple[str, ...]
    """The lightweight fields, in display order — always led by `id`, `name`."""

    load: Callable[[Path], list[storage.Record]]
    """The corpus loader behind the domain. The routes' only storage seam."""


#: The domains with a summary contract, in declaration order — which is the
#: order `GET /api/summaries` lists them in.
#:
#: `civilizations` is deliberately absent: `getCivilizations()` answers with
#: GeoJSON features whose fields live under `.properties`, so it would need a
#: projection this contract does not model. The map bbox API is that layer's
#: read path.
SUMMARY_CONTRACTS: dict[str, SummaryContract] = {
    "languages": SummaryContract(
        "/api/languages/:id",
        ("id", "name", "nativeName", "iso639_1", "familyId", "region", "status"),
        storage.load_languages,
    ),
    "religions": SummaryContract(
        "/api/religions/:id",
        (
            "id",
            "name",
            "nativeName",
            "religionType",
            "originRegion",
            "timeOrigin",
            "timeEnd",
        ),
        storage.load_religions,
    ),
    "battles": SummaryContract(
        "/api/battles/:id",
        ("id", "name", "date", "warName", "outcome"),
        storage.load_battles,
    ),
    "culture-profiles": SummaryContract(
        "/api/culture-profiles/:id",
        (
            "id",
            "name",
            "region",
            "timePeriodStart",
            "timePeriodEnd",
            "socialOrganization",
            "subsistenceType",
            "urbanismLevel",
            "technologyLevel",
        ),
        storage.load_culture_profiles,
    ),
    "cuisines": SummaryContract(
        "/api/cuisines/:id",
        ("id", "name", "nativeName", "region", "timeOrigin", "timeEnd"),
        storage.load_cuisines,
    ),
    "trade-goods": SummaryContract(
        "/api/trade-goods/:id",
        ("id", "name", "category", "originRegion", "timePeriod"),
        storage.load_trade_goods,
    ),
    "innovations": SummaryContract(
        "/api/innovations/:id",
        ("id", "name", "category", "yearInvented", "regionOfOrigin"),
        storage.load_innovations,
    ),
}


def summary_domains() -> list[str]:
    """Every domain with a summary contract, in declaration order."""
    return list(SUMMARY_CONTRACTS)


def is_summary_domain(value: str) -> bool:
    """Does *value* name a domain with a summary contract?"""
    return value in SUMMARY_CONTRACTS


def summary_fields(domain: str) -> list[str]:
    """The summary fields for one domain (a fresh copy, safe to mutate)."""
    return list(SUMMARY_CONTRACTS[domain].fields)


def summarize_entity(domain: str, record: storage.Record) -> dict[str, Any]:
    """Project one record down to its domain summary, in contract order."""
    return {
        field: record[field]
        for field in SUMMARY_CONTRACTS[domain].fields
        if field in record
    }


class Page(NamedTuple):
    """A bounded page plus the metadata a client needs to page further."""

    items: list[Any]
    total: int
    returned: int
    offset: int
    limit: int | None


def _clamp_offset(offset: float | None, total: int) -> int:
    """``Number.isFinite`` guard, then clamp into ``[0, total]``."""
    if offset is None or not math.isfinite(offset):
        return 0
    return min(max(0, math.floor(offset)), total)


def _normalize_limit(limit: float | None) -> int | None:
    """A non-negative integer, or ``None`` for "no limit" (whole remainder)."""
    if limit is None or not math.isfinite(limit):
        return None
    return max(0, math.floor(limit))


def paginate(
    items: Sequence[Any], offset: float | None = None, limit: float | None = None
) -> Page:
    """Slice by offset/limit and report the page. Total: any input is a valid page."""
    total = len(items)
    start = _clamp_offset(offset, total)
    bound = _normalize_limit(limit)
    page = list(items[start:] if bound is None else items[start : start + bound])
    return Page(
        items=page, total=total, returned=len(page), offset=start, limit=bound
    )


def summarize_list(
    domain: str,
    records: Sequence[storage.Record],
    offset: float | None = None,
    limit: float | None = None,
) -> dict[str, Any]:
    """The whole body of `GET /api/summaries/<domain>`: paginate, then project."""
    page = paginate(records, offset, limit)
    contract = SUMMARY_CONTRACTS[domain]
    return {
        "domain": domain,
        "fields": summary_fields(domain),
        "detailEndpoint": contract.detail_endpoint,
        "summaries": [summarize_entity(domain, record) for record in page.items],
        "total": page.total,
        "returned": page.returned,
        "offset": page.offset,
        "limit": page.limit,
        "hasMore": page.offset + page.returned < page.total,
    }
