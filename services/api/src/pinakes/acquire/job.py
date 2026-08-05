"""One acquisition run: fetch a domain, file every usable row for review.

`runAcquisitionJob` from `server/services/engine-acquisition.ts`, minus the job
store. Acquired records land in the **contribution review queue**, never as a
live TSV write — flagged ``entityData.source = "pinakes_engine-wikidata"`` and
``autoDerived: true`` (``aiGenerated: false``: this is a structured source, not
an LLM), with confidence clamped to 1..99 so it reads as needs-review.

**The progress/job-store half deliberately did not come across.** Express
returned a `jobId` immediately and streamed progress through `jobStore`
(`GET /api/scraping-jobs`) — a surface this backend does not serve yet, so a
`jobId` minted here would be one nothing can be polled about. :func:`run` is
therefore synchronous and returns the outcome itself. When
`tasks/chief/70-unify-scrapers` ports the scraping routes it should bring the job
store with it and wrap this, rather than reimplementing the fetch.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pinakes_engine.acquire.adapters import SourceAdapter
from pinakes_engine.acquire.records import RawRecord

from pinakes.acquire.catalog import AcquisitionCategory, category_spec
from pinakes.analytics.jsmath import js_round
from pinakes.contributions.store import ContributionStore, queue
from pinakes.engine import acquisition

#: `Point(<lng> <lat>)` — the WKT literal Wikidata's `wdt:P625` comes back as.
_WKT_POINT = re.compile(
    r"^\s*Point\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)\s*$", re.IGNORECASE
)


def parse_wkt_point(value: str | None) -> dict[str, float] | None:
    """``Point(lng lat)`` → ``{"lat", "lng"}``; ``None`` when unusable.

    Note the order swap: WKT is longitude-first and the corpus stores lat/lng.
    An out-of-range pair is rejected rather than clamped.
    """
    if not value:
        return None
    match = _WKT_POINT.match(value)
    if not match:
        return None
    lng = float(match.group(1))
    lat = float(match.group(2))
    if not (math.isfinite(lat) and math.isfinite(lng)):
        return None
    if lat < -90 or lat > 90 or lng < -180 or lng > 180:
        return None
    return {"lat": lat, "lng": lng}


def _contribution_confidence(confidence01: float | None) -> int:
    """Clamp a 0..1 provenance confidence to a 1..99 score (< 100 ⇒ needs review)."""
    value = (
        confidence01
        if isinstance(confidence01, (int, float)) and math.isfinite(confidence01)
        else 1.0
    )
    return int(max(1, min(99, js_round(value * 100))))


def record_to_contribution(
    record: RawRecord, category: AcquisitionCategory
) -> dict[str, Any] | None:
    """One acquired row → a submittable contribution, or ``None`` to skip it.

    Skipped when the row has no label — Wikidata's label service **echoes the
    QID** for an item with no English label, which is the case the equality check
    catches — or when a coordinate-required domain came back without one.
    """
    fields: dict[str, Any] = dict(record.fields)
    name = str(fields.get("itemLabel") or fields.get("label") or "").strip()
    if not name:
        return None

    qid = str(fields.get("qid") or "").strip()
    if qid and name == qid:
        return None

    coords = parse_wkt_point(fields.get("coord"))
    if category.require_coordinates and coords is None:
        return None

    provenance = record.provenance
    image = str(fields.get("image") or "").strip()
    entity_data: dict[str, Any] = {
        "name": name,
        "domain": category.domain,
        "wikidataClass": category.wikidata_class,
        # Provenance + review flags (mirrors the auto-derived draft shape).
        "source": "pinakes_engine-wikidata",
        "autoDerived": True,
        "aiGenerated": False,
        "sourceQuery": provenance.source_query,
        "retrievedAt": provenance.retrieved_at,
    }
    if qid:
        entity_data["wikidataQid"] = qid
    if image:
        entity_data["imageUrl"] = image
    if coords:
        entity_data["coordinates"] = coords

    source_url = (provenance.source_url or "").strip() or (
        f"https://www.wikidata.org/wiki/{qid}" if qid else None
    )
    return {
        "entityType": category.entity_type,
        "action": "add",
        "entityData": entity_data,
        "sources": [
            {
                "title": f"Wikidata{f' {qid}' if qid else ''} via pinakes-engine",
                "url": source_url,
                # `?? "CC0"` — *nullish*, so a source that declares an empty
                # licence string keeps it rather than being relabelled CC0.
                "license": "CC0" if provenance.license is None else provenance.license,
            }
        ],
        "confidence": _contribution_confidence(provenance.confidence),
        "notes": (
            f"Bulk-acquired from Wikidata ({category.label}) via pinakes-engine; "
            "awaiting review."
        ),
    }


@dataclass(frozen=True)
class AcquisitionOutcome:
    """What one run did: rows fetched, rows queued, rows skipped, and the report."""

    domain: str
    acquired: int
    queued: int
    skipped: int
    contribution_ids: tuple[str, ...]
    report: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        """The JSON shape the MCP `reconcile` tool answers with."""
        return {
            "domain": self.domain,
            "acquired": self.acquired,
            "queued": self.queued,
            "skipped": self.skipped,
            "contributionIds": list(self.contribution_ids),
            "report": self.report,
        }


def run(
    category: AcquisitionCategory,
    *,
    limit: int | None = None,
    adapter: SourceAdapter | None = None,
    contributions: ContributionStore | None = None,
    cache_dir: str | Path | None = None,
) -> AcquisitionOutcome:
    """Acquire *category* and enqueue every usable row.

    *adapter* is the test seam :mod:`pinakes.engine.acquisition` already exposes —
    pass a fixture adapter and the whole path runs with no network. A row that
    maps to nothing, or that the queue's own validation rejects, is **counted as
    skipped, never raised**: one bad row must not lose the rest of the run.
    """
    store = contributions if contributions is not None else queue()
    result = acquisition.fetch(
        category_spec(category, limit), adapter=adapter, cache_dir=cache_dir
    )

    queued: list[str] = []
    skipped = 0
    for record in result.records:
        draft = record_to_contribution(record, category)
        if draft is None:
            skipped += 1
            continue
        submitted = store.submit(draft)
        if submitted.contribution is None:
            skipped += 1
            continue
        queued.append(str(submitted.contribution["id"]))

    return AcquisitionOutcome(
        domain=category.domain,
        acquired=len(result.records),
        queued=len(queued),
        skipped=skipped,
        contribution_ids=tuple(queued),
        report=result.report.to_dict(),
    )
