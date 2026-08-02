"""Unit + snapshot tests for the KGQA eval harness (tier 3, US-004).

Unit tests drive the pure scorer + deterministic systems with tiny temp-dir
fixtures, so they run in CI where the git-ignored corpus + eval split are absent.
The snapshot test (live corpus/split vs committed baseline) is SKIPPED when the
export is not present — the local reproducibility gate, mirroring the other ml/
exporters.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pinakes_ml.consistency import load_edge_constraints
from pinakes_ml.eval_kgqa import build as build_report_cli
from pinakes_ml.kgqa import build_examples, build_graph
from pinakes_ml.kgqa_eval import (
    DOC_MARK_END,
    DOC_MARK_START,
    GraphRetrievalSystem,
    SystemPrediction,
    build_eval_report,
    default_systems,
    evidence_grounded,
    evidence_triples,
    exact_match,
    extract_marked_section,
    no_retrieval_system,
    normalize_answer,
    normalized_match,
    render_kgqa_section,
    score_system,
    upsert_marked_section,
)

_NODE_HEADER = "\t".join(
    ["csid:ID", "name", "time_start:int", "time_end:int", "lat:float", "lon:float",
     "source", "source_url", "source_query", "license"]
)
_EDGE_HEADER = "\t".join(
    [":START_ID", ":END_ID", ":TYPE", "source", "source_url", "source_query",
     "license"]
)


def _node_row(csid: str, name: str) -> str:
    return "\t".join([csid, name, "", "", "", "", "pinakes", "", "", "CC-BY-4.0"])


def _edge_row(head: str, tail: str, rel: str) -> str:
    return "\t".join([head, tail, rel, "pinakes", "", "", "CC-BY-4.0"])


@pytest.fixture()
def export_dir(tmp_path: Path) -> Path:
    """A 3-hop descent chain a->b->c->d + a 2-hop SPOKEN_IN/LOCATED_IN path."""
    nodes = tmp_path / "nodes"
    edges = tmp_path / "edges"
    nodes.mkdir()
    edges.mkdir()
    (nodes / "language.tsv").write_text(
        "\n".join([_NODE_HEADER,
                   _node_row("cs:language:a", "Latin"),
                   _node_row("cs:language:b", "Proto-Italic"),
                   _node_row("cs:language:c", "Proto-Indo-European"),
                   _node_row("cs:language:d", "Pre-PIE")]) + "\n",
        encoding="utf-8",
    )
    (nodes / "place.tsv").write_text(
        "\n".join([_NODE_HEADER,
                   _node_row("cs:place:rome", "Rome"),
                   _node_row("cs:place:italy", "Italy")]) + "\n",
        encoding="utf-8",
    )
    (edges / "descended-from.tsv").write_text(
        "\n".join([_EDGE_HEADER,
                   _edge_row("cs:language:a", "cs:language:b", "DESCENDS_FROM"),
                   _edge_row("cs:language:b", "cs:language:c", "DESCENDS_FROM"),
                   _edge_row("cs:language:c", "cs:language:d", "DESCENDS_FROM")])
        + "\n",
        encoding="utf-8",
    )
    (edges / "spoken-in.tsv").write_text(
        _EDGE_HEADER + "\n"
        + _edge_row("cs:language:a", "cs:place:rome", "SPOKEN_IN") + "\n",
        encoding="utf-8",
    )
    (edges / "located-in.tsv").write_text(
        _EDGE_HEADER + "\n"
        + _edge_row("cs:place:rome", "cs:place:italy", "LOCATED_IN") + "\n",
        encoding="utf-8",
    )
    return tmp_path


def _records(export_dir: Path) -> list[dict]:
    examples, _ = build_examples(export_dir)
    return [json.loads(e.as_json_line()) for e in examples]


# --- normalisation + matching -------------------------------------------------


def test_normalize_answer_casefold_punct_whitespace() -> None:
    assert normalize_answer("  Latin. ") == "latin"
    assert normalize_answer("Proto-Indo-European") == "proto indo european"
    assert normalize_answer("A  B") == "a b"


def test_exact_and_normalized_match() -> None:
    assert exact_match(" Italy ", "Italy")
    assert not exact_match("italy", "Italy")
    assert normalized_match("italy.", "Italy")
    assert not normalized_match("France", "Italy")


def test_evidence_grounded() -> None:
    evidence = [{"head_name": "Latin", "tail_name": "Italy"}]
    assert evidence_grounded("Italy", evidence)
    assert evidence_grounded("latin", evidence)
    assert not evidence_grounded("France", evidence)
    assert not evidence_grounded("Italy", [])  # no evidence -> not grounded
    assert not evidence_grounded("", evidence)


# --- systems ------------------------------------------------------------------


def test_graph_retrieval_answers_within_depth(export_dir: Path) -> None:
    graph = build_graph(export_dir)
    system = GraphRetrievalSystem(graph, depth=2)
    records = _records(export_dir)
    by = {(r["kind"], r["subject"]): r for r in records}

    # b's ancestor chain (b->c->d) is 2 hops -> fully retrievable at depth 2.
    pred_b = system(by[("derivation", "cs:language:b")])
    assert pred_b.answer == "Pre-PIE"
    assert pred_b.answered
    assert evidence_grounded(pred_b.answer, pred_b.evidence)

    # the 2-hop path is answered too.
    path = next(r for r in records if r["relation_path"] == "SPOKEN_IN>LOCATED_IN")
    pred_p = system(path)
    assert pred_p.answer == "Italy"
    assert pred_p.answered


def test_graph_retrieval_depth_bound_fails_deep_chain(export_dir: Path) -> None:
    graph = build_graph(export_dir)
    records = _records(export_dir)
    a_deriv = next(
        r for r in records
        if r["kind"] == "derivation" and r["subject"] == "cs:language:a"
    )
    # a->b->c->d is 3 hops; at depth 2 the final hop is unretrieved -> stuck at c.
    pred = GraphRetrievalSystem(graph, depth=2)(a_deriv)
    assert not pred.answered
    assert pred.answer == "Proto-Indo-European"  # the node it got stuck on (wrong)
    assert pred.answer != a_deriv["answer"]
    # a deeper retrieval reaches the true root.
    deep = GraphRetrievalSystem(graph, depth=3)(a_deriv)
    assert deep.answered
    assert deep.answer == "Pre-PIE"


def test_no_retrieval_control_restates_subject(export_dir: Path) -> None:
    records = _records(export_dir)
    pred = no_retrieval_system(records[0])
    assert pred.answer == records[0]["subject_name"]
    assert pred.evidence == []
    assert not pred.answered


# --- scoring ------------------------------------------------------------------


def test_score_system_tallies() -> None:
    records = [
        {"answer": "Italy", "kind": "path"},
        {"answer": "Pre-PIE", "kind": "derivation"},
    ]
    preds = [
        SystemPrediction("Italy", [{"tail_name": "Italy"}], answered=True),
        SystemPrediction("Wrong", [], answered=False),
    ]
    metrics = score_system(records, preds)
    assert metrics["total"] == 2
    assert metrics["exact"] == 1
    assert metrics["grounded"] == 1
    assert metrics["answered"] == 1
    assert metrics["accuracyExact"] == 0.5
    assert metrics["byKind"]["path"]["exact"] == 1
    assert metrics["byKind"]["derivation"]["exact"] == 0


def test_score_system_length_mismatch() -> None:
    with pytest.raises(ValueError):
        score_system([{"answer": "x", "kind": "path"}], [])


def test_evidence_triples_dedup_sorted() -> None:
    preds = [
        SystemPrediction("x", [
            {"head": "cs:a", "relation": "R", "tail": "cs:b"},
            {"head": "cs:a", "relation": "R", "tail": "cs:b"},  # dup
        ]),
        SystemPrediction("y", [{"head": "cs:a", "relation": "R", "tail": "cs:c"}]),
    ]
    triples = evidence_triples(preds)
    assert len(triples) == 2
    assert triples == sorted(triples)


# --- report + doc -------------------------------------------------------------


def test_build_eval_report_structure(export_dir: Path) -> None:
    records = _records(export_dir)
    graph = build_graph(export_dir)
    schema = Path(__file__).resolve().parents[2] / "shared" / "canonical-schema.json"
    constraints = load_edge_constraints(schema)
    report = build_eval_report(records, default_systems(graph), constraints, depth=2)
    assert report["split"] == "kgqa/eval"
    assert report["retrievalDepth"] == 2
    assert set(report["systems"]) == {"graph-retrieval", "no-retrieval"}
    gr = report["systems"]["graph-retrieval"]
    assert "metrics" in gr and "consistency" in gr
    # retrieval outscores the no-retrieval control (evidence adds value).
    assert (
        gr["metrics"]["accuracyExact"]
        > report["systems"]["no-retrieval"]["metrics"]["accuracyExact"]
    )


def test_render_kgqa_section_is_deterministic(export_dir: Path) -> None:
    records = _records(export_dir)
    graph = build_graph(export_dir)
    schema = Path(__file__).resolve().parents[2] / "shared" / "canonical-schema.json"
    constraints = load_edge_constraints(schema)
    report = build_eval_report(records, default_systems(graph), constraints, depth=2)
    section = render_kgqa_section(report)
    assert render_kgqa_section(report) == section  # pure
    assert section.startswith(DOC_MARK_START)
    assert section.rstrip().endswith(DOC_MARK_END)
    assert "graph-retrieval" in section and "no-retrieval" in section
    assert "tier 3" in section.lower()


def test_upsert_marked_section_insert_replace_idempotent() -> None:
    doc = "# Baselines\n\nsome content\n"
    section = f"{DOC_MARK_START}\nA\n{DOC_MARK_END}\n"
    assert extract_marked_section(doc) is None

    once = upsert_marked_section(doc, section)
    assert DOC_MARK_START in once and "some content" in once
    assert extract_marked_section(once) == f"{DOC_MARK_START}\nA\n{DOC_MARK_END}"

    # replacing with a new block swaps in place (no duplicate markers).
    section2 = f"{DOC_MARK_START}\nB\n{DOC_MARK_END}\n"
    twice = upsert_marked_section(once, section2)
    assert twice.count(DOC_MARK_START) == 1
    assert "B" in twice and "\nA\n" not in twice

    # idempotent: upserting the same block again is a no-op.
    assert upsert_marked_section(twice, section2) == twice


# --- Live reproducibility gate (skipped when the export is absent) ---------

_REPO_ROOT = Path(__file__).resolve().parents[2]
_LIVE_EXPORT = _REPO_ROOT / "export" / "culturescrape"
_EVAL_SPLIT = _REPO_ROOT / "ml" / "data" / "kgqa" / "eval.jsonl"
_SCHEMA = _REPO_ROOT / "shared" / "canonical-schema.json"
_BASELINE = _REPO_ROOT / "ml" / "manifests" / "kgqa-eval-baseline.json"


@pytest.mark.skipif(
    not (_LIVE_EXPORT / "nodes").exists() or not _EVAL_SPLIT.exists(),
    reason="canonical export / eval split not present (git-ignored; build it locally)",
)
def test_committed_baseline_matches_live_corpus() -> None:
    """The committed KGQA eval baseline must equal a fresh build of the live split."""
    from pinakes_ml.kgqa_eval import DEFAULT_RETRIEVAL_DEPTH

    committed = json.loads(_BASELINE.read_text(encoding="utf-8"))
    fresh = build_report_cli(
        _LIVE_EXPORT, _EVAL_SPLIT, _SCHEMA, depth=DEFAULT_RETRIEVAL_DEPTH
    )
    assert fresh == committed
