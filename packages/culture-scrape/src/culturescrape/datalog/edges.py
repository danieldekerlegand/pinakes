"""Project canonical edge TSV rows into engine-neutral :class:`Fact` objects.

Datalog is a *derived* view of the TSV source of truth (``docs/data-model.md``).
This module turns each edge row into the facts that put the graph's structure
into logic. An edge of ``:TYPE`` ``T`` from ``A`` to ``B`` yields two
interchangeable views plus an optional strength companion:

* ``rel(t, A, B)`` — the **generic** view, with the relation type carried as
  data so every edge is reachable by a single uniform query;
* ``t(A, B)`` — the **typed** view, one binary predicate per ``:TYPE`` (``t`` is
  :func:`predicate_for_type`, e.g. ``located_in``/``derived_from``);
* ``rel_conf(t, A, B, W)`` — an optional companion exposing the edge's
  **confidence** (its strength), emitted only when a strength is populated so the
  base relations stay arity-stable. The canonical ``confidence`` column is the
  source; the legacy ``weight`` column is a fallback used only when ``confidence``
  is blank but ``weight`` is genuinely populated.
* ``rel_source(t, A, B, Source)`` — an optional companion exposing the edge's
  **provenance** as a *queryable* fact (mirroring ``rel_conf/4``), so a query can
  filter or join edges by where they came from rather than only reading the
  trailing ``% source:`` comment; emitted only when the row carries a source.

The generic and typed views use the *same* atom for the type — ``rel(located_in,
A, B)`` mirrors ``located_in(A, B)`` — so a query can pivot between them freely.
Every fact carries the row's ``source`` as provenance, mirroring node facts.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path

from culturescrape.datalog import DatalogError, Fact
from culturescrape.schema.headers import EdgeSchema
from culturescrape.schema.tsvio import Row, open_rows

#: A well-formed edge ``:TYPE``: SCREAMING_SNAKE_CASE per ``docs/data-model.md``
#: (``LOCATED_IN``, ``DERIVED_FROM``, …).
_TYPE_RE = re.compile(r"[A-Z][A-Z0-9_]*\Z")


def predicate_for_type(rel_type: str) -> str:
    """Derive a collision-free Datalog predicate functor from an edge ``:TYPE``.

    The scheme is a plain lowercasing, *constrained to be collision-free*: a
    ``:TYPE`` must be SCREAMING_SNAKE_CASE (``[A-Z][A-Z0-9_]*``) — the
    relationship-vocabulary convention in ``docs/data-model.md``. Over that
    domain ``str.lower()`` is a bijection onto valid predicate functors
    (``[a-z][a-z0-9_]*``): letters map one-to-one (``A`` ↔ ``a``) and
    digits/underscores are fixed, so two distinct types can never collapse to
    the same predicate. A ``:TYPE`` outside the domain is rejected rather than
    silently colliding (lowercasing both ``Located_In`` and ``LOCATED_IN`` to
    one predicate), keeping the mapping reversible.

        >>> predicate_for_type("LOCATED_IN")
        'located_in'
        >>> predicate_for_type("DERIVED_FROM")
        'derived_from'
    """
    if not _TYPE_RE.match(rel_type):
        raise DatalogError(
            f"edge :TYPE {rel_type!r} is not SCREAMING_SNAKE_CASE "
            "(expected an uppercase-initial name like 'LOCATED_IN')"
        )
    return rel_type.lower()


def _scalar(row: Row, key: str) -> str:
    """The scalar value at *key* (``""`` if absent), rejecting list columns."""
    value = row.get(key, "")
    if isinstance(value, list):
        raise DatalogError(f"column {key!r} is multi-valued, expected a scalar")
    return value


def edge_facts(row: Row) -> list[Fact]:
    """Project one decoded edge *row* into its facts.

    Emits the generic ``rel/3`` and the typed ``<type>/2`` for the edge, plus
    ``rel_conf/4`` carrying the edge's strength. The strength is the canonical
    ``confidence`` column, falling back to ``weight`` only when ``confidence`` is
    blank and ``weight`` is genuinely populated; when neither is populated no
    companion is emitted, so no null reaches the logic program. Every fact carries
    the row's ``source`` as provenance, and when a source is present a
    ``rel_source/4`` companion exposes it as a queryable fact.
    """
    start = _scalar(row, ":START_ID")
    end = _scalar(row, ":END_ID")
    rel_type = _scalar(row, ":TYPE")
    if not start or not end:
        raise DatalogError("edge requires both a :START_ID and a :END_ID")
    if not rel_type:
        raise DatalogError("edge requires a :TYPE")

    predicate = predicate_for_type(rel_type)
    source = _scalar(row, "source") or None

    facts = [
        Fact("rel", (predicate, start, end), source=source),
        Fact(predicate, (start, end), source=source),
    ]

    # Prefer the canonical confidence; fall back to a populated legacy weight.
    strength = _scalar(row, "confidence") or _scalar(row, "weight")
    if strength:  # optional strength; a blank cell emits no companion
        facts.append(
            Fact("rel_conf", (predicate, start, end, float(strength)), source=source)
        )

    # Expose the provenance as a queryable companion (mirrors rel_conf/4); a
    # blank source emits none, so no null reaches the logic program.
    if source is not None:
        facts.append(Fact("rel_source", (predicate, start, end, source), source=source))

    return facts


def edge_file_facts(path: str | Path) -> Iterator[Fact]:
    """Stream an edge TSV file at *path*, projecting each row to facts.

    The header is validated as an edge schema (``:START_ID``, ``:END_ID``,
    ``:TYPE``) before any row is read, so a malformed file fails fast rather than
    emitting ill-typed facts. Rows are read one at a time (:func:`open_rows`) and
    their facts yielded lazily, so a dump-scale file never lands whole in memory.
    """
    columns, rows = open_rows(path)
    EdgeSchema(tuple(columns))  # validate the header; raises on a malformed file
    for row in rows:
        yield from edge_facts(row)


__all__ = ["edge_facts", "edge_file_facts", "predicate_for_type"]
