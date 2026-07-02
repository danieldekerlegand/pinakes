"""Map a :class:`RawRecord` to a canonical node row.

Acquisition adapters all hand back the same shape — a :class:`RawRecord` of
heterogeneous source string fields plus its :class:`Provenance` — but each
source names its fields however it pleases. This module is the single bridge
from that shape to the canonical node schema (``docs/data-model.md``): it

* mints the deterministic ``csid`` (QID-anchored when a Wikidata id is present,
  otherwise name-anchored) and stamps the ``:LABEL`` from the category spec;
* carries the recognised source fields into their canonical columns, cleaning
  every value's text and *resolving* the dimension columns it can — temporal
  strings into ``time_start`` / ``time_end`` years, coordinates into validated
  ``lat`` / ``lon``;
* copies provenance onto every row so no fact travels without a source; and
* preserves any unrecognised raw field in a single JSON :data:`OVERFLOW_KEY`
  cell rather than dropping it, so nothing is silently lost.

The result is a :class:`~culturescrape.schema.tsvio.Row` ready for
:func:`~culturescrape.schema.tsvio.write_rows` under :func:`node_schema`.
"""

from __future__ import annotations

import json
from collections.abc import Iterable

from culturescrape.acquire.categories import CategorySpec
from culturescrape.acquire.records import RawRecord
from culturescrape.schema.headers import NodeSchema, PropertyColumn
from culturescrape.schema.ids import IdError, mint_csid
from culturescrape.schema.normalize import (
    normalize_fields,
    parse_lat_lon,
    parse_point,
    parse_temporal,
)
from culturescrape.schema.tsvio import MULTI_DELIMITER, Row

#: Column that holds, as a JSON object, every raw field with no canonical home.
OVERFLOW_KEY = "extra"

#: Canonical scalar columns copied straight from a (renamed) source field.
#: Typed and derived columns (csid, :LABEL, lat/lon, time_*, provenance) are
#: handled explicitly and are deliberately absent here.
_DIRECT_SCALARS = frozenset(
    {
        "name",
        "lang",
        "wikidata_qid",
        "getty_id",
        "description",
        "period",
        "place_qid",
        "tgn_id",
        "pleiades_id",
        "language_code",
        "script",
        "etymology",
        "derived_from_csid",
    }
)

#: Reference fields the ontology linkers read off a node to infer edges — a
#: genetic ancestor / influence (``docs/sources-genetic.md``) or a linguistic
#: parent / etymon (``docs/sources-linguistic.md``) named by QID or code. They
#: are not schema columns (so they do not persist to TSV), but carrying a
#: recognised source field straight onto the node — instead of burying it in
#: :data:`OVERFLOW_KEY` — lets richer acquisition feed the linkers directly.
_DIMENSION_REFS = frozenset(
    {
        "derived_from_qid",
        "influenced_by_qid",
        "variant_of_qid",
        "parent_qid",
        "parent_code",
        "etymon_qid",
        "derivation_mode",
    }
)


class MapperError(ValueError):
    """Raised when a :class:`RawRecord` cannot be mapped to a node row."""


def node_schema() -> NodeSchema:
    """The canonical node header plus the :data:`OVERFLOW_KEY` column."""
    base = NodeSchema.canonical()
    return NodeSchema((*base.columns, PropertyColumn(OVERFLOW_KEY)))


def map_record(record: RawRecord, category: CategorySpec) -> Row:
    """Map *record* to a canonical node row under *category*'s label.

    Raises:
        MapperError: If *category* declares no label, or the record has neither
            a Wikidata QID nor a name from which to mint a ``csid``.
    """
    labels = [
        seg.strip() for seg in category.label.split(MULTI_DELIMITER) if seg.strip()
    ]
    if not labels:
        raise MapperError(f"category {category.id!r} has no label")

    fields = normalize_fields(record.fields)
    consumed: set[str] = set()
    row: Row = {}

    for key in _DIRECT_SCALARS | _DIMENSION_REFS:
        if key in fields:
            row[key] = fields[key]
            consumed.add(key)

    if "aliases" in fields:
        row["aliases"] = [
            part.strip()
            for part in fields["aliases"].split(MULTI_DELIMITER)
            if part.strip()
        ]
        consumed.add("aliases")

    _resolve_temporal(fields, row, consumed)
    _resolve_geographic(fields, row, consumed)

    overflow = {key: value for key, value in fields.items() if key not in consumed}
    if overflow:
        row[OVERFLOW_KEY] = json.dumps(overflow, ensure_ascii=False, sort_keys=True)

    row[":LABEL"] = labels
    row["csid"] = _mint(
        labels[0],
        qid=_scalar(row.get("wikidata_qid")),
        name=_scalar(row.get("name")),
        lang=_scalar(row.get("lang")),
    )

    _carry_provenance(record, row)
    return row


def map_records(
    records: Iterable[RawRecord], category: CategorySpec
) -> list[Row]:
    """Map every record in *records* to a node row, preserving order."""
    return [map_record(record, category) for record in records]


def _resolve_temporal(fields: dict[str, str], row: Row, consumed: set[str]) -> None:
    """Resolve a temporal source field into the ``time_*`` columns."""
    if "time_start_iso" not in fields:
        return
    consumed.add("time_start_iso")
    span = parse_temporal(fields["time_start_iso"])
    if span.time_start is not None:
        row["time_start"] = str(span.time_start)
    if span.time_end is not None:
        row["time_end"] = str(span.time_end)
    if span.time_start_iso is not None:
        row["time_start_iso"] = span.time_start_iso


def _resolve_geographic(fields: dict[str, str], row: Row, consumed: set[str]) -> None:
    """Resolve coordinate source fields into validated ``lat`` / ``lon``."""
    if "coordinates" in fields:
        consumed.add("coordinates")
        coord = parse_point(fields["coordinates"])
    elif "lat" in fields and "lon" in fields:
        consumed.update({"lat", "lon"})
        coord = parse_lat_lon(fields["lat"], fields["lon"])
    else:
        return
    if coord is not None:
        row["lat"] = repr(coord.lat)
        row["lon"] = repr(coord.lon)


def _carry_provenance(record: RawRecord, row: Row) -> None:
    """Stamp the provenance columns onto *row*."""
    prov = record.provenance
    row["source"] = prov.source
    row["source_url"] = prov.source_url
    row["source_query"] = prov.source_query
    row["retrieved_at"] = prov.retrieved_at
    row["confidence"] = repr(prov.confidence)


def _mint(
    node_type: str, *, qid: str | None, name: str | None, lang: str | None
) -> str:
    """Mint the ``csid``, preferring a QID and falling back to the name."""
    if qid:
        try:
            return mint_csid(node_type, qid=qid)
        except IdError:
            pass  # not a well-formed QID — fall through to name-anchoring
    if name:
        return mint_csid(node_type, name=name, lang=lang)
    raise MapperError(
        "cannot mint csid: record has neither a Wikidata QID nor a name"
    )


def _scalar(value: str | list[str] | None) -> str | None:
    """Narrow a :class:`Row` cell to a scalar (the direct columns never list)."""
    return value if isinstance(value, str) else None
