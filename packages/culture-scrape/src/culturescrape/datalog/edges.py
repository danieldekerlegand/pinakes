"""Project canonical edge TSV rows into engine-neutral :class:`Fact` objects.

Datalog is a *derived* view of the TSV source of truth (``docs/data-model.md``).
This module turns each edge row into the facts that put the graph's structure
into logic. An edge of ``:TYPE`` ``T`` from ``A`` to ``B`` yields two
interchangeable views plus an optional strength companion:

* ``rel(t, A, B)`` — the **generic** view, with the relation type carried as
  data so every edge is reachable by a single uniform query;
* ``t(A, B)`` — the **typed** view, one binary predicate per ``:TYPE`` (``t`` is
  :func:`predicate_for_type`, e.g. ``located_in``/``derived_from``);
* ``rel_conf(t, A, B, W)`` — an optional companion exposing the edge ``weight``
  (its strength/confidence), emitted only when that column is populated so the
  base relations stay arity-stable.

The generic and typed views use the *same* atom for the type — ``rel(located_in,
A, B)`` mirrors ``located_in(A, B)`` — so a query can pivot between them freely.
Every fact carries the row's ``source`` as provenance, mirroring node facts.
"""

from __future__ import annotations

import re
from pathlib import Path

from culturescrape.datalog import DatalogError, Fact
from culturescrape.schema.headers import EdgeSchema
from culturescrape.schema.tsvio import Row, read_rows

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
    ``rel_conf/4`` when the ``weight`` column is populated. An empty ``weight``
    emits no companion, so no null reaches the logic program. Every fact carries
    the row's ``source`` as provenance.
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

    weight = _scalar(row, "weight")
    if weight:  # optional strength/confidence; empty cell emits no companion
        facts.append(
            Fact("rel_conf", (predicate, start, end, float(weight)), source=source)
        )

    return facts


def edge_file_facts(path: str | Path) -> list[Fact]:
    """Read an edge TSV file at *path* and project every row to facts.

    The header is validated as an edge schema (``:START_ID``, ``:END_ID``,
    ``:TYPE``) before projection, so a malformed file fails fast rather than
    emitting ill-typed facts.
    """
    columns, rows = read_rows(path)
    EdgeSchema(tuple(columns))  # validate the header; raises on a malformed file
    facts: list[Fact] = []
    for row in rows:
        facts.extend(edge_facts(row))
    return facts


__all__ = ["edge_facts", "edge_file_facts", "predicate_for_type"]
