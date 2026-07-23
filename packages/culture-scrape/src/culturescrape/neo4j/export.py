"""Export a live Neo4j graph back to the canonical TSV dataset.

This closes the round-trip opened by ``admin_import.py`` / ``load_csv.py``:
having seeded a graph from ``nodes/*.tsv`` and ``edges/*.tsv``, we pull it back
out into byte-stable canonical TSV. Rather than depend on a server-side APOC
install (``apoc.export.csv.*`` would need ``apoc.export.file_enabled`` and writes
to the *server's* filesystem), this uses a **driver-side cursor export**: the
exporter streams nodes and relationships over the Bolt connection, then hands the
resulting canonical graph to the embedded agora translation engine
(``culturescrape.translation.to_neo4j_export``) to render. Reading the graph is
ours; *rendering the format* is the engine's — per the pinakes:42 seam spec, this
module no longer builds canonical TSV by hand. The result is identical in shape to
what APOC would emit — tab-delimited, canonical headers — and needs no server
configuration.

The two queries return primitives only (``labels(n)``, ``properties(n)``,
``type(r)``) so the export depends on nothing but the driver cursor and is
trivial to exercise against a mocked driver. The engine groups and names files by
type, exactly as the hand-written writers did:

* nodes go to ``nodes/<label>.tsv`` keyed on their primary (alphabetically first)
  type label, with the :data:`~culturescrape.neo4j.constraints.ENTITY_LABEL`
  base label dropped and the remaining labels sorted in the ``:LABEL`` cell;
* relationships go to ``edges/<type>.tsv`` keyed on their ``:TYPE``.

Every file carries the full canonical header (``headers.py`` /
``shared/canonical-schema.json``) so typed property columns keep their ``:int`` /
``:float`` suffixes and provenance columns are always present, and rows come back
in canonical sort order (``csid`` for nodes; ``:START_ID, :END_ID, :TYPE`` for
edges).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from culturescrape.neo4j import connect
from culturescrape.neo4j.constraints import ENTITY_LABEL
from culturescrape.schema.tsvio import MULTI_VALUE_KEYS
from culturescrape.translation import graph_json, to_neo4j_export

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


def _node_row(labels: list[str], props: Mapping[str, Any]) -> _Row:
    """Map one graph node to a canonical row.

    The shared :data:`ENTITY_LABEL` anchor is dropped and the remaining labels
    are sorted into the ``:LABEL`` cell; the first is the one the engine shards
    the file on. A node carrying *only* the anchor has no home file, which is a
    corpus error rather than a rendering one — hence the guard here.
    Multi-value properties (``aliases``) stay lists; every other value is
    stringified.
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
    return row


def _edge_row(
    start: Any, end: Any, edge_type: Any, props: Mapping[str, Any]
) -> _Row:
    """Map one relationship to a canonical row."""
    row: _Row = {
        ":START_ID": _scalar(start),
        ":END_ID": _scalar(end),
        ":TYPE": _scalar(edge_type),
    }
    for key, value in props.items():
        row[key] = _scalar(value)
    return row


def _read_nodes(driver: Driver) -> list[_Row]:
    """Stream every node over the cursor into canonical rows."""
    with driver.session() as session:
        return [
            _node_row(record["labels"], record["props"])
            for record in session.run(NODE_QUERY)
        ]


def _read_edges(driver: Driver) -> list[_Row]:
    """Stream every relationship over the cursor into canonical rows."""
    with driver.session() as session:
        return [
            _edge_row(
                record["start"], record["end"], record["type"], record["props"]
            )
            for record in session.run(EDGE_QUERY)
        ]


def _write_shards(out_dir: Path, rendered: Mapping[str, str]) -> list[Path]:
    """Write each ``{stem: document}`` shard the engine rendered, sorted by stem."""
    written: list[Path] = []
    if rendered:
        out_dir.mkdir(parents=True, exist_ok=True)
    for stem in sorted(rendered):
        path = out_dir / f"{stem}.tsv"
        path.write_text(rendered[stem], encoding="utf-8", newline="")
        written.append(path)
    return written


def export_to_tsv(
    out_dir: str | Path,
    *,
    config: Mapping[str, Any] | None = None,
    env: Mapping[str, str] | None = None,
    driver: Driver | None = None,
) -> ExportResult:
    """Export a connected Neo4j graph to canonical TSV under *out_dir*.

    Streams every node and relationship over the driver cursor and hands them to
    the embedded translation engine, which shards and renders them into
    ``<out_dir>/nodes/<label>.tsv`` and ``<out_dir>/edges/<type>.tsv`` with the
    canonical schema header and canonical sort order. Nodes and edges are read
    and rendered in **separate passes** — two single-family calls rather than one
    whole-graph call — so the node rows are released before the edge rows are
    read and peak memory stays one family, not the whole graph. When *driver* is
    given it is used as-is (and left open for the caller); otherwise a driver is
    opened from *config*/*env* via :func:`culturescrape.neo4j.connect` and closed
    before returning.

    Returns:
        An :class:`ExportResult` listing the files written and row counts.
    """
    out_path = Path(out_dir)
    owned = driver is None
    handle = connect(config, env=env) if driver is None else driver
    try:
        rendered = to_neo4j_export(graph_json(_read_nodes(handle), []))
        node_files = _write_shards(out_path / "nodes", rendered["node_files"])
        node_count = int(rendered["node_count"])
        del rendered  # release the node documents before reading edges

        rendered = to_neo4j_export(graph_json([], _read_edges(handle)))
        edge_files = _write_shards(out_path / "edges", rendered["edge_files"])
        edge_count = int(rendered["edge_count"])
    finally:
        if owned:
            handle.close()

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
