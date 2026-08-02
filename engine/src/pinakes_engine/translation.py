"""Embedded agora translation engine — the canonical-format rendering backend.

Per the pinakes:42 seam spec, pinakes-engine no longer hand-writes the canonical
format emitters: it EMBEDS the agora translation library
(``agora:60-translation-engine-rust``) in-process through its PyO3 bindings, the
``translation_py`` extension module. The library is one facade over a single Rust
core, so its bytes are identical to the reference Python emitters' for the same
canonical graph (proven byte-for-byte in agora's ``crates/py/tests/test_parity.py``
against goldens captured from pinakes-engine).

This module is the thin pinakes-engine-side adapter over that extension:

* :func:`graph_json` serialises a pair of canonical row streams (the
  :data:`pinakes_engine.schema.tsvio.Row` shape the pipeline already produces —
  scalars as ``str``, multi-value columns as ``list[str]``) into the JSON
  interchange graph the extension consumes.
* the eight matrix entry points (:func:`to_tsv`, :func:`to_csv`, :func:`to_cypher`,
  :func:`to_prolog`, :func:`to_souffle`, :func:`to_problog`, :func:`to_datalog`,
  :func:`to_neo4j_export`) are re-exported straight from the extension.
* :func:`dataset_datalog` is the dataset-level helper the datalog exporter uses:
  it reads a discovered ``nodes/*.tsv`` / ``edges/*.tsv`` dataset (applying the
  same per-row tier filter the streaming projector uses), hands the resulting
  canonical graph to the library, and returns the rendered SWI-Prolog / Soufflé /
  ProbLog programs. Row discovery, ordering and tier filtering stay in Python; the
  *format rendering* is the library's.

The dependency is explicit and un-fudged: if the extension is missing (the
upstream ``agora:60`` bindings are not installed) importing this module raises a
clear, actionable :class:`ImportError` naming the upstream — there is **no silent
fallback** to the retired Python emitters.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

from pinakes_engine.schema.tsvio import Row, open_rows

#: The message raised when the embedded engine is unavailable — names the upstream
#: task that provides it so the failure is actionable, and states the no-fallback
#: policy so a caller does not "route around" it back to the deleted emitters.
_MISSING = (
    "The agora translation engine is not installed. pinakes-engine embeds it "
    "(agora:60-translation-engine-rust) in-process via its PyO3 bindings, the "
    "'translation_py' extension, for the canonical format conversions — it is a "
    "real dependency of this package (declared as 'translation-py' in "
    "pyproject.toml). Install the package's dependencies (e.g. "
    "'uv sync --frozen --all-extras'). There is no fallback to the retired "
    "Python emitters."
)

try:  # pragma: no cover - exercised by the packaged gate, not unit-mocked
    import translation_py as _engine
except ModuleNotFoundError as exc:  # pragma: no cover - see above
    raise ImportError(_MISSING) from exc


def graph_json(
    nodes: Iterable[Mapping[str, str | Sequence[str]]],
    edges: Iterable[Mapping[str, str | Sequence[str]]],
) -> str:
    """Serialise canonical node/edge rows into the engine's JSON graph.

    Each row is a mapping from a canonical column key (``csid``, ``:LABEL``,
    ``:START_ID``, ...) to its value — a ``str`` for a scalar column or a
    ``list``/tuple of ``str`` for a multi-value column (``:LABEL``, ``aliases``).
    That is exactly the :data:`~pinakes_engine.schema.tsvio.Row` shape and the
    interchange shape the Rust core decodes, so the mapping is a direct dump. The
    engine applies the canonical sort order and column projection itself, so the
    rows may be passed in any order.
    """
    payload = {
        "nodes": [dict(row) for row in nodes],
        "edges": [dict(row) for row in edges],
    }
    return json.dumps(payload)


def to_tsv(graph: str) -> dict[str, str]:
    """Render a canonical graph JSON to ``{"nodes": <tsv>, "edges": <tsv>}``."""
    return dict(_engine.to_tsv(graph))


def to_csv(graph: str) -> dict[str, str]:
    """Render a canonical graph JSON to the Neo4j-import CSV pair."""
    return dict(_engine.to_csv(graph))


def to_cypher(graph: str) -> str:
    """Render a canonical graph JSON to an incremental ``LOAD CSV`` script."""
    return str(_engine.to_cypher(graph))


def to_prolog(graph: str) -> str:
    """Render a canonical graph JSON to a loadable SWI-Prolog program."""
    return str(_engine.to_prolog(graph))


def to_souffle(graph: str) -> dict[str, Any]:
    """Render a canonical graph JSON to ``{"program": <dl>, "facts": {...}}``."""
    return dict(_engine.to_souffle(graph))


def to_problog(graph: str) -> str:
    """Render a canonical graph JSON to a ProbLog program."""
    return str(_engine.to_problog(graph))


def to_datalog(graph: str) -> dict[str, Any]:
    """Render a canonical graph JSON to every logic program (the export shape).

    Returns ``{"fact_count": int, "prolog": <graph.pl>, "problog":
    <graph.problog.pl>, "souffle": {"program": <graph.dl>, "facts": {<stem>:
    <body>, ...}}}`` — the same shape (and bytes) ``datalog/export.py``'s
    ``export_dataset`` produces for the rules-free path.
    """
    return dict(_engine.to_datalog(graph))


def to_neo4j_export(graph: str) -> dict[str, Any]:
    """Render a canonical graph JSON back to sharded canonical TSV."""
    return dict(_engine.to_neo4j_export(graph))


#: Line prefixes in an engine-rendered logic program that are *not* fact clauses:
#: ``%`` opens a comment (the schema header both the SWI-Prolog and the ProbLog
#: renderer emit) and ``:-`` opens a directive (SWI-Prolog's
#: ``discontiguous``/``dynamic`` preamble; ProbLog's parser rejects directives, so
#: its programs carry none). A fact clause opens with its functor — a
#: lowercase-initial identifier — or, in ProbLog, with a numeric probability
#: annotation, so neither prefix can collide with one.
_NON_CLAUSE_PREFIXES = ("%", ":-")


def program_fact_clauses(program: str) -> list[str]:
    """The fact-clause lines of an engine-rendered Prolog/ProbLog program.

    The engine renders a *whole* program — schema header, directive preamble, then
    one clause per projected fact. This splits the clause block back out so a
    caller can re-compose it with structure the engine does not know about (the
    inference rules and their directives, the P279 taxonomy overlay); see
    :func:`pinakes_engine.datalog.export.export_dataset`.

    The split is exact rather than heuristic: one clause is always exactly one
    line, because :func:`pinakes_engine.datalog.render_atom` escapes every C0
    control — newline included — inside a quoted atom, so no clause can contain a
    raw line break. Blank separator lines carry no clause and are dropped.

        >>> program_fact_clauses("% header\\n\\n:- dynamic node/3.\\n\\nnode(a).\\n")
        ['node(a).']
    """
    return [
        line
        for line in program.splitlines()
        if line and not line.startswith(_NON_CLAUSE_PREFIXES)
    ]


def _read_rows(
    paths: Iterable[Path], keep_row: Callable[[Row], bool] | None
) -> list[Row]:
    """Read every row of *paths* in file-then-line order, keeping those *keep_row*
    admits (all of them when *keep_row* is ``None``)."""
    rows: list[Row] = []
    for path in paths:
        _, row_iter = open_rows(path)
        for row in row_iter:
            if keep_row is None or keep_row(row):
                rows.append(row)
    return rows


def dataset_datalog(
    node_files: Sequence[Path],
    edge_files: Sequence[Path],
    keep_row: Callable[[Row], bool] | None = None,
) -> dict[str, Any]:
    """Render a discovered TSV dataset to logic programs via the engine.

    *node_files* / *edge_files* are the ``nodes/*.tsv`` / ``edges/*.tsv`` a caller
    has already discovered (in canonical filename order). Each row is read with the
    lossless TSV reader and, when *keep_row* is given, filtered by it (the tier
    scope) exactly as the streaming projector filters facts — so the containment
    guarantee is preserved before a single byte is rendered. The surviving rows
    become the canonical graph the engine translates; the return value is
    :func:`to_datalog`'s shape.
    """
    nodes = _read_rows(node_files, keep_row)
    edges = _read_rows(edge_files, keep_row)
    return to_datalog(graph_json(nodes, edges))


__all__ = [
    "dataset_datalog",
    "graph_json",
    "program_fact_clauses",
    "to_csv",
    "to_cypher",
    "to_datalog",
    "to_neo4j_export",
    "to_problog",
    "to_prolog",
    "to_souffle",
    "to_tsv",
]
