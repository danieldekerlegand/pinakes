"""The personal (Analyzer) tier loads into Neo4j via the existing loaders (US-004).

No live server. The Neo4j converter is dataset-agnostic (``neo4j/CLAUDE.md``):
node labels come from the ``:LABEL`` cell and edge types from ``:TYPE``, so a
personal-tier corpus — content-addressed ``asset`` nodes (``:LABEL=Asset``,
``source=analyzer``) plus the ``DEPICTS``/``MENTIONS``/``DERIVED_FROM`` grounding
edges — flows through the same path as any other corpus, with **no loader
change**. These tests prove it: assets land under a distinct ``:Asset`` label
(keeping the shared ``Entity`` anchor and their ``source=analyzer`` provenance), the
grounding edge types load, a per-label ``csid_unique_Asset`` constraint is
emitted, and the load is idempotent on re-ingest.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import url2pathname

from culturescrape.neo4j.constraints import ENTITY_LABEL
from culturescrape.neo4j.load_csv import FILE_PARAM, apply_load_csv, load_corpus
from culturescrape.neo4j.merge_load import verify_idempotent_load
from culturescrape.schema.headers import EdgeSchema, NodeSchema
from culturescrape.schema.tsvio import read_rows, write_edge_rows, write_node_rows

#: The committed file-web fixture: 3 personal assets + a public pinakes subgraph.
FIXTURE = Path(__file__).parent / "fixtures" / "file-web"

#: A personal-tier corpus mixing asset nodes (source=analyzer) with the public
#: entities they are grounded against (source=pinakes), in the same dataset — the
#: shape the Analyzer ingest (US-003) produces.
_ASSETS: tuple[dict[str, str | list[str]], ...] = (
    {
        ":LABEL": ["Asset"],
        "csid": "cs:asset:aaa111",
        "name": "raw_beach.jpg",
        "source": "analyzer",
        "source_url": "run:20260710T0900",
        "confidence": "0.9",
        "license": "CC0-1.0",
    },
    {
        ":LABEL": ["Asset"],
        "csid": "cs:asset:bbb222",
        "name": "beach_final.mp4",
        "source": "analyzer",
        "source_url": "run:20260711T1430",
        "confidence": "0.85",
    },
)

_PLACES: tuple[dict[str, str | list[str]], ...] = (
    {
        ":LABEL": ["Place"],
        "csid": "cs:place:Q1524",
        "name": "Athens",
        "wikidata_qid": "Q1524",
        "source": "pinakes",
        "source_url": "https://www.wikidata.org/entity/Q1524",
        "confidence": "1.0",
    },
)

_EDGES: tuple[dict[str, str], ...] = (
    {
        ":START_ID": "cs:asset:aaa111",
        ":END_ID": "cs:place:Q1524",
        ":TYPE": "DEPICTS",
        "source": "analyzer",
        "confidence": "0.8",
    },
    {
        ":START_ID": "cs:asset:bbb222",
        ":END_ID": "cs:asset:aaa111",
        ":TYPE": "DERIVED_FROM",
        "source": "analyzer",
        "confidence": "0.95",
    },
)


def _write_personal_corpus(root: Path) -> None:
    node_schema = NodeSchema.canonical()
    edge_schema = EdgeSchema.canonical()
    write_node_rows(root / "nodes" / "Asset.tsv", node_schema, list(_ASSETS))
    write_node_rows(root / "nodes" / "Place.tsv", node_schema, list(_PLACES))
    write_edge_rows(root / "edges" / "DEPICTS.tsv", edge_schema, [_EDGES[0]])
    write_edge_rows(root / "edges" / "DERIVED_FROM.tsv", edge_schema, [_EDGES[1]])


def _as_str(value: Any) -> str:
    assert isinstance(value, str)
    return value


def _as_list(value: Any) -> list[str]:
    assert isinstance(value, list)
    return value


class _EmbeddedGraph:
    """In-memory graph applying the loader's MERGE-on-identity semantics.

    A copy of the ``test_neo4j_pinakes`` stand-in: it reads the file the real
    generated statement binds to ``$file`` and applies the statement's intent, so
    the production :func:`apply_load_csv` runs unmodified against an in-process
    "database".
    """

    def __init__(self) -> None:
        self.nodes: dict[str, dict[str, Any]] = {}
        self.edges: dict[tuple[str, str, str], dict[str, Any]] = {}

    def session(self) -> _EmbeddedSession:
        return _EmbeddedSession(self)

    def close(self) -> None:  # pragma: no cover - loader owns/opens its driver
        pass

    def _apply_node_file(self, path: Path) -> None:
        _, rows = read_rows(path)
        for row in rows:
            csid = _as_str(row["csid"])
            labels = set(_as_list(row.get(":LABEL", []))) | {ENTITY_LABEL}
            source = _as_str(row.get("source", ""))
            existing = self.nodes.get(csid)
            if existing is None:
                self.nodes[csid] = {"labels": labels, "source": source}
            else:
                existing["labels"].update(labels)

    def _apply_edge_file(self, path: Path) -> None:
        _, rows = read_rows(path)
        for row in rows:
            key = (
                _as_str(row[":START_ID"]),
                _as_str(row[":END_ID"]),
                _as_str(row[":TYPE"]),
            )
            self.edges[key] = {"source": _as_str(row.get("source", ""))}


class _EmbeddedSession:
    def __init__(self, graph: _EmbeddedGraph) -> None:
        self._graph = graph

    def __enter__(self) -> _EmbeddedSession:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def run(
        self, cypher: str, parameters: dict[str, Any] | None = None, **kw: Any
    ) -> list[Any]:
        params = parameters if parameters is not None else kw
        url = params.get(FILE_PARAM)
        if url is None:
            return []
        path = Path(url2pathname(urlparse(_as_str(url)).path))
        if "apoc.merge.relationship" in cypher:
            self._graph._apply_edge_file(path)
        else:
            self._graph._apply_node_file(path)
        return []


def test_assets_load_under_a_distinct_asset_label(tmp_path: Path) -> None:
    corpus = tmp_path / "corpus"
    _write_personal_corpus(corpus)

    graph = _EmbeddedGraph()
    driver: Any = graph
    apply_load_csv(corpus, driver=driver)

    asset = graph.nodes["cs:asset:aaa111"]
    # A distinct Asset label, the shared Entity anchor, and source=analyzer carried.
    assert "Asset" in asset["labels"]
    assert ENTITY_LABEL in asset["labels"]
    assert asset["source"] == "analyzer"
    # The public entity the asset grounds against loads under its own label.
    assert "Place" in graph.nodes["cs:place:Q1524"]["labels"]
    assert all(ENTITY_LABEL in node["labels"] for node in graph.nodes.values())


def test_grounding_edge_types_load(tmp_path: Path) -> None:
    corpus = tmp_path / "corpus"
    _write_personal_corpus(corpus)

    graph = _EmbeddedGraph()
    driver: Any = graph
    apply_load_csv(corpus, driver=driver)

    # DEPICTS (asset -> entity) and DERIVED_FROM (asset -> asset) both loaded.
    assert ("cs:asset:aaa111", "cs:place:Q1524", "DEPICTS") in graph.edges
    assert ("cs:asset:bbb222", "cs:asset:aaa111", "DERIVED_FROM") in graph.edges
    assert all(e["source"] == "analyzer" for e in graph.edges.values())


def test_load_corpus_emits_a_per_label_asset_constraint(tmp_path: Path) -> None:
    corpus = tmp_path / "corpus"
    _write_personal_corpus(corpus)

    graph = _EmbeddedGraph()
    driver: Any = graph
    report = load_corpus(corpus, driver=driver)

    joined = "\n".join(report.constraints)
    assert "csid_unique_Asset IF NOT EXISTS" in joined
    assert "Asset" in graph.nodes["cs:asset:aaa111"]["labels"]


def test_personal_reload_is_idempotent(tmp_path: Path) -> None:
    corpus = tmp_path / "corpus"
    _write_personal_corpus(corpus)

    graph = _EmbeddedGraph()
    driver: Any = graph
    apply_load_csv(corpus, driver=driver)
    apply_load_csv(corpus, driver=driver)  # second ingest of the same artifact

    assert len(graph.nodes) == len(_ASSETS) + len(_PLACES)
    assert len(graph.edges) == len(_EDGES)


def test_committed_file_web_fixture_loads_idempotently() -> None:
    """The committed file-web corpus MERGE-loads twice with assets distinct."""
    report = verify_idempotent_load(FIXTURE)
    assert report.idempotent
    # Assets are tallied under their own label alongside the public entities.
    assert report.counts.nodes_by_label["Asset"] == 3
    for edge_type in ("DEPICTS", "MENTIONS", "DERIVED_FROM"):
        assert edge_type in report.counts.edges_by_type
