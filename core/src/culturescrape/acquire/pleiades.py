"""Pleiades places dump adapter.

`Pleiades <https://pleiades.stoa.org/>`_ is the open gazetteer of the ancient
world and the proven model for the cross-domain network this project builds: its
places already carry coordinates and dense cross-links to Wikidata, Nomisma,
EDH, and MANTO. Pleiades publishes its whole gazetteer as bulk JSON and CSV
exports under `CC-BY <https://creativecommons.org/licenses/by/3.0/>`_.

This adapter reads such an export *from local disk* and emits one
:class:`~culturescrape.acquire.records.RawRecord` per place — its id, name,
latitude/longitude, and the URIs it connects to — stamped with provenance naming
``pleiades``, the place URI, and the licence string. The format is taken from
``source.params['format']`` when given, otherwise inferred from the file
extension.
"""

from __future__ import annotations

import csv
import json
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from culturescrape.acquire.adapters import SourceAdapter
from culturescrape.acquire.categories import CategorySpec
from culturescrape.acquire.records import Provenance, RawRecord
from culturescrape.confidence import confidence_for

#: Base URI under which a Pleiades place id resolves.
PLEIADES_PLACE_URI = "https://pleiades.stoa.org/places/"

#: The licence Pleiades publishes its data under.
PLEIADES_LICENSE = "CC-BY 3.0"


class PleiadesDumpError(RuntimeError):
    """Raised when a Pleiades dump is missing or cannot be parsed."""


def _utc_now() -> datetime:
    return datetime.now(UTC)


class PleiadesDumpAdapter(SourceAdapter):
    """Read a local Pleiades JSON/CSV export and yield place records.

    The dump path comes from ``source.query`` (falling back to
    ``source.params['path']``). Optional ``source.params`` keys:

    * ``format`` — ``json`` or ``csv``; inferred from the file extension when
      omitted;
    * ``license`` — overrides the stamped licence (default
      :data:`PLEIADES_LICENSE`).

    Args:
        confidence: Provenance confidence stamped on every record.
        now: Clock returning a UTC timestamp for ``provenance.retrieved_at``
            (injectable for deterministic tests).
    """

    name = "pleiades-dump"
    source_type = "dump"

    def __init__(
        self,
        *,
        confidence: float = confidence_for("qid-anchored"),
        now: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._confidence = confidence
        self._now = now

    def fetch(self, category_spec: CategorySpec) -> Iterator[RawRecord]:
        """Yield one record per place in the Pleiades dump."""
        params = category_spec.source.params
        raw_path = (category_spec.source.query or params.get("path") or "").strip()
        if not raw_path:
            raise PleiadesDumpError(
                f"category {category_spec.id!r} has no dump path "
                "(source.query or source.params.path) to read"
            )
        path = Path(raw_path)
        fmt = (params.get("format") or path.suffix.lstrip(".")).lower()
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as exc:
            raise PleiadesDumpError(
                f"cannot read Pleiades dump {path}: {exc}"
            ) from exc
        if fmt == "json":
            places = _places_from_json(text)
        elif fmt == "csv":
            places = _places_from_csv(text)
        else:
            raise PleiadesDumpError(
                f"unsupported Pleiades dump format {fmt!r}; expected json or csv"
            )
        license_ = params.get("license") or PLEIADES_LICENSE
        retrieved_at = self._now().isoformat()
        return self._iter_records(places, license_, retrieved_at)

    def _iter_records(
        self,
        places: Iterator[_Place],
        license_: str,
        retrieved_at: str,
    ) -> Iterator[RawRecord]:
        for place in places:
            fields = {"id": place.id, "uri": place.uri, "name": place.name}
            if place.lat is not None:
                fields["lat"] = place.lat
            if place.lon is not None:
                fields["lon"] = place.lon
            if place.cross_links:
                fields["cross_links"] = ";".join(place.cross_links)
            provenance = Provenance(
                source="pleiades",
                source_url=place.uri,
                source_query=place.uri,
                retrieved_at=retrieved_at,
                confidence=self._confidence,
                license=license_,
            )
            yield RawRecord(fields=fields, provenance=provenance)


class _Place:
    """A normalized Pleiades place extracted from either dump format."""

    __slots__ = ("id", "name", "lat", "lon", "cross_links")

    def __init__(
        self,
        *,
        id: str,
        name: str,
        lat: str | None,
        lon: str | None,
        cross_links: list[str],
    ) -> None:
        self.id = id
        self.name = name
        self.lat = lat
        self.lon = lon
        self.cross_links = cross_links

    @property
    def uri(self) -> str:
        return f"{PLEIADES_PLACE_URI}{self.id}"


def _places_from_json(text: str) -> Iterator[_Place]:
    try:
        payload: Any = json.loads(text)
    except json.JSONDecodeError as exc:
        raise PleiadesDumpError(
            f"Pleiades dump is not valid JSON: {exc}"
        ) from exc
    # Accept the canonical ``{"@graph": [...]}`` wrapper, a bare list, or a
    # single place object.
    if isinstance(payload, dict) and "@graph" in payload:
        entries = payload["@graph"]
    elif isinstance(payload, list):
        entries = payload
    else:
        entries = [payload]
    for entry in entries:
        if not isinstance(entry, dict):
            raise PleiadesDumpError(
                f"Pleiades place must be an object, got {type(entry).__name__}"
            )
        yield _place_from_json_entry(entry)


def _place_from_json_entry(entry: dict[str, Any]) -> _Place:
    place_id = _require_id(entry.get("id"))
    name = str(entry.get("title") or entry.get("name") or "")
    lat, lon = _coords_from_json(entry)
    return _Place(
        id=place_id,
        name=name,
        lat=lat,
        lon=lon,
        cross_links=_cross_links_from_json(entry),
    )


def _coords_from_json(entry: dict[str, Any]) -> tuple[str | None, str | None]:
    # Pleiades records a representative point as [lon, lat]; some exports also
    # carry explicit reprLat/reprLong fields.
    point = entry.get("reprPoint")
    if isinstance(point, list) and len(point) == 2:
        return _str_or_none(point[1]), _str_or_none(point[0])
    return _str_or_none(entry.get("reprLat")), _str_or_none(entry.get("reprLong"))


def _cross_links_from_json(entry: dict[str, Any]) -> list[str]:
    links: list[str] = []
    connections = entry.get("connections")
    if isinstance(connections, list):
        for connection in connections:
            if isinstance(connection, dict):
                target = connection.get("connectsTo") or connection.get("id")
                if target:
                    links.append(str(target))
    references = entry.get("references")
    if isinstance(references, list):
        for reference in references:
            if isinstance(reference, dict):
                target = reference.get("accessURI") or reference.get("identifier")
                if target:
                    links.append(str(target))
    return links


def _places_from_csv(text: str) -> Iterator[_Place]:
    reader = csv.DictReader(text.splitlines())
    if reader.fieldnames is None or "id" not in reader.fieldnames:
        raise PleiadesDumpError("Pleiades CSV dump has no 'id' column")
    for row in reader:
        place_id = _require_id(row.get("id"))
        name = (row.get("title") or row.get("name") or "").strip()
        raw_links = (row.get("connectsWith") or "").strip()
        links = [link.strip() for link in raw_links.split(",") if link.strip()]
        yield _Place(
            id=place_id,
            name=name,
            lat=_str_or_none(row.get("reprLat")),
            lon=_str_or_none(row.get("reprLong")),
            cross_links=links,
        )


def _require_id(value: Any) -> str:
    """Return *value* as a non-empty place id string, else raise."""
    text = "" if value is None else str(value).strip()
    if not text:
        raise PleiadesDumpError("Pleiades place is missing an 'id'")
    # A place id may arrive as a full URI; keep only the trailing local id.
    return text.rstrip("/").rsplit("/", 1)[-1]


def _str_or_none(value: Any) -> str | None:
    """Stringify *value*, returning ``None`` for missing/blank coordinates."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None
