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
from culturescrape.schema.headers import (
    EdgeSchema,
    NodeSchema,
    PropertyColumn,
    PropertyType,
)
from culturescrape.schema.ids import IdError, csid_type, mint_csid, normalize_type
from culturescrape.schema.normalize import (
    normalize_fields,
    normalize_text,
    parse_lat_lon,
    parse_point,
    parse_temporal,
)
from culturescrape.schema.tsvio import MULTI_DELIMITER, Row

#: Column that holds, as a JSON object, every raw field with no canonical home.
OVERFLOW_KEY = "extra"

#: Round-trip alias column: the source-local id a LinguaScrape row arrived with.
#: Retained on every LinguaScrape-origin node so the export can be traced back to
#: the exact lexicon row it came from even after its ``csid`` is (re)minted.
LINGUASCRAPE_ID_KEY = "linguascrape_id"

#: LinguaScrape export edge ``:TYPE`` token -> canonical ontology ``:TYPE``.
#:
#: LinguaScrape emits its relationships as ``SCREAMING_SNAKE`` tokens; five are
#: already registered in :mod:`culturescrape.ontology.registry` and map to
#: themselves, so a fed-in edge participates directly in cross-dimensional
#: linking. The three LinguaScrape-specific tokens fold onto the closest
#: registered canonical type so no non-canonical ``:TYPE`` ever enters the merged
#: graph:
#:
#: * ``ABSORBED_INTO`` (a culture merged into a larger one) -> ``PART_OF`` — the
#:   absorbed entity becomes a component of the absorbing whole (transitive);
#: * ``SYNCRETIZED_WITH`` (two traditions blended) -> ``VARIANT_OF`` — a symmetric
#:   equivalence between the blended forms;
#: * ``SPLIT_FROM`` (a language/lineage diverged from a common ancestor) ->
#:   ``DESCENDS_FROM`` — genealogical descent, the same canonical home
#:   LinguaScrape's ``evolved-into``/``gave-rise-to`` lineage edges already fold
#:   onto (a divergence *is* a descent event).
#:
#: Every value here is a registered canonical ``:TYPE`` (asserted by the ontology
#: tests); an edge token absent from this map is rejected by
#: :func:`map_linguascrape_edge` rather than passed through un-canonicalised.
LINGUASCRAPE_EDGE_TYPE_MAP: dict[str, str] = {
    "DESCENDS_FROM": "DESCENDS_FROM",
    "INFLUENCED_BY": "INFLUENCED_BY",
    "BORROWED_FROM": "BORROWED_FROM",
    "COGNATE_WITH": "COGNATE_WITH",
    "DERIVED_FROM": "DERIVED_FROM",
    "ABSORBED_INTO": "PART_OF",
    "SYNCRETIZED_WITH": "VARIANT_OF",
    "SPLIT_FROM": "DESCENDS_FROM",
}

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


# --- LinguaScrape export ---------------------------------------------------
#
# A LinguaScrape export (``docs/reconcile-linguascrape.md``) already ships the
# shared canonical shape: node rows carry their own ``:LABEL`` / ``csid`` and a
# ``linguascrape_id`` alias, edge rows carry ``:START_ID`` / ``:END_ID`` /
# ``:TYPE``. So mapping such a record is not the general "rename an arbitrary
# source's fields" problem :func:`map_record` solves — the label and dimension
# columns are already canonical. The two functions below take that shorter path:
# they copy the canonical columns, retain the ``linguascrape_id`` round-trip
# alias, and (re)mint the ``csid`` deterministically — QID-anchored when the row
# carries a Wikidata QID, otherwise anchored on the stable ``linguascrape_id`` so
# re-ingestion is idempotent and the id matches the one the export computed.


def linguascrape_node_schema() -> NodeSchema:
    """The canonical node header plus the ``linguascrape_id`` alias + overflow."""
    base = NodeSchema.canonical()
    return NodeSchema(
        (
            *base.columns,
            PropertyColumn(LINGUASCRAPE_ID_KEY),
            PropertyColumn(OVERFLOW_KEY),
        )
    )


def linguascrape_edge_schema() -> EdgeSchema:
    """The canonical edge header plus LinguaScrape time-range + alias columns."""
    base = EdgeSchema.canonical()
    return EdgeSchema(
        (
            *base.columns,
            PropertyColumn("time_start", PropertyType.INT),
            PropertyColumn("time_end", PropertyType.INT),
            PropertyColumn(LINGUASCRAPE_ID_KEY),
        )
    )


def map_linguascrape_record(record: RawRecord) -> Row:
    """Map one LinguaScrape export *record* to a canonical node or edge row.

    Node rows (carrying a ``:LABEL``) and edge rows (carrying a ``:TYPE``) are
    told apart by their structural column, mirroring the export's ``nodes/`` vs
    ``edges/`` split.

    Raises:
        MapperError: If the record carries neither a ``:LABEL`` nor a ``:TYPE``.
    """
    if ":TYPE" in record.fields:
        return map_linguascrape_edge(record)
    if ":LABEL" in record.fields:
        return map_linguascrape_node(record)
    raise MapperError(
        "LinguaScrape record has neither a ':LABEL' (node) nor a ':TYPE' (edge)"
    )


def map_linguascrape_records(records: Iterable[RawRecord]) -> list[Row]:
    """Map every LinguaScrape export record to a row, preserving order."""
    return [map_linguascrape_record(record) for record in records]


def map_linguascrape_node(record: RawRecord) -> Row:
    """Map a LinguaScrape export node *record* to a canonical node row.

    Raises:
        MapperError: If the record has no ``:LABEL``, or has neither a Wikidata
            QID nor a ``linguascrape_id`` from which to mint a ``csid``.
    """
    fields = normalize_fields(record.fields)
    labels = _labels(fields.get(":LABEL", ""))
    if not labels:
        raise MapperError("LinguaScrape node row has no ':LABEL'")

    consumed: set[str] = {":LABEL", "csid"}
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

    _carry_canonical_temporal(fields, row, consumed)
    _resolve_geographic(fields, row, consumed)

    alias = fields.get(LINGUASCRAPE_ID_KEY, "").strip()
    consumed.add(LINGUASCRAPE_ID_KEY)
    if alias:
        row[LINGUASCRAPE_ID_KEY] = alias

    overflow = {key: value for key, value in fields.items() if key not in consumed}
    if overflow:
        row[OVERFLOW_KEY] = json.dumps(overflow, ensure_ascii=False, sort_keys=True)

    row[":LABEL"] = labels
    row["csid"] = _mint_linguascrape(
        labels[0],
        fields.get("csid", ""),
        qid=_scalar(row.get("wikidata_qid")),
        alias=alias,
    )

    _carry_provenance(record, row)
    return row


def map_linguascrape_edge(record: RawRecord) -> Row:
    """Map a LinguaScrape export edge *record* to a canonical edge row.

    Structural endpoints and ``:TYPE`` are required; the ``:TYPE`` token is
    translated to the canonical ontology vocabulary via
    :data:`LINGUASCRAPE_EDGE_TYPE_MAP` so the edge participates in
    cross-dimensional linking, and ``weight``, the temporal range, and the
    ``linguascrape_id`` alias ride through when present. Provenance (source,
    confidence, time range) is carried off the record.

    Raises:
        MapperError: If any of ``:START_ID`` / ``:END_ID`` / ``:TYPE`` is blank,
            or the ``:TYPE`` is not a known LinguaScrape edge token.
    """
    fields = {key: normalize_text(value) for key, value in record.fields.items()}
    row: Row = {}
    for key in (":START_ID", ":END_ID", ":TYPE"):
        value = fields.get(key, "").strip()
        if not value:
            raise MapperError(f"LinguaScrape edge row is missing {key!r}")
        row[key] = _canonical_edge_type(value) if key == ":TYPE" else value

    for key in ("weight", "time_start", "time_end"):
        value = fields.get(key, "").strip()
        if value:
            row[key] = value

    alias = fields.get(LINGUASCRAPE_ID_KEY, "").strip()
    if alias:
        row[LINGUASCRAPE_ID_KEY] = alias

    _carry_edge_provenance(record, row)
    return row


def _labels(raw: str) -> list[str]:
    """Split a ``:LABEL`` cell into its non-empty ``;``-separated labels."""
    return [seg.strip() for seg in raw.split(MULTI_DELIMITER) if seg.strip()]


def _carry_canonical_temporal(
    fields: dict[str, str], row: Row, consumed: set[str]
) -> None:
    """Copy LinguaScrape's already-canonical ``time_*`` columns onto *row*.

    Unlike :func:`_resolve_temporal`, which parses a free-text source date, a
    LinguaScrape export ships resolved integer years, so they are carried
    verbatim (a blank cell was already dropped upstream).
    """
    for key in ("time_start", "time_end", "time_start_iso"):
        if key in fields:
            row[key] = fields[key]
            consumed.add(key)


def _mint_linguascrape(
    label: str, shipped_csid: str, *, qid: str | None, alias: str | None
) -> str:
    """Mint a LinguaScrape node's ``csid``: QID first, else the id alias.

    The node type comes from the ``<type>`` segment of the ``csid`` the export
    shipped (falling back to the primary label) so the minted id lands under the
    same type the export and its edges reference.
    """
    type_slug = _linguascrape_type(shipped_csid, label)
    if qid:
        try:
            return mint_csid(type_slug, qid=qid)
        except IdError:
            pass  # not a well-formed QID — fall through to the id alias
    if alias:
        return mint_csid(type_slug, alias=alias)
    raise MapperError(
        "cannot mint csid: LinguaScrape node has neither a Wikidata QID nor a "
        "linguascrape_id"
    )


def _linguascrape_type(shipped_csid: str, label: str) -> str:
    """The node-type slug for a LinguaScrape row (from its csid, else its label)."""
    if shipped_csid:
        try:
            return csid_type(shipped_csid)
        except IdError:
            pass  # malformed shipped csid — fall back to the label
    return normalize_type(label)


def _canonical_edge_type(token: str) -> str:
    """Translate a LinguaScrape edge ``:TYPE`` to the canonical vocabulary.

    Raises:
        MapperError: If *token* is not a known LinguaScrape edge type — a token
            outside :data:`LINGUASCRAPE_EDGE_TYPE_MAP` would enter the graph as a
            non-canonical ``:TYPE``, so it is rejected loudly rather than passed
            through.
    """
    try:
        return LINGUASCRAPE_EDGE_TYPE_MAP[token]
    except KeyError:
        known = ", ".join(sorted(LINGUASCRAPE_EDGE_TYPE_MAP))
        raise MapperError(
            f"unknown LinguaScrape edge :TYPE {token!r} (known: {known})"
        ) from None


def _carry_edge_provenance(record: RawRecord, row: Row) -> None:
    """Stamp the edge provenance columns (no ``source_query``) onto *row*."""
    prov = record.provenance
    row["source"] = prov.source
    row["source_url"] = prov.source_url
    row["retrieved_at"] = prov.retrieved_at
    row["confidence"] = repr(prov.confidence)


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
    if prov.license:
        row["license"] = prov.license


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
