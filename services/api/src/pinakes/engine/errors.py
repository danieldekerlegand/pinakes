"""The two failure modes an engine call has, and what they mean over HTTP.

The TypeScript sidecar client drew exactly this line
(`server/services/engine-client.ts`): a backend that could not be *reached* is a
different thing from a backend that answered with something unusable, and the
`/api/graph/*` routes have answered 503 and 502 for them respectively since
US-004. Collapsing the pair would silently reclassify "the graph is down" (retry
later, the UI degrades) as "your query is wrong" — so the distinction survives
the move in-process even though there is no longer a wire between the caller and
the engine.
"""

from __future__ import annotations


class EngineError(RuntimeError):
    """Base class for every failure the in-process engine layer raises."""


class EngineUnavailable(EngineError):
    """A backend the call needs is absent or unreachable.

    No corpus on disk, no Neo4j connection settings, the ``neo4j`` driver extra
    not installed, the database refusing connections, the GraphRAG embedder
    missing. Routes map this to **503** ``{"available": false, ...}``.
    """


class EngineFailure(EngineError):
    """A reachable backend rejected the request or answered unusably.

    A Cypher syntax error is the canonical case: the store is up, the query is
    bad. Routes map this to **502** — never 503, because retrying will not help.
    """


__all__ = ["EngineError", "EngineFailure", "EngineUnavailable"]
