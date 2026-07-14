"""Tests for hybrid GraphRAG retrieval + the ``/api/retrieve`` endpoint.

The vector index, the graph, and the embedding model are all faked: a fake
driver replays queryNodes / expansion / edge fixtures, and a stub embedder
returns a fixed vector, so the seed -> neighborhood expansion and every
graceful-degradation path (no embedder, unconfigured graph, driver failure,
empty query) are exercised with no live server and no model download.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("fastapi")

from fastapi.testclient import TestClient  # noqa: E402

from culturescrape.explorer import create_app  # noqa: E402
from culturescrape.explorer.live import Neo4jLive  # noqa: E402
from culturescrape.explorer.retrieval import HybridRetriever  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_ROOT = REPO_ROOT / "tests" / "fixtures" / "explorer-corpus"

CONFIG = {"password": "secret"}
EMPTY_ENV: dict[str, str] = {}


class _FakeEmbedder:
    def __init__(self, *, available: bool = True) -> None:
        self._available = available

    @property
    def dimension(self) -> int:
        return 3

    def available(self) -> bool:
        return self._available

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        return [[0.1, 0.2, 0.3] for _ in texts]


class _FakeResult:
    def __init__(self, records: list[dict[str, Any]]) -> None:
        self._records = records

    def __iter__(self) -> Any:
        return iter(self._records)


class _FakeSession:
    def __init__(self, handler: Any) -> None:
        self._handler = handler

    def __enter__(self) -> _FakeSession:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def run(self, cypher: str, params: dict[str, Any] | None = None) -> _FakeResult:
        return _FakeResult(self._handler(cypher, params or {}))


class _FakeDriver:
    def __init__(self, handler: Any) -> None:
        self._handler = handler
        self.closed = False

    def session(self) -> _FakeSession:
        return _FakeSession(self._handler)

    def close(self) -> None:
        self.closed = True


def _handler(cypher: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    if "db.index.vector.queryNodes" in cypher:
        return [
            {
                "csid": "cs:culture:sumer",
                "name": "Sumer",
                "labels": ["Entity", "Culture"],
                "score": 0.93,
            },
            {
                "csid": "cs:place:uruk",
                "name": "Uruk",
                "labels": ["Entity", "Place"],
                "score": 0.81,
            },
        ]
    if "RETURN DISTINCT n.csid AS csid" in cypher:
        return [
            {
                "csid": "cs:culture:sumer",
                "name": "Sumer",
                "labels": ["Entity", "Culture"],
            },
            {"csid": "cs:place:uruk", "name": "Uruk", "labels": ["Entity", "Place"]},
        ]
    if "type(r) AS type" in cypher:
        return [
            {"start": "cs:place:uruk", "end": "cs:culture:sumer", "type": "LOCATED_IN"}
        ]
    return []


def _empty_handler(cypher: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    return []


def _live(handler: Any, *, config: dict[str, Any] | None = CONFIG) -> Neo4jLive:
    def connect(cfg: Any = None, *, env: Any = None, **kwargs: Any) -> _FakeDriver:
        return _FakeDriver(handler)

    return Neo4jLive(config=config, env=EMPTY_ENV, connect=connect)


# --- Neo4jLive.vector_retrieve ----------------------------------------------


def test_vector_retrieve_seeds_and_expands() -> None:
    live = _live(_handler)
    result = live.vector_retrieve([0.1, 0.2, 0.3], 2, 1, index_name="entity_embedding")
    assert [s.csid for s in result.seeds] == ["cs:culture:sumer", "cs:place:uruk"]
    assert result.seeds[0].score == pytest.approx(0.93)
    # The Entity anchor label is dropped, leaving the per-type label.
    assert result.seeds[0].labels == ("Culture",)
    assert {n.csid for n in result.nodes} == {"cs:culture:sumer", "cs:place:uruk"}
    assert result.edges[0].type == "LOCATED_IN"


def test_vector_retrieve_empty_when_no_seeds() -> None:
    live = _live(_empty_handler)
    result = live.vector_retrieve([0.1, 0.2, 0.3], 5, 1, index_name="entity_embedding")
    assert result.seeds == ()
    assert result.nodes == ()
    assert result.edges == ()


# --- HybridRetriever --------------------------------------------------------


def test_retriever_unavailable_without_embedder() -> None:
    assert HybridRetriever(_live(_handler), None).available() is False


def test_retriever_unavailable_when_embedder_backend_absent() -> None:
    retriever = HybridRetriever(_live(_handler), _FakeEmbedder(available=False))
    assert retriever.available() is False


def test_retriever_unavailable_without_neo4j_config() -> None:
    live = _live(_handler, config=None)  # no password -> not configured
    assert HybridRetriever(live, _FakeEmbedder()).available() is False


def test_retriever_retrieve_embeds_and_returns_subgraph() -> None:
    retriever = HybridRetriever(_live(_handler), _FakeEmbedder())
    assert retriever.available() is True
    hood = retriever.retrieve("bronze age mesopotamia", 2, 1)
    assert hood.query == "bronze age mesopotamia"
    assert [s.csid for s in hood.seeds] == ["cs:culture:sumer", "cs:place:uruk"]
    assert len(hood.nodes) == 2
    assert hood.edges[0].type == "LOCATED_IN"


# --- /api/retrieve endpoint -------------------------------------------------


def _client(retriever: HybridRetriever) -> TestClient:
    return TestClient(create_app(FIXTURE_ROOT, retriever=retriever))


def test_retrieve_endpoint_returns_ranked_subgraph() -> None:
    client = _client(HybridRetriever(_live(_handler), _FakeEmbedder()))
    resp = client.get("/api/retrieve", params={"q": "mesopotamia", "k": 2, "depth": 1})
    assert resp.status_code == 200
    body = resp.json()
    assert body["available"] is True
    assert body["backend"] == "neo4j"
    assert body["seeds"][0]["csid"] == "cs:culture:sumer"
    assert body["seeds"][0]["score"] == pytest.approx(0.93)
    assert body["seeds"][0]["label"] == "Culture"
    assert body["edges"][0]["type"] == "LOCATED_IN"
    assert body["edges"][0]["dimension"]  # ontology dimension present


def test_retrieve_endpoint_503_when_unavailable() -> None:
    client = _client(HybridRetriever(_live(_handler), _FakeEmbedder(available=False)))
    resp = client.get("/api/retrieve", params={"q": "anything"})
    assert resp.status_code == 503
    body = resp.json()
    assert body["available"] is False
    assert body["seeds"] == []


def test_retrieve_endpoint_blank_query_is_empty_ok() -> None:
    client = _client(HybridRetriever(_live(_handler), _FakeEmbedder()))
    resp = client.get("/api/retrieve", params={"q": "   "})
    assert resp.status_code == 200
    body = resp.json()
    assert body["seeds"] == []
    assert body["nodes"] == []


def test_retrieve_endpoint_503_on_driver_failure() -> None:
    def boom(cfg: Any = None, *, env: Any = None, **kwargs: Any) -> _FakeDriver:
        raise RuntimeError("connection refused")

    live = Neo4jLive(config=CONFIG, env=EMPTY_ENV, connect=boom)
    client = _client(HybridRetriever(live, _FakeEmbedder()))
    resp = client.get("/api/retrieve", params={"q": "mesopotamia"})
    assert resp.status_code == 503
    assert resp.json()["available"] is False


def test_retrieve_endpoint_clamps_k() -> None:
    client = _client(HybridRetriever(_live(_handler), _FakeEmbedder()))
    resp = client.get("/api/retrieve", params={"q": "x", "k": 999})
    assert resp.json()["k"] == 25  # MAX_RETRIEVE_K
