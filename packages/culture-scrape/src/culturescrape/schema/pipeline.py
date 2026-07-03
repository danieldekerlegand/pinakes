"""Drive raw acquisition records through the whole normalization pipeline.

Acquisition (Tasklist 1) writes one ``.jsonl`` file of :class:`RawRecord`\\ s per
category; the rest of Tasklist 2 turns those into the canonical node/edge TSV
family (``docs/data-model.md``). This module is the single seam that runs every
stage in order so one command can go from raw rows to validated TSV:

#. **map + normalize** — :func:`~culturescrape.schema.mapper.map_records` mints
   each row's ``csid``, stamps its label, and cleans every value into its
   canonical column;
#. **anchor** (optional) — :func:`~culturescrape.schema.anchor.anchor_rows`
   attaches Getty ids where a local dump is supplied;
#. **reconcile** (optional) —
   :func:`~culturescrape.schema.reconcile.reconcile_rows` resolves names to
   Wikidata QIDs where a reconciler is supplied;
#. **dedup** — :func:`~culturescrape.schema.merge.merge_rows` collapses
   duplicate entities to one node each;
#. **edges** — :func:`~culturescrape.schema.categorize.categorize_rows` links
   every surviving node to its category and type;
#. **sort + write** — :func:`write_result` lays the rows out as
   ``nodes/<type>.tsv`` / ``edges/<type>.tsv`` in canonical, byte-stable order.

The optional anchor and reconcile stages are off unless their inputs are passed,
so the default run is fully offline and deterministic — the same raw file always
produces byte-identical TSV.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

from culturescrape.acquire.categories import CategorySpec
from culturescrape.acquire.records import Provenance, RawRecord
from culturescrape.schema.anchor import GettyIndex, anchor_rows
from culturescrape.schema.categorize import categorize_rows
from culturescrape.schema.headers import EdgeSchema
from culturescrape.schema.ids import IdError, normalize_type
from culturescrape.schema.mapper import (
    map_linguascrape_records,
    map_records,
    node_schema,
)
from culturescrape.schema.merge import DEFAULT_FUZZY_THRESHOLD, merge_rows
from culturescrape.schema.reconcile import WikidataReconciler, reconcile_rows
from culturescrape.schema.tsvio import Row, write_edge_rows, write_node_rows

#: Acquisition adapter whose records already ship the shared canonical shape, so
#: normalization takes the short LinguaScrape path (map + dedup, no field-rename
#: or category/type synthesis) rather than the generic mapper.
LINGUASCRAPE_EXPORT_ADAPTER = "linguascrape-export"


class PipelineError(ValueError):
    """Raised when raw records cannot be read or laid out as TSV."""


@dataclass(frozen=True)
class NormalizationResult:
    """The canonical rows produced from one raw category file.

    Attributes:
        nodes: Entity rows plus the synthesized category/type nodes.
        edges: The ``MEMBER_OF_CATEGORY`` / ``INSTANCE_OF`` edge rows.
    """

    nodes: list[Row]
    edges: list[Row]


def read_raw_records(path: str | Path) -> list[RawRecord]:
    """Read a ``.jsonl`` file written by acquisition back into records.

    Each non-blank line is a ``{"fields": {...}, "provenance": {...}}`` object
    (the shape :func:`culturescrape.acquire.writer.record_to_jsonl` emits).

    Raises:
        PipelineError: If the file is unreadable, a line is not JSON, or a
            record is missing its ``fields`` / ``provenance``.
    """
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise PipelineError(f"cannot read raw records {path}: {exc}") from exc
    records: list[RawRecord] = []
    for lineno, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as exc:
            raise PipelineError(f"{path}:{lineno}: invalid JSON: {exc}") from exc
        records.append(_record_from_obj(obj, path, lineno))
    return records


def _record_from_obj(obj: object, path: Path, lineno: int) -> RawRecord:
    """Rebuild one :class:`RawRecord` from a decoded JSON object."""
    if not isinstance(obj, dict):
        raise PipelineError(f"{path}:{lineno}: expected a JSON object")
    fields = obj.get("fields")
    prov = obj.get("provenance")
    if not isinstance(fields, dict) or not isinstance(prov, dict):
        raise PipelineError(
            f"{path}:{lineno}: record needs 'fields' and 'provenance' objects"
        )
    try:
        provenance = Provenance(
            source=prov["source"],
            source_url=prov["source_url"],
            source_query=prov["source_query"],
            retrieved_at=prov["retrieved_at"],
            confidence=prov["confidence"],
            license=prov.get("license"),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise PipelineError(f"{path}:{lineno}: bad provenance: {exc}") from exc
    return RawRecord(
        fields={str(k): str(v) for k, v in fields.items()}, provenance=provenance
    )


def normalize_records(
    records: Iterable[RawRecord],
    category: CategorySpec,
    *,
    reconciler: WikidataReconciler | None = None,
    getty_index: GettyIndex | None = None,
    fuzzy_threshold: float = DEFAULT_FUZZY_THRESHOLD,
) -> NormalizationResult:
    """Run *records* through map → anchor → reconcile → dedup → edges.

    Anchoring runs only when *getty_index* is given and reconciliation only when
    *reconciler* is given; otherwise the run is offline and deterministic. The
    returned rows are unsorted — :func:`write_result` imposes the canonical
    order on write.

    A LinguaScrape export category (``source.params.adapter ==
    ``linguascrape-export``) takes a shorter path: its records already ship the
    canonical shape (their own ``:LABEL`` / ``csid`` / ``:TYPE``), so they are
    mapped via :func:`~culturescrape.schema.mapper.map_linguascrape_records`,
    split into nodes and edges, and the nodes are deduped — no field rename,
    anchoring, reconciliation, or category/type synthesis.
    """
    if _is_linguascrape_export(category):
        return _normalize_linguascrape(records, fuzzy_threshold=fuzzy_threshold)

    rows = map_records(records, category)  # map + normalize
    if getty_index is not None:
        anchor_rows(rows, getty_index)
    if reconciler is not None:
        reconcile_rows(rows, reconciler)
    merged = merge_rows(rows, fuzzy_threshold=fuzzy_threshold)  # dedup
    categorization = categorize_rows(merged, category)  # edges + structural nodes
    return NormalizationResult(
        nodes=[*merged, *categorization.nodes], edges=categorization.edges
    )


def _is_linguascrape_export(category: CategorySpec) -> bool:
    """Whether *category* is ingested through the LinguaScrape export adapter."""
    return category.source.params.get("adapter") == LINGUASCRAPE_EXPORT_ADAPTER


def _normalize_linguascrape(
    records: Iterable[RawRecord], *, fuzzy_threshold: float
) -> NormalizationResult:
    """Normalize LinguaScrape export records (already canonically shaped).

    Records are mapped via
    :func:`~culturescrape.schema.mapper.map_linguascrape_records` — which re-mints
    each ``csid`` deterministically (QID- then ``linguascrape_id``-anchored) so a
    re-run is idempotent — then split into node rows (carrying a ``:LABEL``) and
    edge rows (carrying a ``:TYPE``). Node rows are deduped; edge rows pass
    through unchanged, ready for corpus-level stitching and linking.
    """
    rows = map_linguascrape_records(records)
    node_rows = [row for row in rows if ":LABEL" in row]
    edge_rows = [row for row in rows if ":TYPE" in row]
    merged = merge_rows(node_rows, fuzzy_threshold=fuzzy_threshold)
    return NormalizationResult(nodes=merged, edges=edge_rows)


def write_result(
    result: NormalizationResult, out_dir: str | Path
) -> tuple[list[Path], list[Path]]:
    """Write *result* as ``nodes/<type>.tsv`` / ``edges/<type>.tsv`` under *out_dir*.

    Node rows are grouped into one file per primary ``:LABEL`` and edge rows into
    one file per ``:TYPE`` (each filename a slug of that type), then written in
    the schema's canonical column and row order so the output is byte-stable.
    Returns the node and edge file paths written, each sorted by path.
    """
    out_dir = Path(out_dir)
    schema = node_schema()
    edge_schema = EdgeSchema.canonical()

    node_files: list[Path] = []
    for type_name, rows in _group(result.nodes, _primary_label).items():
        path = out_dir / "nodes" / f"{_slug(type_name)}.tsv"
        write_node_rows(path, schema, rows)
        node_files.append(path)

    edge_files: list[Path] = []
    for type_name, rows in _group(result.edges, _edge_type).items():
        path = out_dir / "edges" / f"{_slug(type_name)}.tsv"
        write_edge_rows(path, edge_schema, rows)
        edge_files.append(path)

    return sorted(node_files), sorted(edge_files)


def _group(rows: Iterable[Row], key: Callable[[Row], str]) -> dict[str, list[Row]]:
    """Bucket *rows* by *key*, raising on any row *key* cannot classify."""
    grouped: dict[str, list[Row]] = {}
    for row in rows:
        grouped.setdefault(key(row), []).append(row)
    return grouped


def _primary_label(row: Row) -> str:
    """The row's first ``:LABEL`` (its type), as the node-file name source."""
    labels = row.get(":LABEL")
    if isinstance(labels, list):
        for label in labels:
            if label.strip():
                return label.strip()
    raise PipelineError("node row has no primary :LABEL to file it under")


def _edge_type(row: Row) -> str:
    """The edge's ``:TYPE``, as the edge-file name source."""
    value = row.get(":TYPE")
    if isinstance(value, str) and value.strip():
        return value.strip()
    raise PipelineError("edge row has no :TYPE to file it under")


def _slug(type_name: str) -> str:
    """Slugify *type_name* into a filesystem-safe TSV file stem."""
    try:
        return normalize_type(type_name)
    except IdError as exc:
        raise PipelineError(f"cannot derive a file name from {type_name!r}") from exc
