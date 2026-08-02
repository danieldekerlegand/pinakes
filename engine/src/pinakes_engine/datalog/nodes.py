"""Project canonical node TSV rows into engine-neutral :class:`Fact` objects.

Datalog is a *derived* view of the TSV source of truth (``docs/data-model.md``).
This module turns each node row into the facts that assert the entity's
existence and its populated dimensions:

* ``node(Csid, Type, Name)`` — one per row; ``Type`` is the primary ``:LABEL``.
* ``instance_of(Csid, Label)`` — one per ``:LABEL`` value, so a multi-label node
  (``Dish;CulturalArtifact``) keeps every type rather than only the primary one.
* one dimension fact per *populated* dimension column — ``time_start(Csid,
  Year)``, ``located_at(Csid, Lat, Lon)``, ``language_code(Csid, Code)``, … (see
  :data:`_DIMENSION_PREDICATES`). An empty cell emits nothing, so there are no
  nulls in the logic program.

**csid → atom mapping.** A ``csid`` is carried *verbatim* as the first argument
of every fact; :func:`pinakes_engine.datalog.render_atom` then quotes it
deterministically (``cs:dish:Q42`` → ``'cs:dish:Q42'`` in Prolog,
``"cs:dish:Q42"`` in Datalog). The mapping is reversible because the original
string survives byte-for-byte inside the quotes — recovering the csid is just
stripping the quotes and undoing the dialect's escapes. The same csid always
renders to the same atom, so the projection is idempotent.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Sequence
from pathlib import Path

from pinakes_engine.datalog import Atom, DatalogError, Fact
from pinakes_engine.schema.headers import (
    Column,
    IdColumn,
    NodeSchema,
    PropertyColumn,
    PropertyType,
)
from pinakes_engine.schema.tsvio import Row, open_rows

#: Scalar dimension columns and the binary predicate each projects to. ``lat``
#: and ``lon`` are absent here: they are emitted jointly as ``located_at/3``.
_DIMENSION_PREDICATES: dict[str, str] = {
    "time_start": "time_start",  # temporal — year (negative = BCE)
    "time_end": "time_end",  # temporal
    "period": "part_of_period",  # temporal — named period
    "place_qid": "place_qid",  # geographic — Wikidata place QID
    "tgn_id": "tgn_id",  # geographic — Getty TGN id
    "pleiades_id": "pleiades_id",  # geographic — ancient-place id
    "language_code": "language_code",  # linguistic — ISO 639-3 / Glottocode
    "script": "script",  # linguistic — ISO 15924
    "etymology": "etymology",  # linguistic
    "derived_from_csid": "derived_from",  # genetic — cultural lineage
}


def _scalar(row: Row, key: str) -> str:
    """The scalar value at *key* (``""`` if absent), rejecting list columns."""
    value = row.get(key, "")
    if isinstance(value, list):
        raise DatalogError(f"column {key!r} is multi-valued, expected a scalar")
    return value


def _labels(row: Row) -> list[str]:
    """The ``:LABEL`` values, rejecting a scalar where a list is required."""
    value = row.get(":LABEL", [])
    if isinstance(value, str):
        raise DatalogError("column ':LABEL' must be multi-valued")
    return value


def _coerce(value: str, ptype: PropertyType) -> Atom:
    """Coerce a raw cell to the numeric term its column type implies.

    The header types ``time_start``/``time_end`` as ``:int`` and ``lat``/``lon``
    as ``:float`` (enforced by :class:`NodeSchema`), so the projected fact
    carries a numeric literal rather than a quoted string.
    """
    if ptype is PropertyType.INT:
        return int(value)
    if ptype is PropertyType.FLOAT:
        return float(value)
    return value


def node_facts(columns: Sequence[Column], row: Row) -> list[Fact]:
    """Project one node *row* (read under *columns*) into its facts.

    Emits ``node/3`` and an ``instance_of/2`` per label, then one fact for each
    populated dimension column. Empty cells are skipped, so no null ever reaches
    the logic program. Every fact carries the row's ``source`` as provenance.

    When the row carries a ``source``, an extra ``source(Csid, Source)`` fact is
    emitted — the *queryable* form of the provenance that otherwise survives only
    as each clause's trailing comment. Keyed by csid, it lets a query join on
    where an entity came from (``source(C, wikidata), node(C, T, N)``); a blank
    source emits none, so no null reaches the logic program.
    """
    id_key = next(c.name for c in columns if isinstance(c, IdColumn))
    types = {c.name: c.type for c in columns if isinstance(c, PropertyColumn)}

    csid = _scalar(row, id_key)
    labels = _labels(row)
    if not labels:
        raise DatalogError(f"node {csid!r} has no :LABEL, cannot type it")
    name = _scalar(row, "name")
    source = _scalar(row, "source") or None

    facts = [Fact("node", (csid, labels[0], name), source=source)]
    facts += [Fact("instance_of", (csid, label), source=source) for label in labels]
    if source is not None:
        facts.append(Fact("source", (csid, source), source=source))

    lat, lon = _scalar(row, "lat"), _scalar(row, "lon")
    if lat and lon:
        facts.append(
            Fact("located_at", (csid, float(lat), float(lon)), source=source)
        )

    for col, predicate in _DIMENSION_PREDICATES.items():
        value = _scalar(row, col)
        if not value:
            continue  # null/empty column emits no fact
        facts.append(Fact(predicate, (csid, _coerce(value, types[col])), source=source))

    return facts


def node_file_facts(
    path: str | Path, *, keep_row: Callable[[Row], bool] | None = None
) -> Iterator[Fact]:
    """Stream a node TSV file at *path*, projecting each row to facts.

    The header is validated as a node schema (``:ID``, ``:LABEL``, ``name``)
    before any row is read, so a malformed file fails fast rather than emitting
    ill-typed facts. Rows are read one at a time (:func:`open_rows`) and their
    facts yielded lazily, so a dump-scale file never lands whole in memory.

    When *keep_row* is given, only rows for which it returns ``True`` are
    projected — the row-level filter the tier-scoped export uses to include or
    exclude a trust tier (a personal-tier row is dropped from the public program
    and kept in the ``--tier personal`` one). ``None`` keeps every row, so the
    default projection is unchanged.
    """
    columns, rows = open_rows(path)
    schema = NodeSchema(tuple(columns))
    for row in rows:
        if keep_row is not None and not keep_row(row):
            continue
        yield from node_facts(schema.columns, row)


__all__ = ["node_facts", "node_file_facts"]
