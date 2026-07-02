"""Export a live Neo4j graph back to the canonical TSV dataset.

This closes the round-trip opened by ``admin_import.py`` / ``load_csv.py``:
having seeded a graph from ``nodes/*.tsv`` and ``edges/*.tsv``, we pull it back
out into byte-stable canonical TSV. Rather than depend on a server-side APOC
install (``apoc.export.csv.*`` would need ``apoc.export.file_enabled`` and writes
to the *server's* filesystem), this uses a **driver-side cursor export**: the
exporter streams nodes and relationships over the Bolt connection and writes the
files locally with the same lossless writers the pipeline uses
(``schema/tsvio.py``). The result is identical in shape to what APOC would emit —
tab-delimited, canonical headers — and needs no server configuration.

The two queries return primitives only (``labels(n)``, ``properties(n)``,
``type(r)``) so the export depends on nothing but the driver cursor and is
trivial to exercise against a mocked driver. Files are grouped and named by type:

* nodes go to ``nodes/<label>.tsv`` keyed on their primary (alphabetically first)
  type label, with the :data:`~culturescrape.neo4j.constraints.ENTITY_LABEL`
  base label dropped and the remaining labels sorted in the ``:LABEL`` cell;
* relationships go to ``edges/<type>.tsv`` keyed on their ``:TYPE``.

Every file carries the full canonical header (``headers.py``) so typed property
columns keep their ``:int`` / ``:float`` suffixes and provenance columns are
always present, and rows are written in canonical sort order (``csid`` for nodes;
``:START_ID, :END_ID, :TYPE`` for edges) by the TSV writers.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from culturescrape.neo4j import connect
from culturescrape.neo4j.constraints import ENTITY_LABEL
from culturescrape.schema.headers import EdgeSchema, NodeSchema
from culturescrape.schema.tsvio import (
    MULTI_VALUE_KEYS,
    write_edge_rows,
    write_node_rows,
)

if TYPE_CHECKING:
    from neo4j import Driver

#: Cypher streaming every node as ``(labels, properties)`` primitive pairs.
NODE_QUERY = "MATCH (n) RETURN labels(n) AS labels, properties(n) AS props"

#: Cypher streaming every relationship as endpoint ids, type, and properties.
EDGE_QUERY = (
    "MATCH (a)-[r]->(b) "
    "RETURN a.csid AS start, b.csid AS end, type(r) AS type, "
    "properties(r) AS props"
)


class Neo4jExportError(ValueError):
    """Raised when graph data cannot be mapped back to canonical TSV."""


@dataclass(frozen=True)
class ExportResult:
    """What a :func:`export_to_tsv` run wrote out."""

    node_files: tuple[Path, ...]
    edge_files: tuple[Path, ...]
    node_count: int
    edge_count: int


#: A decoded TSV row as the writers accept it (scalars as str, lists for
#: multi-value columns).
_Row = dict[str, str | list[str]]


def _scalar(value: Any) -> str:
    """Render a Neo4j-returned scalar as its canonical TSV string.

    The driver returns ints/floats/strings natively; stringifying recovers the
    text form the typed header (``time_start:int``, ``lat:float``) is read back
    into on import.
    """
    return str(value)


def _node_row(labels: list[str], props: Mapping[str, Any]) -> tuple[str, _Row]:
    """Map one graph node to its primary type label and a writable TSV row.

    The shared :data:`ENTITY_LABEL` anchor is dropped and the remaining labels
    are sorted; the first becomes the file/type key and all of them populate the
    ``:LABEL`` cell. Multi-value properties (``aliases``) stay lists; every other
    value is stringified.
    """
    type_labels = sorted(label for label in labels if label != ENTITY_LABEL)
    if not type_labels:
        csid = props.get("csid", "<unknown>")
        raise Neo4jExportError(
            f"node {csid!r} has no type label beyond {ENTITY_LABEL!r}"
        )
    row: _Row = {":LABEL": type_labels}
    for key, value in props.items():
        if key in MULTI_VALUE_KEYS:
            row[key] = [str(item) for item in value]
        else:
            row[key] = _scalar(value)
    return type_labels[0], row


def _edge_row(
    start: Any, end: Any, edge_type: Any, props: Mapping[str, Any]
) -> tuple[str, _Row]:
    """Map one relationship to its ``:TYPE`` and a writable TSV row."""
    row: _Row = {
        ":START_ID": _scalar(start),
        ":END_ID": _scalar(end),
        ":TYPE": _scalar(edge_type),
    }
    for key, value in props.items():
        row[key] = _scalar(value)
    return _scalar(edge_type), row


def _group(driver: Driver) -> tuple[dict[str, list[_Row]], dict[str, list[_Row]]]:
    """Stream the graph and bucket rows by node label and edge type."""
    nodes: dict[str, list[_Row]] = {}
    edges: dict[str, list[_Row]] = {}
    with driver.session() as session:
        for record in session.run(NODE_QUERY):
            label, row = _node_row(record["labels"], record["props"])
            nodes.setdefault(label, []).append(row)
        for record in session.run(EDGE_QUERY):
            edge_type, row = _edge_row(
                record["start"], record["end"], record["type"], record["props"]
            )
            edges.setdefault(edge_type, []).append(row)
    return nodes, edges


def export_to_tsv(
    out_dir: str | Path,
    *,
    config: Mapping[str, Any] | None = None,
    env: Mapping[str, str] | None = None,
    driver: Driver | None = None,
) -> ExportResult:
    """Export a connected Neo4j graph to canonical TSV under *out_dir*.

    Streams every node and relationship over the driver cursor, groups them into
    ``<out_dir>/nodes/<label>.tsv`` and ``<out_dir>/edges/<type>.tsv``, and writes
    each group with the canonical schema header and canonical sort order. When
    *driver* is given it is used as-is (and left open for the caller); otherwise a
    driver is opened from *config*/*env* via
    :func:`culturescrape.neo4j.connect` and closed before returning.

    Returns:
        An :class:`ExportResult` listing the files written and row counts.
    """
    out_path = Path(out_dir)
    owned = driver is None
    handle = connect(config, env=env) if driver is None else driver
    try:
        nodes, edges = _group(handle)
    finally:
        if owned:
            handle.close()

    node_schema = NodeSchema.canonical()
    edge_schema = EdgeSchema.canonical()

    node_files: list[Path] = []
    node_count = 0
    for label in sorted(nodes):
        path = out_path / "nodes" / f"{label}.tsv"
        node_count += write_node_rows(path, node_schema, nodes[label])
        node_files.append(path)

    edge_files: list[Path] = []
    edge_count = 0
    for edge_type in sorted(edges):
        path = out_path / "edges" / f"{edge_type}.tsv"
        edge_count += write_edge_rows(path, edge_schema, edges[edge_type])
        edge_files.append(path)

    return ExportResult(
        node_files=tuple(node_files),
        edge_files=tuple(edge_files),
        node_count=node_count,
        edge_count=edge_count,
    )


__all__ = [
    "EDGE_QUERY",
    "NODE_QUERY",
    "ExportResult",
    "Neo4jExportError",
    "export_to_tsv",
]
