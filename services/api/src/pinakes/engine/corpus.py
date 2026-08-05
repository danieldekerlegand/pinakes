"""Corpus-backed engine calls: search, metrics, completeness.

These three used to be an HTTP round trip. The engine's explorer served them at
``/search``, ``/metrics`` and ``/completeness`` on the sidecar, content-
negotiating on ``Accept`` so the same URL answered both its own HTML views and
`server/services/engine-client.ts`'s ``Accept: application/json``; the TS client
then re-validated each body with zod because it had crossed a wire.

Here the corpus is simply loaded into this process and read. The payload builders
below reproduce the sidecar's JSON bodies field for field — those shapes are the
contract `/api/graph/*` publishes, and the port has to preserve them, not improve
them. Where a value can be reused from the engine rather than restated it is
(``metrics`` renders through :func:`~pinakes_engine.ontology.metrics.to_json`,
the completeness sort table is imported from the explorer), so the two
representations cannot drift apart.

The corpus is located by ``$PINAKES_ENGINE_CORPUS``, else ``build/corpus`` under
the repo root — the same variable the sidecar's docker service read, pointing at
the same artifact. A missing or unreadable corpus raises
:class:`~pinakes.engine.errors.EngineUnavailable`, which is the degraded state
the client already tolerates (503), not an error worth crashing a request over.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

# `COMPLETENESS_SORTS` is the explorer's own sort table. Importing it (rather
# than restating the six sort keys here) is what keeps a sorted completeness
# response identical to the one the sidecar returned for the same query.
from pinakes_engine.explorer.app import COMPLETENESS_SORTS, MAX_SEARCH_LIMIT
from pinakes_engine.explorer.data import (
    SEARCH_LIMIT,
    CategoryStatus,
    Corpus,
    CorpusError,
    QaSummary,
    load_corpus,
)
from pinakes_engine.explorer.links import resolve_links
from pinakes_engine.ontology.metrics import GraphMetrics
from pinakes_engine.ontology.metrics import to_json as metrics_to_json

from pinakes.engine.errors import EngineUnavailable
from pinakes.paths import repo_root

#: Env var naming the corpus this service reads. Same name and meaning as the
#: sidecar's (`infra/docker-compose.yml`), so an existing deployment's value
#: carries over unchanged.
CORPUS_ENV = "PINAKES_ENGINE_CORPUS"

#: Relative to the repo root: where `pinakes_engine run jobs/*.yml` writes the
#: built corpus (docs/UNIFIED-PROJECT-PLAN.md §4).
CORPUS_RELPATH = Path("build") / "corpus"

#: The body a corpus with no readable metrics answers — zeroed, never a 5xx, so
#: the shape stays valid for the client. Mirrors the sidecar's `_EMPTY_METRICS`.
EMPTY_METRICS = GraphMetrics(
    node_count=0,
    edge_count=0,
    edges_per_node=0.0,
    component_count=0,
    largest_component_size=0,
    largest_component_fraction=0.0,
    edges_by_dimension={},
    edges_by_type={},
)


def corpus_source() -> Path:
    """The directory the corpus is read from (a job root or a bare corpus dir)."""
    override = os.environ.get(CORPUS_ENV)
    if override:
        return Path(override).resolve()
    return repo_root() / CORPUS_RELPATH


def corpus() -> Corpus:
    """The loaded corpus.

    Cached for the process by the engine's own
    :func:`~pinakes_engine.explorer.data.load_corpus` (keyed on the resolved
    path), so repeated requests re-read nothing and pointing the env var
    somewhere else is still honoured.
    """
    source = corpus_source()
    try:
        return load_corpus(source)
    except (CorpusError, OSError) as exc:
        raise EngineUnavailable(f"no readable corpus at {source}: {exc}") from exc


def available() -> bool:
    """Whether the corpus can be read. Never raises — it is a probe.

    The counterpart of :func:`pinakes.engine.graph.available`, and it needs no
    cache of its own: a successful load is memoised by the engine on the resolved
    path, and a failed one is a directory read that costs nothing to repeat.
    """
    try:
        corpus()
    except EngineUnavailable:
        return False
    return True


def search(query: str, limit: int = SEARCH_LIMIT) -> dict[str, Any]:
    """Full-text search over the corpus — the sidecar's ``GET /search`` body.

    ``limit`` is clamped to 1..:data:`MAX_SEARCH_LIMIT`, as it was there. Each
    hit carries the cross-store locators :mod:`pinakes_engine.explorer.links`
    resolves, so a result can deep-link the same entity in either view.
    """
    hits = corpus().search(query, min(max(limit, 1), MAX_SEARCH_LIMIT))
    return {
        "query": query,
        "results": [
            {
                "csid": hit.csid,
                "name": hit.name,
                "label": hit.label,
                "qid": hit.qid,
                "field": hit.field,
                "tsv": f"/nodes/{hit.csid}",
                "graph": resolve_links(hit.csid).graph,
            }
            for hit in hits
        ],
    }


def metrics() -> dict[str, Any]:
    """Graph-level metrics — the sidecar's ``GET /metrics`` body.

    No ``threshold`` parameter: it only ever drove the HTML view's fragmentation
    warning and never appeared in, or altered, the JSON document.
    """
    payload: dict[str, Any] = json.loads(
        metrics_to_json(corpus().metrics or EMPTY_METRICS)
    )
    return payload


def completeness(*, status: str = "", sort: str = "status") -> dict[str, Any]:
    """Scraping-completeness dashboard — the sidecar's ``GET /completeness`` body.

    ``status`` filters to one category status; ``sort`` names a column in
    :data:`COMPLETENESS_SORTS` and silently falls back to ``"status"`` when it
    does not, exactly as the sidecar did (an unknown sort is a stale bookmark,
    not an error).
    """
    loaded = corpus()
    rows = loaded.completeness()
    if status:
        rows = [row for row in rows if row.status == status]
    key = sort if sort in COMPLETENESS_SORTS else "status"
    rows = sorted(rows, key=COMPLETENESS_SORTS[key][1])
    return {
        "qa": qa_payload(loaded.qa),
        "rows": [category_payload(row) for row in rows],
    }


def qa_payload(qa: QaSummary | None) -> dict[str, Any] | None:
    """The corpus-wide QA digest, or ``None`` when it was never graded."""
    if qa is None:
        return None
    return {
        "ok": qa.ok,
        "node_count": qa.node_count,
        "edge_count": qa.edge_count,
        "violations": list(qa.violations),
        "failed_keys": list(qa.failed_keys),
    }


def category_payload(status: CategoryStatus) -> dict[str, Any]:
    """One completeness row (the engine's tuples flattened to JSON lists)."""
    return {
        "category_id": status.category_id,
        "label": status.label,
        "status": status.status,
        "node_count": status.node_count,
        "edge_count": status.edge_count,
        "violations": list(status.violations),
        "last_run": status.last_run,
        "errors": status.errors,
        "provenance_complete": status.provenance_complete,
        "reasons": list(status.reasons),
    }


__all__ = [
    "CORPUS_ENV",
    "CORPUS_RELPATH",
    "EMPTY_METRICS",
    "available",
    "category_payload",
    "completeness",
    "corpus",
    "corpus_source",
    "metrics",
    "qa_payload",
    "search",
]
