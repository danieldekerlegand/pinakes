"""Node embeddings and the Neo4j 5 native vector index (GraphRAG, Phase 5).

GraphRAG retrieval needs semantic search over the graph: a local
sentence-transformers model turns each node's ``name``/``aliases``/``description``
into a dense vector, the vectors land on the nodes, and a Neo4j 5 **native vector
index** makes ``CALL db.index.vector.queryNodes`` a top-k nearest-neighbour lookup.
This module is the *repeatable build step* — the embedder and the index-build
orchestration — that the ``culturescrape graphrag-index`` CLI subcommand runs.

Two deliberate isolation rules, mirroring the rest of :mod:`culturescrape.neo4j`:

* The optional ``neo4j`` driver is only touched through an already-connected
  ``Driver`` handed in by the caller (the CLI opens one via
  :func:`culturescrape.neo4j.connect`); importing this module never needs it.
* ``sentence-transformers`` (and its torch stack) is heavy, so it ships behind the
  ``graphrag`` extra and is imported **lazily** inside
  :class:`SentenceTransformerEmbedder`. Importing this module — and every pure
  helper (embedding text, the index DDL) — works with the extra absent, which is
  what keeps the sidecar image slim and the offline unit tests runnable in CI.
"""

from __future__ import annotations

import importlib.util
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

from culturescrape.neo4j import connect
from culturescrape.neo4j.constraints import ENTITY_LABEL

if TYPE_CHECKING:
    from neo4j import Driver

#: The local sentence-transformers model used by default. Small, CPU-friendly,
#: 384-dimensional — a sensible GraphRAG default (see the runbook).
DEFAULT_MODEL = "all-MiniLM-L6-v2"

#: Embedding dimension of :data:`DEFAULT_MODEL`; the real value is read back off
#: the loaded model, so this is only the pre-load default for the index DDL.
DEFAULT_DIMENSION = 384

#: Name of the native vector index created over the embedding property.
VECTOR_INDEX_NAME = "entity_embedding"

#: Node property the embedding vector is written to / indexed on.
EMBEDDING_PROPERTY = "embedding"

#: Similarity function the index scores with (``cosine`` or ``euclidean``).
DEFAULT_SIMILARITY = "cosine"

#: How many nodes are embedded + written per round-trip.
DEFAULT_BATCH_SIZE = 256


class EmbedderNotInstalled(ImportError):
    """Raised when the optional ``graphrag`` embedding extra is not installed."""

    def __init__(self) -> None:
        super().__init__(
            "GraphRAG node embedding requires sentence-transformers, which is "
            "not installed. Install it with: pip install 'culturescrape[graphrag]'"
        )


@runtime_checkable
class Embedder(Protocol):
    """A text -> dense-vector encoder, injectable so tests avoid a real model."""

    @property
    def dimension(self) -> int:
        """Length of the vectors :meth:`embed` returns."""
        ...

    def available(self) -> bool:
        """Whether the encoder can actually run (its backend is importable)."""
        ...

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """Encode *texts* into one dense vector each, order-preserving."""
        ...


def node_embedding_text(
    name: str, aliases: str = "", description: str = ""
) -> str:
    """The text embedded for a node: its name, aliases and description.

    Blank parts are dropped and the survivors joined with newlines, so a node
    with only a name still yields usable text and a rich node contributes its
    aliases + gloss. Whitespace is trimmed; the result is never ``None``.
    """
    parts = [part.strip() for part in (name, aliases, description)]
    return "\n".join(part for part in parts if part)


class SentenceTransformerEmbedder:
    """A local :mod:`sentence_transformers` encoder, loaded lazily on first use.

    Constructing one is cheap and import-free — the model (and its torch stack)
    is only imported and downloaded when :meth:`embed` is first called, so an
    instance can gate an endpoint via :meth:`available` without loading anything.
    """

    def __init__(
        self, model_name: str = DEFAULT_MODEL, *, dimension: int = DEFAULT_DIMENSION
    ) -> None:
        self.model_name = model_name
        self._dimension = dimension
        self._model: Any | None = None

    @staticmethod
    def installed() -> bool:
        """Whether the ``sentence_transformers`` package is importable."""
        return importlib.util.find_spec("sentence_transformers") is not None

    def available(self) -> bool:
        return self.installed()

    @property
    def dimension(self) -> int:
        return self._dimension

    def _load(self) -> Any:
        if self._model is None:
            if not self.installed():
                raise EmbedderNotInstalled()
            from sentence_transformers import SentenceTransformer

            model = SentenceTransformer(self.model_name)
            self._model = model
            self._dimension = int(model.get_sentence_embedding_dimension())
        return self._model

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        model = self._load()
        vectors = model.encode(list(texts), normalize_embeddings=True)
        return [[float(value) for value in row] for row in vectors]


@dataclass(frozen=True)
class NodeText:
    """One node's csid and the text that will be embedded for it."""

    csid: str
    text: str


@dataclass(frozen=True)
class IndexBuildResult:
    """Summary of a vector-index build run."""

    index_name: str
    label: str
    property: str
    dimension: int
    similarity: str
    node_count: int
    embedded: int


def _ident(value: str, kind: str) -> str:
    """Guard a Cypher identifier (label / property / index name) for interpolation.

    A ``:LABEL`` or property name cannot be a Cypher parameter, so it must be
    substituted into the statement text; restrict it to the identifier charset so
    the interpolation can never inject Cypher.
    """
    if not value or not all(ch.isalnum() or ch == "_" for ch in value):
        raise ValueError(f"invalid {kind}: {value!r}")
    return value


def vector_index_statement(
    *,
    name: str = VECTOR_INDEX_NAME,
    label: str = ENTITY_LABEL,
    property: str = EMBEDDING_PROPERTY,
    dimension: int = DEFAULT_DIMENSION,
    similarity: str = DEFAULT_SIMILARITY,
) -> str:
    """The idempotent ``CREATE VECTOR INDEX`` DDL (Neo4j 5 native vector index).

    ``IF NOT EXISTS`` makes it safe to re-run. Identifiers are validated because
    they are interpolated (only the config values can be parameters, and index
    DDL takes none), and *similarity* is checked against the two functions Neo4j
    supports.
    """
    name = _ident(name, "index name")
    label = _ident(label, "label")
    property = _ident(property, "property")
    if similarity not in ("cosine", "euclidean"):
        raise ValueError(f"invalid similarity function: {similarity!r}")
    if dimension <= 0:
        raise ValueError(f"invalid dimension: {dimension!r}")
    return (
        f"CREATE VECTOR INDEX {name} IF NOT EXISTS "
        f"FOR (n:{label}) ON (n.`{property}`) "
        "OPTIONS { indexConfig: { "
        f"`vector.dimensions`: {int(dimension)}, "
        f"`vector.similarity_function`: '{similarity}' "
        "} }"
    )


def create_vector_index(
    driver: Driver,
    *,
    name: str = VECTOR_INDEX_NAME,
    label: str = ENTITY_LABEL,
    property: str = EMBEDDING_PROPERTY,
    dimension: int = DEFAULT_DIMENSION,
    similarity: str = DEFAULT_SIMILARITY,
) -> str:
    """Create the native vector index on *driver*; returns the executed DDL."""
    statement = vector_index_statement(
        name=name,
        label=label,
        property=property,
        dimension=dimension,
        similarity=similarity,
    )
    with driver.session() as session:
        session.run(statement)
    return statement


def read_node_texts(driver: Driver, *, label: str = ENTITY_LABEL) -> list[NodeText]:
    """Read every *label* node's csid and its embedding text from the graph.

    Nodes whose name/aliases/description are all blank yield empty text and are
    skipped — there is nothing meaningful to embed for them.
    """
    label = _ident(label, "label")
    texts: list[NodeText] = []
    with driver.session() as session:
        records = session.run(
            f"MATCH (n:{label}) "
            "RETURN n.csid AS csid, n.name AS name, "
            "n.aliases AS aliases, n.description AS description"
        )
        for record in records:
            csid = record["csid"]
            if not csid:
                continue
            text = node_embedding_text(
                _string(record["name"]),
                _string(record["aliases"]),
                _string(record["description"]),
            )
            if text:
                texts.append(NodeText(csid=str(csid), text=text))
    return texts


def write_embeddings(
    driver: Driver,
    rows: Sequence[Mapping[str, Any]],
    *,
    label: str = ENTITY_LABEL,
    property: str = EMBEDDING_PROPERTY,
) -> None:
    """Write a batch of ``{csid, embedding}`` rows onto their nodes.

    Uses ``db.create.setNodeVectorProperty`` (the Neo4j 5 API that validates a
    vector property against the index) so the embeddings are index-ready.
    """
    label = _ident(label, "label")
    with driver.session() as session:
        session.run(
            "UNWIND $rows AS row "
            f"MATCH (n:{label} {{csid: row.csid}}) "
            "CALL db.create.setNodeVectorProperty(n, $property, row.embedding)",
            {"rows": list(rows), "property": property},
        )


def _batches(items: Sequence[NodeText], size: int) -> Iterator[list[NodeText]]:
    for start in range(0, len(items), size):
        yield list(items[start : start + size])


def embed_nodes(
    driver: Driver,
    embedder: Embedder,
    *,
    label: str = ENTITY_LABEL,
    property: str = EMBEDDING_PROPERTY,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> int:
    """Embed every *label* node's text and write the vectors back; returns count.

    Nodes are read once, embedded in batches, and each batch written in a single
    round-trip. The count is the number of nodes that received an embedding.
    """
    texts = read_node_texts(driver, label=label)
    written = 0
    for batch in _batches(texts, max(1, batch_size)):
        vectors = embedder.embed([node.text for node in batch])
        rows = [
            {"csid": node.csid, "embedding": vector}
            for node, vector in zip(batch, vectors, strict=True)
        ]
        write_embeddings(driver, rows, label=label, property=property)
        written += len(rows)
    return written


def build_vector_index(
    driver: Driver,
    embedder: Embedder,
    *,
    index_name: str = VECTOR_INDEX_NAME,
    label: str = ENTITY_LABEL,
    property: str = EMBEDDING_PROPERTY,
    similarity: str = DEFAULT_SIMILARITY,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> IndexBuildResult:
    """Embed all nodes then create the native vector index over their vectors.

    Embedding happens first so the index is created against the true model
    dimension (read off :attr:`Embedder.dimension` after the first batch loads
    the model). Both steps are idempotent, so re-running refreshes embeddings and
    leaves one index.
    """
    embedded = embed_nodes(
        driver,
        embedder,
        label=label,
        property=property,
        batch_size=batch_size,
    )
    dimension = embedder.dimension
    create_vector_index(
        driver,
        name=index_name,
        label=label,
        property=property,
        dimension=dimension,
        similarity=similarity,
    )
    node_count = _count_nodes(driver, label=label)
    return IndexBuildResult(
        index_name=index_name,
        label=label,
        property=property,
        dimension=dimension,
        similarity=similarity,
        node_count=node_count,
        embedded=embedded,
    )


def run_index_build(
    config: Mapping[str, Any] | None = None,
    *,
    env: Mapping[str, str] | None = None,
    model: str = DEFAULT_MODEL,
    index_name: str = VECTOR_INDEX_NAME,
    similarity: str = DEFAULT_SIMILARITY,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> IndexBuildResult:
    """Open a Neo4j driver and run the full embed + index build (the CLI entry).

    Raises :class:`EmbedderNotInstalled` when the ``graphrag`` extra is absent,
    and the usual :class:`culturescrape.neo4j.Neo4jConfigError` /
    :class:`~culturescrape.neo4j.Neo4jDriverNotInstalled` when the graph is not
    reachable — the CLI surfaces each as a clean failure.
    """
    embedder = SentenceTransformerEmbedder(model)
    if not embedder.available():
        raise EmbedderNotInstalled()
    driver = connect(config, env=env)
    try:
        return build_vector_index(
            driver,
            embedder,
            index_name=index_name,
            similarity=similarity,
            batch_size=batch_size,
        )
    finally:
        driver.close()


def _count_nodes(driver: Driver, *, label: str = ENTITY_LABEL) -> int:
    label = _ident(label, "label")
    with driver.session() as session:
        record = session.run(f"MATCH (n:{label}) RETURN count(n) AS count").single()
    if record is None:
        return 0
    return int(record["count"])


def _string(value: Any) -> str:
    """Coerce a Cypher-returned scalar to a display string (``None`` -> ``''``)."""
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return "; ".join(_string(item) for item in value)
    return str(value)


__all__ = [
    "DEFAULT_BATCH_SIZE",
    "DEFAULT_DIMENSION",
    "DEFAULT_MODEL",
    "DEFAULT_SIMILARITY",
    "EMBEDDING_PROPERTY",
    "VECTOR_INDEX_NAME",
    "Embedder",
    "EmbedderNotInstalled",
    "IndexBuildResult",
    "NodeText",
    "SentenceTransformerEmbedder",
    "build_vector_index",
    "create_vector_index",
    "embed_nodes",
    "node_embedding_text",
    "read_node_texts",
    "run_index_build",
    "vector_index_statement",
    "write_embeddings",
]
