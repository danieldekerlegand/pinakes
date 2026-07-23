"""Hybrid GraphRAG retrieval for the explorer (Phase 5).

:class:`HybridRetriever` is the query-time counterpart of the index-build step in
:mod:`culturescrape.neo4j.vector_index`: it embeds a free-text query with the same
local model, asks the Neo4j native vector index for the semantically-nearest
seed nodes, and expands them into a self-contained subgraph — the "vector top-k ->
neighborhood expansion" the sidecar's ``/api/retrieve`` endpoint serves.

Everything degrades gracefully, mirroring the rest of the explorer: the embedder
is optional and lazy (no model is loaded until a query actually runs), and
:meth:`HybridRetriever.available` gates the endpoint so an absent embedder or an
unconfigured Neo4j answers the 503 "unavailable" contract instead of raising. The
embedder is injectable, so the whole surface is exercisable against a fake.
"""

from __future__ import annotations

from dataclasses import dataclass

from culturescrape.explorer.live import (
    LiveEdge,
    LiveNode,
    Neo4jLive,
    RetrievedSeed,
)
from culturescrape.neo4j.vector_index import (
    VECTOR_INDEX_NAME,
    Embedder,
)


@dataclass(frozen=True)
class HybridRetrieval:
    """A hybrid-retrieval answer: the query, its ranked seeds, and the subgraph."""

    query: str
    k: int
    depth: int
    index_name: str
    seeds: tuple[RetrievedSeed, ...]
    nodes: tuple[LiveNode, ...]
    edges: tuple[LiveEdge, ...]


class HybridRetriever:
    """Vector-seeded, neighborhood-expanded retrieval over the live graph.

    Composes a live Neo4j handle (:class:`~explorer.live.Neo4jLive`) with an
    optional :class:`~neo4j.vector_index.Embedder`. When either is missing or its
    backend is unavailable, :meth:`available` is ``False`` and the endpoint
    degrades; when both are present, :meth:`retrieve` embeds the query and runs
    the hybrid lookup.
    """

    def __init__(
        self,
        live: Neo4jLive,
        embedder: Embedder | None = None,
        *,
        index_name: str = VECTOR_INDEX_NAME,
    ) -> None:
        self._live = live
        self._embedder = embedder
        self._index_name = index_name

    def available(self) -> bool:
        """True when a Neo4j connection is configured and the embedder can run."""
        if self._embedder is None or not self._embedder.available():
            return False
        return self._live.configured()

    def retrieve(self, query: str, k: int, depth: int) -> HybridRetrieval:
        """Embed *query* and return the top-*k* seeds expanded to *depth* hops.

        Requires :meth:`available`; callers gate on it first. Raises like
        :meth:`~explorer.live.Neo4jLive.vector_retrieve` on a driver failure.
        """
        if self._embedder is None:
            raise RuntimeError("retrieval is unavailable: no embedder configured")
        embedding = self._embedder.embed([query])[0]
        result = self._live.vector_retrieve(
            embedding, k, depth, index_name=self._index_name
        )
        return HybridRetrieval(
            query=query,
            k=k,
            depth=depth,
            index_name=self._index_name,
            seeds=result.seeds,
            nodes=result.nodes,
            edges=result.edges,
        )


__all__ = [
    "HybridRetrieval",
    "HybridRetriever",
]
