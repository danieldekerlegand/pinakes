"""The read-only corpus data-access layer the explorer views share (T7-US-002).

Every view reads one :class:`Corpus`: the canonical node/edge rows plus the
catalog, metrics, and QA artifacts the pipeline wrote (the corpus-wide
``qa.json`` and the per-category reports under ``qa/<id>.qa.json``), loaded once
and indexed for lookup by ``csid`` and by ``:LABEL`` / ``:TYPE``. It accepts
either a full job output root (``out/<job>/``, whose corpus lives in ``corpus/``
with ``catalog.json`` and the ``qa/`` reports beside it) or a bare corpus
directory (one holding ``nodes/`` and ``edges/``). Nothing here writes; the
explorer is strictly read-only.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from culturescrape.ontology.metrics import (
    UNKNOWN_DIMENSION,
    GraphMetrics,
    metrics_for_dataset,
)
from culturescrape.ontology.registry import get as get_relation
from culturescrape.orchestrate.catalog import Catalog, CatalogEntry, load_catalog
from culturescrape.orchestrate.qa import QA_REPORT_SUFFIX
from culturescrape.schema.headers import Column
from culturescrape.schema.tsvio import Row, TsvError, read_rows


class CorpusError(ValueError):
    """Raised when a source directory holds no readable corpus."""


@dataclass(frozen=True)
class Dataset:
    """One side of the corpus (nodes or edges): its header columns and rows."""

    columns: tuple[Column, ...]
    rows: tuple[Row, ...]


@dataclass(frozen=True)
class Neighborhood:
    """The nodes and edges within *depth* hops of a seed ``csid`` (BFS).

    *center* is the seed; *nodes* always includes it. *edges* holds every edge
    whose endpoints both fall inside *nodes*, so the result is self-contained and
    can be rendered without any further lookups.
    """

    center: str
    depth: int
    nodes: tuple[Row, ...]
    edges: tuple[Row, ...]


#: Node fields the global search scans, in tie-break priority order: the two
#: identifiers first, then the human-readable name.
SEARCH_FIELDS: tuple[str, ...] = ("csid", "wikidata_qid", "name")

#: Default cap on the number of ranked hits :meth:`Corpus.search` returns.
SEARCH_LIMIT = 50


@dataclass(frozen=True)
class SearchHit:
    """One ranked global-search result for a node.

    *field* names which of :data:`SEARCH_FIELDS` matched and *rank* is the match
    tier (0 exact, 1 prefix, 2 substring); together they order the results.
    """

    csid: str
    name: str
    label: str
    qid: str
    field: str
    rank: int


def _match_rank(value: str, needle: str) -> int | None:
    """The match tier of *needle* in *value*: 0 exact, 1 prefix, 2 substring.

    Both are compared case-insensitively; *needle* must already be casefolded.
    Returns ``None`` when *value* is empty or holds no match.
    """
    folded = value.casefold()
    if not folded:
        return None
    if folded == needle:
        return 0
    if folded.startswith(needle):
        return 1
    if needle in folded:
        return 2
    return None


@dataclass(frozen=True)
class QaSummary:
    """A typed digest of a ``qa.json`` report."""

    ok: bool
    node_count: int
    edge_count: int
    violations: tuple[str, ...]
    failed_keys: tuple[str, ...] = ()

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> QaSummary:
        gates = [g for g in data.get("gates", []) if isinstance(g, dict)]
        failed = [g for g in gates if not g.get("passed", True)]
        violations = tuple(str(g.get("label") or g.get("key", "")) for g in failed)
        return cls(
            ok=bool(data.get("ok", not violations)),
            node_count=int(data.get("node_count", 0)),
            edge_count=int(data.get("edge_count", 0)),
            violations=violations,
            failed_keys=tuple(str(g.get("key", "")) for g in failed),
        )


#: A category's scraping completeness verdict.
STATUS_COMPLETE = "complete"
STATUS_INCOMPLETE = "incomplete"
STATUS_FAILED = "failed"
STATUS_NEVER_RUN = "never_run"

#: Worst-first ordering used to surface the categories needing attention first.
STATUS_ORDER = {
    STATUS_FAILED: 0,
    STATUS_NEVER_RUN: 1,
    STATUS_INCOMPLETE: 2,
    STATUS_COMPLETE: 3,
}

#: Categories at or below this node count are flagged as too sparse to be done.
LOW_NODE_COUNT = 1

#: The QA gate key that grades row-level provenance completeness.
PROVENANCE_GATE_KEY = "provenance_completeness"


@dataclass(frozen=True)
class CategoryStatus:
    """One category's row in the scraping-completeness dashboard.

    Built by joining a catalog entry (size, last run, fetch provenance) with its
    per-category QA report (gate violations). ``status`` is the operator-facing
    verdict; ``reasons`` explains why a non-complete category was flagged.
    """

    category_id: str
    label: str
    status: str
    node_count: int
    edge_count: int
    violations: tuple[str, ...]
    last_run: str
    errors: int
    provenance_complete: bool
    reasons: tuple[str, ...]


def _provenance_complete(
    entry: CatalogEntry | None, report: QaSummary | None
) -> bool:
    """Whether *entry*'s records carry complete provenance.

    Prefers the QA provenance gate when a report graded it; otherwise falls back
    to the catalog's acquisition summary (records acquired with no fetch errors).
    """
    if report is not None and report.failed_keys:
        return PROVENANCE_GATE_KEY not in report.failed_keys
    if entry is not None:
        prov = entry.provenance
        return prov.errors == 0 and prov.records > 0 and bool(prov.sources)
    return False


def _category_status(
    category_id: str, entry: CatalogEntry | None, report: QaSummary | None
) -> CategoryStatus:
    """Classify one category from its catalog entry and QA report."""
    node_count = entry.node_count if entry else (report.node_count if report else 0)
    edge_count = entry.edge_count if entry else (report.edge_count if report else 0)
    violations = report.violations if report else ()
    errors = entry.provenance.errors if entry else 0

    reasons: list[str] = []
    if entry is None:
        status = STATUS_NEVER_RUN
        reasons.append("absent from the catalog")
    else:
        if errors > 0:
            reasons.append(f"{errors} fetch error(s)")
        if node_count <= LOW_NODE_COUNT:
            reasons.append("zero or low node count")
        if violations:
            reasons.append(f"{len(violations)} QA gate violation(s)")
        if errors > 0:
            status = STATUS_FAILED
        elif reasons:
            status = STATUS_INCOMPLETE
        else:
            status = STATUS_COMPLETE

    return CategoryStatus(
        category_id=category_id,
        label=entry.label if entry else "",
        status=status,
        node_count=node_count,
        edge_count=edge_count,
        violations=violations,
        last_run=entry.last_run if entry else "",
        errors=errors,
        provenance_complete=_provenance_complete(entry, report),
        reasons=tuple(reasons),
    )


class Corpus:
    """A loaded corpus with lookups by csid, label, and edge type."""

    def __init__(
        self,
        *,
        source: Path,
        corpus_dir: Path,
        job_root: Path | None,
        nodes: Dataset,
        edges: Dataset,
        catalog: Catalog | None,
        metrics: GraphMetrics | None,
        qa: QaSummary | None,
        reports: dict[str, QaSummary],
    ) -> None:
        self.source = source
        self.corpus_dir = corpus_dir
        self.job_root = job_root
        self.nodes = nodes
        self.edges = edges
        self.catalog = catalog
        self.metrics = metrics
        self.qa = qa
        self.reports = reports

        self._by_csid: dict[str, Row] = {}
        self._by_label: dict[str, list[Row]] = {}
        for row in nodes.rows:
            csid = scalar(row, "csid")
            if csid:
                self._by_csid[csid] = row
            self._by_label.setdefault(first_label(row), []).append(row)

        self._by_type: dict[str, list[Row]] = {}
        self._out: dict[str, list[Row]] = {}
        self._in: dict[str, list[Row]] = {}
        for edge in edges.rows:
            self._by_type.setdefault(scalar(edge, ":TYPE"), []).append(edge)
            self._out.setdefault(scalar(edge, ":START_ID"), []).append(edge)
            self._in.setdefault(scalar(edge, ":END_ID"), []).append(edge)

    @property
    def name(self) -> str:
        """A display name for the corpus (the source directory's name)."""
        return self.source.name

    def node(self, csid: str) -> Row | None:
        """Return the node row for *csid*, or ``None``."""
        return self._by_csid.get(csid)

    def labels(self) -> list[str]:
        """Distinct primary node labels, sorted."""
        return sorted(label for label in self._by_label if label)

    def types(self) -> list[str]:
        """Distinct edge ``:TYPE`` values, sorted."""
        return sorted(type_ for type_ in self._by_type if type_)

    def nodes_for_label(self, label: str) -> list[Row]:
        """Node rows whose primary label is *label*."""
        return self._by_label.get(label, [])

    def edges_for_type(self, type_: str) -> list[Row]:
        """Edge rows whose ``:TYPE`` is *type_*."""
        return self._by_type.get(type_, [])

    def incident_edges(self, csid: str) -> tuple[list[Row], list[Row]]:
        """The (outgoing, incoming) edge rows touching *csid*."""
        return self._out.get(csid, []), self._in.get(csid, [])

    def neighborhood(self, csid: str, depth: int = 1) -> Neighborhood | None:
        """The nodes and edges within *depth* hops of *csid*, breadth-first.

        Returns ``None`` when *csid* names no node. ``depth`` is clamped to at
        least zero (a lone node). Edges are kept when both endpoints are inside
        the visited set, so the graph view can render the result on its own.
        """
        if self.node(csid) is None:
            return None
        depth = max(depth, 0)
        visited = {csid}
        frontier = {csid}
        for _ in range(depth):
            nxt: set[str] = set()
            for cur in frontier:
                out_edges, in_edges = self.incident_edges(cur)
                for edge in out_edges:
                    nxt.add(scalar(edge, ":END_ID"))
                for edge in in_edges:
                    nxt.add(scalar(edge, ":START_ID"))
            frontier = {c for c in nxt if c in self._by_csid and c not in visited}
            if not frontier:
                break
            visited |= frontier
        nodes = tuple(self._by_csid[c] for c in self._by_csid if c in visited)
        edges = tuple(
            edge
            for edge in self.edges.rows
            if scalar(edge, ":START_ID") in visited
            and scalar(edge, ":END_ID") in visited
        )
        return Neighborhood(center=csid, depth=depth, nodes=nodes, edges=edges)

    def search(self, query: str, limit: int = SEARCH_LIMIT) -> list[SearchHit]:
        """Rank nodes matching *query* across :data:`SEARCH_FIELDS`.

        Each node contributes at most one hit, taken from its strongest match
        (lowest tier, then earliest field). Hits are ordered by tier, then field
        priority, then name, and truncated to *limit*. An empty query yields no
        hits.
        """
        needle = query.strip().casefold()
        if not needle:
            return []
        hits: list[SearchHit] = []
        for row in self.nodes.rows:
            best: tuple[int, int, str] | None = None
            for index, field in enumerate(SEARCH_FIELDS):
                rank = _match_rank(scalar(row, field), needle)
                if rank is not None and (
                    best is None or (rank, index) < (best[0], best[1])
                ):
                    best = (rank, index, field)
            if best is None:
                continue
            hits.append(
                SearchHit(
                    csid=scalar(row, "csid"),
                    name=scalar(row, "name"),
                    label=first_label(row),
                    qid=scalar(row, "wikidata_qid"),
                    field=best[2],
                    rank=best[0],
                )
            )
        hits.sort(
            key=lambda h: (
                h.rank,
                SEARCH_FIELDS.index(h.field),
                h.name.casefold(),
                h.csid,
            )
        )
        return hits[:limit]

    def categories(self) -> list[str]:
        """Category ids that have a per-category QA report, sorted."""
        return sorted(self.reports)

    def report(self, category_id: str) -> QaSummary | None:
        """The per-category QA report for *category_id*, or ``None``."""
        return self.reports.get(category_id)

    def completeness(self) -> list[CategoryStatus]:
        """One :class:`CategoryStatus` per known category, worst status first.

        The category universe is the union of the catalog's entries and the
        per-category QA reports, so a category that was graded but never made it
        into the catalog still surfaces (flagged ``never_run``).
        """
        entries = (
            {entry.id: entry for entry in self.catalog.entries}
            if self.catalog is not None
            else {}
        )
        ids = set(entries) | set(self.reports)
        statuses = [
            _category_status(cid, entries.get(cid), self.reports.get(cid))
            for cid in ids
        ]
        statuses.sort(key=lambda s: (STATUS_ORDER.get(s.status, 99), s.category_id))
        return statuses


def load_corpus(source: str | Path) -> Corpus:
    """Load (and cache) the corpus rooted at *source*.

    Raises:
        CorpusError: If *source* is not a directory or holds no corpus.
    """
    return _load_corpus(str(Path(source).resolve()))


@lru_cache(maxsize=8)
def _load_corpus(resolved: str) -> Corpus:
    source = Path(resolved)
    if not source.is_dir():
        raise CorpusError(f"{source} is not a directory")
    corpus_dir, job_root = _resolve(source)
    nodes = _read_dir(corpus_dir / "nodes")
    edges = _read_dir(corpus_dir / "edges")
    return Corpus(
        source=source,
        corpus_dir=corpus_dir,
        job_root=job_root,
        nodes=nodes,
        edges=edges,
        catalog=_load_catalog(job_root),
        metrics=_load_metrics(corpus_dir),
        qa=_load_qa(corpus_dir),
        reports=_load_reports(job_root),
    )


def _resolve(source: Path) -> tuple[Path, Path | None]:
    """Locate the corpus dir under *source*, plus the job root if there is one."""
    if (source / "corpus" / "nodes").is_dir():
        return source / "corpus", source
    if (source / "nodes").is_dir():
        return source, None
    raise CorpusError(
        f"{source} holds no corpus: expected a 'corpus/nodes' subdir "
        "(job output root) or a 'nodes' subdir (corpus dataset)"
    )


def _read_dir(directory: Path) -> Dataset:
    """Read and concatenate every ``*.tsv`` under *directory* into one Dataset."""
    columns: tuple[Column, ...] = ()
    rows: list[Row] = []
    if directory.is_dir():
        for path in sorted(directory.glob("*.tsv")):
            file_columns, file_rows = read_rows(path)
            if not columns:
                columns = file_columns
            rows.extend(file_rows)
    return Dataset(columns=columns, rows=tuple(rows))


def _load_catalog(job_root: Path | None) -> Catalog | None:
    if job_root is None:
        return None
    path = job_root / "catalog.json"
    return load_catalog(path) if path.is_file() else None


def _load_metrics(corpus_dir: Path) -> GraphMetrics | None:
    """Load metrics.json if present, else compute from the dataset; never fail."""
    path = corpus_dir / "metrics.json"
    if path.is_file():
        try:
            return _metrics_from_dict(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError, KeyError, ValueError):
            return None
    try:
        return metrics_for_dataset(corpus_dir)
    except (TsvError, OSError, ValueError):
        return None


def _metrics_from_dict(data: dict[str, Any]) -> GraphMetrics:
    return GraphMetrics(
        node_count=int(data["node_count"]),
        edge_count=int(data["edge_count"]),
        edges_per_node=float(data["edges_per_node"]),
        component_count=int(data["component_count"]),
        largest_component_size=int(data["largest_component_size"]),
        largest_component_fraction=float(data["largest_component_fraction"]),
        edges_by_dimension=dict(data.get("edges_by_dimension", {})),
        edges_by_type=dict(data.get("edges_by_type", {})),
    )


def _load_qa(corpus_dir: Path) -> QaSummary | None:
    path = corpus_dir / "qa.json"
    if not path.is_file():
        return None
    try:
        return QaSummary.from_dict(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError, ValueError):
        return None


def _load_reports(job_root: Path | None) -> dict[str, QaSummary]:
    """Load the per-category QA reports under ``<job_root>/qa/``, keyed by id.

    Each ``<category-id>.qa.json`` is the QA verdict the pipeline graded that one
    category's dataset against; an unreadable report is skipped rather than
    failing the whole load. A bare corpus directory has no job root and so no
    per-category reports, yielding an empty mapping.
    """
    reports: dict[str, QaSummary] = {}
    if job_root is None:
        return reports
    qa_dir = job_root / "qa"
    if not qa_dir.is_dir():
        return reports
    for path in sorted(qa_dir.glob(f"*{QA_REPORT_SUFFIX}")):
        category_id = path.name[: -len(QA_REPORT_SUFFIX)]
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict):
            reports[category_id] = QaSummary.from_dict(data)
    return reports


def scalar(row: Row, key: str) -> str:
    """Read *key* from *row* as a scalar string (first element of a list)."""
    value = row.get(key, "")
    if isinstance(value, list):
        return value[0] if value else ""
    return value


def first_label(row: Row) -> str:
    """The primary (first) ``:LABEL`` of a node row, or ``""``."""
    return scalar(row, ":LABEL")


def dimension_for(type_: str) -> str:
    """The ontology dimension for an edge ``:TYPE``, or ``"unknown"``.

    Mirrors how :mod:`culturescrape.ontology.metrics` buckets edges, so the graph
    view styles a dimension consistently with the metrics breakdown.
    """
    rel = get_relation(type_)
    return rel.dimension.value if rel else UNKNOWN_DIMENSION


def display(row: Row, key: str) -> str:
    """Render *key* from *row* for display, joining multi-valued cells with '; '."""
    value = row.get(key, "")
    if isinstance(value, list):
        return "; ".join(value)
    return value
