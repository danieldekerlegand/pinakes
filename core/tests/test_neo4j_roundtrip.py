"""Prove the TSV -> Neo4j -> TSV round-trip is lossless (T4-US-006).

The other Neo4j tests check each leg in isolation; this one closes the loop and
asserts **byte-equality**. It never touches a live database. Instead it drives a
*faithful* in-memory graph fake (:class:`_FakeGraph`) that mimics the two
properties of a real Neo4j store that matter for losslessness:

* it holds **typed** values — ``time_start`` as an ``int``, ``lat`` as a
  ``float`` — exactly as ``neo4j-admin import`` / ``LOAD CSV`` would coerce them
  from the typed header, so any precision or BCE-sign loss would show up here;
* it ``MERGE``\\ s on identity (``csid`` for nodes, ``(start, end, type)`` for
  edges), so re-importing the same dataset is idempotent.

The fake then answers the exact cursor queries the real exporter runs
(:data:`NODE_QUERY` / :data:`EDGE_QUERY`), so :func:`export_to_tsv` runs
unmodified against it.

Two transformations are unavoidable and are normalised before comparison:

* **Property / label ordering.** Neo4j returns ``properties(n)`` in an arbitrary
  order; the exporter re-emits every column in canonical schema order. The fake
  deliberately yields its properties and labels in *reverse-sorted* order to
  prove the exporter normalises this rather than echoing input order.
* **Numeric text.** A typed cell survives as ``"-50" -> int -50 -> "-50"``;
  floats survive as their Python ``repr`` (``"-12.04"``). The fixtures therefore
  use canonical numeric literals — the one shape neo4j's typed storage imposes —
  and the "original" we compare against is the same dataset written through the
  canonical writers, i.e. the *sorted* original required by the acceptance.

Coverage per the acceptance criteria: nodes with multiple labels, multi-value
fields (``:LABEL``, ``aliases``), BCE dates (negative ``time_start``), plus
tab/newline/semicolon values to exercise the lossless escaping under transport.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from culturescrape.neo4j.constraints import ENTITY_LABEL
from culturescrape.neo4j.export import EDGE_QUERY, NODE_QUERY, export_to_tsv
from culturescrape.schema.headers import (
    EdgeSchema,
    IdColumn,
    NodeSchema,
    PropertyColumn,
    PropertyType,
)
from culturescrape.schema.tsvio import (
    MULTI_VALUE_KEYS,
    Row,
    read_rows,
    write_edge_rows,
    write_node_rows,
)

# --------------------------------------------------------------------------- #
# A faithful in-memory Neo4j stand-in.
# --------------------------------------------------------------------------- #

#: A stored node: its label set and its typed property map.
_Node = tuple[set[str], dict[str, Any]]


def _coerce(text: str, ptype: PropertyType) -> Any:
    """Coerce one cell to the typed value neo4j would store for *ptype*."""
    if ptype is PropertyType.INT:
        return int(text)
    if ptype is PropertyType.FLOAT:
        return float(text)
    return text


class _FakeGraph:
    """In-memory property graph that MERGEs on identity and types its values.

    Imports canonical TSV (via the real reader) the way neo4j would, then
    answers :data:`NODE_QUERY` / :data:`EDGE_QUERY` with the same record shape a
    Bolt cursor returns, so :func:`export_to_tsv` runs against it untouched.
    """

    def __init__(self) -> None:
        #: csid -> (labels, props)
        self._nodes: dict[str, _Node] = {}
        #: (start, end, type) -> props
        self._edges: dict[tuple[str, str, str], dict[str, Any]] = {}

    # -- import (TSV -> graph) --------------------------------------------- #

    def import_dir(self, directory: Path) -> None:
        """MERGE every ``nodes/*.tsv`` and ``edges/*.tsv`` file under *directory*."""
        node_schema = NodeSchema.canonical()
        edge_schema = EdgeSchema.canonical()
        for path in sorted((directory / "nodes").glob("*.tsv")):
            _, rows = read_rows(path)
            for row in rows:
                self._merge_node(row, node_schema)
        for path in sorted((directory / "edges").glob("*.tsv")):
            _, rows = read_rows(path)
            for row in rows:
                self._merge_edge(row, edge_schema)

    def _merge_node(self, row: Row, schema: NodeSchema) -> None:
        labels: set[str] = {ENTITY_LABEL}
        labels.update(_as_list(row.get(":LABEL", [])))
        props: dict[str, Any] = {}
        for column in schema.columns:
            if isinstance(column, IdColumn):
                props[column.name] = _as_str(row[column.name])
            elif isinstance(column, PropertyColumn):
                _store(props, column, row.get(column.name))
        csid = props["csid"]
        existing = self._nodes.get(csid)
        if existing is None:
            self._nodes[csid] = (labels, props)
        else:  # MERGE: update labels/props in place, never duplicate.
            existing[0].update(labels)
            existing[1].update(props)

    def _merge_edge(self, row: Row, schema: EdgeSchema) -> None:
        key = (
            _as_str(row[":START_ID"]),
            _as_str(row[":END_ID"]),
            _as_str(row[":TYPE"]),
        )
        props: dict[str, Any] = {}
        for column in schema.columns:
            if isinstance(column, PropertyColumn):
                _store(props, column, row.get(column.name))
        self._edges[key] = props

    # -- export (graph -> cursor records) ---------------------------------- #

    def session(self) -> _FakeSession:
        return _FakeSession(self)

    def close(self) -> None:  # pragma: no cover - export leaves given drivers open
        pass

    def _node_records(self) -> list[dict[str, Any]]:
        return [
            {"labels": _reverse_sorted(labels), "props": _reorder(props)}
            for labels, props in self._nodes.values()
        ]

    def _edge_records(self) -> list[dict[str, Any]]:
        return [
            {"start": start, "end": end, "type": etype, "props": _reorder(props)}
            for (start, end, etype), props in self._edges.items()
        ]


class _FakeSession:
    """Context-managed cursor returning records for the two export queries."""

    def __init__(self, graph: _FakeGraph) -> None:
        self._graph = graph

    def __enter__(self) -> _FakeSession:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def run(self, query: str) -> list[dict[str, Any]]:
        if query == NODE_QUERY:
            return self._graph._node_records()
        if query == EDGE_QUERY:
            return self._graph._edge_records()
        raise AssertionError(f"unexpected query: {query!r}")


def _store(props: dict[str, Any], column: PropertyColumn, value: Any) -> None:
    """MERGE one property into *props*, skipping empty cells (neo4j stores no nulls)."""
    if column.name in MULTI_VALUE_KEYS:
        items = _as_list(value)
        if items:
            props[column.name] = list(items)
        return
    text = _as_str(value)
    if text != "":
        props[column.name] = _coerce(text, column.type)


def _reorder(props: dict[str, Any]) -> dict[str, Any]:
    """Return *props* in reverse-sorted key order (arbitrary, like real neo4j)."""
    return {key: props[key] for key in sorted(props, reverse=True)}


def _reverse_sorted(labels: set[str]) -> list[str]:
    return sorted(labels, reverse=True)


def _as_str(value: Any) -> str:
    assert isinstance(value, str)
    return value


def _as_list(value: Any) -> list[str]:
    assert isinstance(value, list)
    return value


# --------------------------------------------------------------------------- #
# Fixture dataset (covers the acceptance-required shapes).
# --------------------------------------------------------------------------- #

_NODES: tuple[dict[str, str | list[str]], ...] = (
    {
        # Multiple labels + multi-value aliases + BCE date.
        ":LABEL": ["CulturalArtifact", "Dish"],
        "csid": "cs:dish:garum",
        "name": "Garum",
        "aliases": ["liquamen", "garon"],
        "time_start": "-50",
        "time_start_iso": "-0050-01-01",
        "lat": "41.9",
        "lon": "12.5",
        "source": "wikidata",
        "confidence": "0.9",
    },
    {
        # Single label, BCE founding date.
        ":LABEL": ["Place"],
        "csid": "cs:region:rome",
        "name": "Rome",
        "time_start": "-753",
        "lat": "41.89",
        "lon": "12.48",
        "source": "pleiades",
        "confidence": "0.95",
    },
    {
        # Same primary label as Rome (tests grouping + csid sort), with
        # tab/newline/semicolon values that must survive transport losslessly.
        ":LABEL": ["Place"],
        "csid": "cs:region:athens",
        "name": "Athens",
        "time_start": "-800",
        "description": "City of\tAthena\nbuilt on a hill",
        "aliases": ["Athína", "Athenai;polis"],
        "source": "pleiades",
    },
)

_EDGES: tuple[dict[str, str], ...] = (
    {
        ":START_ID": "cs:dish:garum",
        ":END_ID": "cs:region:rome",
        ":TYPE": "ORIGINATES_FROM",
        "weight": "0.9",
        "source": "wikidata",
        "confidence": "0.8",
    },
    {
        # Same :TYPE as above (tests edge grouping + (start,end,type) sort).
        ":START_ID": "cs:dish:garum",
        ":END_ID": "cs:region:athens",
        ":TYPE": "ORIGINATES_FROM",
        "weight": "0.5",
        "source": "getty",
    },
    {
        ":START_ID": "cs:region:athens",
        ":END_ID": "cs:region:rome",
        ":TYPE": "PRECEDES",
        "source": "pleiades",
    },
)


def _primary(labels: list[str]) -> str:
    """The file/type key a node groups under: its alphabetically-first label."""
    return sorted(labels)[0]


def _write_canonical(root: Path) -> None:
    """Write the fixture as the canonical, sorted "original" via the real writers.

    Nodes/edges are grouped exactly as the exporter groups them (by primary
    label / by ``:TYPE``) so the two directories are directly comparable.
    """
    node_schema = NodeSchema.canonical()
    edge_schema = EdgeSchema.canonical()

    by_label: dict[str, list[dict[str, str | list[str]]]] = {}
    for node in _NODES:
        label = _primary(_as_list(node[":LABEL"]))
        # Store the :LABEL cell already sorted, matching the exporter.
        row = {**node, ":LABEL": sorted(_as_list(node[":LABEL"]))}
        by_label.setdefault(label, []).append(row)
    for label, rows in by_label.items():
        write_node_rows(root / "nodes" / f"{label}.tsv", node_schema, rows)

    by_type: dict[str, list[dict[str, str]]] = {}
    for edge in _EDGES:
        by_type.setdefault(edge[":TYPE"], []).append(edge)
    for etype, edge_rows in by_type.items():
        write_edge_rows(root / "edges" / f"{etype}.tsv", edge_schema, edge_rows)


def _relative_files(root: Path) -> dict[str, bytes]:
    """Map every ``*.tsv`` under *root* to its bytes, keyed by relative path."""
    return {
        str(path.relative_to(root)): path.read_bytes()
        for path in sorted(root.rglob("*.tsv"))
    }


# --------------------------------------------------------------------------- #
# Tests.
# --------------------------------------------------------------------------- #


def test_roundtrip_is_byte_identical(tmp_path: Path) -> None:
    """TSV -> graph -> TSV reproduces the sorted original byte-for-byte."""
    original = tmp_path / "original"
    _write_canonical(original)

    graph = _FakeGraph()
    graph.import_dir(original)

    exported = tmp_path / "exported"
    result = export_to_tsv(exported, driver=graph)

    assert result.node_count == len(_NODES)
    assert result.edge_count == len(_EDGES)
    assert _relative_files(exported) == _relative_files(original)


def test_multi_label_multi_value_and_bce_survive(tmp_path: Path) -> None:
    """The required shapes survive the round-trip with their typed values."""
    original = tmp_path / "original"
    _write_canonical(original)

    graph = _FakeGraph()
    graph.import_dir(original)
    exported = tmp_path / "exported"
    export_to_tsv(exported, driver=graph)

    # Multiple labels: the dish keeps both type labels, Entity stays implicit.
    _, artifacts = read_rows(exported / "nodes" / "CulturalArtifact.tsv")
    (garum,) = artifacts
    assert garum[":LABEL"] == ["CulturalArtifact", "Dish"]
    assert ENTITY_LABEL not in garum[":LABEL"]
    # Multi-value aliases, including a part with an escaped ';'.
    _, places = read_rows(exported / "nodes" / "Place.tsv")
    athens = next(r for r in places if r["csid"] == "cs:region:athens")
    assert athens["aliases"] == ["Athína", "Athenai;polis"]
    # Tab/newline inside a value round-trip intact.
    assert athens["description"] == "City of\tAthena\nbuilt on a hill"
    # BCE dates: negative years survive as text.
    assert garum["time_start"] == "-50"
    assert next(r for r in places if r["csid"] == "cs:region:rome")[
        "time_start"
    ] == "-753"


def test_reimport_is_idempotent(tmp_path: Path) -> None:
    """Re-importing the same dataset MERGEs, so the export is unchanged."""
    original = tmp_path / "original"
    _write_canonical(original)

    graph = _FakeGraph()
    graph.import_dir(original)
    graph.import_dir(original)  # second pass must not duplicate anything.

    exported = tmp_path / "exported"
    result = export_to_tsv(exported, driver=graph)

    assert result.node_count == len(_NODES)
    assert result.edge_count == len(_EDGES)
    assert _relative_files(exported) == _relative_files(original)
