"""The `/api/graph/*` route group, served from the in-process engine.

The first port off the Express backend (docs/UNIFIED-PROJECT-PLAN.md §5, Phase 1)
and the template the later ones follow: one file, auto-registered, thin over
:mod:`pinakes.engine`. Every handler here is an adapter — parse the query string
the way the Express route did, call one engine function, map the two engine error
classes onto the two status codes. No graph logic lives in this file, which is
what lets the same calls run from a job or a test with no HTTP anywhere.

What the port preserves from `server/routes/graph.ts`, deliberately:

* **The degradation contract.** ``EngineUnavailable`` → **503**
  ``{available: false, error, detail}``; ``EngineFailure`` → **502**
  ``{available: true, …}``; a missing node → **404**. The client's graph views are
  written against exactly this (`web/src/lib/graph/*`), and they degrade rather
  than error on the 503 — so collapsing the pair would turn "the graph is down"
  into "your request was wrong".
* **Empty queries short-circuit.** ``/search`` and ``/retrieve`` answer their
  empty result without touching a backend, so an empty search box costs nothing.
* **The read-only Cypher guard stays in the route.** The research console states
  it is read-only and the server enforces it *before* the query reaches the store,
  rather than trusting the store's own permissions.
* **A junk numeric query param is not an error.** Express reached these through
  `Number(...)` + `Number.isFinite(...)`, so ``?limit=abc`` fell back to the
  default. FastAPI would answer 422 for a declared ``int`` param, which is a
  different contract, so the params are declared as strings and parsed by
  :func:`_number` — a stale bookmark must not become a hard failure.

Two routes in the baseline's ``graph`` group are **not** here, because neither is
engine-backed: ``/api/graph/resolve`` (the convergence alias table, which is
loaded from the local lexicons and answers even while the graph is offline) and
``/api/graph/explain`` (the LLM connection narrative). Both keep answering 501
until their own port lands — see ``/api/_parity/coverage``.
"""

from __future__ import annotations

import math
import re
import time
from typing import Annotated, Any

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from pinakes.engine import corpus, datalog, graph
from pinakes.engine.errors import EngineError, EngineUnavailable

router = APIRouter(tags=["graph"])

#: Cypher write clauses. The research console is read-only: the browser states it
#: and the server enforces it, so a mutating query is rejected here rather than
#: relying on the store's own guard.
CYPHER_WRITE_CLAUSES = re.compile(
    r"\b(CREATE|MERGE|DELETE|SET|REMOVE|DROP|FOREACH|LOAD\s+CSV)\b", re.IGNORECASE
)

#: The traversal depth `/api/graph/neighborhood/{id}` falls back to when the
#: `depth` param is absent or unparseable.
DEFAULT_NEIGHBORHOOD_DEPTH = graph.MIN_DEPTH


# ── Adapting the query string ────────────────────────────────────────────────


def _text(raw: str | None) -> str:
    """A trimmed string param, or ``""`` — what `typeof x === "string"` gave."""
    return raw.strip() if isinstance(raw, str) else ""


def _number(raw: str | None) -> float | None:
    """``Number(raw)`` with a non-finite result reported as ``None``.

    The JS semantics this replaces, including the two that surprise: an absent
    param is ``NaN`` (→ ``None``), and a *present but empty* one is ``0``. Both
    of those reach a caller's own guard (``> 0``, ``>= 0``) unchanged.
    """
    if raw is None:
        return None
    try:
        value = float(raw.strip() or 0)
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def _positive(raw: str | None) -> int | None:
    """A ``limit``/``k``-style param: an int when it parsed positive, else ``None``.

    ``None`` means "the engine's own default", which is how the Express routes
    passed a missing or junk value through to the sidecar.
    """
    value = _number(raw)
    if value is None or value <= 0:
        return None
    return int(value)


def _depth(raw: str | None) -> int:
    """The neighborhood ``depth`` param, clamped; unparseable falls back."""
    value = _number(raw)
    if value is None:
        return DEFAULT_NEIGHBORHOOD_DEPTH
    return graph.clamp_depth(int(value))


def _body_text(body: dict[str, Any] | None, key: str) -> str:
    """One trimmed string field of a JSON body, or ``""`` if it is not a string."""
    if not isinstance(body, dict):
        return ""
    return _text(body.get(key)) if isinstance(body.get(key), str) else ""


# ── Mapping engine failures onto status codes ────────────────────────────────


def engine_error(context: str, exc: EngineError) -> JSONResponse:
    """Translate an engine failure into the response the client expects.

    Unreachable backend → 503 with ``available: false`` (retry; the UI degrades).
    Reachable backend that rejected the request → 502 (retrying will not help).
    """
    if isinstance(exc, EngineUnavailable):
        return JSONResponse(
            status_code=503,
            content={
                "available": False,
                "error": f"{context} is unavailable",
                "detail": str(exc),
            },
        )
    return JSONResponse(
        status_code=502,
        content={
            "available": True,
            "error": f"{context} returned an unusable response",
            "detail": str(exc),
        },
    )


def _not_found(csid: str) -> JSONResponse:
    return JSONResponse(
        status_code=404, content={"error": "node not found", "csid": csid}
    )


def _bad_request(error: str, detail: str | None = None) -> JSONResponse:
    content: dict[str, Any] = {"error": error}
    if detail is not None:
        content["detail"] = detail
    return JSONResponse(status_code=400, content=content)


# ── Corpus-backed reads ──────────────────────────────────────────────────────


@router.get("/api/graph/search")
def search(q: str = "", limit: str | None = None) -> Any:
    """Full-text search over the corpus. An empty query costs nothing."""
    query = _text(q)
    if not query:
        return {"query": "", "results": []}
    count = _positive(limit)
    try:
        return corpus.search(query) if count is None else corpus.search(query, count)
    except EngineError as exc:
        return engine_error("graph search", exc)


@router.get("/api/graph/metrics")
def metrics() -> Any:
    """Graph-level metrics over the corpus."""
    try:
        return corpus.metrics()
    except EngineError as exc:
        return engine_error("graph metrics", exc)


# ── Neo4j-backed reads ───────────────────────────────────────────────────────


@router.get("/api/graph/node/{id}")
def node(id: str) -> Any:  # noqa: A002 - the baseline path parameter is `{id}`
    """One node by csid. 404 when it does not exist (or is personal-tier)."""
    try:
        found = graph.node(id)
    except EngineError as exc:
        return engine_error("graph node lookup", exc)
    if found is None:
        return _not_found(id)
    return {"node": found}


@router.get("/api/graph/neighborhood/{id}")
def neighborhood(id: str, depth: str | None = None) -> Any:  # noqa: A002
    """The sub-graph within 1..3 hops of a node. 404 when the focus is absent."""
    try:
        hood = graph.neighborhood(id, _depth(depth))
    except EngineError as exc:
        return engine_error("graph neighborhood", exc)
    if hood is None:
        return _not_found(id)
    return hood


@router.get("/api/graph/overview")
def overview(limit: str | None = None) -> Any:
    """A bounded ``{nodes, edges}`` snapshot of the shared graph."""
    count = _positive(limit)
    try:
        return graph.overview() if count is None else graph.overview(count)
    except EngineError as exc:
        return engine_error("graph overview", exc)


@router.get("/api/graph/retrieve")
def retrieve(q: str = "", k: str | None = None, depth: str | None = None) -> Any:
    """Hybrid GraphRAG retrieval: vector seeds expanded into a sub-graph.

    503 ``{available: false}`` when the embedder or the graph is missing — the
    degraded state this route has always been allowed to be in, since the
    embedding extra is deliberately not installed here.
    """
    query = _text(q)
    if not query:
        return {"query": "", "seeds": [], "nodes": [], "edges": []}
    seeds = _positive(k)
    hops = _number(depth)
    kwargs: dict[str, int] = {}
    if seeds is not None:
        kwargs["k"] = seeds
    if hops is not None and hops >= 0:
        kwargs["depth"] = int(hops)
    try:
        return graph.retrieve(query, **kwargs)
    except EngineError as exc:
        return engine_error("graph retrieval", exc)


# ── The research consoles ────────────────────────────────────────────────────


@router.post("/api/graph/datalog")
def run_datalog(body: Annotated[dict[str, Any] | None, Body()] = None) -> Any:
    """Run a read-only Datalog query: an ad-hoc ``goal`` or a shipped ``example``.

    The outcome is passed straight through, including the lint ``error``/``reason``
    a query gets when SWI-Prolog is absent: a lint finding is an answer about the
    query, not a failure of the service.
    """
    goal = _body_text(body, "goal")
    example = _body_text(body, "example")
    if not goal and not example:
        return _bad_request("a datalog goal or example is required")
    try:
        return datalog.run(goal=goal, example=example)
    except datalog.UnknownExample as exc:
        return _bad_request(str(exc))
    except EngineError as exc:
        return engine_error("datalog query", exc)


@router.post("/api/graph/cypher")
def run_cypher(body: Annotated[dict[str, Any] | None, Body()] = None) -> Any:
    """Run a read-only Cypher query. A write clause is rejected before the store."""
    query = _body_text(body, "query")
    if not query:
        return _bad_request("a cypher query is required")
    if CYPHER_WRITE_CLAUSES.search(query):
        return _bad_request(
            "the research console is read-only",
            "write clauses (CREATE, MERGE, DELETE, SET, REMOVE, DROP, FOREACH, "
            "LOAD CSV) are not permitted",
        )
    try:
        return graph.cypher(query)
    except EngineError as exc:
        return engine_error("cypher query", exc)


# ── Availability ─────────────────────────────────────────────────────────────


@router.get("/api/graph/status")
def status() -> dict[str, Any]:
    """Availability of both halves of the engine. Always 200 — it is the probe.

    ``neo4j`` is the shared graph store; ``sidecar`` keeps its recorded name
    (`contracts/parity/fixtures/get-graph-status.json`, and the client parses it —
    `web/src/lib/graph/availability.ts`) but no longer means a second process.
    What it reports is the corpus half that the separate process used to serve:
    search and metrics answer iff it is true, exactly as before. Neither probe
    raises, so an entirely absent backend is a `false`, never a 500.
    """
    neo4j = graph.available()
    engine = corpus.available()
    return {
        "available": neo4j or engine,
        "neo4j": neo4j,
        "sidecar": engine,
        "checkedAt": int(time.time() * 1000),
    }
