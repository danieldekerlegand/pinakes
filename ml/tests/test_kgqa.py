"""Unit + snapshot tests for the multi-hop KG-grounded QA generator (US-003).

Unit tests drive the pure core with tiny temp-dir fixtures, so they run in CI
where the DVC-tracked ``export/culturescrape`` is absent. The snapshot test (live
corpus vs committed manifest) is SKIPPED when the export is not present — the
local reproducibility gate, mirroring the triples/verbalization exporters.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from linguascrape_ml.export_kgqa import (
    REGISTERED_EVAL_SPLIT,
    build,
    load_split,
    write_split,
)
from linguascrape_ml.kgqa import (
    POLISHED_VARIANT,
    apply_polish,
    build_examples,
    build_graph,
    content_hash,
    serialize_examples,
    split_examples,
)

_NODE_HEADER = "\t".join(
    [
        "csid:ID",
        "name",
        "time_start:int",
        "time_end:int",
        "lat:float",
        "lon:float",
        "source",
        "source_url",
        "source_query",
        "license",
    ]
)
_EDGE_HEADER = "\t".join(
    [
        ":START_ID",
        ":END_ID",
        ":TYPE",
        "source",
        "source_url",
        "source_query",
        "license",
    ]
)


def _node_row(csid: str, name: str) -> str:
    return "\t".join(
        [csid, name, "", "", "", "", "linguascrape", f"http://x/{csid}", "",
         "CC-BY-4.0"]
    )


def _edge_row(head: str, tail: str, rel: str, **kw: str) -> str:
    cells = {"source": "linguascrape", "source_url": "", "source_query": "",
             "license": "CC-BY-4.0"}
    cells.update(kw)
    return "\t".join(
        [head, tail, rel, cells["source"], cells["source_url"],
         cells["source_query"], cells["license"]]
    )


@pytest.fixture()
def export_dir(tmp_path: Path) -> Path:
    """A tiny descent chain + a heterogeneous 2-hop path.

    Languages: a -> b -> c -> d (DESCENDS_FROM), so a/b have unambiguous
    ancestor chains to root d. a is also SPOKEN_IN rome, rome LOCATED_IN italy.
    """
    nodes = tmp_path / "nodes"
    edges = tmp_path / "edges"
    nodes.mkdir()
    edges.mkdir()
    (nodes / "language.tsv").write_text(
        "\n".join(
            [
                _NODE_HEADER,
                _node_row("cs:language:a", "Latin"),
                _node_row("cs:language:b", "Proto-Italic"),
                _node_row("cs:language:c", "Proto-Indo-European"),
                _node_row("cs:language:d", "Pre-PIE"),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (nodes / "place.tsv").write_text(
        "\n".join(
            [
                _NODE_HEADER,
                _node_row("cs:place:rome", "Rome"),
                _node_row("cs:place:italy", "Italy"),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (edges / "descended-from.tsv").write_text(
        "\n".join(
            [
                _EDGE_HEADER,
                _edge_row("cs:language:a", "cs:language:b", "DESCENDS_FROM",
                          source_url="http://cite/ab"),
                # duplicate supporting row — first-wins provenance
                _edge_row("cs:language:a", "cs:language:b", "DESCENDS_FROM",
                          source_url="http://cite/ab2"),
                _edge_row("cs:language:b", "cs:language:c", "DESCENDS_FROM"),
                _edge_row("cs:language:c", "cs:language:d", "DESCENDS_FROM"),
            ]
        )
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


def test_path_qa_follows_the_chain(export_dir: Path) -> None:
    examples, _ = build_examples(export_dir)
    paths = [e for e in examples if e.kind == "path"]
    # a -SPOKEN_IN-> rome -LOCATED_IN-> italy
    spoken = next(e for e in paths if e.relation_path == "SPOKEN_IN>LOCATED_IN")
    assert spoken.subject == "cs:language:a"
    assert spoken.answer == "Italy"
    assert spoken.answer_id == "cs:place:italy"
    assert "Latin is spoken in Rome" in spoken.question
    assert "where is Rome located?" in spoken.question
    assert spoken.hops == 2


def test_path_evidence_is_structured_and_grounded(export_dir: Path) -> None:
    examples, _ = build_examples(export_dir)
    spoken = next(
        e for e in examples if e.relation_path == "SPOKEN_IN>LOCATED_IN"
    )
    evidence = json.loads(spoken.evidence)
    assert [ev["relation"] for ev in evidence] == ["SPOKEN_IN", "LOCATED_IN"]
    assert evidence[0]["head_name"] == "Latin"
    assert evidence[-1]["tail_name"] == "Italy"
    # every evidence edge carries provenance + license
    for ev in evidence:
        assert ev["license"] == "CC-BY-4.0"
        assert "source" in ev and "source_url" in ev


def test_ambiguous_final_hop_is_dropped(tmp_path: Path) -> None:
    # rome has TWO LOCATED_IN tails → the 2-hop answer is ambiguous → dropped.
    nodes = tmp_path / "nodes"
    edges = tmp_path / "edges"
    nodes.mkdir()
    edges.mkdir()
    (nodes / "place.tsv").write_text(
        "\n".join(
            [
                _NODE_HEADER,
                _node_row("cs:place:a", "A"),
                _node_row("cs:place:rome", "Rome"),
                _node_row("cs:place:italy", "Italy"),
                _node_row("cs:place:eu", "Europe"),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (edges / "located-in.tsv").write_text(
        "\n".join(
            [
                _EDGE_HEADER,
                _edge_row("cs:place:a", "cs:place:rome", "LOCATED_IN"),
                _edge_row("cs:place:rome", "cs:place:italy", "LOCATED_IN"),
                _edge_row("cs:place:rome", "cs:place:eu", "LOCATED_IN"),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    examples, stats = build_examples(tmp_path)
    assert [e for e in examples if e.kind == "path"] == []
    assert stats["ambiguousFinalHop"] >= 2


def test_derivation_ancestor_chain(export_dir: Path) -> None:
    examples, _ = build_examples(export_dir)
    derivs = [e for e in examples if e.kind == "derivation"]
    # a's ultimate ancestor is d (root of a->b->c->d)
    latin = next(e for e in derivs if e.subject == "cs:language:a")
    assert latin.answer == "Pre-PIE"
    assert latin.answer_id == "cs:language:d"
    assert latin.hops == 3
    assert latin.reasoning_type == "ancestor_chain"
    assert "Latin" in latin.question
    evidence = json.loads(latin.evidence)
    assert all(ev["relation"] == "DESCENDS_FROM" for ev in evidence)
    # first-wins provenance on the deduped a->b edge
    assert evidence[0]["source_url"] == "http://cite/ab"


def test_derivation_requires_multi_hop(export_dir: Path) -> None:
    # c -> d is a single hop → not emitted (that is just a stored edge).
    examples, _ = build_examples(export_dir)
    derivs = {e.subject for e in examples if e.kind == "derivation"}
    assert "cs:language:c" not in derivs
    assert {"cs:language:a", "cs:language:b"} <= derivs


def test_ambiguous_ancestor_branch_is_dropped(tmp_path: Path) -> None:
    # b descends from BOTH c and c2 → a's ultimate ancestor is ambiguous.
    nodes = tmp_path / "nodes"
    edges = tmp_path / "edges"
    nodes.mkdir()
    edges.mkdir()
    (nodes / "language.tsv").write_text(
        "\n".join(
            [
                _NODE_HEADER,
                _node_row("cs:language:a", "A"),
                _node_row("cs:language:b", "B"),
                _node_row("cs:language:c", "C"),
                _node_row("cs:language:c2", "C2"),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (edges / "descended-from.tsv").write_text(
        "\n".join(
            [
                _EDGE_HEADER,
                _edge_row("cs:language:a", "cs:language:b", "DESCENDS_FROM"),
                _edge_row("cs:language:b", "cs:language:c", "DESCENDS_FROM"),
                _edge_row("cs:language:b", "cs:language:c2", "DESCENDS_FROM"),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    examples, stats = build_examples(tmp_path)
    assert [e for e in examples if e.kind == "derivation"] == []
    assert stats["ambiguousAncestorBranch"] >= 1


def test_cyclic_descent_is_dropped(tmp_path: Path) -> None:
    nodes = tmp_path / "nodes"
    edges = tmp_path / "edges"
    nodes.mkdir()
    edges.mkdir()
    (nodes / "language.tsv").write_text(
        "\n".join(
            [
                _NODE_HEADER,
                _node_row("cs:language:a", "A"),
                _node_row("cs:language:b", "B"),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (edges / "descended-from.tsv").write_text(
        "\n".join(
            [
                _EDGE_HEADER,
                _edge_row("cs:language:a", "cs:language:b", "DESCENDS_FROM"),
                _edge_row("cs:language:b", "cs:language:a", "DESCENDS_FROM"),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    examples, stats = build_examples(tmp_path)
    assert [e for e in examples if e.kind == "derivation"] == []
    assert stats["cyclicDescent"] >= 1


def test_output_is_deterministic(export_dir: Path) -> None:
    a, _ = build_examples(export_dir)
    b, _ = build_examples(export_dir)
    assert [e.as_json_line() for e in a] == [e.as_json_line() for e in b]
    assert content_hash(a) == content_hash(b)


def test_jsonl_schema_is_uniform(export_dir: Path) -> None:
    examples, _ = build_examples(export_dir)
    body = serialize_examples(examples)
    keys = None
    for line in body.splitlines():
        record = json.loads(line)
        if keys is None:
            keys = set(record)
        assert set(record) == keys


def test_split_is_leakage_safe_by_subject(export_dir: Path) -> None:
    examples, _ = build_examples(export_dir)
    splits = split_examples(examples, eval_ratio=0.5)
    train_subjects = {e.subject for e in splits.train}
    eval_subjects = {e.subject for e in splits.eval}
    # no entity's questions straddle the boundary
    assert train_subjects.isdisjoint(eval_subjects)
    # split is deterministic
    again = split_examples(examples, eval_ratio=0.5)
    assert [e.as_json_line() for e in splits.eval] == [
        e.as_json_line() for e in again.eval
    ]


def test_manifest_counts_and_stability(export_dir: Path) -> None:
    _, m1 = build(export_dir)
    _, m2 = build(export_dir)
    assert m1 == m2
    assert m1["counts"]["examples"] == (
        m1["counts"]["path"] + m1["counts"]["derivation"]
    )
    assert m1["splits"]["train"]["examples"] + m1["splits"]["eval"]["examples"] == (
        m1["counts"]["examples"]
    )
    # the held-out eval split is registered + snapshot-hashed
    assert "sha256" in m1["splits"]["eval"]


def test_registered_eval_split_roundtrips(export_dir: Path, tmp_path: Path) -> None:
    splits, _ = build(export_dir)
    out = tmp_path / "kgqa"
    write_split(out, "eval", splits.eval)
    loaded = load_split(out / "eval.jsonl")
    assert len(loaded) == len(splits.eval)
    assert REGISTERED_EVAL_SPLIT["manifestKey"] == "splits.eval"
    if loaded:
        assert {"question", "answer", "evidence"} <= set(loaded[0])


def test_apply_polish_keeps_grounding(export_dir: Path) -> None:
    examples, _ = build_examples(export_dir)
    records = [json.loads(e.as_json_line()) for e in examples]
    polished = apply_polish(records, lambda q: f"[polished] {q}")
    assert len(polished) == len(records)
    for original, variant in zip(records, polished, strict=True):
        assert variant["variant"] == POLISHED_VARIANT
        assert variant["question_original"] == original["question"]
        assert variant["question"].startswith("[polished] ")
        # grounding untouched
        assert variant["answer"] == original["answer"]
        assert variant["evidence"] == original["evidence"]


def test_build_graph_first_wins_provenance(export_dir: Path) -> None:
    graph = build_graph(export_dir)
    edge = graph.edge_index[("cs:language:a", "DESCENDS_FROM", "cs:language:b")]
    assert edge.source_url == "http://cite/ab"


# --- Live reproducibility gate (skipped when the DVC export is absent) ---------

_REPO_ROOT = Path(__file__).resolve().parents[2]
_LIVE_EXPORT = _REPO_ROOT / "export" / "culturescrape"
_MANIFEST = _REPO_ROOT / "ml" / "manifests" / "kgqa-manifest.json"


@pytest.mark.skipif(
    not (_LIVE_EXPORT / "nodes").exists(),
    reason="canonical export not present (DVC-tracked; run `dvc pull` locally)",
)
def test_committed_manifest_matches_live_corpus() -> None:
    """The committed manifest must equal a fresh build of the live corpus."""
    committed = json.loads(_MANIFEST.read_text(encoding="utf-8"))
    _, fresh = build(_LIVE_EXPORT)
    assert fresh == committed
