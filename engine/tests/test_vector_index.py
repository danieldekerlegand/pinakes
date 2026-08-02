"""Tests for GraphRAG node embeddings + the Neo4j native vector index build.

The embedding backend and the Neo4j driver are both faked: a stub embedder
returns deterministic vectors and a fake driver records every ``session().run``
call and replays fixture records, so the whole build (read texts -> embed ->
write -> create index -> count) is exercised with no model download and no live
database.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import pytest

from pinakes_engine.neo4j.vector_index import (
    DEFAULT_MODEL,
    IndexBuildResult,
    NodeText,
    SentenceTransformerEmbedder,
    build_vector_index,
    embed_nodes,
    node_embedding_text,
    read_node_texts,
    vector_index_statement,
)

# --- Pure helpers -----------------------------------------------------------


def test_node_embedding_text_joins_non_blank_parts() -> None:
    assert (
        node_embedding_text("Sumer", "Shumer; Sumeria", "an ancient civilization")
        == "Sumer\nShumer; Sumeria\nan ancient civilization"
    )


def test_node_embedding_text_drops_blanks_and_trims() -> None:
    assert node_embedding_text("  Uruk  ", "", "   ") == "Uruk"
    assert node_embedding_text("", "", "") == ""


def test_vector_index_statement_is_idempotent_ddl() -> None:
    stmt = vector_index_statement(dimension=384)
    assert "CREATE VECTOR INDEX entity_embedding IF NOT EXISTS" in stmt
    assert "FOR (n:Entity) ON (n.`embedding`)" in stmt
    assert "`vector.dimensions`: 384" in stmt
    assert "`vector.similarity_function`: 'cosine'" in stmt


def test_vector_index_statement_rejects_injection_and_bad_config() -> None:
    with pytest.raises(ValueError):
        vector_index_statement(label="Entity) DETACH DELETE n //")
    with pytest.raises(ValueError):
        vector_index_statement(property="embed`ding")
    with pytest.raises(ValueError):
        vector_index_statement(similarity="dot")
    with pytest.raises(ValueError):
        vector_index_statement(dimension=0)


# --- Fake embedder + driver -------------------------------------------------


class _FakeEmbedder:
    """A deterministic stand-in for a sentence-transformers model."""

    def __init__(self, dimension: int = 3, *, available: bool = True) -> None:
        self._dimension = dimension
        self._available = available

    @property
    def dimension(self) -> int:
        return self._dimension

    def available(self) -> bool:
        return self._available

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        # A stable, text-derived vector so writes are inspectable.
        return [[float(len(t)), 0.0, 1.0] for t in texts]


class _Call:
    def __init__(self, cypher: str, params: dict[str, Any]) -> None:
        self.cypher = cypher
        self.params = params


class _FakeResult:
    def __init__(self, records: list[dict[str, Any]]) -> None:
        self._records = records

    def __iter__(self) -> Any:
        return iter(self._records)

    def single(self) -> dict[str, Any] | None:
        return self._records[0] if self._records else None


class _FakeSession:
    def __init__(self, driver: _FakeDriver) -> None:
        self._driver = driver

    def __enter__(self) -> _FakeSession:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def run(self, cypher: str, params: dict[str, Any] | None = None) -> _FakeResult:
        params = params or {}
        self._driver.calls.append(_Call(cypher, params))
        if "RETURN n.csid AS csid, n.name AS name" in cypher:
            return _FakeResult(self._driver.nodes)
        if "count(n) AS count" in cypher:
            return _FakeResult([{"count": len(self._driver.nodes)}])
        return _FakeResult([])


class _FakeDriver:
    def __init__(self, nodes: list[dict[str, Any]]) -> None:
        self.nodes = nodes
        self.calls: list[_Call] = []
        self.closed = False

    def session(self) -> _FakeSession:
        return _FakeSession(self)

    def close(self) -> None:
        self.closed = True


NODES = [
    {
        "csid": "cs:culture:sumer",
        "name": "Sumer",
        "aliases": "Shumer",
        "description": "civ",
    },
    {"csid": "cs:place:uruk", "name": "Uruk", "aliases": "", "description": ""},
    {"csid": "cs:place:blank", "name": "", "aliases": "", "description": ""},
]


# --- Reading, embedding, writing --------------------------------------------


def test_read_node_texts_skips_textless_nodes() -> None:
    driver = _FakeDriver(NODES)
    texts = read_node_texts(driver)  # type: ignore[arg-type]
    assert texts == [
        NodeText("cs:culture:sumer", "Sumer\nShumer\nciv"),
        NodeText("cs:place:uruk", "Uruk"),
    ]


def test_embed_nodes_batches_and_writes_vectors() -> None:
    driver = _FakeDriver(NODES)
    written = embed_nodes(driver, _FakeEmbedder(), batch_size=1)  # type: ignore[arg-type]
    assert written == 2
    writes = [c for c in driver.calls if "setNodeVectorProperty" in c.cypher]
    assert len(writes) == 2  # one round-trip per batch of 1
    first_rows = writes[0].params["rows"]
    assert first_rows[0]["csid"] == "cs:culture:sumer"
    # Vector is len("Sumer\nShumer\nciv") == 16 in the first slot.
    assert first_rows[0]["embedding"][0] == 16.0
    assert writes[0].params["property"] == "embedding"


def test_build_vector_index_embeds_then_creates_index() -> None:
    driver = _FakeDriver(NODES)
    result = build_vector_index(driver, _FakeEmbedder(dimension=3))  # type: ignore[arg-type]
    assert isinstance(result, IndexBuildResult)
    assert result.embedded == 2
    assert result.node_count == 3
    assert result.dimension == 3
    assert result.index_name == "entity_embedding"
    index_calls = [c for c in driver.calls if "CREATE VECTOR INDEX" in c.cypher]
    assert len(index_calls) == 1
    assert "`vector.dimensions`: 3" in index_calls[0].cypher


# --- SentenceTransformerEmbedder gating -------------------------------------


def test_sentence_transformer_embedder_reports_default_dimension() -> None:
    embedder = SentenceTransformerEmbedder()
    assert embedder.model_name == DEFAULT_MODEL
    assert embedder.dimension == 384
    # available() reflects whether the optional extra is importable; either way
    # it must not raise or load a model.
    assert isinstance(embedder.available(), bool)
