"""Smoke test: the merged corpus loads Pinakes-origin rows under the same
labels and edge types as native nodes (T?-US-006).

No live Neo4j server is required. A *merged* canonical corpus is written — one
that mixes Wikidata-sourced ("native", ``source='wikidata'``) rows with
Pinakes-origin (``source='pinakes'``) rows in the **same** per-label
node files and per-type edge files, exactly as the pipeline groups a converged
graph. The real incremental loader (:func:`apply_load_csv`) is then run against
an *embedded* in-memory graph (:class:`_EmbeddedGraph`) that applies the same
identity semantics the generated Cypher encodes:

* nodes ``MERGE`` on ``csid`` under the shared
  :data:`~culturescrape.neo4j.constraints.ENTITY_LABEL` anchor, gaining every
  label in their ``:LABEL`` cell;
* relationships key on ``(:START_ID, :END_ID, :TYPE)``.

Because native and Pinakes rows share a file per label/type, "loaded under
the same labels" is not an assertion about the loader special-casing a source —
it is a property of the converged data flowing through one dataset-agnostic
path. The tests assert the expected labels (``Language``,
``ArchaeologicalCulture``) and edge type (``DESCENDS_FROM``) appear carrying
*both* sources, that every node keeps the ``Entity`` anchor the ``csid``
uniqueness constraint attaches to, and that ``csid`` stays globally unique across
the merge.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import url2pathname

from culturescrape.neo4j.admin_import import generate_import_script
from culturescrape.neo4j.constraints import (
    CSID_CONSTRAINT,
    ENTITY_LABEL,
    constraint_statements,
)
from culturescrape.neo4j.load_csv import (
    FILE_PARAM,
    apply_load_csv,
    build_statements,
    load_corpus,
)
from culturescrape.schema.headers import EdgeSchema, NodeSchema
from culturescrape.schema.tsvio import read_rows, write_edge_rows, write_node_rows

# --------------------------------------------------------------------------- #
# A merged corpus: native + Pinakes rows share each label/type file.
# --------------------------------------------------------------------------- #

_LANGUAGES: tuple[dict[str, str | list[str]], ...] = (
    {
        # Native (Wikidata-sourced) language.
        ":LABEL": ["Language"],
        "csid": "cs:language:en",
        "name": "English",
        "wikidata_qid": "Q1860",
        "source": "wikidata",
        "confidence": "0.95",
    },
    {
        # Pinakes-origin language, same label as the native row.
        ":LABEL": ["Language"],
        "csid": "cs:language:pie",
        "name": "Proto-Indo-European",
        "pinakes_id": "pie",
        "time_start": "-4500",
        "source": "pinakes",
        "confidence": "0.8",
    },
    {
        ":LABEL": ["Language"],
        "csid": "cs:language:aap",
        "name": "Arara (Para)",
        "pinakes_id": "aap",
        "source": "pinakes",
        "confidence": "0.5",
    },
)

_CULTURES: tuple[dict[str, str | list[str]], ...] = (
    {
        # Native archaeological culture.
        ":LABEL": ["ArchaeologicalCulture"],
        "csid": "cs:archaeological-culture:corded-ware",
        "name": "Corded Ware",
        "wikidata_qid": "Q216588",
        "source": "wikidata",
        "confidence": "0.9",
    },
    {
        # Pinakes-origin cultures, same label as the native row.
        ":LABEL": ["ArchaeologicalCulture"],
        "csid": "cs:archaeological-culture:yamnaya",
        "name": "Yamnaya",
        "pinakes_id": "yamnaya",
        "time_start": "-3300",
        "source": "pinakes",
        "confidence": "0.9",
    },
    {
        ":LABEL": ["ArchaeologicalCulture"],
        "csid": "cs:archaeological-culture:bell-beaker",
        "name": "Bell Beaker",
        "pinakes_id": "bell-beaker",
        "time_start": "-2800",
        "source": "pinakes",
        "confidence": "0.7",
    },
)

_EDGES: tuple[dict[str, str], ...] = (
    {
        # Native edge — and a cross-source one: it points at a Pinakes node.
        ":START_ID": "cs:archaeological-culture:corded-ware",
        ":END_ID": "cs:archaeological-culture:yamnaya",
        ":TYPE": "DESCENDS_FROM",
        "weight": "0.8",
        "source": "wikidata",
        "confidence": "0.8",
    },
    {
        # Pinakes-origin edge, same :TYPE as the native one.
        ":START_ID": "cs:archaeological-culture:bell-beaker",
        ":END_ID": "cs:archaeological-culture:yamnaya",
        ":TYPE": "DESCENDS_FROM",
        "weight": "0.85",
        "source": "pinakes",
        "confidence": "0.85",
    },
)


def _write_merged_corpus(root: Path) -> None:
    """Write the merged corpus with native + Pinakes rows sharing files."""
    node_schema = NodeSchema.canonical()
    edge_schema = EdgeSchema.canonical()
    write_node_rows(root / "nodes" / "Language.tsv", node_schema, list(_LANGUAGES))
    write_node_rows(
        root / "nodes" / "ArchaeologicalCulture.tsv", node_schema, list(_CULTURES)
    )
    write_edge_rows(root / "edges" / "DESCENDS_FROM.tsv", edge_schema, list(_EDGES))


# --------------------------------------------------------------------------- #
# An embedded Neo4j stand-in driven by the real generated statements.
# --------------------------------------------------------------------------- #


def _as_str(value: Any) -> str:
    assert isinstance(value, str)
    return value


def _as_list(value: Any) -> list[str]:
    assert isinstance(value, list)
    return value


class _EmbeddedGraph:
    """In-memory graph applying the loader's MERGE-on-identity semantics.

    :func:`apply_load_csv` binds each generated statement to a file URL; this
    stand-in reads that file and applies the statement's *intent* (a node
    ``MERGE`` on ``csid`` gaining its labels, or an edge keyed on
    ``(start, end, type)``), so the production loader runs unmodified while the
    "database" stays in process.
    """

    def __init__(self) -> None:
        #: csid -> {"labels": set[str], "source": str}
        self.nodes: dict[str, dict[str, Any]] = {}
        #: (start, end, type) -> {"source": str}
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
            if existing is None:  # MERGE creates
                self.nodes[csid] = {"labels": labels, "source": source}
            else:  # MERGE updates in place — never a duplicate node
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
    """Context-managed session that applies a bound statement to its graph."""

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
        if url is None:  # e.g. a constraint statement, no file to load
            return []
        path = Path(url2pathname(urlparse(_as_str(url)).path))
        if "apoc.merge.relationship" in cypher:
            self._graph._apply_edge_file(path)
        else:
            self._graph._apply_node_file(path)
        return []


# --------------------------------------------------------------------------- #
# Tests.
# --------------------------------------------------------------------------- #


def test_merged_corpus_loads_pinakes_under_shared_labels(tmp_path: Path) -> None:
    """Native + Pinakes nodes appear under the same labels + Entity anchor."""
    corpus = tmp_path / "corpus"
    _write_merged_corpus(corpus)

    graph = _EmbeddedGraph()
    driver: Any = graph  # a fake driver stands in for the Bolt connection
    apply_load_csv(corpus, driver=driver)

    # The Language label carries both a native and a Pinakes-origin node.
    native_lang = graph.nodes["cs:language:en"]
    ls_lang = graph.nodes["cs:language:pie"]
    assert native_lang["source"] == "wikidata"
    assert ls_lang["source"] == "pinakes"
    assert "Language" in native_lang["labels"]
    assert "Language" in ls_lang["labels"]

    # Same for ArchaeologicalCulture across the two sources.
    native_culture = graph.nodes["cs:archaeological-culture:corded-ware"]
    ls_culture = graph.nodes["cs:archaeological-culture:yamnaya"]
    assert native_culture["source"] == "wikidata"
    assert ls_culture["source"] == "pinakes"
    assert "ArchaeologicalCulture" in native_culture["labels"]
    assert "ArchaeologicalCulture" in ls_culture["labels"]

    # Every node keeps the shared Entity anchor the csid constraint attaches to.
    assert all(ENTITY_LABEL in node["labels"] for node in graph.nodes.values())


def test_merged_corpus_loads_shared_edge_types(tmp_path: Path) -> None:
    """The DESCENDS_FROM edge type appears carrying both sources."""
    corpus = tmp_path / "corpus"
    _write_merged_corpus(corpus)

    graph = _EmbeddedGraph()
    driver: Any = graph
    apply_load_csv(corpus, driver=driver)

    descends = {
        key: edge for key, edge in graph.edges.items() if key[2] == "DESCENDS_FROM"
    }
    assert descends, "expected DESCENDS_FROM relationships to be loaded"
    sources = {edge["source"] for edge in descends.values()}
    assert {"wikidata", "pinakes"} <= sources

    # The cross-source edge (native start -> Pinakes end) is present.
    cross = (
        "cs:archaeological-culture:corded-ware",
        "cs:archaeological-culture:yamnaya",
        "DESCENDS_FROM",
    )
    assert cross in graph.edges


def test_reload_of_merged_corpus_is_idempotent(tmp_path: Path) -> None:
    """Re-running the loader MERGEs, so node/edge counts are unchanged."""
    corpus = tmp_path / "corpus"
    _write_merged_corpus(corpus)

    graph = _EmbeddedGraph()
    driver: Any = graph
    apply_load_csv(corpus, driver=driver)
    apply_load_csv(corpus, driver=driver)  # second pass must not duplicate

    assert len(graph.nodes) == len(_LANGUAGES) + len(_CULTURES)
    assert len(graph.edges) == len(_EDGES)


def test_load_corpus_applies_per_label_constraints_then_loads(tmp_path: Path) -> None:
    """load_corpus applies global + per-label constraints, then MERGE-loads."""
    corpus = tmp_path / "corpus"
    _write_merged_corpus(corpus)

    graph = _EmbeddedGraph()
    driver: Any = graph
    report = load_corpus(corpus, driver=driver)

    # Per-label constraints cover exactly the merged corpus's labels.
    joined = "\n".join(report.constraints)
    assert "csid_unique_Language IF NOT EXISTS" in joined
    assert "csid_unique_ArchaeologicalCulture IF NOT EXISTS" in joined
    # The load still lands the nodes and edges under their shared labels.
    assert "Language" in graph.nodes["cs:language:pie"]["labels"]
    assert len(report.statements) == 3  # 2 node files + 1 edge file


def test_load_corpus_is_idempotent(tmp_path: Path) -> None:
    """Re-running load_corpus MERGEs, so node/edge counts are unchanged."""
    corpus = tmp_path / "corpus"
    _write_merged_corpus(corpus)

    graph = _EmbeddedGraph()
    driver: Any = graph
    load_corpus(corpus, driver=driver)
    load_corpus(corpus, driver=driver)  # second pass must not duplicate

    assert len(graph.nodes) == len(_LANGUAGES) + len(_CULTURES)
    assert len(graph.edges) == len(_EDGES)


def test_csid_uniqueness_constraint_anchors_the_merged_corpus() -> None:
    """A single Entity-anchored constraint enforces csid uniqueness globally."""
    statements = constraint_statements()
    csid_stmt = next(s for s in statements if CSID_CONSTRAINT in s)
    assert f"FOR (n:{ENTITY_LABEL})" in csid_stmt
    assert "n.csid IS UNIQUE" in csid_stmt


def test_merged_corpus_has_globally_unique_csids(tmp_path: Path) -> None:
    """No csid collides between native and Pinakes rows in the merge."""
    corpus = tmp_path / "corpus"
    _write_merged_corpus(corpus)

    csids: list[str] = []
    for path in sorted((corpus / "nodes").glob("*.tsv")):
        _, rows = read_rows(path)
        csids.extend(_as_str(row["csid"]) for row in rows)
    assert len(csids) == len(set(csids))


def test_loaders_reference_the_shared_label_and_type_files(tmp_path: Path) -> None:
    """load_csv + admin_import both target the merged label/type files."""
    corpus = tmp_path / "corpus"
    _write_merged_corpus(corpus)

    # Incremental LOAD CSV: a statement per merged node/edge file, nodes first.
    statements = build_statements(corpus)
    node_files = {s.file.name for s in statements if s.kind == "node"}
    edge_files = {s.file.name for s in statements if s.kind == "edge"}
    assert {"Language.tsv", "ArchaeologicalCulture.tsv"} <= node_files
    assert "DESCENDS_FROM.tsv" in edge_files

    # Bulk neo4j-admin import: the command references the same files.
    plan = generate_import_script(corpus, out_dir=tmp_path / "build")
    referenced = {path.name for path in plan.node_files + plan.edge_files}
    assert {"Language.tsv", "ArchaeologicalCulture.tsv", "DESCENDS_FROM.tsv"} <= (
        referenced
    )
