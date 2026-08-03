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

The result is a :class:`~pinakes_engine.schema.tsvio.Row` ready for
:func:`~pinakes_engine.schema.tsvio.write_rows` under :func:`node_schema`.
"""

from __future__ import annotations

import json
from collections.abc import Iterable

from pinakes_engine.acquire.categories import CategorySpec
from pinakes_engine.acquire.records import RawRecord
from pinakes_engine.schema.headers import (
    PARENT_CODE_KEY,
    PINAKES_ID_KEY,
    EdgeSchema,
    NodeSchema,
    PropertyColumn,
)
from pinakes_engine.schema.ids import IdError, csid_type, mint_csid, normalize_type
from pinakes_engine.schema.normalize import (
    normalize_fields,
    normalize_text,
    parse_lat_lon,
    parse_point,
    parse_temporal,
)
from pinakes_engine.schema.tsvio import MULTI_DELIMITER, Row

#: Column that holds, as a JSON object, every raw field with no canonical home.
OVERFLOW_KEY = "extra"

#: The bridge whose records take the csid-*preserving* normalization path
#: (:func:`map_preserving_records`). The token names the producing bridge in that
#: path's error messages, nothing more — it is not a provenance ``source``.
INSIMUL_ORIGIN = "insimul"

#: pinakes export edge ``:TYPE`` token -> canonical ontology ``:TYPE``.
#:
#: pinakes emits its relationships as ``SCREAMING_SNAKE`` tokens; five are
#: already registered in :mod:`pinakes_engine.ontology.registry` and map to
#: themselves, so a fed-in edge participates directly in cross-dimensional
#: linking. The three pinakes-specific tokens fold onto the closest
#: registered canonical type so no non-canonical ``:TYPE`` ever enters the merged
#: graph:
#:
#: * ``ABSORBED_INTO`` (a culture merged into a larger one) -> ``PART_OF`` — the
#:   absorbed entity becomes a component of the absorbing whole (transitive);
#: * ``SYNCRETIZED_WITH`` (two traditions blended) -> ``VARIANT_OF`` — a symmetric
#:   equivalence between the blended forms;
#: * ``SPLIT_FROM`` (a language/lineage diverged from a common ancestor) ->
#:   ``DESCENDS_FROM`` — genealogical descent, the same canonical home
#:   pinakes's ``evolved-into``/``gave-rise-to`` lineage edges already fold
#:   onto (a divergence *is* a descent event).
#:
#: Every value here is a registered canonical ``:TYPE`` (asserted by the ontology
#: tests); an edge token absent from this map is rejected by
#: :func:`map_pinakes_edge` rather than passed through un-canonicalised.
PINAKES_EDGE_TYPE_MAP: dict[str, str] = {
    "DESCENDS_FROM": "DESCENDS_FROM",
    "INFLUENCED_BY": "INFLUENCED_BY",
    "BORROWED_FROM": "BORROWED_FROM",
    "COGNATE_WITH": "COGNATE_WITH",
    "DERIVED_FROM": "DERIVED_FROM",
    "ABSORBED_INTO": "PART_OF",
    "SYNCRETIZED_WITH": "VARIANT_OF",
    "SPLIT_FROM": "DESCENDS_FROM",
    # Personal-media edges (canonical schema v1.2) — registered ontology :TYPEs, so
    # they map to themselves. Kept here for forward-safety per the "cover EVERY
    # exported edge :TYPE" gotcha (schema/CLAUDE.md); no pinakes lexicon emits them
    # today, and a personal-media bridge would use the csid-preserving path instead.
    "DEPICTS": "DEPICTS",
    "MENTIONS": "MENTIONS",
    # Generated-world edges (canonical schema v1.3, insimul-bridge US-003) — same
    # forward-safety rule: registered ontology :TYPEs mapping to themselves. The
    # insimul adapter has its own csid-preserving normalize path; no pinakes
    # lexicon emits these today.
    "PARENT_OF": "PARENT_OF",
    "SPOUSE_OF": "SPOUSE_OF",
    "EMPLOYED_BY": "EMPLOYED_BY",
    "RESIDES_IN": "RESIDES_IN",
    "CAUSED_BY": "CAUSED_BY",
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
#:
#: NOTE — a ref here only reaches a linker that runs on the *in-memory* normalized
#: rows (the per-category ``link`` stage). ``build_corpus`` links after re-reading
#: the normalized TSV from disk (``corpus._read_normalized``), where a non-persisted
#: ref is gone; there only a real schema column (``parent_code``) or the ``extra``
#: overflow survives. The Lexibank cognate-set id (source-breadth US-003) therefore
#: rides in the **overflow** (unmapped ``cognateset`` cell), and the linguistic
#: linker reads it back out of ``extra`` — not from here.
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
    """The canonical node header plus pinakes-engine's acquisition extensions.

    Two columns hang off the end of the canonical tuple, in this order:

    * :data:`~pinakes_engine.schema.headers.PARENT_CODE_KEY` — the ancestor
      language code the linguistic linker resolves to a ``DESCENDS_FROM`` edge.
      ``build_corpus`` links *after* re-reading the normalized TSV from disk, so
      the ref has to survive that round-trip as a real column;
    * :data:`OVERFLOW_KEY` — the JSON catch-all for unmapped raw fields.

    Neither is in ``contracts/canonical-schema.json``, so neither may sit inside
    :meth:`NodeSchema.canonical` — the canonical prefix is what the embedded
    agora translation engine renders, and a column injected into it would break
    byte-parity. A reader keyed on the header (which every reader here is) sees
    the extensions exactly as before.
    """
    base = NodeSchema.canonical()
    return NodeSchema(
        (
            *base.columns,
            PropertyColumn(PARENT_CODE_KEY),
            PropertyColumn(OVERFLOW_KEY),
        )
    )


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


# --- pinakes export ---------------------------------------------------
#
# A pinakes export (``docs/reconcile-pinakes.md``) already ships the
# shared canonical shape: node rows carry their own ``:LABEL`` / ``csid`` and a
# ``pinakes_id`` alias, edge rows carry ``:START_ID`` / ``:END_ID`` /
# ``:TYPE``. So mapping such a record is not the general "rename an arbitrary
# source's fields" problem :func:`map_record` solves — the label and dimension
# columns are already canonical. The two functions below take that shorter path:
# they copy the canonical columns, retain the ``pinakes_id`` round-trip
# alias, and (re)mint the ``csid`` deterministically — QID-anchored when the row
# carries a Wikidata QID, otherwise anchored on the stable ``pinakes_id`` so
# re-ingestion is idempotent and the id matches the one the export computed.


def pinakes_node_schema() -> NodeSchema:
    """The canonical node header plus the overflow column.

    The ``pinakes_id`` alias and the edge time range used to be appended here;
    the canonical contract declares both, so the canonical tuple already carries
    them and only the overflow is left to add.
    """
    base = NodeSchema.canonical()
    return NodeSchema((*base.columns, PropertyColumn(OVERFLOW_KEY)))


def pinakes_edge_schema() -> EdgeSchema:
    """The canonical edge header — ``time_start``/``time_end``/``pinakes_id``
    are canonical columns, so a pinakes edge needs no extension."""
    return EdgeSchema.canonical()


def map_pinakes_record(record: RawRecord) -> Row:
    """Map one pinakes export *record* to a canonical node or edge row.

    Node rows (carrying a ``:LABEL``) and edge rows (carrying a ``:TYPE``) are
    told apart by their structural column, mirroring the export's ``nodes/`` vs
    ``edges/`` split.

    Raises:
        MapperError: If the record carries neither a ``:LABEL`` nor a ``:TYPE``.
    """
    if ":TYPE" in record.fields:
        return map_pinakes_edge(record)
    if ":LABEL" in record.fields:
        return map_pinakes_node(record)
    raise MapperError(
        "pinakes record has neither a ':LABEL' (node) nor a ':TYPE' (edge)"
    )


def map_pinakes_records(records: Iterable[RawRecord]) -> list[Row]:
    """Map every pinakes export record to a row, preserving order."""
    return [map_pinakes_record(record) for record in records]


def map_pinakes_node(record: RawRecord) -> Row:
    """Map a pinakes export node *record* to a canonical node row.

    Raises:
        MapperError: If the record has no ``:LABEL``, or has neither a Wikidata
            QID nor a ``pinakes_id`` from which to mint a ``csid``.
    """
    fields = normalize_fields(record.fields)
    labels = _labels(fields.get(":LABEL", ""))
    if not labels:
        raise MapperError("pinakes node row has no ':LABEL'")

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

    alias = fields.get(PINAKES_ID_KEY, "").strip()
    consumed.add(PINAKES_ID_KEY)
    if alias:
        row[PINAKES_ID_KEY] = alias

    overflow = {key: value for key, value in fields.items() if key not in consumed}
    if overflow:
        row[OVERFLOW_KEY] = json.dumps(overflow, ensure_ascii=False, sort_keys=True)

    row[":LABEL"] = labels
    row["csid"] = _mint_pinakes(
        labels[0],
        fields.get("csid", ""),
        qid=_scalar(row.get("wikidata_qid")),
        alias=alias,
    )

    _carry_provenance(record, row)
    return row


def map_pinakes_edge(record: RawRecord) -> Row:
    """Map a pinakes export edge *record* to a canonical edge row.

    Structural endpoints and ``:TYPE`` are required; the ``:TYPE`` token is
    translated to the canonical ontology vocabulary via
    :data:`PINAKES_EDGE_TYPE_MAP` so the edge participates in
    cross-dimensional linking, and ``weight``, the temporal range, and the
    ``pinakes_id`` alias ride through when present. Provenance (source,
    confidence, time range) is carried off the record.

    Raises:
        MapperError: If any of ``:START_ID`` / ``:END_ID`` / ``:TYPE`` is blank,
            or the ``:TYPE`` is not a known pinakes edge token.
    """
    fields = {key: normalize_text(value) for key, value in record.fields.items()}
    row: Row = {}
    for key in (":START_ID", ":END_ID", ":TYPE"):
        value = fields.get(key, "").strip()
        if not value:
            raise MapperError(f"pinakes edge row is missing {key!r}")
        row[key] = _canonical_edge_type(value) if key == ":TYPE" else value

    for key in ("weight", "time_start", "time_end"):
        value = fields.get(key, "").strip()
        if value:
            row[key] = value

    alias = fields.get(PINAKES_ID_KEY, "").strip()
    if alias:
        row[PINAKES_ID_KEY] = alias

    _carry_edge_provenance(record, row)
    return row


def _labels(raw: str) -> list[str]:
    """Split a ``:LABEL`` cell into its non-empty ``;``-separated labels."""
    return [seg.strip() for seg in raw.split(MULTI_DELIMITER) if seg.strip()]


def _carry_canonical_temporal(
    fields: dict[str, str], row: Row, consumed: set[str]
) -> None:
    """Copy pinakes's already-canonical ``time_*`` columns onto *row*.

    Unlike :func:`_resolve_temporal`, which parses a free-text source date, a
    pinakes export ships resolved integer years, so they are carried
    verbatim (a blank cell was already dropped upstream).
    """
    for key in ("time_start", "time_end", "time_start_iso"):
        if key in fields:
            row[key] = fields[key]
            consumed.add(key)


def _mint_pinakes(
    label: str, shipped_csid: str, *, qid: str | None, alias: str | None
) -> str:
    """Mint a pinakes node's ``csid``: QID first, else the id alias.

    The node type comes from the ``<type>`` segment of the ``csid`` the export
    shipped (falling back to the primary label) so the minted id lands under the
    same type the export and its edges reference.
    """
    type_slug = _pinakes_type(shipped_csid, label)
    if qid:
        try:
            return mint_csid(type_slug, qid=qid)
        except IdError:
            pass  # not a well-formed QID — fall through to the id alias
    if alias:
        return mint_csid(type_slug, alias=alias)
    raise MapperError(
        "cannot mint csid: pinakes node has neither a Wikidata QID nor a "
        "pinakes_id"
    )


def _pinakes_type(shipped_csid: str, label: str) -> str:
    """The node-type slug for a pinakes row (from its csid, else its label)."""
    if shipped_csid:
        try:
            return csid_type(shipped_csid)
        except IdError:
            pass  # malformed shipped csid — fall back to the label
    return normalize_type(label)


def _canonical_edge_type(token: str) -> str:
    """Translate a pinakes edge ``:TYPE`` to the canonical vocabulary.

    Raises:
        MapperError: If *token* is not a known pinakes edge type — a token
            outside :data:`PINAKES_EDGE_TYPE_MAP` would enter the graph as a
            non-canonical ``:TYPE``, so it is rejected loudly rather than passed
            through.
    """
    try:
        return PINAKES_EDGE_TYPE_MAP[token]
    except KeyError:
        known = ", ".join(sorted(PINAKES_EDGE_TYPE_MAP))
        raise MapperError(
            f"unknown pinakes edge :TYPE {token!r} (known: {known})"
        ) from None


def _carry_edge_provenance(record: RawRecord, row: Row) -> None:
    """Stamp the edge provenance columns (no ``source_query``) onto *row*."""
    prov = record.provenance
    row["source"] = prov.source
    row["source_url"] = prov.source_url
    row["retrieved_at"] = prov.retrieved_at
    row["confidence"] = repr(prov.confidence)


# --- csid-preserving bridge exports -----------------------------------
#
# A bridge may ship the shared canonical shape like the pinakes export, but with
# csids that are **already final**, so — unlike the pinakes path, which re-mints
# QID-/alias-anchored csids — this path preserves every shipped csid and endpoint
# **verbatim** (idempotent re-ingest; existing entities are referenced, never
# duplicated). Edge ``:TYPE`` is validated against the ontology so an unregistered
# relation cannot enter the graph.
#
# * **insimul** (the Insimul bridge spec §4.3, insimul-bridge US-003) — the adapter
#   mints world-scoped alias-anchored csids (``cs:character:insimul:<world>:<id>``)
#   while reading the ``CanonicalWorldExport``, so by the time a record reaches
#   here its identity is settled and re-minting would only risk forking it.
#
# The path is generic (``origin=`` is the only bridge-specific input), so a new
# bridge whose export already carries final csids — a content-addressed asset
# store, say — reuses it by passing its own origin token.
#
# *origin* names the producing bridge; it appears in error messages only.


def map_preserving_record(record: RawRecord, *, origin: str) -> Row:
    """Map one csid-preserving bridge *record* to a canonical node or edge row.

    Node rows (carrying a ``:LABEL``) and edge rows (carrying a ``:TYPE``) are
    told apart by their structural column, mirroring the export's ``nodes/`` vs
    ``edges/`` split.

    Raises:
        MapperError: If the record carries neither a ``:LABEL`` nor a ``:TYPE``.
    """
    if ":TYPE" in record.fields:
        return map_preserving_edge(record, origin=origin)
    if ":LABEL" in record.fields:
        return map_preserving_node(record, origin=origin)
    raise MapperError(
        f"{origin} record has neither a ':LABEL' (node) nor a ':TYPE' (edge)"
    )


def map_preserving_records(
    records: Iterable[RawRecord], *, origin: str
) -> list[Row]:
    """Map every csid-preserving bridge record to a row, preserving order."""
    return [map_preserving_record(record, origin=origin) for record in records]


def map_insimul_record(record: RawRecord) -> Row:
    """Map one Insimul world-export *record* to a canonical node or edge row."""
    return map_preserving_record(record, origin=INSIMUL_ORIGIN)


def map_insimul_records(records: Iterable[RawRecord]) -> list[Row]:
    """Map every Insimul world-export record to a row, preserving order."""
    return map_preserving_records(records, origin=INSIMUL_ORIGIN)


def map_preserving_node(record: RawRecord, *, origin: str) -> Row:
    """Map a csid-preserving bridge node *record* to a canonical node row.

    The shipped ``csid`` (e.g. ``cs:asset:<sha256hex>``,
    ``cs:character:insimul:<world>:<id>``) is preserved **verbatim** — identity is
    already final, so re-ingesting the same export yields the identical row.
    Recognised canonical columns are carried; unrecognised source fields (an
    asset's technical probe — container / duration / codec / width / height; a
    character's gender / occupation / personality) ride into the
    :data:`OVERFLOW_KEY` overflow, never dropped.

    Raises:
        MapperError: If the record has no ``:LABEL`` or no ``csid``.
    """
    fields = normalize_fields(record.fields)
    labels = _labels(fields.get(":LABEL", ""))
    if not labels:
        raise MapperError(f"{origin} node row has no ':LABEL'")
    csid = fields.get("csid", "").strip()
    if not csid:
        raise MapperError(f"{origin} node row has no 'csid' to preserve")

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

    overflow = {key: value for key, value in fields.items() if key not in consumed}
    if overflow:
        row[OVERFLOW_KEY] = json.dumps(overflow, ensure_ascii=False, sort_keys=True)

    row[":LABEL"] = labels
    row["csid"] = csid
    _carry_provenance(record, row)
    return row


def map_preserving_edge(record: RawRecord, *, origin: str) -> Row:
    """Map a csid-preserving bridge edge *record* to a canonical edge row.

    Endpoints and ``:TYPE`` are preserved verbatim (an Insimul genealogy edge, for
    instance, references the world-scoped csids the adapter minted for its own
    nodes — never re-minted; an edge may equally reference an existing canonical
    entity csid the producing bridge already resolved). The ``:TYPE`` is
    validated against the ontology so an unregistered relation is rejected rather
    than passed through.

    Raises:
        MapperError: If any of ``:START_ID`` / ``:END_ID`` / ``:TYPE`` is blank,
            or the ``:TYPE`` is not a registered ontology relationship type.
    """
    # Leaf-module import (not the ontology package) avoids a circular import — the
    # package pulls in the linkers, which depend on the schema. Same as validate.py.
    from pinakes_engine.ontology.registry import is_registered

    fields = {key: normalize_text(value) for key, value in record.fields.items()}
    row: Row = {}
    for key in (":START_ID", ":END_ID", ":TYPE"):
        value = fields.get(key, "").strip()
        if not value:
            raise MapperError(f"{origin} edge row is missing {key!r}")
        row[key] = value
    if not is_registered(str(row[":TYPE"])):
        raise MapperError(
            f"{origin} edge :TYPE {row[':TYPE']!r} is not a registered ontology type"
        )

    for key in ("weight", "time_start", "time_end"):
        value = fields.get(key, "").strip()
        if value:
            row[key] = value

    _carry_edge_provenance(record, row)
    return row


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
