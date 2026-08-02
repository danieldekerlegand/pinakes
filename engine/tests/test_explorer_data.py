"""Tests for the explorer corpus data-access layer (T7-US-002).

Pins what every view depends on: a bare corpus dataset and a full job output
root both load; nodes/edges parse into rows; lookups by csid, label, and edge
type work; the catalog, metrics, and QA artifacts are read when present; and a
non-corpus directory fails clearly.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pinakes_engine.explorer.data import (
    Corpus,
    CorpusError,
    first_label,
    load_corpus,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
SAMPLE = REPO_ROOT / "inputs" / "datalog-examples" / "dataset"
#: A full job output root fixture: corpus/ TSV plus catalog.json, metrics.json,
#: qa.json, and per-category reports under qa/.
FIXTURE_ROOT = REPO_ROOT / "tests" / "fixtures" / "explorer-corpus"


def test_loads_a_bare_corpus_directory() -> None:
    corpus = load_corpus(SAMPLE)

    assert isinstance(corpus, Corpus)
    assert len(corpus.nodes.rows) == 27
    assert len(corpus.edges.rows) == 23
    assert corpus.job_root is None  # a bare corpus, not a job root
    assert corpus.catalog is None
    # Metrics are computed from the dataset when no metrics.json is present.
    assert corpus.metrics is not None
    assert corpus.metrics.node_count == 27


def test_lookups_by_csid_label_and_type() -> None:
    corpus = load_corpus(SAMPLE)

    ceviche = corpus.node("cs:dish:ceviche")
    assert ceviche is not None
    assert first_label(ceviche) == "Dish"

    assert "Place" in corpus.labels()
    assert len(corpus.nodes_for_label("Place")) == 4
    assert "LOCATED_IN" in corpus.types()
    assert corpus.edges_for_type("LOCATED_IN")

    out_edges, in_edges = corpus.incident_edges("cs:place:lima")
    # Lima sits inside Peru (outgoing) and dishes locate into it (incoming).
    assert out_edges and in_edges


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_loads_a_full_job_output_root(tmp_path: Path) -> None:
    root = tmp_path / "out" / "demo"
    _write(
        root / "corpus" / "nodes" / "n.tsv",
        "csid:ID\t:LABEL\tname\ncs:x:1\tDish\tA\n",
    )
    _write(
        root / "corpus" / "edges" / "e.tsv",
        ":START_ID\t:END_ID\t:TYPE\ncs:x:1\tcs:x:1\tDERIVED_FROM\n",
    )
    _write(
        root / "corpus" / "metrics.json",
        json.dumps(
            {
                "node_count": 1,
                "edge_count": 1,
                "edges_per_node": 1.0,
                "component_count": 1,
                "largest_component_size": 1,
                "largest_component_fraction": 1.0,
                "edges_by_dimension": {"genetic": 1},
                "edges_by_type": {"DERIVED_FROM": 1},
            }
        ),
    )
    _write(
        root / "corpus" / "qa.json",
        json.dumps(
            {
                "dataset": "demo",
                "node_count": 1,
                "edge_count": 1,
                "ok": False,
                "gates": [
                    {"key": "min_rows", "label": "minimum rows", "passed": True},
                    {"key": "dup", "label": "duplicate rate", "passed": False},
                ],
            }
        ),
    )
    _write(
        root / "catalog.json",
        json.dumps({"categories": [{"id": "demo", "node_count": 1, "edge_count": 1}]}),
    )

    corpus = load_corpus(root)

    assert corpus.job_root == root  # discovered the job root, not just corpus/
    assert corpus.metrics is not None and corpus.metrics.node_count == 1
    assert corpus.catalog is not None
    assert {e.id for e in corpus.catalog.entries} == {"demo"}
    assert corpus.qa is not None
    assert corpus.qa.ok is False
    assert corpus.qa.violations == ("duplicate rate",)


def test_fixture_job_root_loads_every_artifact() -> None:
    corpus = load_corpus(FIXTURE_ROOT)

    # The job root is discovered (corpus lives under corpus/, catalog beside it).
    assert corpus.job_root == FIXTURE_ROOT
    assert corpus.corpus_dir == FIXTURE_ROOT / "corpus"
    assert len(corpus.nodes.rows) == 9
    assert len(corpus.edges.rows) == 9

    # catalog.json, metrics.json, and qa.json are read into typed view models.
    assert corpus.catalog is not None
    assert {e.id for e in corpus.catalog.entries} == {
        "peruvian-dishes",
        "andean-context",
    }
    assert corpus.metrics is not None and corpus.metrics.node_count == 9
    assert corpus.qa is not None
    assert corpus.qa.ok is False
    assert corpus.qa.violations == ("provenance completeness",)


def test_fixture_per_category_reports_are_loaded() -> None:
    corpus = load_corpus(FIXTURE_ROOT)

    assert corpus.categories() == ["andean-context", "peruvian-dishes"]

    dishes = corpus.report("peruvian-dishes")
    assert dishes is not None
    assert dishes.node_count == 4
    assert dishes.edge_count == 3
    assert dishes.ok is False
    assert dishes.violations == ("provenance completeness",)

    assert corpus.report("missing") is None


def test_fixture_lookups_by_csid_label_and_type() -> None:
    corpus = load_corpus(FIXTURE_ROOT)

    ceviche = corpus.node("cs:dish:ceviche")
    assert ceviche is not None
    assert first_label(ceviche) == "Dish"

    assert corpus.labels() == ["Dish", "Event", "Place"]
    assert len(corpus.nodes_for_label("Place")) == 3
    assert "LOCATED_IN" in corpus.types()
    assert len(corpus.edges_for_type("LOCATED_IN")) == 4


def test_search_matches_name_csid_and_qid_ranked() -> None:
    corpus = load_corpus(FIXTURE_ROOT)

    # By name, by csid fragment, and by Wikidata QID all reach the same node.
    for query in ("Ceviche", "cs:dish:ceviche", "Q207681"):
        hits = corpus.search(query)
        assert hits and hits[0].csid == "cs:dish:ceviche"

    # An exact name outranks a substring match in another node's name.
    ranked = corpus.search("ceviche")
    order = [h.csid for h in ranked]
    assert order.index("cs:dish:ceviche") < order.index("cs:dish:nikkei-ceviche")

    # Each hit carries the fields the search box renders.
    top = ranked[0]
    assert top.name == "Ceviche"
    assert top.label == "Dish"
    assert top.qid == "Q207681"

    # An empty query, and one that matches nothing, both return no hits.
    assert corpus.search("   ") == []
    assert corpus.search("no-such-entity") == []


def test_search_respects_its_limit() -> None:
    corpus = load_corpus(FIXTURE_ROOT)

    # Every fixture node carries the "cs:" csid prefix, so all of them match.
    assert len(corpus.search("cs:", limit=2)) == 2


def test_bare_corpus_subdir_has_no_job_artifacts() -> None:
    # The fixture's corpus/ dir, opened directly, is a bare corpus: no job root,
    # so no catalog and no per-category reports.
    corpus = load_corpus(FIXTURE_ROOT / "corpus")

    assert corpus.job_root is None
    assert corpus.catalog is None
    assert corpus.reports == {}
    assert corpus.categories() == []
    # The corpus-wide qa.json sits beside the dataset and still loads.
    assert corpus.qa is not None and corpus.qa.node_count == 9


def _build_mixed_root(tmp_path: Path) -> Path:
    """A job root whose categories span every completeness status."""
    root = tmp_path / "out" / "mixed"
    _write(
        root / "corpus" / "nodes" / "n.tsv",
        "csid:ID\t:LABEL\tname\ncs:x:1\tDish\tA\n",
    )
    _write(
        root / "corpus" / "edges" / "e.tsv",
        ":START_ID\t:END_ID\t:TYPE\ncs:x:1\tcs:x:1\tDERIVED_FROM\n",
    )

    def entry(cid: str, nodes: int, errors: int, records: int) -> dict[str, object]:
        return {
            "id": cid,
            "label": "Dish",
            "node_count": nodes,
            "edge_count": nodes,
            "last_run": "2026-06-18T09:30:00",
            "provenance": {
                "adapter": "wikidata",
                "sources": ["wikidata"] if records else [],
                "records": records,
                "errors": errors,
            },
        }

    _write(
        root / "catalog.json",
        json.dumps(
            {
                "categories": [
                    entry("complete-cat", nodes=5, errors=0, records=5),
                    entry("incomplete-cat", nodes=3, errors=0, records=3),
                    entry("failed-cat", nodes=0, errors=3, records=0),
                ]
            }
        ),
    )

    def report(cid: str, nodes: int, *, prov_ok: bool) -> str:
        return json.dumps(
            {
                "dataset": cid,
                "node_count": nodes,
                "edge_count": nodes,
                "ok": prov_ok,
                "gates": [
                    {
                        "key": "provenance_completeness",
                        "label": "provenance completeness",
                        "passed": prov_ok,
                    }
                ],
            }
        )

    _write(
        root / "qa" / "complete-cat.qa.json",
        report("complete-cat", 5, prov_ok=True),
    )
    _write(
        root / "qa" / "incomplete-cat.qa.json",
        report("incomplete-cat", 3, prov_ok=False),
    )
    _write(root / "qa" / "failed-cat.qa.json", report("failed-cat", 0, prov_ok=False))
    # A graded category that never made it into the catalog.
    _write(
        root / "qa" / "neverrun-cat.qa.json",
        report("neverrun-cat", 0, prov_ok=False),
    )
    return root


def test_completeness_classifies_every_status(tmp_path: Path) -> None:
    corpus = load_corpus(_build_mixed_root(tmp_path))

    by_id = {s.category_id: s for s in corpus.completeness()}
    assert by_id["complete-cat"].status == "complete"
    assert by_id["incomplete-cat"].status == "incomplete"
    assert by_id["failed-cat"].status == "failed"
    assert by_id["neverrun-cat"].status == "never_run"

    # A complete category carries no flags; a failed one names its fetch errors.
    assert by_id["complete-cat"].reasons == ()
    assert by_id["complete-cat"].provenance_complete is True
    assert by_id["failed-cat"].errors == 3
    assert any("fetch error" in r for r in by_id["failed-cat"].reasons)
    # The incomplete category is flagged on its failed provenance gate.
    assert by_id["incomplete-cat"].provenance_complete is False
    assert by_id["incomplete-cat"].violations == ("provenance completeness",)


def test_completeness_orders_worst_status_first(tmp_path: Path) -> None:
    corpus = load_corpus(_build_mixed_root(tmp_path))

    statuses = [s.status for s in corpus.completeness()]
    # failed, then never_run, then incomplete, then complete.
    assert statuses == ["failed", "never_run", "incomplete", "complete"]


def test_completeness_flags_fixture_categories_as_incomplete() -> None:
    corpus = load_corpus(FIXTURE_ROOT)

    by_id = {s.category_id: s for s in corpus.completeness()}
    assert set(by_id) == {"peruvian-dishes", "andean-context"}
    # Both fixture categories fail the provenance gate, so neither is complete.
    assert by_id["peruvian-dishes"].status == "incomplete"
    assert by_id["peruvian-dishes"].violations == ("provenance completeness",)


def test_non_corpus_directory_is_rejected(tmp_path: Path) -> None:
    (tmp_path / "empty").mkdir()
    with pytest.raises(CorpusError, match="holds no corpus"):
        load_corpus(tmp_path / "empty")

    with pytest.raises(CorpusError, match="not a directory"):
        load_corpus(tmp_path / "missing")
