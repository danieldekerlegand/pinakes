"""In-memory representation of an acquired row plus its provenance.

These types are the uniform hand-off between acquisition adapters and the
normalization stage: a :class:`RawRecord` carries the source's raw string
fields alongside the :class:`Provenance` describing where they came from.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True)
class Provenance:
    """Where a single acquired row came from.

    Attributes:
        source: Adapter id (e.g. ``wikidata``, ``petscan``, ``getty_aat``).
        source_url: Canonical URL/URI of the record.
        source_query: The SPARQL/PetScan spec or page that produced the row.
        retrieved_at: ISO-8601 UTC timestamp of retrieval.
        confidence: Extraction/resolution confidence in ``[0, 1]``.
        license: The record's distribution licence (e.g. ``ODC-By 1.0``),
            stored so attribution requirements travel with the data; ``None``
            when the source imposes none.
    """

    source: str
    source_url: str
    source_query: str
    retrieved_at: str
    confidence: float
    license: str | None = None

    def __post_init__(self) -> None:
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError(
                f"confidence must be in [0, 1], got {self.confidence!r}"
            )
        _parse_iso_utc(self.retrieved_at)


@dataclass
class RawRecord:
    """A raw acquired row: source string fields plus its provenance."""

    fields: dict[str, str]
    provenance: Provenance


def _parse_iso_utc(value: str) -> datetime:
    """Validate that *value* is an ISO-8601 UTC timestamp.

    Returns the parsed, UTC-aware :class:`~datetime.datetime`. Raises
    :class:`ValueError` if the string is not ISO-8601 or is not UTC.
    """
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(
            f"retrieved_at must be an ISO-8601 timestamp, got {value!r}"
        ) from exc
    if parsed.utcoffset() != timedelta(0):
        raise ValueError(f"retrieved_at must be UTC, got {value!r}")
    return parsed
