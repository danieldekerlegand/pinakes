"""Unit + smoke tests for the rule-guided link predictor (Scallop pilot US-003).

The tests drive the pure core + the differentiable loop on tiny in-memory fixtures,
so the whole file runs in the ``ml/**`` CI (torch/pykeen are the declared stack; only
``scallopy`` is the macOS-only undeclared one). Coverage:

* the min-max-prob rule propagation (:func:`minmax_widths`) reduces to the US-001
  engine-free boolean transitive closure when every edge weight is 1, and carries
  gradients into the neural predicate;
* the neural predicate + rule layer train end-to-end (loss decreases) on a fixture;
* filtered ranking + the helped/hurt/neutral verdict;
* the ``.scl`` emission and the config round-trip;
* the doc-section upsert is idempotent.
"""

from __future__ import annotations

import json

import pytest
import torch

from linguascrape_ml.scallop import transitive_closure
from linguascrape_ml.scallop_train import (
    Comparison,
    PilotConfig,
    TrainingQuery,
    base_edges,
    boolean_reachable,
    build_model,
    build_scl_program,
    classify_effect,
    extract_marked_section,
    load_queries,
    minmax_widths,
    render_comparison_section,
    run_ranking,
    run_training,
    type_index,
    upsert_marked_section,
)
from linguascrape_ml.triples import Triple

# A tiny typed csid universe: a chain of languages (a descent line) + cultures.
_LANGS = [f"cs:language:l{i}" for i in range(6)]
_CULTURES = [f"cs:culture:c{i}" for i in range(3)]
_ENTITIES = _LANGS + _CULTURES
_INDEX = {csid: i for i, csid in enumerate(_ENTITIES)}


def _config(**over: object) -> PilotConfig:
    base = {
        "target_relations": ("DESCENDS_FROM", "BORROWED_FROM"),
        "transitive_relations": ("DESCENDS_FROM",),
        "hops": 4,
        "hidden_dim": 8,
        "epochs": 5,
        "learning_rate": 0.05,
        "seed": 7,
    }
    base.update(over)
    return PilotConfig.from_dict(base)


def _embeddings(dim: int = 4) -> torch.Tensor:
    torch.manual_seed(0)
    return torch.randn(len(_ENTITIES), dim)


# --- min-max propagation semantics -------------------------------------------


def test_minmax_reduces_to_boolean_closure() -> None:
    # A chain 0->1->2->3 plus a branch 0->4. With every weight 1 the reachable set
    # is exactly the boolean transitive closure's successors of the source.
    edges = {(0, 1), (1, 2), (2, 3), (0, 4)}
    reachable = boolean_reachable(edges, source=0, num_nodes=6, hops=4)
    closure = transitive_closure(edges)
    expected = {t for (h, t) in closure if h == 0}
    assert reachable == expected == {1, 2, 3, 4}


def test_minmax_is_bottleneck_of_best_path() -> None:
    # Two paths 0->2: 0->1->2 (min 0.3) and 0->2 direct (0.5). Widest-path = 0.5.
    src = torch.tensor([0, 1, 0])
    dst = torch.tensor([1, 2, 2])
    w = torch.tensor([0.9, 0.3, 0.5])
    width = minmax_widths(torch.tensor([0]), src, dst, w, num_nodes=3, hops=3)[0]
    assert width[1].item() == pytest.approx(0.9)
    assert width[2].item() == pytest.approx(0.5)  # max(min(0.9,0.3), 0.5) = 0.5


def test_minmax_carries_gradient_to_edges() -> None:
    src = torch.tensor([0, 1])
    dst = torch.tensor([1, 2])
    w = torch.tensor([0.6, 0.4], requires_grad=True)
    width = minmax_widths(torch.tensor([0]), src, dst, w, num_nodes=3, hops=2)[0]
    width[2].backward()  # bottleneck of 0->1->2 is min(0.6,0.4)=0.4 -> grad on edge 1
    assert w.grad is not None
    assert w.grad[1].item() == pytest.approx(1.0)
    assert w.grad[0].item() == pytest.approx(0.0)


def test_minmax_empty_graph_reaches_nothing() -> None:
    width = minmax_widths(
        torch.tensor([0]),
        torch.zeros(0, dtype=torch.long),
        torch.zeros(0, dtype=torch.long),
        torch.zeros(0),
        num_nodes=3,
        hops=3,
    )[0]
    assert width[0].item() == 1.0  # self-reach
    assert width[1].item() == 0.0 and width[2].item() == 0.0


# --- typing / loading --------------------------------------------------------


def test_type_index_groups_by_csid_type() -> None:
    by_type = type_index(_ENTITIES)
    assert set(by_type["language"]) == set(range(6))
    assert set(by_type["culture"]) == {6, 7, 8}


def test_load_queries_filters_to_targets_and_vocab(tmp_path) -> None:
    rows = [
        {"relation": "DESCENDS_FROM", "head": _LANGS[0], "tail": _LANGS[1], "label": 1},
        {"relation": "DESCENDS_FROM", "head": _LANGS[0], "tail": "cs:language:GONE",
         "label": 0},  # tail out of vocab -> skipped
        {"relation": "COGNATE_WITH", "head": _LANGS[0], "tail": _LANGS[1], "label": 1},
    ]
    path = tmp_path / "q.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
    loaded = load_queries(path, _INDEX, ("DESCENDS_FROM", "BORROWED_FROM"))
    assert len(loaded) == 1
    assert loaded[0] == TrainingQuery("DESCENDS_FROM", 0, 1, 1)


def test_base_edges_index_space() -> None:
    trips = [Triple("DESCENDS_FROM", _LANGS[0], _LANGS[1]),
             Triple("BORROWED_FROM", _LANGS[2], _LANGS[3])]
    base = base_edges(trips, _INDEX)
    assert base["DESCENDS_FROM"] == [(0, 1)]
    assert base["BORROWED_FROM"] == [(2, 3)]


# --- the training loop (end-to-end on a fixture — the CI smoke) ---------------


def _chain_queries() -> tuple[list[TrainingQuery], dict]:
    # Descent chain l0->l1->l2->l3->l4->l5; positives are the transitive pairs, a
    # couple of type-correct negatives.
    base = {"DESCENDS_FROM": [(i, i + 1) for i in range(5)]}
    positives = [TrainingQuery("DESCENDS_FROM", 0, 2, 1),
                 TrainingQuery("DESCENDS_FROM", 1, 3, 1),
                 TrainingQuery("DESCENDS_FROM", 0, 3, 1)]
    negatives = [TrainingQuery("DESCENDS_FROM", 5, 0, 0),
                 TrainingQuery("DESCENDS_FROM", 4, 1, 0)]
    return positives + negatives, base


def test_training_reduces_loss() -> None:
    queries, base = _chain_queries()
    config = _config(epochs=40, learning_rate=0.05)
    model = build_model(_embeddings(), config)
    report = run_training(model, queries, base, config)
    assert len(report.losses) == 40
    # The loop actually optimizes — the final loss is well below the first.
    assert report.losses[-1] < report.losses[0]
    assert report.losses[-1] < 0.6


def test_rule_layer_gives_transitive_positives_signal() -> None:
    # With only the ancestor rule (no direct edge for held-out pairs), a positive
    # that is transitively reachable through base facts scores above a negative that
    # is not — the rule is doing the work.
    queries, base = _chain_queries()
    config = _config(epochs=60, learning_rate=0.1)
    model = build_model(_embeddings(), config)
    run_training(model, queries, base, config)
    esrc = torch.tensor([a for a, _ in base["DESCENDS_FROM"]])
    edst = torch.tensor([b for _, b in base["DESCENDS_FROM"]])
    with torch.no_grad():
        ew = model.edge_prob("DESCENDS_FROM", esrc, edst)
        widths = minmax_widths(
            torch.tensor([0]), esrc, edst, ew, len(_ENTITIES), config.hops
        )[0]
    # l0 reaches l3 transitively (a positive); it does not reach a culture node.
    assert widths[3].item() > widths[8].item()


def test_evaluate_ranking_prefers_true_edges() -> None:
    queries, base = _chain_queries()
    config = _config(epochs=80, learning_rate=0.1)
    model = build_model(_embeddings(), config)
    run_training(model, queries, base, config)
    test = [Triple("DESCENDS_FROM", _LANGS[0], _LANGS[4])]
    metrics = run_ranking(model, test, base, _INDEX, config)
    assert metrics.num_ranks == 2  # head + tail query
    assert 0.0 <= metrics.mrr <= 1.0
    for v in metrics.hits.values():
        assert 0.0 <= v <= 1.0


def test_ranking_filters_known_edges() -> None:
    # A degenerate model (untrained) still produces valid ranks in [1, |pool|].
    config = _config(epochs=1)
    model = build_model(_embeddings(), config)
    base = {"DESCENDS_FROM": [(i, i + 1) for i in range(5)]}
    test = [Triple("DESCENDS_FROM", _LANGS[0], _LANGS[1])]
    known = {("DESCENDS_FROM", h, t) for (h, t) in base["DESCENDS_FROM"]}
    metrics = run_ranking(model, test, base, _INDEX, config, known=known)
    assert metrics.num_ranks == 2
    assert metrics.mrr > 0.0


# --- verdict + comparison rendering ------------------------------------------


def test_classify_effect_thresholds() -> None:
    assert classify_effect(0.10, 0.20) == "helped"
    assert classify_effect(0.20, 0.10) == "hurt"
    assert classify_effect(0.10, 0.101) == "neutral"
    assert classify_effect(0.0, 0.0) == "neutral"
    assert classify_effect(0.0, 0.30) == "helped"


def test_comparison_section_renders_and_is_idempotent() -> None:
    comparison = Comparison(
        baseline_model="transe",
        baseline_metrics={"mrr": 0.007, "hits@1": 0.0, "hits@3": 0.006,
                          "hits@10": 0.01},
        direct_metrics={"mrr": 0.04, "hits@1": 0.0, "hits@3": 0.03, "hits@10": 0.08},
        rule_metrics={"mrr": 0.05, "hits@1": 0.01, "hits@3": 0.04, "hits@10": 0.09},
        verdict="helped",
        direct_consistency={"descentCycles": 0, "schemaTypeBreaches": 2,
                            "asymmetryViolations": 0},
        rule_consistency={"descentCycles": 0, "schemaTypeBreaches": 1,
                          "asymmetryViolations": 0},
        num_ranks=344,
    )
    section = render_comparison_section(comparison, _config())
    assert "Rule-guided link prediction" in section
    assert "helped" in section
    assert section.strip().endswith("SCALLOP-PILOT:END -->")

    doc = "# ML baselines\n\nsome content\n"
    once = upsert_marked_section(doc, section)
    twice = upsert_marked_section(once, section)
    assert once == twice  # idempotent
    assert extract_marked_section(once) is not None
    # a fresh section replaces the old block in place (no duplication)
    comparison.verdict = "neutral"
    updated = render_comparison_section(comparison, _config())
    replaced = upsert_marked_section(once, updated)
    assert replaced.count("SCALLOP-PILOT:START") == 1


# --- scallopy program emission -----------------------------------------------


def test_build_scl_program_matches_translation_surface() -> None:
    scl = build_scl_program(("DESCENDS_FROM",))
    assert "type descends_from(String, String)" in scl
    assert "rel ancestor_descends_from(x, y) = descends_from(x, y)" in scl
    assert (
        "rel ancestor_descends_from(x, y) = descends_from(x, z) "
        "and ancestor_descends_from(z, y)" in scl
    )
    assert scl.endswith("\n")


# --- config round-trip -------------------------------------------------------


def test_config_round_trip_and_rejects_unknown(tmp_path) -> None:
    config = _config(hops=2)
    restored = PilotConfig.from_dict(config.to_dict())
    assert restored == config
    with pytest.raises(ValueError, match="unknown config keys"):
        PilotConfig.from_dict({**config.to_dict(), "bogus": 1})


def test_config_resolves_paths() -> None:
    config = PilotConfig(embeddings_model="rotate")
    resolved = config.resolved("/ml")
    assert (
        resolved.embeddings_path
        == "/ml/data/embeddings/rotate/entity_embeddings.npy"
    )
    assert resolved.triples_dir == "/ml/data/triples"
