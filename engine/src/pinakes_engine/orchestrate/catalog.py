"""A discoverable index of every category in a corpus.

A job run leaves per-category outputs scattered across stage directories
(``acquire/``, ``normalize/``, ``link/``, ``export/``). The *catalog* is the
flat, top-level answer to "what is in this corpus?": one row per category with
its identity (id, label, source), its size (node and edge counts), the
dimensions its graph covers, when it last ran, and a one-line provenance
summary (which sources produced it and how many records/errors).

The catalog is stored as ``<output_root>/catalog.json`` and is *upserted* after
every job run: a category that ran this time replaces its entry, while
categories from previous runs that this job did not touch are left in place. So
the catalog accumulates into a corpus-wide index even when jobs are run
piecemeal.

:func:`update_catalog` rebuilds the entries for one :class:`~pinakes_engine.
orchestrate.runner.JobRun` and merges them into the file;
:func:`load_catalog` reads it back; :func:`render_table` renders it for the CLI.
A category is catalogued only once it has a normalized (or linked) dataset to
measure — a category that failed before producing one keeps whatever entry an
earlier run recorded, rather than being clobbered with an empty row.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

from pinakes_engine.ontology.metrics import UNKNOWN_DIMENSION, metrics_for_dataset

if TYPE_CHECKING:
    from pinakes_engine.orchestrate.jobs import Job
    from pinakes_engine.orchestrate.runner import CategoryRun, JobRun

#: Filename of the catalog written under a job's output root.
CATALOG_NAME = "catalog.json"


@dataclass(frozen=True)
class ProvenanceSummary:
    """A compact account of how a category's records were acquired.

    Attributes:
        adapter: The acquisition adapter that produced the records (empty when
            the job did not run an ``acquire`` stage).
        sources: Distinct ``provenance.source`` values, sorted.
        records: Records successfully acquired.
        errors: Records that failed to be produced or processed.
    """

    adapter: str
    sources: tuple[str, ...]
    records: int
    errors: int

    def to_dict(self) -> dict[str, object]:
        return {
            "adapter": self.adapter,
            "sources": list(self.sources),
            "records": self.records,
            "errors": self.errors,
        }

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> ProvenanceSummary:
        return cls(
            adapter=str(data.get("adapter", "")),
            sources=_as_str_tuple(data.get("sources")),
            records=_as_int(data.get("records")),
            errors=_as_int(data.get("errors")),
        )


@dataclass(frozen=True)
class CatalogEntry:
    """One category's row in the corpus catalog.

    Attributes:
        id: Stable category id.
        label: The category's node label(s).
        source: The category's ``source.type``.
        node_count: Distinct nodes in the category's dataset.
        edge_count: Edge rows in the category's dataset.
        dimensions: Ontology dimensions the dataset's edges actually cover,
            sorted (unregistered edge types are excluded).
        last_run: ISO-8601 timestamp of the run that produced this entry.
        provenance: How the records were acquired.
    """

    id: str
    label: str
    source: str
    node_count: int
    edge_count: int
    dimensions: tuple[str, ...]
    last_run: str
    provenance: ProvenanceSummary

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "label": self.label,
            "source": self.source,
            "node_count": self.node_count,
            "edge_count": self.edge_count,
            "dimensions": list(self.dimensions),
            "last_run": self.last_run,
            "provenance": self.provenance.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> CatalogEntry:
        prov = data.get("provenance", {})
        return cls(
            id=str(data["id"]),
            label=str(data.get("label", "")),
            source=str(data.get("source", "")),
            node_count=_as_int(data.get("node_count")),
            edge_count=_as_int(data.get("edge_count")),
            dimensions=_as_str_tuple(data.get("dimensions")),
            last_run=str(data.get("last_run", "")),
            provenance=ProvenanceSummary.from_dict(
                prov if isinstance(prov, dict) else {}
            ),
        )


@dataclass(frozen=True)
class Catalog:
    """The corpus index: a set of :class:`CatalogEntry` rows keyed by id."""

    entries: tuple[CatalogEntry, ...]

    def with_updated(self, updated: dict[str, CatalogEntry]) -> Catalog:
        """Return a copy with *updated* entries upserted by id, sorted by id.

        Existing ids in *updated* are replaced; ids absent from it are kept; new
        ids are added. The result is ordered by id for a stable file and table.
        """
        merged = {entry.id: entry for entry in self.entries}
        merged.update(updated)
        return Catalog(tuple(merged[key] for key in sorted(merged)))

    def to_json(self) -> str:
        return (
            json.dumps(
                {"categories": [entry.to_dict() for entry in self.entries]},
                indent=2,
                sort_keys=False,
            )
            + "\n"
        )


def catalog_path(output_root: Path) -> Path:
    """Return the catalog file path under *output_root*."""
    return output_root / CATALOG_NAME


def load_catalog(path: str | Path) -> Catalog:
    """Load the catalog at *path*, which may be the file or its parent directory.

    A missing or unreadable catalog reads as an empty one, so a first run and a
    directory that was never catalogued both yield ``Catalog(())``.
    """
    path = Path(path)
    if path.is_dir():
        path = catalog_path(path)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return Catalog(())
    categories = data.get("categories", []) if isinstance(data, dict) else []
    entries = [
        CatalogEntry.from_dict(item)
        for item in categories
        if isinstance(item, dict) and "id" in item
    ]
    return Catalog(tuple(entries))


def update_catalog(job: Job, run: JobRun, *, now: datetime) -> Catalog:
    """Merge *run*'s categories into ``<output_root>/catalog.json`` and return it.

    One entry is built per category that produced a measurable dataset this run
    (normalized, or linked when the job linked); its node/edge counts and
    covered dimensions are read from that dataset and its provenance from the
    acquisition report. *now* stamps the entries' ``last_run`` — except for a
    category whose dataset stage was *skipped* (its inputs were unchanged), which
    keeps the ``last_run`` an earlier run recorded, so a scheduled ``--since``
    refresh that rides past untouched categories does not reset their clock.
    Categories the job did not touch keep their existing entries.
    """
    timestamp = now.isoformat()
    existing = load_catalog(job.output_root)
    prior = {entry.id: entry for entry in existing.entries}
    updates: dict[str, CatalogEntry] = {}
    specs = {spec.id: spec for spec in job.categories}
    for category in run.categories:
        spec = specs.get(category.category_id)
        if spec is None:  # pragma: no cover - run categories always come from the job
            continue
        entry = _build_entry(
            category,
            spec.label,
            spec.source.type,
            timestamp,
            prior.get(category.category_id),
        )
        if entry is not None:
            updates[entry.id] = entry

    catalog = existing.with_updated(updates)
    output_root = job.output_root
    output_root.mkdir(parents=True, exist_ok=True)
    catalog_path(output_root).write_text(catalog.to_json(), encoding="utf-8")
    return catalog


def _build_entry(
    category: CategoryRun,
    label: str,
    source: str,
    timestamp: str,
    prior: CatalogEntry | None,
) -> CatalogEntry | None:
    """Build a catalog entry for *category*, or ``None`` if it has no dataset.

    A category whose dataset stage was skipped (unchanged inputs) keeps the
    ``last_run`` from its *prior* entry rather than being re-stamped with
    *timestamp*, so an incremental run does not falsely freshen it.
    """
    by_stage = {result.stage: result for result in category.stages}
    dataset = by_stage.get("link") or by_stage.get("normalize")
    if dataset is None or not dataset.output_dir.is_dir():
        return None

    metrics = metrics_for_dataset(dataset.output_dir)
    dimensions = tuple(
        dim for dim in metrics.edges_by_dimension if dim != UNKNOWN_DIMENSION
    )
    acquire = by_stage.get("acquire")
    provenance = _read_provenance(acquire.output_dir if acquire else None)
    last_run = prior.last_run if dataset.skipped and prior is not None else timestamp
    return CatalogEntry(
        id=category.category_id,
        label=label,
        source=source,
        node_count=metrics.node_count,
        edge_count=metrics.edge_count,
        dimensions=dimensions,
        last_run=last_run,
        provenance=provenance,
    )


def _read_provenance(acquire_dir: Path | None) -> ProvenanceSummary:
    """Summarise the acquisition report under *acquire_dir* (empty if absent)."""
    empty = ProvenanceSummary(adapter="", sources=(), records=0, errors=0)
    if acquire_dir is None:
        return empty
    try:
        data = json.loads(
            (acquire_dir / "records.report.json").read_text(encoding="utf-8")
        )
    except (OSError, json.JSONDecodeError):
        return empty
    sources = data.get("distinct_sources", [])
    return ProvenanceSummary(
        adapter=str(data.get("adapter", "")),
        sources=tuple(str(s) for s in sources) if isinstance(sources, list) else (),
        records=int(data.get("row_count", 0)),
        errors=int(data.get("error_count", 0)),
    )


def render_table(catalog: Catalog) -> str:
    """Render *catalog* as an aligned, human-readable table.

    An empty catalog renders as a single explanatory line so the CLI never
    prints a bare header with no rows.
    """
    if not catalog.entries:
        return "catalog is empty (no categories have been run yet)"

    headers = (
        "id",
        "label",
        "source",
        "nodes",
        "edges",
        "dimensions",
        "last run",
        "provenance",
    )
    rows = [headers]
    for entry in catalog.entries:
        rows.append(
            (
                entry.id,
                entry.label,
                entry.source,
                str(entry.node_count),
                str(entry.edge_count),
                ",".join(entry.dimensions) or "-",
                entry.last_run,
                _provenance_cell(entry.provenance),
            )
        )

    widths = [max(len(row[col]) for row in rows) for col in range(len(headers))]
    lines = [_format_row(rows[0], widths), _rule(widths)]
    lines.extend(_format_row(row, widths) for row in rows[1:])
    return "\n".join(lines)


def _provenance_cell(provenance: ProvenanceSummary) -> str:
    """One-cell provenance gloss: sources plus record/error tallies."""
    sources = ",".join(provenance.sources) or "-"
    errors = f", {provenance.errors} err" if provenance.errors else ""
    return f"{sources} ({provenance.records} rec{errors})"


def _format_row(cells: tuple[str, ...], widths: list[int]) -> str:
    return "  ".join(
        cell.ljust(width) for cell, width in zip(cells, widths, strict=True)
    )


def _rule(widths: list[int]) -> str:
    return "  ".join("-" * width for width in widths)


def _as_int(value: object) -> int:
    """Coerce a JSON-loaded value to ``int``, treating anything unusable as 0."""
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _as_str_tuple(value: object) -> tuple[str, ...]:
    """Coerce a JSON-loaded value to a tuple of strings (empty if not a list)."""
    return tuple(str(item) for item in value) if isinstance(value, list) else ()
