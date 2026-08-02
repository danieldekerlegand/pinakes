"""The explorer FastAPI application factory.

:func:`create_app` builds a read-only app bound to one corpus *source* (a job
output root or a bare corpus directory). It owns the app shell, the shared nav,
the overview page, and the browse-and-search views: paginated node/edge tables
(filterable by ``:LABEL`` / ``:TYPE`` and by free text on name / csid) and the
per-node detail page. Later stories register the remaining views (completeness,
metrics, graph, Datalog) on the app this returns.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from fastapi.templating import Jinja2Templates

from pinakes_engine.explorer.actions import category_actions
from pinakes_engine.explorer.data import (
    SEARCH_LIMIT,
    STATUS_ORDER,
    CategoryStatus,
    Corpus,
    Neighborhood,
    QaSummary,
    dimension_for,
    display,
    first_label,
    load_corpus,
    scalar,
)
from pinakes_engine.explorer.datalog import Datalog
from pinakes_engine.explorer.links import resolve_links
from pinakes_engine.explorer.live import (
    LiveNeighborhood,
    Neo4jLive,
    load_queries,
)
from pinakes_engine.explorer.retrieval import HybridRetrieval, HybridRetriever
from pinakes_engine.neo4j import Neo4jConfigError, Neo4jDriverNotInstalled
from pinakes_engine.neo4j.vector_index import (
    VECTOR_INDEX_NAME,
    SentenceTransformerEmbedder,
)
from pinakes_engine.ontology.metrics import GraphMetrics
from pinakes_engine.ontology.metrics import to_json as metrics_to_json
from pinakes_engine.schema.headers import Column
from pinakes_engine.schema.tsvio import Row, column_key

#: Directory holding the Jinja2 templates the views render.
TEMPLATES_DIR = Path(__file__).parent / "templates"

#: Rows shown per page in the node/edge tables.
PAGE_SIZE = 50

#: Below this largest-component fraction the metrics view flags fragmentation.
#: Overridable per request via the ``threshold`` query parameter.
FRAGMENTATION_THRESHOLD = 0.9

#: Hop radius the graph view requests when expanding around a clicked node.
GRAPH_DEPTH = 1

#: Upper bound on the neighborhood depth the JSON API will honour.
MAX_GRAPH_DEPTH = 4

#: Upper bound on the number of global-search hits a request may ask for.
MAX_SEARCH_LIMIT = 200

#: Default and upper bound for the number of vector-retrieval seeds (top-k).
DEFAULT_RETRIEVE_K = 5
MAX_RETRIEVE_K = 25

#: Hop radius the hybrid-retrieval endpoint expands each seed to by default.
RETRIEVE_DEPTH = 1

#: Sortable completeness columns: query value -> (heading, sort key).
COMPLETENESS_SORTS: dict[str, tuple[str, Callable[[CategoryStatus], Any]]] = {
    "status": ("Status", lambda s: (STATUS_ORDER.get(s.status, 99), s.category_id)),
    "category": ("Category", lambda s: s.category_id),
    "nodes": ("Nodes", lambda s: (s.node_count, s.category_id)),
    "edges": ("Edges", lambda s: (s.edge_count, s.category_id)),
    "violations": ("QA violations", lambda s: (len(s.violations), s.category_id)),
    "last_run": ("Last run", lambda s: (s.last_run, s.category_id)),
}


@dataclass(frozen=True)
class View:
    """One entry in the explorer's navigation bar."""

    label: str
    path: str


#: The explorer's views, in nav order. Routes are wired up by later stories;
#: the overview ("/") is the only one this module serves.
VIEWS: tuple[View, ...] = (
    View("Overview", "/"),
    View("Search", "/search"),
    View("Tables", "/nodes"),
    View("Completeness", "/completeness"),
    View("Metrics", "/metrics"),
    View("Graph", "/graph"),
    View("Neo4j", "/neo4j"),
    View("Datalog", "/datalog"),
)


def create_app(
    source: str | Path,
    *,
    live: Neo4jLive | None = None,
    datalog: Datalog | None = None,
    retriever: HybridRetriever | None = None,
) -> FastAPI:
    """Build the read-only explorer app for the corpus at *source*.

    *live* is the optional handle to a connected Neo4j database; when omitted one
    is built from the standard ``NEO4J_*`` environment variables. When it is
    configured the graph view and the Cypher console talk to the live store;
    otherwise everything falls back to the canonical TSV.

    *datalog* is the optional handle on the symbolic layer; when omitted one is
    built for this corpus, using the ``swipl`` on PATH (queries are linted offline
    when it is absent).

    Raises:
        CorpusError: If *source* holds no readable corpus (from
            :func:`~pinakes_engine.explorer.data.load_corpus`).
    """
    source = Path(source)
    corpus: Corpus = load_corpus(source)
    live = live if live is not None else Neo4jLive()
    datalog = datalog if datalog is not None else Datalog(corpus.corpus_dir)
    # The default retriever pairs the live handle with a lazy local embedder:
    # nothing is loaded until a query runs, and it reports itself unavailable
    # (-> 503) when the embedding extra or a Neo4j connection is absent.
    retriever = (
        retriever
        if retriever is not None
        else HybridRetriever(live, SentenceTransformerEmbedder())
    )
    queries = load_queries()
    app = FastAPI(title="pinakes-engine explorer")
    templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
    app.state.source = source
    app.state.templates = templates
    app.state.corpus = corpus
    app.state.live = live
    app.state.datalog = datalog
    app.state.retriever = retriever

    @app.get("/")
    def index(request: Request) -> Response:
        return templates.TemplateResponse(
            request,
            "index.html",
            {
                "source": corpus.name,
                "views": VIEWS,
                "node_count": len(corpus.nodes.rows),
                "edge_count": len(corpus.edges.rows),
                "label_count": len(corpus.labels()),
            },
        )

    @app.get("/search")
    def search(request: Request, q: str = "", limit: int = SEARCH_LIMIT) -> Response:
        limit = min(max(limit, 1), MAX_SEARCH_LIMIT)
        hits = corpus.search(q, limit)
        results = [
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
        ]
        if _wants_json(request):
            return JSONResponse({"query": q, "results": results})
        return templates.TemplateResponse(
            request,
            "search.html",
            {
                "source": corpus.name,
                "views": VIEWS,
                "q": q,
                "results": results,
            },
        )

    @app.get("/nodes")
    def nodes(
        request: Request, label: str = "", q: str = "", page: int = 1
    ) -> Response:
        rows = corpus.nodes_for_label(label) if label else list(corpus.nodes.rows)
        if q:
            needle = q.casefold()
            rows = [
                row
                for row in rows
                if needle in scalar(row, "name").casefold()
                or needle in scalar(row, "csid").casefold()
            ]
        window = _Page(rows, page)
        headers, body = _present(corpus.nodes.columns, window.rows, {"csid"})
        return templates.TemplateResponse(
            request,
            "nodes.html",
            {
                "source": corpus.name,
                "views": VIEWS,
                "labels": corpus.labels(),
                "label": label,
                "q": q,
                "headers": headers,
                "rows": body,
                "page": window,
                "query": _query(label=label, q=q),
            },
        )

    @app.get("/edges")
    def edges(
        request: Request, type: str = "", q: str = "", page: int = 1
    ) -> Response:
        rows = corpus.edges_for_type(type) if type else list(corpus.edges.rows)
        if q:
            needle = q.casefold()
            rows = [
                row
                for row in rows
                if needle in scalar(row, ":START_ID").casefold()
                or needle in scalar(row, ":END_ID").casefold()
            ]
        window = _Page(rows, page)
        headers, body = _present(
            corpus.edges.columns, window.rows, {":START_ID", ":END_ID"}
        )
        return templates.TemplateResponse(
            request,
            "edges.html",
            {
                "source": corpus.name,
                "views": VIEWS,
                "types": corpus.types(),
                "type": type,
                "q": q,
                "headers": headers,
                "rows": body,
                "page": window,
                "query": _query(type=type, q=q),
            },
        )

    @app.get("/nodes/{csid:path}")
    def node_detail(request: Request, csid: str) -> Response:
        row = corpus.node(csid)
        if row is None:
            return templates.TemplateResponse(
                request,
                "node_missing.html",
                {"source": corpus.name, "views": VIEWS, "csid": csid},
                status_code=404,
            )
        out_edges, in_edges = corpus.incident_edges(csid)
        return templates.TemplateResponse(
            request,
            "node_detail.html",
            {
                "source": corpus.name,
                "views": VIEWS,
                "csid": csid,
                "name": scalar(row, "name"),
                "links": resolve_links(csid),
                "cells": [
                    (column.header, display(row, column_key(column)))
                    for column in corpus.nodes.columns
                ],
                "outgoing": [_incident(corpus, e, ":END_ID") for e in out_edges],
                "incoming": [_incident(corpus, e, ":START_ID") for e in in_edges],
            },
        )

    @app.get("/completeness")
    def completeness(
        request: Request, status: str = "", sort: str = "status"
    ) -> Response:
        rows = corpus.completeness()
        statuses = sorted(
            {r.status for r in rows}, key=lambda s: STATUS_ORDER.get(s, 99)
        )
        if status:
            rows = [r for r in rows if r.status == status]
        sort = sort if sort in COMPLETENESS_SORTS else "status"
        rows = sorted(rows, key=COMPLETENESS_SORTS[sort][1])
        if _wants_json(request):
            return JSONResponse(_completeness_json(corpus.qa, rows))
        return templates.TemplateResponse(
            request,
            "completeness.html",
            {
                "source": corpus.name,
                "views": VIEWS,
                "qa": corpus.qa,
                "rows": rows,
                "statuses": statuses,
                "status": status,
                "sort": sort,
                "status_qs": f"&status={status}" if status else "",
            },
        )

    @app.get("/completeness/{category_id}")
    def category_action_view(request: Request, category_id: str) -> Response:
        actions = category_actions(corpus, category_id)
        if actions is None:
            return templates.TemplateResponse(
                request,
                "category_missing.html",
                {"source": corpus.name, "views": VIEWS, "category_id": category_id},
                status_code=404,
            )
        return templates.TemplateResponse(
            request,
            "category_actions.html",
            {
                "source": corpus.name,
                "views": VIEWS,
                "actions": actions,
            },
        )

    @app.get("/metrics")
    def metrics(
        request: Request, threshold: float = FRAGMENTATION_THRESHOLD
    ) -> Response:
        m = corpus.metrics
        threshold = min(max(threshold, 0.0), 1.0)
        fragmented = m is not None and m.largest_component_fraction < threshold
        if _wants_json(request):
            return JSONResponse(_metrics_json(m))
        return templates.TemplateResponse(
            request,
            "metrics.html",
            {
                "source": corpus.name,
                "views": VIEWS,
                "metrics": m,
                "threshold": threshold,
                "fragmented": fragmented,
            },
        )

    @app.get("/graph")
    def graph(request: Request, csid: str = "", depth: int = GRAPH_DEPTH) -> Response:
        # Default to the first node so the view always has something to draw.
        if not csid and corpus.nodes.rows:
            csid = scalar(corpus.nodes.rows[0], "csid")
        depth = min(max(depth, 0), MAX_GRAPH_DEPTH)
        seed = corpus.node(csid)
        return templates.TemplateResponse(
            request,
            "graph.html",
            {
                "source": corpus.name,
                "views": VIEWS,
                "csid": csid,
                "name": scalar(seed, "name") if seed is not None else "",
                "found": seed is not None,
                "depth": depth,
                "max_depth": MAX_GRAPH_DEPTH,
                "backend": "Neo4j" if live.configured() else "canonical TSV",
                "nodes": [
                    {"csid": scalar(row, "csid"), "name": scalar(row, "name")}
                    for row in corpus.nodes.rows
                ],
            },
        )

    @app.get("/api/graph/{csid:path}")
    def graph_api(csid: str, depth: int = GRAPH_DEPTH) -> Response:
        depth = min(max(depth, 0), MAX_GRAPH_DEPTH)
        # Prefer the live graph when one is connected; on any driver/connection
        # failure fall through to the TSV-backed neighborhood so the view works.
        if live.configured():
            try:
                live_hood = live.neighborhood(csid, depth)
            except Exception:  # noqa: BLE001 - any driver failure -> TSV fallback
                live_hood = _UNAVAILABLE
            if live_hood is not _UNAVAILABLE:
                if live_hood is None:
                    return JSONResponse(
                        {"error": f"unknown csid: {csid}"}, status_code=404
                    )
                return JSONResponse(_live_graph_payload(live_hood))
        hood = corpus.neighborhood(csid, depth)
        if hood is None:
            return JSONResponse({"error": f"unknown csid: {csid}"}, status_code=404)
        return JSONResponse(_graph_payload(corpus, hood))

    @app.get("/api/retrieve")
    def retrieve_api(
        q: str = "", k: int = DEFAULT_RETRIEVE_K, depth: int = RETRIEVE_DEPTH
    ) -> Response:
        # Hybrid GraphRAG retrieval: embed the query, pull the top-k nearest
        # nodes from the native vector index, and expand them into a subgraph.
        query = q.strip()
        k = min(max(k, 1), MAX_RETRIEVE_K)
        depth = min(max(depth, 0), MAX_GRAPH_DEPTH)
        if not query:
            return JSONResponse(_empty_retrieval(k, depth, retriever.available()))
        if not retriever.available():
            return JSONResponse(
                {
                    "query": query,
                    "available": False,
                    "error": (
                        "GraphRAG retrieval is unavailable: a live Neo4j "
                        "connection and the sentence-transformers embedding "
                        "extra are both required."
                    ),
                    "k": k,
                    "depth": depth,
                    "seeds": [],
                    "nodes": [],
                    "edges": [],
                },
                status_code=503,
            )
        try:
            hood = retriever.retrieve(query, k, depth)
        except Exception:  # noqa: BLE001 - any driver failure -> 503 degradation
            return JSONResponse(
                {
                    "query": query,
                    "available": False,
                    "error": "GraphRAG retrieval could not reach the graph.",
                    "k": k,
                    "depth": depth,
                    "seeds": [],
                    "nodes": [],
                    "edges": [],
                },
                status_code=503,
            )
        return JSONResponse(_retrieval_payload(hood))

    @app.get("/neo4j")
    def neo4j_console(request: Request, query: str = "", csid: str = "") -> Response:
        selected = next((q for q in queries if q.name == query), None)
        # A csid deep-link from a node detail focuses that entity's node: show
        # the by-csid locator and, when a live database is connected, run it.
        focus_node = corpus.node(csid) if csid else None
        focus = resolve_links(csid) if focus_node is not None else None
        result = None
        error = None
        ran = False
        run = bool(request.query_params.get("run"))
        if focus is not None and run:
            ran = True
            try:
                result = live.run(focus.neo4j_cypher)
            except (Neo4jConfigError, Neo4jDriverNotInstalled) as exc:
                error = str(exc)
            except Exception as exc:  # noqa: BLE001 - surface connection failures
                error = f"Could not reach Neo4j: {exc}"
        elif selected is not None and run:
            ran = True
            params = {p: request.query_params.get(p, "") for p in selected.params}
            try:
                result = live.run(selected.cypher, params)
            except (Neo4jConfigError, Neo4jDriverNotInstalled) as exc:
                error = str(exc)
            except Exception as exc:  # noqa: BLE001 - surface connection failures
                error = f"Could not reach Neo4j: {exc}"
        return templates.TemplateResponse(
            request,
            "neo4j.html",
            {
                "source": corpus.name,
                "views": VIEWS,
                "configured": live.configured(),
                "status": live.status_message(),
                "queries": queries,
                "selected": selected,
                "focus": focus,
                "focus_name": scalar(focus_node, "name") if focus_node else "",
                "result": result,
                "error": error,
                "ran": ran,
                "values": {
                    p: request.query_params.get(p, "")
                    for p in (selected.params if selected else ())
                },
            },
        )

    @app.get("/datalog")
    def datalog_console(
        request: Request, query: str = "", goal: str = ""
    ) -> Response:
        examples = datalog.examples()
        selected = datalog.example(query) if query else None
        # An ad-hoc goal takes precedence over a selected example when both are
        # present; otherwise the selected example's own source is what runs.
        source = goal or (selected.source if selected is not None else "")
        outcome = None
        if request.query_params.get("run") and source:
            outcome = datalog.run(source)
        return templates.TemplateResponse(
            request,
            "datalog.html",
            {
                "source": corpus.name,
                "views": VIEWS,
                "available": datalog.available(),
                "status": datalog.status_message(),
                "examples": examples,
                "selected": selected,
                "goal": goal,
                "outcome": outcome,
            },
        )

    return app


#: Sentinel marking a live neighborhood lookup that failed and should fall back.
_UNAVAILABLE: Any = object()

#: A zeroed metrics document — the JSON body a corpus with no readable metrics
#: answers, mirroring the "no metrics available" HTML state so the shape stays
#: valid for the TS client.
_EMPTY_METRICS = GraphMetrics(
    node_count=0,
    edge_count=0,
    edges_per_node=0.0,
    component_count=0,
    largest_component_size=0,
    largest_component_fraction=0.0,
    edges_by_dimension={},
    edges_by_type={},
)


def _wants_json(request: Request) -> bool:
    """Whether the caller wants a JSON representation rather than HTML.

    The search / metrics / completeness views content-negotiate on ``Accept``:
    the first-party TS client (``server/services/engine-client.ts``)
    requests them with ``Accept: application/json`` while browsers ask for
    ``text/html``, so the same URL answers both the HTML explorer and the API
    with parity data.
    """
    return "application/json" in request.headers.get("accept", "")


def _metrics_json(metrics: GraphMetrics | None) -> dict[str, Any]:
    """The metrics view's JSON body, mirroring ``ontology.metrics.to_json``.

    Reuses that renderer so the JSON never drifts from the canonical metrics
    shape; a corpus with no readable metrics answers the zeroed document.
    """
    payload: dict[str, Any] = json.loads(metrics_to_json(metrics or _EMPTY_METRICS))
    return payload


def _qa_json(qa: QaSummary | None) -> dict[str, Any] | None:
    """The corpus-wide QA digest as JSON, or ``None`` when it was never graded."""
    if qa is None:
        return None
    return {
        "ok": qa.ok,
        "node_count": qa.node_count,
        "edge_count": qa.edge_count,
        "violations": list(qa.violations),
        "failed_keys": list(qa.failed_keys),
    }


def _category_json(status: CategoryStatus) -> dict[str, Any]:
    """One completeness row as JSON (tuples flattened to lists)."""
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


def _completeness_json(
    qa: QaSummary | None, rows: list[CategoryStatus]
) -> dict[str, Any]:
    """The completeness dashboard's JSON body: the QA digest plus category rows."""
    return {"qa": _qa_json(qa), "rows": [_category_json(row) for row in rows]}


def _graph_payload(corpus: Corpus, hood: Neighborhood) -> dict[str, Any]:
    """Cytoscape ``elements`` for *hood*: nodes carry their primary ``:LABEL``,
    edges their ``:TYPE`` and ontology dimension for styling."""
    nodes = [
        {
            "data": {
                "id": scalar(row, "csid"),
                "name": scalar(row, "name") or scalar(row, "csid"),
                "label": first_label(row),
                "labels": display(row, ":LABEL"),
                "center": scalar(row, "csid") == hood.center,
            }
        }
        for row in hood.nodes
    ]
    edges = [
        {
            "data": {
                "id": f"e{index}",
                "source": scalar(edge, ":START_ID"),
                "target": scalar(edge, ":END_ID"),
                "type": scalar(edge, ":TYPE"),
                "dimension": dimension_for(scalar(edge, ":TYPE")),
            }
        }
        for index, edge in enumerate(hood.edges)
    ]
    return {
        "center": hood.center,
        "depth": hood.depth,
        "backend": "tsv",
        "nodes": nodes,
        "edges": edges,
    }


def _live_graph_payload(hood: LiveNeighborhood) -> dict[str, Any]:
    """Cytoscape ``elements`` for a live neighborhood, matching the TSV payload."""
    nodes = [
        {
            "data": {
                "id": node.csid,
                "name": node.name or node.csid,
                "label": node.labels[0] if node.labels else "",
                "labels": "; ".join(node.labels),
                "center": node.csid == hood.center,
            }
        }
        for node in hood.nodes
    ]
    edges = [
        {
            "data": {
                "id": f"e{index}",
                "source": edge.start,
                "target": edge.end,
                "type": edge.type,
                "dimension": dimension_for(edge.type),
            }
        }
        for index, edge in enumerate(hood.edges)
    ]
    return {
        "center": hood.center,
        "depth": hood.depth,
        "backend": "neo4j",
        "nodes": nodes,
        "edges": edges,
    }


def _empty_retrieval(k: int, depth: int, available: bool) -> dict[str, Any]:
    """The JSON body for an empty/blank retrieval query (no seeds to expand)."""
    return {
        "query": "",
        "available": available,
        "backend": "neo4j",
        "index": VECTOR_INDEX_NAME,
        "k": k,
        "depth": depth,
        "seeds": [],
        "nodes": [],
        "edges": [],
    }


def _retrieval_payload(hood: HybridRetrieval) -> dict[str, Any]:
    """The JSON body for a hybrid-retrieval result: ranked seeds + the subgraph.

    Seeds carry their similarity ``score``; ``nodes``/``edges`` are the
    self-contained neighborhood expanded around them, so the subgraph can ground
    an LLM answer (edges also carry their ontology ``dimension`` for styling).
    """
    return {
        "query": hood.query,
        "available": True,
        "backend": "neo4j",
        "index": hood.index_name,
        "k": hood.k,
        "depth": hood.depth,
        "seeds": [
            {
                "csid": seed.csid,
                "name": seed.name or seed.csid,
                "label": seed.labels[0] if seed.labels else "",
                "labels": list(seed.labels),
                "score": seed.score,
            }
            for seed in hood.seeds
        ],
        "nodes": [
            {
                "csid": node.csid,
                "name": node.name or node.csid,
                "label": node.labels[0] if node.labels else "",
                "labels": list(node.labels),
            }
            for node in hood.nodes
        ],
        "edges": [
            {
                "source": edge.start,
                "target": edge.end,
                "type": edge.type,
                "dimension": dimension_for(edge.type),
            }
            for edge in hood.edges
        ],
    }


class _Page:
    """A 1-based slice of *rows* sized to :data:`PAGE_SIZE` for the table views."""

    def __init__(self, rows: list[Row], page: int) -> None:
        self.total = len(rows)
        self.pages = max(1, -(-self.total // PAGE_SIZE))
        self.number = min(max(page, 1), self.pages)
        start = (self.number - 1) * PAGE_SIZE
        self.rows = rows[start : start + PAGE_SIZE]
        self.has_prev = self.number > 1
        self.has_next = self.number < self.pages


def _present(
    columns: tuple[Column, ...], rows: list[Row], link_keys: set[str]
) -> tuple[list[str], list[list[dict[str, str]]]]:
    """Headers plus display cells for *rows*; cells under *link_keys* deep-link.

    Each cell is ``{"text": ..., "href": ...}``; ``href`` is empty unless the
    column is a csid-bearing key whose value names an existing node.
    """
    keys = [column_key(c) for c in columns]
    headers = [c.header for c in columns]
    body: list[list[dict[str, str]]] = []
    for row in rows:
        cells: list[dict[str, str]] = []
        for key in keys:
            text = display(row, key)
            href = f"/nodes/{text}" if key in link_keys and text else ""
            cells.append({"text": text, "href": href})
        body.append(cells)
    return headers, body


def _incident(corpus: Corpus, edge: Row, endpoint: str) -> dict[str, str]:
    """Describe one incident *edge* from a node's view: its type and the other end."""
    other = scalar(edge, endpoint)
    target = corpus.node(other)
    return {
        "type": scalar(edge, ":TYPE"),
        "csid": other,
        "name": scalar(target, "name") if target is not None else "",
    }


def _query(**params: str) -> str:
    """A querystring of the non-empty *params* (page added by the template)."""
    return "".join(f"&{key}={value}" for key, value in params.items() if value)
